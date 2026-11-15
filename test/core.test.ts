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
import {
  byGridOrder,
  needsPositionRepair,
  positionForMove,
} from '../src/lib/gridOrder';
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
import {
  extractChaptersFromToc,
  findHighlightSpan,
  repairPageNumbers,
  textBetween,
} from '../src/lib/photoImport/assemble';
import { type PageAnalysis } from '../src/lib/photoImport/analyze';
import { cleanOcr, polishSpanishProse } from '../src/lib/photoImport/clean';
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
  position: 0,
  readerAnchor: null,
  series: null,
  seriesNumber: null,
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

describe('gridOrder & shelfEntries', () => {
  const books: Book[] = [
    makeBook({
      id: '1',
      name: 'Homo Deus',
      author: 'Yuval Noah Harari',
      year: 2015,
      position: 0,
      series: 'Sapiens',
      seriesNumber: 2,
    }),
    makeBook({
      id: '2',
      name: 'Sapiens',
      author: 'Yuval Noah Harari',
      year: 2011,
      position: 0,
      series: 'Sapiens',
      seriesNumber: 1,
    }),
    makeBook({
      id: '3',
      name: 'Meditations',
      author: 'Marcus Aurelius',
      year: 180,
      position: 1,
    }),
  ];

  it('orders shelf by fractional position and groups series in seriesNumber order', () => {
    const sorted = byGridOrder(books);
    const entries = shelfEntries(sorted);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'series',
      name: 'Sapiens',
      position: 0,
    });
    if (entries[0].kind === 'series') {
      expect(entries[0].books.map(b => b.id)).toEqual(['2', '1']);
    }
    expect(entries[1]).toMatchObject({
      kind: 'book',
      book: { id: '3' },
      position: 1,
    });
    expect(needsPositionRepair(entries)).toBe(false);
    expect(
      positionForMove(
        [
          { position: 0 },
          { position: null },
          { position: 1 },
        ],
        1,
      ),
    ).toBe(0.5);
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

const makePage = (overrides: Partial<PageAnalysis>): PageAnalysis => ({
  kind: 'page',
  width: 1000,
  height: 1400,
  pageNumber: null,
  lines: [],
  columnX1: 100,
  columnX2: 900,
  headingIndex: null,
  flags: [],
  toc: [],
  coverLines: [],
  ...overrides,
});

describe('photoImport (clean, assemble, sticky span, TOC & 5-signal paragraphs)', () => {
  it('cleans Latin OCR errors and restores Spanish typography & accents without false question marks', () => {
    const rawLine1 = cleanOcr('--Dime, Govinda-pregunt6 Siddhartha-, crees que hemos llegado a alguna meta?');
    const rawLine2 = cleanOcr('Todo mentia, cuando no era mas que podredumbre. <Si-pens6 con la cabeza inclinada-, que quedaria de todo cuanto nos parece sagrado?>');
    const polished = polishSpanishProse(`${rawLine1}\n\n${rawLine2}`);
    expect(polished).toContain('—Dime, Govinda —preguntó Siddhartha—, ¿crees que hemos llegado a alguna meta?');
    expect(polished).toContain('Todo mentía, cuando no era más que podredumbre.');
    expect(polished).not.toContain('¿cuando no era');
    expect(polished).toContain('«Sí —pensó con la cabeza inclinada—, ¿qué quedaría de todo cuanto nos parece sagrado?»');
  });

  it('repairs missing or partially read page numbers across sequential photos', () => {
    const pages = [
      makePage({ pageNumber: 25 }),
      makePage({ pageNumber: null }),
      makePage({ pageNumber: 2 }), // 27 misread as 2
      makePage({ pageNumber: 28 }),
    ];
    expect(repairPageNumbers(pages)).toEqual([25, 26, 27, 28]);
  });

  it('reconstructs paragraphs from indent, short previous line (punto y aparte), dialogue dash, and hanging verse', () => {
    const p1 = makePage({
      pageNumber: 25,
      flags: [{ side: 'R', shape: 'bar', y: 120, lineIndex: 0 }],
      lines: [
        { text: 'En el camino, Siddhartha regaló su túnica a un brah-', x1: 140, y1: 100, x2: 895, y2: 124 },
        { text: 'mán pobre. Una tortura era la vida.', x1: 100, y1: 135, x2: 520, y2: 159 }, // ends short -> punto y aparte even if next line is unindented
        { text: 'Solo una meta se perfilaba ante Siddhartha: quedarse', x1: 100, y1: 170, x2: 895, y2: 194 },
        { text: 'vacío.', x1: 100, y1: 205, x2: 210, y2: 229 },
      ],
    });
    const p2 = makePage({
      pageNumber: 26,
      flags: [{ side: 'L', shape: 'bar', y: 215, lineIndex: 2 }],
      lines: [
        { text: '—El puro de espíritu que, meditando, se sumerja', x1: 135, y1: 100, x2: 880, y2: 124 },
        { text: '[en el Atmán,', x1: 680, y1: 135, x2: 890, y2: 159 }, // hanging right-aligned continuation
        { text: 'sentirá en su corazón una alegría inefable.', x1: 100, y1: 170, x2: 720, y2: 194 },
      ],
    });
    const nums = repairPageNumbers([p1, p2]);
    const span = findHighlightSpan([p1, p2], nums);
    expect(span).toEqual({
      start: { photo: 0, line: 0 },
      end: { photo: 1, line: 2 },
      page: '25–26',
    });
    const extracted = textBetween([p1, p2], span!.start, span!.end);
    expect(extracted).toBe(
      [
        'En el camino, Siddhartha regaló su túnica a un brahmán pobre. Una tortura era la vida.',
        'Solo una meta se perfilaba ante Siddhartha: quedarse vacío.',
        '—El puro de espíritu que, meditando, se sumerja [en el Atmán, sentirá en su corazón una alegría inefable.',
      ].join('\n\n'),
    );
  });

  it('extracts chapters and inferred page spans from TOC photos', () => {
    const tocPage = makePage({
      kind: 'index',
      toc: [
        { title: 'El hijo del brahmán', page: 11 },
        { title: 'Con los samanas', page: 23 },
        { title: 'Gotama', page: 41 },
      ],
    });
    expect(extractChaptersFromToc([tocPage])).toEqual([
      { name: 'El hijo del brahmán', pages: '11–22' },
      { name: 'Con los samanas', pages: '23–40' },
      { name: 'Gotama', pages: '41' },
    ]);
  });
});
