import { useEffect, useRef, useState } from 'react';

import { type Book } from '../books';
import { plural, t } from '../i18n';
import { formatYear } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import { useBodiesStore } from '../store/bodies';

import { Artwork } from './Artwork';
import { StageBackdrop } from './Backdrop';
import {
  BookOpenGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  PencilGlyph,
  ShareGlyph,
} from './glyphs';

const DISMISS_PX = 110;
const DISMISS_VELOCITY = 0.6;

export function BookStage({
  book,
  onCloseMobile,
  onRead,
  onOpenChapters,
  onEditBook,
  onExportBook,
}: {
  book: Book;
  onCloseMobile: () => void;
  onRead: () => void;
  onOpenChapters: () => void;
  onEditBook: () => void;
  onExportBook: () => void;
}) {
  const ensureBody = useBodiesStore(state => state.ensure);
  const bodyEntry = useBodiesStore(state => state.entries[book.id]);
  const [pull, setPull] = useState<number | null>(null);
  const grab = useRef<{ y: number; t: number; id: number } | null>(null);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  const metaLine = [
    book.year !== null
      ? formatYear(book.year, y => t('bookEdit.year.bc', { year: y }))
      : '',
    book.genres.map(g => genreLabel(k => t(k), g)).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  const summary = bodyEntry?.body.summary.trim() ?? '';
  const chaptersSummary =
    book.chapterCount === 0
      ? ''
      : `${plural('book.chapterCount', book.chapterCount)} · ${plural('book.highlightCount', book.highlightCount)}`;

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

        <div className="glass-pill">
          <button
            type="button"
            title={t('book.exportPdf')}
            onClick={onExportBook}
          >
            <ShareGlyph />
            <span className="sr">{t('book.exportPdf')}</span>
          </button>
          <button
            type="button"
            title={t('common.edit')}
            onClick={onEditBook}
          >
            <PencilGlyph />
            <span className="sr">{t('common.edit')}</span>
          </button>
        </div>
      </div>

      <div className="book-stage-scroll">
        <div className="book-hero">
          <div className="book-hero-cover">
            <Artwork
              artUrl={book.artUrl}
              name={book.name}
              width={340}
              quickWidth={220}
              eager
            />
          </div>

          <h2 className="book-hero-title">{book.name}</h2>
          {book.author && <p className="book-hero-author">{book.author}</p>}
          {metaLine && <p className="book-hero-meta">{metaLine}</p>}

          <div className="book-hero-actions">
            <button
              type="button"
              className="pill is-primary book-read-btn"
              onClick={onRead}
            >
              <span className="btn-glyph">
                <BookOpenGlyph />
              </span>
              <span>
                {t(book.readerAnchor ? 'book.continue' : 'book.read')}
              </span>
            </button>
          </div>
        </div>

        {summary && (
          <section className="stage-section">
            <h3 className="section-head">{t('book.summary')}</h3>
            <div className="card stage-prose-card">
              <p className="stage-prose">{summary}</p>
            </div>
          </section>
        )}

        <section className="stage-section">
          <div className="card">
            <button
              type="button"
              className="cell link-row chapters-entry"
              onClick={onOpenChapters}
            >
              <span className="chapters-entry-copy">
                <span className="cell-name">{t('book.chapters')}</span>
                <span className="chapters-entry-sub">{chaptersSummary}</span>
              </span>
              <span className="chevron">
                <ChevronRightGlyph />
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
