import { useEffect, useRef, useState } from 'react';

import { doc, onSnapshot } from 'firebase/firestore';
import { create } from 'zustand';

import { backfillShelfPositions, subscribeToBooks, type Book } from '../books';
import { requireDb, USERS_COLLECTION } from '../firebase';
import { needsPositionRepair } from '../lib/gridOrder';
import { shelfEntries } from '../lib/shelf';

type BooksState = {
  books: Book[];
  error: Error | null;
  hasSettled: boolean;
  setBooks: (books: Book[]) => void;
  patchBook: (bookId: string, patch: Partial<Book>) => void;
  setError: (error: Error) => void;
  reset: () => void;
};

export const useBooksStore = create<BooksState>()(set => ({
  books: [],
  error: null,
  hasSettled: false,
  setBooks: books => set({ books, error: null, hasSettled: true }),
  patchBook: (bookId, patch) =>
    set(state => ({
      books: state.books.map(book =>
        book.id === bookId ? { ...book, ...patch } : book,
      ),
    })),
  setError: error => set({ error, hasSettled: true }),
  reset: () => set({ books: [], error: null, hasSettled: false }),
}));

export const selectShelf = ({ books }: Pick<BooksState, 'books'>): Book[] =>
  books;

export const useBooksSubscription = (uid: string) => {
  const setBooks = useBooksStore(state => state.setBooks);
  const setError = useBooksStore(state => state.setError);
  const reset = useBooksStore(state => state.reset);
  const repairing = useRef(false);

  useEffect(() => {
    reset();
    const unsubscribe = subscribeToBooks({
      onNext: (books, meta) => {
        setBooks(books);
        const entries = shelfEntries(books);
        if (
          !repairing.current &&
          !meta.fromCache &&
          entries.length > 0 &&
          needsPositionRepair(entries)
        ) {
          repairing.current = true;
          backfillShelfPositions(entries)
            .catch(error => console.warn('repair book positions', error))
            .finally(() => {
              repairing.current = false;
            });
        }
      },
      onError: error => setError(error),
    });
    return () => {
      unsubscribe();
      reset();
    };
  }, [uid, setBooks, setError, reset]);
};

const addTileCacheKey = (uid: string) => `bookhighlighter.addTilePos.${uid}`;

const readCachedAddTilePos = (uid: string): number | null => {
  try {
    const raw = localStorage.getItem(addTileCacheKey(uid));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const useAddTilePosition = (uid: string): number | null => {
  const [position, setPosition] = useState<number | null>(() =>
    readCachedAddTilePos(uid),
  );

  useEffect(
    () =>
      onSnapshot(
        doc(requireDb(), USERS_COLLECTION, uid),
        snapshot => {
          const val = snapshot.data()?.addTilePosition;
          const next =
            typeof val === 'number' && Number.isFinite(val) ? val : null;
          setPosition(next);
          try {
            if (next === null) localStorage.removeItem(addTileCacheKey(uid));
            else localStorage.setItem(addTileCacheKey(uid), String(next));
          } catch {
            // Ignore storage errors.
          }
        },
        error => console.warn('add tile position', error),
      ),
    [uid],
  );

  return position;
};
