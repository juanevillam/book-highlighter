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
import { parsePageRef } from '../lib/bookFields';
import {
  CameraGateStateMachine,
  captureVideoJpegBlob,
  rgbaToGrayscale,
  SAMPLE_FPS,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
} from '../lib/cameraGate';
import { uploadFailureKey, uploadImage } from '../media';
import {
  checkScannerHealth,
  createScanSession,
  deleteScanSession,
  finishScanSession,
  submitScanFrame,
  type DetectedPageResult,
  type ScanSessionSnapshot,
  type SpreadMode,
} from '../scannerClient';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';

import {
  CameraGlyph,
  CheckGlyph,
  ChevronLeftGlyph,
  PlusGlyph,
  TrashGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

const SPREAD_MODES: readonly SpreadMode[] = ['auto', 'single', 'double'];

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
  const [spreadMode, setSpreadMode] = useState<SpreadMode>('auto');
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
  const [newSummary, setNewSummary] = useState('');
  const [coverFile, setCoverFile] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [draftChapters, setDraftChapters] = useState<Chapter[]>([]);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
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
      try {
        const res = await submitScanFrame({
          sessionId,
          frame: blob,
          spreadMode,
          force,
        });
        setSnapshot(res.snapshot);
        if (res.accepted) {
          setDetectedPages(res.detectedPages);
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
      }
    },
    [spreadMode],
  );

  // Sample `160x120` @ 12 fps in RAM to detect page turns + stillness + focus.
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

  // Draw live sticky-marker HUD overlay (`L` green, `bar` amber/blue).
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

    if (spreadMode === 'double') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 16 * dpr);
      ctx.lineTo(w * 0.5, h - 16 * dpr);
      ctx.stroke();
      ctx.restore();
    }

    for (const page of detectedPages) {
      const sideOffset = page.side === 'right' ? 0.5 : 0;
      const sideScale = page.side === 'single' ? 1 : 0.5;

      for (const marker of page.markers) {
        const [bx, by, bw, bh] = marker.bbox;
        const x = (sideOffset + bx * sideScale) * w;
        const y = by * h;
        const mw = Math.max(18 * dpr, bw * sideScale * w);
        const mh = Math.max(14 * dpr, bh * h);

        const isSingle = marker.kind === 'L';
        const stroke = isSingle ? '#30d158' : '#ffd60a';
        const fill = isSingle
          ? 'rgba(48, 209, 88, 0.22)'
          : 'rgba(255, 214, 10, 0.22)';

        ctx.save();
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

        ctx.fillStyle = 'rgba(13, 13, 13, 0.82)';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, textW, pillH, 999);
        ctx.fill();

        ctx.fillStyle = stroke;
        ctx.fillText(tag, pillX + 6 * dpr, pillY + 14 * dpr);
        ctx.restore();
      }
    }
  }, [detectedPages, spreadMode]);

  const handleManualCapture = async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    gateRef.current.notifyManualCapture();
    const captured = await captureVideoJpegBlob(video);
    if (captured) {
      await sendFrameBlob(captured.blob, true);
    }
  };

  const handlePickedPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!sessionIdRef.current) {
      await initScannerSession();
    }
    if (!sessionIdRef.current) return;

    for (const file of Array.from(files)) {
      await sendFrameBlob(file, true);
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
          uploadedCover = await uploadImage(coverFile.file);
        }
        const trimmedName = newTitle.trim();
        if (!trimmedName) {
          setSaving(false);
          return;
        }
        const fields = {
          name: trimmedName,
          author: newAuthor.trim(),
          genres: [] as string[],
          series: null,
          seriesNumber: null,
          year: null,
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
        onSaved(bookId);
      } else {
        const existingBody = await ensureBody(selectedBookId);
        const merged = mergeChaptersIntoBody(existingBody, cleanedChapters);
        await saveBody(selectedBookId, merged);
        if (sessionIdRef.current) {
          void deleteScanSession(sessionIdRef.current);
          sessionIdRef.current = null;
        }
        onSaved(selectedBookId);
      }
    } catch (error) {
      console.warn('handleCommitReview', error);
      showToast(t(uploadFailureKey(error, 'snackbar.book-save-failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidePanel
      open={open}
      depth={depth}
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
        <>
          <div className="card">
            <div className="cell">
              <div className="segmented">
                {SPREAD_MODES.map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={spreadMode === mode ? 'is-active' : undefined}
                    onClick={() => setSpreadMode(mode)}
                  >
                    {t(`scanner.spread.${mode}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scanner-viewport">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={cameraReady ? 'scanner-video is-ready' : 'scanner-video'}
            />
            <canvas ref={hudCanvasRef} className="scanner-hud" />

            <div className="scanner-corners" aria-hidden="true">
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

            <div
              className={
                snapshot?.openRange.active
                  ? 'scanner-status-pill is-range'
                  : 'scanner-status-pill'
              }
            >
              {capturing && <span className="scanner-pulse" />}
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
          </div>

          {backendOnline === false && (
            <div className="card scanner-alert">
              <div className="cell scanner-alert-body">
                <p>
                  {t('scanner.statusBackendOffline', { url: scannerBaseUrl })}
                </p>
                <button
                  type="button"
                  className="pill"
                  onClick={() => void initScannerSession()}
                >
                  {t('scanner.actions.retrySession')}
                </button>
              </div>
            </div>
          )}

          {snapshot && snapshot.warnings.length > 0 && (
            <div className="card scanner-warning">
              {snapshot.warnings.slice(-2).map((warn, idx) => (
                <div key={idx} className="cell">
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="cell">
              <span className="cell-name">{t('scanner.counters.scanned')}</span>
              <span className="cell-value">{snapshot?.pagesScanned ?? 0}</span>
            </div>
            <div className="cell">
              <span className="cell-name">{t('scanner.counters.skipped')}</span>
              <span className="cell-value">{snapshot?.pagesSkipped ?? 0}</span>
            </div>
            <div className="cell">
              <span className="cell-name">
                {t('scanner.counters.highlights')}
              </span>
              <span className="cell-value">{totalHighlights}</span>
            </div>
            <div className="cell">
              <span className="cell-name">{t('scanner.counters.chapter')}</span>
              <span className="cell-value">
                {snapshot?.currentChapter || t('scanner.counters.none')}
              </span>
            </div>
          </div>

          <div className="scanner-actions">
            <button
              type="button"
              className="pill"
              disabled={!cameraReady || !backendOnline || capturing}
              onClick={() => void handleManualCapture()}
            >
              {t('scanner.actions.captureNow')}
            </button>

            <button
              type="button"
              className="pill"
              disabled={capturing}
              onClick={() => photoInputRef.current?.click()}
            >
              {t('scanner.actions.pickPhotos')}
            </button>

            <button
              type="button"
              className="pill is-primary scanner-finish-btn"
              onClick={() => void handleFinishScan()}
            >
              {t('scanner.actions.finish')}
            </button>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={e => {
                void handlePickedPhotos(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </>
      ) : (
        <>
          {shelf.length > 0 && (
            <div className="card">
              <div className="cell">
                <div className="segmented">
                  <button
                    type="button"
                    className={destination === 'new' ? 'is-active' : undefined}
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
                  <span className="cell-name">{t('scanner.target.label')}</span>
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
                  onClick={() => coverInputRef.current?.click()}
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
                <div className="cell muted-empty">{t('scanner.draftEmpty')}</div>
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
                                      highlights: item.highlights.map((h, j) =>
                                        j === hIdx ? { ...h, text: val } : h,
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
                                      highlights: item.highlights.map((h, j) =>
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
  );
}
