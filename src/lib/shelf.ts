import { type Book } from '../books';

export type ShelfEntry =
  | { kind: 'book'; book: Book }
  | { kind: 'series'; name: string; books: Book[] };

export const bySeriesOrder = (a: Book, b: Book) =>
  (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) -
    (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);

export const shelfEntries = (sorted: Book[]): ShelfEntry[] => {
  const entries: ShelfEntry[] = [];
  const placed = new Set<string>();

  for (const book of sorted) {
    if (!book.series) {
      entries.push({ kind: 'book', book });
      continue;
    }
    if (placed.has(book.series)) continue;

    placed.add(book.series);
    entries.push({
      kind: 'series',
      name: book.series,
      books: sorted
        .filter(entry => entry.series === book.series)
        .sort(bySeriesOrder),
    });
  }

  return entries;
};
