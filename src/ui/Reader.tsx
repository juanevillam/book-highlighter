import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useScheme } from '../appearance';
import {
  EMPTY_BODY,
  markBookRead,
  type Book,
  type BookBody,
} from '../books';
import { t, useLocale } from '../i18n';
import { UI_STATE_LAB, useUiStateLab } from '../dev/uiStateLab';
import { formatYear } from '../lib/bookFields';
import { useBookCoverPalette } from '../lib/coverPalette';
import { genreLabel } from '../lib/genres';
import {
  pageIndexForAnchor,
  paginateSections,
  parseHighlightSegments,
  READER_SANS_STACK,
  READER_SERIF_STACK,
  type PaginatedPage,
} from '../lib/paginator';
import {
  COVER_FETCH_WIDTH,
  readerSections,
  type ReaderSection,
} from '../lib/readerSections';
import {
  DEFAULT_TEXT_SCALE_INDEX,
  effectiveTheme,
  PAGE_TURNS,
  READER_THEMES,
  readerPalette,
  TEXT_SCALES,
  type BookOrnamentStyle,
  type PageTurn,
  type ReaderPalette,
} from '../lib/readerThemes';
import { thumbUrl } from '../lib/thumbUrl';
import { useBodiesStore } from '../store/bodies';
import { useReaderSettingsStore } from '../store/readerSettings';

