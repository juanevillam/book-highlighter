import { useState } from 'react';

import { type Book } from '../books';
import { t } from '../i18n';
import { LIBRARY_SORT_KEYS, type LibrarySortKey } from '../lib/librarySort';
import { type ShelfEntry } from '../lib/shelf';
import { useLibrarySortStore } from '../store/librarySort';

import { ActionSheet } from './ActionSheet';
import { Artwork } from './Artwork';
import { PlusGlyph, SortDirectionGlyph } from './glyphs';

const TILE_WIDTH = 220;

const directionLabel = (key: LibrarySortKey, ascending: boolean): string => {
  if (key === 'title' || key === 'author') {
    return t(ascending ? 'home.sort.aToZ' : 'home.sort.zToA');
  }
  return t(ascending ? 'home.sort.oldestFirst' : 'home.sort.newestFirst');
};

export function LibraryGrid({
  entries,
  hasSettled,
  error,
  selectedBookId,
  onSelectBook,
  onSelectSeries,
  onNewBook,
}: {
  entries: ShelfEntry[];
  hasSettled: boolean;
  error: Error | null;
  selectedBookId: string | null;
  onSelectBook: (book: Book) => void;
  onSelectSeries: (name: string) => void;
  onNewBook: () => void;
}) {
  const sort = useLibrarySortStore(state => state.sort);
  const selectKey = useLibrarySortStore(state => state.selectKey);
  const setAscending = useLibrarySortStore(state => state.setAscending);

  const [sortMenuOpen, setSortMenuOpen] = useState(false);

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
              <span className="tile-art is-book bone" />
              <span className="bone line" />
              <span className="bone line short" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const isAlphaKey = sort.key === 'title' || sort.key === 'author';
  const ascOptionLabel = t(
    isAlphaKey ? 'home.sort.aToZ' : 'home.sort.oldestFirst',
  );
  const descOptionLabel = t(
    isAlphaKey ? 'home.sort.zToA' : 'home.sort.newestFirst',
  );

  return (
    <>
      <div className="library-toolbar">
        <button
          type="button"
          className="pill sort-pill"
          aria-label={`${t('home.sort.label')}: ${t(`home.sort.keys.${sort.key}`)} (${directionLabel(sort.key, sort.ascending)})`}
          onClick={() => setSortMenuOpen(true)}
        >
          <span>{t(`home.sort.keys.${sort.key}`)}</span>
          <SortDirectionGlyph ascending={sort.ascending} />
        </button>
      </div>

      <ul className="grid">
        <li
          style={
            {
              '--i': 0,
              viewTransitionName: 'tile-add',
            } as React.CSSProperties
          }
        >
          <button
            type="button"
            className="tile is-add"
            onClick={onNewBook}
          >
            <span className="tile-art is-book">
              <span className="artwork is-empty">
                <PlusGlyph />
              </span>
            </span>
            <span className="tile-name">{t('app.bookNew')}</span>
          </button>
        </li>

        {entries.map((entry, idx) => {
          if (entry.kind === 'book') {
            const { book } = entry;
            const active = book.id === selectedBookId;
            return (
              <li
                key={book.id}
                style={
                  {
                    '--i': idx + 1,
                    viewTransitionName: `tile-${book.id}`,
                  } as React.CSSProperties
                }
              >
                <button
                  type="button"
                  className={active ? 'tile is-active' : 'tile'}
                  onClick={() => onSelectBook(book)}
                >
                  <span className="tile-art is-book">
                    <Artwork
                      artUrl={book.artUrl}
                      name={book.name}
                      width={TILE_WIDTH}
                    />
                  </span>
                  <span className="tile-name">{book.name}</span>
                  {book.author && (
                    <span className="tile-sub">{book.author}</span>
                  )}
                </button>
              </li>
            );
          }

          const { name, books } = entry;
          const topBook = books[0];
          const behind = books.slice(1, 3);
          const containsSelected = books.some(b => b.id === selectedBookId);

          return (
            <li
              key={`series:${name}`}
              style={
                {
                  '--i': idx + 1,
                  viewTransitionName: `tile-series-${idx}`,
                } as React.CSSProperties
              }
            >
              <button
                type="button"
                className={containsSelected ? 'tile is-active' : 'tile'}
                onClick={() => onSelectSeries(name)}
              >
                <span
                  className="tile-art is-book series-stack"
                  style={
                    { '--depth': behind.length } as React.CSSProperties
                  }
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
                          style={
                            { '--step': step } as React.CSSProperties
                          }
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
                {topBook.author && (
                  <span className="tile-sub">{topBook.author}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <ActionSheet
        open={sortMenuOpen}
        cancel={t('common.cancel')}
        actions={[
          ...LIBRARY_SORT_KEYS.map(key => ({
            label:
              key === sort.key
                ? `✓ ${t(`home.sort.keys.${key}`)}`
                : t(`home.sort.keys.${key}`),
            onSelect: () => selectKey(key),
          })),
          {
            label: sort.ascending ? `✓ ${ascOptionLabel}` : ascOptionLabel,
            onSelect: () => setAscending(true),
          },
          {
            label: !sort.ascending ? `✓ ${descOptionLabel}` : descOptionLabel,
            onSelect: () => setAscending(false),
          },
        ]}
        onClose={() => setSortMenuOpen(false)}
      />
    </>
  );
}
