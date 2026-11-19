import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createPortal, flushSync } from 'react-dom';

import { useScheme } from '../appearance';
import {
  EMPTY_BODY,
  markBookRead,
  type Book,
  type BookBody,
  type ReaderAnchor,
} from '../books';
import { UI_STATE_LAB, useUiStateLab } from '../dev/uiStateLab';
import { t, useLocale } from '../i18n';
import { BookOpenGlyph, CheckGlyph, CloseGlyph, GearGlyph } from './glyphs';
import { SidePanel } from './SidePanel';
import { formatYear } from '../lib/bookFields';
import { useBookCoverPalette } from '../lib/coverPalette';
import { genreLabel } from '../lib/genres';
import {
  bookMotifForSlot,
  bookOrnamentForSlot,
  bookPairForSlot,
  hashArtSeed,
  pageIndexForAnchor,
  paginateSections,
  parseHighlightSegments,
  READER_SANS_STACK,
  READER_SERIF_STACK,
  type PaginatedPage,
} from '../lib/paginator';
import {
  COVER_FETCH_WIDTH,
  EMPTY_HIGHLIGHTS_SECTION_ID,
  readerSections,
  type ReaderSection,
} from '../lib/readerSections';
import {
  effectiveTheme,
  PAGE_TURNS,
  PAGE_WIDTHS,
  READER_THEMES,
  readerPalette,
  TEXT_SCALES,
  type BookOrnamentStyle,
  type PageTurn,
  type PageWidth,
  type ReaderPalette,
} from '../lib/readerThemes';
import { thumbUrl } from '../lib/thumbUrl';
import { useBodiesStore } from '../store/bodies';
import { useBooksStore } from '../store/books';
import { useReaderSettingsStore } from '../store/readerSettings';

const DESK = '(min-width: 64rem)';
const LEAVE_MS = 240;
const INK_SETTLE_MS = 1650;

function morph(change: () => void): void {
  if (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    window.matchMedia(DESK).matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    (
      document as Document & {
        startViewTransition: (cb: () => void) => void;
      }
    ).startViewTransition(() => flushSync(change));
    return;
  }
  change();
}

function sectionIdFromAnchor(
  anchor: ReaderAnchor | null | undefined,
  sections: ReaderSection[],
): string {
  const fallback = sections[0]?.id ?? 'title';
  if (!anchor?.blockId) return fallback;
  const { blockId } = anchor;
  if (sections.some(s => s.id === blockId)) return blockId;
  if (blockId.startsWith('chapter:')) {
    const chId = blockId.split(':')[1] ?? '';
    const secId = `chapter:${chId}`;
    if (sections.some(s => s.id === secId)) return secId;
  }
  if (blockId === EMPTY_HIGHLIGHTS_SECTION_ID) {
    return EMPTY_HIGHLIGHTS_SECTION_ID;
  }
  return fallback;
}

function useInkDrawOnce(active = true) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stateRef = useRef<'idle' | 'drawing' | 'done'>('idle');

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !active) {
      if (svg) svg.removeAttribute('data-ink-state');
      stateRef.current = 'idle';
      return;
    }

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      stateRef.current = 'done';
      svg.setAttribute('data-ink-state', 'done');
      return;
    }

    const readerEl = svg.closest('.reader');
    if (!readerEl) return;

    let io: IntersectionObserver | null = null;
    let slideObserver: MutationObserver | null = null;
    let doneTimer: number | null = null;
    let raf1 = 0;
    let raf2 = 0;

    const triggerDraw = () => {
      if (stateRef.current !== 'idle') return;
      stateRef.current = 'drawing';
      svg.setAttribute('data-ink-state', 'drawing');
      io?.disconnect();
      io = null;
      slideObserver?.disconnect();
      slideObserver = null;
      doneTimer = window.setTimeout(() => {
        stateRef.current = 'done';
        svg.setAttribute('data-ink-state', 'done');
      }, INK_SETTLE_MS);
    };

    const armForIllustrated = () => {
      if (!readerEl.classList.contains('is-illustrated')) {
        if (doneTimer !== null) {
          window.clearTimeout(doneTimer);
          doneTimer = null;
        }
        io?.disconnect();
        io = null;
        slideObserver?.disconnect();
        slideObserver = null;
        stateRef.current = 'idle';
        svg.removeAttribute('data-ink-state');
        return;
      }

      if (stateRef.current !== 'idle') return;

      const slideCell = svg.closest(
        '.reader-slide-cell, .reader-slide-edge-layer',
      );
      if (slideCell) {
        if (slideCell.classList.contains('is-current')) {
          triggerDraw();
        } else {
          slideObserver?.disconnect();
          slideObserver = new MutationObserver(() => {
            if (slideCell.classList.contains('is-current')) {
              triggerDraw();
            }
          });
          slideObserver.observe(slideCell, {
            attributes: true,
            attributeFilter: ['class'],
          });
        }
        return;
      }

      const scrollRoot = svg.closest('.reader-scroll-view');
      const target = svg.closest('.reader-decor-card') ?? svg;
      io?.disconnect();
      io = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              triggerDraw();
              break;
            }
          }
        },
        {
          root: scrollRoot instanceof Element ? scrollRoot : null,
          threshold: 0.14,
        },
      );
      io.observe(target);
    };

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(armForIllustrated);
    });

    const readerObserver = new MutationObserver(armForIllustrated);
    readerObserver.observe(readerEl, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      readerObserver.disconnect();
      io?.disconnect();
      slideObserver?.disconnect();
      if (doneTimer !== null) {
        window.clearTimeout(doneTimer);
      }
    };
  }, [active]);

  return svgRef;
}

