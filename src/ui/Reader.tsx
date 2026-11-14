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
import { formatYear } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import {
  pageIndexForAnchor,
  paginateSections,
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
  effectiveTheme,
  PAGE_TURNS,
  READER_THEMES,
  readerPalette,
  TEXT_SCALES,
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
  ContentsGlyph,
  TextSizeGlyph,
} from './glyphs';

const CURL_DURATION_MS = 430;

type ActiveCurl = {
  direction: 'next' | 'prev';
  targetIndex: number;
  /** Progress `0..1`: for `next`, `0` = flat right edge, `1` = fully turned left. */
  progress: number;
  settling: boolean;
};

function PageSheetContent({
  page,
  totalPages,
  palette,
  mirrored = false,
}: {
  page: PaginatedPage;
  totalPages: number;
  palette: ReaderPalette;
  mirrored?: boolean;
}) {
  return (
    <div
      className={mirrored ? 'reader-page-inner is-mirrored' : 'reader-page-inner'}
      style={{
        color: palette.text,
        ['--reader-page' as string]: palette.page,
        ['--reader-text' as string]: palette.text,
        ['--reader-muted' as string]: palette.muted,
      }}
    >
      <div className="reader-page-body">
        {page.kind === 'cover' && page.imageUrl ? (
          <div className="reader-cover-frame">
            <img src={page.imageUrl} alt="" draggable={false} />
          </div>
        ) : page.kind === 'title' && page.titleCard ? (
          <div className="reader-title-card">
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
          {t('reader.pageOf', { page: page.index + 1, total: totalPages })}
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
  onReachedBottom,
}: {
  sections: ReaderSection[];
  fontScale: number;
  palette: ReaderPalette;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onReachedBottom: () => void;
}) {
  return (
    <div
      ref={scrollRef}
      className="reader-scroll-view"
      style={{ color: palette.text }}
      onScroll={e => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) {
          onReachedBottom();
        }
      }}
    >
      <div className="reader-scroll-measure">
        {sections.map(section => {
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

          return (
            <section
              key={section.id}
              data-section-id={section.id}
              className="reader-scroll-section"
            >
              {section.heading && (
                <h3
                  style={{
                    fontFamily: READER_SERIF_STACK,
                    fontSize: Math.round(22 * fontScale),
                  }}
                >
                  {section.heading}
                </h3>
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

              {section.highlights?.map((hl, idx) => (
                <blockquote
                  key={idx}
                  className="reader-scroll-quote"
                  style={{
                    fontFamily: READER_SERIF_STACK,
                    fontSize: Math.round(17.5 * fontScale),
                    lineHeight: 1.56,
                  }}
                >
                  <p>“{hl.text}”</p>
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
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function Reader({
  book,
  onClose,
}: {
  book: Book;
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

  const resolvedTheme = effectiveTheme(chosenTheme, appScheme);
  const palette = readerPalette(resolvedTheme);
  const fontScale = TEXT_SCALES[scaleIndex] ?? 1;

  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? Math.min(window.innerWidth, 680) : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 780,
  });

  const [chromeShown, setChromeShown] = useState(true);
  const [closing, setClosing] = useState(false);
  const [activeSheet, setActiveSheet] = useState<'settings' | 'contents' | null>(
    null,
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [curl, setCurl] = useState<ActiveCurl | null>(null);
  const [slideOffsetPx, setSlideOffsetPx] = useState(0);

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
  const hasReadableContent =
    Boolean(body.summary.trim()) ||
    body.chapters.some(ch => ch.highlights.length > 0);

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, viewport.width, viewport.height, fontScale, activeLocale]);

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
    (direction: 'next' | 'prev', fromProgress: number = 0.08) => {
      if (pages.length === 0 || settleTimerRef.current !== null) return;
      const targetIndex =
        direction === 'next' ? pageIndex + 1 : pageIndex - 1;
      if (targetIndex < 0 || targetIndex >= pages.length) return;

      if (
        pageTurn !== 'curl' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        setPageIndex(targetIndex);
        return;
      }

      setCurl({
        direction,
        targetIndex,
        progress: direction === 'next' ? fromProgress : 1 - fromProgress,
        settling: false,
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCurl({
            direction,
            targetIndex,
            progress: direction === 'next' ? 1 : 0,
            settling: true,
          });
        });
      });

      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        setPageIndex(targetIndex);
        setCurl(null);
      }, CURL_DURATION_MS);
    },
    [pageIndex, pageTurn, pages.length],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeSheet) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setActiveSheet(null);
        }
        return;
      }
      if (e.key === 'Escape') {
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
  }, [activeSheet, commitTurn, pageTurn, requestClose]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      pageTurn === 'scroll' ||
      activeSheet ||
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

    const span = Math.max(220, viewport.width * 0.85);
    if (pageTurn === 'curl') {
      if (drag.direction === 'next' && pageIndex < pages.length - 1) {
        const progress = Math.max(0.02, Math.min(0.98, -dx / span));
        setCurl({
          direction: 'next',
          targetIndex: pageIndex + 1,
          progress,
          settling: false,
        });
      } else if (drag.direction === 'prev' && pageIndex > 0) {
        const progress = Math.max(0.02, Math.min(0.98, 1 - dx / span));
        setCurl({
          direction: 'prev',
          targetIndex: pageIndex - 1,
          progress,
          settling: false,
        });
      }
    } else if (pageTurn === 'slide') {
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
      if (relX < 0.27) {
        commitTurn('prev');
      } else if (relX > 0.73) {
        commitTurn('next');
      } else {
        setChromeShown(v => !v);
      }
      return;
    }

    if (pageTurn === 'slide') {
      setSlideOffsetPx(0);
      if (dx < -55 && pageIndex < pages.length - 1) {
        setPageIndex(i => i + 1);
      } else if (dx > 55 && pageIndex > 0) {
        setPageIndex(i => i - 1);
      }
      return;
    }

    if (curl) {
      const span = Math.max(220, viewport.width * 0.85);
      const completed =
        curl.direction === 'next'
          ? -dx > span * 0.22
          : dx > span * 0.22;

      if (completed) {
        const endProgress = curl.direction === 'next' ? 1 : 0;
        const target = curl.targetIndex;
        setCurl({ ...curl, progress: endProgress, settling: true });
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          setPageIndex(target);
          setCurl(null);
        }, CURL_DURATION_MS * 0.75);
      } else {
        const revertProgress = curl.direction === 'next' ? 0 : 1;
        setCurl({ ...curl, progress: revertProgress, settling: true });
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          setCurl(null);
        }, CURL_DURATION_MS * 0.65);
      }
    }
  };

  const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];

  // Compute diagonal page-curl clip polygons when `curl` is active.
  const curlLayers = useMemo(() => {
    if (!curl || !activePage) return null;
    const frontPage =
      curl.direction === 'next' ? activePage : pages[curl.targetIndex];
    const underPage =
      curl.direction === 'next' ? pages[curl.targetIndex] : activePage;
    if (!frontPage || !underPage) return null;

    const p = Math.max(0.001, Math.min(0.999, curl.progress));
    // Diagonal crease: top fold lags bottom fold slightly (`slant`), matching a physical page lifted from the bottom-right corner.
    const slant = Math.sin(p * Math.PI) * 14;
    const topX = Math.max(0, Math.min(100, (1 - p) * 100 + slant * 0.55));
    const botX = Math.max(0, Math.min(100, (1 - p) * 100 - slant * 0.65));
    const flapWidth = Math.max(4, Math.sin(p * Math.PI) * 24 + 3);
    const flapTopL = Math.max(0, topX - flapWidth * 0.65);
    const flapBotL = Math.max(0, botX - flapWidth);

    return {
      frontPage,
      underPage,
      settling: curl.settling,
      frontClip: `polygon(0% 0%, ${topX.toFixed(2)}% 0%, ${botX.toFixed(2)}% 100%, 0% 100%)`,
      flapClip: `polygon(${flapTopL.toFixed(2)}% 0%, ${topX.toFixed(2)}% 0%, ${botX.toFixed(2)}% 100%, ${flapBotL.toFixed(2)}% 100%)`,
      creaseCenterPct: ((topX + botX) * 0.5).toFixed(2),
      flapAngleDeg: (-Math.atan2(topX - botX, 100) * (180 / Math.PI) * 0.45).toFixed(2),
    };
  }, [activePage, curl, pages]);

  const jumpToTocEntry = (sectionId: string, pageOneBased: number) => {
    setActiveSheet(null);
    if (pageTurn === 'scroll') {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-section-id="${CSS.escape(sectionId)}"]`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setPageIndex(Math.max(0, Math.min(pages.length - 1, pageOneBased - 1)));
  };

  const showBar = chromeShown || pageTurn === 'scroll' || activeSheet !== null;

  const readerOverlay = (
    <div
      className={[
        'reader',
        palette.dark ? 'is-dark' : 'is-light',
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
      <header className={showBar ? 'reader-bar is-shown' : 'reader-bar'}>
        <button
          type="button"
          className="round reader-btn"
          onClick={requestClose}
        >
          <CloseGlyph />
          <span className="sr">{t('reader.close')}</span>
        </button>

        <span className="reader-bar-title">{book.name}</span>

        <div className="reader-bar-actions">
          <button
            type="button"
            className="round reader-btn"
            aria-pressed={activeSheet === 'settings'}
            title={t('reader.settings.open')}
            onClick={() =>
              setActiveSheet(s => (s === 'settings' ? null : 'settings'))
            }
          >
            <TextSizeGlyph />
            <span className="sr">{t('reader.settings.open')}</span>
          </button>

          <button
            type="button"
            className="round reader-btn"
            aria-pressed={activeSheet === 'contents'}
            title={t('reader.contents')}
            onClick={() =>
              setActiveSheet(s => (s === 'contents' ? null : 'contents'))
            }
          >
            <ContentsGlyph />
            <span className="sr">{t('reader.contents')}</span>
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className="reader-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragStateRef.current = null;
          setCurl(null);
          setSlideOffsetPx(0);
        }}
      >
        {bodyEntry?.error ? (
          <div className="side-empty is-full">
            <h3>{t('reader.error.title')}</h3>
            <p>{t('reader.error.subtitle')}</p>
          </div>
        ) : !bodyEntry?.loaded ? (
          <div className="reader-loading">
            <span className="spinner" />
          </div>
        ) : !hasReadableContent && !book.artUrl ? (
          <div className="side-empty is-full">
            <span className="side-empty-mark">
              <BookOpenGlyph />
            </span>
            <h3>{t('reader.empty.title')}</h3>
            <p>{t('reader.empty.subtitle')}</p>
          </div>
        ) : pageTurn === 'scroll' ? (
          <ScrollReaderBody
            sections={sections}
            fontScale={fontScale}
            palette={palette}
            scrollRef={scrollRef}
            onReachedBottom={() => {
              if (!finishedMarkedRef.current && hasReadableContent) {
                finishedMarkedRef.current = true;
                void markBookRead(book.id, { finished: true });
              }
            }}
          />
        ) : pageTurn === 'slide' ? (
          <div className="reader-book-frame" style={{ width: viewport.width }}>
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
                  <PageSheetContent
                    page={p}
                    totalPages={pages.length}
                    palette={palette}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="reader-book-frame" style={{ width: viewport.width }}>
            {curlLayers ? (
              <div
                className={
                  curlLayers.settling
                    ? 'reader-curl-stack is-settling'
                    : 'reader-curl-stack'
                }
              >
                <div className="reader-curl-under">
                  <PageSheetContent
                    page={curlLayers.underPage}
                    totalPages={pages.length}
                    palette={palette}
                  />
                  <div
                    className="reader-curl-cast-shadow"
                    style={{
                      left: `${curlLayers.creaseCenterPct}%`,
                    }}
                  />
                </div>

                <div
                  className="reader-curl-front"
                  style={{ clipPath: curlLayers.frontClip }}
                >
                  <PageSheetContent
                    page={curlLayers.frontPage}
                    totalPages={pages.length}
                    palette={palette}
                  />
                </div>

                <div
                  className="reader-curl-flap"
                  style={{
                    clipPath: curlLayers.flapClip,
                    backgroundColor: palette.page,
                  }}
                >
                  <div
                    className="reader-curl-flap-mirror"
                    style={{
                      transform: `scaleX(-1) rotate(${curlLayers.flapAngleDeg}deg)`,
                    }}
                  >
                    <PageSheetContent
                      page={curlLayers.frontPage}
                      totalPages={pages.length}
                      palette={palette}
                      mirrored
                    />
                  </div>
                  <div className="reader-curl-flap-cylinder" />
                </div>
              </div>
            ) : (
              activePage && (
                <div className="reader-curl-single">
                  <PageSheetContent
                    page={activePage}
                    totalPages={pages.length}
                    palette={palette}
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Sub-sheet scrim & sheet inside Reader */}
      <div
        className={activeSheet ? 'sub-scrim is-open' : 'sub-scrim'}
        onClick={() => setActiveSheet(null)}
      />

      <div
        className={
          activeSheet === 'settings'
            ? 'sub-sheet reader-sheet is-open'
            : 'sub-sheet reader-sheet'
        }
        aria-hidden={activeSheet !== 'settings'}
      >
        <span className="sub-grabber" aria-hidden="true" />
        <div className="reader-sheet-head">
          <h2>{t('reader.settings.title')}</h2>
          <button
            type="button"
            className="round"
            onClick={() => setActiveSheet(null)}
          >
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        </div>

        <div className="reader-sheet-body">
          <section>
            <h3 className="section-head">{t('reader.settings.textSize')}</h3>
            <div className="card">
              <div className="cell text-scale-row">
                <button
                  type="button"
                  className="scale-step small"
                  disabled={scaleIndex <= 0}
                  onClick={() => setScaleIndex(scaleIndex - 1)}
                >
                  A
                </button>
                <div className="scale-dots" role="group">
                  {TEXT_SCALES.map((step, idx) => (
                    <button
                      key={step}
                      type="button"
                      className={
                        idx === scaleIndex ? 'scale-dot is-active' : 'scale-dot'
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
                  onClick={() => setScaleIndex(scaleIndex + 1)}
                >
                  A
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 className="section-head">{t('reader.settings.pageTurn')}</h3>
            <div className="card">
              <div className="cell">
                <div className="segmented">
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
              </div>
            </div>
          </section>

          <section>
            <h3 className="section-head">{t('reader.settings.themes')}</h3>
            <div className="theme-swatches">
              {READER_THEMES.map(th => {
                const sw = readerPalette(th);
                const selected = resolvedTheme === th;
                return (
                  <button
                    key={th}
                    type="button"
                    className={
                      selected ? 'theme-swatch is-active' : 'theme-swatch'
                    }
                    style={{
                      backgroundColor: sw.page,
                      color: sw.text,
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
        </div>
      </div>

      <div
        className={
          activeSheet === 'contents'
            ? 'sub-sheet reader-sheet is-open'
            : 'sub-sheet reader-sheet'
        }
        aria-hidden={activeSheet !== 'contents'}
      >
        <span className="sub-grabber" aria-hidden="true" />
        <div className="reader-sheet-head">
          <h2>{t('reader.contents')}</h2>
          <button
            type="button"
            className="round"
            onClick={() => setActiveSheet(null)}
          >
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        </div>

        <div className="reader-sheet-body">
          <div className="card">
            {toc.map(entry => {
              const current =
                pageTurn !== 'scroll' &&
                activePage?.sectionId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={
                    current ? 'cell link-row toc-row is-active' : 'cell link-row toc-row'
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
      </div>
    </div>
  );

  return createPortal(readerOverlay, document.body);
}
