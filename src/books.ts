import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';

import { track } from './analytics';
import {
  BODIES_SUBCOLLECTION,
  BOOKS_SUBCOLLECTION,
  requireDb,
  requireUid,
  USERS_COLLECTION,
} from './firebase';
import { forgetCoverPalette } from './lib/coverPalette';
import { byGridOrder, positionBetween } from './lib/gridOrder';
import { type ShelfEntry } from './lib/shelf';
import { destroyAsset } from './media';

export type ReaderAnchor = { blockId: string; offset: number };

export type Book = {
  author: string;
  artPublicId: string;
  artUrl: string;
  chapterCount: number;
  createdAt: number | null;
  finishedAt: number | null;
  genres: string[];
  highlightCount: number;
  id: string;
  lastOpenedAt: number | null;
  name: string;
  position: number | null;
  readerAnchor: ReaderAnchor | null;
  series: string | null;
  seriesNumber: number | null;
  updatedAt: number | null;
  year: number | null;
};

export type Highlight = {
  id: string;
  page: string | null;
  text: string;
};

export type Chapter = {
  highlights: Highlight[];
  id: string;
  name: string;
  pages: string;
};

export type BookBody = {
  chapters: Chapter[];
  summary: string;
};

export const EMPTY_BODY: BookBody = { chapters: [], summary: '' };

export type BookFields = Pick<
  Book,
  'author' | 'genres' | 'name' | 'series' | 'seriesNumber' | 'year'
>;

const booksCollection = () =>
  collection(requireDb(), USERS_COLLECTION, requireUid(), BOOKS_SUBCOLLECTION);

const bookDoc = (bookId: string) =>
  doc(requireDb(), USERS_COLLECTION, requireUid(), BOOKS_SUBCOLLECTION, bookId);

const bodyDoc = (bookId: string) =>
  doc(
    requireDb(),
    USERS_COLLECTION,
    requireUid(),
    BODIES_SUBCOLLECTION,
    bookId,
  );

const millis = (value: unknown): number | null =>
  value && typeof (value as Timestamp).toMillis === 'function'
    ? (value as Timestamp).toMillis()
    : typeof value === 'number'
      ? value
      : null;

const toAnchor = (value: unknown): ReaderAnchor | null => {
  const anchor = value as Partial<ReaderAnchor> | null | undefined;

  return typeof anchor?.blockId === 'string' &&
    typeof anchor.offset === 'number'
    ? { blockId: anchor.blockId, offset: anchor.offset }
    : null;
};

const bookToModel = (snapshot: QueryDocumentSnapshot): Book => {
  const data = snapshot.data();

  return {
    author: (data.author as string) ?? '',
    artPublicId: (data.artPublicId as string) ?? '',
    artUrl: (data.artUrl as string) ?? '',
    chapterCount: typeof data.chapterCount === 'number' ? data.chapterCount : 0,
    createdAt: millis(data.createdAt),
    finishedAt: millis(data.finishedAt),
    genres: Array.isArray(data.genres)
      ? (data.genres as unknown[]).filter(
          (genre): genre is string => typeof genre === 'string',
        )
      : [],
    highlightCount:
      typeof data.highlightCount === 'number' ? data.highlightCount : 0,
    id: snapshot.id,
    lastOpenedAt: millis(data.lastOpenedAt),
    name: (data.name as string) ?? '',
    position:
      typeof data.position === 'number' && Number.isFinite(data.position)
        ? data.position
        : null,
    readerAnchor: toAnchor(data.readerAnchor),
    series:
      typeof data.series === 'string' && data.series.trim()
        ? data.series.trim()
        : null,
    seriesNumber:
      typeof data.seriesNumber === 'number' ? data.seriesNumber : null,
    updatedAt: millis(data.updatedAt),
    year: typeof data.year === 'number' ? data.year : null,
  };
};

const bodyCounts = (body: BookBody) => ({
  chapterCount: body.chapters.length,
  highlightCount: body.chapters.reduce(
    (sum, chapter) => sum + chapter.highlights.length,
    0,
  ),
});

const toBody = (data: Record<string, unknown> | undefined): BookBody => {
  if (!data) return EMPTY_BODY;

  const chapters = Array.isArray(data.chapters)
    ? (data.chapters as Array<Partial<Chapter>>).map(chapter => ({
        highlights: Array.isArray(chapter.highlights)
          ? chapter.highlights.map(highlight => ({
              id: highlight.id ?? '',
              page:
                typeof highlight.page === 'number'
                  ? String(highlight.page)
                  : typeof highlight.page === 'string' && highlight.page
                    ? highlight.page
                    : null,
              text: highlight.text ?? '',
            }))
          : [],
        id: chapter.id ?? '',
        name: chapter.name ?? '',
        pages: chapter.pages ?? '',
      }))
    : [];

  return {
    chapters,
    summary: (data.summary as string) ?? '',
  };
};

type SubscribeToBooksParams = {
  onError: (error: Error) => void;
  onNext: (books: Book[], meta: { fromCache: boolean }) => void;
};

export const subscribeToBooks = ({
  onError,
  onNext,
}: SubscribeToBooksParams): (() => void) =>
  onSnapshot(
    query(booksCollection()),
    snapshot =>
      onNext(byGridOrder(snapshot.docs.map(bookToModel)), {
        fromCache: snapshot.metadata.fromCache,
      }),
    error => {
      console.warn('books.subscribeToBooks', error);
      onError(error);
    },
  );

