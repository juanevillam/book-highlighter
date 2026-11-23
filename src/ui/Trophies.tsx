import { useEffect, useMemo, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import platinumChime from '../assets/sounds/trophy-platinum.mp3';
import trophyChime from '../assets/sounds/trophy.mp3';
import {
  FINISHED_BOOK_COUNT,
  HIGHLIGHT_COUNT,
  LIBRARY_BOOK_COUNT,
  TROPHY_CONFIGS,
  TROPHY_IDS,
  TROPHY_TITLES,
} from '../constants/trophies';
import { UI_STATE_LAB, useUiStateLab } from '../dev/uiStateLab';
import { t, useLocale } from '../i18n';
import { ChevronRightGlyph, CloseGlyph } from './glyphs';
import { useTrophyStore } from '../trophies/store';
import { tierColor } from '../trophies/tierColors';
import {
  type ResolvedTrophy,
  type TrophyCopy,
  type TrophyTier,
} from '../trophies/types';
import { useTrophies } from '../trophies/useTrophies';

const COUNTS: Record<string, number> = {
  [TROPHY_IDS.library]: LIBRARY_BOOK_COUNT,
  [TROPHY_IDS.highlights]: HIGHLIGHT_COUNT,
  [TROPHY_IDS.rereads]: FINISHED_BOOK_COUNT,
};

const buildCopy = (currentLocale: string): Record<string, TrophyCopy> => {
  void currentLocale;
  return Object.fromEntries(
    TROPHY_CONFIGS.map(({ id }) => [
      id,
      {
        title: TROPHY_TITLES[id] ?? id,
        description: t(`trophies.items.${id}.description`, {
          count: COUNTS[id] ?? '',
        }),
      },
    ]),
  );
};

const tierName = (tier: TrophyTier) => t(`trophies.tier.${tier}`);

const formatDate = (achievedAt: number, currentLocale: string) =>
  new Intl.DateTimeFormat(currentLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(achievedAt));

const caption = (trophy: ResolvedTrophy, currentLocale: string) =>
  trophy.unlocked && trophy.achievedAt !== null
    ? `${tierName(trophy.tier)} · ${t('trophies.earned')} ${formatDate(trophy.achievedAt, currentLocale)}`
    : `${tierName(trophy.tier)} · ${t('trophies.locked')}`;

const TROPHY_PATH =
  'M18 2H6v1H3a1 1 0 0 0-1 1v2a4 4 0 0 0 4 4h.55A6 6 0 0 0 11 13.91V17H8.5a1 1 0 0 0-1 1H7a1 1 0 0 0-1 1v1h12v-1a1 1 0 0 0-1-1h-.5a1 1 0 0 0-1-1H13v-3.09A6 6 0 0 0 17.45 10H18a4 4 0 0 0 4-4V4a1 1 0 0 0-1-1h-3V2ZM6 5v3a2 2 0 0 1-2-2V5h2Zm14 1a2 2 0 0 1-2 2V5h2v1Z';
const LOCK_PATH =
  'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z';

function TrophyGlyph({
  tier,
  locked,
  size,
}: {
  tier: TrophyTier;
  locked: boolean;
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="trophy-glyph"
    >
      <path
        d={locked ? LOCK_PATH : TROPHY_PATH}
        fill={locked ? 'var(--muted)' : tierColor(tier)}
        fillRule="evenodd"
      />
    </svg>
  );
}

const RING = 92;
const RING_STROKE = 8.5;

function Ring({ fraction, label }: { fraction: number; label: string }) {
  const c = RING / 2;
  const r = (RING - RING_STROKE) / 2;
  const length = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const tipDeg = clamped * 360 - 90;
  const headLen = Math.min(length * clamped, RING_STROKE * 0.9);
  const headStartDeg = tipDeg - (headLen / length) * 360;

  return (
    <span className="ring">
      <svg viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
        <defs>
          <mask id="trophy-ring-mask">
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={RING_STROKE}
            />
          </mask>
          <filter
            id="trophy-tip-shadow"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="1.35" />
          </filter>
        </defs>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={RING_STROKE}
        />
        {clamped > 0 && (
          <>
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
            <g mask="url(#trophy-ring-mask)">
              <circle
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke="rgb(0 0 0 / 0.55)"
                strokeWidth={RING_STROKE + 0.5}
                strokeLinecap="round"
                strokeDasharray={`0.8 ${length}`}
                filter="url(#trophy-tip-shadow)"
                transform={`rotate(${tipDeg + 2.3} ${c} ${c})`}
              />
            </g>
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${headLen} ${length}`}
              transform={`rotate(${headStartDeg} ${c} ${c})`}
            />
          </>
        )}
      </svg>
      <span className="ring-label">{label}</span>
    </span>
  );
}

export function TrophiesForm() {
  const activeLocale = useLocale();
  const copy = useMemo(() => buildCopy(activeLocale), [activeLocale]);
  const { trophies, earned, total, hydrated: realHydrated } = useTrophies(copy);
  const trophiesLab = useUiStateLab(s => (UI_STATE_LAB ? s.trophies : 'live'));
  const hydrated = trophiesLab === 'skeleton' ? false : realHydrated;
  const [open, setOpen] = useState<string | null>(null);
  const fraction = total > 0 ? earned / total : 0;
  const percent = new Intl.NumberFormat(activeLocale, {
    style: 'percent',
  }).format(fraction);
  const detail = trophies.find(trophy => trophy.id === open) ?? null;

  return (
    <>
      <div className="card trophy-summary" aria-busy={!hydrated}>
        <span className="figure">
          {hydrated ? (
            <strong>{earned}</strong>
          ) : (
            <span className="bone figure-bone" />
          )}
          <span>{t('trophies.earned')}</span>
        </span>
        {hydrated ? (
          <Ring fraction={fraction} label={percent} />
        ) : (
          <span className="bone ring-bone" />
        )}
        <span className="figure">
          {hydrated ? (
            <strong>{total}</strong>
          ) : (
            <span className="bone figure-bone" />
          )}
          <span>{t('trophies.available')}</span>
        </span>
      </div>

      <div className="card">
        {trophies.map(trophy => (
          <button
            key={trophy.id}
            type="button"
            className="cell link-row trophy-row"
            onClick={() => setOpen(trophy.id)}
          >
            <TrophyGlyph
              tier={trophy.tier}
              locked={!trophy.unlocked}
              size={26}
            />
            <span className="trophy-copy">
              <span className="trophy-title">{trophy.title}</span>
              {hydrated ? (
                <span className="trophy-line">
                  {tierName(trophy.tier)} ·{' '}
                  {trophy.unlocked && trophy.achievedAt !== null
                    ? `${t('trophies.earned')} ${formatDate(trophy.achievedAt, activeLocale)}`
                    : trophy.description}
                </span>
              ) : (
                <span className="bone line short" />
              )}
            </span>
            <span className="chevron">
              <ChevronRightGlyph />
            </span>
          </button>
        ))}
      </div>

      <TrophyDetail
        trophy={detail}
        activeLocale={activeLocale}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

function TrophyDetail({
  trophy,
  activeLocale,
  onClose,
}: {
  trophy: ResolvedTrophy | null;
  activeLocale: string;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const shown = useRef<ResolvedTrophy | null>(null);
  if (trophy) shown.current = trophy;
  const view = trophy ?? shown.current;
  const open = trophy !== null;
  const grab = useRef<{ y: number; t: number } | null>(null);

  const clearPullStyle = () => {
    const el = sheet.current;
    if (!el) return;
    el.style.removeProperty('--pull');
    el.style.removeProperty('transition');
  };

  useEffect(() => {
    setHost(anchor.current?.closest<HTMLElement>('.side') ?? null);
  }, []);

  useEffect(() => {
    if (!host) return;
    const bar = host.querySelector<HTMLElement>('.side-bar');
    const form = host.querySelector<HTMLElement>('.form');
    if (open) {
      bar?.setAttribute('inert', '');
      form?.setAttribute('inert', '');
    } else {
      bar?.removeAttribute('inert');
      form?.removeAttribute('inert');
    }
    return () => {
      bar?.removeAttribute('inert');
      form?.removeAttribute('inert');
    };
  }, [host, open]);

  useEffect(() => {
    if (!open) return;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const layer = (
    <>
      <div
        className={open ? 'sub-scrim is-open' : 'sub-scrim'}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={sheet}
        className={
          open ? 'sub-sheet trophy-detail is-open' : 'sub-sheet trophy-detail'
        }
        role="dialog"
        aria-modal="true"
        aria-label={view?.title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        onPointerDown={e => {
          if ((e.target as HTMLElement).closest('button')) return;
          grab.current = { y: e.clientY, t: performance.now() };
          e.currentTarget.setPointerCapture(e.pointerId);
          const el = sheet.current;
          if (el) {
            el.style.setProperty('--pull', '0px');
            el.style.setProperty('transition', 'none');
          }
        }}
        onPointerMove={e => {
          if (!grab.current) return;
          const dy = e.clientY - grab.current.y;
          const pullPx = Math.max(dy > 0 ? dy : dy / 6, -12);
          sheet.current?.style.setProperty('--pull', `${pullPx}px`);
        }}
        onPointerUp={e => {
          const start = grab.current;
          grab.current = null;
          clearPullStyle();
          if (!start) return;
          const dy = e.clientY - start.y;
          const v = dy / Math.max(1, performance.now() - start.t);
          if (dy > 80 || (dy > 20 && v > 0.6)) onClose();
        }}
        onPointerCancel={() => {
          grab.current = null;
          clearPullStyle();
        }}
      >
        <span className="sub-grabber" aria-hidden="true" />
        <button
          type="button"
          className="round detail-close"
          tabIndex={open ? 0 : -1}
          onClick={onClose}
        >
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>
        {view && (
          <>
            <span
              className="trophy-disc"
              style={{
                background: view.unlocked
                  ? `color-mix(in srgb, ${tierColor(view.tier)} 16%, transparent)`
                  : 'var(--empty-media)',
              }}
            >
              <TrophyGlyph tier={view.tier} locked={!view.unlocked} size={44} />
            </span>
            <h2>{view.title}</h2>
            <p className="trophy-caption">{caption(view, activeLocale)}</p>
            <p>{view.description}</p>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <span ref={anchor} hidden />
      {host && createPortal(layer, host)}
    </>
  );
}

const SHOW_MS = 4200;
const PLATINUM_SHOW_MS = 5400;
const EXIT_MS = 220;

let chain: Promise<void> = Promise.resolve();

const playChime = (platinum: boolean) => {
  chain = chain
    .then(
      () =>
        new Promise<void>(resolve => {
          const audio = new Audio(platinum ? platinumChime : trophyChime);
          audio.volume = platinum ? 0.9 : 0.7;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        }),
    )
    .then(() => new Promise(resolve => setTimeout(resolve, 250)));
};

export function TrophyBanner({ onOpen }: { onOpen: () => void }) {
  const activeLocale = useLocale();
  const copyMap = useMemo(() => buildCopy(activeLocale), [activeLocale]);
  const head = useTrophyStore(state => state.queue[0] ?? null);
  const dequeue = useTrophyStore(state => state.dequeue);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!head) return;
    setLeaving(false);
    const platinum = head.tier === 'platinum';
    playChime(platinum);
    const show = setTimeout(
      () => setLeaving(true),
      platinum ? PLATINUM_SHOW_MS : SHOW_MS,
    );
    return () => clearTimeout(show);
  }, [head]);

  useEffect(() => {
    if (!leaving) return;
    const exit = setTimeout(dequeue, EXIT_MS);
    return () => clearTimeout(exit);
  }, [leaving, dequeue]);

  const copy = head ? copyMap[head.id] : null;

  return (
    <div className="trophy-slot" role="status" aria-live="polite">
      {head && (
        <button
          key={head.id}
          type="button"
          className={[
            'trophy-banner',
            head.tier === 'platinum' && 'is-platinum',
            leaving && 'is-leaving',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            setLeaving(true);
            onOpen();
          }}
        >
          <TrophyGlyph tier={head.tier} locked={false} size={40} />
          <span className="trophy-banner-copy">
            <span className="eyebrow">{t('trophies.unlocked')}</span>
            <span className="title">{copy?.title}</span>
            <span className="desc">{copy?.description}</span>
          </span>
        </button>
      )}
    </div>
  );
}
