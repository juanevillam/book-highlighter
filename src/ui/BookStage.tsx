import { useEffect, useRef, useState } from 'react';

import { type Book } from '../books';
import { plural, t } from '../i18n';
import { formatYear } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import { useBodiesStore } from '../store/bodies';

import { Artwork } from './Artwork';
import { StageBackdrop } from './Backdrop';
import { CalendarGlyph, GenreGlyph } from './genreGlyphs';
import {
  BookOpenGlyph,
  CloseGlyph,
  ContentsGlyph,
  PencilGlyph,
  ShareGlyph,
} from './glyphs';

const DISMISS_PX = 110;
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
  const [pull, setPull] = useState<number | null>(null);
  const grab = useRef<{ y: number; t: number; id: number } | null>(null);

  // Warm the body so Chapters and the reader open without a wait.
  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  const chaptersSummary =
    book.chapterCount === 0
      ? plural('book.chapterCount', 0)
      : `${book.chapterCount} · ${plural('book.highlightCount', book.highlightCount)}`;

  return (
    <div
      className="now-column"
      style={
        pull !== null
          ? ({
              transform: `translateY(${Math.max(pull, 0)}px)`,
              transition: 'none',
            } as React.CSSProperties)
          : undefined
      }
    >
      <StageBackdrop artUrl={book.artUrl} />

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
          onPointerDown={e => {
            grab.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
            setPull(0);
          }}
          onPointerMove={e => {
            if (!grab.current || grab.current.id !== e.pointerId) return;
            const dy = e.clientY - grab.current.y;
            setPull(dy > 0 ? dy : 0);
          }}
          onPointerUp={e => {
            const start = grab.current;
            grab.current = null;
            setPull(null);
            if (!start) return;
            const dy = e.clientY - start.y;
            const v = dy / Math.max(1, performance.now() - start.t);
            if (dy > DISMISS_PX || (dy > 24 && v > DISMISS_VELOCITY)) {
              onCloseMobile();
            }
          }}
          onPointerCancel={() => {
            grab.current = null;
            setPull(null);
          }}
        >
          <span className="grabber" />
        </button>
      </div>

      <section className="now" aria-label={book.name}>
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
          {book.author && <span className="now-artist">{book.author}</span>}
        </div>

        {book.year !== null || book.genres.length > 0 ? (
          <ul className="genre-tags">
            {book.year !== null && (
              <li className="genre-tag">
                <CalendarGlyph />
                <span>
                  {formatYear(book.year, y =>
                    t('bookEdit.year.bc', { year: y }),
                  )}
                </span>
              </li>
            )}
            {book.genres.map(g => (
              <li key={g} className="genre-tag">
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
            <span className="btn-glyph">
              <BookOpenGlyph />
            </span>
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
    </div>
  );
}
