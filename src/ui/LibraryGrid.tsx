import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { type Book } from '../books';
import { t } from '../i18n';
import { type ShelfEntry } from '../lib/shelf';

import { Artwork } from './Artwork';
import { PlusGlyph } from './glyphs';

const TILE_WIDTH = 220;

const ADD_KEY = '__add__';

type Cell =
  | { key: string; kind: 'book'; book: Book; position: number | null }
  | {
      key: string;
      kind: 'series';
      name: string;
      books: Book[];
      position: number | null;
    }
  | { key: string; kind: 'add'; position: number | null };

const toCells = (
  entries: ShelfEntry[],
  addTilePosition: number | null,
): Cell[] => {
  const cells: Cell[] = entries.map(entry =>
    entry.kind === 'book'
      ? {
          key: entry.book.id,
          kind: 'book',
          book: entry.book,
          position: entry.position,
        }
      : {
          key: `series:${entry.name}`,
          kind: 'series',
          name: entry.name,
          books: entry.books,
          position: entry.position,
        },
  );
  const add: Cell = { key: ADD_KEY, kind: 'add', position: addTilePosition };

  if (addTilePosition === null) return [add, ...cells];

  const slot = cells.findIndex(
    cell => cell.position !== null && cell.position > addTilePosition,
  );

  return slot === -1
    ? [...cells, add]
    : [...cells.slice(0, slot), add, ...cells.slice(slot)];
};

export function LibraryGrid({
  entries,
  addTilePosition,
  hasSettled,
  error,
  selectedBookId,
  onSelectBook,
  onSelectSeries,
  onNewBook,
}: {
  entries: ShelfEntry[];
  addTilePosition: number | null;
  hasSettled: boolean;
  error: Error | null;
  selectedBookId: string | null;
  onSelectBook: (book: Book) => void;
  onSelectSeries: (name: string) => void;
  onNewBook: () => void;
}) {
  const cells = useMemo(
    () => toCells(entries, addTilePosition),
    [entries, addTilePosition],
  );
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!hasSettled || entered) return;
    const id = setTimeout(() => setEntered(true), 750);
    return () => clearTimeout(id);
  }, [hasSettled, entered]);

  if (error) {
    return (
      <div className="empty">
        <h2>{t('home.error.title')}</h2>
        <p>{t('home.error.subtitle')}</p>
      </div>
    );
  }

  if (!hasSettled) {
    return (
      <ul className="grid" aria-busy="true">
        {Array.from({ length: 6 }).map((_, idx) => (
          <li key={idx}>
            <div className="tile">
              <span className="tile-art bone" />
              <span className="bone line" />
              <span className="bone line short" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const renderTile = (cell: Cell): ReactNode => {
    if (cell.kind === 'add') {
      return (
        <button type="button" className="tile is-add" onClick={onNewBook}>
          <span className="tile-art">
            <span className="artwork is-empty" aria-hidden="true">
              <PlusGlyph />
            </span>
          </span>
          <span className="tile-name">{t('app.bookNew')}</span>
        </button>
      );
    }

    if (cell.kind === 'book') {
      const { book } = cell;
      const active = book.id === selectedBookId;
      return (
        <button
          type="button"
          className={active ? 'tile is-active' : 'tile'}
          onClick={() => onSelectBook(book)}
        >
          <span className="tile-art">
            <Artwork
              artUrl={book.artUrl}
              name={book.name}
              width={TILE_WIDTH}
            />
          </span>
          <span className="tile-name">{book.name}</span>
          {book.author && <span className="tile-sub">{book.author}</span>}
        </button>
      );
    }

    const { name, books } = cell;
    const topBook = books[0];
    const behind = books.slice(1, 3);
    const containsSelected = books.some(b => b.id === selectedBookId);

    return (
      <button
        type="button"
        className={containsSelected ? 'tile is-active' : 'tile'}
        onClick={() => onSelectSeries(name)}
      >
        <span
          className="tile-art series-stack"
          style={{ '--depth': behind.length } as React.CSSProperties}
        >
          {behind
            .slice()
            .reverse()
            .map((layerBook, revIdx) => {
              const step = behind.length - revIdx;
              return (
                <span
                  key={layerBook.id}
                  className="series-layer"
                  style={{ '--step': step } as React.CSSProperties}
                  aria-hidden="true"
                >
                  <Artwork
                    artUrl={layerBook.artUrl}
                    name={layerBook.name}
                    width={TILE_WIDTH}
                  />
                </span>
              );
            })}
          <span className="series-front">
            <Artwork
              artUrl={topBook.artUrl}
              name={topBook.name}
              width={TILE_WIDTH}
            />
            <span className="series-badge">{books.length}</span>
          </span>
        </span>
        <span className="tile-name">{name}</span>
        {topBook.author && <span className="tile-sub">{topBook.author}</span>}
      </button>
    );
  };

  return (
    <ul className={entered ? 'grid is-entered' : 'grid'}>
      {cells.map((cell, idx) => (
        <li
          key={cell.key}
          style={
            {
              '--i': Math.min(idx, 24),
              viewTransitionName:
                cell.key === ADD_KEY
                  ? 'tile-add'
                  : cell.kind === 'book'
                    ? `tile-${cell.book.id}`
                    : `tile-series-${idx}`,
            } as React.CSSProperties
          }
        >
          {renderTile(cell)}
        </li>
      ))}
    </ul>
  );
}
