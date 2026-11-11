import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createBook,
  EMPTY_BODY,
  type Book,
  type BookBody,
  type Chapter,
} from '../books';
import { scannerBaseUrl } from '../firebaseConfig';
import { t } from '../i18n';
import { formatYear, parsePageRef } from '../lib/bookFields';
import {
  CameraGateStateMachine,
  captureVideoJpegBlob,
  rgbaToGrayscale,
  SAMPLE_FPS,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
} from '../lib/cameraGate';
import { genreLabel } from '../lib/genres';
import { uploadFailureKey, uploadImage } from '../media';
import {
  checkScannerHealth,
  createScanSession,
  deleteScanSession,
  finishScanSession,
  submitScanFrame,
  type DetectedPageResult,
  type ScanSessionSnapshot,
} from '../scannerClient';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';

import { ActionSheet } from './ActionSheet';
import { GenresPickerSheet, YearPickerSheet } from './BookForm';
import {
  CameraGlyph,
  CheckGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  PlusGlyph,
  TrashGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const snapshotToChapters = (snapshot: ScanSessionSnapshot | null): Chapter[] =>
  (snapshot?.chapters ?? []).map(ch => ({
    id: ch.id || makeId(),
    name: ch.name,
    pages: ch.pages,
    highlights: ch.highlights.map(hl => ({
      id: hl.id || makeId(),
      page: hl.page,
      text: hl.text,
    })),
  }));

const mergeChaptersIntoBody = (
  existing: BookBody,
  incoming: Chapter[],
): BookBody => {
  const merged = existing.chapters.map(ch => ({
    ...ch,
    highlights: [...ch.highlights],
  }));

  for (const ch of incoming) {
    const cleanHighlights = ch.highlights.filter(h => h.text.trim().length > 0);
    if (cleanHighlights.length === 0 && !ch.name.trim()) continue;

    const match = merged.find(
      m =>
        m.name.trim().toLowerCase() === ch.name.trim().toLowerCase() &&
        ch.name.trim().length > 0,
    );
    if (match) {
      match.highlights.push(...cleanHighlights);
      if (!match.pages && ch.pages) {
        match.pages = ch.pages;
      } else if (match.pages && ch.pages && !match.pages.includes(ch.pages)) {
        match.pages = `${match.pages}, ${ch.pages}`;
      }
    } else {
      merged.push({
        id: ch.id || makeId(),
        name: ch.name.trim() || t('chapters.untitled'),
        pages: ch.pages,
        highlights: cleanHighlights,
      });
    }
  }

  return {
    summary: existing.summary,
    chapters: merged,
  };
};

export function ScannerSheet({
  open,
  depth = 0,
  index = 0,
  targetBook,
  onSaved,
  onClose,
}: {
  open: boolean;
  depth?: number;
  index?: number;
  /** When provided, defaults destination to appending scanned highlights into this book. */
  targetBook: Book | null;
  onSaved: (bookId: string) => void;
  onClose: () => void;
}) {
  const allBooks = useBooksStore(state => state.books);
  const shelf = useMemo(() => selectShelf({ books: allBooks }), [allBooks]);
  const ensureBody = useBodiesStore(state => state.ensure);
  const saveBody = useBodiesStore(state => state.save);
  const primeBody = useBodiesStore(state => state.prime);

  const [phase, setPhase] = useState<'scan' | 'review'>('scan');
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [pagePresent, setPagePresent] = useState(false);
  const [settleProgress, setSettleProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<ScanSessionSnapshot | null>(null);
  const [detectedPages, setDetectedPages] = useState<DetectedPageResult[]>([]);

  // Review state
  const [destination, setDestination] = useState<'new' | 'existing'>(
    targetBook ? 'existing' : 'new',
  );
  const [selectedBookId, setSelectedBookId] = useState<string>(
    targetBook?.id ?? shelf[0]?.id ?? '',
  );
  const [newTitle, setNewTitle] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newYear, setNewYear] = useState<number | null>(null);
  const [newGenres, setNewGenres] = useState<string[]>([]);
  const [newSeries, setNewSeries] = useState<string | null>(null);
  const [newSeriesNumber, setNewSeriesNumber] = useState<number>(1);
  const [newSummary, setNewSummary] = useState('');
  const [coverFile, setCoverFile] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [coverSheet, setCoverSheet] = useState(false);
  const [genresOpen, setGenresOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [newSeriesInput, setNewSeriesInput] = useState('');
  const [draftChapters, setDraftChapters] = useState<Chapter[]>([]);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const newSeriesDialogRef = useRef<HTMLDialogElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const gateRef = useRef<CameraGateStateMachine>(new CameraGateStateMachine());
  const prevWarningCountRef = useRef(0);

  useEffect(() => {
    if (targetBook) {
      setDestination('existing');
      setSelectedBookId(targetBook.id);
    } else {
      setDestination('new');
      if (!selectedBookId && shelf[0]?.id) {
        setSelectedBookId(shelf[0].id);
      }
    }
  }, [targetBook, shelf, selectedBookId]);

  useEffect(() => {
    return () => {
      if (coverFile) URL.revokeObjectURL(coverFile.previewUrl);
    };
  }, [coverFile]);

  useEffect(() => {
    const dialog = newSeriesDialogRef.current;
    if (!dialog) return;
    if (seriesDialog && !dialog.open) {
      setNewSeriesInput('');
      dialog.showModal();
    }
    if (!seriesDialog && dialog.open) dialog.close();
  }, [seriesDialog]);

  const existingSeriesNames = useMemo(() => {
    const set = new Set<string>();
    for (const entry of shelf) {
      if (entry.series) set.add(entry.series);
    }
    if (newSeries) set.add(newSeries);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [shelf, newSeries]);

  const initScannerSession = useCallback(async () => {
    setBackendOnline(null);
    try {
      await checkScannerHealth();
      const created = await createScanSession(targetBook?.name);
      sessionIdRef.current = created.sessionId;
      setSnapshot(created);
      setBackendOnline(true);
    } catch (error) {
      console.warn('Scanner backend unreachable:', error);
      setBackendOnline(false);
    }
  }, [targetBook?.name]);

  useEffect(() => {
    if (!open) return;
    void initScannerSession();
    return () => {
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sid) void deleteScanSession(sid);
    };
  }, [open, initScannerSession]);

  // Open rear camera stream ONLY while in live scan phase (never records or stores video).
  useEffect(() => {
    if (!open || phase !== 'scan') return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(true);
      return;
    }

    let cancelled = false;
    let mediaStream: MediaStream | null = null;
    setCameraError(false);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then(stream => {
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        mediaStream = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => {});
        }
        setCameraReady(true);
      })
      .catch(err => {
        console.warn('Camera unavailable:', err);
        if (!cancelled) {
          setCameraReady(false);
          setCameraError(true);
        }
      });

    return () => {
      cancelled = true;
      setCameraReady(false);
      setPagePresent(false);
      setSettleProgress(0);
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [open, phase]);

  const sendFrameBlob = useCallback(
    async (blob: Blob, force: boolean) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      gateRef.current.setBusy(true);
      setCapturing(true);
      setSettleProgress(1);
      try {
        const res = await submitScanFrame({
          sessionId,
          frame: blob,
          spreadMode: 'auto',
          force,
        });
        setSnapshot(res.snapshot);
        if (res.accepted) {
          const hasMarkers = res.detectedPages.some(
            p => p.markers.length > 0 || p.extractedCount > 0,
          );
          setDetectedPages(res.detectedPages);
          if (!hasMarkers) {
            gateRef.current.rearmForContinuousScan();
          }
        } else {
          gateRef.current.rearmForContinuousScan();
        }
        if (res.snapshot.warnings.length > prevWarningCountRef.current) {
          prevWarningCountRef.current = res.snapshot.warnings.length;
          navigator.vibrate?.(120);
        }
      } catch (error) {
        console.warn('submitScanFrame', error);
        setBackendOnline(false);
      } finally {
        gateRef.current.setBusy(false);
        setCapturing(false);
        setSettleProgress(0);
      }
    },
    [],
  );

  // Sample `160x120` @ 12 fps in RAM to detect page presence + stillness + focus.
  useEffect(() => {
    if (!open || phase !== 'scan' || !cameraReady || !backendOnline) return;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = SAMPLE_WIDTH;
    sampleCanvas.height = SAMPLE_HEIGHT;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    gateRef.current = new CameraGateStateMachine();

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !sessionIdRef.current) return;

      ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const rgba = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      const gray = rgbaToGrayscale(rgba, SAMPLE_WIDTH * SAMPLE_HEIGHT);
      const step = gateRef.current.stepGrayscale(
        gray,
        SAMPLE_WIDTH,
        SAMPLE_HEIGHT,
        performance.now(),
      );

      setPagePresent(step.pagePresent);
      setSettleProgress(step.settleProgress);

      if (step.phase === 'turning') {
        setDetectedPages(prev => (prev.length > 0 ? [] : prev));
      }

      if (step.shouldCapture) {
        void captureVideoJpegBlob(video).then(captured => {
          if (captured) {
            void sendFrameBlob(captured.blob, false);
          }
        });
      }
    }, Math.round(1000 / SAMPLE_FPS));

    return () => window.clearInterval(interval);
  }, [open, phase, cameraReady, backendOnline, sendFrameBlob]);

  // Draw live sticky-marker HUD overlay + full-width horizontal scan lines.
  useEffect(() => {
    const canvas = hudCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    for (const page of detectedPages) {
      const sideOffset = page.side === 'right' ? 0.5 : 0;
      const sideScale = page.side === 'single' ? 1 : 0.5;
      const pageLeft = (sideOffset + 0.06 * sideScale) * w;
      const pageRight = (sideOffset + 0.94 * sideScale) * w;

      const sortedBars = page.markers
        .filter(m => m.kind === 'bar')
        .sort((a, b) => a.yNorm - b.yNorm);

      // Draw shaded highlight capture region between horizontal lines (or down to page bottom).
      if (sortedBars.length >= 2) {
        for (let i = 0; i + 1 < sortedBars.length; i += 2) {
          const y0 = sortedBars[i].yNorm * h;
          const y1 = sortedBars[i + 1].yNorm * h;
          ctx.save();
          ctx.fillStyle = 'rgba(48, 209, 88, 0.14)';
          ctx.fillRect(pageLeft, y0, pageRight - pageLeft, Math.max(4, y1 - y0));
          ctx.restore();
        }
      } else if (sortedBars.length === 1) {
        const yBar = sortedBars[0].yNorm * h;
        ctx.save();
        ctx.fillStyle = 'rgba(48, 209, 88, 0.13)';
        if (page.action === 'range-close') {
          const topY = 0.08 * h;
          ctx.fillRect(
            pageLeft,
            topY,
            pageRight - pageLeft,
            Math.max(4, yBar - topY),
          );
        } else {
          const botY = 0.92 * h;
          ctx.fillRect(
            pageLeft,
            yBar,
            pageRight - pageLeft,
            Math.max(4, botY - yBar),
          );
        }
        ctx.restore();
      }

      for (const marker of page.markers) {
        const [bx, by, bw, bh] = marker.bbox;
        const x = (sideOffset + bx * sideScale) * w;
        const y = by * h;
        const lineY = marker.yNorm * h;
        const mw = Math.max(18 * dpr, bw * sideScale * w);
        const mh = Math.max(14 * dpr, bh * h);

        const isSingle = marker.kind === 'L';
        const stroke = isSingle ? '#30d158' : '#ffd60a';
        const fill = isSingle
          ? 'rgba(48, 209, 88, 0.24)'
          : 'rgba(255, 214, 10, 0.24)';

        ctx.save();
        // Full-width horizontal scan line across the page at the sticky marker's Y position
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.2 * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(pageLeft, lineY);
        ctx.lineTo(pageRight, lineY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Sticky marker bounding pill
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.2 * dpr;
        ctx.beginPath();
        ctx.roundRect(x, y, mw, mh, 5 * dpr);
        ctx.fill();
        ctx.stroke();

        const tag = isSingle
          ? `L · ${t('scanner.markerSingle')}`
          : `— · ${t('scanner.markerRange')}`;
        ctx.font = `600 ${Math.round(11 * dpr)}px system-ui, -apple-system, sans-serif`;
        const textW = ctx.measureText(tag).width + 12 * dpr;
        const pillH = 20 * dpr;
        const pillX = Math.min(w - textW - 8 * dpr, Math.max(8 * dpr, x));
        const pillY = Math.max(8 * dpr, y - pillH - 4 * dpr);

        ctx.fillStyle = 'rgba(13, 13, 13, 0.85)';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, textW, pillH, 999);
        ctx.fill();

        ctx.fillStyle = stroke;
        ctx.fillText(tag, pillX + 6 * dpr, pillY + 14 * dpr);
        ctx.restore();
      }
    }
  }, [detectedPages]);

  const handleManualCapture = async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    gateRef.current.notifyManualCapture();
    const captured = await captureVideoJpegBlob(video);
    if (captured) {
      await sendFrameBlob(captured.blob, true);
    }
  };

  const handleFinishScan = async () => {
    let finalSnap = snapshot;
    if (sessionIdRef.current && backendOnline) {
      try {
        finalSnap = await finishScanSession(sessionIdRef.current);
        setSnapshot(finalSnap);
      } catch (error) {
        console.warn('finishScanSession', error);
      }
    }
    setDraftChapters(snapshotToChapters(finalSnap));
    setPhase('review');
  };

  const totalHighlights = useMemo(
    () =>
      (phase === 'review' ? draftChapters : snapshot?.chapters ?? []).reduce(
        (sum, ch) => sum + ch.highlights.length,
        0,
      ),
    [draftChapters, phase, snapshot],
  );

  const canSaveReview =
    !saving &&
    (destination === 'new'
      ? newTitle.trim().length > 0
      : Boolean(selectedBookId));

  const handleCommitReview = async () => {
    if (!canSaveReview) return;
    setSaving(true);

    const cleanedChapters: Chapter[] = draftChapters
      .map(ch => ({
        id: ch.id || makeId(),
        name: ch.name.trim() || t('chapters.untitled'),
        pages: parsePageRef(ch.pages) ?? '',
        highlights: ch.highlights
          .map(hl => ({
            id: hl.id || makeId(),
            text: hl.text.trim(),
            page: parsePageRef(hl.page ?? ''),
          }))
          .filter(hl => hl.text.length > 0),
      }))
      .filter(ch => ch.highlights.length > 0 || ch.name.length > 0);

    try {
      if (destination === 'new') {
        let uploadedCover: { publicId: string; url: string } | null = null;
        if (coverFile) {
          uploadedCover = await uploadImage(coverFile.file, 'covers');
        }
        const trimmedName = newTitle.trim();
        if (!trimmedName) {
          setSaving(false);
          return;
        }
        const cleanSeries = newSeries?.trim() || null;
        const fields = {
          name: trimmedName,
          author: newAuthor.trim(),
          genres: newGenres,
          series: cleanSeries,
          seriesNumber: cleanSeries ? newSeriesNumber : null,
          year: newYear,
        };
        const body: BookBody = {
          summary: newSummary.trim(),
          chapters: cleanedChapters,
        };
        const bookId = await createBook({
          fields,
          cover: uploadedCover,
          body,
        });
        primeBody(bookId, body);
        if (sessionIdRef.current) {
          void deleteScanSession(sessionIdRef.current);
          sessionIdRef.current = null;
        }
        showToast(t('snackbar.book-created'));
        onSaved(bookId);
      } else {
        const existingBody = await ensureBody(selectedBookId);
        const merged = mergeChaptersIntoBody(existingBody, cleanedChapters);
        await saveBody(selectedBookId, merged);
        if (sessionIdRef.current) {
          void deleteScanSession(sessionIdRef.current);
          sessionIdRef.current = null;
        }
        showToast(t('snackbar.book-updated'));
        onSaved(selectedBookId);
      }
    } catch (error) {
      console.warn('handleCommitReview', error);
      showToast(t(uploadFailureKey(error, 'snackbar.book-save-failed')));
    } finally {
      setSaving(false);
    }
  };

  const genresSummary =
    newGenres.length > 0
      ? newGenres.map(g => genreLabel(k => t(k), g)).join(', ')
      : t('bookEdit.genres.none');

  const yearSummary =
    newYear !== null
      ? formatYear(newYear, y => t('bookEdit.year.bc', { year: y }))
      : t('bookEdit.year.none');

  const childDepth = genresOpen || yearOpen ? 1 : 0;
  const effectiveProgress = capturing ? 1 : settleProgress;
  const cornersClass = [
    'scanner-corners',
    pagePresent || effectiveProgress > 0 ? 'is-page' : '',
    capturing || effectiveProgress >= 0.98 ? 'is-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <SidePanel
        open={open}
        depth={depth + childDepth}
        index={index}
        title={t(phase === 'scan' ? 'scanner.title' : 'scanner.reviewTitle')}
        action={
          phase === 'review' ? (
            <button
              type="button"
              className="round"
              onClick={() => setPhase('scan')}
            >
              <ChevronLeftGlyph />
              <span className="sr">{t('scanner.actions.backToCamera')}</span>
            </button>
          ) : undefined
        }
        trailing={
          phase === 'review' ? (
            <button
              type="button"
              className={saving ? 'round is-commit is-busy' : 'round is-commit'}
              disabled={!canSaveReview}
              onClick={() => void handleCommitReview()}
            >
              {saving ? <span className="spinner" /> : <CheckGlyph />}
              <span className="sr">
                {t(
                  destination === 'new'
                    ? 'scanner.actions.saveBook'
                    : 'scanner.actions.appendBook',
                )}
              </span>
            </button>
          ) : undefined
        }
        onClose={onClose}
      >
        {phase === 'scan' ? (
          <div className="scanner-viewport">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={
                cameraReady ? 'scanner-video is-ready' : 'scanner-video'
              }
              onClick={() => void handleManualCapture()}
            />
            <canvas ref={hudCanvasRef} className="scanner-hud" />

            <div className={cornersClass} aria-hidden="true">
              <svg
                className="scanner-frame-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <rect
                  className="scanner-frame-track"
                  x="1"
                  y="1"
                  width="98"
                  height="98"
                  rx="4"
                  ry="4"
                  pathLength={100}
                />
                <rect
                  className="scanner-frame-fill"
                  x="1"
                  y="1"
                  width="98"
                  height="98"
                  rx="4"
                  ry="4"
                  pathLength={100}
                  style={{
                    strokeDasharray: 100,
                    strokeDashoffset: Math.max(
                      0,
                      100 - Math.round(effectiveProgress * 100),
                    ),
                  }}
                />
              </svg>
              <i />
              <i />
              <i />
              <i />
            </div>

            {!cameraReady && (
              <div className="scanner-camera-fallback">
                <span className="side-empty-mark">
                  <CameraGlyph />
                </span>
                <p>
                  {cameraError
                    ? t('scanner.statusCameraOff')
                    : t('scanner.statusCapturing')}
                </p>
              </div>
            )}

            <div className="scanner-hud-top">
              <div className="scanner-hud-row">
                {backendOnline === false ? (
                  <button
                    type="button"
                    className="scanner-status-pill is-alert"
                    onClick={() => void initScannerSession()}
                    title={scannerBaseUrl}
                  >
                    <span>{t('scanner.actions.retrySession')}</span>
                  </button>
                ) : (
                  <div
                    className={
                      snapshot?.openRange.active
                        ? 'scanner-status-pill is-range'
                        : 'scanner-status-pill'
                    }
                  >
                    {(capturing || effectiveProgress > 0) && (
                      <span className="scanner-pulse" />
                    )}
                    <span>
                      {capturing
                        ? t('scanner.statusCapturing')
                        : snapshot?.openRange.active
                          ? t('scanner.statusRange', {
                              startPage: snapshot.openRange.startPage ?? '?',
                            })
                          : t('scanner.statusIdle')}
                    </span>
                  </div>
                )}

                <div className="scanner-counter-pill" aria-live="polite">
                  <span>
                    {snapshot?.pagesScanned ?? 0}p · {totalHighlights}{' '}
                    {t('scanner.counters.highlights').toLowerCase()}
                  </span>
                </div>
              </div>

              {snapshot?.currentChapter && (
                <div className="scanner-chapter-pill">
                  <span>{snapshot.currentChapter}</span>
                </div>
              )}

              {snapshot && snapshot.warnings.length > 0 && (
                <div className="scanner-warning-pill" role="status">
                  <span>
                    {snapshot.warnings[snapshot.warnings.length - 1]}
                  </span>
                </div>
              )}
            </div>

            <div className="scanner-hud-bottom">
              <button
                type="button"
                className="pill is-primary scanner-finish-btn"
                onClick={() => void handleFinishScan()}
              >
                {t('scanner.actions.finish')}
                {totalHighlights > 0 ? ` (${totalHighlights})` : ''}
              </button>
            </div>
          </div>
        ) : (
          <>
            {shelf.length > 0 && (
              <div className="card">
                <div className="cell">
                  <div className="segmented">
                    <button
                      type="button"
                      className={
                        destination === 'new' ? 'is-active' : undefined
                      }
                      onClick={() => setDestination('new')}
                    >
                      {t('scanner.target.newBook')}
                    </button>
                    <button
                      type="button"
                      className={
                        destination === 'existing' ? 'is-active' : undefined
                      }
                      onClick={() => {
                        setDestination('existing');
                        if (!selectedBookId && shelf[0]) {
                          setSelectedBookId(shelf[0].id);
                        }
                      }}
                    >
                      {t('scanner.target.existingBook')}
                    </button>
                  </div>
                </div>

                {destination === 'existing' && (
                  <label className="cell picker">
                    <span className="cell-name">
                      {t('scanner.target.label')}
                    </span>
                    <select
                      value={selectedBookId}
                      onChange={e => setSelectedBookId(e.target.value)}
                    >
                      {shelf.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {destination === 'new' && (
              <>
                <div className="art-slot">
                  <button
                    type="button"
                    className="art-pick"
                    disabled={saving}
                    onClick={() =>
                      coverFile
                        ? setCoverSheet(true)
                        : coverInputRef.current?.click()
                    }
                  >
                    <span className="art-box is-book">
                      {coverFile ? (
                        <img src={coverFile.previewUrl} alt="" />
                      ) : (
                        <PlusGlyph />
                      )}
                    </span>
                    <span className="text-action">
                      {t(
                        coverFile
                          ? 'bookEdit.cover.change'
                          : 'bookEdit.cover.add',
                      )}
                    </span>
                  </button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const previewUrl = URL.createObjectURL(file);
                        setCoverFile(prev => {
                          if (prev) URL.revokeObjectURL(prev.previewUrl);
                          return { file, previewUrl };
                        });
                      }
                      e.target.value = '';
                    }}
                  />
                  <ActionSheet
                    open={coverSheet}
                    cancel={t('common.cancel')}
                    actions={[
                      {
                        label: t('bookEdit.cover.change'),
                        onSelect: () => coverInputRef.current?.click(),
                      },
                      {
                        label: t('bookEdit.cover.remove'),
                        destructive: true,
                        onSelect: () =>
                          setCoverFile(prev => {
                            if (prev) URL.revokeObjectURL(prev.previewUrl);
                            return null;
                          }),
                      },
                    ]}
                    onClose={() => setCoverSheet(false)}
                  />
                </div>

                <div className="card">
                  <label className="cell field">
                    <span className="field-caption">
                      {t('bookEdit.name.label')}
                    </span>
                    <input
                      value={newTitle}
                      placeholder={t('bookEdit.name.placeholder')}
                      disabled={saving}
                      onChange={e => setNewTitle(e.target.value)}
                    />
                  </label>
                  <label className="cell field">
                    <span className="field-caption">
                      {t('bookEdit.author.label')}
                    </span>
                    <input
                      value={newAuthor}
                      placeholder={t('bookEdit.author.placeholder')}
                      disabled={saving}
                      onChange={e => setNewAuthor(e.target.value)}
                    />
                  </label>
                </div>

                <div className="card">
                  <button
                    type="button"
                    className="cell link-row"
                    disabled={saving}
                    onClick={() => setYearOpen(true)}
                  >
                    <span className="cell-name">
                      {t('bookEdit.year.label')}
                    </span>
                    <span className="cell-value">{yearSummary}</span>
                    <span className="chevron">
                      <ChevronRightGlyph />
                    </span>
                  </button>

                  <button
                    type="button"
                    className="cell link-row"
                    disabled={saving}
                    onClick={() => setGenresOpen(true)}
                  >
                    <span className="cell-name">
                      {t('bookEdit.genres.label')}
                    </span>
                    <span className="cell-value">{genresSummary}</span>
                    <span className="chevron">
                      <ChevronRightGlyph />
                    </span>
                  </button>

                  <label className="cell picker">
                    <span className="cell-name">
                      {t('bookEdit.series.label')}
                    </span>
                    <select
                      value={newSeries ?? '__none__'}
                      disabled={saving}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '__none__') {
                          setNewSeries(null);
                        } else if (val === '__new__') {
                          setSeriesDialog(true);
                        } else {
                          setNewSeries(val);
                        }
                      }}
                    >
                      <option value="__none__">
                        {t('bookEdit.series.none')}
                      </option>
                      {existingSeriesNames.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      <option value="__new__">
                        {t('bookEdit.series.new')}
                      </option>
                    </select>
                  </label>

                  {newSeries && (
                    <div className="cell">
                      <span className="cell-name">
                        {t('bookEdit.series.number', {
                          number: newSeriesNumber,
                        })}
                      </span>
                      <div className="stepper">
                        <button
                          type="button"
                          disabled={saving || newSeriesNumber <= 1}
                          onClick={() =>
                            setNewSeriesNumber(n => Math.max(1, n - 1))
                          }
                        >
                          −
                        </button>
                        <button
                          type="button"
                          disabled={saving || newSeriesNumber >= 99}
                          onClick={() =>
                            setNewSeriesNumber(n => Math.min(99, n + 1))
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <section>
                  <h3 className="section-head">{t('bookEdit.summary.label')}</h3>
                  <div className="card">
                    <div className="cell textarea-cell">
                      <textarea
                        rows={3}
                        value={newSummary}
                        placeholder={t('bookEdit.summary.placeholder')}
                        disabled={saving}
                        onChange={e => setNewSummary(e.target.value)}
                      />
                    </div>
                  </div>
                </section>
              </>
            )}

            <section>
              <h3 className="section-head split">
                <span>{t('book.chapters')}</span>
                <span className="head-value">{totalHighlights}</span>
              </h3>

              {draftChapters.length === 0 ? (
                <div className="card">
                  <div className="cell muted-empty">
                    {t('scanner.draftEmpty')}
                  </div>
                </div>
              ) : (
                draftChapters.map((ch, cIdx) => (
                  <div key={ch.id} className="card scanner-chapter-card">
                    <div className="cell field scanner-chapter-head">
                      <div className="scanner-chapter-inputs">
                        <input
                          value={ch.name}
                          placeholder={t('chapters.untitled')}
                          onChange={e => {
                            const val = e.target.value;
                            setDraftChapters(prev =>
                              prev.map((item, i) =>
                                i === cIdx ? { ...item, name: val } : item,
                              ),
                            );
                          }}
                        />
                        <input
                          className="scanner-pages-input"
                          value={ch.pages}
                          placeholder={t('chapter.pagesPlaceholder')}
                          onChange={e => {
                            const val = e.target.value;
                            setDraftChapters(prev =>
                              prev.map((item, i) =>
                                i === cIdx ? { ...item, pages: val } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="round quiet is-destructive"
                        title={t('chapters.delete')}
                        onClick={() =>
                          setDraftChapters(prev =>
                            prev.filter((_, i) => i !== cIdx),
                          )
                        }
                      >
                        <TrashGlyph />
                      </button>
                    </div>

                    {ch.highlights.map((hl, hIdx) => (
                      <div key={hl.id} className="cell scanner-hl-edit">
                        <div className="scanner-hl-fields">
                          <textarea
                            rows={3}
                            value={hl.text}
                            placeholder={t('highlightEdit.textPlaceholder')}
                            onChange={e => {
                              const val = e.target.value;
                              setDraftChapters(prev =>
                                prev.map((item, i) =>
                                  i === cIdx
                                    ? {
                                        ...item,
                                        highlights: item.highlights.map(
                                          (h, j) =>
                                            j === hIdx
                                              ? { ...h, text: val }
                                              : h,
                                        ),
                                      }
                                    : item,
                                ),
                              );
                            }}
                          />
                          <input
                            value={hl.page ?? ''}
                            placeholder={t('highlightEdit.pagePlaceholder')}
                            onChange={e => {
                              const val = e.target.value;
                              setDraftChapters(prev =>
                                prev.map((item, i) =>
                                  i === cIdx
                                    ? {
                                        ...item,
                                        highlights: item.highlights.map(
                                          (h, j) =>
                                            j === hIdx
                                              ? { ...h, page: val || null }
                                              : h,
                                        ),
                                      }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="round quiet is-destructive"
                          title={t('highlightEdit.delete')}
                          onClick={() =>
                            setDraftChapters(prev =>
                              prev.map((item, i) =>
                                i === cIdx
                                  ? {
                                      ...item,
                                      highlights: item.highlights.filter(
                                        (_, j) => j !== hIdx,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          <TrashGlyph />
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      className="cell new-clip-row"
                      onClick={() =>
                        setDraftChapters(prev =>
                          prev.map((item, i) =>
                            i === cIdx
                              ? {
                                  ...item,
                                  highlights: [
                                    ...item.highlights,
                                    { id: makeId(), text: '', page: null },
                                  ],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      + {t('scanner.actions.addHighlight')}
                    </button>
                  </div>
                ))
              )}

              <button
                type="button"
                className="pill scanner-add-ch"
                onClick={() =>
                  setDraftChapters(prev => [
                    ...prev,
                    {
                      id: makeId(),
                      name: '',
                      pages: '',
                      highlights: [{ id: makeId(), text: '', page: null }],
                    },
                  ])
                }
              >
                + {t('scanner.actions.addChapter')}
              </button>
            </section>
          </>
        )}
      </SidePanel>

      {genresOpen && (
        <GenresPickerSheet
          index={index + 1}
          selected={newGenres}
          onChange={setNewGenres}
          onClose={() => setGenresOpen(false)}
        />
      )}

      {yearOpen && (
        <YearPickerSheet
          index={index + 1}
          value={newYear}
          onChange={setNewYear}
          onClose={() => setYearOpen(false)}
        />
      )}

      <dialog
        ref={newSeriesDialogRef}
        className="confirm"
        onClose={() => setSeriesDialog(false)}
        onClick={e => e.target === e.currentTarget && setSeriesDialog(false)}
      >
        <form
          method="dialog"
          onSubmit={e => {
            e.preventDefault();
            const trimmed = newSeriesInput.trim();
            if (trimmed) setNewSeries(trimmed);
            setSeriesDialog(false);
          }}
        >
          <h2>{t('bookEdit.series.newTitle')}</h2>
          <input
            className="dialog-field"
            value={newSeriesInput}
            placeholder={t('bookEdit.series.newPlaceholder')}
            onChange={e => setNewSeriesInput(e.target.value)}
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="pill"
              onClick={() => setSeriesDialog(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="pill is-primary"
              disabled={!newSeriesInput.trim()}
            >
              {t('common.done')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
