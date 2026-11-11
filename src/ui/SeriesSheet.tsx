import { type Book } from '../books';
import { t } from '../i18n';
import { bySeriesOrder } from '../lib/shelf';

import { Artwork } from './Artwork';

export function SeriesSheet({
  books,
  selectedBookId,
  onSelectBook,
}: {
  books: Book[];
  selectedBookId: string | null;
  onSelectBook: (book: Book) => void;
}) {
  const ordered = [...books].sort(bySeriesOrder);

  return (
    <ul className="grid series-sheet-grid">
      {ordered.map((book, index) => (
        <li key={book.id} style={{ '--i': index } as React.CSSProperties}>
          <button
            type="button"
            className={book.id === selectedBookId ? 'tile is-active' : 'tile'}
            onClick={() => onSelectBook(book)}
          >
            <span className="tile-art is-book">
              <Artwork artUrl={book.artUrl} name={book.name} width={220} />
            </span>
            <span className="tile-name">{book.name}</span>
            <span className="tile-sub">
              {book.seriesNumber !== null
                ? t('series.bookNumber', { number: book.seriesNumber })
                : book.author}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
