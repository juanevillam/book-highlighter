import { useEffect } from 'react';

import { create } from 'zustand';

import { subscribeToBooks, type Book } from '../books';

type BooksState = {
  books: Book[];
  error: Error | null;
  hasSettled: boolean;
  setBooks: (books: Book[]) => void;
  setError: (error: Error) => void;
  reset: () => void;
};

export const useBooksStore = create<BooksState>()(set => ({
  books: [],
  error: null,
  hasSettled: false,
  setBooks: books => set({ books, error: null, hasSettled: true }),
  setError: error => set({ error, hasSettled: true }),
  reset: () => set({ books: [], error: null, hasSettled: false }),
}));

export const selectShelf = ({ books }: Pick<BooksState, 'books'>): Book[] =>
  books.filter(book => book.trashedAt === null);

export const selectTrash = ({ books }: Pick<BooksState, 'books'>): Book[] =>
  books
    .filter(book => book.trashedAt !== null)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

export const useBooksSubscription = (uid: string) => {
  const setBooks = useBooksStore(state => state.setBooks);
  const setError = useBooksStore(state => state.setError);
  const reset = useBooksStore(state => state.reset);

  useEffect(() => {
    reset();
    const unsubscribe = subscribeToBooks({
      onNext: books => setBooks(books),
      onError: error => setError(error),
    });
    return () => {
      unsubscribe();
      reset();
    };
  }, [uid, setBooks, setError, reset]);
};
