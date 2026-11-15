import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import {
  EMPTY_BODY,
  type Book,
  type BookBody,
  type Chapter,
  type Highlight,
} from '../books';
import { plural, t } from '../i18n';
import {
  addChapter,
  addHighlight,
  moveChapter,
  moveHighlight,
  removeChapter,
  removeHighlight,
  updateChapter,
  updateHighlight,
} from '../lib/bodyEdits';
import { parsePageRef } from '../lib/bookFields';
import {
  extractChaptersFromToc,
  findHighlightSpan,
  formatPageSpan,
  repairPageNumbers,
  textBetween,
  type Mark,
} from '../lib/photoImport/assemble';
import {
  runPhotoImport,
  type PhotoImportItem,
  type PhotoImportProgress,
} from '../lib/photoImport/client';
import { useBodiesStore } from '../store/bodies';

import { ConfirmDialog, useModalDialog } from './ConfirmDialog';
import {
  BookOpenGlyph,
  CameraGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  ContentsGlyph,
  PlusGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const revokeUrls = (items: PhotoImportItem[]) => {
  for (const it of items) {
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
  }
};

const compareMarks = (a: Mark, b: Mark): number =>
  a.photo !== b.photo ? a.photo - b.photo : a.line - b.line;

const ROW_HOLD_MS = 360;
const ROW_SLOP_PX = 8;

function SortableCardList<T extends { id: string }>({
  items,
  onMove,
  renderRow,
}: {
  items: T[];
  onMove?: (from: number, to: number) => void;
  onPressItem?: (item: T) => void;
  renderRow: (item: T) => ReactNode;
}) {
  const byId = new Map(items.map(item => [item.id, item]));
  const [order, setOrder] = useState<string[] | null>(null);
  const orderRef = useRef<string[] | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const keys = order ?? items.map(item => item.id);

  const list = useRef<HTMLUListElement>(null);
  const swallowClick = useRef(false);
  const slots = useRef(new Map<string, number>());
  const anims = useRef(new Map<string, Animation>());
  const drag = useRef<{
    id: string;
    pointerId: number;
    x0: number;
    y0: number;
    y: number;
    grabY: number;
    height: number;
    timer: ReturnType<typeof setTimeout> | null;
    lifted: boolean;
    from: number;
  } | null>(null);

  const live = items.map(item => item.id).join('|');
  useEffect(() => {
    if (order && !lifted && order.join('|') === live) {
      orderRef.current = null;
      setOrder(null);
    }
  }, [live, order, lifted]);

  const rows = () => [...(list.current?.children ?? [])] as HTMLLIElement[];

  const snapshotSlots = () => {
    slots.current.clear();
    for (const li of rows()) {
      const id = li.dataset.id;
      if (id) slots.current.set(id, li.offsetTop);
    }
  };

  const follow = () => {
    const d = drag.current;
    const host = list.current;
    if (!d?.lifted || !host) return;
    const li = rows().find(el => el.dataset.id === d.id);
    if (!li) return;
    const running = anims.current.get(d.id);
    if (running) {
      running.cancel();
      anims.current.delete(d.id);
    }
    const hostTop = host.getBoundingClientRect().top;
    const slotTop = hostTop + li.offsetTop;
    const dy = d.y - d.grabY - slotTop;
    li.style.transform = `translate3d(0, ${dy}px, 0) scale(1.015)`;
  };

  const retarget = () => {
    const d = drag.current;
    const host = list.current;
    if (!d?.lifted || !host) return;
    const hostTop = host.getBoundingClientRect().top;
    const listRows = rows();
    const to = listRows.findIndex(el => {
      const h = Math.max(el.offsetHeight, d.height);
      const iy = h * 0.15;
      const top = hostTop + el.offsetTop + iy;
      const bottom = hostTop + el.offsetTop + h - iy;
      return d.y >= top && d.y <= bottom;
    });
    if (to === -1) return;
    const current = orderRef.current ?? keys;
    const from = current.indexOf(d.id);
    if (from === -1 || from === to) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, d.id);
    orderRef.current = next;
    flushSync(() => {
      setOrder(next);
    });
  };

  useLayoutEffect(() => {
    const host = list.current;
    if (!host) return;
    if (!drag.current?.lifted) {
      snapshotSlots();
      return;
    }
    const hostTop = host.getBoundingClientRect().top;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const li of rows()) {
      const id = li.dataset.id ?? '';
      const now = li.offsetTop;
      const was = slots.current.get(id);
      slots.current.set(id, now);
      if (was === undefined || id === drag.current.id || reduce) continue;
      let dy = was - now;
      if (!dy) continue;

      const prevAnim = anims.current.get(id);
      if (prevAnim && prevAnim.playState === 'running') {
        const r = li.getBoundingClientRect();
        const ty = r.top - hostTop - now;
        dy = was - now + ty;
        prevAnim.cancel();
      }
      if (!dy) continue;

      const anim = li.animate(
        [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }],
        { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      anim.onfinish = () => {
        if (anims.current.get(id) === anim) anims.current.delete(id);
      };
      anims.current.set(id, anim);
    }
    follow();
  });

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (!d.lifted) return;

    swallowClick.current = true;
    const li = rows().find(el => el.dataset.id === d.id);
    if (li) {
      const from = li.style.transform;
      li.style.transform = '';
      if (from) {
        li.style.zIndex = '5';
        const anim = li.animate([{ transform: from }, { transform: 'none' }], {
          duration: 200,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
        anim.onfinish = () => {
          li.style.zIndex = '';
          if (anims.current.get(d.id) === anim) anims.current.delete(d.id);
        };
        anims.current.set(d.id, anim);
      }
    }
    setLifted(null);

    const final = orderRef.current ?? order ?? keys;
    const to = final.indexOf(d.id);
    if (!commit || to === d.from || !onMove) {
      orderRef.current = null;
      setOrder(null);
      return;
    }
    onMove(d.from, to);
  };

  useEffect(() => {
    if (!onMove) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.y = e.clientY;
      if (!d.lifted) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > ROW_SLOP_PX)
          end(false);
        return;
      }
      e.preventDefault();
      retarget();
      follow();
    };
    const up = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) end(true);
    };
    const cancel = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) end(false);
    };
    const touch = (e: TouchEvent) => {
      if (drag.current?.lifted) e.preventDefault();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touch, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touch);
    };
  });

  const press = (e: React.PointerEvent<HTMLLIElement>, id: string) => {
    if (!onMove || e.button !== 0 || drag.current) return;
    const li = e.currentTarget;
    const r = li.getBoundingClientRect();
    const d = {
      id,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      y: e.clientY,
      grabY: e.clientY - r.top,
      height: r.height,
      timer: null as ReturnType<typeof setTimeout> | null,
      lifted: false,
      from: keys.indexOf(id),
    };
    d.timer = setTimeout(() => {
      d.timer = null;
      snapshotSlots();
      d.lifted = true;
      navigator.vibrate?.(10);
      const initial = [...keys];
      orderRef.current = initial;
      flushSync(() => {
        setOrder(initial);
        setLifted(id);
      });
      follow();
    }, ROW_HOLD_MS);
    drag.current = d;
  };

  return (
    <ul
      ref={list}
      className={
        lifted ? 'card reorder-list is-sorting' : 'card reorder-list'
      }
      onClickCapture={e => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {keys.map(id => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <li
            key={id}
            data-id={id}
            className={
              lifted === id ? 'cell reorder-item is-lifted' : 'cell reorder-item'
            }
            onPointerDown={e => press(e, id)}
          >
            {renderRow(item)}
          </li>
        );
      })}
    </ul>
  );
}

