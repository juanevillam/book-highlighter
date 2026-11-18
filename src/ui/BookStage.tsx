import { useEffect } from 'react';

import { type Book } from '../books';
import { plural, t } from '../i18n';
import { Artwork } from './Artwork';
import { GenreGlyph, genreTint } from './genreGlyphs';
import { CloseGlyph, ContentsGlyph, PencilGlyph, ShareGlyph } from './glyphs';
import { formatYear } from '../lib/bookFields';
import { genreLabel } from '../lib/genres';
import { useBodiesStore } from '../store/bodies';
import { useReaderSettingsStore } from '../store/readerSettings';

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
  const pdfFormat = useReaderSettingsStore(state => state.pdfFormat);

  // Warm the body so Chapters and the reader open without a wait.
  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  const chaptersSummary =
    book.chapterCount === 0
      ? plural('book.chapterCount', 0)
      : `${book.chapterCount} · ${plural('book.highlightCount', book.highlightCount)}`;
  const exportSummary = `PDF · ${t(`export.formats.${pdfFormat}`)}`;

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
          <span className="now-artist">
            {book.author}
            {book.year !== null && (
              <span className="now-year">
                {book.author ? ' · ' : ''}
                {formatYear(book.year, y => t('bookEdit.year.bc', { year: y }))}
              </span>
            )}
          </span>
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
              <span className="dock-summary">{exportSummary}</span>
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