/**
 * Where a new book lands in the grid: if it joins an existing series that
 * already has a slot, it inherits that series's position; otherwise it lands
 * at the front of the shelf ahead of the first book (matching Sound Shaper's
 * `leadPosition`).
 */
export const leadPosition = (
  books: readonly Book[],
  series?: string | null,
): number => {
  if (series) {
    const existing = books.find(
      b => b.series === series && b.position !== null,
    );
    if (existing?.position != null) return existing.position;
  }

  const positions = books
    .map(book => book.position)
    .filter((position): position is number => position !== null);

  return positions.length
    ? (positionBetween(null, Math.min(...positions)) ?? 0)
    : 0;
};

export const getBookBody = async (bookId: string): Promise<BookBody> =>
  toBody((await getDoc(bodyDoc(bookId))).data());

export const createBook = async ({
  body = EMPTY_BODY,
  cover,
  fields,
  position = 0,
}: {
  body?: BookBody;
  cover: { publicId: string; url: string } | null;
  fields: BookFields;
  position?: number;
}): Promise<string> => {
  const ref = doc(booksCollection());
  const batch = writeBatch(requireDb());

  batch.set(ref, {
    ...fields,
    artPublicId: cover?.publicId ?? '',
    artUrl: cover?.url ?? '',
    ...bodyCounts(body),
    createdAt: serverTimestamp(),
    finishedAt: null,
    lastOpenedAt: null,
    position,
    readerAnchor: null,
    updatedAt: serverTimestamp(),
  });
  batch.set(bodyDoc(ref.id), body);
  await batch.commit();
  track({ name: 'add_book' });

  return ref.id;
};

export const updateBook = async ({
  bookId,
  cover,
  fields,
}: {
  bookId: string;
  cover?: { publicId: string; url: string } | null;
  fields: BookFields;
}): Promise<void> => {
  const ref = bookDoc(bookId);
  const previous =
    cover !== undefined
      ? (((await getDoc(ref)).data()?.artPublicId as string) ?? '')
      : '';

  await updateDoc(ref, {
    ...fields,
    updatedAt: serverTimestamp(),
    ...(cover === undefined
      ? {}
      : { artPublicId: cover?.publicId ?? '', artUrl: cover?.url ?? '' }),
  });

  if (previous && previous !== cover?.publicId) {
    await destroyAsset(previous, 'image');
  }
};

export const saveBookBody = async (
  bookId: string,
  body: BookBody,
): Promise<void> => {
  const batch = writeBatch(requireDb());

  batch.set(bodyDoc(bookId), body);
  batch.update(bookDoc(bookId), {
    ...bodyCounts(body),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
};

export const markBookRead = (
  bookId: string,
  {
    anchor,
    finished,
    opened,
  }: { anchor?: ReaderAnchor | null; finished?: boolean; opened?: boolean },
): Promise<void> =>
  updateDoc(bookDoc(bookId), {
    ...(opened ? { lastOpenedAt: serverTimestamp() } : {}),
    ...(finished ? { finishedAt: serverTimestamp() } : {}),
    ...(anchor === undefined ? {} : { readerAnchor: anchor }),
  }).catch(error => {
    console.warn('books.markBookRead', error);
  });

export const deleteBook = async (bookId: string): Promise<void> => {
  const ref = bookDoc(bookId);
  const snapData = (await getDoc(ref)).data();
  const artPublicId = (snapData?.artPublicId as string) ?? '';
  const artUrl = (snapData?.artUrl as string) ?? '';
  const name = (snapData?.name as string) ?? '';

  await deleteDoc(bodyDoc(bookId));
  await deleteDoc(ref);
  forgetCoverPalette(bookId, artUrl, name);

  if (artPublicId) {
    await destroyAsset(artPublicId, 'image');
  }
};

export const moveBook = (bookId: string, position: number): Promise<void> =>
  updateDoc(bookDoc(bookId), { position });

export const moveSeries = async (
  bookIds: string[],
  position: number,
): Promise<void> => {
  if (bookIds.length === 0) return;
  const batch = writeBatch(requireDb());
  for (const id of bookIds) {
    batch.update(bookDoc(id), { position });
  }
  await batch.commit();
};

export const setAddTilePosition = (position: number): Promise<void> =>
  setDoc(
    doc(requireDb(), USERS_COLLECTION, requireUid()),
    { addTilePosition: position },
    { merge: true },
  );

export const backfillShelfPositions = async (
  entries: ShelfEntry[],
): Promise<void> => {
  if (entries.length === 0) return;
  const batch = writeBatch(requireDb());
  entries.forEach((entry, index) => {
    if (entry.kind === 'book') {
      batch.update(bookDoc(entry.book.id), { position: index });
    } else {
      for (const b of entry.books) {
        batch.update(bookDoc(b.id), { position: index });
      }
    }
  });
  await batch.commit();
};

export const renormalizeShelfOrder = async (
  order: Array<{ id: string; position: number }>,
  entriesByKey: Map<string, ShelfEntry>,
  addTileKey: string,
): Promise<void> => {
  const db = requireDb();
  const uid = requireUid();
  const batch = writeBatch(db);

  for (const item of order) {
    if (item.id === addTileKey) {
      batch.set(
        doc(db, USERS_COLLECTION, uid),
        { addTilePosition: item.position },
        { merge: true },
      );
      continue;
    }
    const entry = entriesByKey.get(item.id);
    if (!entry) continue;
    if (entry.kind === 'book') {
      batch.update(bookDoc(entry.book.id), { position: item.position });
    } else {
      for (const b of entry.books) {
        batch.update(bookDoc(b.id), { position: item.position });
      }
    }
  }

  await batch.commit();
};