export function ChaptersPanel({
  open,
  switching = false,
  depth = 0,
  index = 0,
  book,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  book: Book;
  onClose: () => void;
}) {
  const ensureBody = useBodiesStore(state => state.ensure);
  const saveBody = useBodiesStore(state => state.save);
  const entry = useBodiesStore(state => state.entries[book.id]);

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<
    | { mode: 'new'; chapterId: string; autoPickPhotos?: boolean }
    | { mode: 'edit'; chapterId: string; highlight: Highlight }
    | null
  >(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<
    string | null
  >(null);
  const [tocProgress, setTocProgress] = useState<PhotoImportProgress | null>(
    null,
  );
  const tocInputRef = useRef<HTMLInputElement | null>(null);

  const { ref: addDialogRef, closing: closingAddDialog } =
    useModalDialog(addingChapter);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  useEffect(() => {
    if (!open) {
      setActiveChapterId(null);
      setEditingHighlight(null);
      setAddingChapter(false);
      setConfirmDeleteChapterId(null);
      setTocProgress(null);
    }
  }, [open, book.id]);

  useEffect(() => {
    if (addingChapter) setNewChapterName('');
  }, [addingChapter]);

  const body: BookBody = entry?.body ?? EMPTY_BODY;
  const activeChapter: Chapter | null =
    body.chapters.find(ch => ch.id === activeChapterId) ?? null;

  const shownChapterRef = useRef<Chapter | null>(null);
  if (activeChapter) shownChapterRef.current = activeChapter;
  const viewChapter = activeChapter ?? shownChapterRef.current;

  const shownHighlightRef = useRef<typeof editingHighlight>(null);
  if (editingHighlight) shownHighlightRef.current = editingHighlight;
  const viewHighlight = editingHighlight ?? shownHighlightRef.current;

  const persist = async (nextBody: BookBody) => {
    try {
      await saveBody(book.id, nextBody);
    } catch (error) {
      console.warn('saveBookBody', error);
      showToast(t('snackbar.notes-save-failed'));
    }
  };

  const handleTocFiles = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    try {
      const items = await runPhotoImport(files, state => setTocProgress(state));
      const detected = extractChaptersFromToc(items.map(it => it.page));
      revokeUrls(items);
      setTocProgress(null);
      if (!detected.length) {
        showToast(t('snackbar.scan-empty'));
        return;
      }
      const existingNames = new Set(
        body.chapters.map(c => c.name.trim().toLowerCase()),
      );
      let nextBody = body;
      let addedCount = 0;
      for (const ch of detected) {
        if (existingNames.has(ch.name.trim().toLowerCase())) continue;
        existingNames.add(ch.name.trim().toLowerCase());
        const id = makeId();
        nextBody = addChapter(nextBody, { id, name: ch.name });
        if (ch.pages) {
          nextBody = updateChapter(nextBody, id, { pages: ch.pages });
        }
        addedCount += 1;
      }
      if (addedCount > 0) {
        await persist(nextBody);
        showToast(t('snackbar.toc-scanned'));
      } else {
        showToast(t('snackbar.toc-scanned'));
      }
    } catch (error) {
      console.warn('scanToc', error);
      setTocProgress(null);
      showToast(t('snackbar.scan-failed'));
    }
  };

  const tocBusy = tocProgress !== null && tocProgress.phase !== 'done';
  const tocPct = tocProgress
    ? tocProgress.phase === 'models'
      ? Math.round(tocProgress.modelProgress * 100)
      : tocProgress.total > 0
        ? Math.round((tocProgress.done / tocProgress.total) * 100)
        : 0
    : 0;

  const childStackDepth =
    (activeChapter ? 1 : 0) + (editingHighlight ? 1 : 0);

  return (
    <>
      <SidePanel
        open={open}
        switching={switching}
        depth={depth + childStackDepth}
        index={index}
        title={t('book.chapters')}
        action={
          <button type="button" className="round" onClick={onClose}>
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        }
        trailing={
          <span className="glass-pill">
            <button
              type="button"
              title={t('chapters.scanToc')}
              disabled={tocBusy}
              onClick={() => tocInputRef.current?.click()}
            >
              <CameraGlyph />
              <span className="sr">{t('chapters.scanToc')}</span>
            </button>
            <button
              type="button"
              title={t('chapters.add')}
              onClick={() => setAddingChapter(true)}
            >
              <PlusGlyph />
              <span className="sr">{t('chapters.add')}</span>
            </button>
          </span>
        }
        onClose={onClose}
      >
        <input
          ref={tocInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            void handleTocFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {tocBusy && tocProgress && (
          <div className="card scanner-progress-box">
            <div className="scanner-progress-track">
              <div
                className="scanner-progress-fill"
                style={{ width: `${Math.max(6, tocPct)}%` }}
              />
            </div>
            <div className="scanner-progress-label">
              {tocProgress.phase === 'queued'
                ? t('highlightEdit.queued')
                : tocProgress.phase === 'models'
                  ? t('highlightEdit.loadingModels', { pct: tocPct })
                  : t('chapters.scanningToc', {
                      done: Math.min(tocProgress.done + 1, tocProgress.total),
                      total: tocProgress.total,
                    })}
            </div>
          </div>
        )}

        {entry?.loading && !entry.loaded ? (
          <div className="card">
            <div className="cell">
              <span className="bone line" />
            </div>
            <div className="cell">
              <span className="bone line short" />
            </div>
          </div>
        ) : body.chapters.length === 0 ? (
          <div className="side-empty is-full">
            <span className="side-empty-mark">
              <ContentsGlyph />
            </span>
            <h3>{t('chapters.empty.title')}</h3>
            <p>{t('chapters.empty.subtitle')}</p>
          </div>
        ) : (
          <SortableCardList
            items={body.chapters}
            onMove={(from, to) => void persist(moveChapter(body, from, to))}
            onPressItem={chapter => setActiveChapterId(chapter.id)}
            renderRow={chapter => {
              const sub = [
                chapter.highlights.length > 0
                  ? plural('book.highlightCount', chapter.highlights.length)
                  : '',
                chapter.pages,
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <button
                  type="button"
                  className="reorder-row-btn"
                  onClick={() => setActiveChapterId(chapter.id)}
                >
                  <span className="reorder-main">
                    <span className="reorder-title">
                      {chapter.name || t('chapters.untitled')}
                    </span>
                    {sub && <span className="reorder-sub">{sub}</span>}
                  </span>
                  <span className="chevron">
                    <ChevronRightGlyph />
                  </span>
                </button>
              );
            }}
          />
        )}
      </SidePanel>

      {viewChapter && (
        <ChapterDetailPanel
          open={open && activeChapter !== null}
          index={index + 1}
          depth={depth + (editingHighlight ? 1 : 0)}
          chapter={viewChapter}
          onUpdateMeta={(fields: Partial<Pick<Chapter, 'name' | 'pages'>>) =>
            void persist(updateChapter(body, viewChapter.id, fields))
          }
          onAddHighlight={autoPickPhotos =>
            setEditingHighlight({
              mode: 'new',
              chapterId: viewChapter.id,
              autoPickPhotos,
            })
          }
          onEditHighlight={hl =>
            setEditingHighlight({
              mode: 'edit',
              chapterId: viewChapter.id,
              highlight: hl,
            })
          }
          onMoveHighlight={(from, to) =>
            void persist(moveHighlight(body, viewChapter.id, from, to))
          }
          onDeleteChapter={() => setConfirmDeleteChapterId(viewChapter.id)}
          onClose={() => setActiveChapterId(null)}
        />
      )}

      {viewHighlight && (
        <HighlightEditorPanel
          open={open && editingHighlight !== null}
          index={index + 2}
          initial={
            viewHighlight.mode === 'edit' ? viewHighlight.highlight : null
          }
          autoPickPhotos={
            viewHighlight.mode === 'new' && Boolean(viewHighlight.autoPickPhotos)
          }
          onSave={({ text, page }) => {
            if (viewHighlight.mode === 'new') {
              void persist(
                addHighlight(body, viewHighlight.chapterId, {
                  id: makeId(),
                  text,
                  page,
                }),
              );
            } else {
              void persist(
                updateHighlight(body, viewHighlight.chapterId, {
                  id: viewHighlight.highlight.id,
                  text,
                  page,
                }),
              );
            }
            setEditingHighlight(null);
          }}
          onDelete={
            viewHighlight.mode === 'edit'
              ? () => {
                  const before = body;
                  void persist(
                    removeHighlight(
                      body,
                      viewHighlight.chapterId,
                      viewHighlight.highlight.id,
                    ),
                  );
                  showToast(t('snackbar.highlight-deleted'), {
                    label: t('common.undo'),
                    onAction: () => void persist(before),
                  });
                  setEditingHighlight(null);
                }
              : undefined
          }
          onClose={() => setEditingHighlight(null)}
        />
      )}

      <dialog
        ref={addDialogRef}
        className={closingAddDialog ? 'confirm is-closing' : 'confirm'}
        onCancel={e => {
          e.preventDefault();
          setAddingChapter(false);
        }}
        onClose={() => {
          if (addingChapter) setAddingChapter(false);
        }}
        onClick={e => e.target === e.currentTarget && setAddingChapter(false)}
      >
        <form
          method="dialog"
          onSubmit={e => {
            e.preventDefault();
            const id = makeId();
            const nextBody = addChapter(body, {
              id,
              name: newChapterName.trim() || t('chapters.untitled'),
            });
            void persist(nextBody);
            setAddingChapter(false);
            setActiveChapterId(id);
          }}
        >
          <h2>{t('chapters.add')}</h2>
          <input
            className="dialog-field"
            value={newChapterName}
            placeholder={t('chapters.newPlaceholder')}
            onChange={e => setNewChapterName(e.target.value)}
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="pill"
              onClick={() => setAddingChapter(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="pill is-primary">
              {t('common.add')}
            </button>
          </div>
        </form>
      </dialog>

      <ConfirmDialog
        open={confirmDeleteChapterId !== null}
        title={t('chapters.deleteConfirm.title')}
        message={t('chapters.deleteConfirm.message')}
        cancel={t('chapters.deleteConfirm.cancel')}
        confirm={t('chapters.deleteConfirm.confirm')}
        onConfirm={() => {
          if (!confirmDeleteChapterId) return;
          if (activeChapterId === confirmDeleteChapterId) {
            setActiveChapterId(null);
          }
          void persist(removeChapter(body, confirmDeleteChapterId));
        }}
        onClose={() => setConfirmDeleteChapterId(null)}
      />
    </>
  );
}

function ChapterDetailPanel({
  open,
  index,
  depth,
  chapter,
  onUpdateMeta,
  onAddHighlight,
  onEditHighlight,
  onMoveHighlight,
  onDeleteChapter,
  onClose,
}: {
  open: boolean;
  index: number;
  depth: number;
  chapter: Chapter;
  onUpdateMeta: (fields: Partial<Pick<Chapter, 'name' | 'pages'>>) => void;
  onAddHighlight: (autoPickPhotos?: boolean) => void;
  onEditHighlight: (highlight: Highlight) => void;
  onMoveHighlight: (from: number, to: number) => void;
  onDeleteChapter: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(chapter.name);
  const [pages, setPages] = useState(chapter.pages);

  useEffect(() => {
    setName(chapter.name);
    setPages(chapter.pages);
  }, [chapter.id, chapter.name, chapter.pages]);

  return (
    <SidePanel
      open={open}
      depth={depth}
      index={index}
      title={chapter.name || t('chapters.untitled')}
      action={
        <button type="button" className="round" onClick={onClose}>
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>
      }
      trailing={
        <span className="glass-pill">
          <button
            type="button"
            title={t('highlightEdit.scanTitle')}
            onClick={() => onAddHighlight(true)}
          >
            <CameraGlyph />
            <span className="sr">{t('highlightEdit.scanTitle')}</span>
          </button>
          <button
            type="button"
            title={t('chapter.add')}
            onClick={() => onAddHighlight(false)}
          >
            <PlusGlyph />
            <span className="sr">{t('chapter.add')}</span>
          </button>
        </span>
      }
      onClose={onClose}
    >
      <div className="card">
        <label className="cell field">
          <input
            value={name}
            placeholder={t('chapter.name')}
            aria-label={t('chapter.name')}
            autoComplete="off"
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() !== chapter.name) {
                onUpdateMeta({ name: name.trim() });
              }
            }}
          />
        </label>
        <label className="cell field">
          <input
            value={pages}
            placeholder={t('chapter.pages')}
            aria-label={t('chapter.pages')}
            autoComplete="off"
            onChange={e => setPages(e.target.value)}
            onBlur={() => {
              const tidy = pages.trim();
              setPages(tidy);
              if (tidy !== chapter.pages) {
                onUpdateMeta({ pages: tidy });
              }
            }}
          />
        </label>
      </div>

      <section>
        <h3 className="section-head split">
          <span>{t('chapter.highlights')}</span>
          <span className="head-value">{chapter.highlights.length}</span>
        </h3>

        {chapter.highlights.length === 0 ? (
          <div className="side-empty">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('chapter.emptyTitle')}</h3>
            <p>{t('chapter.empty')}</p>
          </div>
        ) : (
          <SortableCardList
            items={chapter.highlights}
            onMove={onMoveHighlight}
            onPressItem={onEditHighlight}
            renderRow={hl => (
              <button
                type="button"
                className="highlight-body-btn"
                onClick={() => onEditHighlight(hl)}
              >
                <span className="highlight-quote">“{hl.text}”</span>
                {hl.page && (
                  <span className="highlight-page">
                    {t('chapter.page', { page: hl.page })}
                  </span>
                )}
              </button>
            )}
          />
        )}
      </section>

      <div className="card">
        <button
          type="button"
          className="cell destructive-row"
          onClick={onDeleteChapter}
        >
          {t('chapters.delete')}
        </button>
      </div>
    </SidePanel>
  );
}