export function BookPageOrnament({
  style: _style,
  variant = 'header',
  seed = 0,
  color,
  secondaryColor,
  active = true,
}: {
  style?: BookOrnamentStyle;
  variant?: 'title' | 'header' | 'footer';
  seed?: number;
  color?: string;
  secondaryColor?: string;
  active?: boolean;
}) {
  const svgRef = useInkDrawOnce(active);
  const c1 = color ?? 'currentColor';
  const c2 = secondaryColor ?? c1;
  const motif = Math.abs(seed) % 8;
  const cls = `reader-ornament is-${variant}${active ? '' : ' is-hidden'}`;

  if (motif === 0) {
    // 1. Open quarto book with veined botanical leaves, bookmark & diamond finial
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M120 19.2 C113.8 15.4 105.2 15.2 99.6 17.2 Q99.2 12.2 99.6 7.2 C105.2 5 113.8 5.4 120 9.4 C126.2 5.4 134.8 5 140.4 7.2 Q140.8 12.2 140.4 17.2 C134.8 15.2 126.2 15.4 120 19.2 Z"
          fill={c1}
          fillOpacity="0.16"
        />
        <path
          data-wash="1"
          d="M89 12.8 C85.8 6.8 76.8 6.4 73.6 11.4 C78.2 14.2 84.4 14.2 89 12.8 Z M151 12.8 C154.2 6.8 163.2 6.4 166.4 11.4 C161.8 14.2 155.6 14.2 151 12.8 Z M66 13.4 C62.4 18.6 54.6 18.8 52 14.2 C56.2 11.6 62.2 11.8 66 13.4 Z M174 13.4 C177.6 18.6 185.4 18.8 188 14.2 C183.8 11.6 177.8 11.8 174 13.4 Z"
          fill={c2}
          fillOpacity="0.34"
        />
        <path
          data-wash="2"
          d="M120 2.2 Q121.2 3.7 122.1 5.1 Q121.2 6.5 120 8 Q118.8 6.5 117.9 5.1 Q118.8 3.7 120 2.2 Z"
          fill={c1}
          fillOpacity="0.86"
        />
        <circle
          data-wash="2"
          cx="40.5"
          cy="10.4"
          r="1.65"
          fill={c1}
          fillOpacity="0.78"
        />
        <circle
          data-wash="2"
          cx="199.5"
          cy="10.4"
          r="1.65"
          fill={c1}
          fillOpacity="0.78"
        />

        {/* Stage 1: Primary book contour & outward botanical tendrils */}
        <path
          data-ink="1"
          pathLength="1"
          d="M120 9.4 C113.8 5.4 105.2 5 99.6 7.2 Q99.2 12.2 99.6 17.2 C105.2 15.2 113.8 15.4 120 19.2 C126.2 15.4 134.8 15.2 140.4 17.2 Q140.8 12.2 140.4 7.2 C134.8 5 126.2 5.4 120 9.4 Z"
          stroke={c1}
          strokeWidth="1.28"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M97.4 9 Q97 14 97.4 19 C104 17 113.4 17.2 120 20.8 C126.6 17.2 136 17 142.6 19 Q143 14 142.6 9"
          stroke={c1}
          strokeOpacity="0.76"
          strokeWidth="1.12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M97.4 14.8 C84 11.2 68 15.6 48 13 C34 11.2 22 13.8 11.8 13.4 C9.4 13.2 9.4 10.4 11.8 10.4 C13.5 10.4 13.8 12.1 12.5 12.8"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M142.6 14.8 C156 11.2 172 15.6 192 13 C206 11.2 218 13.8 228.2 13.4 C230.6 13.2 230.6 10.4 228.2 10.4 C226.5 10.4 226.2 12.1 227.5 12.8"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="1.15"
          strokeLinecap="round"
        />

        {/* Stage 2: Spine, bookmark, leaf outlines & berry stems */}
        <path
          data-ink="2"
          pathLength="1"
          d="M120 8 Q119.8 14.4 120 20.8 Q119 22.3 118.2 23.6 M120 20.8 Q121 22.2 121.8 23.4"
          stroke={c1}
          strokeWidth="1.08"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M89 12.8 C85.8 6.8 76.8 6.4 73.6 11.4 C78.2 14.2 84.4 14.2 89 12.8 Z M66 13.4 C62.4 18.6 54.6 18.8 52 14.2 C56.2 11.6 62.2 11.8 66 13.4 Z M48 13 Q45 11.8 42.1 10.9"
          stroke={c2}
          strokeOpacity="0.88"
          strokeWidth="1.05"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M151 12.8 C154.2 6.8 163.2 6.4 166.4 11.4 C161.8 14.2 155.6 14.2 151 12.8 Z M174 13.4 C177.6 18.6 185.4 18.8 188 14.2 C183.8 11.6 177.8 11.8 174 13.4 Z M192 13 Q195 11.8 197.9 10.9"
          stroke={c2}
          strokeOpacity="0.88"
          strokeWidth="1.05"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Stage 3: Curved page riffles, finial & berry pen contours, leaf midribs */}
        <path
          data-ink="3"
          pathLength="1"
          d="M120 2.2 Q121.2 3.7 122.1 5.1 Q121.2 6.5 120 8 Q118.8 6.5 117.9 5.1 Q118.8 3.7 120 2.2 Z M103.2 10 C108 8.8 113.8 9.2 117.8 11.6 M103.2 13.2 C108 12 113.8 12.4 117.8 14.8 M136.8 10 C132 8.8 126.2 9.2 122.2 11.6 M136.8 13.2 C132 12 126.2 12.4 122.2 14.8"
          stroke={c1}
          strokeOpacity="0.62"
          strokeWidth="0.84"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="40.5"
          cy="10.4"
          r="1.7"
          stroke={c1}
          strokeOpacity="0.86"
          strokeWidth="0.88"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="199.5"
          cy="10.4"
          r="1.7"
          stroke={c1}
          strokeOpacity="0.86"
          strokeWidth="0.88"
        />
        <path
          data-ink="3"
          pathLength="1"
          d="M88.5 12.6 Q82.5 11.6 76.8 11.2 M65.5 13.5 Q60.4 14 55.4 14.2 M151.5 12.6 Q157.5 11.6 163.2 11.2 M174.5 13.5 Q179.6 14 184.6 14.2"
          stroke={c2}
          strokeOpacity="0.68"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (motif === 1) {
    // 2. Botanical olive & berry garland with signature faceted diamond crest
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M120 3 Q123.8 8.2 127 13 Q123.8 17.8 120 23 Q116.2 17.8 113 13 Q116.2 8.2 120 3 Z"
          fill={c1}
          fillOpacity="0.18"
        />
        <path
          data-wash="1"
          d="M99 11.8 C94.8 6 86 6.2 82.8 10.8 C87.5 13.8 94.2 13.6 99 11.8 Z M74 11.2 C69.8 16.8 61.2 17.2 58 12.8 C62.6 10 69.2 9.8 74 11.2 Z M48 13.2 C44.4 8.4 37.2 8.6 34.6 12.4 C38.6 14.8 44.2 14.6 48 13.2 Z M141 14.2 C145.2 20 154 19.8 157.2 15.2 C152.5 12.2 145.8 12.4 141 14.2 Z M166 14.8 C170.2 9.2 178.8 8.8 182 13.2 C177.4 16 170.8 16.2 166 14.8 Z M192 12.8 C195.6 17.6 202.8 17.4 205.4 13.6 C201.4 11.2 195.8 11.4 192 12.8 Z"
          fill={c2}
          fillOpacity="0.34"
        />
        <path
          data-wash="2"
          d="M120 7.8 Q121.8 10.5 123.3 13 Q121.8 15.5 120 18.2 Q118.2 15.5 116.7 13 Q118.2 10.5 120 7.8 Z"
          fill={c1}
          fillOpacity="0.88"
        />
        <circle
          data-wash="2"
          cx="105.5"
          cy="13"
          r="1.8"
          fill={c1}
          fillOpacity="0.8"
        />
        <circle
          data-wash="2"
          cx="134.5"
          cy="13"
          r="1.8"
          fill={c1}
          fillOpacity="0.8"
        />
        <circle
          data-wash="2"
          cx="80.5"
          cy="16.4"
          r="1.55"
          fill={c1}
          fillOpacity="0.74"
        />
        <circle
          data-wash="2"
          cx="159.5"
          cy="9.6"
          r="1.55"
          fill={c1}
          fillOpacity="0.74"
        />

        {/* Stage 1: Faceted diamond crest & primary undulating garland vines */}
        <path
          data-ink="1"
          pathLength="1"
          d="M120 2.6 Q123.9 8 127.2 13 Q123.9 18 120 23.4 Q116.1 18 112.8 13 Q116.1 8 120 2.6 Z"
          stroke={c1}
          strokeWidth="1.32"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M112.8 13 C95 8.2 72 10.8 49 13.2 C33 14.8 21 14 11 12.4 C9.2 12 9.4 9.8 11.4 10"
          stroke={c1}
          strokeOpacity="0.74"
          strokeWidth="1.18"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M127.2 13 C145 17.8 168 15.2 191 12.8 C207 11.2 219 12 229 13.6 C230.8 14 230.6 16.2 228.6 16"
          stroke={c1}
          strokeOpacity="0.74"
          strokeWidth="1.18"
          strokeLinecap="round"
        />

        {/* Stage 2: Intertwined counter-tendrils, leaf contours & berry pedicels */}
        <path
          data-ink="2"
          pathLength="1"
          d="M99 11.8 C94.8 6 86 6.2 82.8 10.8 C87.5 13.8 94.2 13.6 99 11.8 Z M74 11.2 C69.8 16.8 61.2 17.2 58 12.8 C62.6 10 69.2 9.8 74 11.2 Z M48 13.2 C44.4 8.4 37.2 8.6 34.6 12.4 C38.6 14.8 44.2 14.6 48 13.2 Z M88 10.6 Q84.6 12.6 81.5 15.2 M112.8 13 Q110 12.6 107.3 13"
          stroke={c2}
          strokeOpacity="0.88"
          strokeWidth="1.04"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M141 14.2 C145.2 20 154 19.8 157.2 15.2 C152.5 12.2 145.8 12.4 141 14.2 Z M166 14.8 C170.2 9.2 178.8 8.8 182 13.2 C177.4 16 170.8 16.2 166 14.8 Z M192 12.8 C195.6 17.6 202.8 17.4 205.4 13.6 C201.4 11.2 195.8 11.4 192 12.8 Z M152 15.4 Q155.4 13.4 158.5 10.8 M127.2 13 Q130 13.4 132.7 13"
          stroke={c2}
          strokeOpacity="0.88"
          strokeWidth="1.04"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Stage 3: Leaf midribs, inner diamond bevels & berry pen contours */}
        <path
          data-ink="3"
          pathLength="1"
          d="M120 5.4 Q122.6 9.3 124.8 13 Q122.6 16.7 120 20.6 Q117.4 16.7 115.2 13 Q117.4 9.3 120 5.4 Z M120 7.8 Q121.8 10.5 123.3 13 Q121.8 15.5 120 18.2 Q118.2 15.5 116.7 13 Q118.2 10.5 120 7.8 Z M98 11.6 Q92 10.8 86.2 10.6 M73 11.4 Q67.2 12.4 61.5 12.8 M47.2 13 Q42.5 12.4 37.8 12.3 M142 14.4 Q148 15.2 153.8 15.4 M167 14.6 Q172.8 13.6 178.5 13.2 M192.8 13 Q197.5 13.6 202.2 13.7"
          stroke={c1}
          strokeOpacity="0.62"
          strokeWidth="0.82"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="105.5"
          cy="13"
          r="1.85"
          stroke={c1}
          strokeOpacity="0.84"
          strokeWidth="0.86"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="134.5"
          cy="13"
          r="1.85"
          stroke={c1}
          strokeOpacity="0.84"
          strokeWidth="0.86"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="80.5"
          cy="16.4"
          r="1.6"
          stroke={c1}
          strokeOpacity="0.8"
          strokeWidth="0.84"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="159.5"
          cy="9.6"
          r="1.6"
          stroke={c1}
          strokeOpacity="0.8"
          strokeWidth="0.84"
        />
      </svg>
    );
  }

  if (motif === 2) {
    // 3. Classical scalloped wax seal & side-poised calligraphy feather quill
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M104.1 7.7 Q106.5 5.6 108.9 7.7 Q112.1 7.9 112.3 11.1 Q114.4 13.5 112.3 15.9 Q112.1 19.1 108.9 19.3 Q106.5 21.4 104.1 19.3 Q100.9 19.1 100.7 15.9 Q98.6 13.5 100.7 11.1 Q100.9 7.9 104.1 7.7 Z"
          fill={c1}
          fillOpacity="0.24"
        />
        <path
          data-wash="1"
          d="M119.5 16.2 C121.5 10.6 126.5 6.4 133.2 4.4 L132 7 L135.5 3.9 C139.2 3.1 142.6 3.2 145 4 C142.8 8.4 138.2 12 132.5 14 L134 11.6 L130.2 14.8 C126.4 16 122.4 16.4 119.5 16.2 Z"
          fill={c2}
          fillOpacity="0.34"
        />
        <path
          data-wash="2"
          d="M106.5 10.6 L108.6 13.5 L106.5 16.4 L104.4 13.5 Z"
          fill={c1}
          fillOpacity="0.9"
        />
        <path
          data-wash="2"
          d="M81.8 10.8 L84 13 L81.8 15.2 L79.6 13 Z M158.2 10.8 L160.4 13 L158.2 15.2 L156 13 Z"
          fill={c2}
          fillOpacity="0.8"
        />

        {/* Stage 1: Symmetric 8-lobe wax seal, arched quill rachis & framed flanking rules */}
        <path
          data-ink="1"
          pathLength="1"
          d="M104.1 7.7 Q106.5 5.6 108.9 7.7 Q112.1 7.9 112.3 11.1 Q114.4 13.5 112.3 15.9 Q112.1 19.1 108.9 19.3 Q106.5 21.4 104.1 19.3 Q100.9 19.1 100.7 15.9 Q98.6 13.5 100.7 11.1 Q100.9 7.9 104.1 7.7 Z"
          stroke={c1}
          strokeWidth="1.26"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M145 4 C131.5 7.2 121.8 13.8 114.4 21.4 C112.6 23.2 109.2 22.8 106.5 20.6"
          stroke={c1}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M90.2 13 C87.5 13.2 85.8 12.8 84 13 M79.6 13 C58 12.4 34 13.6 12 13 C9.8 12.9 9.8 10.5 12 10.5 C13.5 10.5 13.8 12 12.6 12.6"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="1.12"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M149.8 13 C152.5 12.8 154.2 13.2 156 13 M160.4 13 C182 13.6 206 12.4 228 13 C230.2 13.1 230.2 15.5 228 15.5 C226.5 15.5 226.2 14 227.4 13.4"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="1.12"
          strokeLinecap="round"
        />

        {/* Stage 2: Swept goose-quill plumage & inner wax seal stamp */}
        <path
          data-ink="2"
          pathLength="1"
          d="M119.5 16.2 C121.5 10.6 126.5 6.4 133.2 4.4 L132 7 L135.5 3.9 C139.2 3.1 142.6 3.2 145 4 C142.8 8.4 138.2 12 132.5 14 L134 11.6 L130.2 14.8 C126.4 16 122.4 16.4 119.5 16.2 Z"
          stroke={c2}
          strokeWidth="1.12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="106.5"
          cy="13.5"
          r="4.5"
          stroke={c1}
          strokeOpacity="0.78"
          strokeWidth="0.92"
        />

        {/* Stage 3: Feather barbs, seal diamond, clasp contours & cradling brackets */}
        <path
          data-ink="3"
          pathLength="1"
          d="M106.5 10.6 L108.6 13.5 L106.5 16.4 L104.4 13.5 Z M81.8 10.8 L84 13 L81.8 15.2 L79.6 13 Z M158.2 10.8 L160.4 13 L158.2 15.2 L156 13 Z M123.2 13.6 L124.8 8.8 M128 10.4 L129.6 6 M135.5 6.8 L137.4 3.8 M125.2 12.2 L128.8 14.8 M132.2 8.6 L136.2 11.4 M93 10.2 C90.8 11 90.2 12 90.2 13 C90.2 14 90.8 15 93 15.8 M147 10.2 C149.2 11 149.8 12 149.8 13 C149.8 14 149.2 15 147 15.8"
          stroke={c2}
          strokeOpacity="0.76"
          strokeWidth="0.82"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (motif === 3) {
    // 4. Celestial Polaris compass star, cradling crescent moons & astrolabe rings
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M120 2 L122.7 10.3 L131 13 L122.7 15.7 L120 24 L117.3 15.7 L109 13 L117.3 10.3 Z"
          fill={c1}
          fillOpacity="0.2"
        />
        <path
          data-wash="1"
          d="M102.6 7 A6.3 6.3 0 1 0 102.6 19 A4.9 5.3 0 1 1 102.6 7 Z M137.4 7 A6.3 6.3 0 1 1 137.4 19 A4.9 5.3 0 1 0 137.4 7 Z"
          fill={c2}
          fillOpacity="0.36"
        />
        <path
          data-wash="2"
          d="M120 9.2 L122.5 13 L120 16.8 L117.5 13 Z"
          fill={c1}
          fillOpacity="0.9"
        />
        <path
          data-wash="2"
          d="M76 10.6 L78.2 13 L76 15.4 L73.8 13 Z M164 10.6 L166.2 13 L164 15.4 L161.8 13 Z"
          fill={c1}
          fillOpacity="0.8"
        />

        {/* Stage 1: Primary 4-point Polaris star & hand-drawn equatorial rules */}
        <path
          data-ink="1"
          pathLength="1"
          d="M120 2 L122.7 10.3 L131 13 L122.7 15.7 L120 24 L117.3 15.7 L109 13 L117.3 10.3 Z"
          stroke={c1}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M91.8 13 C68 12.4 42 13.6 14.2 13 M148.2 13 C172 13.6 198 12.4 225.8 13"
          stroke={c1}
          strokeOpacity="0.64"
          strokeWidth="1.1"
          strokeLinecap="round"
        />

        {/* Stage 2: Diagonal compass rays, crescent moon contours & orbital rings */}
        <path
          data-ink="2"
          pathLength="1"
          d="M117.3 10.3 L113.4 6.4 L120 9.6 L126.6 6.4 L122.7 10.3 M122.7 15.7 L126.6 19.6 L120 16.4 L113.4 19.6 L117.3 15.7"
          stroke={c2}
          strokeOpacity="0.86"
          strokeWidth="0.98"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M102.6 7 A6.3 6.3 0 1 0 102.6 19 A4.9 5.3 0 1 1 102.6 7 Z M109 13 H97.6 M137.4 7 A6.3 6.3 0 1 1 137.4 19 A4.9 5.3 0 1 0 137.4 7 Z M131 13 H142.4"
          stroke={c2}
          strokeWidth="1.14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="76"
          cy="13"
          r="3.8"
          stroke={c1}
          strokeOpacity="0.62"
          strokeWidth="0.95"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="164"
          cy="13"
          r="3.8"
          stroke={c1}
          strokeOpacity="0.62"
          strokeWidth="0.95"
        />

        {/* Stage 3: Internal compass axes, core diamonds & terminal ring finials */}
        <path
          data-ink="3"
          pathLength="1"
          d="M120 2 V24 M109 13 H131 M120 9.2 L122.5 13 L120 16.8 L117.5 13 Z M76 10.6 L78.2 13 L76 15.4 L73.8 13 Z M164 10.6 L166.2 13 L164 15.4 L161.8 13 Z"
          stroke={c1}
          strokeOpacity="0.62"
          strokeWidth="0.78"
          strokeLinejoin="round"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="12.2"
          cy="13"
          r="1.9"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="0.95"
        />
        <circle
          data-ink="3"
          pathLength="1"
          cx="227.8"
          cy="13"
          r="1.9"
          stroke={c1}
          strokeOpacity="0.68"
          strokeWidth="0.95"
        />
      </svg>
    );
  }

  if (motif === 4) {
    // 5. Classic Aldine double-rule & JV heraldic diamond crest
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M120 3.2 L129.8 13 L120 22.8 L110.2 13 Z"
          fill={c2}
          fillOpacity="0.24"
        />
        <path
          data-wash="1"
          d="M110.2 13 C106.2 8.8 100.8 9.2 98.8 13 C100.8 16.8 106.2 17.2 110.2 13 Z M129.8 13 C133.8 8.8 139.2 9.2 141.2 13 C139.2 16.8 133.8 17.2 129.8 13 Z"
          fill={c1}
          fillOpacity="0.2"
        />
        <path
          data-wash="2"
          d="M120 8.5 L124.5 13 L120 17.5 L115.5 13 Z"
          fill={c1}
          fillOpacity="0.88"
        />
        <path
          data-wash="2"
          d="M62 10.2 L64.4 13 L62 15.8 L59.6 13 Z M178 10.2 L180.4 13 L178 15.8 L175.6 13 Z"
          fill={c2}
          fillOpacity="0.82"
        />

        {/* Stage 1: Outer JV crest diamond & hand-drawn upper engraved rules */}
        <path
          data-ink="1"
          pathLength="1"
          d="M120 3 L129.8 13 L120 23 L110.2 13 Z"
          stroke={c1}
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M98.8 11.3 C72 10.8 40 11.7 12 11.3 L15.2 9.1 M141.2 11.3 C168 11.7 200 10.8 228 11.3 L224.8 9.1"
          stroke={c1}
          strokeOpacity="0.72"
          strokeWidth="1.14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Stage 2: Companion lower rules, inner concentric diamond & Aldine clasps */}
        <path
          data-ink="2"
          pathLength="1"
          d="M98.8 14.7 C76 15.2 48 14.3 24 14.7 L26.8 16.8 M141.2 14.7 C164 14.3 192 15.2 216 14.7 L213.2 16.8"
          stroke={c1}
          strokeOpacity="0.54"
          strokeWidth="0.96"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M120 6 L127 13 L120 20 L113 13 Z"
          stroke={c2}
          strokeOpacity="0.88"
          strokeWidth="0.95"
          strokeLinejoin="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M110.2 13 C106.2 8.8 100.8 9.2 98.8 13 C100.8 16.8 106.2 17.2 110.2 13 Z M129.8 13 C133.8 8.8 139.2 9.2 141.2 13 C139.2 16.8 133.8 17.2 129.8 13 Z"
          stroke={c1}
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* Stage 3: Inner diamond seal, rule-tie diamonds & crest vertex cusps */}
        <path
          data-ink="3"
          pathLength="1"
          d="M120 8.5 L124.5 13 L120 17.5 L115.5 13 Z M62 9.4 L64.8 13 L62 16.6 L59.2 13 Z M178 9.4 L180.8 13 L178 16.6 L175.2 13 Z M118.2 3 H121.8 M118.2 23 H121.8"
          stroke={c2}
          strokeOpacity="0.78"
          strokeWidth="0.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (motif === 5) {
    // 6. Winged brass reading hourglass with trickling sand & layered plumage
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          d="M115 5.2 H125 C125 9.8 121.3 11.8 120 13 C118.7 11.8 115 9.8 115 5.2 Z M115 20.8 H125 C125 16.2 121.3 14.2 120 13 C118.7 14.2 115 16.2 115 20.8 Z"
          fill={c1}
          fillOpacity="0.16"
        />
        <path
          data-wash="1"
          d="M113.5 11.4 C104.5 6.4 92.5 6.8 83 11.8 C88 13.8 92 14.4 87 16 C94 17.4 103.5 17.2 113.5 14.8 Z M126.5 11.4 C135.5 6.4 147.5 6.8 157 11.8 C152 13.8 148 14.4 153 16 C146 17.4 136.5 17.2 126.5 14.8 Z"
          fill={c2}
          fillOpacity="0.32"
        />
        <path
          data-wash="2"
          d="M116.8 8.8 Q120 9.8 123.2 8.8 C122.1 10.9 120.7 12 120 12.7 C119.3 12 117.9 10.9 116.8 8.8 Z M116 20.6 C117.2 17.8 118.8 16.4 120 16.4 C121.2 16.4 122.8 17.8 124 20.6 Z"
          fill={c1}
          fillOpacity="0.8"
        />

        {/* Stage 1: Brass plinths, blown-glass bulbs & organic leading wing sweeps */}
        <path
          data-ink="1"
          pathLength="1"
          d="M112.2 4.6 Q120 4.3 127.8 4.6 M112.2 21.4 Q120 21.7 127.8 21.4 M115 4.8 C115 9.8 118.7 11.8 120 13 C121.3 11.8 125 9.8 125 4.8 M115 21.2 C115 16.2 118.7 14.2 120 13 C121.3 14.2 125 16.2 125 21.2"
          stroke={c1}
          strokeWidth="1.26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M113.5 11.4 C104.5 6.4 92.5 6.8 83 11.8 C68 13.8 40 12.3 12 13"
          stroke={c1}
          strokeOpacity="0.7"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M126.5 11.4 C135.5 6.4 147.5 6.8 157 11.8 C172 13.8 200 12.3 228 13"
          stroke={c1}
          strokeOpacity="0.7"
          strokeWidth="1.15"
          strokeLinecap="round"
        />

        {/* Stage 2: Brass frame spindles & 3-tier feathered wing plumage */}
        <path
          data-ink="2"
          pathLength="1"
          d="M113.6 4.6 Q113.3 13 113.6 21.4 M126.4 4.6 Q126.7 13 126.4 21.4"
          stroke={c1}
          strokeOpacity="0.72"
          strokeWidth="0.98"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M83 11.8 C89 13.6 97 13.4 106 12.2 M87.5 15.4 C95 16.8 104 16.4 113.5 14.2 M94 17.6 C101 18.4 108 17.4 113.5 15.4"
          stroke={c2}
          strokeWidth="1.06"
          strokeLinecap="round"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M157 11.8 C151 13.6 143 13.4 134 12.2 M152.5 15.4 C145 16.8 136 16.4 126.5 14.2 M146 17.6 C139 18.4 132 17.4 126.5 15.4"
          stroke={c2}
          strokeWidth="1.06"
          strokeLinecap="round"
        />

        {/* Stage 3: Sand contours, falling stream & diamond wingtip finials */}
        <path
          data-ink="3"
          pathLength="1"
          d="M116.8 8.8 Q120 9.8 123.2 8.8 M120 12.8 V16.6 M116.2 20.4 C117.4 17.8 118.8 16.4 120 16.4 C121.2 16.4 122.6 17.8 123.8 20.4 M12 13 L14.8 11.2 L17.6 13 L14.8 14.8 Z M228 13 L225.2 11.2 L222.4 13 L225.2 14.8 Z"
          stroke={c1}
          strokeOpacity="0.74"
          strokeWidth="0.86"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (motif === 6) {
    // 7. Gothic trefoil antique skeleton key & symmetrical Ex-Libris filigree
    return (
      <svg
        ref={svgRef}
        className={cls}
        viewBox="0 0 240 26"
        fill="none"
        aria-hidden="true"
      >
        {/* Watercolor washes */}
        <path
          data-wash="1"
          fillRule="evenodd"
          d="M102.6 9.4 A4.4 4.4 0 1 0 102.6 16.6 A4.4 4.4 0 1 0 111.2 15.2 Q113.8 14.4 113.8 13 Q113.8 11.6 111.2 10.8 A4.4 4.4 0 1 0 102.6 9.4 Z M102.1 13 A1.9 1.9 0 1 1 98.3 13 A1.9 1.9 0 1 1 102.1 13 Z M109 8.4 A1.8 1.8 0 1 1 105.4 8.4 A1.8 1.8 0 1 1 109 8.4 Z M109 17.6 A1.8 1.8 0 1 1 105.4 17.6 A1.8 1.8 0 1 1 109 17.6 Z"
          fill={c2}
          fillOpacity="0.28"
        />
        <path
          data-wash="1"
          d="M133.6 13 V16 H130.6 V21.4 H134.2 V18.2 H136.4 V21.4 H140 V16 H137 V13 Z"
          fill={c1}
          fillOpacity="0.24"
        />
        <path
          data-wash="2"
          d="M120.4 10.2 L122.5 13 L120.4 15.8 L118.3 13 Z"
          fill={c1}
          fillOpacity="0.88"
        />
        <path
          data-wash="2"
          d="M78 10.8 L80.2 13 L78 15.2 L75.8 13 Z M162 10.8 L164.2 13 L162 15.2 L159.8 13 Z"
          fill={c2}
          fillOpacity="0.8"
        />

        {/* Stage 1: Trefoil skeleton-key bow, cylindrical stem & hand-drawn flanking rules */}
        <path
          data-ink="1"
          pathLength="1"
          d="M102.6 9.4 A4.4 4.4 0 1 0 102.6 16.6 A4.4 4.4 0 1 0 111.2 15.2 Q113.8 14.4 113.8 13 Q113.8 11.6 111.2 10.8 A4.4 4.4 0 1 0 102.6 9.4 Z"
          stroke={c1}
          strokeWidth="1.28"
          strokeLinejoin="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M113.8 13 Q128 12.7 142.3 13"
          stroke={c1}
          strokeWidth="1.44"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M88.2 13 Q84 13.2 80.2 13 M75.8 13 C54 12.4 32 13.6 12 13 C9.8 12.9 9.8 10.6 12 10.6 C13.5 10.6 13.8 12.1 12.6 12.7"
          stroke={c1}
          strokeOpacity="0.66"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path
          data-ink="1"
          pathLength="1"
          d="M151.8 13 Q156 12.8 159.8 13 M164.2 13 C186 13.6 208 12.4 228 13 C230.2 13.1 230.2 15.4 228 15.4 C226.5 15.4 226.2 13.9 227.4 13.3"
          stroke={c1}
          strokeOpacity="0.66"
          strokeWidth="1.1"
          strokeLinecap="round"
        />

        {/* Stage 2: Three trefoil piercings, turned collar moldings & stepped ward bit */}
        <circle
          data-ink="2"
          pathLength="1"
          cx="100.2"
          cy="13"
          r="1.9"
          stroke={c2}
          strokeWidth="1"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="107.2"
          cy="8.4"
          r="1.8"
          stroke={c2}
          strokeWidth="1"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="107.2"
          cy="17.6"
          r="1.8"
          stroke={c2}
          strokeWidth="1"
        />
        <path
          data-ink="2"
          pathLength="1"
          d="M115.8 9.8 V16.2 M124.2 10.6 V15.4 M133.6 13 V16 H130.6 V21.4 H134.2 V18.2 H136.4 V21.4 H140 V16 H137 V13"
          stroke={c1}
          strokeWidth="1.16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          data-ink="2"
          pathLength="1"
          cx="143.8"
          cy="13"
          r="1.5"
          stroke={c1}
          strokeWidth="1.18"
        />

        {/* Stage 3: Trefoil center diamond, collar jewel & cradling C-scrolls */}
        <path
          data-ink="3"
          pathLength="1"
          d="M120.4 10.2 L122.5 13 L120.4 15.8 L118.3 13 Z M78 10.8 L80.2 13 L78 15.2 L75.8 13 Z M162 10.8 L164.2 13 L162 15.2 L159.8 13 Z M105.6 11.4 L107.2 13 L105.6 14.6 L104 13 Z M91 10 C89 10.8 88.2 12 88.2 13 C88.2 14 89 15.2 91 16 M149 10 C151 10.8 151.8 12 151.8 13 C151.8 14 151 15.2 149 16"
          stroke={c2}
          strokeOpacity="0.74"
          strokeWidth="0.86"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 8. Scholar's wire-rim spectacles & unfurling parchment scroll flourishes
  return (
    <svg
      ref={svgRef}
      className={cls}
      viewBox="0 0 240 26"
      fill="none"
      aria-hidden="true"
    >
      {/* Watercolor washes */}
      <circle
        data-wash="1"
        cx="110"
        cy="13.6"
        r="5.6"
        fill={c2}
        fillOpacity="0.18"
      />
      <circle
        data-wash="1"
        cx="130"
        cy="13.6"
        r="5.6"
        fill={c2}
        fillOpacity="0.18"
      />
      <path
        data-wash="1"
        d="M101 13.6 C94 13.6 88 8.8 78 12.6 C71 15.2 64 14.8 58 13 C64 16.6 72 17.6 80 14.6 C88 11.6 94 15.8 101 15.4 Z M139 13.6 C146 13.6 152 8.8 162 12.6 C169 15.2 176 14.8 182 13 C176 16.6 168 17.6 160 14.6 C152 11.6 146 15.8 139 15.4 Z"
        fill={c1}
        fillOpacity="0.18"
      />
      <path
        data-wash="2"
        d="M120 7.2 L121.6 9.4 L120 11.6 L118.4 9.4 Z"
        fill={c1}
        fillOpacity="0.84"
      />

      {/* Stage 1: Round wire-rim lenses, keyhole bridge & hand-drawn parchment scroll rules */}
      <circle
        data-ink="1"
        pathLength="1"
        cx="110"
        cy="13.6"
        r="5.6"
        stroke={c1}
        strokeWidth="1.34"
      />
      <circle
        data-ink="1"
        pathLength="1"
        cx="130"
        cy="13.6"
        r="5.6"
        stroke={c1}
        strokeWidth="1.34"
      />
      <path
        data-ink="1"
        pathLength="1"
        d="M115.3 11.8 C117.2 8.8 122.8 8.8 124.7 11.8"
        stroke={c1}
        strokeWidth="1.26"
        strokeLinecap="round"
      />
      <path
        data-ink="1"
        pathLength="1"
        d="M104.4 13.6 H100.8 C94 13.6 88 8.8 78 12.6 C68 16.4 58 13.4 40 12.8 C28 12.4 19 13.4 12 13 C9.6 12.9 9.6 10.4 12 10.4 C13.6 10.4 14 12 12.6 12.7"
        stroke={c1}
        strokeOpacity="0.7"
        strokeWidth="1.12"
        strokeLinecap="round"
      />
      <path
        data-ink="1"
        pathLength="1"
        d="M135.6 13.6 H139.2 C146 13.6 152 8.8 162 12.6 C172 16.4 182 13.4 200 12.8 C212 12.4 221 13.4 228 13 C230.4 12.9 230.4 15.6 228 15.6 C226.4 15.6 226 14 227.4 13.3"
        stroke={c1}
        strokeOpacity="0.7"
        strokeWidth="1.12"
        strokeLinecap="round"
      />

      {/* Stage 2: Folding temple arms & companion parchment ribbon edges */}
      <path
        data-ink="2"
        pathLength="1"
        d="M104.5 12.4 L96.8 8.2 C94.8 7.2 93.2 8.4 94.2 10.2 M135.5 12.4 L143.2 8.2 C145.2 7.2 146.8 8.4 145.8 10.2"
        stroke={c1}
        strokeOpacity="0.82"
        strokeWidth="1.04"
        strokeLinecap="round"
      />
      <path
        data-ink="2"
        pathLength="1"
        d="M100.5 15.4 C93.8 15.8 88 11.6 79.5 14.8 C72 17.4 64.5 16.2 58 13 M139.5 15.4 C146.2 15.8 152 11.6 160.5 14.8 C168 17.4 175.5 16.2 182 13"
        stroke={c2}
        strokeOpacity="0.76"
        strokeWidth="0.94"
        strokeLinecap="round"
      />

      {/* Stage 3: Curved lens reflections, bridge rivet & nose pads */}
      <path
        data-ink="3"
        pathLength="1"
        d="M120 7.2 L121.6 9.4 L120 11.6 L118.4 9.4 Z M107 11.2 A3.6 3.6 0 0 1 110.8 9.8 M127 11.2 A3.6 3.6 0 0 1 130.8 9.8 M114.6 14 C113.8 14.8 113.8 15.8 114.6 16.4 M125.4 14 C126.2 14.8 126.2 15.8 125.4 16.4"
        stroke={c1}
        strokeOpacity="0.62"
        strokeWidth="0.82"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 14 distinct section-edge illustrations organized as 7 complementary
 * "macho y hembra" (Left & Right) reading-themed pairs:
 * - Even motifs (0, 2, 4, 6, 8, 10, 12) sprout directly from x = -2 (left border).
 * - Odd motifs  (1, 3, 5, 7, 9, 11, 13) sprout directly from x = 90 (right border).
 * Every single leaf, berry, flower, book, lantern, candle, or pen is physically
 * attached to a stem, bracket, or shelf rooted past the viewport edge so nothing
 * ever appears detached or floating in mid-air.
 */
export function BookPageEdgeMotif({
  motif,
  side = 'right',
  topPct,
  color,
  secondaryColor,
}: {
  motif: number;
  side?: 'left' | 'right';
  topPct?: number;
  color?: string;
  secondaryColor?: string;
}) {
  const svgRef = useInkDrawOnce(true);
  const c1 = color ?? 'currentColor';
  const c2 = secondaryColor ?? c1;
  const m = Math.abs(motif) % 14;
  const authoredSide = m % 2 === 0 ? 'left' : 'right';
  const flip = side !== authoredSide ? ' is-flipped' : '';
  const cls = `reader-edge-art is-${side} is-motif-${m}${flip}`;
  const style = topPct !== undefined ? { top: `${topPct}%` } : undefined;
  const par = authoredSide === 'left' ? 'xMinYMid meet' : 'xMaxYMid meet';

  switch (m) {
    case 0:
      // Pair 1 Left (Macho): Mediterranean olive bough rooted at x=-2 with veined foliage & plump olives
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M17 126 C27 115 41 112 49 118 C40 128 27 130 17 126 Z M35 91 C48 89 60 81 65 69 C51 67 40 76 35 91 Z M41 66 C30 57 24 46 27 34 C37 40 43 53 41 66 Z M41 30 C35 23 34 15 39 10 C44 16 45 24 41 30 Z"
            fill={c2}
            fillOpacity="0.34"
          />
          <path
            data-wash="1"
            d="M24 118 C14 109 9 96 15 84 C23 93 27 107 24 118 Z M43 52 C55 49 64 42 66 32 C54 32 46 41 43 52 Z"
            fill={c1}
            fillOpacity="0.22"
          />
          <path
            data-wash="2"
            d="M38 103 C41 99 46 99 48 102 C49.5 105 47 109 43 110 C39.5 110.5 36.5 106.5 38 103 Z M17 67 C19.5 63.5 24.5 64 26.5 67.5 C28 70.5 25 74.5 21 74.5 C17.5 74.5 15 70 17 67 Z M52 25 C55 21.5 60 22 61.5 25.5 C63 28.5 60 32.5 56 32.5 C52.5 32.5 50 28 52 25 Z"
            fill={c1}
            fillOpacity="0.78"
          />

          {/* Stage 1: Woody olive bough growing out of x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 162 C15 142 30 108 40 72 C44 54 44 38 41 30 M-2 168 C7 159 13 150 18 140 M-2 136 C6 131 12 128 17 126"
            stroke={c1}
            strokeWidth="1.55"
            strokeLinecap="round"
          />

          {/* Stage 2: Slender olive leaves, curved pedicels & olive contours */}
          <path
            data-ink="2"
            pathLength="1"
            d="M17 126 C27 115 41 112 49 118 C40 128 27 130 17 126 Z M35 91 C48 89 60 81 65 69 C51 67 40 76 35 91 Z M41 66 C30 57 24 46 27 34 C37 40 43 53 41 66 Z M41 30 C35 23 34 15 39 10 C44 16 45 24 41 30 Z"
            stroke={c2}
            strokeWidth="1.18"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M24 118 C14 109 9 96 15 84 C23 93 27 107 24 118 Z M43 52 C55 49 64 42 66 32 C54 32 46 41 43 52 Z"
            stroke={c1}
            strokeOpacity="0.88"
            strokeWidth="1.15"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M29 109 Q33.8 106 38 104 M38 103 C41 99 46 99 48 102 C49.5 105 47 109 43 110 C39.5 110.5 36.5 106.5 38 103 Z M37.5 81 Q32 76.5 26.5 71 M17 67 C19.5 63.5 24.5 64 26.5 67.5 C28 70.5 25 74.5 21 74.5 C17.5 74.5 15 70 17 67 Z M43.5 41 Q48.2 35.8 52.5 30 M52 25 C55 21.5 60 22 61.5 25.5 C63 28.5 60 32.5 56 32.5 C52.5 32.5 50 28 52 25 Z"
            stroke={c1}
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Delicate leaf midribs, olive highlights & bark pen-hatch */}
          <path
            data-ink="3"
            pathLength="1"
            d="M18 125.5 C27 122 37 120 45 118.5 M23.5 116.5 C19 106 16 96 15.5 87.5 M36 90 C46 83 55 77 62 71 M40.5 64.5 C35 54 31 45 28 37 M44 51.2 C52 45 59 39 63.5 34 M40.8 29 Q40.2 21 39.2 13 M6 155 Q9.5 151 12.5 147 M14 143 Q17.5 138.5 20 134 M41 107.5 Q44.5 107.8 46.2 105.2 M19.5 72 Q23 72.2 24.8 69.8"
            stroke={c2}
            strokeOpacity="0.68"
            strokeWidth="0.82"
            strokeLinecap="round"
          />
        </svg>
      );

    case 1:
      // Pair 1 Right (Hembra): Blossoming bay laurel branch rooted at x=90 with 5-petal flower & buds
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M75 44 C64 36 53 36 47 44 C56 50 67 49 75 44 Z M64 63 C50 55 37 59 31 70 C44 76 56 73 64 63 Z M50 95 C36 89 25 94 21 105 C33 111 44 106 50 95 Z M45 138 C56 138 66 144 69 154 C58 155 49 148 45 138 Z"
            fill={c2}
            fillOpacity="0.34"
          />
          <path
            data-wash="1"
            d="M57 77 C69 77 78 84 80 95 C68 95 60 87 57 77 Z"
            fill={c1}
            fillOpacity="0.2"
          />
          <path
            data-wash="1"
            d="M42 122 C37 113 40 107 43 109 C45 107 48 113 42 122 Z M42 122 C50 116 56 119 54 122 C56 125 50 128 42 122 Z M42 122 C49 129 47 136 44 134 C42 136 39 130 42 122 Z M42 122 C35 130 29 129 31 126 C29 123 34 119 42 122 Z M42 122 C33 118 30 112 34 112 C35 109 40 114 42 122 Z M60 53 C53 50 51 55 56 59 C60 60 62 56 60 53 Z M49 159 C45 164 49 170 53 166 C55 163 52 159 49 159 Z"
            fill={c1}
            fillOpacity="0.32"
          />
          <path
            data-wash="2"
            d="M42 118.4 Q43.8 120.3 45.2 122 Q43.8 123.7 42 125.6 Q40.2 123.7 38.8 122 Q40.2 120.3 42 118.4 Z"
            fill={c1}
            fillOpacity="0.9"
          />

          {/* Stage 1: Arching laurel bough growing out of x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 20 C73 42 56 76 46 114 C43 130 45 146 49 160 M90 40 C84 42 79 43 75 44"
            stroke={c2}
            strokeWidth="1.52"
            strokeLinecap="round"
          />

          {/* Stage 2: Bay laurel leaves, 5-petal blossom & calyx buds */}
          <path
            data-ink="2"
            pathLength="1"
            d="M75 44 C64 36 53 36 47 44 C56 50 67 49 75 44 Z M64 63 C50 55 37 59 31 70 C44 76 56 73 64 63 Z M57 77 C69 77 78 84 80 95 C68 95 60 87 57 77 Z M50 95 C36 89 25 94 21 105 C33 111 44 106 50 95 Z M45 138 C56 138 66 144 69 154 C58 155 49 148 45 138 Z"
            stroke={c2}
            strokeWidth="1.18"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M46 114 Q44.2 118 42 122 M42 122 C37 113 40 107 43 109 C45 107 48 113 42 122 Z M42 122 C50 116 56 119 54 122 C56 125 50 128 42 122 Z M42 122 C49 129 47 136 44 134 C42 136 39 130 42 122 Z M42 122 C35 130 29 129 31 126 C29 123 34 119 42 122 Z M42 122 C33 118 30 112 34 112 C35 109 40 114 42 122 Z"
            stroke={c1}
            strokeWidth="1.14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M69 52 Q64.5 53.4 60 54 M60 53 C53 50 51 55 56 59 C60 60 62 56 60 53 Z M49 159 C45 164 49 170 53 166 C55 163 52 159 49 159 Z"
            stroke={c1}
            strokeWidth="1.12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Pinnate leaf midribs, blossom diamond contour & stamens */}
          <path
            data-ink="3"
            pathLength="1"
            d="M42 118.4 Q43.8 120.3 45.2 122 Q43.8 123.7 42 125.6 Q40.2 123.7 38.8 122 Q40.2 120.3 42 118.4 Z M73.5 44 Q62 43.2 51 43.5 M62.5 63.5 C52 65 42 67 34.5 69.5 M58.2 78 C66 83 72 88 77.5 93.5 M48.8 95.8 C39 98 30 101 24.5 104 M46.2 139 C54 143 61 148 66.5 152.5 M42 118.4 Q42.5 115.8 42.8 113.5 M45.2 122 Q47.8 121.6 50.2 121.8 M42 125.6 Q43.2 128 44.2 130.2 M38.8 122 Q36.4 123.6 34.2 124.8 M40 120 Q37.8 117.4 35.8 115.2"
            stroke={c2}
            strokeOpacity="0.72"
            strokeWidth="0.82"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 2:
      // Pair 2 Left (Macho): Stacked hardcover volumes on carved corbel shelf at x=-2 with silk ribbon & diamond charm
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M-2 86 Q30 85.4 61 86 C58 92 58 100 61 106 Q30 106.4 -2 106 Z M-2 52 Q21.5 51.5 45 52 C42.5 56.5 42.5 63.5 45 68 Q21.5 68.4 -2 68 Z"
            fill={c1}
            fillOpacity="0.22"
          />
          <path
            data-wash="1"
            d="M-2 68 Q24 67.5 50 68 C54 68 55.5 71.5 55.5 77 C55.5 82.5 54 86 50 86 Q24 86.4 -2 86 Z M-2 26 Q12 39.2 26 52 L13 52 Q5.5 45.2 -2 38 Z M-2 106 Q33 105.5 68 106 C70 106 70 111 68 111.5 Q33 112 -2 111.5 Z"
            fill={c2}
            fillOpacity="0.25"
          />
          <path
            data-wash="2"
            d="M43 96 Q45.2 95.8 47.5 96 C53 106 53 120 47.5 133 C44.5 140 46 146 48 152 L44.5 149 L41 153 C39.5 146 39.5 139 43 131 C48 119 48 106 43 96 Z M45.5 155 Q47.6 158.3 49.2 161.5 Q47.6 164.7 45.5 168 Q43.4 164.7 41.8 161.5 Q43.4 158.3 45.5 155 Z"
            fill={c1}
            fillOpacity="0.72"
          />

          {/* Stage 1: Molded library shelf & carved S-scroll corbel rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 106 Q33 105.5 68 106 C70.5 106 70.5 111.5 68 111.5 Q33 112 -2 111.5 M-2 148 C14 148 20 132 29 121 C35 114 44 111.5 55 111.5"
            stroke={c1}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Stacked folio, octavo, pocket volume, leaning chapbook & full silk bookmark */}
          <path
            data-ink="2"
            pathLength="1"
            d="M-2 86 Q30 85.4 62.5 86 M-2 106 Q30 106.4 62.5 106 M60.5 86 C57.8 91.5 57.8 100.5 60.5 106 M-2 68 Q24 67.5 50 68 C54 68 55.5 71.5 55.5 77 C55.5 82.5 54 86 50 86 M-2 52 Q22 51.5 46.5 52 M44.5 52 C42.2 56.5 42.2 63.5 44.5 68 M-2 26 Q12 39.2 26 52 M-2 38 Q5.5 45.2 13 52"
            stroke={c1}
            strokeWidth="1.32"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M43 96 Q45.2 95.8 47.5 96 C53 106 53 120 47.5 133 C44.5 140 46 146 48 152 L44.5 149 L41 153 C39.5 146 39.5 139 43 131 C48 119 48 106 43 96 Z M44.5 149 Q45.2 152 45.5 155 M45.5 155 Q47.6 158.3 49.2 161.5 Q47.6 164.7 45.5 168 Q43.4 164.7 41.8 161.5 Q43.4 158.3 45.5 155 Z M7 136 C13 136 15.5 128 10.5 126 C6.5 124.5 5.5 130 8.8 131.8"
            stroke={c2}
            strokeWidth="1.16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Fore-edge page striations, raised spine bands, gilt diamond & wood grain hatches */}
          <path
            data-ink="3"
            pathLength="1"
            d="M-2 91 Q28 90.6 58.6 91 M-2 96 Q28 96.4 58 96 M-2 101 Q28 100.6 58.6 101 M-2 57.2 Q20 56.8 42.8 57.2 M-2 62.6 Q20 63 42.8 62.6 M12 68 Q11.5 77 12 86 M26 68 Q25.5 77 26 86 M40 68 Q39.5 77 40 86 M33 74 Q34.4 75.5 35.4 77 Q34.4 78.5 33 80 Q31.6 78.5 30.6 77 Q31.6 75.5 33 74 Z M15 115 Q20 118 24 122 M21 113.5 Q26 116 30 119.5"
            stroke={c1}
            strokeOpacity="0.58"
            strokeWidth="0.84"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 3:
      // Pair 2 Right (Hembra): Open fluttering tome on slanted wall lectern at x=90 with braided diamond tassel
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M90 112 Q62 106.2 34 100 L36.5 95.5 Q63 101.4 90 107 Z M90 102 C72 94 56 80 43 78 C50 66 66 62 90 72 Z M90 94 C78 78 68 56 58 46 C68 40 80 42 90 50 Z"
            fill={c1}
            fillOpacity="0.18"
          />
          <path
            data-wash="1"
            d="M90 106 C74 102 54 92 40 94 C44 82 60 76 90 84 Z M90 98 C74 86 60 66 48 60 C58 50 72 50 90 60 Z M90 122 Q59 121.5 28 122 C25.5 122 25.5 127 28 127.2 Q59 127.6 90 127.2 Z"
            fill={c2}
            fillOpacity="0.24"
          />
          <path
            data-wash="2"
            d="M48 147 Q50 149.8 51.6 152.5 Q50 155.2 48 158 Q46 155.2 44.4 152.5 Q46 149.8 48 147 Z M45 158 Q48 157.6 51 158 L53.5 168 Q48 168.6 42.5 168 Z"
            fill={c1}
            fillOpacity="0.78"
          />

          {/* Stage 1: Slanted wall lectern & forged scroll bracket rooted at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 122 Q59 121.5 28 122 C25.2 122 25.2 127.2 28 127.2 Q59 127.6 90 127.2 M90 115 Q60.5 109 31 102.5 M90 156 C72 156 64 139 54 131 C48 127.2 41 127.2 35 127.2"
            stroke={c1}
            strokeWidth="1.48"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: 4 organic fluttering pages, leather board & hanging braided tassel */}
          <path
            data-ink="2"
            pathLength="1"
            d="M90 111.5 Q62 105.8 34 99.5 L36.5 95.5 Q63 101.4 90 106.8 M90 106 C74 102 54 92 40 94 C44 82 60 76 90 84 M90 102 C72 94 56 80 43 78 C50 66 66 62 90 72"
            stroke={c1}
            strokeWidth="1.24"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M90 98 C74 86 60 66 48 60 C58 50 72 50 90 60 M90 94 C78 78 68 56 58 46 C68 40 80 42 90 50"
            stroke={c2}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M55 107.5 C51 119 53 134 48 147 M48 147 Q50 149.8 51.6 152.5 Q50 155.2 48 158 Q46 155.2 44.4 152.5 Q46 149.8 48 147 Z M45 158 Q48 157.6 51 158 L53.5 168 Q48 168.6 42.5 168 Z M80 143 C74 143 71.5 135 76.5 133 C80.5 131.5 81.5 137 78.2 138.8"
            stroke={c2}
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Curved manuscript text hints on open leaf, tassel threads & bracket hatches */}
          <path
            data-ink="3"
            pathLength="1"
            d="M57 59 C66 56 76 58 86 64 M54 64 C64 61 75 64 86 70 M64 47 C72 45 80 47 87 52 M46.5 158 Q46 163 45.2 168 M49.5 158 Q50 163 50.8 168 M63 130 Q59 133 56 136 M69 130.5 Q65 134 61.5 138"
            stroke={c1}
            strokeOpacity="0.56"
            strokeWidth="0.82"
            strokeLinecap="round"
          />
        </svg>
      );

    case 4:
      // Pair 3 Left (Macho): Domed brass reading kettle on carved corbel shelf at x=-2 with rising steam
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M-2 88 Q13 87.5 28 88 C39.5 88 43.5 98.5 41 112.5 C39.5 120.5 36 124 33.5 124 L35.5 128 Q16 128.4 -2 128 Z M39.5 114 C48 111.5 52 98 56.5 87.5 C58.5 82.8 61.2 80.2 64 81.2 L61.2 86 C57.2 90 54 104 40.5 120 Z"
            fill={c1}
            fillOpacity="0.24"
          />
          <path
            data-wash="1"
            d="M-2 88 C4 78.5 20.5 78.5 26.5 88 Z M-2 128 Q28 127.5 58 128 C60.5 128 60.5 133 58 133.2 Q28 133.6 -2 133.2 Z"
            fill={c2}
            fillOpacity="0.26"
          />
          <path
            data-wash="2"
            d="M12.2 79.2 Q14 76.5 15.4 73.8 Q14 71.1 12.2 68.4 Q10.4 71.1 9 73.8 Q10.4 76.5 12.2 79.2 Z"
            fill={c1}
            fillOpacity="0.86"
          />

          {/* Stage 1: Molded wooden shelf & S-scroll corbel rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 128 Q28 127.5 58 128 C60.8 128 60.8 133.2 58 133.2 Q28 133.6 -2 133.2 M-2 160 C16 160 22 144 32 136 C37 133.2 43 133.2 49 133.2"
            stroke={c2}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Brass kettle belly, domed lid, arched handle & gooseneck spout */}
          <path
            data-ink="2"
            pathLength="1"
            d="M-2 88 Q13 87.5 28 88 C39.5 88 43.5 98.5 41 112.5 C39.5 120.5 36 124 33.5 124 Q16 124.4 -2 124 M35.5 124 Q36.6 126 37.5 128 M-2 88 C4 78.5 20.5 78.5 26.5 88 M12.2 79.2 Q14 76.5 15.4 73.8 Q14 71.1 12.2 68.4 Q10.4 71.1 9 73.8 Q10.4 76.5 12.2 79.2 Z"
            stroke={c1}
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M-2 60 C16.5 54 32.5 64 31.2 88 M-2 64.2 C13.5 59.2 27.2 67.2 27 88 M39.5 114 C48 111.5 52 98 56.5 87.5 C58.5 82.8 61.2 80.2 64 81.2 L61.2 86 C57.2 90 54 104 40.5 120"
            stroke={c1}
            strokeWidth="1.28"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Intertwined steam plumes rising from spout & hand-shaded brass belly */}
          <path
            data-ink="3"
            pathLength="1"
            d="M63.5 80.5 C55 68 67 54 58 40 C51 29 60 19 56 12 M61 79.5 C67 68 55 56 63 44 C68 35 62 26 64 18"
            stroke={c2}
            strokeOpacity="0.7"
            strokeWidth="1.12"
            strokeLinecap="round"
          />
          <path
            data-ink="3"
            pathLength="1"
            d="M-2 105.5 Q19 108.5 41.6 105.5 M27.5 93 C33.5 97 34.5 108 30.5 118 M7 149 C13 149 15.5 141 10.5 139 C6.5 137.5 5.5 143 8.8 144.8 M8 115 Q13 119 19 121 M16 116 Q21 119.5 26 121.2 M18 136 Q22.5 139.5 26 143"
            stroke={c1}
            strokeOpacity="0.58"
            strokeWidth="0.86"
            strokeLinecap="round"
          />
        </svg>
      );

    case 5:
      // Pair 3 Right (Hembra): Fluted porcelain teacup & saucer on book shelf at x=90 with diamond tea tag
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M90 118 Q61 117.5 32 118 C28 118 26 121 26 126 C26 131 28 134 32 134 Q61 134.4 90 134 Z M90 134 Q56 133.5 22 134 C19.5 134 19.5 139 22 139.2 Q56 139.6 90 139.2 Z"
            fill={c2}
            fillOpacity="0.24"
          />
          <path
            data-wash="1"
            d="M43 82 Q63 82.6 83 82 C83 96 78 108 69 110 L69 112 L57 112 L57 110 C48 108 43 96 43 82 Z M38 112 Q63 112.5 88 112 C86 116 81 118 74 118 Q63 118.4 52 118 C45 118 40 116 38 112 Z"
            fill={c1}
            fillOpacity="0.22"
          />
          <path
            data-wash="2"
            d="M79 98.5 Q81 101.2 82.6 104 Q81 106.8 79 109.5 Q77 106.8 75.4 104 Q77 101.2 79 98.5 Z"
            fill={c1}
            fillOpacity="0.82"
          />

          {/* Stage 1: Molded shelf, scroll corbel & resting hardcover book rooted at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 134 Q56 133.5 22 134 C19.2 134 19.2 139.2 22 139.2 Q56 139.6 90 139.2 M90 162 C72 162 66 147 56 141 C50 139.2 44 139.2 38 139.2 M90 118 Q61 117.5 32 118 C28 118 26 121 26 126 C26 131 28 134 32 134"
            stroke={c2}
            strokeWidth="1.46"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Porcelain saucer, footed bell teacup, ear handle & tea-bag tag */}
          <path
            data-ink="2"
            pathLength="1"
            d="M38 112 Q63 112.5 88 112 C86 116 81 118 74 118 Q63 118.4 52 118 C45 118 40 116 38 112 Z M43 82 Q63 82.6 83 82 C83 96 78 108 69 110 Q69.2 111 69 112 M57 112 Q56.8 111 57 110 C48 108 43 96 43 82"
            stroke={c1}
            strokeWidth="1.32"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M43.4 87 C33 84 28 90 30 97.2 C31.5 102.2 37.2 104.2 45.6 103 M43.6 90.8 C36.2 88.8 33.2 92.5 34.2 96.5 C35 99.4 39 100.4 44.6 99.8 M74 82 C77 86 78.5 92 79 98.5 M79 98.5 Q81 101.2 82.6 104 Q81 106.8 79 109.5 Q77 106.8 75.4 104 Q77 101.2 79 98.5 Z"
            stroke={c1}
            strokeWidth="1.18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Painted botanical cup motif, fluted ribs, spine bands & rising steam wisps */}
          <path
            data-ink="3"
            pathLength="1"
            d="M57 80.5 C51 68 62 56 55 42 C50 32 58 22 55 14 M67 80.5 C73 69 63 58 69 46 C73 38 67 30 69 22"
            stroke={c1}
            strokeOpacity="0.64"
            strokeWidth="1.06"
            strokeLinecap="round"
          />
          <path
            data-ink="3"
            pathLength="1"
            d="M43.6 86.2 Q59 86.8 74.5 86.2 M61 93.2 Q62.4 95 63.5 96.8 Q62.4 98.6 61 100.4 Q59.6 98.6 58.5 96.8 Q59.6 95 61 93.2 Z M54.5 96.8 Q55.8 96.5 57 96.8 M65 96.8 Q66.2 96.5 67.5 96.8 M50 90 C50.5 97 52.5 103 55.5 107 M72 90 C71.5 97 69.5 103 66.5 107 M35 118 Q34.5 126 35 134 M48 118 Q47.5 126 48 134 M56 123 Q72 122.6 88 123 M56 128.5 Q72 128.9 88 128.5 M80 150 C74 150 71.5 143 76.5 141 C80.5 139.5 81.5 145 78.2 146.8"
            stroke={c2}
            strokeOpacity="0.66"
            strokeWidth="0.84"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 6:
      // Pair 4 Left (Macho): Pressed 8-petal cosmos blossom, nodding bud & bipinnate foliage at x=-2
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M45 37 C41 26 42 17 45 18.5 C48 17 49 26 45 37 Z M50 42 C61 38 70 39 68.5 42 C70 45 61 46 50 42 Z M45 47 C49 58 48 67 45 65.5 C42 67 41 58 45 47 Z M40 42 C29 46 20 45 21.5 42 C20 39 29 38 40 42 Z M55 93 C58 84 65 81 66 85 C68 88 62 95 55 93 Z"
            fill={c1}
            fillOpacity="0.28"
          />
          <path
            data-wash="1"
            d="M48.5 38.5 C54 28 61 22 62 25 C65 26 59 33 48.5 38.5 Z M48.5 45.5 C59 51 65 58 62 59 C61 62 54 56 48.5 45.5 Z M41.5 45.5 C36 56 29 62 28 59 C25 58 31 51 41.5 45.5 Z M41.5 38.5 C31 33 25 26 28 25 C29 22 36 28 41.5 38.5 Z"
            fill={c2}
            fillOpacity="0.24"
          />
          <circle
            data-wash="2"
            cx="45"
            cy="42"
            r="5"
            fill={c1}
            fillOpacity="0.88"
          />

          {/* Stage 1: Slender cosmos stem & nodding bud branch rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 162 C14 138 28 96 43.5 46.8 M20 122 C33 115 45 106 55 93 M-2 138 C5 134 11 131 15 129"
            stroke={c2}
            strokeWidth="1.48"
            strokeLinecap="round"
          />

          {/* Stage 2: 8 notched herbarium cosmos petals, sepal bud & feathery pinnate leaves */}
          <path
            data-ink="2"
            pathLength="1"
            d="M45 37 C41 26 42 17 45 18.5 C48 17 49 26 45 37 Z M50 42 C61 38 70 39 68.5 42 C70 45 61 46 50 42 Z M45 47 C49 58 48 67 45 65.5 C42 67 41 58 45 47 Z M40 42 C29 46 20 45 21.5 42 C20 39 29 38 40 42 Z"
            stroke={c1}
            strokeWidth="1.12"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M48.5 38.5 C54 28 61 22 62 25 C65 26 59 33 48.5 38.5 Z M48.5 45.5 C59 51 65 58 62 59 C61 62 54 56 48.5 45.5 Z M41.5 45.5 C36 56 29 62 28 59 C25 58 31 51 41.5 45.5 Z M41.5 38.5 C31 33 25 26 28 25 C29 22 36 28 41.5 38.5 Z"
            stroke={c1}
            strokeOpacity="0.82"
            strokeWidth="1.05"
            strokeLinejoin="round"
          />
          <circle
            data-ink="2"
            pathLength="1"
            cx="45"
            cy="42"
            r="5.1"
            stroke={c1}
            strokeWidth="1.2"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M55 93 C58 84 65 81 66 85 C68 88 62 95 55 93 Z M52 96 C55 92 59 92 61 95 M15 129 C24 128 32 132 37 139 M21 129 Q25 125.5 29 122 M25 131 Q29.5 129.2 34 128 M31 88 C21 82 14 73 14 64 M23 82 Q18.5 80.2 14 78 M20 77 Q21.2 72 23 67 M34 80 C43 76 50 76 56 80 M43 77 Q46 73.8 49 71"
            stroke={c2}
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Curved longitudinal petal pleats & floret disk pen-stippling */}
          <path
            data-ink="3"
            pathLength="1"
            d="M45 35 Q44.4 29 45 23 M52 42 Q58 41.4 64 42 M45 49 Q45.6 55 45 61 M38 42 Q32 42.6 26 42 M49.5 37.5 Q54.2 33.2 58.5 28.5 M49.5 46.5 Q53.8 51.2 58.5 55.5 M40.5 46.5 Q35.8 50.8 31.5 55.5 M40.5 37.5 Q36.2 32.8 31.5 28.5 M42.8 40.2 Q45 39 47.2 40.2 M42.5 43.6 Q45 44.8 47.5 43.6"
            stroke={c1}
            strokeOpacity="0.54"
            strokeWidth="0.78"
            strokeLinecap="round"
          />
        </svg>
      );

    case 7:
      // Pair 4 Right (Hembra): Unfurling fiddlehead fern frond & young crozier rooted at x=90
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M73 135 C60 130 49 133 44 140 C55 144 66 141 73 135 Z M70 129 C77 121 84 117 89 118 C85 126 78 130 70 129 Z M55 95 C42 89 30 91 25 97 C36 102 47 100 55 95 Z M53 89 C62 81 70 78 76 80 C71 87 62 90 53 89 Z M45.5 61 C36 55 28 56 25 60 C33 64 40 64 45.5 61 Z M45 56 C52 50 59 48 63 50 C59 55 52 57 45 56 Z"
            fill={c2}
            fillOpacity="0.36"
          />
          <path
            data-wash="1"
            d="M63 115 C50 109 38 112 33 119 C44 123 55 121 63 115 Z M61 109 C70 101 78 97 84 99 C79 106 70 110 61 109 Z M49 77 C38 71 28 72 24 77 C33 82 42 81 49 77 Z M48 72 C56 65 64 62 69 64 C65 70 56 73 48 72 Z M44 46 C37 41 32 41 30 44 C35 47 40 48 44 46 Z"
            fill={c1}
            fillOpacity="0.26"
          />

          {/* Stage 1: Main fern rachis curling into Fibonacci fiddlehead spiral + young crozier at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 162 C73 140 57 104 47 64 C43 47 42 31 49 23 C56 17 64 23 61 31.5 C59 37.5 51 38.5 49 33.5 C47.8 29.8 51.8 27.5 54.8 29.8 M90 142 C79 138 71 131 69 122 C68 116.5 73 113.5 76.2 117.5 C78 120.5 74 123.5 72 120.5"
            stroke={c2}
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          {/* Stage 2: 11 graduated curved botanical pinnae rooted directly on rachis */}
          <path
            data-ink="2"
            pathLength="1"
            d="M73 135 C60 130 49 133 44 140 C55 144 66 141 73 135 Z M70 129 C77 121 84 117 89 118 C85 126 78 130 70 129 Z M63 115 C50 109 38 112 33 119 C44 123 55 121 63 115 Z M61 109 C70 101 78 97 84 99 C79 106 70 110 61 109 Z M55 95 C42 89 30 91 25 97 C36 102 47 100 55 95 Z M53 89 C62 81 70 78 76 80 C71 87 62 90 53 89 Z"
            stroke={c2}
            strokeWidth="1.14"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M49 77 C38 71 28 72 24 77 C33 82 42 81 49 77 Z M48 72 C56 65 64 62 69 64 C65 70 56 73 48 72 Z M45.5 61 C36 55 28 56 25 60 C33 64 40 64 45.5 61 Z M45 56 C52 50 59 48 63 50 C59 55 52 57 45 56 Z M44 46 C37 41 32 41 30 44 C35 47 40 48 44 46 Z"
            stroke={c1}
            strokeOpacity="0.88"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />

          {/* Stage 3: Arched pinna midveins & crozier scale ticks */}
          <path
            data-ink="3"
            pathLength="1"
            d="M71.5 135.5 Q59.5 136 48 139 M61.5 115.5 Q49 115.5 37 118 M53.5 95.2 Q41 94.8 29 96.8 M47.8 77 Q37.5 75.8 27.5 76.8 M44.5 61 Q36.2 59.4 28.2 59.8 M71.2 128.2 Q78.5 123 86 119.5 M62.2 108.2 Q71.5 103.2 81 100.2 M54.2 88.2 Q63.5 83.8 73 81 M49.2 71.2 Q57.5 67.2 66 65 M46 55.5 Q53.2 52.2 60.5 50.8 M82 151 Q78.5 147.5 76 143.5"
            stroke={c2}
            strokeOpacity="0.66"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        </svg>
      );

    case 8:
      // Pair 5 Left (Macho): Wrought-iron wall bracket at x=-2 with hexagonal brass reading lantern & diamond charm
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M52 52 C46 52 41.5 56.5 34.5 64 Q52 64.5 69.5 64 C62.5 56.5 58 52 52 52 Z M38 104 Q52 104.4 66 104 L61.5 111.5 Q52 111.8 42.5 111.5 Z"
            fill={c1}
            fillOpacity="0.28"
          />
          <path
            data-wash="1"
            d="M36 64 Q38.2 84 40 104 Q52 104.4 64 104 Q65.8 84 68 64 Z"
            fill={c2}
            fillOpacity="0.14"
          />
          <path
            data-wash="2"
            d="M52 75 C57.2 83.5 57.2 92.5 52 98 C46.8 92.5 46.8 83.5 52 75 Z"
            fill={c1}
            fillOpacity="0.44"
          />
          <path
            data-wash="2"
            d="M52 82.5 C54.6 87.5 54.6 92.5 52 96 C49.4 92.5 49.4 87.5 52 82.5 Z M52 120 Q54.5 123.8 56.5 127.5 Q54.5 131.2 52 135 Q49.5 131.2 47.5 127.5 Q49.5 123.8 52 120 Z"
            fill={c1}
            fillOpacity="0.88"
          />

          {/* Stage 1: Forged iron wall backplate, gooseneck arm & volute brace rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 14 L3.2 18.5 Q3.6 38.5 3.2 58.5 L-2 63 M3.2 26 Q26 25.4 49 26 C55.5 26 57.5 31.2 53.2 35.2 C50.2 38 47.2 35.2 49.2 32.2 M52 36 Q51.7 44 52 52"
            stroke={c1}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="1"
            pathLength="1"
            d="M3.2 52 C14.5 52 20.5 38 30.5 30 C35.5 26 40.5 26 45 26 M11 45 C16.5 45 18.5 38.5 14 36.8 C10.5 35.5 9.5 40.2 12.5 41.8"
            stroke={c2}
            strokeWidth="1.28"
            strokeLinecap="round"
          />

          {/* Stage 2: Pagoda canopy, 3-pane glass body, burner flame & suspended diamond finial */}
          <path
            data-ink="2"
            pathLength="1"
            d="M52 52 C46 52 41.5 56.5 34.5 64 Q52 64.5 69.5 64 C62.5 56.5 58 52 52 52 Z M32.5 64 Q52 64.6 71.5 64 M36 64 Q38.2 84 40 104 Q52 104.4 64 104 Q65.8 84 68 64 M38 104 Q52 104.4 66 104 L61.5 111.5 Q52 111.8 42.5 111.5 Z"
            stroke={c1}
            strokeWidth="1.32"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M45 64 Q46.2 84 47.2 104 M59 64 Q57.8 84 56.8 104 M48.5 104 L48.5 98.5 Q52 98.2 55.5 98.5 L55.5 104 M52 75 C57.2 83.5 57.2 92.5 52 98 C46.8 92.5 46.8 83.5 52 75 Z M52 111.5 Q52.3 115.8 52 120 M52 120 Q54.5 123.8 56.5 127.5 Q54.5 131.2 52 135 Q49.5 131.2 47.5 127.5 Q49.5 123.8 52 120 Z"
            stroke={c2}
            strokeWidth="1.14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Canopy ribs, inner flame core contour, glass glints & iron shading hatches */}
          <path
            data-ink="3"
            pathLength="1"
            d="M52 82.5 C54.6 87.5 54.6 92.5 52 96 C49.4 92.5 49.4 87.5 52 82.5 Z M52 52 Q47.8 58 44 64 M52 52 Q56.2 58 60 64 M40 72 Q41.4 80 42.5 88 M63.5 72 Q62.1 80 61 88 M44.5 106.5 L43.5 110 M48.5 106.5 L47.8 110 M55.5 106.5 L56.2 110 M59.5 106.5 L60.5 110"
            stroke={c1}
            strokeOpacity="0.62"
            strokeWidth="0.84"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 9:
      // Pair 5 Right (Hembra): Brass wall sconce at x=90 with tulip hurricane glass & beeswax taper candle
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M33 113 C28 98 28 74 33 56 C35 48 33 40 31 36 Q44 36.8 57 36 C55 40 53 48 55 56 C60 74 60 98 55 113 Z"
            fill={c2}
            fillOpacity="0.11"
          />
          <path
            data-wash="1"
            d="M90 92 C84 94 83 102 83 118 C83 134 84 142 90 144 Z M39 105 Q39.3 86.5 39 68 C41 66.5 47 66.5 49 68 Q48.7 86.5 49 105 Z M27 113 C32 118.5 56 118.5 61 113 C56 111 32 111 27 113 Z"
            fill={c1}
            fillOpacity="0.24"
          />
          <path
            data-wash="2"
            d="M44 42 C49.2 50 49.2 57.5 44 61.5 C38.8 57.5 38.8 50 44 42 Z"
            fill={c1}
            fillOpacity="0.44"
          />
          <path
            data-wash="2"
            d="M44 49 C46.6 53.2 46.6 57.5 44 60.2 C41.4 57.5 41.4 53.2 44 49 Z"
            fill={c1}
            fillOpacity="0.9"
          />

          {/* Stage 1: Brass wall escutcheon & swan-neck sconce arm rooted at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 92 C84 94 83 102 83 118 C83 134 84 142 90 144 M83 122 C76 122 72 138 62 138 C52 138 44 128 44 117.5 M83 108 C72 108 66 118 60 129"
            stroke={c1}
            strokeWidth="1.48"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Fluted bobeche, candle socket, beeswax taper, flame & tulip glass chimney */}
          <path
            data-ink="2"
            pathLength="1"
            d="M27 113 C32 118.5 56 118.5 61 113 C56 111 32 111 27 113 Z M38 113 Q38.2 109 38 105 Q44 104.6 50 105 Q49.8 109 50 113 M39 105 Q39.3 86.5 39 68 C41 66.5 47 66.5 49 68 Q48.7 86.5 49 105"
            stroke={c1}
            strokeWidth="1.28"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M33 112.5 C28 98 28 74 33 56 C35 48 33 40 31 36 Q44 36.8 57 36 C55 40 53 48 55 56 C60 74 60 98 55 112.5 M44 67 Q43 63.5 44 61 M44 42 C49.2 50 49.2 57.5 44 61.5 C38.8 57.5 38.8 50 44 42 Z"
            stroke={c2}
            strokeOpacity="0.86"
            strokeWidth="1.08"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Inner flame core contour, solidified wax drips, glass specular & beeswax hatches */}
          <path
            data-ink="3"
            pathLength="1"
            d="M44 49 C46.6 53.2 46.6 57.5 44 60.2 C41.4 57.5 41.4 53.2 44 49 Z M39 68 C37.2 74 37.8 80 39 83.5 M46 68 Q45.8 73.5 46 79 C46 81.2 47.6 81.2 47.6 79 Q47.8 75.5 47.6 72 M33.5 96 C31.2 84 31.2 70 35.2 58 M44 42 C42 34 46.5 27 44 18 M40.8 92 Q44 92.8 47.5 92 M40.8 98 Q44 98.8 47.5 98 M85.5 110 L88.5 112 M85.5 118 L88.5 120 M85.5 126 L88.5 128"
            stroke={c1}
            strokeOpacity="0.6"
            strokeWidth="0.84"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 10:
      // Pair 6 Left (Macho): Engraved fountain pen nib at x=-2 drawing a Spencerian figure-8 flourish
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M-2 16 Q11.5 27 24.5 38.5 Q17.8 45.8 10.5 52.5 Q4 47 -2 41.5 Z"
            fill={c2}
            fillOpacity="0.26"
          />
          <path
            data-wash="1"
            d="M25.5 39.5 Q31.8 42.8 37.5 46.5 C41.5 49.5 44.5 58.5 50.5 76.5 C32.5 70.5 23.5 67.5 20.5 63.5 Q15.8 58.5 11.5 53.5 Z"
            fill={c1}
            fillOpacity="0.26"
          />
          <path
            data-wash="1"
            d="M50.5 76.5 C66.5 92.5 64.5 114.5 42.5 120.5 C61 114 63 94 50.5 76.5 Z M36.5 102 C54.5 98 68.5 118 56.5 138.5 C64.5 119 52.5 101.5 36.5 102 Z"
            fill={c2}
            fillOpacity="0.34"
          />
          <path
            data-wash="2"
            d="M27.5 53.5 Q30.2 54.1 32.8 55 Q33.6 57.6 34.2 60.2 Q31.6 59.6 29 58.8 Q28.1 56.2 27.5 53.5 Z"
            fill={c1}
            fillOpacity="0.9"
          />

          {/* Stage 1: Turned pen grip, double brass collar & engraved gold nib body rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 16 Q11.8 27.5 25.5 39.5 M-2 41.5 Q4.8 47.8 11.5 53.5 M22 36.2 Q15.2 43.5 8 50.2 M25.5 39.5 Q18.8 46.8 11.5 53.5 M25.5 39.5 Q31.8 42.8 37.5 46.5 C41.5 49.5 44.5 58.5 50.5 76.5 C32.5 70.5 23.5 67.5 20.5 63.5 Q15.8 58.5 11.5 53.5"
            stroke={c1}
            strokeWidth="1.38"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Diamond breather contour, nib slit & Spencerian figure-8 flourish returning across x=-2 */}
          <path
            data-ink="2"
            pathLength="1"
            d="M27.5 53.5 Q30.2 54.1 32.8 55 Q33.6 57.6 34.2 60.2 Q31.6 59.6 29 58.8 Q28.1 56.2 27.5 53.5 Z M33.8 59.8 Q42.2 68.2 50.5 76.5 C66.5 92.5 64.5 114.5 42.5 120.5 C22 125.5 18 106.5 36.5 102 C54.5 98 68.5 118 56.5 138.5 C46.5 154.5 22 158.5 -2 152"
            stroke={c2}
            strokeWidth="1.42"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Flex-nib shaded downstroke edges, collar hatches & nib shoulder scrollwork */}
          <path
            data-ink="3"
            pathLength="1"
            d="M55.5 83 C64 96 61.5 112.5 45.5 119.5 M44 102.2 C58 104.5 64.5 120.5 54 137 M23.5 45.5 C27.5 47.2 29.5 49.5 27.5 52.5 M17.5 51.5 C19.2 55.5 21.5 57.5 25.5 56.2 M5 26 Q8 32 3 38 M11 31 Q14 37 9 43"
            stroke={c1}
            strokeOpacity="0.62"
            strokeWidth="0.86"
            strokeLinecap="round"
          />
        </svg>
      );

    case 11:
      // Pair 6 Right (Hembra): Cut-crystal inkwell & dipped goose-feather quill on desk shelf at x=90
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M42 134 Q40.2 123 39 112 L48 103 Q59 103.4 70 103 L79 112 Q77.8 123 76 134 Z"
            fill={c1}
            fillOpacity="0.15"
          />
          <path
            data-wash="1"
            d="M51.5 88 C37.5 80 27.5 61 22.5 37 C20.8 27.5 21.8 21.5 24 21.5 C34.5 25.5 46.5 40 52.5 58 C55.5 68 55.2 78.5 51.5 88 Z M90 134 Q61 133.5 32 134 C29.5 134 29.5 139 32 139.2 Q61 139.6 90 139.2 Z"
            fill={c2}
            fillOpacity="0.3"
          />
          <path
            data-wash="2"
            d="M41.8 120 Q59 122.8 76.2 120 L74.6 132 Q59 132.4 43.4 132 Z M49 97 Q59 96.7 69 97 L69 103 Q59 103.3 49 103 Z"
            fill={c1}
            fillOpacity="0.38"
          />

          {/* Stage 1: Molded desk shelf & scroll corbel rooted at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 134 Q61 133.5 32 134 C29.2 134 29.2 139.2 32 139.2 Q61 139.6 90 139.2 M90 160 C74 160 66 146 56 140.5 C50 139.2 44 139.2 39 139.2"
            stroke={c1}
            strokeWidth="1.46"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Octagonal crystal inkwell, hinged brass collar & dipped goose quill */}
          <path
            data-ink="2"
            pathLength="1"
            d="M42 134 Q40.2 123 39 112 L48 103 Q59 103.4 70 103 L79 112 Q77.8 123 76 134 M49 103 L49 97 Q59 96.7 69 97 L69 103 M69 97 L78 89 C80.2 91 80.2 95 77.2 97 L69 100"
            stroke={c1}
            strokeWidth="1.32"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M58 118 C52 89 40 53 24 21.5 M51.5 88 C39.5 81 30.5 66 25.5 48 L29.5 50.5 L24.5 43.5 C21.5 32 21.5 22 24 21.5 C33 25 43.5 36.5 49.5 51 L46.2 48.5 L51 55.5 C55 66.5 55 78 51.5 88 Z"
            stroke={c2}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Beveled crystal facets, full ink pool contour, ink ripples & feather barbs */}
          <path
            data-ink="3"
            pathLength="1"
            d="M49 103 Q47.8 118.5 47 134 M69 103 Q70.2 118.5 71 134 M39 112 Q59 112.6 79 112 M41.8 120 Q59 122.8 76.2 120 L74.6 132 Q59 132.4 43.4 132 Z M47 125.5 Q59 126.8 71 125.5 M50 129 Q59 129.8 68 129 M53 98.5 L53 101.8 M65 98.5 L65 101.8 M47.5 76 Q41.5 72.2 35.5 68 M43.5 64 Q37.2 59.8 31 55 M38.5 51 Q32.5 46.2 26.5 41 M33.5 39 Q29 35.2 24.5 31 M48.5 73 Q51.2 68.5 53.5 64 M43 59 Q46 54 48.5 49 M37 45 Q39.5 40.5 41.5 36"
            stroke={c1}
            strokeOpacity="0.6"
            strokeWidth="0.82"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 12:
      // Pair 7 Left (Macho): Brass armillary astrolabe with zodiac band & star alidade mounted at x=-2
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M-2 36 A54 54 0 0 1 -2 144 L-2 137 A47 47 0 0 0 -2 43 Z"
            fill={c1}
            fillOpacity="0.2"
          />
          <path
            data-wash="1"
            d="M-2 64 C24 66 42 77 42 90 C42 103 24 114 -2 116 L-2 110.5 C20 108.5 35.5 99.5 35.5 90 C35.5 80.5 20 71.5 -2 69.5 Z"
            fill={c2}
            fillOpacity="0.28"
          />
          <path
            data-wash="2"
            d="M60 64.5 Q61.4 67.5 62.4 69.8 Q65 70.8 68 72 Q65 73.2 62.4 74.2 Q61.4 76.5 60 79.5 Q58.6 76.5 57.6 74.2 Q55 73.2 52 72 Q55 70.8 57.6 69.8 Q58.6 67.5 60 64.5 Z"
            fill={c1}
            fillOpacity="0.9"
          />
          <path
            data-wash="2"
            d="M54 86 Q56.2 88.2 58 90 Q56.2 91.8 54 94 Q51.8 91.8 50 90 Q51.8 88.2 54 86 Z"
            fill={c2}
            fillOpacity="0.82"
          />

          {/* Stage 1: Brass wall escutcheon, outer meridian ring & equinox bar rooted at x=-2 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M-2 30 L3 34 Q3.4 90 3 146 L-2 150 M-2 36 A54 54 0 0 1 -2 144 M-2 43 A47 47 0 0 1 -2 137 M-2 90 Q24 89.6 50 90"
            stroke={c1}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Equatorial rings, tilted ecliptic band, diamond finial & star alidade */}
          <path
            data-ink="2"
            pathLength="1"
            d="M-2 58 A32 32 0 0 1 -2 122 M-2 64 C24 66 42 77 42 90 C42 103 24 114 -2 116 M-2 69.5 C20 71.5 35.5 80.5 35.5 90 C35.5 99.5 20 108.5 -2 110.5 M54 86 Q56.2 88.2 58 90 Q56.2 91.8 54 94 Q51.8 91.8 50 90 Q51.8 88.2 54 86 Z"
            stroke={c2}
            strokeWidth="1.16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M-2 74 A16 16 0 0 1 -2 106 M-2 100 Q28 86.2 57.6 73.2 M60 64.5 Q61.4 67.5 62.4 69.8 Q65 70.8 68 72 Q65 73.2 62.4 74.2 Q61.4 76.5 60 79.5 Q58.6 76.5 57.6 74.2 Q55 73.2 52 72 Q55 70.8 57.6 69.8 Q58.6 67.5 60 64.5 Z"
            stroke={c1}
            strokeWidth="1.22"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Clockwork degree graduations along meridian band, ecliptic hatches & Gothic rete pointers */}
          <path
            data-ink="3"
            pathLength="1"
            d="M21.5 49.3 L25 43.2 M31.2 56.8 L36.2 51.8 M38.7 66.5 L44.8 63 M43.4 77.8 L50.2 76 M43.4 102.2 L50.2 104 M38.7 113.5 L44.8 117 M31.2 123.2 L36.2 128.2 M21.5 130.7 L25 136.8 M16 64 C18 70 15 74 11 76 M16 116 C18 110 15 106 11 104 M24 72.5 L22 76.8 M32 78.5 L29.5 82 M24 107.5 L22 103.2"
            stroke={c1}
            strokeOpacity="0.64"
            strokeWidth="0.86"
            strokeLinecap="round"
          />
        </svg>
      );

    default:
      // Pair 7 Right (Hembra): Scholar's wire-rim spectacles resting on open manuscript & scroll shelf at x=90
      return (
        <svg
          ref={svgRef}
          className={cls}
          style={style}
          viewBox="0 0 88 180"
          preserveAspectRatio={par}
          fill="none"
          aria-hidden="true"
        >
          {/* Watercolor washes */}
          <path
            data-wash="1"
            d="M90 106 Q62 105.5 34 106 C38 106 40 115 32 124 Q61 124.4 90 124 Z M90 124 Q58 123.5 26 124 C23.5 124 23.5 129 26 129.2 Q58 129.6 90 129.2 Z"
            fill={c2}
            fillOpacity="0.22"
          />
          <path
            data-wash="1"
            d="M48 106 C44 118 48 132 42 146 Q50 146.4 58 146 C63 134 60 120 64 106 Z"
            fill={c1}
            fillOpacity="0.18"
          />
          <circle
            data-wash="1"
            cx="45"
            cy="93.5"
            r="10.5"
            fill={c1}
            fillOpacity="0.14"
          />
          <circle
            data-wash="1"
            cx="70"
            cy="93.5"
            r="10.5"
            fill={c1}
            fillOpacity="0.14"
          />
          <path
            data-wash="2"
            d="M51.5 130 Q53.2 132.5 54.6 135 Q53.2 137.5 51.5 140 Q49.8 137.5 48.4 135 Q49.8 132.5 51.5 130 Z"
            fill={c1}
            fillOpacity="0.84"
          />

          {/* Stage 1: Carved shelf, scroll corbel & open parchment manuscript rooted at x=90 */}
          <path
            data-ink="1"
            pathLength="1"
            d="M90 124 Q58 123.5 26 124 C23.2 124 23.2 129.2 26 129.2 Q58 129.6 90 129.2 M90 154 C74 154 66 138 56 131 C50 129.2 44 129.2 38 129.2 M90 106 Q62 105.5 34 106 C38 106 40 115 32 124 M90 101.5 C74 101.5 52 100 36 106"
            stroke={c2}
            strokeWidth="1.44"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 2: Round wire-rim spectacles, saddle bridge, temple arms & draping scroll */}
          <circle
            data-ink="2"
            pathLength="1"
            cx="45"
            cy="93.5"
            r="10.5"
            stroke={c1}
            strokeWidth="1.4"
          />
          <circle
            data-ink="2"
            pathLength="1"
            cx="70"
            cy="93.5"
            r="10.5"
            stroke={c1}
            strokeWidth="1.4"
          />
          <path
            data-ink="2"
            pathLength="1"
            d="M55.1 90.5 C56.5 85.8 58.5 85.8 59.9 90.5 M34.5 92 Q42.2 82.8 50 74 Q70 72.2 90 71 M80.5 92 Q85.2 87.2 90 83 M48 106 C44 118 48 132 42 146 Q50 146.4 58 146 C63 134 60 120 64 106 M42 146 C42 142.5 46 142.5 46 146"
            stroke={c1}
            strokeWidth="1.24"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Stage 3: Scroll diamond seal contour, hinge barrels, nose pads, glass glints & wavy manuscript lines */}
          <path
            data-ink="3"
            pathLength="1"
            d="M51.5 130 Q53.2 132.5 54.6 135 Q53.2 137.5 51.5 140 Q49.8 137.5 48.4 135 Q49.8 132.5 51.5 130 Z M32.2 92 Q33.4 91.8 34.6 92 M80.4 92 Q81.6 91.8 82.8 92 M54 93.5 C53 95 53 97 54.2 98 M61 93.5 C62 95 62 97 60.8 98 M39.5 88.5 A7 7 0 0 1 46.5 86.2 M64.5 88.5 A7 7 0 0 1 71.5 86.2 M48.5 114 Q54 113.4 59.5 114 M48.5 119 Q53.5 119.6 58.5 119 M48.5 124 Q53.5 123.5 58 124 M68 112 Q77 111.5 86 112 M68 117 Q77 117.5 86 117 M66 133 Q62 136 59 139.5"
            stroke={c1}
            strokeOpacity="0.62"
            strokeWidth="0.84"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

