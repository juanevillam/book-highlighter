import { create } from 'zustand';

import {
  DEFAULT_ASCENDING,
  DEFAULT_LIBRARY_SORT,
  LIBRARY_SORT_KEYS,
  type LibrarySort,
  type LibrarySortKey,
} from '../lib/librarySort';

const SORT_STORAGE_KEY = 'bookhighlighter.sort';

const readSort = (): LibrarySort => {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_LIBRARY_SORT;
    const parsed = JSON.parse(raw) as Partial<LibrarySort>;
    if (
      parsed &&
      typeof parsed.key === 'string' &&
      (LIBRARY_SORT_KEYS as readonly string[]).includes(parsed.key) &&
      typeof parsed.ascending === 'boolean'
    ) {
      return { key: parsed.key as LibrarySortKey, ascending: parsed.ascending };
    }
  } catch {
    // Fall back to default.
  }
  return DEFAULT_LIBRARY_SORT;
};

const writeSort = (sort: LibrarySort) => {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Ignore storage errors.
  }
};

type LibrarySortState = {
  sort: LibrarySort;
  selectKey: (key: LibrarySortKey) => void;
  setAscending: (ascending: boolean) => void;
  toggleDirection: () => void;
};

export const useLibrarySortStore = create<LibrarySortState>()((set, get) => ({
  sort: typeof window !== 'undefined' ? readSort() : DEFAULT_LIBRARY_SORT,
  selectKey: key => {
    const current = get().sort;
    const next: LibrarySort =
      current.key === key
        ? { key, ascending: !current.ascending }
        : { key, ascending: DEFAULT_ASCENDING[key] };
    writeSort(next);
    set({ sort: next });
  },
  setAscending: ascending => {
    const current = get().sort;
    const next: LibrarySort = { key: current.key, ascending };
    writeSort(next);
    set({ sort: next });
  },
  toggleDirection: () => {
    const current = get().sort;
    const next: LibrarySort = {
      key: current.key,
      ascending: !current.ascending,
    };
    writeSort(next);
    set({ sort: next });
  },
}));
