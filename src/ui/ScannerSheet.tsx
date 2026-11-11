import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createBook,
  type Book,
  type BookBody,
  type Chapter,
} from '../books';
import { t } from '../i18n';
import { formatYear, parsePageRef } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import {
  assembleBook,
  type Mark,
} from '../lib/photoImport/assemble';
import {
  runPhotoImport,
  type PhotoImportItem,
  type PhotoImportProgress,
} from '../lib/photoImport/client';
import { uploadFailureKey, uploadImage } from '../media';
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

const compareMark = (a: Mark, b: Mark) =>
  a.photo !== b.photo ? a.photo - b.photo : a.line - b.line;

const isMarkInside = (
  m: Mark,
  range: { start: Mark; end: Mark },
): boolean =>
  compareMark(m, range.start) >= 0 && compareMark(m, range.end) <= 0;

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

  const [phase, setPhase] = useState<'pick' | 'review'>('pick');
  const [items, setItems] = useState<PhotoImportItem[]>([]);
  const [progress, setProgress] = useState<PhotoImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Per-photo inspector state
  const [activePhoto, setActivePhoto] = useState(0);
  const [marks, setMarks] = useState<{ start: Mark; end: Mark }[]>([]);
  const [pageNumbers, setPageNumbers] = useState<(number | null)[]>([]);
  const [lineSheet, setLineSheet] = useState<{
    photo: number;
    line: number;
  } | null>(null);

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

  const photosInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const newSeriesDialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<PhotoImportItem[]>([]);
  itemsRef.current = items;

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
      abortRef.current?.abort();
      for (const it of itemsRef.current) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);

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

  const applyAssembled = useCallback(
    (
      nextItems: PhotoImportItem[],
      overrideMarks?: { start: Mark; end: Mark }[],
      populateMeta = false,
    ) => {
      const pages = nextItems.map(it => it.page);
      const draft = assembleBook(
        pages,
        overrideMarks ? { marks: overrideMarks } : undefined,
      );
      setMarks(draft.marks);
      setPageNumbers(draft.pageNumbers);
      setDraftChapters(
        draft.chapters.map(ch => ({
          id: ch.id,
          name: ch.name || t('chapters.untitled'),
          pages: ch.pages,
          highlights: ch.highlights.map(hl => ({
            id: hl.id,
            page: hl.page || null,
            text: hl.text,
          })),
        })),
      );
      if (populateMeta) {
        if (draft.title) setNewTitle(prev => prev || draft.title);
        if (draft.author) setNewAuthor(prev => prev || draft.author);
        if (draft.coverPhoto !== null && nextItems[draft.coverPhoto]) {
          const cf = nextItems[draft.coverPhoto].file;
          setCoverFile(prev => {
            if (prev) return prev;
            return { file: cf, previewUrl: URL.createObjectURL(cf) };
          });
        }
        const firstMarkPhoto = draft.marks[0]?.start.photo ?? 0;
        setActivePhoto(firstMarkPhoto);
      }
    },
    [],
  );

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const raw = Array.from(fileList).filter(f =>
        /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name) ||
        f.type.startsWith('image/'),
      );
      if (raw.length === 0 || busy) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);

      try {
        const imported = await runPhotoImport(
          raw,
          state => setProgress(state),
          ctrl.signal,
        );
        const combined = [...itemsRef.current, ...imported];
        setItems(combined);
        applyAssembled(combined, undefined, true);
        setPhase('review');
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.warn('runPhotoImport failed:', error);
          showToast(t('snackbar.scan-failed'));
        }
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [applyAssembled, busy],
  );

  const handleSetMarkBoundary = useCallback(
    (kind: 'start' | 'end' | 'new' | 'remove', target: Mark) => {
      let next = marks.map(m => ({
        start: { ...m.start },
        end: { ...m.end },
      }));

      const coveringIdx = next.findIndex(m => isMarkInside(target, m));

      if (kind === 'remove') {
        if (coveringIdx >= 0) {
          next.splice(coveringIdx, 1);
        } else {
          const samePhotoIdx = next.findIndex(
            m =>
              m.start.photo === target.photo || m.end.photo === target.photo,
          );
          if (samePhotoIdx >= 0) next.splice(samePhotoIdx, 1);
        }
      } else if (kind === 'new') {
        next.push({ start: { ...target }, end: { ...target } });
      } else if (kind === 'start') {
        if (coveringIdx >= 0) {
          next[coveringIdx].start = { ...target };
          if (compareMark(next[coveringIdx].start, next[coveringIdx].end) > 0) {
            next[coveringIdx].end = { ...target };
          }
        } else {
          // Find closest mark on or after this photo, or last mark
          const afterIdx = next.findIndex(m => compareMark(m.end, target) >= 0);
          if (afterIdx >= 0) {
            next[afterIdx].start = { ...target };
          } else {
            const pageLines = items[target.photo]?.page.lines.length ?? 1;
            next.push({
              start: { ...target },
              end: { photo: target.photo, line: Math.max(target.line, pageLines - 1) },
            });
          }
        }
      } else if (kind === 'end') {
        if (coveringIdx >= 0) {
          next[coveringIdx].end = { ...target };
          if (compareMark(next[coveringIdx].end, next[coveringIdx].start) < 0) {
            next[coveringIdx].start = { ...target };
          }
        } else {
          // Find closest mark starting on or before this target
          let beforeIdx = -1;
          for (let i = next.length - 1; i >= 0; i--) {
            if (compareMark(next[i].start, target) <= 0) {
              beforeIdx = i;
              break;
            }
          }
          if (beforeIdx >= 0) {
            next[beforeIdx].end = { ...target };
          } else {
            next.push({
              start: { photo: target.photo, line: 0 },
              end: { ...target },
            });
          }
        }
      }

      next = next.sort((a, b) => compareMark(a.start, b.start));
      applyAssembled(items, next, false);
    },
    [applyAssembled, items, marks],
  );

  const handleUsePhotoAsCover = useCallback(
    (photoIdx: number) => {
      const it = items[photoIdx];
      if (!it) return;
      const previewUrl = URL.createObjectURL(it.file);
      setCoverFile(prev => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file: it.file, previewUrl };
      });
    },
    [items],
  );

  const totalHighlights = useMemo(
    () =>
      draftChapters.reduce((sum, ch) => sum + ch.highlights.length, 0),
    [draftChapters],
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
        showToast(t('snackbar.book-created'));
        onSaved(bookId);
      } else {
        const existingBody = await ensureBody(selectedBookId);
        const merged = mergeChaptersIntoBody(existingBody, cleanedChapters);
        await saveBody(selectedBookId, merged);
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
  const activeItem = items[activePhoto] ?? null;

  const progressRatio = useMemo(() => {
    if (!progress) return 0;
    if (progress.phase === 'models') return progress.modelProgress * 0.18;
    if (progress.total === 0) return 1;
    return 0.18 + (progress.done / progress.total) * 0.82;
  }, [progress]);

  const photoBadgeLabel = (idx: number): string => {
    const it = items[idx];
    if (!it) return String(idx + 1);
    if (it.page.kind === 'cover') return t('scanner.kindCover');
    if (it.page.kind === 'index') return t('scanner.kindIndex');
    const num = pageNumbers[idx];
    return num !== null && num !== undefined
      ? t('scanner.pageBadge', { page: num })
      : `${idx + 1}`;
  };

  const photoHasHighlight = useCallback(
    (idx: number) =>
      marks.some(m => idx >= m.start.photo && idx <= m.end.photo),
    [marks],
  );

  return (
    <>
      <input
        ref={photosInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFilesSelected(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <SidePanel
        open={open}
        depth={depth + childDepth}
        index={index}
        title={t(phase === 'pick' ? 'scanner.title' : 'scanner.reviewTitle')}
        action={
          phase === 'review' ? (
            <button
              type="button"
              className="round"
              onClick={() => setPhase('pick')}
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
        {phase === 'pick' ? (
          <div
            className={
              dragOver
                ? 'scanner-dropzone is-dragover'
                : 'scanner-dropzone'
            }
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) {
                void handleFilesSelected(e.dataTransfer.files);
              }
            }}
          >
            <div className="scanner-drop-card">
              <span className="side-empty-mark">
                <CameraGlyph />
              </span>
              <h2>{t('scanner.dropTitle')}</h2>
              <p>{t('scanner.dropSubtitle')}</p>

              {busy && progress ? (
                <div className="scanner-progress-box" role="status">
                  <div className="scanner-progress-track">
                    <div
                      className="scanner-progress-fill"
                      style={{
                        width: `${Math.max(4, Math.round(progressRatio * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="scanner-progress-label">
                    {progress.phase === 'models'
                      ? t('scanner.loadingModels', {
                          percent: Math.round(progress.modelProgress * 100),
                        })
                      : t('scanner.readingPhotos', {
                          done: Math.min(progress.done + 1, progress.total),
                          total: progress.total,
                        })}
                  </span>
                </div>
              ) : (
                <div className="scanner-drop-actions">
                  <button
                    type="button"
                    className="pill is-primary"
                    onClick={() => photosInputRef.current?.click()}
                  >
                    {t('scanner.actions.pickPhotos')}
                  </button>
                  {items.length > 0 && (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => setPhase('review')}
                    >
                      {t('scanner.reviewTitle')} ({items.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {items.length > 0 && (
              <section>
                <h3 className="section-head split">
                  <span>{t('scanner.pagesSection')}</span>
                  <span className="head-value">
                    {activePhoto + 1} / {items.length}
                  </span>
                </h3>

                <div className="scanner-photo-strip" role="tablist">
                  {items.map((it, idx) => {
                    const active = idx === activePhoto;
                    const marked = photoHasHighlight(idx);
                    return (
                      <button
                        key={`${it.file.name}-${idx}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={[
                          'scanner-thumb',
                          active ? 'is-active' : '',
                          marked ? 'is-marked' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setActivePhoto(idx)}
                      >
                        <img src={it.previewUrl} alt="" loading="lazy" />
                        <span className="scanner-thumb-badge">
                          {photoBadgeLabel(idx)}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="scanner-thumb is-add"
                    disabled={busy}
                    title={t('scanner.actions.addMorePhotos')}
                    onClick={() => photosInputRef.current?.click()}
                  >
                    <PlusGlyph />
                  </button>
                </div>

                {activeItem && (
                  <div className="card scanner-inspector-card">
                    <div className="scanner-inspector-bar">
                      <button
                        type="button"
                        className="round quiet"
                        disabled={activePhoto <= 0}
                        onClick={() =>
                          setActivePhoto(i => Math.max(0, i - 1))
                        }
                      >
                        <ChevronLeftGlyph />
                      </button>
                      <span className="scanner-inspector-title">
                        {photoBadgeLabel(activePhoto)}
                      </span>
                      {destination === 'new' && (
                        <button
                          type="button"
                          className="text-action scanner-use-cover-btn"
                          onClick={() => handleUsePhotoAsCover(activePhoto)}
                        >
                          {t('scanner.useAsCover')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="round quiet"
                        disabled={activePhoto >= items.length - 1}
                        onClick={() =>
                          setActivePhoto(i =>
                            Math.min(items.length - 1, i + 1),
                          )
                        }
                      >
                        <ChevronRightGlyph />
                      </button>
                    </div>

                    <div
                      className="scanner-photo-stage"
                      style={{
                        aspectRatio: `${activeItem.page.width} / ${activeItem.page.height}`,
                      }}
                    >
                      <img
                        src={activeItem.previewUrl}
                        alt=""
                        className="scanner-stage-img"
                      />
                      <div className="scanner-stage-lines">
                        {activeItem.page.lines.map((ln, lIdx) => {
                          const here: Mark = {
                            photo: activePhoto,
                            line: lIdx,
                          };
                          const inRange = marks.some(m =>
                            isMarkInside(here, m),
                          );
                          const isStart = marks.some(
                            m =>
                              m.start.photo === activePhoto &&
                              m.start.line === lIdx,
                          );
                          const isEnd = marks.some(
                            m =>
                              m.end.photo === activePhoto &&
                              m.end.line === lIdx,
                          );
                          const leftPct =
                            (ln.x1 / activeItem.page.width) * 100;
                          const topPct =
                            (ln.y1 / activeItem.page.height) * 100;
                          const widthPct =
                            ((ln.x2 - ln.x1) / activeItem.page.width) * 100;
                          const heightPct =
                            ((ln.y2 - ln.y1) / activeItem.page.height) * 100;

                          return (
                            <button
                              key={lIdx}
                              type="button"
                              className={[
                                'scanner-line-box',
                                inRange ? 'is-in-range' : '',
                                isStart ? 'is-start' : '',
                                isEnd ? 'is-end' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${widthPct}%`,
                                height: `${heightPct}%`,
                              }}
                              title={ln.text}
                              onClick={() =>
                                setLineSheet({
                                  photo: activePhoto,
                                  line: lIdx,
                                })
                              }
                            >
                              {isStart && (
                                <span className="scanner-line-tag is-start">
                                  {t('scanner.markStart')}
                                </span>
                              )}
                              {isEnd && (
                                <span className="scanner-line-tag is-end">
                                  {t('scanner.markEnd')}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeItem.page.lines.length > 0 && (
                      <p className="scanner-tap-hint">
                        {t('scanner.tapHint')}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            <ActionSheet
              open={lineSheet !== null}
              cancel={t('common.cancel')}
              actions={
                lineSheet
                  ? [
                      {
                        label: t('scanner.setStartHere'),
                        onSelect: () =>
                          handleSetMarkBoundary('start', lineSheet),
                      },
                      {
                        label: t('scanner.setEndHere'),
                        onSelect: () =>
                          handleSetMarkBoundary('end', lineSheet),
                      },
                      {
                        label: t('scanner.newHighlightHere'),
                        onSelect: () =>
                          handleSetMarkBoundary('new', lineSheet),
                      },
                      ...(photoHasHighlight(lineSheet.photo)
                        ? [
                            {
                              label: t('scanner.removeHighlightHere'),
                              destructive: true,
                              onSelect: () =>
                                handleSetMarkBoundary('remove', lineSheet),
                            },
                          ]
                        : []),
                    ]
                  : []
              }
              onClose={() => setLineSheet(null)}
            />

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
