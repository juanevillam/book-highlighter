import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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
  findMarks,
  formatPageSpan,
  repairPageNumbers,
  textBetween,
  type Mark,
} from '../lib/photoImport/assemble';
import { type TocEntry } from '../lib/photoImport/analyze';
import {
  runPhotoImport,
  type PhotoImportItem,
  type PhotoImportProgress,
} from '../lib/photoImport/client';
import { UI_STATE_LAB, useUiStateLab } from '../dev/uiStateLab';
import { useBodiesStore } from '../store/bodies';

import { ConfirmDialog } from './ConfirmDialog';
import {
  BookOpenGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  ContentsGlyph,
  TrashGlyph,
  UploadGlyph,
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

const marksEqual = (
  a: { start: Mark; end: Mark } | null,
  b: { start: Mark; end: Mark } | null,
): boolean =>
  Boolean(
    a &&
      b &&
      a.start.photo === b.start.photo &&
      a.start.line === b.start.line &&
      a.end.photo === b.end.photo &&
      a.end.line === b.end.line,
  );

const LEAVE_MS = 320;

const formatChapterPages = (raw?: string | null): string => {
  const clean = (raw ?? '').trim();
  if (!clean) return '';
  return /[–\-,]/.test(clean)
    ? t('chapters.pageRange', { pages: clean })
    : t('chapters.pageSingle', { page: clean });
};

const RING = 92;
const RING_STROKE = 8.5;

/**
 * The app's circular progress ring (`Trophies.tsx` → `Ring`), reused for
 * photo-upload progress inside `.side-empty.is-full` so Empty → Scanning →
 * Loaded shares the exact same centered container with zero CLS.
 */
function ScanProgressRing({ percent }: { percent: number }) {
  const c = RING / 2;
  const r = (RING - RING_STROKE) / 2;
  const length = 2 * Math.PI * r;
  const clamped = Math.max(0.04, Math.min(1, percent / 100));
  const label = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;

  return (
    <span className="ring scan-ring">
      <svg viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${length * clamped} ${length}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="ring-label">{label}</span>
    </span>
  );
}

const DEMO_TOC_ROWS = [
  { title: 'I. El hijo del brahmán', page: '11', range: '11–24' },
  { title: 'II. Con los samaná', page: '25', range: '25–38' },
  { title: 'III. Gotama', page: '39', range: '39–52' },
  { title: 'IV. Despertar', page: '53', range: '53–68' },
] as const;

function IndexHowStage() {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIdx(prev => (prev + 1) % DEMO_TOC_ROWS.length);
    }, 1850);
    return () => window.clearInterval(id);
  }, []);

  const current = DEMO_TOC_ROWS[stepIdx] ?? DEMO_TOC_ROWS[0];

  return (
    <div className="card how-stage-card" aria-hidden="true">
      <div className="how-book-sheet">
        <div className="how-book-kicker">{t('reader.contents')}</div>
        <div className="how-toc-list">
          <div
            className="how-toc-focus"
            style={{ '--row': stepIdx } as CSSProperties}
          />
          {DEMO_TOC_ROWS.map((row, idx) => (
            <div
              key={row.page}
              className={
                idx === stepIdx ? 'how-toc-row is-active' : 'how-toc-row'
              }
            >
              <span className="how-toc-name">{row.title}</span>
              <span className="how-toc-dots" />
              <span className="how-toc-page">{row.page}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="how-extracted-bar">
        <span className="how-extracted-title">{current.title}</span>
        <span className="how-extracted-badge">
          {formatChapterPages(current.range)}
        </span>
      </div>
    </div>
  );
}

const DEMO_PROSE_LINES = [
  'El arte de la guerra se basa en el engaño.',
  'Por lo tanto, cuando seas capaz de atacar,',
  'aparenta incapacidad; cuando uses tus fuerzas,',
  'aparenta inactividad; cuando estés cerca,',
  'haz creer al enemigo que estás lejos.',
] as const;

function HighlightHowStage() {
  const [mode, setMode] = useState<'pair' | 'l-note'>('pair');

  useEffect(() => {
    const id = window.setInterval(() => {
      setMode(prev => (prev === 'pair' ? 'l-note' : 'pair'));
    }, 2800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="card how-stage-card" aria-hidden="true">
      <div className="how-book-sheet is-prose">
        <div className="how-prose-lines">
          {DEMO_PROSE_LINES.map((line, idx) => {
            const inRange = idx >= 1 && idx <= 3;
            const isStart = idx === 1;
            const isEnd = idx === 3;
            const cls = [
              'how-prose-line',
              inRange ? 'is-in-range' : '',
              isStart ? 'is-start' : '',
              isEnd ? 'is-end' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div key={idx} className={cls}>
                {isStart && (
                  <span
                    className={
                      mode === 'l-note'
                        ? 'how-sticky-note is-l-shape'
                        : 'how-sticky-note is-start'
                    }
                  />
                )}
                {isEnd && mode === 'pair' && (
                  <span className="how-sticky-note is-end" />
                )}
                <span className="how-prose-text">{line}</span>
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
              </div>
            );
          })}
        </div>
        <div className="how-book-folio">183</div>
      </div>

      <div className="how-extracted-bar">
        <span className="how-extracted-title">
          {mode === 'pair'
            ? `${t('highlightEdit.startTag')} + ${t('highlightEdit.endTag')}`
            : 'Sticky L'}
        </span>
        <span className="how-extracted-badge">{formatChapterPages('183')}</span>
      </div>
    </div>
  );
}

/**
 * Stacked `SidePanel` explaining how Index or Highlight photo upload works,
 * carrying the exact same `.side-grabber` drag bar, leading close button, and
 * trailing upload button as `ChapterDetailPanel`.
 */
function HowItWorksPanel({
  open,
  index,
  kind,
  title,
  steps,
  actionLabel,
  onAction,
  onClose,
}: {
  open: boolean;
  index: number;
  kind: 'index' | 'highlight';
  title: string;
  steps: readonly { title: string; body: string }[];
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
}) {
  return (
    <SidePanel
      open={open}
      index={index}
      title={title}
      action={
        <button type="button" className="round" onClick={onClose}>
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>
      }
      trailing={
        <button
          type="button"
          className="round"
          title={actionLabel}
          onClick={() => {
            onClose();
            onAction();
          }}
        >
          <UploadGlyph />
          <span className="sr">{actionLabel}</span>
        </button>
      }
      onClose={onClose}
    >
      {kind === 'index' ? <IndexHowStage /> : <HighlightHowStage />}

      <div className="card how-steps-card">
        <ol className="how-steps">
          {steps.map((step, i) => (
            <li key={i} className="cell how-step">
              <span className="how-step-num">{i + 1}</span>
              <span className="how-step-copy">
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="how-panel-actions">
        <button
          type="button"
          className="pill is-primary"
          onClick={() => {
            onClose();
            onAction();
          }}
        >
          <span>{actionLabel}</span>
        </button>
      </div>
    </SidePanel>
  );
}

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
      {keys.map((id, idx) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <li
            key={id}
            data-id={id}
            style={{ '--i': Math.min(idx, 18) } as CSSProperties}
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
  onSubStackChange,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  book: Book;
  onSubStackChange?: (state: {
    chapterOpen: boolean;
    scannerOpen: boolean;
  }) => void;
  onClose: () => void;
}) {
  const ensureBody = useBodiesStore(state => state.ensure);
  const saveBody = useBodiesStore(state => state.save);
  const entry = useBodiesStore(state => state.entries[book.id]);
  const chaptersLab = useUiStateLab(s => (UI_STATE_LAB ? s.chapters : 'live'));

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<
    | { mode: 'new'; chapterId: string; autoPickPhotos?: boolean }
    | { mode: 'edit'; chapterId: string; highlight: Highlight }
    | null
  >(null);
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<
    string | null
  >(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [tocHowOpen, setTocHowOpen] = useState(false);
  const [tocProgress, setTocProgress] = useState<PhotoImportProgress | null>(
    null,
  );
  const tocInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  useEffect(() => {
    if (!open) {
      setActiveChapterId(null);
      setEditingHighlight(null);
      setConfirmDeleteChapterId(null);
      setConfirmDeleteAll(false);
      setTocHowOpen(false);
      setTocProgress(null);
    }
  }, [open, book.id]);

  const body: BookBody = entry?.body ?? EMPTY_BODY;
  const activeChapter: Chapter | null =
    body.chapters.find(ch => ch.id === activeChapterId) ?? null;

  const [leavingChapter, setLeavingChapter] = useState<Chapter | null>(null);
  useEffect(() => {
    if (activeChapter) {
      setLeavingChapter(activeChapter);
      return;
    }
    const id = window.setTimeout(() => setLeavingChapter(null), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [activeChapter]);
  const viewChapter = activeChapter ?? leavingChapter;

  const [leavingHighlight, setLeavingHighlight] =
    useState<typeof editingHighlight>(null);
  useEffect(() => {
    if (editingHighlight) {
      setLeavingHighlight(editingHighlight);
      return;
    }
    const id = window.setTimeout(() => setLeavingHighlight(null), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [editingHighlight]);
  const viewHighlight = editingHighlight ?? leavingHighlight;

  useEffect(() => {
    onSubStackChange?.({
      chapterOpen: activeChapter !== null,
      scannerOpen: editingHighlight !== null,
    });
  }, [activeChapter, editingHighlight, onSubStackChange]);

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
      const allPages = items.map(it => it.page);
      const indexPages = allPages.filter(p => p.kind === 'index');
      const hasFlaggedPages = allPages.some(
        p => p.kind === 'page' && p.flags.length > 0,
      );
      const tocSourcePages =
        indexPages.length > 0
          ? indexPages
          : hasFlaggedPages
            ? []
            : allPages;
      const detected = tocSourcePages.length
        ? extractChaptersFromToc(tocSourcePages)
        : [];

      let nextBody = body;
      const existingByName = new Map(
        nextBody.chapters.map(c => [c.name.trim().toLowerCase(), c]),
      );
      let addedChapters = 0;
      let updatedChapterMeta = 0;
      for (const ch of detected) {
        const key = ch.name.trim().toLowerCase();
        const existing = existingByName.get(key);
        if (existing) {
          if (ch.pages && !existing.pages?.trim()) {
            nextBody = updateChapter(nextBody, existing.id, { pages: ch.pages });
            updatedChapterMeta += 1;
          }
          continue;
        }
        const id = makeId();
        nextBody = addChapter(nextBody, { id, name: ch.name });
        if (ch.pages) {
          nextBody = updateChapter(nextBody, id, { pages: ch.pages });
        }
        existingByName.set(key, {
          id,
          name: ch.name,
          pages: ch.pages,
          highlights: [],
        });
        addedChapters += 1;
      }

      // If the selection also includes content pages with highlights (or non-TOC pages),
      // extract all highlights and route each one to its matching chapter by page number.
      const contentPages = allPages.filter(p => p.kind === 'page');
      let addedHighlights = 0;
      if (contentPages.length > 0 && (hasFlaggedPages || detected.length === 0)) {
        const chapterToc: TocEntry[] = nextBody.chapters
          .map(c => {
            const m = /^(\d{1,4})/.exec((c.pages ?? '').trim());
            return m ? { title: c.name, page: Number(m[1]) } : null;
          })
          .filter((x): x is TocEntry => x !== null)
          .sort((a, b) => a.page - b.page);

        const nums = repairPageNumbers(allPages, chapterToc);
        const marks = findMarks(allPages, nums);

        for (const m of marks) {
          const text = textBetween(allPages, m.start, m.end);
          if (!text) continue;
          const startNum = nums[m.start.photo] ?? null;
          const endNum = nums[m.end.photo] ?? null;
          const page = formatPageSpan(startNum, endNum) || null;

          let targetChapterId: string | null = null;
          if (startNum !== null && nextBody.chapters.length > 0) {
            const matched = [...nextBody.chapters].reverse().find(c => {
              const mStart = /^(\d{1,4})/.exec((c.pages ?? '').trim());
              return mStart ? Number(mStart[1]) <= startNum : false;
            });
            if (matched) targetChapterId = matched.id;
          }
          if (!targetChapterId) {
            if (nextBody.chapters.length > 0) {
              targetChapterId =
                nextBody.chapters[nextBody.chapters.length - 1].id;
            } else {
              const id = makeId();
              nextBody = addChapter(nextBody, {
                id,
                name: t('chapters.untitled'),
              });
              targetChapterId = id;
              addedChapters += 1;
            }
          }

          nextBody = addHighlight(nextBody, targetChapterId, {
            id: makeId(),
            text,
            page,
          });
          addedHighlights += 1;
        }
      }

      revokeUrls(items);
      setTocProgress(null);

      if (
        addedChapters === 0 &&
        updatedChapterMeta === 0 &&
        addedHighlights === 0
      ) {
        if (detected.length > 0) {
          showToast(t('snackbar.toc-already-loaded'));
        } else {
          showToast(t('snackbar.scan-empty'));
        }
        return;
      }
      await persist(nextBody);
      showToast(
        addedHighlights > 0 && addedChapters === 0
          ? t('snackbar.scan-saved')
          : t('snackbar.toc-scanned'),
      );
    } catch (error) {
      console.warn('scanToc', error);
      setTocProgress(null);
      showToast(t('snackbar.scan-failed'));
    }
  };

  const effectiveTocProgress: PhotoImportProgress | null =
    chaptersLab === 'scanning'
      ? {
          phase: 'reading',
          modelProgress: 1,
          done: 1,
          total: 1,
          percent: 64,
          items: [],
        }
      : tocProgress;

  const tocBusy =
    effectiveTocProgress !== null && effectiveTocProgress.phase !== 'done';
  const tocPct = effectiveTocProgress ? effectiveTocProgress.percent : 0;

  const showChaptersSkeleton =
    chaptersLab === 'skeleton' || (entry?.loading && !entry.loaded);
  const displayedChapters = chaptersLab === 'empty' ? [] : body.chapters;
  const hasChapters =
    displayedChapters.length > 0 && !tocBusy && !showChaptersSkeleton;

  const [leavingTocHow, setLeavingTocHow] = useState(false);
  useEffect(() => {
    if (tocHowOpen) {
      setLeavingTocHow(true);
      return;
    }
    const id = window.setTimeout(() => setLeavingTocHow(false), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [tocHowOpen]);
  const showTocHow = tocHowOpen || leavingTocHow;

  const childStackDepth =
    (activeChapter ? 1 : 0) +
    (editingHighlight ? 1 : 0) +
    (tocHowOpen ? 1 : 0);

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
          hasChapters ? (
            <span className="glass-pill">
              <button
                type="button"
                title={t('chapters.deleteAll')}
                onClick={() => setConfirmDeleteAll(true)}
              >
                <TrashGlyph />
                <span className="sr">{t('chapters.deleteAll')}</span>
              </button>
              <button
                type="button"
                title={t('chapters.scanToc')}
                disabled={tocBusy}
                onClick={() => tocInputRef.current?.click()}
              >
                <UploadGlyph />
                <span className="sr">{t('chapters.scanToc')}</span>
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="round"
              title={t('chapters.scanToc')}
              disabled={tocBusy}
              onClick={() => tocInputRef.current?.click()}
            >
              <UploadGlyph />
              <span className="sr">{t('chapters.scanToc')}</span>
            </button>
          )
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

        {tocBusy && effectiveTocProgress ? (
          <div className="side-empty is-full" role="status" aria-live="polite">
            <ScanProgressRing percent={tocPct} />
            <h3>{t('chapters.scanningToc')}</h3>
          </div>
        ) : showChaptersSkeleton ? (
          <div className="card">
            <div className="cell">
              <span className="bone line" />
            </div>
            <div className="cell">
              <span className="bone line short" />
            </div>
          </div>
        ) : displayedChapters.length === 0 ? (
          <div className="side-empty is-full">
            <span className="side-empty-mark">
              <ContentsGlyph />
            </span>
            <h3>{t('chapters.empty.title')}</h3>
            <p>{t('chapters.empty.subtitle')}</p>
            <button
              type="button"
              className="text-action empty-learn-more"
              onClick={() => setTocHowOpen(true)}
            >
              {t('chapters.howItWorks.action')}
            </button>
            <button
              type="button"
              className="pill is-primary"
              disabled={tocBusy}
              onClick={() => tocInputRef.current?.click()}
            >
              <span>{t('chapters.scanToc')}</span>
            </button>
          </div>
        ) : (
          <SortableCardList
            items={displayedChapters}
            onMove={(from, to) => void persist(moveChapter(body, from, to))}
            onPressItem={chapter => setActiveChapterId(chapter.id)}
            renderRow={chapter => {
              const count = chapter.highlights.length;
              const hlText =
                count > 0
                  ? plural('book.highlightCount', count)
                  : t('chapters.noHighlightsYet');
              const pagesText = formatChapterPages(chapter.pages);

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
                    <span className="reorder-sub">
                      <span
                        className={
                          count > 0
                            ? 'chapter-hl-status is-populated'
                            : 'chapter-hl-status is-empty'
                        }
                      >
                        {hlText}
                      </span>
                      {pagesText && (
                        <span className="chapter-pages-meta">
                          {` · ${pagesText}`}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="chapter-row-trail">
                    {count > 0 && (
                      <span className="chapter-count-pill">{count}</span>
                    )}
                    <span className="chevron">
                      <ChevronRightGlyph />
                    </span>
                  </span>
                </button>
              );
            }}
          />
        )}
      </SidePanel>

      {showTocHow && (
        <HowItWorksPanel
          open={open && tocHowOpen}
          index={index + 1}
          kind="index"
          title={t('chapters.howItWorks.title')}
          steps={[
            {
              title: t('chapters.howItWorks.step1Title'),
              body: t('chapters.howItWorks.step1Body'),
            },
            {
              title: t('chapters.howItWorks.step2Title'),
              body: t('chapters.howItWorks.step2Body'),
            },
            {
              title: t('chapters.howItWorks.step3Title'),
              body: t('chapters.howItWorks.step3Body'),
            },
          ]}
          actionLabel={t('chapters.scanToc')}
          onAction={() => tocInputRef.current?.click()}
          onClose={() => setTocHowOpen(false)}
        />
      )}

      {viewChapter && (
        <ChapterDetailPanel
          open={open && activeChapter !== null}
          index={index + 1}
          depth={depth + (editingHighlight ? 1 : 0)}
          chapter={viewChapter}
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
          onSaveBatch={
            viewHighlight.mode === 'new'
              ? batch => {
                  let nextBody = body;
                  for (const item of batch) {
                    nextBody = addHighlight(nextBody, viewHighlight.chapterId, {
                      id: makeId(),
                      text: item.text,
                      page: item.page,
                    });
                  }
                  void persist(nextBody);
                  setEditingHighlight(null);
                }
              : undefined
          }
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

      <ConfirmDialog
        open={confirmDeleteAll}
        title={t('chapters.deleteAllConfirm.title')}
        message={t('chapters.deleteAllConfirm.message')}
        cancel={t('chapters.deleteAllConfirm.cancel')}
        confirm={t('chapters.deleteAllConfirm.confirm')}
        onConfirm={() => {
          const previous = body;
          setActiveChapterId(null);
          void persist({ ...body, chapters: [] });
          showToast(t('snackbar.chapters-cleared'), {
            label: t('common.undo'),
            onAction: () => void persist(previous),
          });
        }}
        onClose={() => setConfirmDeleteAll(false)}
      />
    </>
  );
}

/**
 * The Chapter sheet's body, matching `ClipsForm.tsx` in Sound Shaper Web:
 * the EMPTY STATE in place of the whole form while there are no highlights,
 * and otherwise the highlights card alone.
 */
function ChapterDetailPanel({
  open,
  index,
  depth,
  chapter,
  onAddHighlight,
  onEditHighlight,
  onMoveHighlight,
  onClose,
}: {
  open: boolean;
  index: number;
  depth: number;
  chapter: Chapter;
  onAddHighlight: (autoPickPhotos?: boolean) => void;
  onEditHighlight: (highlight: Highlight) => void;
  onMoveHighlight: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const chapterLab = useUiStateLab(s => (UI_STATE_LAB ? s.chapter : 'live'));
  const displayedHighlights =
    chapterLab === 'empty' ? [] : chapter.highlights;
  const [howOpen, setHowOpen] = useState(false);
  const [leavingHow, setLeavingHow] = useState(false);

  useEffect(() => {
    if (!open) setHowOpen(false);
  }, [open, chapter.id]);

  useEffect(() => {
    if (howOpen) {
      setLeavingHow(true);
      return;
    }
    const id = window.setTimeout(() => setLeavingHow(false), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [howOpen]);
  const showHow = howOpen || leavingHow;

  return (
    <>
      <SidePanel
        open={open}
        depth={depth + (howOpen ? 1 : 0)}
        index={index}
        title={chapter.name || t('chapters.untitled')}
        action={
          <button type="button" className="round" onClick={onClose}>
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        }
        trailing={
          <button
            type="button"
            className="round"
            title={t('chapter.scan')}
            onClick={() => onAddHighlight(true)}
          >
            <UploadGlyph />
            <span className="sr">{t('chapter.scan')}</span>
          </button>
        }
        onClose={onClose}
      >
        {displayedHighlights.length === 0 ? (
          <div className="side-empty is-full">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('chapter.emptyTitle')}</h3>
            <p>{t('chapter.empty')}</p>
            <button
              type="button"
              className="text-action empty-learn-more"
              onClick={() => setHowOpen(true)}
            >
              {t('highlightEdit.howItWorks.action')}
            </button>
            <button
              type="button"
              className="pill is-primary"
              onClick={() => onAddHighlight(true)}
            >
              <span>{t('chapter.scan')}</span>
            </button>
          </div>
        ) : (
          <SortableCardList
            items={displayedHighlights}
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
                    {formatChapterPages(hl.page)}
                  </span>
                )}
              </button>
            )}
          />
        )}
      </SidePanel>

      {showHow && (
        <HowItWorksPanel
          open={open && howOpen}
          index={index + 1}
          kind="highlight"
          title={t('highlightEdit.howItWorks.title')}
          steps={[
            {
              title: t('highlightEdit.howItWorks.step1Title'),
              body: t('highlightEdit.howItWorks.step1Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step2Title'),
              body: t('highlightEdit.howItWorks.step2Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step3Title'),
              body: t('highlightEdit.howItWorks.step3Body'),
            },
          ]}
          actionLabel={t('chapter.scan')}
          onAction={() => onAddHighlight(true)}
          onClose={() => setHowOpen(false)}
        />
      )}
    </>
  );
}

function HighlightEditorPanel({
  open,
  index,
  initial,
  autoPickPhotos = false,
  onSave,
  onSaveBatch,
  onDelete,
  onClose,
}: {
  open: boolean;
  index: number;
  initial: Highlight | null;
  autoPickPhotos?: boolean;
  onSave: (value: { text: string; page: string | null }) => void;
  onSaveBatch?: (values: { text: string; page: string | null }[]) => void;
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
  const [allMarks, setAllMarks] = useState<{ start: Mark; end: Mark }[]>([]);
  const [autoMarks, setAutoMarks] = useState<{ start: Mark; end: Mark }[]>([]);
  const [activeMarkIdx, setActiveMarkIdx] = useState(0);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [tapTarget, setTapTarget] = useState<'start' | 'end'>('start');
  const [progress, setProgress] = useState<PhotoImportProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [leavingHow, setLeavingHow] = useState(false);

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
      setAllMarks([]);
      setAutoMarks([]);
      setActiveMarkIdx(0);
      setProgress(null);
      setDragOver(false);
      setHowOpen(false);
      return;
    }
    setText(initial?.text ?? '');
    setPage(initial?.page ?? '');
  }, [open, initial?.id, initial?.text, initial?.page]);

  useEffect(() => {
    if (howOpen) {
      setLeavingHow(true);
      return;
    }
    const id = window.setTimeout(() => setLeavingHow(false), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [howOpen]);
  const showHow = howOpen || leavingHow;

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
      const marks = findMarks(pages, nums);
      const span =
        marks.length > 0
          ? { start: marks[0].start, end: marks[0].end }
          : findHighlightSpan(pages, nums);
      const initialMarks =
        marks.length > 0
          ? marks.map(m => ({ start: { ...m.start }, end: { ...m.end } }))
          : span
            ? [{ start: { ...span.start }, end: { ...span.end } }]
            : [];
      setItems(result);
      setPageNums(nums);
      setAllMarks(initialMarks);
      setAutoMarks(
        initialMarks.map(m => ({ start: { ...m.start }, end: { ...m.end } })),
      );
      setActiveMarkIdx(0);
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
    if (allMarks.length > 0) {
      const nextMarks = [...allMarks];
      nextMarks[activeMarkIdx] = { start: nextStart, end: nextEnd };
      setAllMarks(nextMarks);
    }
  };

  const currentAutoMark = autoMarks[activeMarkIdx] ?? null;
  const isModifiedFromAuto =
    currentAutoMark !== null && !marksEqual(markRange, currentAutoMark);

  const handleResetAuto = () => {
    if (!currentAutoMark || !items.length) return;
    const restored = {
      start: { ...currentAutoMark.start },
      end: { ...currentAutoMark.end },
    };
    applyRange(items, pageNums, restored);
    setActivePhotoIdx(restored.start.photo);
    if (allMarks.length > 0) {
      const nextMarks = [...allMarks];
      nextMarks[activeMarkIdx] = restored;
      setAllMarks(nextMarks);
    }
  };

  const scannerLab = useUiStateLab(s => (UI_STATE_LAB ? s.scanner : 'live'));
  const effectiveProgress: PhotoImportProgress | null =
    scannerLab === 'scanning'
      ? {
          phase: 'reading',
          modelProgress: 1,
          done: 1,
          total: 2,
          percent: 64,
          items: [],
        }
      : progress;

  const scanning =
    effectiveProgress !== null && effectiveProgress.phase !== 'done';
  const pct = effectiveProgress ? effectiveProgress.percent : 0;

  const activeItem = items[activePhotoIdx] ?? null;
  const valid = text.trim().length > 0;
  const paragraphs = text
    .split('\n\n')
    .map(p => p.trim())
    .filter(Boolean);

  return (
    <>
      <SidePanel
        open={open}
        depth={howOpen ? 1 : 0}
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
            onClick={() => {
              if (onSaveBatch && allMarks.length > 1) {
                const pages = items.map(it => it.page);
                const batch = allMarks
                  .map((m, idx) => {
                    if (idx === activeMarkIdx) {
                      return {
                        text: text.trim(),
                        page: parsePageRef(page),
                      };
                    }
                    const extracted = textBetween(pages, m.start, m.end).trim();
                    const label = formatPageSpan(
                      pageNums[m.start.photo] ?? null,
                      pageNums[m.end.photo] ?? null,
                    );
                    return {
                      text: extracted,
                      page: parsePageRef(label),
                    };
                  })
                  .filter(b => b.text.length > 0);
                if (batch.length > 0) {
                  onSaveBatch(batch);
                  return;
                }
              }
              onSave({
                text: text.trim(),
                page: parsePageRef(page),
              });
            }}
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

        {scanning && effectiveProgress ? (
          <div className="side-empty is-full" role="status" aria-live="polite">
            <ScanProgressRing percent={pct} />
            <h3>{t('highlightEdit.readingPages')}</h3>
          </div>
        ) : items.length === 0 && !initial ? (
          <div
            className={
              dragOver
                ? 'side-empty is-full is-dragover'
                : 'side-empty is-full'
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
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('highlightEdit.scanTitle')}</h3>
            <p>{t('highlightEdit.scanSubtitle')}</p>
            <button
              type="button"
              className="text-action empty-learn-more"
              onClick={() => setHowOpen(true)}
            >
              {t('highlightEdit.howItWorks.action')}
            </button>
            <button
              type="button"
              className="pill is-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <span>{t('highlightEdit.choosePhotos')}</span>
            </button>
          </div>
        ) : (
          <>
            {items.length > 0 && (
              <section>
                <div className="section-head split">
                  <span>{t('highlightEdit.scanTitle')}</span>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t('highlightEdit.rescanPhotos')}
                  </button>
                </div>

                {allMarks.length > 1 && (
                  <div className="scanner-photo-strip">
                    {allMarks.map((m, mIdx) => {
                      const pSpan = formatPageSpan(
                        pageNums[m.start.photo] ?? null,
                        pageNums[m.end.photo] ?? null,
                      );
                      return (
                        <button
                          key={`mark-${mIdx}`}
                          type="button"
                          className={
                            activeMarkIdx === mIdx ? 'pill is-primary' : 'pill'
                          }
                          onClick={() => {
                            setActiveMarkIdx(mIdx);
                            applyRange(items, pageNums, m);
                            setActivePhotoIdx(m.start.photo);
                          }}
                        >
                          <span>
                            #{mIdx + 1}
                            {pSpan ? ` · ${formatChapterPages(pSpan)}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

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
                      <div className="scanner-inspector-meta">
                        <span className="scanner-inspector-title">
                          {pageNums[activePhotoIdx] !== null
                            ? t('highlightEdit.photoBadgePage', {
                                page: pageNums[activePhotoIdx]!,
                              })
                            : t('highlightEdit.photoBadgeIndex', {
                                index: activePhotoIdx + 1,
                              })}
                        </span>
                        {isModifiedFromAuto && (
                          <button
                            type="button"
                            className="scanner-reset-auto"
                            onClick={handleResetAuto}
                          >
                            {t('highlightEdit.resetAuto')}
                          </button>
                        )}
                      </div>
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
                    <p className="scanner-tap-hint">
                      {t('highlightEdit.tapHint')}
                    </p>
                  </div>
                )}
              </section>
            )}

            {(paragraphs.length > 0 || initial) && (
              <section>
                <div className="section-head split">
                  <span>{t('highlightEdit.text')}</span>
                  <div className="highlight-preview-actions">
                    {page && (
                      <span className="head-value">{formatChapterPages(page)}</span>
                    )}
                    {initial && items.length === 0 && (
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t('highlightEdit.rescanPhotos')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="card highlight-preview-card">
                  {paragraphs.map((para, pIdx) => (
                    <p key={pIdx} className="highlight-preview-para">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            )}

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
          </>
        )}
      </SidePanel>

      {showHow && (
        <HowItWorksPanel
          open={open && howOpen}
          index={index + 1}
          kind="highlight"
          title={t('highlightEdit.howItWorks.title')}
          steps={[
            {
              title: t('highlightEdit.howItWorks.step1Title'),
              body: t('highlightEdit.howItWorks.step1Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step2Title'),
              body: t('highlightEdit.howItWorks.step2Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step3Title'),
              body: t('highlightEdit.howItWorks.step3Body'),
            },
          ]}
          actionLabel={t('highlightEdit.choosePhotos')}
          onAction={() => fileInputRef.current?.click()}
          onClose={() => setHowOpen(false)}
        />
      )}
    </>
  );
}
