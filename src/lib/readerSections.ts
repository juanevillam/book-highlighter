import { type Book, type BookBody } from '../books';

export type ReaderHighlight = { text: string; page?: string | null };

export type ReaderSection = {
  id: string;
  kind: 'cover' | 'title' | 'prose' | 'quote' | 'highlights';
  heading?: string | null;
  subheading?: string | null;
  paragraphs?: string[];
  highlights?: ReaderHighlight[];
  imageUrl?: string | null;
};

export type ReaderStrings = {
  by: (author: string) => string;
  page: (page: string | number) => string;
  summary: string;
  untitledChapter: string;
  genre: (genre: string) => string;
  year: (year: number) => string;
};

export const COVER_FETCH_WIDTH = 1200;
export const TITLE_SECTION_ID = 'title';
export const COVER_SECTION_ID = 'cover';

export const readerSections = (
  book: Pick<Book, 'artUrl' | 'author' | 'genres' | 'name' | 'year'>,
  body: BookBody,
  strings: ReaderStrings,
  coverUrl: string | null,
): ReaderSection[] => {
  const paragraphs = (text: string) =>
    text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean);

  const meta = [
    book.year ? strings.year(book.year) : '',
    book.genres.map(strings.genre).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  const sections: ReaderSection[] = [
    ...(coverUrl
      ? [{ id: COVER_SECTION_ID, kind: 'cover' as const, imageUrl: coverUrl }]
      : []),
    {
      id: TITLE_SECTION_ID,
      kind: 'title',
      heading: book.name,
      subheading: book.author ? strings.by(book.author) : null,
      paragraphs: meta ? [meta] : [],
    },
  ];

  if (body.summary.trim())
    sections.push({
      id: 'summary',
      kind: 'prose',
      heading: strings.summary,
      paragraphs: paragraphs(body.summary),
    });

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

  return sections;
};