function computeArtStridePages(totalVirtualPages: number): number {
  const p = Math.max(1, totalVirtualPages);
  const targetIllustrations = Math.min(
    28,
    Math.max(2, Math.round(Math.sqrt(p) * 1.95)),
  );
  return Math.max(2, Math.round(p / targetIllustrations));
}

export function resolveMarginArtLayout(
  index: number,
  forceShow = false,
  seed = 0,
  totalPages = 24,
): {
  showLeft: boolean;
  showRight: boolean;
  leftMotif: number;
  rightMotif: number;
  leftTopPct: number;
  rightTopPct: number;
} | null {
  const n = Math.abs(index);

  if (forceShow || n === 0) {
    const pairSlot = n === 0 || n === 1 ? 0 : 6;
    const pairIdx = bookPairForSlot(seed, pairSlot);
    const leftHigh = ((seed + pairSlot) & 1) === 0;
    const jitter = Math.abs(seed + n * 7);
    return {
      showLeft: true,
      showRight: true,
      leftMotif: pairIdx * 2,
      rightMotif: pairIdx * 2 + 1,
      leftTopPct: leftHigh
        ? 14 + ((jitter * 11) % 14)
        : 42 + ((jitter * 13) % 14),
      rightTopPct: leftHigh
        ? 44 + ((jitter * 17) % 14)
        : 16 + ((jitter * 19) % 14),
    };
  }

  // Adaptive cadence scaled by totalPages (5-page 2-of-5 baseline on normal ~25p books,
  // stretching automatically to 1 every N pages on long/10x books):
  const stride = computeArtStridePages(totalPages);
  if (stride <= 2) {
    // 2 of every 5 pages (same calm Slide cadence for short/normal books)
    const slot = n % 5;
    if (slot !== 2 && slot !== 4) return null;
    const illustrationIdx = Math.floor(n / 5) * 2 + (slot === 4 ? 1 : 0);
    const { motif, side } = bookMotifForSlot(seed, illustrationIdx + 2);
    const pairIdx = Math.floor(motif / 2);
    const topPct = 18 + (((illustrationIdx + seed) * 17) % 34);
    return {
      showLeft: side === 'left',
      showRight: side === 'right',
      leftMotif: pairIdx * 2,
      rightMotif: pairIdx * 2 + 1,
      leftTopPct: topPct,
      rightTopPct: topPct,
    };
  }

  if ((n - 1) % stride !== stride - 1) return null;

  const illustrationIdx = Math.floor((n - 1) / stride);
  const { motif, side } = bookMotifForSlot(seed, illustrationIdx + 2);
  const pairIdx = Math.floor(motif / 2);
  const topPct = 18 + (((illustrationIdx + seed) * 17) % 34);

  return {
    showLeft: side === 'left',
    showRight: side === 'right',
    leftMotif: pairIdx * 2,
    rightMotif: pairIdx * 2 + 1,
    leftTopPct: topPct,
    rightTopPct: topPct,
  };
}

