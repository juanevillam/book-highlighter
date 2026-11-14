import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
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
      onNext(snapshot.docs.map(bookToModel), {
        fromCache: snapshot.metadata.fromCache,
      }),
    error => {
      console.warn('books.subscribeToBooks', error);
      onError(error);
    },
  );

export const getBookBody = async (bookId: string): Promise<BookBody> =>
  toBody((await getDoc(bodyDoc(bookId))).data());

export const createBook = async ({
  body = EMPTY_BODY,
  cover,
  fields,
}: {
  body?: BookBody;
  cover: { publicId: string; url: string } | null;
  fields: BookFields;
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

  if (cover !== undefined) {
    const previous =
      ((await getDoc(ref)).data()?.artPublicId as string) ?? '';

    if (previous && previous !== cover?.publicId) {
      await destroyAsset(previous, 'image');
    }
  }

  await updateDoc(ref, {
    ...fields,
    updatedAt: serverTimestamp(),
    ...(cover === undefined
      ? {}
      : { artPublicId: cover?.publicId ?? '', artUrl: cover?.url ?? '' }),
  });
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
  const artPublicId =
    ((await getDoc(ref)).data()?.artPublicId as string) ?? '';

  if (artPublicId) {
    await destroyAsset(artPublicId, 'image');
  }

  await deleteDoc(bodyDoc(bookId));
  await deleteDoc(ref);
};
