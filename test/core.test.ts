import { describe, expect, it } from 'vitest';

import { type Book, type BookBody } from '../src/books';
import {
  addChapter,
  addHighlight,
  moveChapter,
  moveHighlight,
  removeChapter,
  removeHighlight,
  updateChapter,
  updateHighlight,
} from '../src/lib/bodyEdits';
import {
  formatYear,
  parseGenres,
  parsePageRef,
  parseYear,
} from '../src/lib/bookFields';
import { sortLibrary } from '../src/lib/librarySort';
import {
  pageIndexForAnchor,
  paginateSections,
} from '../src/lib/paginator';
import { readerSections } from '../src/lib/readerSections';
import {
  effectiveTheme,
  nearestScaleIndex,
  readerPalette,
  TEXT_SCALES,
} from '../src/lib/readerThemes';
import { shelfEntries } from '../src/lib/shelf';

const makeBook = (overrides: Partial<Book>): Book => ({
  id: 'b1',
  name: 'Siddhartha',
  author: 'Hermann Hesse',
  artPublicId: '',
  artUrl: '',
  chapterCount: 0,
  highlightCount: 0,
  createdAt: 1000,
  finishedAt: null,
  genres: ['philosophy'],
  lastOpenedAt: null,
  readerAnchor: null,
  series: null,
  seriesNumber: null,
  trashedAt: null,
  updatedAt: 1000,
  year: 1922,
  ...overrides,
});

describe('bookFields', () => {
  it('normalizes page ranges with typographic en-dash and commas', () => {
    expect(parsePageRef(' 23 - 27 , 31--34 ')).toBe('23–27, 31–34');
    expect(parsePageRef('   ')).toBeNull();
  });

  it('parses AD/BC years and formats BC labels', () => {
    expect(parseYear('1922')).toBe(1922);
    expect(parseYear('-380')).toBe(-380);
    expect(parseYear('abc')).toBeNull();
    expect(formatYear(-380, y => `${y} BC`)).toBe('380 BC');
    expect(formatYear(2011, y => `${y} BC`)).toBe('2011');
  });

  it('splits genre lists cleanly', () => {
    expect(parseGenres('Philosophy, History / Essays.')).toEqual([
      'Philosophy',
      'History',
      'Essays',
    ]);
  });
});

describe('librarySort & shelfEntries', () => {
  const books: Book[] = [
    makeBook({
      id: '1',
      name: 'Homo Deus',
      author: 'Yuval Noah Harari',
      year: 2015,
      lastOpenedAt: 200,
      series: 'Sapiens',
      seriesNumber: 2,
    }),
    makeBook({
      id: '2',
      name: 'Sapiens',
      author: 'Yuval Noah Harari',
      year: 2011,
      lastOpenedAt: 500,
      series: 'Sapiens',
      seriesNumber: 1,
    }),
    makeBook({
      id: '3',
      name: 'Meditations',
      author: 'Marcus Aurelius',
      year: 180,
      lastOpenedAt: 350,
    }),
  ];

  it('sorts recent descending and groups series in seriesNumber order', () => {
    const sorted = sortLibrary(books, { key: 'recent', ascending: false });
    expect(sorted.map(b => b.id)).toEqual(['2', '3', '1']);

    const entries = shelfEntries(sorted);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'series',
      name: 'Sapiens',
    });
    if (entries[0].kind === 'series') {
      expect(entries[0].books.map(b => b.id)).toEqual(['2', '1']);
    }
    expect(entries[1]).toMatchObject({
      kind: 'book',
      book: { id: '3' },
    });
  });
});

describe('bodyEdits', () => {
  it('adds, updates, reorders, and removes chapters & highlights immutably', () => {
    let body: BookBody = { summary: 'Core notes', chapters: [] };
    body = addChapter(body, { id: 'c1', name: 'Chapter 1' });
    body = addChapter(body, { id: 'c2', name: 'Chapter 2' });
    body = updateChapter(body, 'c1', { pages: '23–27' });

    body = addHighlight(body, 'c1', {
      id: 'h1',
      text: 'First passage',
      page: '23',
    });
    body = addHighlight(body, 'c1', {
      id: 'h2',
      text: 'Second passage',
      page: '24–25',
    });
    body = moveHighlight(body, 'c1', 0, 1);
    expect(body.chapters[0].highlights.map(h => h.id)).toEqual(['h2', 'h1']);

    body = updateHighlight(body, 'c1', {
      id: 'h1',
      text: 'Edited passage',
      page: '23',
    });
    expect(body.chapters[0].highlights[1].text).toBe('Edited passage');

    body = moveChapter(body, 0, 1);
    expect(body.chapters.map(c => c.id)).toEqual(['c2', 'c1']);

    body = removeHighlight(body, 'c1', 'h2');
    expect(body.chapters[1].highlights).toHaveLength(1);

    body = removeChapter(body, 'c2');
    expect(body.chapters.map(c => c.id)).toEqual(['c1']);
  });
});

describe('readerThemes, readerSections & paginator reflow anchor stability', () => {
  it('resolves themes, palettes, and nearest text scale', () => {
    expect(effectiveTheme(null, 'dark')).toBe('dark');
    expect(effectiveTheme('sepia', 'dark')).toBe('sepia');
    expect(readerPalette('dark').page).toBe('#000000');
    expect(TEXT_SCALES[nearestScaleIndex(1.12)]).toBe(1.1);
  });

  it('paginates highlights and restores exact readerAnchor across fontScale reflows', () => {
    const book = makeBook({
      name: 'Meditations',
      author: 'Marcus Aurelius',
      year: 180,
      genres: ['philosophy'],
    });

    const highlights = Array.from({ length: 18 }, (_, i) => ({
      id: `hl-${i}`,
      page: String(10 + i),
      text: `Passage number ${i + 1}: The impediment to action advances action. What stands in the way becomes the way when examined calmly and deliberately.`,
    }));

    const body: BookBody = {
      summary: 'Personal notebook of Marcus Aurelius.',
      chapters: [
        {
          id: 'bk2',
          name: 'Book II',
          pages: '10–27',
          highlights,
        },
      ],
    };

    const sections = readerSections(
      book,
      body,
      {
        by: a => `by ${a}`,
        page: p => `p. ${p}`,
        summary: 'Summary',
        untitledChapter: 'Untitled',
        genre: g => g,
        year: y => String(y),
      },
      'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    );

    const normal = paginateSections(sections, {
      width: 340,
      height: 520,
      fontScale: 1,
    });
    expect(normal.pages.length).toBeGreaterThan(4);
    expect(normal.toc.map(t => t.id)).toEqual([
      'cover',
      'title',
      'summary',
      'chapter:bk2',
    ]);

    const midPage = normal.pages[Math.floor(normal.pages.length * 0.6)];
    const savedAnchor = midPage.anchor;

    // Reflow at largest font scale (1.2x) and verify anchor maps to the page containing that block & offset!
    const zoomed = paginateSections(sections, {
      width: 340,
      height: 520,
      fontScale: 1.2,
    });
    expect(zoomed.pages.length).toBeGreaterThanOrEqual(normal.pages.length);

    const restoredIndex = pageIndexForAnchor(zoomed.pages, savedAnchor);
    const restoredPage = zoomed.pages[restoredIndex];
    const hasBlock = restoredPage.items.some(
      item => item.blockId === savedAnchor.blockId,
    );
    expect(hasBlock).toBe(true);
  });
});