export function BookPageMarginArt({
  index,
  color,
  secondaryColor,
  forceShow = false,
  seed = 0,
  slotOffset = 1,
  slots,
  totalPages = 24,
}: {
  index: number;
  color?: string;
  secondaryColor?: string;
  forceShow?: boolean;
  seed?: number;
  slotOffset?: number;
  slots?: number;
  totalPages?: number;
}) {
  if (slots !== undefined && slots >= 1 && !forceShow) {
    const startPct = slots === 1 ? 22 : 12;
    const endPct = slots === 2 ? 62 : Math.min(78, 48 + (slots - 2) * 7);
    const items = Array.from({ length: slots }, (_, s) => {
      const slotIdx = slotOffset + s;
      const { motif, side } = bookMotifForSlot(seed, slotIdx + 2);
      const cursor = Math.abs(seed) + slotIdx;
      const topPct =
        slots === 1
          ? 24 + ((cursor * 13) % 34)
          : Math.max(
              10,
              Math.min(
                78,
                Math.round(
                  (startPct +
                    ((endPct - startPct) * s) / (slots - 1) +
                    (((cursor * 5) % 5) - 2)) *
                    10,
                ) / 10,
              ),
            );
      return { key: `${s}-${motif}`, motif, side, topPct };
    });

    return (
      <div className="reader-margin-decor" aria-hidden="true">
        {items.map(it => (
          <BookPageEdgeMotif
            key={it.key}
            motif={it.motif}
            side={it.side}
            topPct={it.topPct}
            color={color}
            secondaryColor={secondaryColor}
          />
        ))}
      </div>
    );
  }

  const layout = resolveMarginArtLayout(index, forceShow, seed, totalPages);
  if (!layout) return null;

  return (
    <div className="reader-margin-decor" aria-hidden="true">
      {layout.showLeft && (
        <BookPageEdgeMotif
          motif={layout.leftMotif}
          side="left"
          topPct={layout.leftTopPct}
          color={color}
          secondaryColor={secondaryColor}
        />
      )}
      {layout.showRight && (
        <BookPageEdgeMotif
          motif={layout.rightMotif}
          side="right"
          topPct={layout.rightTopPct}
          color={color}
          secondaryColor={secondaryColor}
        />
      )}
    </div>
  );
}