import {
  BookOpenGlyph,
  CheckGlyph,
  CloseGlyph,
  GearGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';

const DESK = '(min-width: 64rem)';
const LEAVE_MS = 320;

export function BookPageOrnament({
  style: _style,
  variant = 'header',
  seed = 0,
  color,
  secondaryColor,
}: {
  style?: BookOrnamentStyle;
  variant?: 'title' | 'header' | 'footer';
  seed?: number;
  color?: string;
  secondaryColor?: string;
}) {
  const c1 = color ?? 'currentColor';
  const c2 = secondaryColor ?? c1;
  const motif = Math.abs(seed) % 5;

  if (motif === 0) {
    // Open book with botanical leaves & starlight
    return (
      <svg
        className={`reader-ornament is-${variant}`}
        viewBox="0 0 180 26"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M14 13 C36 13 48 9 68 13 M112 13 C132 9 144 13 166 13"
          stroke={c1}
          strokeOpacity="0.52"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M90 19 C84 15 76 15 72 17 V7 C76 5 84 5 90 9 C96 5 104 5 108 7 V17 C104 15 96 15 90 19 Z"
          stroke={c1}
          strokeWidth="1.35"
          strokeLinejoin="round"
          fill={c1}
          fillOpacity="0.14"
        />
        <path d="M90 9 V19" stroke={c1} strokeWidth="1.2" />
        <path
          d="M60 13 C56 8 49 8 47 13 C51 15 56 15 60 13 Z M120 13 C124 8 131 8 133 13 C129 15 124 15 120 13 Z"
          fill={c2}
          fillOpacity="0.72"
        />
        <circle cx="38" cy="13" r="1.8" fill={c1} fillOpacity="0.65" />
        <circle cx="142" cy="13" r="1.8" fill={c1} fillOpacity="0.65" />
      </svg>
    );
  }

  if (motif === 1) {
    // Botanical olive & berry garland
    return (
      <svg
        className={`reader-ornament is-${variant}`}
        viewBox="0 0 180 26"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M16 13 Q52 6 82 13 M98 13 Q128 20 164 13"
          stroke={c1}
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M90 4 L94 13 L90 22 L86 13 Z"
          fill={c1}
          fillOpacity="0.82"
        />
        <path
          d="M66 11 C61 6 54 7 52 11 C56 14 62 13 66 11 Z M114 15 C119 20 126 19 128 15 C124 12 118 13 114 15 Z"
          fill={c2}
          fillOpacity="0.78"
        />
        <path
          d="M46 12 C41 8 35 9 33 13 C37 15 43 14 46 12 Z M134 14 C139 18 145 17 147 13 C143 11 137 12 134 14 Z"
          fill={c2}
          fillOpacity="0.62"
        />
        <circle cx="76" cy="13" r="2" fill={c1} fillOpacity="0.75" />
        <circle cx="104" cy="13" r="2" fill={c1} fillOpacity="0.75" />
      </svg>
    );
  }

  if (motif === 2) {
    // Quill scroll & library seal
    return (
      <svg
        className={`reader-ornament is-${variant}`}
        viewBox="0 0 180 26"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M18 13 H68 M112 13 H162"
          stroke={c1}
          strokeOpacity="0.46"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
        <path
          d="M74 17 C78 9 86 6 98 6 C95 12 90 16 82 18 L74 20 L76 14"
          stroke={c1}
          strokeWidth="1.3"
          fill={c2}
          fillOpacity="0.32"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="60" cy="13" r="2" fill={c2} fillOpacity="0.72" />
        <circle cx="120" cy="13" r="2" fill={c2} fillOpacity="0.72" />
      </svg>
    );
  }

  if (motif === 3) {
    // Celestial library star & crescent moons
    return (
      <svg
        className={`reader-ornament is-${variant}`}
        viewBox="0 0 180 26"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M16 13 H64 M116 13 H164"
          stroke={c1}
          strokeOpacity="0.48"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
        <path
          d="M90 3 L92.6 10.4 L100 13 L92.6 15.6 L90 23 L87.4 15.6 L80 13 L87.4 10.4 Z"
          fill={c1}
          fillOpacity="0.86"
        />
        <path
          d="M73 8 A5.5 5.5 0 1 0 73 18 A4.2 4.2 0 1 1 73 8 Z M107 8 A5.5 5.5 0 1 1 107 18 A4.2 4.2 0 1 0 107 8 Z"
          fill={c2}
          fillOpacity="0.75"
        />
      </svg>
    );
  }

  // Motif 4: Classic library double-rule flourish
  return (
    <svg
      className={`reader-ornament is-${variant}`}
      viewBox="0 0 180 26"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M18 11.5 H70 M110 11.5 H162 M28 14.5 H70 M110 14.5 H152"
        stroke={c1}
        strokeOpacity="0.48"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <rect
        x="84.5"
        y="7.5"
        width="11"
        height="11"
        transform="rotate(45 90 13)"
        stroke={c1}
        strokeWidth="1.35"
        fill={c2}
        fillOpacity="0.34"
      />
      <circle cx="76" cy="13" r="1.8" fill={c1} fillOpacity="0.7" />
      <circle cx="104" cy="13" r="1.8" fill={c1} fillOpacity="0.7" />
    </svg>
  );
}

/**
 * Edge-bleed cozy library & botanical marginalia illustrations that emerge from
 * the left and right edges of the page (never stuck in the corners), rotating
 * across 6 distinct hand-crafted motifs as the reader progresses through the book.
 */
export function BookPageMarginArt({
  index,
  color,
  secondaryColor,
}: {
  index: number;
  color?: string;
  secondaryColor?: string;
}) {
  const c1 = color ?? 'currentColor';
  const c2 = secondaryColor ?? c1;
  const rightMotif = Math.abs(index * 2) % 6;
  const leftMotif = Math.abs(index * 2 + 3) % 6;
  const rightTopPct = 18 + ((index * 17) % 44);
  const leftTopPct = 26 + ((index * 23 + 11) % 44);

  const renderEdgeSvg = (motif: number, side: 'left' | 'right') => {
    const cls = `reader-edge-art is-${side} is-motif-${motif}`;
    const style = {
      top: `${side === 'right' ? rightTopPct : leftTopPct}%`,
    };

    if (motif === 0) {
      // Botanical olive & laurel branch curving in from the page edge
      return (
        <svg
          key={`${side}-${motif}`}
          className={cls}
          style={style}
          viewBox="0 0 76 160"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M76 138 C54 118 36 86 24 44 C19 26 22 14 28 6"
            stroke={c1}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M48 110 C34 112 22 104 20 94 C30 92 42 98 48 110 Z"
            fill={c2}
            fillOpacity="0.42"
            stroke={c2}
            strokeWidth="1.2"
          />
          <path
            d="M54 92 C62 80 58 66 48 60 C44 70 46 84 54 92 Z"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <path
            d="M34 74 C20 74 10 64 10 54 C20 54 30 62 34 74 Z"
            fill={c2}
            fillOpacity="0.45"
            stroke={c2}
            strokeWidth="1.2"
          />
          <path
            d="M36 52 C44 40 42 26 34 20 C29 30 30 42 36 52 Z"
            fill={c1}
            fillOpacity="0.36"
            stroke={c1}
            strokeWidth="1.2"
          />
          <circle cx="18" cy="36" r="3" fill={c1} fillOpacity="0.65" />
          <circle cx="38" cy="82" r="2.5" fill={c1} fillOpacity="0.6" />
        </svg>
      );
    }

    if (motif === 1) {
      // Stacked library books with a flowing ribbon bookmark emerging from the edge
      return (
        <svg
          key={`${side}-${motif}`}
          className={cls}
          style={style}
          viewBox="0 0 76 160"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="2"
            y="42"
            width="46"
            height="14"
            rx="3"
            transform="rotate(-6 2 42)"
            fill={c1}
            fillOpacity="0.22"
            stroke={c1}
            strokeWidth="1.4"
          />
          <rect
            x="0"
            y="58"
            width="54"
            height="16"
            rx="3"
            fill={c2}
            fillOpacity="0.26"
            stroke={c2}
            strokeWidth="1.4"
          />
          <rect
            x="0"
            y="76"
            width="60"
            height="17"
            rx="3"
            transform="rotate(3 0 76)"
            fill={c1}
            fillOpacity="0.28"
            stroke={c1}
            strokeWidth="1.4"
          />
          <path
            d="M44 74 C52 92 42 114 54 132 L46 128 L38 134 C44 114 36 92 44 74 Z"
            fill={c1}
            fillOpacity="0.58"
          />
          <path
            d="M34 22 L36 28 L42 30 L36 32 L34 38 L32 32 L26 30 L32 28 Z"
            fill={c2}
            fillOpacity="0.68"
          />
        </svg>
      );
    }

    if (motif === 2) {
      // Cozy library teacup resting on a closed volume with curling steam wisps
      return (
        <svg
          key={`${side}-${motif}`}
          className={cls}
          style={style}
          viewBox="0 0 76 160"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="16"
            y="104"
            width="58"
            height="13"
            rx="3"
            fill={c2}
            fillOpacity="0.26"
            stroke={c2}
            strokeWidth="1.4"
          />
          <path
            d="M28 76 H64 V92 C64 99 58 104 50 104 H42 C34 104 28 99 28 92 V76 Z"
            fill={c1}
            fillOpacity="0.24"
            stroke={c1}
            strokeWidth="1.4"
          />
          <path
            d="M28 80 H20 C16 80 14 83 14 86 C14 90 17 92 21 92 H28"
            stroke={c1}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M38 66 C34 56 44 46 38 34 C34 26 40 18 44 12"
            stroke={c1}
            strokeOpacity="0.65"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M50 68 C46 58 56 48 50 38"
            stroke={c2}
            strokeOpacity="0.65"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    }

    if (motif === 3) {
      // Pressed wildflower & fern frond leaning in from the margin
      return (
        <svg
          key={`${side}-${motif}`}
          className={cls}
          style={style}
          viewBox="0 0 76 160"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 142 C18 112 28 82 44 42"
            stroke={c2}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle
            cx="46"
            cy="38"
            r="4.5"
            fill={c1}
            fillOpacity="0.85"
          />
          <circle
            cx="46"
            cy="26"
            r="5"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <circle
            cx="57"
            cy="35"
            r="5"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <circle
            cx="53"
            cy="48"
            r="5"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <circle
            cx="37"
            cy="46"
            r="5"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <circle
            cx="35"
            cy="33"
            r="5"
            fill={c1}
            fillOpacity="0.34"
            stroke={c1}
            strokeWidth="1.2"
          />
          <path
            d="M24 96 C36 92 44 98 46 106 C36 108 26 104 24 96 Z M30 74 C18 68 12 58 16 50 C24 54 30 64 30 74 Z"
            fill={c2}
            fillOpacity="0.42"
            stroke={c2}
            strokeWidth="1.2"
          />
        </svg>
      );
    }

    if (motif === 4) {
      // Hanging reading lantern & celestial sparkles emerging from the edge
      return (
        <svg
          key={`${side}-${motif}`}
          className={cls}
          style={style}
          viewBox="0 0 76 160"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M76 24 H36 C30 24 28 28 28 34 V52"
            stroke={c1}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M18 58 H38 L42 88 L28 98 L14 88 L18 58 Z"
            fill={c1}
            fillOpacity="0.22"
            stroke={c1}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="28" cy="76" r="4.5" fill={c1} fillOpacity="0.78" />
          <path
            d="M14 116 L16 122 L22 124 L16 126 L14 132 L12 126 L6 124 L12 122 Z"
            fill={c2}
            fillOpacity="0.68"
          />
          <circle cx="44" cy="112" r="2" fill={c1} fillOpacity="0.58" />
        </svg>
      );
    }

    // Motif 5: Fountain pen nib, ink scroll & calligraphic wave
    return (
      <svg
        key={`${side}-${motif}`}
        className={cls}
        style={style}
        viewBox="0 0 76 160"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M0 36 L28 52 L42 74 L22 70 L0 54 Z"
          fill={c1}
          fillOpacity="0.26"
          stroke={c1}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="26" cy="60" r="2.2" fill={c1} />
        <path
          d="M42 74 C56 88 30 108 46 126 C54 136 42 148 26 146"
          stroke={c2}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="52" cy="104" r="2.2" fill={c1} fillOpacity="0.62" />
      </svg>
    );
  };

  return (
    <div className="reader-margin-decor" aria-hidden="true">
      {renderEdgeSvg(leftMotif, 'left')}
      {renderEdgeSvg(rightMotif, 'right')}
    </div>
  );
}

function PageSheetContent({
  page,
  totalPages,
  palette,
  mirrored = false,
  hasReadableContent = true,
  hasChapters = false,
  onEmptyAction,
  onSelectChapter,
}: {
  page: PaginatedPage;
  totalPages: number;
  palette: ReaderPalette;
  mirrored?: boolean;
  hasReadableContent?: boolean;
  hasChapters?: boolean;
  onEmptyAction?: () => void;
  onSelectChapter?: (chapterId: string) => void;
}) {
  const hasHeading = page.items.some(it => it.style === 'heading');
  const showFooterOrnament =
    Boolean(palette.ornament) &&
    !hasHeading &&
    page.kind === 'content' &&
    page.index % 3 === 1;

  return (
    <div
      className={[
        'reader-page-inner',
        mirrored ? 'is-mirrored' : '',
        palette.ornament ? 'is-book-themed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        color: palette.text,
        ['--reader-page' as string]: palette.page,
        ['--reader-text' as string]: palette.text,
        ['--reader-muted' as string]: palette.muted,
        ...(palette.accent
          ? { ['--reader-accent' as string]: palette.accent }
          : {}),
        ...(palette.accentSecondary
          ? { ['--reader-accent-2' as string]: palette.accentSecondary }
          : {}),
      }}
    >
      {palette.ornament && page.kind !== 'cover' && (
        <BookPageMarginArt
          index={page.index}
          color={palette.accent}
          secondaryColor={palette.accentSecondary}
        />
      )}

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
                  color: palette.muted,
                }}
              >
                {page.titleCard.subheading}
              </p>
            )}
            {palette.ornament && (
              <BookPageOrnament
                style={palette.ornament}
                variant="title"
                seed={0}
                color={palette.accent}
                secondaryColor={palette.accentSecondary}
              />
            )}
            {page.titleCard.meta && (
              <p
                className="reader-title-meta"
                style={{
                  fontFamily: READER_SANS_STACK,
                  fontSize: page.titleCard.metaSize,
                  color: palette.muted,
                }}
              >
                {page.titleCard.meta}
              </p>
            )}
            {!hasReadableContent && onEmptyAction && (
              <div className="reader-inline-empty-cta">
                <p style={{ color: palette.muted }}>
                  {t('reader.empty.title')}
                </p>
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
              </div>
            )}
          </div>
        ) : page.kind === 'bookIndex' && page.indexCard ? (
          <div className="reader-book-index">
            <div className="reader-book-index-head">
              {palette.ornament && (
                <BookPageOrnament
                  style={palette.ornament}
                  variant="header"
                  seed={1}
                  color={palette.accent}
                  secondaryColor={palette.accentSecondary}
                />
              )}
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
                const interactive =
                  entry.hasHighlights && Boolean(onSelectChapter);
                return (
                  <button
                    key={entry.chapterId}
                    type="button"
                    disabled={!interactive}
                    className={
                      interactive
                        ? 'reader-book-index-row is-interactive'
                        : 'reader-book-index-row'
                    }
                    style={{
                      fontFamily: READER_SERIF_STACK,
                      fontSize: page.indexCard?.rowSize,
                      color: palette.text,
                    }}
                    onClick={() => onSelectChapter?.(entry.chapterId)}
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
                          color: palette.muted,
                        }}
                      >
                        {entry.pages}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!hasReadableContent && onEmptyAction && (
              <div className="reader-inline-empty-cta">
                <p style={{ color: palette.muted }}>
                  {t('reader.empty.title')}
                </p>
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
              </div>
            )}
          </div>
        ) : page.kind === 'empty' ? (
          <div className="side-empty is-full reader-page-empty">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('reader.empty.title')}</h3>
            <p style={{ color: palette.muted }}>{t('reader.empty.subtitle')}</p>
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
                  color: item.muted ? palette.muted : palette.text,
                  fontFamily: item.serif
                    ? READER_SERIF_STACK
                    : READER_SANS_STACK,
                }}
              >
                {item.style === 'heading' && palette.ornament && idx === 0 && (
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="header"
                    seed={page.index + 2}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
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
          style={{ color: palette.muted, fontFamily: READER_SANS_STACK }}
        >
          {showFooterOrnament && palette.ornament && (
            <BookPageOrnament
              style={palette.ornament}
              variant="footer"
              seed={page.index + 4}
              color={palette.accent}
              secondaryColor={palette.accentSecondary}
            />
          )}
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
  scrollRef,
  hasReadableContent,
  hasChapters,
  onEmptyAction,
  onScrolledChange,
  onActiveSectionChange,
  onReachedBottom,
}: {
  sections: ReaderSection[];
  fontScale: number;
  palette: ReaderPalette;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasReadableContent: boolean;
  hasChapters: boolean;
  onEmptyAction?: () => void;
  onScrolledChange: (scrolled: boolean) => void;
  onActiveSectionChange?: (sectionId: string) => void;
  onReachedBottom: () => void;
}) {
  const detectActiveSection = useCallback(
    (el: HTMLDivElement) => {
      if (!onActiveSectionChange) return;
      const nodes = el.querySelectorAll<HTMLElement>('[data-section-id]');
      if (nodes.length === 0) return;
      const probeY = el.scrollTop + el.clientHeight * 0.32;
      let chosen = nodes[0]!.dataset.sectionId ?? '';
      for (const node of nodes) {
        if (node.offsetTop <= probeY) {
          chosen = node.dataset.sectionId ?? chosen;
        } else {
          break;
        }
      }
      if (chosen) onActiveSectionChange(chosen);
    },
    [onActiveSectionChange],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) detectActiveSection(el);
  }, [detectActiveSection, scrollRef, sections]);

  return (
    <div
      ref={scrollRef}
      className="reader-scroll-view"
      style={{ color: palette.text }}
      onScroll={e => {
        const el = e.currentTarget;
        onScrolledChange(el.scrollTop > 8);
        detectActiveSection(el);
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) {
          onReachedBottom();
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
                    index={sectionIdx}
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
                      color: palette.muted,
                    }}
                  >
                    {section.subheading}
                  </p>
                )}
                {palette.ornament && (
                  <BookPageOrnament
                    style={palette.ornament}
                    variant="title"
                    seed={0}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                  />
                )}
                {section.paragraphs?.map((meta, idx) => (
                  <p
                    key={idx}
                    style={{
                      fontFamily: READER_SANS_STACK,
                      fontSize: Math.round(13 * fontScale),
                      color: palette.muted,
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
                {palette.ornament && (
                  <BookPageMarginArt
                    index={sectionIdx}
                    color={palette.accent}
                    secondaryColor={palette.accentSecondary}
                  />
                )}
                <div className="reader-book-index-head">
                  {palette.ornament && (
                    <BookPageOrnament
                      style={palette.ornament}
                      variant="header"
                      seed={1}
                      color={palette.accent}
                      secondaryColor={palette.accentSecondary}
                    />
                  )}
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
                  {section.indexEntries.map(entry => (
                    <div
                      key={entry.chapterId}
                      className="reader-book-index-row"
                      style={{
                        fontFamily: READER_SERIF_STACK,
                        fontSize: Math.round(15.5 * fontScale),
                        color: palette.text,
                      }}
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
                            color: palette.muted,
                          }}
                        >
                          {entry.pages}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          return (
            <section
              key={section.id}
              data-section-id={section.id}
              className="reader-scroll-section"
            >
              {palette.ornament && (
                <BookPageMarginArt
                  index={sectionIdx}
                  color={palette.accent}
                  secondaryColor={palette.accentSecondary}
                />
              )}
              {section.heading && (
                <>
                  {palette.ornament && (
                    <BookPageOrnament
                      style={palette.ornament}
                      variant="header"
                      seed={sectionIdx + 1}
                      color={palette.accent}
                      secondaryColor={palette.accentSecondary}
                    />
                  )}
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
                    color: palette.muted,
                  }}
                >
                  {section.subheading}
                </p>
              )}

              {section.paragraphs?.map((para, idx) => (
                <p
                  key={idx}
                  className="reader-scroll-prose"
                  style={{
                    fontFamily: READER_SERIF_STACK,
                    fontSize: Math.round(17.5 * fontScale),
                    lineHeight: 1.56,
                  }}
                >
                  {para}
                </p>
              ))}

              {section.highlights?.map((hl, idx) => {
                const segments = parseHighlightSegments(hl.text);
                return (
                  <blockquote
                    key={idx}
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
                          color: palette.muted,
                        }}
                      >
                        {hl.page}
                      </footer>
                    )}
                  </blockquote>
                );
              })}
            </section>
          );
        })}

        {!hasReadableContent && (
          <div className="side-empty reader-scroll-empty">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('reader.empty.title')}</h3>
            <p style={{ color: palette.muted }}>{t('reader.empty.subtitle')}</p>
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
  const scaleIndex = useReaderSettingsStore(state => state.scaleIndex);
  const setReaderTheme = useReaderSettingsStore(state => state.setReaderTheme);
  const setPageTurn = useReaderSettingsStore(state => state.setPageTurn);
  const setScaleIndex = useReaderSettingsStore(state => state.setScaleIndex);

  const coverPalette = useBookCoverPalette(
    book.artUrl,
    `${book.id}:${book.name}`,
  );
  const resolvedTheme = effectiveTheme(chosenTheme, appScheme);
  const palette = readerPalette(resolvedTheme, coverPalette, appScheme);
  const fontScale = TEXT_SCALES[scaleIndex] ?? 1;

  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocCardRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? Math.min(window.innerWidth, 680) : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 780,
  });

  const [scrolled, setScrolled] = useState(false);
  const [scrollSectionId, setScrollSectionId] = useState<string>('title');
  const [reflowing, setReflowing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelOpen, setPanelOpen] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(DESK).matches,
  );
  const [leavingPanel, setLeavingPanel] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [slideOffsetPx, setSlideOffsetPx] = useState(0);
  const prevScaleAndTurn = useRef(`${scaleIndex}:${pageTurn}`);

  useEffect(() => {
    if (panelOpen) {
      setLeavingPanel(true);
      return;
    }
    const id = window.setTimeout(() => setLeavingPanel(false), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [panelOpen]);

  const showPanel = panelOpen || leavingPanel;

  useEffect(() => {
    const key = `${scaleIndex}:${pageTurn}`;
    if (prevScaleAndTurn.current === key) return;
    prevScaleAndTurn.current = key;
    if (pageTurn !== 'scroll') setScrolled(false);
    setReflowing(true);
    const id = window.setTimeout(() => setReflowing(false), 240);
    return () => window.clearTimeout(id);
  }, [scaleIndex, pageTurn]);

  const requestClose = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      onClose();
      return;
    }
    setClosing(true);
  }, [onClose]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 220);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  const initialAnchorApplied = useRef(false);
  const currentAnchorRef = useRef(book.readerAnchor);
  const finishedMarkedRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    direction: 'next' | 'prev' | null;
  } | null>(null);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
    void markBookRead(book.id, { opened: true });
  }, [book.id, ensureBody]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({
          width: Math.min(Math.round(rect.width), 680),
          height: Math.round(rect.height),
        });
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    const coverUrl = book.artUrl ? thumbUrl(book.artUrl, COVER_FETCH_WIDTH) : null;
    return readerSections(
      book,
      body,
      {
        by: author => t('reader.by', { author }),
        page: p => t('chapter.page', { page: p }),
        summary: t('book.summary'),
        untitledChapter: t('chapters.untitled'),
        contents: t('reader.contents'),
        genre: g => genreLabel(k => t(k), g),
        year: y => formatYear(y, abs => t('bookEdit.year.bc', { year: abs })),
      },
      coverUrl,
    );
    // `activeLocale` refreshes translated strings when locale switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, body, activeLocale]);

  const pagination = useMemo(() => {
    const padX = Math.min(40, Math.max(22, Math.round(viewport.width * 0.075)));
    const padTop = 68;
    const padBottom = 54;
    return paginateSections(sections, {
      width: Math.max(220, viewport.width - padX * 2),
      height: Math.max(280, viewport.height - padTop - padBottom),
      fontScale,
      coverLabel: t('reader.cover'),
      titleLabel: t('reader.titlePage'),
      includeEmptyHighlightsPage: !hasReadableContent,
      emptyHighlightsLabel: t('chapter.highlights'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sections,
    viewport.width,
    viewport.height,
    fontScale,
    hasReadableContent,
    activeLocale,
  ]);

  const { pages, toc } = pagination;

  // Restore saved `readerAnchor` on initial load AND preserve reading spot across reflows.
  useEffect(() => {
    if (pages.length === 0 || !bodyEntry?.loaded) return;
    const anchor = initialAnchorApplied.current
      ? currentAnchorRef.current
      : book.readerAnchor;
    const restored = pageIndexForAnchor(pages, anchor);
    initialAnchorApplied.current = true;
    setPageIndex(restored);
  }, [pages, bodyEntry?.loaded, book.readerAnchor]);

  // Persist `readerAnchor` and `finishedAt` as pages turn.
  useEffect(() => {
    if (!bodyEntry?.loaded || pages.length === 0 || pageTurn === 'scroll') return;
    const activePage = pages[Math.min(pageIndex, pages.length - 1)];
    if (!activePage) return;
    currentAnchorRef.current = activePage.anchor;
    const isLast = pageIndex >= pages.length - 1 && hasReadableContent;
    const markFinished = isLast && !finishedMarkedRef.current;
    if (markFinished) finishedMarkedRef.current = true;

    const timer = window.setTimeout(() => {
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

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  const commitTurn = useCallback(
    (direction: 'next' | 'prev') => {
      if (pages.length === 0 || settleTimerRef.current !== null) return;
      const targetIndex =
        direction === 'next' ? pageIndex + 1 : pageIndex - 1;
      if (targetIndex < 0 || targetIndex >= pages.length) return;
      setPageIndex(targetIndex);
    },
    [pageIndex, pages.length],
  );

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
          setPanelOpen(false);
          return;
        }
        e.stopPropagation();
        requestClose();
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
  }, [panelOpen, commitTurn, pageTurn, requestClose]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isDesk =
      typeof window !== 'undefined' &&
      window.matchMedia(DESK).matches;
    if (
      pageTurn === 'scroll' ||
      (panelOpen && !isDesk) ||
      settleTimerRef.current !== null ||
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
      setSlideOffsetPx(atEdge ? dx * 0.25 : dx);
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
      }
      return;
    }

    setSlideOffsetPx(0);
    if (dx < -55 && pageIndex < pages.length - 1) {
      setPageIndex(i => i + 1);
    } else if (dx > 55 && pageIndex > 0) {
      setPageIndex(i => i - 1);
    }
  };

  const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const activeTocSectionId =
    pageTurn === 'scroll' ? scrollSectionId : (activePage?.sectionId ?? null);

  // Keep the active TOC row scrolled into view inside the 6-item internal scroll container.
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
    if (!bodyEntry?.loaded || pageTurn !== 'scroll' || !scrollSectionId) return;
    const timer = window.setTimeout(() => {
      void markBookRead(book.id, {
        anchor: { blockId: scrollSectionId, offset: 0 },
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [book.id, bodyEntry?.loaded, pageTurn, scrollSectionId]);

  const jumpToTocEntry = (sectionId: string, pageOneBased: number) => {
    if (
      typeof window === 'undefined' ||
      !window.matchMedia(DESK).matches
    ) {
      setPanelOpen(false);
    }
    if (pageTurn === 'scroll') {
      setScrollSectionId(sectionId);
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-section-id="${CSS.escape(sectionId)}"]`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setPageIndex(Math.max(0, Math.min(pages.length - 1, pageOneBased - 1)));
  };

  const barCls = [
    'reader-bar',
    'is-shown',
    pageTurn === 'scroll' && scrolled ? 'is-edge' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const readerOverlay = (
    <div
      className={[
        'reader',
        palette.dark ? 'is-dark' : 'is-light',
        panelOpen ? 'is-tooled' : '',
        closing && 'is-closing',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        backgroundColor: palette.page,
        color: palette.text,
        ['--reader-page' as string]: palette.page,
        ['--reader-text' as string]: palette.text,
        ['--reader-muted' as string]: palette.muted,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={book.name}
    >
      <div className="reader-main">
        <header className={barCls}>
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
            onClick={() => setPanelOpen(v => !v)}
          >
            <GearGlyph />
            <span className="sr">{t('reader.settings.open')}</span>
          </button>
        </header>

        <div
          ref={stageRef}
          className={
            reflowing ? 'reader-stage is-reflowing' : 'reader-stage'
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragStateRef.current = null;
            setSlideOffsetPx(0);
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
              scrollRef={scrollRef}
              hasReadableContent={hasReadableContent}
              hasChapters={hasChapters}
              onEmptyAction={onOpenFirstChapterHighlight}
              onScrolledChange={setScrolled}
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
                className={
                  slideOffsetPx !== 0
                    ? 'reader-slide-track is-dragging'
                    : 'reader-slide-track'
                }
                style={{
                  transform: `translate3d(calc(${-pageIndex * 100}% + ${slideOffsetPx}px), 0, 0)`,
                }}
              >
                {pages.map(p => (
                  <div key={p.index} className="reader-slide-cell">
                    <div
                      className="reader-slide-page"
                      style={{ width: viewport.width }}
                    >
                      <PageSheetContent
                        page={p}
                        totalPages={pages.length}
                        palette={palette}
                        hasReadableContent={hasReadableContent}
                        hasChapters={hasChapters}
                        onEmptyAction={onOpenFirstChapterHighlight}
                        onSelectChapter={chapterId => {
                          const targetEntry = toc.find(
                            e => e.id === `chapter:${chapterId}`,
                          );
                          if (targetEntry) {
                            jumpToTocEntry(targetEntry.id, targetEntry.page);
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={
          panelOpen ? 'modal-scrim reader-scrim is-open' : 'modal-scrim reader-scrim'
        }
        aria-hidden="true"
        onClick={() => setPanelOpen(false)}
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
                onClick={() => setPanelOpen(false)}
              >
                <CloseGlyph />
                <span className="sr">{t('common.close')}</span>
              </button>
            }
            trailing={<span aria-hidden="true" />}
            onClose={() => setPanelOpen(false)}
          >
            {toc.length > 0 && (
              <section className="reader-toc-section">
                <h3 className="section-head">{t('reader.contents')}</h3>
                <div ref={tocCardRef} className="card reader-toc-card">
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
                        className={[
                          'scale-dot',
                          idx === DEFAULT_TEXT_SCALE_INDEX ? 'is-default' : '',
                          idx === scaleIndex ? 'is-active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
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

            <section>
              <h3 className="section-head">{t('reader.settings.pageTurn')}</h3>
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
          </SidePanel>
        )}
      </div>
    </div>
  );

  return createPortal(readerOverlay, document.body);
}
