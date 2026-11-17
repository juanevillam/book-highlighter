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
  DEFAULT_COVER_PALETTE,
  hslToCss,
  interpolatePaletteColor,
  useBookCoverPalette,
  type CoverPalette,
} from '../lib/coverPalette';
import {
  extractChaptersFromToc,
  findHighlightSpan,
  findMarks,
  formatPageSpan,
  repairPageNumbers,
  textBetween,
  type Mark,
} from '../lib/photoImport/assemble';
import {
   type PageAnalysis,
  type TocEntry,
} from '../lib/photoImport/analyze';
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
  PencilGlyph,
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

/**
 * Verifies that an analyzed image is an actual book prose page rather than a
 * random non-book photo (shoe, desk, blank wall) or a table of contents.
 */
const isValidBookPage = (p: PageAnalysis): boolean => {
  if (p.kind !== 'page' || p.lines.length < 3) return false;
  let alphaChars = 0;
  let wideLines = 0;
  for (const line of p.lines) {
    const letters = line.text.match(/[A-Za-zÀ-ÿ]/g);
    alphaChars += letters ? letters.length : 0;
    if (line.x2 - line.x1 >= 0.2 * p.width) wideLines += 1;
  }
  return alphaChars >= 40 && wideLines >= 2;
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
  const clamped = Math.max(0, Math.min(1, percent / 100));
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

const LAB_SCAN_PCTS = [24, 58, 86] as const;

function ScanPhaseStatus({
  kind,
  percent,
  isLab = false,
}: {
  kind: 'index' | 'highlight';
  percent: number;
  isLab?: boolean;
}) {
  const [labStep, setLabStep] = useState(0);

  useEffect(() => {
    if (!isLab) return;
    const id = window.setInterval(() => {
      setLabStep(prev => (prev + 1) % LAB_SCAN_PCTS.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [isLab]);

  const effectivePct = isLab ? LAB_SCAN_PCTS[labStep]! : percent;
  const phaseIdx = effectivePct < 36 ? 0 : effectivePct < 74 ? 1 : 2;
  const label =
    kind === 'index'
      ? phaseIdx === 0
        ? t('chapters.scanningTocPhase1')
        : phaseIdx === 1
          ? t('chapters.scanningTocPhase2')
          : t('chapters.scanningTocPhase3')
      : phaseIdx === 0
        ? t('highlightEdit.readingPagesPhase1')
        : phaseIdx === 1
          ? t('highlightEdit.readingPagesPhase2')
          : t('highlightEdit.readingPagesPhase3');

  return (
    <div className="side-empty is-full" role="status" aria-live="polite">
      <ScanProgressRing percent={effectivePct} />
      <h3 key={label} className="scan-phase-title">
        {label}
      </h3>
    </div>
  );
}

const DEMO_TOC_SPANS = [
  { key: 'chapters.howItWorks.demo1', page: '7', range: '7–20' },
  { key: 'chapters.howItWorks.demo2', page: '21', range: '21–34' },
  { key: 'chapters.howItWorks.demo3', page: '35', range: '35–48' },
  { key: 'chapters.howItWorks.demo4', page: '49', range: '49–64' },
  { key: 'chapters.howItWorks.demo5', page: '65', range: '65–82' },
] as const;

const INDEX_BEAT_PCTS = [
  0, 0, 0, 14, 42, 72, 95, 100, 100, 100, 100, 100, 100,
] as const;

function IndexTheaterStage() {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBeat(prev => (prev + 1) % 13);
    }, 860);
    return () => window.clearInterval(id);
  }, []);

  const isSelecting = beat === 0 || beat === 1;
  const isUploading = beat === 2;
  const isFraming = beat <= 2;
  const isScanning = beat >= 3 && beat <= 6;
  const isExtracted = beat >= 7;
  const extractedCount = isExtracted ? Math.min(5, beat - 6) : 0;
  const scanPct = INDEX_BEAT_PCTS[beat] ?? 64;
  const scanPhaseLabel =
    beat <= 3
      ? t('chapters.scanningTocPhase1')
      : beat === 4
        ? t('chapters.scanningTocPhase2')
        : t('chapters.scanningTocPhase3');

  return (
    <div className="how-book-viewport" aria-hidden="true">
      <div
        className={[
          'how-open-page',
          isFraming ? 'is-framing' : '',
          isUploading ? 'is-uploading' : '',
          isScanning ? 'is-scanning' : '',
          isExtracted ? 'is-extracted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="how-page-spine" aria-hidden="true" />
        <span className="how-corner is-tl" />
        <span className="how-corner is-tr" />
        <span className="how-corner is-bl" />
        <span className="how-corner is-br" />

        <div className="how-mini-kicker">{t('reader.contents')}</div>

        <div className="how-mini-toc-scan">
          {DEMO_TOC_SPANS.map((row, idx) => {
            const rowExtracted = isExtracted && idx < extractedCount;
            const cls = [
              'how-mini-toc-line',
              rowExtracted ? 'is-scanned' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={row.page} className={cls}>
                <span className="how-toc-name">{t(row.key)}</span>
                <span className="how-toc-trail">
                  <span className="how-toc-unscanned">
                    <span className="how-toc-dots" />
                    <span className="how-toc-page">{row.page}</span>
                  </span>
                  <span className="how-extracted-badge is-active">
                    {formatChapterPages(row.range)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="how-page-folio">7</div>

        <div
          className={[
            'how-index-picker-bar',
            isSelecting || isUploading ? 'is-visible' : '',
            isUploading ? 'is-pressed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="how-picker-pill">
            <span>{t('chapters.scanToc')}</span>
          </span>
        </div>

        <div
          className={
            isScanning
              ? 'how-index-scan-overlay is-active'
              : 'how-index-scan-overlay'
          }
        >
          <ScanProgressRing percent={scanPct} />
          <span key={scanPhaseLabel} className="how-index-scan-label">
            {scanPhaseLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

const MINI_PROSE = [
  'Mirar al cielo nocturno invita a detenerse.',
  'El espacio siempre me ha fascinado:',
  'al ver lo vasto e infinito que es,',
  'nuestros problemas se vuelven pequeños y la',
  'vida pasa a ser algo para disfrutar y compartir.',
  'Cada estrella guarda su propia historia.',
] as const;

const MINI_L_PROSE = [
  'Cada estrella guarda su propia historia.',
  'Mirar hacia arriba también me despierta',
  'curiosidad por cómo funcionan las cosas y por',
  'todo lo que todavía nos falta por descubrir.',
  'En esta sección comparto algunas de mis imágenes…',
] as const;

function HighlightTheaterStage({ scene }: { scene: number }) {
  if (scene === 0) {
    return (
      <div className="how-book-viewport" aria-hidden="true">
        <div className="how-open-page is-prose-sheet">
          <span className="how-page-spine" aria-hidden="true" />
          <div className="how-callout-row is-top">
            <span className="how-Diagram-pill is-start">
              {t('highlightEdit.howItWorks.twoNoteStart')}
            </span>
          </div>

          <div className="how-mini-prose">
            {MINI_PROSE.map((line, idx) => {
              const inRange = idx >= 1 && idx <= 4;
              const isStart = idx === 1;
              const isMid = idx === 2 || idx === 3;
              const isEnd = idx === 4;
              const isOutside = !inRange;
              const cls = [
                'how-prose-line',
                inRange ? 'is-in-range' : '',
                isStart ? 'is-start' : '',
                isMid ? 'is-mid' : '',
                isEnd ? 'is-end' : '',
                isOutside ? 'is-outside' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div key={idx} className={cls}>
                  {isStart && (
                    <span
                      className="how-sticky-flag is-start"
                      aria-hidden="true"
                    >
                      <span className="how-sticky-arrow">→</span>
                    </span>
                  )}
                  {isEnd && (
                    <span className="how-sticky-flag is-end" aria-hidden="true">
                      <span className="how-sticky-arrow">→</span>
                    </span>
                  )}
                  <span className="how-prose-text">{line}</span>
                </div>
              );
            })}
          </div>

          <div className="how-callout-row is-bottom">
            <span className="how-Diagram-pill is-end">
              {t('highlightEdit.howItWorks.twoNoteEnd')}
            </span>
          </div>

          <div className="how-page-folio">47</div>
        </div>
      </div>
    );
  }

  return (
    <div className="how-book-viewport" aria-hidden="true">
      <div className="how-open-page is-prose-sheet">
        <span className="how-page-spine" aria-hidden="true" />
        <div className="how-callout-row is-top">
          <span className="how-Diagram-pill is-start">
            {t('highlightEdit.howItWorks.lArmCallout')}
          </span>
        </div>

        <div className="how-mini-prose">
          {MINI_L_PROSE.map((line, idx) => {
            const inRange = idx >= 1 && idx <= 3;
            const isStart = idx === 1;
            const isMid = idx === 2;
            const isEnd = idx === 3;
            const isOutside = !inRange;
            const cls = [
              'how-prose-line',
              inRange ? 'is-in-range' : '',
              isStart ? 'is-start' : '',
              isMid ? 'is-mid' : '',
              isEnd ? 'is-end' : '',
              isOutside ? 'is-outside' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={idx} className={cls}>
                {isStart && (
                  <>
                    <span
                      className="how-sticky-flag is-end is-l-vert"
                      aria-hidden="true"
                    />
                    <span
                      className="how-sticky-flag is-start is-l-horiz"
                      aria-hidden="true"
                    >
                      <span className="how-sticky-arrow">→</span>
                    </span>
                  </>
                )}
                <span className="how-prose-text">{line}</span>
              </div>
            );
          })}
        </div>

        <div className="how-callout-row is-bottom">
          <span className="how-Diagram-pill is-end">
            {t('highlightEdit.howItWorks.lAutoCutCallout')}
          </span>
        </div>

        <div className="how-page-folio">48</div>
      </div>
    </div>
  );
}

function paletteToCssVars(palette: CoverPalette): CSSProperties {
  return {
    '--span-start': palette.startCss,
    '--span-mid': palette.midCss,
    '--span-end': palette.endCss,
    '--span-start-ink': palette.startInk,
    '--span-end-ink': palette.endInk,
  } as CSSProperties;
}

/**
 * Stacked `SidePanel` explaining how Index or Highlight photo upload works,
 * featuring one tall multi-scene animation stage on physical book paper and
 * one interactive guide card below it.
 */
function HowItWorksPanel({
  open,
  index,
  kind,
  title,
  scenes,
  steps,
  palette,
  actionLabel,
  onAction,
  onClose,
}: {
  open: boolean;
  index: number;
  kind: 'index' | 'highlight';
  title: string;
  scenes: readonly string[];
  steps: readonly { title: string; body: string }[];
  palette: CoverPalette;
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
}) {
  const [scene, setScene] = useState(0);
  const [pausedUntil, setPausedUntil] = useState(0);
  const sceneCount = scenes.length;

  useEffect(() => {
    if (!open || sceneCount <= 1) {
      setScene(0);
      setPausedUntil(0);
      return;
    }
    const id = window.setInterval(() => {
      if (Date.now() < pausedUntil) return;
      setScene(prev => (prev + 1) % sceneCount);
    }, 11500);
    return () => window.clearInterval(id);
  }, [open, pausedUntil, sceneCount]);

  const pickScene = (idx: number) => {
    setScene(idx);
    setPausedUntil(Date.now() + 24000);
  };

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
      <div className="how-tutorial-layout" style={paletteToCssVars(palette)}>
        {sceneCount > 1 && (
          <div className="segmented how-scene-tabs" role="tablist">
            {scenes.map((label, idx) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={scene === idx}
                className={scene === idx ? 'is-active' : ''}
                onClick={() => pickScene(idx)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {steps[scene] && (
          <div key={scene} className="how-step-header">
            <strong className="how-step-title">{steps[scene].title}</strong>
            <p className="how-step-body">{steps[scene].body}</p>
          </div>
        )}

        {kind === 'index' ? (
          <IndexTheaterStage />
        ) : (
          <>
            <HighlightTheaterStage scene={scene} />
            <div className="how-bulk-callout">
              <p>{t('highlightEdit.howItWorks.bulkNote')}</p>
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
          </>
        )}
      </div>
    </SidePanel>
  );
}

const ROW_HOLD_MS = 360;
const ROW_SLOP_PX = 8;

function SortableCardList<T extends { id: string }>({
  items,
  animateEntrance = false,
  onMove,
  renderRow,
}: {
  items: T[];
  animateEntrance?: boolean;
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

  const listCls = [
    'card',
    'reorder-list',
    lifted ? 'is-sorting' : '',
    animateEntrance ? 'is-entering' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ul
      ref={list}
      className={listCls}
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
            style={
              animateEntrance
                ? ({ '--i': Math.min(idx, 18) } as CSSProperties)
                : undefined
            }
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
  initialOpenFirstChapter = false,
  onReadChapter,
  onSubStackChange,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  book: Book;
  initialOpenFirstChapter?: boolean;
  onReadChapter?: (chapterId: string) => void;
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
  const palette = useBookCoverPalette(book.artUrl, `${book.id}:${book.name}`);

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<
    | { mode: 'new'; chapterId: string; initialFiles?: File[] }
    | { mode: 'edit'; chapterId: string; highlight: Highlight }
    | null
  >(null);
  const [routedBanner, setRoutedBanner] = useState<{
    chapterId: string;
    message: string;
  } | null>(null);
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<
    string | null
  >(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [tocHowOpen, setTocHowOpen] = useState(false);
  const [justScanned, setJustScanned] = useState(false);
  const [justAddedHighlight, setJustAddedHighlight] = useState(false);
  const [tocProgress, setTocProgress] = useState<PhotoImportProgress | null>(
    null,
  );
  const tocInputRef = useRef<HTMLInputElement | null>(null);
  const prevChaptersLab = useRef(chaptersLab);
  const appliedInitialFirstRef = useRef(false);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  useEffect(() => {
    if (!open) {
      setActiveChapterId(null);
      setEditingHighlight(null);
      setRoutedBanner(null);
      setConfirmDeleteChapterId(null);
      setConfirmDeleteAll(false);
      setTocHowOpen(false);
      setJustScanned(false);
      setJustAddedHighlight(false);
      setTocProgress(null);
      appliedInitialFirstRef.current = false;
    }
  }, [open, book.id]);

  useEffect(() => {
    if (
      open &&
      initialOpenFirstChapter &&
      !appliedInitialFirstRef.current &&
      entry?.loaded
    ) {
      appliedInitialFirstRef.current = true;
      const first = entry.body.chapters[0];
      if (first) {
        setActiveChapterId(first.id);
      }
    }
  }, [open, initialOpenFirstChapter, entry?.loaded, entry?.body.chapters]);

  useEffect(() => {
    if (prevChaptersLab.current === 'scanning' && chaptersLab === 'live') {
      setJustScanned(true);
    }
    prevChaptersLab.current = chaptersLab;
  }, [chaptersLab]);

  useEffect(() => {
    if (!justScanned) return;
    const id = window.setTimeout(() => setJustScanned(false), 950);
    return () => window.clearTimeout(id);
  }, [justScanned]);

  useEffect(() => {
    if (!justAddedHighlight) return;
    const id = window.setTimeout(() => setJustAddedHighlight(false), 850);
    return () => window.clearTimeout(id);
  }, [justAddedHighlight]);

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

  const resolveTargetChapterId = (
    pageStr: string | null | undefined,
    fallbackChapterId: string,
  ): string => {
    const clean = (pageStr ?? '').trim();
    const mPage = /^(\d{1,4})/.exec(clean);
    if (!mPage || body.chapters.length === 0) return fallbackChapterId;
    const startNum = Number(mPage[1]);
    for (const ch of body.chapters) {
      const mSpan = /^(\d{1,4})\s*[–\-]\s*(\d{1,4})/.exec(
        (ch.pages ?? '').trim(),
      );
      if (mSpan) {
        const a = Number(mSpan[1]);
        const b = Number(mSpan[2]);
        if (startNum >= a && startNum <= b) return ch.id;
      }
    }
    const matched = [...body.chapters].reverse().find(c => {
      const mStart = /^(\d{1,4})/.exec((c.pages ?? '').trim());
      return mStart ? Number(mStart[1]) <= startNum : false;
    });
    return matched ? matched.id : fallbackChapterId;
  };

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

      // If the user selected the index photo together with sticky-flagged book pages in one batch,
      // route each marked highlight to its matching chapter by page number.
      // Never extract unflagged or non-book pages here (e.g. a random photo of a shoe).
      const contentPages = allPages.filter(p => isValidBookPage(p));
      let addedHighlights = 0;
      if (
        contentPages.length > 0 &&
        hasFlaggedPages &&
        (detected.length > 0 || body.chapters.length > 0)
      ) {
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
          if (!targetChapterId && nextBody.chapters.length > 0) {
            targetChapterId =
              nextBody.chapters[nextBody.chapters.length - 1].id;
          }
          if (!targetChapterId) continue;

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
          showToast(t('snackbar.not-an-index'));
        }
        return;
      }
      if (addedChapters > 0) setJustScanned(true);
      if (addedHighlights > 0) setJustAddedHighlight(true);
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
          <ScanPhaseStatus
            kind="index"
            percent={tocPct}
            isLab={chaptersLab === 'scanning'}
          />
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
          <div className="chapters-populated-stack">
            {routedBanner && (
              <div className="chapter-routed-banner" role="status">
                <span className="chapter-routed-icon" aria-hidden="true">
                  <ContentsGlyph />
                </span>
                <p className="chapter-routed-text">{routedBanner.message}</p>
                <button
                  type="button"
                  className="round chapter-routed-dismiss"
                  onClick={() => setRoutedBanner(null)}
                >
                  <CloseGlyph />
                  <span className="sr">{t('common.close')}</span>
                </button>
              </div>
            )}

            {displayedChapters.every(ch => ch.highlights.length === 0) && (
              <div className="card chapters-empty-hl-callout">
                <p className="chapters-callout-text">
                  {t('chapters.noHighlightsCallout')}
                </p>
                <button
                  type="button"
                  className="pill is-primary"
                  onClick={() => {
                    const first = displayedChapters[0];
                    if (first) setActiveChapterId(first.id);
                  }}
                >
                  <span>{t('chapters.noHighlightsAction')}</span>
                </button>
              </div>
            )}

            <SortableCardList
              items={displayedChapters}
              animateEntrance={justScanned}
              onMove={(from, to) => void persist(moveChapter(body, from, to))}
              onPressItem={chapter => setActiveChapterId(chapter.id)}
              renderRow={chapter => {
                const count = chapter.highlights.length;
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
                      {pagesText && (
                        <span className="reorder-sub">{pagesText}</span>
                      )}
                    </span>
                    <span className="chapter-row-trail">
                      {count > 0 && (
                        <span className="chapter-count-pill">
                          {plural('book.highlightCount', count)}
                        </span>
                      )}
                      <span className="chevron">
                        <ChevronRightGlyph />
                      </span>
                    </span>
                  </button>
                );
              }}
            />
          </div>
        )}
      </SidePanel>

      {showTocHow && (
        <HowItWorksPanel
          open={open && tocHowOpen}
          index={index + 1}
          kind="index"
          title={t('chapters.howItWorks.title')}
          scenes={[]}
          steps={[
            {
              title: t('chapters.howItWorks.step1Title'),
              body: t('chapters.howItWorks.step1Body'),
            },
          ]}
          palette={DEFAULT_COVER_PALETTE}
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
          palette={palette}
          animateEntrance={justAddedHighlight}
          routedNotice={routedBanner ? routedBanner.message : null}
          onDismissRoutedNotice={() => setRoutedBanner(null)}
          onReadChapter={
            onReadChapter ? () => onReadChapter(viewChapter.id) : undefined
          }
          onAddHighlight={initialFiles =>
            setEditingHighlight({
              mode: 'new',
              chapterId: viewChapter.id,
              initialFiles,
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
          onClose={() => {
            setActiveChapterId(null);
          }}
        />
      )}

      {viewHighlight && (
        <HighlightEditorPanel
          open={open && editingHighlight !== null}
          index={index + 2}
          palette={palette}
          initial={
            viewHighlight.mode === 'edit' ? viewHighlight.highlight : null
          }
          initialFiles={
            viewHighlight.mode === 'new'
              ? viewHighlight.initialFiles
              : undefined
          }
          onSave={({ text, page }) => {
            if (viewHighlight.mode === 'new') {
              const targetChapterId = resolveTargetChapterId(
                page,
                viewHighlight.chapterId,
              );
              setJustAddedHighlight(true);
              if (targetChapterId !== viewHighlight.chapterId) {
                const fromCh = body.chapters.find(
                  c => c.id === viewHighlight.chapterId,
                );
                const targetCh = body.chapters.find(
                  c => c.id === targetChapterId,
                );
                setActiveChapterId(targetChapterId);
                if (targetCh) {
                  const fromLabel = fromCh?.name || t('chapters.untitled');
                  const toLabel = targetCh.name || t('chapters.untitled');
                  const cleanText = text.trim().replace(/\s+/g, ' ');
                  const snippet =
                    cleanText.length > 44
                      ? `${cleanText.slice(0, 44)}…`
                      : cleanText;
                  setRoutedBanner({
                    chapterId: targetChapterId,
                    message: t('chapter.routedNotice', {
                      snippet,
                      from: fromLabel,
                      to: toLabel,
                    }),
                  });
                  showToast(
                    t('snackbar.highlight-routed', {
                      from: fromLabel,
                      chapter: toLabel,
                    }),
                  );
                }
              } else {
                setRoutedBanner(null);
              }
              void persist(
                addHighlight(body, targetChapterId, {
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
                  setJustAddedHighlight(true);
                  let nextBody = body;
                  let lastTargetId = viewHighlight.chapterId;
                  const countsByChapterId = new Map<string, number>();
                  for (const item of batch) {
                    const targetChapterId = resolveTargetChapterId(
                      item.page,
                      viewHighlight.chapterId,
                    );
                    lastTargetId = targetChapterId;
                    countsByChapterId.set(
                      targetChapterId,
                      (countsByChapterId.get(targetChapterId) ?? 0) + 1,
                    );
                    nextBody = addHighlight(nextBody, targetChapterId, {
                      id: makeId(),
                      text: item.text,
                      page: item.page,
                    });
                  }
                  const routedElsewhere =
                    countsByChapterId.size > 1 ||
                    !countsByChapterId.has(viewHighlight.chapterId);
                  if (routedElsewhere) {
                    const fromCh = body.chapters.find(
                      c => c.id === viewHighlight.chapterId,
                    );
                    const fromLabel = fromCh?.name || t('chapters.untitled');
                    const summaryParts: string[] = [];
                    for (const [chId, count] of countsByChapterId.entries()) {
                      const ch = body.chapters.find(c => c.id === chId);
                      const chName = ch?.name || t('chapters.untitled');
                      summaryParts.push(
                        t('chapter.routedBatchItem', {
                          count,
                          chapter: chName,
                        }),
                      );
                    }
                    const summary = summaryParts.join(', ');
                    setActiveChapterId(lastTargetId);
                    setRoutedBanner({
                      chapterId: lastTargetId,
                      message:
                        batch.length === 1
                          ? t('chapter.routedNotice', {
                              snippet:
                                batch[0].text.trim().length > 44
                                  ? `${batch[0].text.trim().slice(0, 44)}…`
                                  : batch[0].text.trim(),
                              from: fromLabel,
                              to:
                                body.chapters.find(c => c.id === lastTargetId)
                                  ?.name || t('chapters.untitled'),
                            })
                          : t('chapter.routedBatchNotice', {
                              from: fromLabel,
                              summary,
                            }),
                    });
                    showToast(
                      t('chapter.routedBatchNotice', {
                        from: fromLabel,
                        summary,
                      }),
                    );
                  } else {
                    setRoutedBanner(null);
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
  palette,
  animateEntrance = false,
  routedNotice,
  onDismissRoutedNotice,
  onReadChapter,
  onAddHighlight,
  onEditHighlight,
  onMoveHighlight,
  onClose,
}: {
  open: boolean;
  index: number;
  depth: number;
  chapter: Chapter;
  palette: CoverPalette;
  animateEntrance?: boolean;
  routedNotice?: string | null;
  onDismissRoutedNotice?: () => void;
  onReadChapter?: () => void;
  onAddHighlight: (initialFiles?: File[]) => void;
  onEditHighlight: (highlight: Highlight) => void;
  onMoveHighlight: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const chapterLab = useUiStateLab(s => (UI_STATE_LAB ? s.chapter : 'live'));
  const displayedHighlights =
    chapterLab === 'empty' ? [] : chapter.highlights;
  const hasHighlights = displayedHighlights.length > 0;
  const [howOpen, setHowOpen] = useState(false);
  const [leavingHow, setLeavingHow] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

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
          hasHighlights && onReadChapter ? (
            <span className="glass-pill">
              <button
                type="button"
                title={t('chapter.readChapter')}
                onClick={onReadChapter}
              >
                <BookOpenGlyph />
                <span className="sr">{t('chapter.readChapter')}</span>
              </button>
              <button
                type="button"
                title={t('chapter.scan')}
                onClick={() => photoInputRef.current?.click()}
              >
                <UploadGlyph />
                <span className="sr">{t('chapter.scan')}</span>
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="round"
              title={t('chapter.scan')}
              onClick={() => photoInputRef.current?.click()}
            >
              <UploadGlyph />
              <span className="sr">{t('chapter.scan')}</span>
            </button>
          )
        }
        onClose={onClose}
      >
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (files.length > 0) {
              onAddHighlight(files);
            }
          }}
        />

        {chapterLab === 'scanning' ? (
          <ScanPhaseStatus kind="highlight" percent={64} isLab />
        ) : displayedHighlights.length === 0 ? (
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
              onClick={() => photoInputRef.current?.click()}
            >
              <span>{t('chapter.scan')}</span>
            </button>
          </div>
        ) : (
          <div className="chapters-populated-stack">
            {routedNotice && (
              <div className="chapter-routed-banner" role="status">
                <span className="chapter-routed-icon" aria-hidden="true">
                  <ContentsGlyph />
                </span>
                <p className="chapter-routed-text">{routedNotice}</p>
                {onDismissRoutedNotice && (
                  <button
                    type="button"
                    className="round chapter-routed-dismiss"
                    onClick={onDismissRoutedNotice}
                  >
                    <CloseGlyph />
                    <span className="sr">{t('common.close')}</span>
                  </button>
                )}
              </div>
            )}

            <SortableCardList
              items={displayedHighlights}
              animateEntrance={animateEntrance}
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

            {onReadChapter && (
              <div className="chapter-read-actions">
                <button
                  type="button"
                  className="pill is-primary chapter-read-pill"
                  onClick={onReadChapter}
                >
                  <BookOpenGlyph />
                  <span>{t('chapter.readChapter')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </SidePanel>

      {showHow && (
        <HowItWorksPanel
          open={open && howOpen}
          index={index + 1}
          kind="highlight"
          title={t('highlightEdit.howItWorks.title')}
          scenes={[
            t('highlightEdit.howItWorks.scene1'),
            t('highlightEdit.howItWorks.scene2'),
          ]}
          steps={[
            {
              title: t('highlightEdit.howItWorks.step1Title'),
              body: t('highlightEdit.howItWorks.step1Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step2Title'),
              body: t('highlightEdit.howItWorks.step2Body'),
            },
          ]}
          palette={palette}
          actionLabel={t('chapter.scan')}
          onAction={() => photoInputRef.current?.click()}
          onClose={() => setHowOpen(false)}
        />
      )}
    </>
  );
}

function HighlightEditorPanel({
  open,
  index,
  palette,
  initial,
  initialFiles,
  onSave,
  onSaveBatch,
  onDelete,
  onClose,
}: {
  open: boolean;
  index: number;
  palette: CoverPalette;
  initial: Highlight | null;
  initialFiles?: File[];
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
  const [justLoadedScan, setJustLoadedScan] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [leavingHow, setLeavingHow] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const marksStripRef = useRef<HTMLDivElement | null>(null);
  const photoStripRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<PhotoImportItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    const strip = photoStripRef.current;
    if (!strip) return;
    const activeBtn = strip.children[activePhotoIdx] as HTMLElement | undefined;
    activeBtn?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [activePhotoIdx, items.length]);

  useEffect(() => {
    const strip = marksStripRef.current;
    if (!strip) return;
    const activeBtn = strip.children[activeMarkIdx] as HTMLElement | undefined;
    activeBtn?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [activeMarkIdx, allMarks.length]);

  useLayoutEffect(() => {
    if (!isEditingText) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  }, [isEditingText, text]);

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
      setJustLoadedScan(false);
      setIsEditingText(false);
      setConfirmDeleteOpen(false);
      setDragOver(false);
      setHowOpen(false);
      return;
    }
    setText(initial?.text ?? '');
    setPage(initial?.page ?? '');
    setIsEditingText(false);
    setConfirmDeleteOpen(false);
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
    if (open && initialFiles && initialFiles.length > 0 && !initial) {
      void handlePhotoFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

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
      const validItems = result.filter(it => isValidBookPage(it.page));
      const rejectedItems = result.filter(it => !isValidBookPage(it.page));
      revokeUrls(rejectedItems);

      if (validItems.length === 0) {
        setProgress(null);
        const hadIndex = result.some(it => it.page.kind === 'index');
        showToast(
          t(hadIndex ? 'snackbar.index-in-highlight' : 'snackbar.not-a-book-page'),
        );
        if (!initial) onClose();
        return;
      }

      const pages = validItems.map(it => it.page);
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
      setItems(validItems);
      setPageNums(nums);
      setAllMarks(initialMarks);
      setAutoMarks(
        initialMarks.map(m => ({ start: { ...m.start }, end: { ...m.end } })),
      );
      setActiveMarkIdx(0);
      setProgress(null);
      setJustLoadedScan(true);
      if (span) {
        applyRange(validItems, nums, { start: span.start, end: span.end });
        setActivePhotoIdx(span.start.photo);
        setTapTarget('start');
      } else {
        showToast(t('snackbar.not-a-book-page'));
        if (!initial) onClose();
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
  const isReadView = Boolean(initial && items.length === 0 && !isEditingText);

  const commitSave = () => {
    if (onSaveBatch && allMarks.length > 1 && items.length > 0) {
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
  };

  return (
    <>
      <SidePanel
        open={open}
        depth={howOpen ? 1 : 0}
        index={index}
        title={t(
          initial
            ? isEditingText
              ? 'highlightEdit.titleEdit'
              : 'highlightEdit.title'
            : 'highlightEdit.titleNew',
        )}
        action={
          <button
            type="button"
            className="round"
            onClick={() => {
              if (initial && isEditingText) {
                setText(initial.text);
                setPage(initial.page ?? '');
                setIsEditingText(false);
                return;
              }
              onClose();
            }}
          >
            <CloseGlyph />
            <span className="sr">{t('common.cancel')}</span>
          </button>
        }
        trailing={
          isReadView ? (
            <span className="glass-pill">
              {onDelete && (
                <button
                  type="button"
                  title={t('highlightEdit.delete')}
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <TrashGlyph />
                  <span className="sr">{t('highlightEdit.delete')}</span>
                </button>
              )}
              <button
                type="button"
                title={t('common.edit')}
                onClick={() => setIsEditingText(true)}
              >
                <PencilGlyph />
                <span className="sr">{t('common.edit')}</span>
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="round is-commit"
              disabled={!valid}
              onClick={commitSave}
            >
              <CheckGlyph />
              <span className="sr">
                {t(initial ? 'highlightEdit.saveExisting' : 'highlightEdit.save')}
              </span>
            </button>
          )
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
          <ScanPhaseStatus
            kind="highlight"
            percent={pct}
            isLab={scannerLab === 'scanning'}
          />
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
              <section
                className={
                  justLoadedScan
                    ? 'scanner-section is-entering'
                    : 'scanner-section'
                }
                style={paletteToCssVars(palette)}
              >
                {allMarks.length > 1 && (
                  <div
                    ref={marksStripRef}
                    className="scanner-photo-strip is-marks"
                  >
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
                            activeMarkIdx === mIdx
                              ? 'pill is-primary scanner-mark-pill'
                              : 'pill scanner-mark-pill'
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
                  <div ref={photoStripRef} className="scanner-photo-strip">
                    {items.map((it, idx) => {
                      const pNum = pageNums[idx];
                      const inSpan =
                        markRange !== null &&
                        idx >= markRange.start.photo &&
                        idx <= markRange.end.photo;
                      const isStartPage =
                        markRange !== null && idx === markRange.start.photo;
                      const isEndPage =
                        markRange !== null && idx === markRange.end.photo;
                      const ownerMarkIdx =
                        !inSpan && allMarks.length > 1
                          ? allMarks.findIndex(
                              m =>
                                idx >= m.start.photo && idx <= m.end.photo,
                            )
                          : -1;
                      const spanCls =
                        isStartPage && isEndPage
                          ? 'is-span-both'
                          : isStartPage
                            ? 'is-span-start'
                            : isEndPage
                              ? 'is-span-end'
                              : inSpan
                                ? 'is-span-mid'
                                : ownerMarkIdx !== -1
                                  ? 'is-other-mark'
                                  : '';
                      const spanPages =
                        markRange !== null
                          ? markRange.end.photo - markRange.start.photo
                          : 0;
                      const tPage =
                        inSpan && markRange !== null && spanPages > 0
                          ? (idx - markRange.start.photo) / spanPages
                          : 0.5;
                      const thumbColor = inSpan
                        ? hslToCss(interpolatePaletteColor(palette, tPage))
                        : undefined;
                      const thumbStyle: CSSProperties = {
                        '--i': idx,
                        ...(thumbColor ? { '--thumb-edge': thumbColor } : {}),
                      } as CSSProperties;
                      const cls = [
                        'scanner-thumb',
                        spanCls,
                        activePhotoIdx === idx ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <button
                          key={`${it.file.name}-${idx}`}
                          type="button"
                          className={cls}
                          style={thumbStyle}
                          onClick={() => {
                            if (
                              !inSpan &&
                              ownerMarkIdx !== -1 &&
                              allMarks[ownerMarkIdx]
                            ) {
                              const nextM = allMarks[ownerMarkIdx]!;
                              setActiveMarkIdx(ownerMarkIdx);
                              applyRange(items, pageNums, nextM);
                            }
                            setActivePhotoIdx(idx);
                          }}
                        >
                          <img src={it.previewUrl} alt="" />
                          {allMarks.length > 1 &&
                            (inSpan || ownerMarkIdx !== -1) && (
                              <span className="scanner-thumb-mark-tag">
                                #
                                {(inSpan ? activeMarkIdx : ownerMarkIdx) + 1}
                              </span>
                            )}
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
                      <div className="segmented scanner-mode-picker">
                        <button
                          type="button"
                          className={
                            tapTarget === 'start'
                              ? 'is-active is-start-mode'
                              : 'is-start-mode'
                          }
                          onClick={() => {
                            setTapTarget('start');
                            if (markRange) {
                              setActivePhotoIdx(markRange.start.photo);
                            }
                          }}
                        >
                          <span className="scanner-mode-dot is-start" />
                          <span>{t('highlightEdit.tapModeStart')}</span>
                        </button>
                        <button
                          type="button"
                          className={
                            tapTarget === 'end'
                              ? 'is-active is-end-mode'
                              : 'is-end-mode'
                          }
                          onClick={() => {
                            setTapTarget('end');
                            if (markRange) {
                              setActivePhotoIdx(markRange.end.photo);
                            }
                          }}
                        >
                          <span className="scanner-mode-dot is-end" />
                          <span>{t('highlightEdit.tapModeEnd')}</span>
                        </button>
                      </div>
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
                        <button
                          type="button"
                          className={
                            isModifiedFromAuto
                              ? 'scanner-reset-auto is-shown'
                              : 'scanner-reset-auto'
                          }
                          tabIndex={isModifiedFromAuto ? 0 : -1}
                          aria-hidden={!isModifiedFromAuto}
                          onClick={handleResetAuto}
                        >
                          {t('highlightEdit.resetAuto')}
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
                        {(() => {
                          // Count total lines across the entire highlight span so tLine ∈ [0, 1]
                          // transitions smoothly from Start color to End color across 1, 2, or N pages.
                          let totalSpanLines = 0;
                          let offsetBeforeActive = 0;
                          if (markRange) {
                            for (
                              let p = markRange.start.photo;
                              p <= markRange.end.photo;
                              p += 1
                            ) {
                              const pLines = items[p]?.page.lines.length ?? 0;
                              const firstL =
                                p === markRange.start.photo
                                  ? markRange.start.line
                                  : 0;
                              const lastL =
                                p === markRange.end.photo
                                  ? markRange.end.line
                                  : Math.max(0, pLines - 1);
                              const count = Math.max(0, lastL - firstL + 1);
                              if (p < activePhotoIdx) {
                                offsetBeforeActive += count;
                              }
                              totalSpanLines += count;
                            }
                          }

                          return activeItem.page.lines.map((line, lIdx) => {
                            const cur: Mark = {
                              photo: activePhotoIdx,
                              line: lIdx,
                            };
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
                            const isMid = inRange && !isStart && !isEnd;

                            let lineVars: CSSProperties | undefined;
                            if (inRange && markRange) {
                              const firstLOnActive =
                                activePhotoIdx === markRange.start.photo
                                  ? markRange.start.line
                                  : 0;
                              const globalPos =
                                offsetBeforeActive + (lIdx - firstLOnActive);
                              const tLine =
                                totalSpanLines <= 1
                                  ? isStart
                                    ? 0
                                    : 1
                                  : globalPos / (totalSpanLines - 1);
                              const hsl = interpolatePaletteColor(
                                palette,
                                tLine,
                              );
                              lineVars = {
                                '--line-fill': hslToCss(hsl, 0.24),
                                '--line-fill-hover': hslToCss(hsl, 0.36),
                                '--line-edge': hslToCss(hsl, 0.52),
                              } as CSSProperties;
                            }

                            const boxCls = [
                              'scanner-line-box',
                              inRange ? 'is-in-range' : '',
                              isStart ? 'is-start' : '',
                              isMid ? 'is-mid' : '',
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
                                  ...lineVars,
                                }}
                                onClick={() =>
                                  handleTapLine(activePhotoIdx, lIdx)
                                }
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
                          });
                        })()}
                      </div>
                    </div>
                    <p className="scanner-tap-hint">
                      {t('highlightEdit.tapHint')}
                    </p>
                  </div>
                )}
              </section>
            )}

            {initial && items.length === 0 && !isEditingText && (
              <section>
                <div className="section-head">
                  <span>
                    {t('highlightEdit.text')}
                    {page ? ` · ${formatChapterPages(page)}` : ''}
                  </span>
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

            {initial && items.length === 0 && isEditingText && (
              <>
                <div className="card">
                  <label className="cell field">
                    <span className="cell-name">{t('highlightEdit.page')}</span>
                    <input
                      type="text"
                      value={page}
                      placeholder={t('highlightEdit.pagePlaceholder')}
                      onChange={e => setPage(e.target.value)}
                    />
                  </label>
                </div>

                <section>
                  <div className="section-head">
                    <span>{t('highlightEdit.text')}</span>
                  </div>
                  <div className="card">
                    <label className="cell textarea-cell is-autosize">
                      <textarea
                        ref={textareaRef}
                        value={text}
                        rows={4}
                        placeholder={t('highlightEdit.textPlaceholder')}
                        onChange={e => setText(e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </SidePanel>

      {onDelete && (
        <ConfirmDialog
          open={confirmDeleteOpen}
          title={t('highlightEdit.deleteConfirm.title')}
          message={t('highlightEdit.deleteConfirm.message')}
          cancel={t('highlightEdit.deleteConfirm.cancel')}
          confirm={t('highlightEdit.deleteConfirm.confirm')}
          onConfirm={() => {
            setConfirmDeleteOpen(false);
            onDelete();
          }}
          onClose={() => setConfirmDeleteOpen(false)}
        />
      )}

      {showHow && (
        <HowItWorksPanel
          open={open && howOpen}
          index={index + 1}
          kind="highlight"
          title={t('highlightEdit.howItWorks.title')}
          scenes={[
            t('highlightEdit.howItWorks.scene1'),
            t('highlightEdit.howItWorks.scene2'),
          ]}
          steps={[
            {
              title: t('highlightEdit.howItWorks.step1Title'),
              body: t('highlightEdit.howItWorks.step1Body'),
            },
            {
              title: t('highlightEdit.howItWorks.step2Title'),
              body: t('highlightEdit.howItWorks.step2Body'),
            },
          ]}
          palette={palette}
          actionLabel={t('highlightEdit.choosePhotos')}
          onAction={() => fileInputRef.current?.click()}
          onClose={() => setHowOpen(false)}
        />
      )}
    </>
  );
}