const ORNAMENT_CATALOG = [
  { seed: 0, name: 'Ornament 1 · Open Book & Leaves' },
  { seed: 1, name: 'Ornament 2 · Botanical Garland & Crest' },
  { seed: 2, name: 'Ornament 3 · Feather Quill & Wax Seal' },
  { seed: 3, name: 'Ornament 4 · Celestial Star & Moons' },
  { seed: 4, name: 'Ornament 5 · Classic Double-Rule' },
  { seed: 5, name: 'Ornament 6 · Winged Reading Hourglass' },
  { seed: 6, name: 'Ornament 7 · Antique Library Key' },
  { seed: 7, name: 'Ornament 8 · Scholar Spectacles & Scroll' },
] as const;

const EDGE_PAIR_CATALOG = [
  {
    pair: 1,
    leftMotif: 0,
    rightMotif: 1,
    name: 'Pair 1 · Olive Branch (L) & Blossoming Laurel (R)',
  },
  {
    pair: 2,
    leftMotif: 2,
    rightMotif: 3,
    name: 'Pair 2 · Stacked Volumes (L) & Open Fluttering Tome (R)',
  },
  {
    pair: 3,
    leftMotif: 4,
    rightMotif: 5,
    name: 'Pair 3 · Brass Reading Kettle (L) & Porcelain Teacup (R)',
  },
  {
    pair: 4,
    leftMotif: 6,
    rightMotif: 7,
    name: 'Pair 4 · Pressed Cosmos Stem (L) & Unfurling Fern (R)',
  },
  {
    pair: 5,
    leftMotif: 8,
    rightMotif: 9,
    name: 'Pair 5 · Hanging Reading Lantern (L) & Library Candle (R)',
  },
  {
    pair: 6,
    leftMotif: 10,
    rightMotif: 11,
    name: 'Pair 6 · Fountain Pen Nib (L) & Glass Inkwell + Quill (R)',
  },
  {
    pair: 7,
    leftMotif: 12,
    rightMotif: 13,
    name: 'Pair 7 · Celestial Astrolabe (L) & Scholar Spectacles (R)',
  },
] as const;

