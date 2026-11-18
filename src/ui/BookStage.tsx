import { useEffect, useRef } from 'react';

import { type Book } from '../books';
import { plural, t } from '../i18n';
import { formatYear } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import { useBodiesStore } from '../store/bodies';

import { Artwork } from './Artwork';
import { GenreGlyph, genreTint } from './genreGlyphs';
import { CloseGlyph, ContentsGlyph, PencilGlyph, ShareGlyph } from './glyphs';

const DISMISS_PX = 120;
const DISMISS_VELOCITY = 0.6;

export type StagePanel = 'chapters' | 'export' | 'bookForm';

/**
 * The book's column — Sound Shaper's player column, slot for slot: the
 * cover over the flowing wash, the title over the author, the genres where
 * the scrubber sits, Read where the transport sits, and the glass dock with
 * Chapters and Export as Shape and Clips, Edit hugging the end.
 */
export function BookStage({
  book,
  panel,
  onCloseMobile,
  onRead,
  onOpenChapters,
  onEditBook,
  onExportBook,
}: {
  book: Book;
  panel: StagePanel | null;
  onCloseMobile: () => void;
  onRead: () => void;
  onOpenChapters: () => void;
  onEditBook: () => void;
  onExportBook: () => void;
}) {
  const ensureBody = useBodiesStore(state => state.ensure);
  const sectionRef = useRef<HTMLElement>(null);
  const onCloseMobileRef = useRef(onCloseMobile);
  onCloseMobileRef.current = onCloseMobile;

  // Warm the body so Chapters and the reader open without a wait.
  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  // Allow pulling the mobile book stage down from anywhere on the console
  // without triggering iOS Chrome's pull-to-refresh.
  useEffect(() => {
    const col = sectionRef.current?.closest<HTMLElement>('.now-column');
    if (!col) return;

    let grab: {
      x: number;
      y: number;
      t: number;
      id: number;
      captured: boolean;
    } | null = null;

    const resetTransform = () => {
      col.style.transition = '';
      col.style.transform = '';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (matchMedia('(min-width: 64rem)').matches) return;
      if ((e.target as HTMLElement | null)?.closest('.genre-tags')) return;
      if (e.cancelable) e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (matchMedia('(min-width: 64rem)').matches) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.genre-tags')) return;
      const onInteractive = Boolean(
        target?.closest('button, a, input, select, textarea'),
      );
      grab = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        id: e.pointerId,
        captured: !onInteractive,
      };
      if (!onInteractive) {
        col.setPointerCapture(e.pointerId);
        col.style.transition = 'none';
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!grab || grab.id !== e.pointerId) return;
      const dx = e.clientX - grab.x;
      const dy = e.clientY - grab.y;
      if (!grab.captured) {
        if (Math.hypot(dx, dy) < 6) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          grab = null;
          return;
        }
        grab.captured = true;
        col.setPointerCapture(e.pointerId);
        col.style.transition = 'none';
      }
      col.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
    };

    const onPointerUp = (e: PointerEvent) => {
      const start = grab;
      grab = null;
      if (!start || !start.captured) return;
      resetTransform();
      const dy = e.clientY - start.y;
      const v = dy / Math.max(1, performance.now() - start.t);
      if (dy > DISMISS_PX || (dy > 24 && v > DISMISS_VELOCITY)) {
        onCloseMobileRef.current();
      }
    };

    const onPointerCancel = () => {
      grab = null;
      resetTransform();
    };

    col.addEventListener('touchmove', onTouchMove, { passive: false });
    col.addEventListener('pointerdown', onPointerDown);
    col.addEventListener('pointermove', onPointerMove);
    col.addEventListener('pointerup', onPointerUp);
    col.addEventListener('pointercancel', onPointerCancel);
    return () => {
      col.removeEventListener('touchmove', onTouchMove);
      col.removeEventListener('pointerdown', onPointerDown);
      col.removeEventListener('pointermove', onPointerMove);
      col.removeEventListener('pointerup', onPointerUp);
      col.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  const chaptersSummary =
    book.chapterCount === 0
      ? plural('book.chapterCount', 0)
      : `${book.chapterCount} · ${plural('book.highlightCount', book.highlightCount)}`;

  return (
    <>
      <div className="stage-bar">
        <button
          type="button"
          className="round stage-close-mobile"
          onClick={onCloseMobile}
        >
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>

        <button
          type="button"
          className="collapse"
          aria-label={t('common.close')}
          onClick={onCloseMobile}
        >
          <span className="grabber" />
        </button>
      </div>

      <section ref={sectionRef} className="now" aria-label={book.name}>
        <div className="now-art">
          <Artwork
            artUrl={book.artUrl}
            name={book.name}
            width={520}
            quickWidth={220}
            eager
          />
        </div>

        <div className="now-copy">
          <span className="now-title">{book.name}</span>
          {(book.author || book.year !== null) && (
            <span className="now-artist">
              {book.author}
              {book.year !== null && (
                <span className="now-year">
                  {book.author ? ' · ' : ''}
                  {formatYear(book.year, y =>
                    t('bookEdit.year.bc', { year: y }),
                  )}
                </span>
              )}
            </span>
          )}
        </div>

        {book.genres.length > 0 ? (
          <ul className="genre-tags">
            {book.genres.map(g => (
              <li
                key={g}
                className="genre-tag"
                style={{ '--tag-tint': genreTint(g) } as React.CSSProperties}
              >
                <GenreGlyph genre={g} />
                <span>{genreLabel(k => t(k), g)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="genre-tags" aria-hidden="true" />
        )}

        <div className="transport">
          <button
            type="button"
            className="pill is-primary book-read-btn"
            onClick={onRead}
          >
            <span>{t(book.readerAnchor ? 'book.continue' : 'book.read')}</span>
          </button>
        </div>

        <div className="dock">
          <button
            type="button"
            className="dock-cell"
            aria-expanded={panel === 'chapters'}
            onClick={onOpenChapters}
          >
            <span className="dock-icon">
              <ContentsGlyph />
            </span>
            <span className="dock-copy">
              <span className="dock-label">{t('book.chapters')}</span>
              <span className="dock-summary">{chaptersSummary}</span>
            </span>
          </button>
          <button
            type="button"
            className="dock-cell"
            aria-expanded={panel === 'export'}
            onClick={onExportBook}
          >
            <span className="dock-icon">
              <ShareGlyph />
            </span>
            <span className="dock-copy">
              <span className="dock-label">{t('book.exportShort')}</span>
              <span className="dock-summary">{t('book.exportSummary')}</span>
            </span>
          </button>
          <button
            type="button"
            className="dock-cell is-hug"
            aria-expanded={panel === 'bookForm'}
            aria-label={t('app.bookEdit')}
            onClick={onEditBook}
          >
            <span className="dock-icon">
              <PencilGlyph />
            </span>
            <span className="dock-label">{t('common.edit')}</span>
          </button>
        </div>
      </section>
    </>
  );
}
