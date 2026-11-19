import { create } from 'zustand';

import { EMPTY_BODY, getBookBody, saveBookBody, type BookBody } from '../books';

type BodyEntry = {
  body: BookBody;
  loading: boolean;
  error: Error | null;
  loaded: boolean;
};

type BodiesState = {
  entries: Record<string, BodyEntry>;
  ensure: (bookId: string) => Promise<BookBody>;
  save: (bookId: string, next: BookBody) => Promise<void>;
  prime: (bookId: string, body: BookBody) => void;
  drop: (bookId: string) => void;
  reset: () => void;
};

const inflight = new Map<string, Promise<BookBody>>();

export const useBodiesStore = create<BodiesState>()((set, get) => ({
  entries: {},

  ensure: async bookId => {
    const existing = get().entries[bookId];
    if (existing?.loaded) return existing.body;

    const pending = inflight.get(bookId);
    if (pending) return pending;

    set(state => ({
      entries: {
        ...state.entries,
        [bookId]: {
          body: existing?.body ?? EMPTY_BODY,
          loading: true,
          error: null,
          loaded: false,
        },
      },
    }));

    const task = getBookBody(bookId)
      .then(body => {
        inflight.delete(bookId);
        set(state => ({
          entries: {
            ...state.entries,
            [bookId]: { body, loading: false, error: null, loaded: true },
          },
        }));
        return body;
      })
      .catch(err => {
        inflight.delete(bookId);
        const error = err instanceof Error ? err : new Error(String(err));
        set(state => ({
          entries: {
            ...state.entries,
            [bookId]: {
              body: EMPTY_BODY,
              loading: false,
              error,
              loaded: false,
            },
          },
        }));
        throw error;
      });

    inflight.set(bookId, task);
    return task;
  },

  save: async (bookId, next) => {
    const previous = get().entries[bookId];
    set(state => ({
      entries: {
        ...state.entries,
        [bookId]: { body: next, loading: false, error: null, loaded: true },
      },
    }));

    try {
      await saveBookBody(bookId, next);
    } catch (error) {
      if (previous) {
        set(state => ({
          entries: {
            ...state.entries,
            [bookId]: previous,
          },
        }));
      }
      throw error;
    }
  },

  prime: (bookId, body) =>
    set(state => ({
      entries: {
        ...state.entries,
        [bookId]: { body, loading: false, error: null, loaded: true },
      },
    })),

  drop: bookId => {
    inflight.delete(bookId);
    set(state => {
      if (!(bookId in state.entries)) return state;
      const next = { ...state.entries };
      delete next[bookId];
      return { entries: next };
    });
  },

  reset: () => {
    inflight.clear();
    set({ entries: {} });
  },
}));