function HighlightEditorPanel({
  open,
  index,
  initial,
  autoPickPhotos = false,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  index: number;
  initial: Highlight | null;
  autoPickPhotos?: boolean;
  onSave: (value: { text: string; page: string | null }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [page, setPage] = useState(initial?.page ?? '');
  const [items, setItems] = useState<PhotoImportItem[]>([]);
  const [pageNums, setPageNums] = useState<(number | null)[]>([]);
  const [markRange, setMarkRange] = useState<{ start: Mark; end: Mark } | null>(
    null,
  );
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [tapTarget, setTapTarget] = useState<'start' | 'end'>('start');
  const [progress, setProgress] = useState<PhotoImportProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<PhotoImportItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      revokeUrls(itemsRef.current);
      setItems([]);
      setPageNums([]);
      setMarkRange(null);
      setProgress(null);
      setDragOver(false);
      return;
    }
    setText(initial?.text ?? '');
    setPage(initial?.page ?? '');
  }, [open, initial?.id, initial?.text, initial?.page]);

  useEffect(() => {
    if (open && autoPickPhotos && !initial) {
      const id = window.setTimeout(() => {
        fileInputRef.current?.click();
      }, 180);
      return () => window.clearTimeout(id);
    }
  }, [open, autoPickPhotos, initial]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      revokeUrls(itemsRef.current);
    },
    [],
  );

  const applyRange = (
    loadedItems: PhotoImportItem[],
    nums: (number | null)[],
    nextRange: { start: Mark; end: Mark },
  ) => {
    const pages = loadedItems.map(it => it.page);
    const extracted = textBetween(pages, nextRange.start, nextRange.end);
    const label = formatPageSpan(
      nums[nextRange.start.photo] ?? null,
      nums[nextRange.end.photo] ?? null,
    );
    setMarkRange(nextRange);
    setText(extracted);
    if (label) setPage(label);
  };

  const handlePhotoFiles = async (fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    revokeUrls(itemsRef.current);
    setItems([]);
    setMarkRange(null);
    setActivePhotoIdx(0);

    try {
      const result = await runPhotoImport(
        files,
        state => setProgress(state),
        ac.signal,
      );
      if (ac.signal.aborted) {
        revokeUrls(result);
        return;
      }
      const pages = result.map(it => it.page);
      const nums = repairPageNumbers(pages);
      const span = findHighlightSpan(pages, nums);
      setItems(result);
      setPageNums(nums);
      setProgress(null);
      if (span) {
        applyRange(result, nums, { start: span.start, end: span.end });
        setActivePhotoIdx(span.start.photo);
        setTapTarget(result.length > 1 ? 'end' : 'start');
      } else {
        showToast(t('snackbar.scan-empty'));
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      console.warn('runPhotoImport', error);
      setProgress(null);
      showToast(t('snackbar.scan-failed'));
    }
  };

  const handleTapLine = (photoIdx: number, lineIdx: number) => {
    if (!markRange || !items.length) return;
    const tapped: Mark = { photo: photoIdx, line: lineIdx };
    let nextStart = markRange.start;
    let nextEnd = markRange.end;
    if (tapTarget === 'start') {
      nextStart = tapped;
      if (compareMarks(nextStart, nextEnd) > 0) nextEnd = nextStart;
    } else {
      nextEnd = tapped;
      if (compareMarks(nextEnd, nextStart) < 0) nextStart = nextEnd;
    }
    applyRange(items, pageNums, { start: nextStart, end: nextEnd });
  };

  const scanning = progress !== null && progress.phase !== 'done';
  const pct = progress
    ? progress.phase === 'models'
      ? Math.round(progress.modelProgress * 100)
      : progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : 0
    : 0;

  const activeItem = items[activePhotoIdx] ?? null;
  const valid = text.trim().length > 0;

  return (
    <SidePanel
      open={open}
      index={index}
      title={t(initial ? 'highlightEdit.title' : 'highlightEdit.titleNew')}
      action={
        <button type="button" className="round" onClick={onClose}>
          <CloseGlyph />
          <span className="sr">{t('common.cancel')}</span>
        </button>
      }
      trailing={
        <button
          type="button"
          className="round is-commit"
          disabled={!valid}
          onClick={() =>
            onSave({
              text: text.trim(),
              page: parsePageRef(page),
            })
          }
        >
          <CheckGlyph />
          <span className="sr">
            {t(initial ? 'highlightEdit.saveExisting' : 'highlightEdit.save')}
          </span>
        </button>
      }
      onClose={onClose}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          void handlePhotoFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <section>
        <div className="section-head split">
          <span>{t('highlightEdit.scanTitle')}</span>
          {items.length > 0 && (
            <button
              type="button"
              className="text-action"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('highlightEdit.rescanPhotos')}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div
            className={
              dragOver ? 'scanner-dropzone is-dragover' : 'scanner-dropzone'
            }
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              void handlePhotoFiles(e.dataTransfer.files);
            }}
          >
            <div className="scanner-drop-card">
              <span className="scanner-drop-icon">
                <CameraGlyph />
              </span>
              <h4>{t('highlightEdit.scanTitle')}</h4>
              <p>{t('highlightEdit.scanSubtitle')}</p>
              <div className="scanner-drop-actions">
                <button
                  type="button"
                  className="pill is-primary"
                  disabled={scanning}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <CameraGlyph />
                  <span>{t('highlightEdit.choosePhotos')}</span>
                </button>
              </div>
              {scanning && progress && (
                <div className="scanner-progress-box">
                  <div className="scanner-progress-track">
                    <div
                      className="scanner-progress-fill"
                      style={{ width: `${Math.max(6, pct)}%` }}
                    />
                  </div>
                  <div className="scanner-progress-label">
                    {progress.phase === 'queued'
                      ? t('highlightEdit.queued')
                      : progress.phase === 'models'
                        ? t('highlightEdit.loadingModels', { pct })
                        : t('highlightEdit.readingPages', {
                            done: Math.min(progress.done + 1, progress.total),
                            total: progress.total,
                          })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {items.length > 1 && (
              <div className="scanner-photo-strip">
                {items.map((it, idx) => {
                  const pNum = pageNums[idx];
                  const isMarked =
                    markRange !== null &&
                    (markRange.start.photo === idx ||
                      markRange.end.photo === idx ||
                      it.page.flags.length > 0);
                  const cls = [
                    'scanner-thumb',
                    isMarked ? 'is-marked' : '',
                    activePhotoIdx === idx ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <button
                      key={`${it.file.name}-${idx}`}
                      type="button"
                      className={cls}
                      onClick={() => setActivePhotoIdx(idx)}
                    >
                      <img src={it.previewUrl} alt="" />
                      <span className="scanner-thumb-badge">
                        {pNum !== null
                          ? t('highlightEdit.photoBadgePage', { page: pNum })
                          : `${idx + 1}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeItem && (
              <div className="card scanner-inspector-card">
                <div className="scanner-inspector-bar">
                  <span className="scanner-inspector-title">
                    {pageNums[activePhotoIdx] !== null
                      ? t('highlightEdit.photoBadgePage', {
                          page: pageNums[activePhotoIdx]!,
                        })
                      : t('highlightEdit.photoBadgeIndex', {
                          index: activePhotoIdx + 1,
                        })}
                  </span>
                  <div className="segmented">
                    <button
                      type="button"
                      className={tapTarget === 'start' ? 'is-active' : ''}
                      onClick={() => setTapTarget('start')}
                    >
                      {t('highlightEdit.tapModeStart')}
                    </button>
                    <button
                      type="button"
                      className={tapTarget === 'end' ? 'is-active' : ''}
                      onClick={() => setTapTarget('end')}
                    >
                      {t('highlightEdit.tapModeEnd')}
                    </button>
                  </div>
                </div>

                <div
                  className="scanner-photo-stage"
                  style={{
                    aspectRatio: `${activeItem.page.width} / ${activeItem.page.height}`,
                  }}
                >
                  <img
                    className="scanner-stage-img"
                    src={activeItem.previewUrl}
                    alt=""
                  />
                  <div className="scanner-stage-lines">
                    {activeItem.page.lines.map((line, lIdx) => {
                      const cur: Mark = { photo: activePhotoIdx, line: lIdx };
                      const inRange =
                        markRange !== null &&
                        compareMarks(cur, markRange.start) >= 0 &&
                        compareMarks(cur, markRange.end) <= 0;
                      const isStart =
                        markRange !== null &&
                        markRange.start.photo === activePhotoIdx &&
                        markRange.start.line === lIdx;
                      const isEnd =
                        markRange !== null &&
                        markRange.end.photo === activePhotoIdx &&
                        markRange.end.line === lIdx;
                      const boxCls = [
                        'scanner-line-box',
                        inRange ? 'is-in-range' : '',
                        isStart ? 'is-start' : '',
                        isEnd ? 'is-end' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <button
                          key={lIdx}
                          type="button"
                          className={boxCls}
                          title={line.text}
                          style={{
                            left: `${(line.x1 / activeItem.page.width) * 100}%`,
                            top: `${(line.y1 / activeItem.page.height) * 100}%`,
                            width: `${((line.x2 - line.x1) / activeItem.page.width) * 100}%`,
                            height: `${((line.y2 - line.y1) / activeItem.page.height) * 100}%`,
                          }}
                          onClick={() => handleTapLine(activePhotoIdx, lIdx)}
                        >
                          {isStart && (
                            <span className="scanner-line-tag is-start">
                              {t('highlightEdit.startTag')}
                            </span>
                          )}
                          {isEnd && (
                            <span className="scanner-line-tag is-end">
                              {t('highlightEdit.endTag')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="scanner-tap-hint">{t('highlightEdit.tapHint')}</p>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h3 className="section-head">{t('highlightEdit.text')}</h3>
        <div className="card">
          <div className="cell textarea-cell">
            <textarea
              rows={items.length > 0 || text.length > 240 ? 10 : 6}
              value={text}
              placeholder={t('highlightEdit.textPlaceholder')}
              onChange={e => setText(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="card">
        <label className="cell field">
          <input
            value={page}
            placeholder={t('highlightEdit.page')}
            aria-label={t('highlightEdit.page')}
            autoComplete="off"
            onChange={e => setPage(e.target.value)}
          />
        </label>
      </div>

      {onDelete && (
        <div className="card">
          <button
            type="button"
            className="cell destructive-row"
            onClick={onDelete}
          >
            {t('highlightEdit.delete')}
          </button>
        </div>
      )}
    </SidePanel>
  );
}
