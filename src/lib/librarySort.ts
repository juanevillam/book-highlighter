export const LIBRARY_SORT_KEYS = [
  'recent',
  'title',
  'author',
  'published',
] as const;

export type LibrarySortKey = (typeof LIBRARY_SORT_KEYS)[number];

export type LibrarySort = { ascending: boolean; key: LibrarySortKey };

export const DEFAULT_ASCENDING: Record<LibrarySortKey, boolean> = {
  author: true,
  published: false,
  recent: false,
  title: true,
};

export const DEFAULT_LIBRARY_SORT: LibrarySort = {
  ascending: DEFAULT_ASCENDING.recent,
  key: 'recent',
};

type Sortable = {
  author: string;
  createdAt: number | null;
  lastOpenedAt: number | null;
  name: string;
  year: number | null;
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const compareNullable = (
  a: number | null,
  b: number | null,
  ascending: boolean,
): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  return ascending ? a - b : b - a;
};

export const sortLibrary = <T extends Sortable>(
  books: T[],
  { ascending, key }: LibrarySort,
): T[] => {
  const sign = ascending ? 1 : -1;
  const byTitle = (a: T, b: T) =>
    collator.compare(a.name, b.name) || (b.createdAt ?? 0) - (a.createdAt ?? 0);

  return [...books].sort((a, b) => {
    switch (key) {
      case 'recent':
        return (
          compareNullable(
            a.lastOpenedAt ?? null,
            b.lastOpenedAt ?? null,
            ascending,
          ) || byTitle(a, b)
        );
      case 'title':
        return sign * byTitle(a, b);
      case 'author':
        return sign * collator.compare(a.author, b.author) || byTitle(a, b);
      case 'published':
        return compareNullable(a.year, b.year, ascending) || byTitle(a, b);
    }
  });
};