function ReaderDecorationsCatalog({
  palette,
  onScrollPosition,
}: {
  palette: ReaderPalette;
  onScrollPosition?: (scrollTop: number) => void;
}) {
  const c1 = palette.accent ?? '#9E6B2E';
  const c2 = palette.accentSecondary ?? '#5A7550';
  const catalogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = catalogRef.current;
    if (!root) return;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>('.reader-decor-card'),
    );
    cards.forEach(card => card.classList.remove('is-in-view'));

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in-view');
          }
        }
      },
      { root, threshold: 0.15 },
    );

    cards.forEach(card => io.observe(card));
    return () => io.disconnect();
  }, [palette.ornament]);

  return (
    <div
      ref={catalogRef}
      className="reader-scroll-view reader-decor-catalog"
      style={{ color: 'var(--reader-text)' }}
      onScroll={e => onScrollPosition?.(e.currentTarget.scrollTop)}
    >
      <div className="reader-scroll-measure">
        <section className="reader-decor-group">
          <h3 className="reader-decor-heading">
            Centered Header &amp; Footer Ornaments (8)
          </h3>
          <div className="reader-decor-ornament-grid">
            {ORNAMENT_CATALOG.map(item => (
              <div
                key={item.seed}
                className="reader-decor-card"
                style={{
                  borderColor:
                    'color-mix(in srgb, var(--reader-text) 14%, transparent)',
                  backgroundColor:
                    'color-mix(in srgb, var(--reader-text) 4%, var(--reader-page))',
                }}
              >
                <span
                  className="reader-decor-label"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  {item.name}
                </span>
                <BookPageOrnament
                  variant="title"
                  seed={item.seed}
                  color={c1}
                  secondaryColor={c2}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="reader-decor-group">
          <h3 className="reader-decor-heading">
            Section-Edge Complementary Pairs — Left &amp; Right (14 Motifs · 7
            Pairs)
          </h3>
          <div className="reader-decor-edge-grid">
            {EDGE_PAIR_CATALOG.map(item => (
              <div
                key={item.pair}
                className="reader-decor-card is-edge-sheet"
                style={{
                  borderColor:
                    'color-mix(in srgb, var(--reader-text) 14%, transparent)',
                  backgroundColor:
                    'color-mix(in srgb, var(--reader-text) 4%, var(--reader-page))',
                }}
              >
                <span
                  className="reader-decor-label"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  {item.name}
                </span>
                <div className="reader-decor-edge-stage">
                  <BookPageEdgeMotif
                    motif={item.leftMotif}
                    side="left"
                    topPct={8}
                    color={c1}
                    secondaryColor={c2}
                  />
                  <div
                    className="reader-decor-sample-lines"
                    style={{ color: 'var(--reader-muted)' }}
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                  <BookPageEdgeMotif
                    motif={item.rightMotif}
                    side="right"
                    topPct={22}
                    color={c1}
                    secondaryColor={c2}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PageSheetContent({
  page,
  totalPages,
  palette,
  artSeed = 1,
  mirrored = false,
  hasReadableContent: _hasReadableContent = true,
  hasChapters = false,
  onEmptyAction,
  onSelectChapter,
}: {
  page: PaginatedPage;
  totalPages: number;
  palette: ReaderPalette;
  artSeed?: number;
  mirrored?: boolean;
  hasReadableContent?: boolean;
  hasChapters?: boolean;
  onEmptyAction?: () => void;
  onSelectChapter?: (chapterId: string) => void;
}) {
  const hasHeading = page.items.some(it => it.style === 'heading');
  const hasInlineEdgeSlot =
    Boolean(page.bottomEdgeArt) ||
    page.items.some(it => Boolean(it.edgeArtSlot));
  const footerStride = Math.max(5, computeArtStridePages(totalPages) * 2);
  const showFooterOrnament =
    Boolean(palette.ornament) &&
    !hasHeading &&
    !hasInlineEdgeSlot &&
    page.kind === 'content' &&
    page.index % footerStride === Math.min(3, footerStride - 1) &&
    !resolveMarginArtLayout(page.index, false, artSeed, totalPages);

  return (
    <div
      className={[
        'reader-page-inner',
        mirrored ? 'is-mirrored' : '',
        palette.ornament ? 'is-book-themed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="reader-page-body">
        {page.kind === 'cover' && page.imageUrl ? (
          <div className="reader-cover-frame">
            <img src={page.imageUrl} alt="" draggable={false} />
          </div>
        ) : page.kind === 'title' && page.titleCard ? (
          <div className="reader-title-card">
            {page.imageUrl && (
              <div className="reader-title-cover">
                <img src={page.imageUrl} alt="" draggable={false} />
              </div>
            )}
            <h2
              style={{
                fontFamily: READER_SERIF_STACK,
                fontSize: page.titleCard.titleSize,
              }}
            >
              {page.titleCard.heading}
            </h2>
            {page.titleCard.subheading && (
              <p
                className="reader-title-author"
                style={{
                  fontFamily: READER_SERIF_STACK,
                  fontSize: page.titleCard.authorSize,
                  color: 'var(--reader-muted)',
                }}
              >
                {page.titleCard.subheading}
              </p>
            )}
            <BookPageOrnament
              style={palette.ornament}
              variant="title"
              seed={bookOrnamentForSlot(artSeed, 0)}
              color={palette.accent}
              secondaryColor={palette.accentSecondary}
              active={Boolean(palette.ornament)}
            />
            {page.titleCard.meta && (
              <p
                className="reader-title-meta"
                style={{
                  fontFamily: READER_SANS_STACK,
                  fontSize: page.titleCard.metaSize,
                  color: 'var(--reader-muted)',
                }}
              >
                {page.titleCard.meta}
              </p>
            )}
          </div>
        ) : page.kind === 'bookIndex' && page.indexCard ? (
          <div className="reader-book-index">
            <div className="reader-book-index-head">
              <h2
                style={{
                  fontFamily: READER_SERIF_STACK,
                  fontSize: page.indexCard.headingSize,
                }}
              >
                {page.indexCard.heading}
              </h2>
            </div>

            <div className="reader-book-index-list">
              {page.indexCard.entries.map(entry => {
                const interactive = entry.hasHighlights;
                return (
                  <button
                    key={entry.chapterId}
                    type="button"
                    disabled={!interactive}
                    className={
                      interactive
                        ? 'reader-book-index-row is-interactive'
                        : 'reader-book-index-row is-empty'
                    }
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: page.indexCard?.rowSize,
                      color: interactive
                        ? 'var(--reader-text)'
                        : 'var(--reader-muted)',
                    }}
                    onClick={
                      interactive
                        ? () => onSelectChapter?.(entry.chapterId)
                        : undefined
                    }
                  >
                    <span className="reader-book-index-title">
                      {entry.title}
                    </span>
                    <span
                      className="reader-book-index-dots"
                      aria-hidden="true"
                    />
                    {entry.pages && (
                      <span
                        className="reader-book-index-pages"
                        style={{
                          fontFamily: READER_SANS_STACK,
                          color: 'var(--reader-muted)',
                        }}
                      >
                        {entry.pages}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : page.kind === 'end' && page.endCard ? (
          <div className="reader-end-card">
            <BookPageOrnament
              style={palette.ornament}
              variant="title"
              seed={bookOrnamentForSlot(artSeed, 6)}
              color={palette.accent}
              secondaryColor={palette.accentSecondary}
              active={Boolean(palette.ornament)}
            />
            <h2
              className="reader-end-heading"
              style={{
                fontFamily: READER_SERIF_STACK,
                fontSize: page.endCard.headingSize,
              }}
            >
              {page.endCard.heading}
            </h2>
            {page.endCard.subheading && (
              <p
                className="reader-end-sub"
                style={{
                  fontFamily: READER_SERIF_STACK,
                  fontSize: page.endCard.subSize,
                  color: 'var(--reader-muted)',
                }}
              >
                {page.endCard.subheading}
              </p>
            )}
            <BookPageOrnament
              style={palette.ornament}
              variant="footer"
              seed={bookOrnamentForSlot(artSeed, 7)}
              color={palette.accent}
              secondaryColor={palette.accentSecondary}
              active={Boolean(palette.ornament)}
            />
          </div>
        ) : page.kind === 'empty' ? (
          <div className="side-empty is-full reader-page-empty">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('reader.empty.title')}</h3>
            <p style={{ color: 'var(--reader-muted)' }}>
              {t('reader.empty.subtitle')}
            </p>
            {onEmptyAction && (
              <button
                type="button"
                className="pill is-primary"
                onClick={onEmptyAction}
              >
                <span>
                  {hasChapters
                    ? t('reader.empty.action')
                    : t('reader.empty.actionIndex')}
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="reader-flow">
            {page.items.map((item, idx) => (
              <div
                key={`${item.blockId}-${idx}`}
                className={`reader-block is-${item.style}`}
                style={{
                  marginTop: item.marginTop,
                  fontSize: item.fontSize,
                  lineHeight: `${item.lineHeight}px`,
                  textAlign: item.align,
                  fontStyle: item.italic ? 'italic' : 'normal',
                  fontWeight: item.bold ? 700 : 400,
                  color: item.muted
                    ? 'var(--reader-muted)'
                    : 'var(--reader-text)',
                  fontFamily: item.serif
                    ? READER_SERIF_STACK
                    : READER_SANS_STACK,
                }}
              >
                {item.style === 'heading' && idx === 0 && (
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="header"
                    seed={bookOrnamentForSlot(artSeed, page.index + 1)}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                    active={Boolean(palette.ornament)}
                  />
                )}
                {item.lines.map((line, lineIdx) => (
                  <div key={lineIdx} className="reader-line">
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {page.kind !== 'cover' && (
        <footer
          className="reader-page-foot"
          style={{
            color: 'var(--reader-muted)',
            fontFamily: READER_SANS_STACK,
          }}
        >
          <BookPageOrnament
            style={palette.ornament}
            variant="footer"
            seed={bookOrnamentForSlot(artSeed, page.index + 3)}
            color={palette.accent}
            secondaryColor={palette.accentSecondary}
            active={Boolean(palette.ornament && showFooterOrnament)}
          />
          <span>
            {t('reader.pageOf', { page: page.index + 1, total: totalPages })}
          </span>
        </footer>
      )}
    </div>
  );
}

function ScrollReaderBody({
  sections,
  fontScale,
  palette,
  artSeed,
  scrollRef,
  hasReadableContent,
  hasChapters,
  initialSectionId,
  programmaticScrollRef,
  onEmptyAction,
  onSelectChapter,
  onScrollPosition,
  onActiveSectionChange,
  onReachedBottom,
}: {
  sections: ReaderSection[];
  fontScale: number;
  palette: ReaderPalette;
  artSeed: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasReadableContent: boolean;
  hasChapters: boolean;
  initialSectionId?: string;
  programmaticScrollRef?: React.MutableRefObject<{
    active: boolean;
    startedAt: number;
  } | null>;
  onEmptyAction?: () => void;
  onSelectChapter?: (chapterId: string) => void;
  onScrollPosition: (scrollTop: number) => void;
  onActiveSectionChange?: (sectionId: string) => void;
  onReachedBottom: () => void;
}) {
  const initialScrollDoneRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const lastActiveSectionRef = useRef<string>(initialSectionId ?? '');

  const detectActiveSection = useCallback(
    (el: HTMLDivElement) => {
      if (!onActiveSectionChange) return;
      if (programmaticScrollRef?.current?.active) {
        return;
      }
      const nodes = el.querySelectorAll<HTMLElement>('[data-section-id]');
      if (nodes.length === 0) return;
      if (el.scrollTop <= 24) {
        const firstId = nodes[0]?.dataset.sectionId;
        if (firstId && firstId !== lastActiveSectionRef.current) {
          lastActiveSectionRef.current = firstId;
          onActiveSectionChange(firstId);
        }
        return;
      }
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
        const lastId = nodes[nodes.length - 1]?.dataset.sectionId;
        if (lastId) {
          if (lastId !== lastActiveSectionRef.current) {
            lastActiveSectionRef.current = lastId;
            onActiveSectionChange(lastId);
          }
          return;
        }
      }
      const probeY = el.scrollTop + el.clientHeight * 0.32;
      let chosen = nodes[0]!.dataset.sectionId ?? '';
      for (const node of nodes) {
        if (node.offsetTop <= probeY) {
          chosen = node.dataset.sectionId ?? chosen;
        } else {
          break;
        }
      }
      if (chosen && chosen !== lastActiveSectionRef.current) {
        lastActiveSectionRef.current = chosen;
        onActiveSectionChange(chosen);
      }
    },
    [onActiveSectionChange, programmaticScrollRef],
  );

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || sections.length === 0) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      if (initialSectionId && initialSectionId !== sections[0]?.id) {
        const nodes = el.querySelectorAll<HTMLElement>('[data-section-id]');
        const firstTop = nodes[0]?.offsetTop ?? 0;
        const target = el.querySelector<HTMLElement>(
          `[data-section-id="${CSS.escape(initialSectionId)}"]`,
        );
        if (target) {
          el.scrollTop = Math.max(0, target.offsetTop - firstTop);
          onActiveSectionChange?.(initialSectionId);
          return;
        }
      }
    }
    detectActiveSection(el);
  }, [
    detectActiveSection,
    initialSectionId,
    onActiveSectionChange,
    scrollRef,
    sections,
  ]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>('.reader-scroll-section'),
    );
    nodes.forEach(node => node.classList.remove('is-in-view'));
    if (!palette.ornament) return;

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in-view');
          }
        }
      },
      { root, threshold: 0.14 },
    );

    nodes.forEach(node => io.observe(node));
    return () => io.disconnect();
  }, [palette.ornament, scrollRef, sections]);

  const bookArtSeed = artSeed;
  const totalBookVisualLines = sections.reduce((total, sec) => {
    if (
      sec.kind === 'cover' ||
      sec.kind === 'title' ||
      sec.kind === 'bookIndex' ||
      sec.kind === 'end'
    ) {
      return total;
    }
    const pLines =
      sec.paragraphs?.reduce(
        (sum, p) => sum + Math.max(2, Math.ceil(p.length / 56)) + 1.5,
        0,
      ) ?? 0;
    const hLines =
      sec.highlights?.reduce((sum, hl) => {
        const segLines = hl.text
          .split('\n')
          .reduce(
            (acc, seg) => acc + Math.max(1, Math.ceil(seg.length / 54)),
            0,
          );
        return sum + segLines + 2.2;
      }, 0) ?? 0;
    return total + pLines + hLines + 5;
  }, 0);
  const virtualPages = Math.max(4, Math.ceil(totalBookVisualLines / 20));
  const scrollStridePages = computeArtStridePages(virtualPages);
  const linesPerIllustration = Math.max(40, scrollStridePages * 20);
  let scrollSlotCursor = 0;
  let mobileSlotCursor = 0;
  let scrollLineAcc = Math.round(linesPerIllustration * 0.55);

  return (
    <div
      ref={scrollRef}
      className="reader-scroll-view"
      style={{ color: 'var(--reader-text)' }}
      onWheel={() => {
        const prog = programmaticScrollRef?.current;
        if (prog && performance.now() - prog.startedAt > 150) {
          programmaticScrollRef.current = null;
        }
      }}
      onTouchStart={() => {
        if (programmaticScrollRef) programmaticScrollRef.current = null;
      }}
      onPointerDown={() => {
        if (programmaticScrollRef) programmaticScrollRef.current = null;
      }}
      onScroll={e => {
        const el = e.currentTarget;
        onScrollPosition(el.scrollTop);
        if (scrollRafRef.current === null) {
          scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            detectActiveSection(el);
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) {
              onReachedBottom();
            }
          });
        }
      }}
    >
      <div className="reader-scroll-measure">
        {sections.map((section, sectionIdx) => {
          if (section.kind === 'cover' && section.imageUrl) {
            return (
              <section
                key={section.id}
                data-section-id={section.id}
                className="reader-scroll-section is-cover"
              >
                <img src={section.imageUrl} alt="" />
              </section>
            );
          }

          if (section.kind === 'title') {
            return (
              <section
                key={section.id}
                data-section-id={section.id}
                className="reader-scroll-section is-title"
              >
                {palette.ornament && (
                  <BookPageMarginArt
                    index={0}
                    seed={bookArtSeed}
                    forceShow
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                  />
                )}
                {section.imageUrl && (
                  <div className="reader-title-cover">
                    <img src={section.imageUrl} alt="" draggable={false} />
                  </div>
                )}
                <h2
                  style={{
                    fontFamily: READER_SERIF_STACK,
                    fontSize: Math.round(28 * fontScale),
                  }}
                >
                  {section.heading}
                </h2>
                {section.subheading && (
                  <p
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: Math.round(17 * fontScale),
                      color: 'var(--reader-muted)',
                    }}
                  >
                    {section.subheading}
                  </p>
                )}
                <BookPageOrnament
                  style={palette.ornament}
                  variant="title"
                  seed={bookOrnamentForSlot(bookArtSeed, 0)}
                  color={palette.accent}
                  secondaryColor={palette.accentSecondary}
                  active={Boolean(palette.ornament)}
                />
                {section.paragraphs?.map((meta, idx) => (
                  <p
                    key={idx}
                    className="reader-title-meta"
                    style={{
                      fontFamily: READER_SANS_STACK,
                      fontSize: Math.round(13 * fontScale),
                      color: 'var(--reader-muted)',
                    }}
                  >
                    {meta}
                  </p>
                ))}
              </section>
            );
          }

          if (section.kind === 'bookIndex' && section.indexEntries) {
            return (
              <section
                key={section.id}
                data-section-id={section.id}
                className="reader-scroll-section is-book-index"
              >
                <div className="reader-book-index-head">
                  <h3
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: Math.round(22 * fontScale),
                    }}
                  >
                    {section.heading}
                  </h3>
                </div>
                <div className="reader-book-index-list">
                  {section.indexEntries.map(entry => {
                    const interactive = entry.hasHighlights;
                    return (
                      <button
                        key={entry.chapterId}
                        type="button"
                        disabled={!interactive}
                        className={
                          interactive
                            ? 'reader-book-index-row is-interactive'
                            : 'reader-book-index-row is-empty'
                        }
                        style={{
                          fontFamily: READER_SERIF_STACK,
                          fontSize: Math.round(15.5 * fontScale),
                          color: interactive
                            ? 'var(--reader-text)'
                            : 'var(--reader-muted)',
                        }}
                        onClick={
                          interactive
                            ? () => onSelectChapter?.(entry.chapterId)
                            : undefined
                        }
                      >
                        <span className="reader-book-index-title">
                          {entry.title}
                        </span>
                        <span
                          className="reader-book-index-dots"
                          aria-hidden="true"
                        />
                        {entry.pages && (
                          <span
                            className="reader-book-index-pages"
                            style={{
                              fontFamily: READER_SANS_STACK,
                              color: 'var(--reader-muted)',
                            }}
                          >
                            {entry.pages}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          }

          if (section.kind === 'end') {
            const endPairIdx = bookPairForSlot(bookArtSeed, 6);
            return (
              <section
                key={section.id}
                data-section-id={section.id}
                className="reader-scroll-section is-end"
              >
                {palette.ornament && (
                  <BookPageMarginArt
                    index={99}
                    seed={bookArtSeed}
                    forceShow
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                  />
                )}
                <div className="reader-end-card">
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="title"
                    seed={bookOrnamentForSlot(bookArtSeed, 6)}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                    active={Boolean(palette.ornament)}
                  />
                  <h3
                    className="reader-end-heading"
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: Math.round(26 * fontScale),
                    }}
                  >
                    {section.heading}
                  </h3>
                  {section.subheading && (
                    <p
                      className="reader-end-sub"
                      style={{
                        fontFamily: READER_SERIF_STACK,
                        fontSize: Math.round(14.5 * fontScale),
                        color: 'var(--reader-muted)',
                      }}
                    >
                      {section.subheading}
                    </p>
                  )}
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="footer"
                    seed={bookOrnamentForSlot(bookArtSeed, 7)}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                    active={Boolean(palette.ornament)}
                  />
                  {palette.ornament && (
                    <div
                      className="reader-mobile-edge-slot is-pair"
                      aria-hidden="true"
                    >
                      <BookPageEdgeMotif
                        motif={endPairIdx * 2}
                        side="left"
                        color={palette.accent}
                        secondaryColor={palette.accentSecondary}
                      />
                      <BookPageEdgeMotif
                        motif={endPairIdx * 2 + 1}
                        side="right"
                        color={palette.accent}
                        secondaryColor={palette.accentSecondary}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          }

          const paraLines =
            section.paragraphs?.reduce(
              (sum, p) => sum + Math.max(2, Math.ceil(p.length / 56)) + 1.5,
              0,
            ) ?? 0;
          const highlightLines =
            section.highlights?.reduce((sum, hl) => {
              const segLines = hl.text
                .split('\n')
                .reduce(
                  (acc, seg) => acc + Math.max(1, Math.ceil(seg.length / 54)),
                  0,
                );
              return sum + segLines + 2.2;
            }, 0) ?? 0;
          const totalVisualLines = paraLines + highlightLines;
          scrollLineAcc += totalVisualLines + 4;
          const slots =
            scrollLineAcc >= linesPerIllustration
              ? Math.min(3, Math.floor(scrollLineAcc / linesPerIllustration))
              : 0;
          if (slots > 0) {
            scrollLineAcc -= slots * linesPerIllustration;
          }
          const sectionSlotOffset = scrollSlotCursor;
          scrollSlotCursor += slots;

          const makeMobileSlot = () => {
            const slotIdx = mobileSlotCursor;
            mobileSlotCursor += 1;
            const { motif, side } = bookMotifForSlot(bookArtSeed, slotIdx + 2);
            const topPct = 46 + (((slotIdx + bookArtSeed) * 7) % 10);
            return { motif, side, topPct };
          };

          const parsedHighlights =
            section.highlights?.map(hl => {
              const segments = parseHighlightSegments(hl.text);
              const approxLines = segments.reduce(
                (acc, seg) =>
                  acc + Math.max(1, Math.ceil(seg.text.length / 44)),
                1,
              );
              return { hl, segments, approxLines };
            }) ?? [];
          let mobileLinesSinceSlot = 0;
          let mobileBlocksSinceSlot = 0;
          let placedMobileInline = 0;

          return (
            <section
              key={section.id}
              data-section-id={section.id}
              className="reader-scroll-section"
            >
              {palette.ornament && slots > 0 && (
                <BookPageMarginArt
                  index={sectionIdx}
                  seed={bookArtSeed}
                  slotOffset={sectionSlotOffset}
                  slots={slots}
                  color={palette.accent}
                  secondaryColor={palette.accentSecondary}
                />
              )}
              {section.heading && (
                <>
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="header"
                    seed={bookOrnamentForSlot(bookArtSeed, sectionIdx + 1)}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                    active={Boolean(palette.ornament)}
                  />
                  <h3
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: Math.round(22 * fontScale),
                    }}
                  >
                    {section.heading}
                  </h3>
                </>
              )}
              {section.subheading && (
                <p
                  className="reader-scroll-sub"
                  style={{
                    fontFamily: READER_SANS_STACK,
                    fontSize: Math.round(13 * fontScale),
                    color: 'var(--reader-muted)',
                  }}
                >
                  {section.subheading}
                </p>
              )}

              {section.paragraphs?.map((para, idx) => {
                const paraApproxLines = Math.max(
                  2,
                  Math.ceil(para.length / 44),
                );
                mobileLinesSinceSlot += paraApproxLines;
                mobileBlocksSinceSlot += 1;
                const isLastPara =
                  idx === (section.paragraphs?.length ?? 0) - 1 &&
                  parsedHighlights.length === 0;
                const shouldPlaceSlot =
                  Boolean(palette.ornament) &&
                  !isLastPara &&
                  placedMobileInline < 2 &&
                  mobileBlocksSinceSlot >= 3 &&
                  mobileLinesSinceSlot >= 24;
                const mobileSlot = shouldPlaceSlot
                  ? ((placedMobileInline += 1),
                    (mobileLinesSinceSlot = 0),
                    (mobileBlocksSinceSlot = 0),
                    makeMobileSlot())
                  : undefined;
                return (
                  <div key={idx} className="reader-scroll-block">
                    <p
                      className="reader-scroll-prose"
                      style={{
                        fontFamily: READER_SERIF_STACK,
                        fontSize: Math.round(17.5 * fontScale),
                        lineHeight: 1.56,
                      }}
                    >
                      {para}
                    </p>
                    {mobileSlot && (
                      <div
                        className="reader-mobile-edge-slot"
                        aria-hidden="true"
                      >
                        <BookPageEdgeMotif
                          motif={mobileSlot.motif}
                          side={mobileSlot.side}
                          topPct={mobileSlot.topPct}
                          color={palette.accent}
                          secondaryColor={palette.accentSecondary}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {parsedHighlights.map(({ hl, segments, approxLines }, idx) => {
                mobileLinesSinceSlot += approxLines;
                mobileBlocksSinceSlot += 1;
                const isLastHl = idx === parsedHighlights.length - 1;
                const shouldPlaceHlSlot =
                  Boolean(palette.ornament) &&
                  !isLastHl &&
                  placedMobileInline < 2 &&
                  mobileBlocksSinceSlot >= 2 &&
                  mobileLinesSinceSlot >= 24;
                const hlSlot = shouldPlaceHlSlot
                  ? ((placedMobileInline += 1),
                    (mobileLinesSinceSlot = 0),
                    (mobileBlocksSinceSlot = 0),
                    makeMobileSlot())
                  : undefined;
                return (
                  <div key={idx} className="reader-scroll-block">
                    <blockquote
                      className="reader-scroll-quote"
                      style={{
                        fontFamily: READER_SERIF_STACK,
                        fontSize: Math.round(17.5 * fontScale),
                        lineHeight: 1.56,
                      }}
                    >
                      {segments.map((seg, segIdx) => (
                        <p
                          key={segIdx}
                          style={{
                            fontStyle: seg.italic ? 'italic' : 'normal',
                            textAlign: seg.align,
                            marginTop:
                              segIdx === 0
                                ? 0
                                : seg.tightWithPrev
                                  ? 2
                                  : Math.round(10 * fontScale),
                          }}
                        >
                          {seg.text}
                        </p>
                      ))}
                      {hl.page && (
                        <footer
                          style={{
                            fontFamily: READER_SANS_STACK,
                            fontSize: Math.round(12.5 * fontScale),
                            color: 'var(--reader-muted)',
                          }}
                        >
                          {hl.page}
                        </footer>
                      )}
                    </blockquote>
                    {hlSlot && (
                      <div
                        className="reader-mobile-edge-slot"
                        aria-hidden="true"
                      >
                        <BookPageEdgeMotif
                          motif={hlSlot.motif}
                          side={hlSlot.side}
                          topPct={hlSlot.topPct}
                          color={palette.accent}
                          secondaryColor={palette.accentSecondary}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {palette.ornament &&
                (placedMobileInline === 0 || mobileLinesSinceSlot >= 14) &&
                (() => {
                  const tailSlot = makeMobileSlot();
                  return (
                    <div
                      className="reader-mobile-edge-slot is-tail"
                      aria-hidden="true"
                    >
                      <BookPageEdgeMotif
                        motif={tailSlot.motif}
                        side={tailSlot.side}
                        topPct={tailSlot.topPct}
                        color={palette.accent}
                        secondaryColor={palette.accentSecondary}
                      />
                    </div>
                  );
                })()}
            </section>
          );
        })}

        {!hasReadableContent && (
          <div
            data-section-id={EMPTY_HIGHLIGHTS_SECTION_ID}
            className="side-empty reader-scroll-empty"
          >
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('reader.empty.title')}</h3>
            <p style={{ color: 'var(--reader-muted)' }}>
              {t('reader.empty.subtitle')}
            </p>
            {onEmptyAction && (
              <button
                type="button"
                className="pill is-primary"
                onClick={onEmptyAction}
              >
                <span>
                  {hasChapters
                    ? t('reader.empty.action')
                    : t('reader.empty.actionIndex')}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const HEADER_LINGER_SLIDE_MS = 3000;
const HEADER_LINGER_SCROLL_MS = 5200;
const SCROLL_HIDE_MIN_TOP_PX = 220;
const SCROLL_HIDE_DISTANCE_PX = 180;

export function Reader({
  book,
  onOpenFirstChapterHighlight,
  onClose,
}: {
  book: Book;
  onOpenFirstChapterHighlight?: () => void;
  onClose: () => void;
}) {
  const activeLocale = useLocale();
  const appScheme = useScheme();
  const ensureBody = useBodiesStore(state => state.ensure);
  const bodyEntry = useBodiesStore(state => state.entries[book.id]);

  const chosenTheme = useReaderSettingsStore(state => state.theme);
  const pageTurn = useReaderSettingsStore(state => state.pageTurn);
  const pageWidth = useReaderSettingsStore(state => state.pageWidth);
  const scaleIndex = useReaderSettingsStore(state => state.scaleIndex);
  const setReaderTheme = useReaderSettingsStore(state => state.setReaderTheme);
  const setPageTurn = useReaderSettingsStore(state => state.setPageTurn);
  const setPageWidth = useReaderSettingsStore(state => state.setPageWidth);
  const setScaleIndex = useReaderSettingsStore(state => state.setScaleIndex);

  const coverPalette = useBookCoverPalette(
    book.artUrl,
    `${book.id}:${book.name}`,
  );
  const resolvedTheme = effectiveTheme(chosenTheme, appScheme);
  const palette = readerPalette(resolvedTheme, coverPalette, appScheme);
  const fontScale = TEXT_SCALES[scaleIndex] ?? 1;
  const maxPageStageW = pageWidth === 'extended' ? 860 : 640;
  const maxTextMeasure = pageWidth === 'extended' ? 812 : 544;

  const stageRef = useRef<HTMLDivElement>(null);
  const slideTrackRef = useRef<HTMLDivElement>(null);
  const slideEdgeOverlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const tocCardRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef<{
    active: boolean;
    startedAt: number;
  } | null>(null);
  const [viewport, setViewport] = useState<{
    width: number;
    height: number;
    stageWidth: number;
  }>({
    width:
      typeof window !== 'undefined'
        ? Math.min(window.innerWidth, maxPageStageW)
        : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 780,
    stageWidth: typeof window !== 'undefined' ? window.innerWidth : 390,
  });

  const [scrolled, setScrolled] = useState(false);
  const [barTucked, setBarTucked] = useState(false);
  const [barIdle, setBarIdle] = useState(false);
  const scrolledRef = useRef(false);
  const barTuckedRef = useRef(false);
  const barIdleRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const downwardScrollRef = useRef(0);
  const lingerTimerRef = useRef<number | null>(null);

  const [reflowing, setReflowing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelOpen, setPanelOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(DESK).matches,
  );
  const [leavingPanel, setLeavingPanel] = useState(false);
  const prevPanelOpenRef = useRef(panelOpen);
  const prevScaleAndTurn = useRef(`${scaleIndex}:${pageTurn}:${pageWidth}`);

  const updateScrolled = useCallback((next: boolean) => {
    if (scrolledRef.current !== next) {
      scrolledRef.current = next;
      setScrolled(next);
    }
  }, []);

  const updateBarState = useCallback(
    (nextTucked: boolean, nextIdle: boolean) => {
      if (barTuckedRef.current !== nextTucked) {
        barTuckedRef.current = nextTucked;
        setBarTucked(nextTucked);
      }
      if (barIdleRef.current !== nextIdle) {
        barIdleRef.current = nextIdle;
        setBarIdle(nextIdle);
      }
    },
    [],
  );

  const applySlideDragDom = useCallback(
    (offsetPx: number, currentIndex: number) => {
      const track = slideTrackRef.current;
      if (track) {
        track.classList.toggle('is-dragging', offsetPx !== 0);
        track.style.transform =
          offsetPx !== 0
            ? `translate3d(calc(${-currentIndex * 100}% + ${offsetPx}px), 0, 0)`
            : `translate3d(${-currentIndex * 100}%, 0, 0)`;
      }
      const edge = slideEdgeOverlayRef.current;
      if (edge) {
        edge.classList.toggle('is-dragging', offsetPx !== 0);
        edge.style.opacity =
          offsetPx !== 0
            ? String(
                Math.max(
                  0,
                  1 -
                    Math.abs(offsetPx) /
                      Math.max(72, viewport.stageWidth * 0.24),
                ),
              )
            : '1';
      }
    },
    [viewport.stageWidth],
  );

  const clearLinger = useCallback(() => {
    if (lingerTimerRef.current !== null) {
      window.clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
  }, []);

  const scheduleHeaderLinger = useCallback(() => {
    clearLinger();
    const waitMs =
      pageTurn === 'scroll' ? HEADER_LINGER_SCROLL_MS : HEADER_LINGER_SLIDE_MS;
    lingerTimerRef.current = window.setTimeout(() => {
      const barEl = barRef.current;
      if (
        barEl &&
        (barEl.matches(':focus-within') || barEl.matches(':hover'))
      ) {
        return;
      }
      if (
        pageTurn === 'scroll' &&
        lastScrollTopRef.current <= SCROLL_HIDE_MIN_TOP_PX
      ) {
        return;
      }
      updateBarState(true, true);
    }, waitMs);
  }, [clearLinger, pageTurn, updateBarState]);

  const revealHeader = useCallback(
    (withLinger = true) => {
      downwardScrollRef.current = 0;
      updateBarState(false, false);
      if (withLinger) {
        scheduleHeaderLinger();
      } else {
        clearLinger();
      }
    },
    [clearLinger, scheduleHeaderLinger, updateBarState],
  );

  const handleScrollPosition = useCallback(
    (scrollTop: number) => {
      const prev = lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      updateScrolled(scrollTop > 8);

      if (scrollTop <= SCROLL_HIDE_MIN_TOP_PX) {
        downwardScrollRef.current = 0;
        clearLinger();
        updateBarState(false, false);
        return;
      }

      const delta = scrollTop - prev;
      if (delta > 0) {
        downwardScrollRef.current += delta;
        if (downwardScrollRef.current >= SCROLL_HIDE_DISTANCE_PX) {
          clearLinger();
          updateBarState(true, barIdleRef.current);
        }
      } else if (delta < -14) {
        downwardScrollRef.current = 0;
        updateBarState(false, false);
        scheduleHeaderLinger();
      }
    },
    [clearLinger, scheduleHeaderLinger, updateBarState, updateScrolled],
  );

  useEffect(() => {
    const wasOpen = prevPanelOpenRef.current;
    prevPanelOpenRef.current = panelOpen;
    if (panelOpen) {
      if (leavingPanel) setLeavingPanel(false);
      return;
    }
    if (wasOpen) {
      setLeavingPanel(true);
      const id = window.setTimeout(() => setLeavingPanel(false), LEAVE_MS);
      return () => window.clearTimeout(id);
    }
  }, [panelOpen, leavingPanel]);

  const showPanel = panelOpen || leavingPanel;

  const initialAnchorApplied = useRef(false);
  const initialScrollAnchorApplied = useRef(false);
  const currentAnchorRef = useRef<ReaderAnchor | null>(book.readerAnchor);
  const dirtyAnchorRef = useRef(false);
  const finishedMarkedRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    direction: 'next' | 'prev' | null;
  } | null>(null);

  const flushPendingAnchor = useCallback(() => {
    if (dirtyAnchorRef.current && currentAnchorRef.current) {
      dirtyAnchorRef.current = false;
      void markBookRead(book.id, { anchor: currentAnchorRef.current });
    }
  }, [book.id]);

  useEffect(() => {
    return () => {
      flushPendingAnchor();
    };
  }, [flushPendingAnchor]);

  const requestClose = useCallback(() => {
    flushPendingAnchor();
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      onClose();
      return;
    }
    setClosing(true);
  }, [flushPendingAnchor, onClose]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
    void markBookRead(book.id, { opened: true });
  }, [book.id, ensureBody]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth || Math.round(el.getBoundingClientRect().width);
      const h =
        el.clientHeight || Math.round(el.getBoundingClientRect().height);
      if (w > 0 && h > 0) {
        const stageW = Math.round(w);
        const nextWidth = Math.min(stageW, maxPageStageW);
        const nextHeight = Math.round(h);
        setViewport(prev => {
          if (prev.width === nextWidth && prev.height === nextHeight) {
            const padX =
              pageWidth === 'extended'
                ? Math.min(24, Math.max(16, Math.round(nextWidth * 0.04)))
                : Math.min(56, Math.max(40, Math.round(nextWidth * 0.115)));
            const textMeasureW = Math.min(
              Math.max(180, nextWidth - padX * 2),
              maxTextMeasure,
            );
            const prevInline = prev.stageWidth - textMeasureW < 156;
            const nextInline = stageW - textMeasureW < 156;
            if (prevInline === nextInline) return prev;
          }
          return {
            width: nextWidth,
            height: nextHeight,
            stageWidth: stageW,
          };
        });
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxPageStageW, maxTextMeasure, pageWidth]);

  const body: BookBody = bodyEntry?.body ?? EMPTY_BODY;
  const readerLab = useUiStateLab(s => (UI_STATE_LAB ? s.reader : 'live'));
  const hasChapters = body.chapters.length > 0;
  const hasReadableContent =
    readerLab === 'empty'
      ? false
      : body.chapters.some(ch => ch.highlights.length > 0);
  const effectiveError =
    readerLab === 'error' ? new Error('Lab error') : bodyEntry?.error;
  const effectiveLoaded =
    readerLab === 'skeleton' ? false : Boolean(bodyEntry?.loaded);

  const sections = useMemo(() => {
    const coverUrl = book.artUrl
      ? thumbUrl(book.artUrl, COVER_FETCH_WIDTH)
      : null;
    return readerSections(
      book,
      body,
      {
        by: author => t('reader.by', { author }),
        page: p => t('chapter.page', { page: p }),
        summary: t('book.summary'),
        untitledChapter: t('chapters.untitled'),
        contents: t('reader.contents'),
        theEnd: t('reader.theEnd'),
        genre: g => genreLabel(k => t(k), g),
        year: y => formatYear(y, abs => t('bookEdit.year.bc', { year: abs })),
      },
      coverUrl,
    );
    // `activeLocale` refreshes translated strings when locale switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    book.artUrl,
    book.author,
    book.genres,
    book.name,
    book.year,
    body,
    activeLocale,
  ]);

  const bookArtSeed = useMemo(
    () => hashArtSeed(book.id || book.name),
    [book.id, book.name],
  );
  const slidePadX =
    pageWidth === 'extended'
      ? Math.min(24, Math.max(16, Math.round(viewport.width * 0.04)))
      : Math.min(56, Math.max(40, Math.round(viewport.width * 0.115)));
  const slideTextMeasureW = Math.min(
    Math.max(180, viewport.width - slidePadX * 2),
    maxTextMeasure,
  );
  const inlineEdgeArt =
    Boolean(palette.ornament) && viewport.stageWidth - slideTextMeasureW < 156;

  const pagination = useMemo(() => {
    const padTop = 68;
    const padBottom = 54;
    return paginateSections(sections, {
      width: Math.max(180, viewport.width - slidePadX * 2),
      height: Math.max(280, viewport.height - padTop - padBottom),
      fontScale,
      maxMeasure: maxTextMeasure,
      coverLabel: t('reader.cover'),
      titleLabel: t('reader.titlePage'),
      includeEmptyHighlightsPage: !hasReadableContent,
      emptyHighlightsLabel: t('chapter.highlights'),
      inlineEdgeArt,
      artSeed: bookArtSeed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sections,
    viewport.width,
    viewport.height,
    slidePadX,
    fontScale,
    maxTextMeasure,
    hasReadableContent,
    activeLocale,
    inlineEdgeArt,
    bookArtSeed,
  ]);

  const { pages, toc } = pagination;

  const [pageIndex, setPageIndex] = useState(() =>
    pages.length > 0 ? pageIndexForAnchor(pages, book.readerAnchor) : 0,
  );
  const [scrollSectionId, setScrollSectionId] = useState<string>(() =>
    sectionIdFromAnchor(book.readerAnchor, sections),
  );

  useEffect(() => {
    if (pageTurn === 'slide') {
      scheduleHeaderLinger();
    } else {
      clearLinger();
      if (lastScrollTopRef.current <= 64) {
        updateBarState(false, false);
      }
    }
    return () => clearLinger();
  }, [pageTurn, pageIndex, scheduleHeaderLinger, clearLinger, updateBarState]);

  useEffect(() => {
    const key = `${scaleIndex}:${pageTurn}:${pageWidth}`;
    if (prevScaleAndTurn.current === key) return;
    prevScaleAndTurn.current = key;
    if (pageTurn !== 'scroll') {
      updateScrolled(false);
      lastScrollTopRef.current = 0;
    }
    setReflowing(true);
    const id = window.setTimeout(() => setReflowing(false), 260);
    return () => window.clearTimeout(id);
  }, [scaleIndex, pageTurn, pageWidth, updateScrolled]);

  // Restore saved `readerAnchor` on initial load AND preserve reading spot across reflows.
  useEffect(() => {
    if (pages.length === 0 || !bodyEntry?.loaded) return;
    const anchor = initialAnchorApplied.current
      ? currentAnchorRef.current
      : book.readerAnchor;
    const restored = pageIndexForAnchor(pages, anchor);
    const restoredPage = pages[restored];
    if (restoredPage && !initialAnchorApplied.current) {
      currentAnchorRef.current = restoredPage.anchor;
    }
    initialAnchorApplied.current = true;
    setPageIndex(restored);
    if (restoredPage && pageTurn !== 'scroll') {
      setScrollSectionId(restoredPage.sectionId);
    }
  }, [pages, bodyEntry?.loaded, pageTurn, book.readerAnchor]);

  useLayoutEffect(() => {
    if (
      !bodyEntry?.loaded ||
      sections.length === 0 ||
      initialScrollAnchorApplied.current
    ) {
      return;
    }
    initialScrollAnchorApplied.current = true;
    const targetSecId = sectionIdFromAnchor(
      currentAnchorRef.current ?? book.readerAnchor,
      sections,
    );
    setScrollSectionId(targetSecId);
  }, [bodyEntry?.loaded, book.readerAnchor, sections]);

  // Persist `readerAnchor` and `finishedAt` as pages turn.
  useEffect(() => {
    if (
      !bodyEntry?.loaded ||
      pages.length === 0 ||
      pageTurn === 'scroll' ||
      !initialAnchorApplied.current
    ) {
      return;
    }
    const activePage = pages[Math.min(pageIndex, pages.length - 1)];
    if (!activePage) return;
    currentAnchorRef.current = activePage.anchor;
    useBooksStore
      .getState()
      .patchBook(book.id, { readerAnchor: activePage.anchor });
    const isLast = pageIndex >= pages.length - 1 && hasReadableContent;
    const markFinished = isLast && !finishedMarkedRef.current;
    if (markFinished) finishedMarkedRef.current = true;

    const timer = window.setTimeout(() => {
      dirtyAnchorRef.current = false;
      void markBookRead(book.id, {
        anchor: activePage.anchor,
        ...(markFinished ? { finished: true } : {}),
      });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [
    book.id,
    bodyEntry?.loaded,
    hasReadableContent,
    pageIndex,
    pageTurn,
    pages,
  ]);

  const goToPage = useCallback(
    (targetIndex: number) => {
      if (pages.length === 0) return;
      const clamped = Math.max(0, Math.min(pages.length - 1, targetIndex));
      const targetPage = pages[clamped];
      if (targetPage) {
        currentAnchorRef.current = targetPage.anchor;
        dirtyAnchorRef.current = true;
        initialAnchorApplied.current = true;
        setScrollSectionId(targetPage.sectionId);
        useBooksStore
          .getState()
          .patchBook(book.id, { readerAnchor: targetPage.anchor });
      }
      setPageIndex(clamped);
    },
    [book.id, pages],
  );

  const commitTurn = useCallback(
    (direction: 'next' | 'prev') => {
      if (pages.length === 0) return;
      const targetIndex = direction === 'next' ? pageIndex + 1 : pageIndex - 1;
      if (targetIndex < 0 || targetIndex >= pages.length) return;
      goToPage(targetIndex);
    },
    [goToPage, pageIndex, pages.length],
  );

  const togglePanel = useCallback((next?: boolean) => {
    morph(() => {
      setPanelOpen(prev => (typeof next === 'boolean' ? next : !prev));
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (panelOpen && !window.matchMedia(DESK).matches) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setPanelOpen(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (panelOpen) {
          e.stopPropagation();
          togglePanel(false);
          return;
        }
        e.stopPropagation();
        requestClose();
      } else if (
        pageTurn === 'scroll' &&
        (e.key === 'ArrowDown' ||
          e.key === 'ArrowUp' ||
          e.key === 'PageDown' ||
          e.key === 'PageUp' ||
          e.key === 'Home' ||
          e.key === 'End' ||
          e.key === ' ')
      ) {
        programmaticScrollRef.current = null;
      } else if (
        pageTurn !== 'scroll' &&
        (e.key === 'ArrowRight' || e.key === ' ')
      ) {
        e.preventDefault();
        commitTurn('next');
      } else if (pageTurn !== 'scroll' && e.key === 'ArrowLeft') {
        e.preventDefault();
        commitTurn('prev');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [panelOpen, commitTurn, pageTurn, requestClose, togglePanel]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isDesk =
      typeof window !== 'undefined' && window.matchMedia(DESK).matches;
    if (
      pageTurn === 'scroll' ||
      (panelOpen && !isDesk) ||
      (e.target as HTMLElement).closest('button, a')
    ) {
      return;
    }

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      direction: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        dragStateRef.current = null;
        return;
      }
      drag.moved = true;
      drag.direction = dx < 0 ? 'next' : 'prev';
    }

    if (pageTurn === 'slide') {
      const atEdge =
        (dx > 0 && pageIndex === 0) ||
        (dx < 0 && pageIndex >= pages.length - 1);
      applySlideDragDom(atEdge ? dx * 0.25 : dx, pageIndex);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;

    if (!drag.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (relX < 0.34) {
        commitTurn('prev');
      } else if (relX > 0.66) {
        commitTurn('next');
      } else if (barTuckedRef.current) {
        revealHeader(true);
      } else {
        clearLinger();
        updateBarState(true, true);
      }
      return;
    }

    applySlideDragDom(0, pageIndex);
    if (dx < -55 && pageIndex < pages.length - 1) {
      goToPage(pageIndex + 1);
    } else if (dx > 55 && pageIndex > 0) {
      goToPage(pageIndex - 1);
    }
  };

  const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const activeTocSectionId =
    pageTurn === 'scroll' ? scrollSectionId : (activePage?.sectionId ?? null);

  // Keep the active TOC row scrolled into view inside the 7-item internal scroll container.
  useEffect(() => {
    if (!panelOpen || !activeTocSectionId) return;
    const host = tocCardRef.current;
    if (!host) return;
    const timer = window.setTimeout(() => {
      const activeBtn = host.querySelector<HTMLElement>('.toc-row.is-active');
      if (!activeBtn) return;
      const top = activeBtn.offsetTop;
      const bottom = top + activeBtn.offsetHeight;
      const viewTop = host.scrollTop;
      const viewBottom = viewTop + host.clientHeight;
      if (top < viewTop || bottom > viewBottom) {
        host.scrollTo({
          top: Math.max(
            0,
            top - host.clientHeight / 2 + activeBtn.offsetHeight / 2,
          ),
          behavior: 'smooth',
        });
      }
    }, 90);
    return () => window.clearTimeout(timer);
  }, [activeTocSectionId, panelOpen, pageTurn]);

  // Persist `readerAnchor` in scroll mode as the active section changes.
  useEffect(() => {
    if (
      !bodyEntry?.loaded ||
      pageTurn !== 'scroll' ||
      !scrollSectionId ||
      !initialScrollAnchorApplied.current
    ) {
      return;
    }
    const nextAnchor: ReaderAnchor =
      currentAnchorRef.current &&
      sectionIdFromAnchor(currentAnchorRef.current, sections) ===
        scrollSectionId
        ? currentAnchorRef.current
        : { blockId: scrollSectionId, offset: 0 };
    currentAnchorRef.current = nextAnchor;
    dirtyAnchorRef.current = true;
    useBooksStore.getState().patchBook(book.id, { readerAnchor: nextAnchor });
    const timer = window.setTimeout(() => {
      dirtyAnchorRef.current = false;
      void markBookRead(book.id, {
        anchor: nextAnchor,
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [book.id, bodyEntry?.loaded, pageTurn, scrollSectionId, sections]);

  const jumpToTocEntry = (sectionId: string, pageOneBased: number) => {
    if (typeof window === 'undefined' || !window.matchMedia(DESK).matches) {
      setPanelOpen(false);
    }
    const targetIdx = Math.max(0, Math.min(pages.length - 1, pageOneBased - 1));
    if (pageTurn === 'scroll') {
      const anchor: ReaderAnchor = pages[targetIdx]?.anchor ?? {
        blockId: sectionId,
        offset: 0,
      };
      currentAnchorRef.current = anchor;
      dirtyAnchorRef.current = true;
      initialAnchorApplied.current = true;
      setPageIndex(targetIdx);
      setScrollSectionId(sectionId);
      useBooksStore.getState().patchBook(book.id, { readerAnchor: anchor });

      const el = scrollRef.current;
      if (el) {
        programmaticScrollRef.current = {
          active: true,
          startedAt: performance.now(),
        };
        if (sectionId === sections[0]?.id) {
          if (el.scrollTop > 2) {
            el.scrollTo({ top: 0, behavior: 'smooth' });
          }
        } else {
          const nodes = el.querySelectorAll<HTMLElement>('[data-section-id]');
          const firstTop = nodes[0]?.offsetTop ?? 0;
          const target = el.querySelector<HTMLElement>(
            `[data-section-id="${CSS.escape(sectionId)}"]`,
          );
          if (target) {
            const targetTop = Math.max(0, target.offsetTop - firstTop);
            if (Math.abs(el.scrollTop - targetTop) > 2) {
              el.scrollTo({ top: targetTop, behavior: 'smooth' });
            }
          }
        }
      }
      return;
    }
    goToPage(targetIdx);
  };

  const handleSelectBookIndexChapter = (chapterId: string) => {
    const exact = toc.find(e => e.id === `chapter:${chapterId}`);
    if (exact) {
      jumpToTocEntry(exact.id, exact.page);
      return;
    }
    if (!hasReadableContent) {
      const emptyEntry =
        toc.find(e => e.kind === 'empty') ?? toc[toc.length - 1];
      if (emptyEntry) {
        jumpToTocEntry(emptyEntry.id, emptyEntry.page);
      }
    }
  };

  const isScrollSurface = pageTurn === 'scroll' || readerLab === 'decorations';

  const barCls = [
    'reader-bar',
    'is-shown',
    isScrollSurface && scrolled ? 'is-edge' : '',
    barTucked ? 'is-tucked' : '',
    barTucked && barIdle ? 'is-idle' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const readerOverlay = (
    <div
      className={[
        'reader',
        palette.dark ? 'is-dark' : 'is-light',
        resolvedTheme === 'book' ? 'is-illustrated' : '',
        pageWidth === 'extended' ? 'is-extended' : '',
        panelOpen ? 'is-tooled' : '',
        closing && 'is-closing',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        backgroundColor: 'var(--reader-page)',
        color: 'var(--reader-text)',
        ['--reader-page' as string]: palette.page,
        ['--reader-text' as string]: palette.text,
        ['--reader-muted' as string]: palette.muted,
        ['--reader-pad-x' as string]: `${slidePadX}px`,
        ['--measure-w' as string]:
          pageTurn === 'scroll'
            ? pageWidth === 'extended'
              ? '48rem'
              : '34rem'
            : `${slideTextMeasureW}px`,
        ...(palette.accent
          ? { ['--reader-accent' as string]: palette.accent }
          : {}),
        ...(palette.accentSecondary
          ? { ['--reader-accent-2' as string]: palette.accentSecondary }
          : {}),
      }}
      role="dialog"
      aria-modal="true"
      aria-label={book.name}
    >
      <div
        className="reader-main"
        onPointerMove={e => {
          if (e.clientY <= 68 && barTucked) {
            revealHeader(true);
          }
        }}
      >
        <header
          ref={barRef}
          className={barCls}
          onPointerEnter={() => clearLinger()}
          onPointerLeave={() => {
            if (!barTucked) scheduleHeaderLinger();
          }}
          onFocusCapture={() => clearLinger()}
          onBlurCapture={() => {
            if (!barTucked) scheduleHeaderLinger();
          }}
        >
          <button
            type="button"
            className="round reader-btn reader-lead"
            onClick={requestClose}
          >
            <CloseGlyph />
            <span className="sr">{t('reader.close')}</span>
          </button>

          <span className="reader-bar-title">{book.name}</span>

          <button
            type="button"
            className="round reader-btn bar-glyph"
            title={t('reader.settings.open')}
            aria-expanded={panelOpen}
            onClick={() => togglePanel()}
          >
            <GearGlyph />
            <span className="sr">{t('reader.settings.open')}</span>
          </button>
        </header>

        <div
          ref={stageRef}
          className={reflowing ? 'reader-stage is-reflowing' : 'reader-stage'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragStateRef.current = null;
            applySlideDragDom(0, pageIndex);
          }}
        >
          {effectiveError ? (
            <div className="side-empty is-full">
              <h3>{t('reader.error.title')}</h3>
              <p>{t('reader.error.subtitle')}</p>
            </div>
          ) : !effectiveLoaded ? (
            <div className="reader-loading">
              <span className="spinner" />
            </div>
          ) : readerLab === 'decorations' ? (
            <ReaderDecorationsCatalog
              palette={palette}
              onScrollPosition={handleScrollPosition}
            />
          ) : readerLab === 'empty' ? (
            <div className="side-empty is-full">
              <span className="side-empty-mark">
                <BookOpenGlyph />
              </span>
              <h3>{t('reader.empty.title')}</h3>
              <p>{t('reader.empty.subtitle')}</p>
              {onOpenFirstChapterHighlight && (
                <button
                  type="button"
                  className="pill is-primary"
                  onClick={onOpenFirstChapterHighlight}
                >
                  <span>
                    {hasChapters
                      ? t('reader.empty.action')
                      : t('reader.empty.actionIndex')}
                  </span>
                </button>
              )}
            </div>
          ) : pageTurn === 'scroll' ? (
            <ScrollReaderBody
              sections={sections}
              fontScale={fontScale}
              palette={palette}
              artSeed={bookArtSeed}
              scrollRef={scrollRef}
              hasReadableContent={hasReadableContent}
              hasChapters={hasChapters}
              initialSectionId={scrollSectionId}
              programmaticScrollRef={programmaticScrollRef}
              onEmptyAction={onOpenFirstChapterHighlight}
              onSelectChapter={handleSelectBookIndexChapter}
              onScrollPosition={handleScrollPosition}
              onActiveSectionChange={setScrollSectionId}
              onReachedBottom={() => {
                if (!finishedMarkedRef.current && hasReadableContent) {
                  finishedMarkedRef.current = true;
                  void markBookRead(book.id, { finished: true });
                }
              }}
            />
          ) : (
            <div className="reader-book-frame is-slide-frame">
              <div
                ref={slideEdgeOverlayRef}
                className="reader-slide-edge-overlay"
                aria-hidden="true"
              >
                {pages.map(p => {
                  if (Math.abs(p.index - pageIndex) > 1) return null;
                  const endEdgeLayout =
                    inlineEdgeArt && palette.ornament && p.kind === 'end'
                      ? resolveMarginArtLayout(
                          p.index,
                          true,
                          bookArtSeed,
                          pages.length,
                        )
                      : null;
                  const hasDesktopMarginArt =
                    Boolean(palette.ornament) &&
                    !inlineEdgeArt &&
                    p.kind !== 'cover' &&
                    p.kind !== 'bookIndex' &&
                    p.kind !== 'empty';
                  const hasBottomEdgeArt = Boolean(
                    palette.ornament && p.bottomEdgeArt,
                  );
                  if (
                    !hasDesktopMarginArt &&
                    !hasBottomEdgeArt &&
                    !endEdgeLayout
                  ) {
                    return null;
                  }
                  return (
                    <div
                      key={`edge-${p.index}`}
                      className={
                        p.index === pageIndex
                          ? 'reader-slide-edge-layer is-current'
                          : 'reader-slide-edge-layer'
                      }
                    >
                      {hasDesktopMarginArt && (
                        <BookPageMarginArt
                          index={p.index}
                          seed={bookArtSeed}
                          totalPages={pages.length}
                          forceShow={p.kind === 'title' || p.kind === 'end'}
                          color={palette.accent}
                          secondaryColor={palette.accentSecondary}
                        />
                      )}
                      {hasBottomEdgeArt && p.bottomEdgeArt && (
                        <div className="reader-slide-bottom-art">
                          <BookPageEdgeMotif
                            motif={p.bottomEdgeArt.motif}
                            side={p.bottomEdgeArt.side}
                            topPct={p.bottomEdgeArt.topPct}
                            color={palette.accent}
                            secondaryColor={palette.accentSecondary}
                          />
                        </div>
                      )}
                      {endEdgeLayout && (
                        <div className="reader-slide-bottom-art is-pair">
                          <BookPageEdgeMotif
                            motif={endEdgeLayout.leftMotif}
                            side="left"
                            color={palette.accent}
                            secondaryColor={palette.accentSecondary}
                          />
                          <BookPageEdgeMotif
                            motif={endEdgeLayout.rightMotif}
                            side="right"
                            color={palette.accent}
                            secondaryColor={palette.accentSecondary}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div
                ref={slideTrackRef}
                className="reader-slide-track"
                style={{
                  transform: `translate3d(${-pageIndex * 100}%, 0, 0)`,
                }}
              >
                {pages.map(p => (
                  <div
                    key={p.index}
                    className={
                      p.index === pageIndex
                        ? 'reader-slide-cell is-current'
                        : 'reader-slide-cell'
                    }
                  >
                    {Math.abs(p.index - pageIndex) <= 1 ? (
                      <div
                        className="reader-slide-page"
                        style={{ width: viewport.width }}
                      >
                        <PageSheetContent
                          page={p}
                          totalPages={pages.length}
                          palette={palette}
                          artSeed={bookArtSeed}
                          hasReadableContent={hasReadableContent}
                          hasChapters={hasChapters}
                          onEmptyAction={onOpenFirstChapterHighlight}
                          onSelectChapter={handleSelectBookIndexChapter}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={
          panelOpen
            ? 'modal-scrim reader-scrim is-open'
            : 'modal-scrim reader-scrim'
        }
        aria-hidden="true"
        onClick={() => togglePanel(false)}
      />

      <div className="tools reader-tools">
        {showPanel && (
          <SidePanel
            open={panelOpen}
            index={0}
            title={t('reader.settings.title')}
            action={
              <button
                type="button"
                className="round"
                onClick={() => togglePanel(false)}
              >
                <CloseGlyph />
                <span className="sr">{t('common.close')}</span>
              </button>
            }
            trailing={<span aria-hidden="true" />}
            onClose={() => togglePanel(false)}
          >
            {toc.length > 0 && (
              <section className="reader-toc-section">
                <h3 className="section-head">{t('reader.contents')}</h3>
                <div className="card reader-toc-card">
                  <div
                    ref={tocCardRef}
                    className={
                      toc.length > 7
                        ? 'reader-toc-scroll is-scrollable'
                        : 'reader-toc-scroll'
                    }
                  >
                    {toc.map(entry => {
                      const current = activeTocSectionId === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={
                            current
                              ? 'cell link-row toc-row is-active'
                              : 'cell link-row toc-row'
                          }
                          onClick={() => jumpToTocEntry(entry.id, entry.page)}
                        >
                          <span className="toc-label">{entry.label}</span>
                          <span className="toc-page">
                            {current ? <CheckGlyph /> : entry.page}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            <section>
              <h3 className="section-head">{t('reader.settings.textSize')}</h3>
              <div className="card">
                <div className="cell text-scale-row">
                  <button
                    type="button"
                    className="scale-step small"
                    disabled={scaleIndex <= 0}
                    onClick={() => {
                      if (scaleIndex <= 0) return;
                      setScaleIndex(scaleIndex - 1);
                    }}
                  >
                    A
                  </button>
                  <div className="scale-dots" role="group">
                    {TEXT_SCALES.map((step, idx) => (
                      <button
                        key={step}
                        type="button"
                        className={
                          idx === scaleIndex
                            ? 'scale-dot is-active'
                            : 'scale-dot'
                        }
                        aria-label={`${Math.round(step * 100)}%`}
                        onClick={() => setScaleIndex(idx)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="scale-step large"
                    disabled={scaleIndex >= TEXT_SCALES.length - 1}
                    onClick={() => {
                      if (scaleIndex >= TEXT_SCALES.length - 1) return;
                      setScaleIndex(scaleIndex + 1);
                    }}
                  >
                    A
                  </button>
                </div>
              </div>
            </section>

            <div className="reader-dual-settings">
              <section>
                <h3 className="section-head">
                  {t('reader.settings.pageWidth')}
                </h3>
                <div className="segmented reader-turn-picker">
                  {PAGE_WIDTHS.map(w => (
                    <button
                      key={w}
                      type="button"
                      className={pageWidth === w ? 'is-active' : undefined}
                      onClick={() => setPageWidth(w as PageWidth)}
                    >
                      {t(`reader.settings.widths.${w}`)}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="section-head">
                  {t('reader.settings.pageTurn')}
                </h3>
                <div className="segmented reader-turn-picker">
                  {PAGE_TURNS.map(mode => (
                    <button
                      key={mode}
                      type="button"
                      className={pageTurn === mode ? 'is-active' : undefined}
                      onClick={() => setPageTurn(mode as PageTurn)}
                    >
                      {t(`reader.settings.turns.${mode}`)}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <section>
              <h3 className="section-head">{t('reader.settings.themes')}</h3>
              <div className="theme-swatches">
                {READER_THEMES.map(th => {
                  const sw = readerPalette(th, coverPalette, appScheme);
                  const selected = resolvedTheme === th;
                  return (
                    <button
                      key={th}
                      type="button"
                      className={[
                        'theme-swatch',
                        th === 'book' ? 'is-book-swatch' : '',
                        selected ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        backgroundColor: sw.page,
                        color: sw.text,
                        ...(sw.accent
                          ? { ['--swatch-accent' as string]: sw.accent }
                          : {}),
                      }}
                      onClick={() => setReaderTheme(th)}
                    >
                      <span className="swatch-aa">Aa</span>
                      <span className="swatch-name">
                        {t(`reader.settings.names.${th}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div
              className={
                palette.ornament
                  ? 'reader-tools-colophon'
                  : 'reader-tools-colophon is-hidden'
              }
              aria-hidden="true"
            >
              <BookPageOrnament
                style={palette.ornament}
                variant="footer"
                seed={4}
                color={palette.accent}
                secondaryColor={palette.accentSecondary}
                active={Boolean(palette.ornament)}
              />
            </div>
          </SidePanel>
        )}
      </div>
    </div>
  );

  return createPortal(readerOverlay, document.body);
}
