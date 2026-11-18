import { type Book, type BookBody } from '../books';

export type ReaderHighlight = { text: string; page?: string | null };

export type BookIndexItem = {
  chapterId: string;
  title: string;
  pages: string | null;
  hasHighlights: boolean;
};

export type ReaderSection = {
  id: string;
  kind:
    | 'cover'
    | 'title'
    | 'bookIndex'
    | 'prose'
    | 'quote'
    | 'highlights'
    | 'end';
  heading?: string | null;
  subheading?: string | null;
  paragraphs?: string[];
  highlights?: ReaderHighlight[];
  indexEntries?: BookIndexItem[];
  imageUrl?: string | null;
};

export type ReaderStrings = {
  by: (author: string) => string;
  page: (page: string | number) => string;
  summary: string;
  untitledChapter: string;
  contents?: string;
  theEnd?: string;
  genre: (genre: string) => string;
  year: (year: number) => string;
};

export const COVER_FETCH_WIDTH = 1200;
export const TITLE_SECTION_ID = 'title';
export const COVER_SECTION_ID = 'cover';
export const BOOK_INDEX_SECTION_ID = 'book-index';
export const EMPTY_HIGHLIGHTS_SECTION_ID = 'empty-highlights';
export const END_SECTION_ID = 'the-end';

export const readerSections = (
  book: Pick<Book, 'artUrl' | 'author' | 'genres' | 'name' | 'year'>,
  body: BookBody,
  strings: ReaderStrings,
  coverUrl: string | null,
): ReaderSection[] => {
  const authorWithYear = [
    book.author ? strings.by(book.author) : '',
    book.year ? strings.year(book.year) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const genresLine = book.genres.map(strings.genre).filter(Boolean).join(' · ');

  const sections: ReaderSection[] = [
    {
      id: TITLE_SECTION_ID,
      kind: 'title',
      imageUrl: coverUrl,
      heading: book.name,
      subheading: authorWithYear || null,
      paragraphs: genresLine ? [genresLine] : [],
    },
  ];

  const hasReadableContent = body.chapters.some(
    chapter => chapter.highlights.length > 0,
  );

  if (hasReadableContent && body.chapters.length > 0 && strings.contents) {
    sections.push({
      id: BOOK_INDEX_SECTION_ID,
      kind: 'bookIndex',
      heading: strings.contents,
      indexEntries: body.chapters.map(chapter => ({
        chapterId: chapter.id,
        title: chapter.name || strings.untitledChapter,
        pages: chapter.pages
          ? /^loc\./i.test(chapter.pages)
            ? chapter.pages
            : strings.page(chapter.pages)
          : null,
        hasHighlights: chapter.highlights.length > 0,
      })),
    });
  }

  for (const chapter of body.chapters) {
    if (chapter.highlights.length === 0) continue;

    sections.push({
      id: `chapter:${chapter.id}`,
      kind: 'highlights',
      heading: chapter.name || strings.untitledChapter,
      subheading: chapter.pages
        ? /^loc\./i.test(chapter.pages)
          ? chapter.pages
          : strings.page(chapter.pages)
        : null,
      highlights: chapter.highlights.map(highlight => ({
        text: highlight.text,
        page: highlight.page !== null ? strings.page(highlight.page) : null,
      })),
    });
  }

  if (
    strings.theEnd &&
    body.chapters.some(chapter => chapter.highlights.length > 0)
  ) {
    sections.push({
      id: END_SECTION_ID,
      kind: 'end',
      heading: strings.theEnd,
      subheading: book.name,
    });
  }

  return sections;
};
