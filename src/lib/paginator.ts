import { type ReaderAnchor } from '../books';
import {
  BOOK_INDEX_SECTION_ID,
  COVER_SECTION_ID,
  EMPTY_HIGHLIGHTS_SECTION_ID,
  END_SECTION_ID,
  TITLE_SECTION_ID,
  type BookIndexItem,
  type ReaderSection,
} from './readerSections';

export const READER_SERIF_STACK =
  "ui-serif, 'New York', Charter, 'Iowan Old Style', Georgia, serif";
export const READER_SANS_STACK =
  "system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif";

export type FlowLineStyle =
  | 'heading'
  | 'subheading'
  | 'prose'
  | 'quote'
  | 'pageRef';

export type PageFlowItem = {
  blockId: string;
  style: FlowLineStyle;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  align: 'left' | 'right';
  italic: boolean;
  bold: boolean;
  muted: boolean;
  serif: boolean;
  marginTop: number;
  startOffset: number;
  endOffset: number;
  edgeArtSlot?: {
    motif: number;
    side: 'left' | 'right';
  };
};

export type PaginatedPage = {
  /** 0-based page index. */
  index: number;
  sectionId: string;
  kind: 'cover' | 'title' | 'bookIndex' | 'empty' | 'content' | 'end';
  imageUrl?: string;
  titleCard?: {
    heading: string;
    subheading: string | null;
    meta: string | null;
    titleSize: number;
    authorSize: number;
    metaSize: number;
  };
  indexCard?: {
    heading: string;
    entries: BookIndexItem[];
    headingSize: number;
    rowSize: number;
  };
  endCard?: {
    heading: string;
    subheading: string | null;
    headingSize: number;
    subSize: number;
  };
  items: PageFlowItem[];
  anchor: ReaderAnchor;
  bottomEdgeArt?: {
    motif: number;
    side: 'left' | 'right';
    topPct: number;
  };
};

export type TocEntry = {
  id: string;
  kind: ReaderSection['kind'] | 'empty';
  label: string;
  /** 1-based page number. */
  page: number;
};

export type PaginationResult = {
  pages: PaginatedPage[];
  toc: TocEntry[];
  contentWidth: number;
  contentHeight: number;
};

export type PaginatorOptions = {
  width: number;
  height: number;
  fontScale: number;
  maxMeasure?: number;
  coverLabel?: string;
  titleLabel?: string;
  includeEmptyHighlightsPage?: boolean;
  emptyHighlightsLabel?: string;
  inlineEdgeArt?: boolean;
  artSeed?: number;
};

type TextMeasurer = (
  text: string,
  fontSize: number,
  serif: boolean,
  bold: boolean,
  italic: boolean,
) => number;

let sharedCtx: CanvasRenderingContext2D | null | undefined;

const getCanvasMeasurer = (): TextMeasurer => {
  if (sharedCtx === undefined) {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      sharedCtx = canvas.getContext('2d');
    } else {
      sharedCtx = null;
    }
  }

  return (text, fontSize, serif, bold, italic) => {
    if (!text) return 0;
    if (sharedCtx) {
      const weight = bold ? '700' : '400';
      const style = italic ? 'italic' : 'normal';
      const family = serif ? READER_SERIF_STACK : READER_SANS_STACK;
      sharedCtx.font = `${style} ${weight} ${fontSize}px ${family}`;
      return sharedCtx.measureText(text).width;
    }
    // Deterministic fallback for headless unit tests without DOM Canvas.
    let units = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x3000) units += 1.0;
      else if ("ilI.,:;'!| ".includes(ch)) units += 0.3;
      else if ('mwMW@%'.includes(ch)) units += 0.82;
      else if (ch >= 'A' && ch <= 'Z') units += 0.66;
      else units += 0.53;
    }
    return units * fontSize * (bold ? 1.06 : 1);
  };
};

const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

const tokenizeForWrap = (text: string): string[] => {
  const tokens: string[] = [];
  let buffer = '';

  for (const ch of text) {
    if (ch === ' ' || ch === '\t') {
      if (buffer) {
        tokens.push(buffer);
        buffer = '';
      }
      tokens.push(' ');
    } else if (CJK_RE.test(ch)) {
      if (buffer) {
        tokens.push(buffer);
        buffer = '';
      }
      tokens.push(ch);
    } else {
      buffer += ch;
    }
  }
  if (buffer) tokens.push(buffer);
  return tokens;
};

export type WrappedLine = {
  text: string;
  startOffset: number;
  endOffset: number;
};

export const wrapParagraph = (
  text: string,
  maxWidth: number,
  measure: (sample: string) => number,
): WrappedLine[] => {
  const clean = text.trim();
  if (!clean) return [];
  const safeMax = Math.max(80, maxWidth);
  const tokens = tokenizeForWrap(clean);

  const lines: WrappedLine[] = [];
  let line = '';
  let lineStart = 0;
  let cursor = 0;

  const pushHardBrokenWord = (word: string, wordStart: number) => {
    let chunk = '';
    let chunkStart = wordStart;
    let pos = wordStart;
    for (const ch of word) {
      const candidate = chunk + ch;
      if (chunk && measure(candidate) > safeMax) {
        lines.push({ text: chunk, startOffset: chunkStart, endOffset: pos });
        chunk = ch;
        chunkStart = pos;
      } else {
        chunk = candidate;
      }
      pos += ch.length;
    }
    line = chunk;
    lineStart = chunkStart;
  };

  for (const token of tokens) {
    if (token === ' ') {
      if (!line) {
        cursor += 1;
        lineStart = cursor;
        continue;
      }
      line += ' ';
      cursor += 1;
      continue;
    }

    const candidate = line + token;
    if (!line) {
      if (measure(token) > safeMax) {
        pushHardBrokenWord(token, cursor);
      } else {
        line = token;
        lineStart = cursor;
      }
      cursor += token.length;
    } else if (measure(candidate) <= safeMax) {
      line = candidate;
      cursor += token.length;
    } else {
      const trimmedLine = line.trimEnd();
      lines.push({
        text: trimmedLine,
        startOffset: lineStart,
        endOffset: cursor - (line.length - trimmedLine.length),
      });
      line = '';
      lineStart = cursor;
      if (measure(token) > safeMax) {
        pushHardBrokenWord(token, cursor);
      } else {
        line = token;
      }
      cursor += token.length;
    }
  }

  if (line.trim()) {
    lines.push({
      text: line.trimEnd(),
      startOffset: lineStart,
      endOffset: cursor,
    });
  }

  return lines;
};

type RawBlock = {
  blockId: string;
  style: FlowLineStyle;
  text: string;
  fontSize: number;
  lineHeight: number;
  align: 'left' | 'right';
  italic: boolean;
  bold: boolean;
  muted: boolean;
  serif: boolean;
  gapBefore: number;
  keepWithNext?: boolean;
  keepTogether?: boolean;
};

export type HighlightSegment = {
  text: string;
  italic: boolean;
  align: 'left' | 'right';
  tightWithPrev: boolean;
};

export const parseHighlightSegments = (rawText: string): HighlightSegment[] => {
  const paragraphs = rawText
    .trim()
    .split(/\n\n+/)
    .map(p => p.trimEnd())
    .filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) return [];

  const segments: HighlightSegment[] = [];
  for (const para of paragraphs) {
    const rawLines = para.split('\n').filter(l => l.trim().length > 0);
    const isVerse =
      rawLines.length > 0 && rawLines.every(l => /^\s*\*[^*]+\*\s*$/.test(l));
    if (isVerse) {
      rawLines.forEach((rawLine, lineIdx) => {
        const indentedRight = /^\s{2,}\*/.test(rawLine);
        const inner = rawLine.trim().slice(1, -1).trim();
        segments.push({
          text: inner,
          italic: true,
          align: indentedRight || inner.startsWith('[') ? 'right' : 'left',
          tightWithPrev: lineIdx > 0,
        });
      });
    } else {
      segments.push({
        text: rawLines.map(l => l.trim()).join(' '),
        italic: false,
        align: 'left',
        tightWithPrev: false,
      });
    }
  }

  if (segments.length === 1 && !segments[0].italic) {
    segments[0].text = `“${segments[0].text}”`;
  } else if (segments.length > 1) {
    const firstProse = segments.find(s => !s.italic);
    const lastProse = [...segments].reverse().find(s => !s.italic);
    if (firstProse && !/^[«“"—]/.test(firstProse.text)) {
      firstProse.text = `“${firstProse.text}`;
    }
    if (lastProse && firstProse && /^[“]/.test(firstProse.text)) {
      lastProse.text = `${lastProse.text}”`;
    }
  }

  return segments;
};

const buildSectionBlocks = (
  section: ReaderSection,
  scale: number,
): RawBlock[] => {
  const headingSize = Math.round(25 * scale * 10) / 10;
  const bodySize = Math.round(18.5 * scale * 10) / 10;
  const metaSize = 13;

  const blocks: RawBlock[] = [];

  if (section.heading) {
    blocks.push({
      blockId: `${section.id}:heading`,
      style: 'heading',
      text: section.heading,
      fontSize: headingSize,
      lineHeight: Math.round(headingSize * 1.24),
      align: 'left',
      italic: false,
      bold: true,
      muted: false,
      serif: true,
      gapBefore: 0,
      keepWithNext: true,
      keepTogether: true,
    });
  }

  if (section.subheading) {
    blocks.push({
      blockId: `${section.id}:sub`,
      style: 'subheading',
      text: section.subheading,
      fontSize: metaSize,
      lineHeight: 19,
      align: 'left',
      italic: false,
      bold: false,
      muted: true,
      serif: false,
      gapBefore: 6,
      keepWithNext: true,
      keepTogether: true,
    });
  }

  if (section.kind === 'prose' && section.paragraphs) {
    section.paragraphs.forEach((para, idx) => {
      blocks.push({
        blockId: `${section.id}:p:${idx}`,
        style: 'prose',
        text: para,
        fontSize: bodySize,
        lineHeight: Math.round(bodySize * 1.54),
        align: 'left',
        italic: false,
        bold: false,
        muted: false,
        serif: true,
        gapBefore: idx === 0 ? Math.round(18 * scale) : Math.round(14 * scale),
      });
    });
  }

  if (section.kind === 'highlights' && section.highlights) {
    section.highlights.forEach((hl, idx) => {
      const segments = parseHighlightSegments(hl.text);
      segments.forEach((seg, segIdx) => {
        const isFirstSeg = segIdx === 0;
        const isLastSeg = segIdx === segments.length - 1;
        blocks.push({
          blockId:
            segIdx === 0
              ? `${section.id}:hl:${idx}`
              : `${section.id}:hl:${idx}:${segIdx}`,
          style: 'quote',
          text: seg.text,
          fontSize: bodySize,
          lineHeight: Math.round(bodySize * 1.52),
          align: seg.align,
          italic: seg.italic,
          bold: false,
          muted: false,
          serif: true,
          gapBefore: isFirstSeg
            ? Math.round(20 * scale)
            : seg.tightWithPrev
              ? Math.round(2 * scale)
              : Math.round(12 * scale),
          keepWithNext:
            (isLastSeg && Boolean(hl.page)) ||
            Boolean(segments[segIdx + 1]?.tightWithPrev),
          keepTogether: seg.italic,
        });
      });

      if (hl.page) {
        blocks.push({
          blockId: `${section.id}:hl:${idx}:page`,
          style: 'pageRef',
          text: hl.page,
          fontSize: metaSize,
          lineHeight: 18,
          align: 'right',
          italic: false,
          bold: false,
          muted: true,
          serif: false,
          gapBefore: 4,
          keepTogether: true,
        });
      }
    });
  }

  return blocks;
};

/**
 * Deterministic client-side paginator.
 * Splits `ReaderSection[]` into screen-sized pages without ever clipping a line,
 * mapping each page to a stable `{ blockId, offset }` `ReaderAnchor` and TOC page numbers.
 */
const INLINE_EDGE_ART_H = 112;
const BOTTOM_TOP_PCTS = [42, 50, 44, 52, 40, 48, 43, 51] as const;

export function hashArtSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return Math.abs(h | 0) || 1;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndices(count: number, seed: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function bookOrnamentForSlot(artSeed: number, slot: number): number {
  const s = Math.abs(slot);
  const cycle = Math.floor(s / 8);
  const order = shuffledIndices(
    8,
    (artSeed ^ Math.imul(cycle + 1, 0x9e3779b9)) | 0,
  );
  return order[s % 8] ?? 0;
}

export function bookPairForSlot(artSeed: number, slot: number): number {
  const s = Math.abs(slot);
  const cycle = Math.floor(s / 7);
  const order = shuffledIndices(
    7,
    (artSeed ^ Math.imul(cycle + 1, 0x85ebca6b)) | 0,
  );
  return order[s % 7] ?? 0;
}

export function bookMotifForSlot(
  artSeed: number,
  slot: number,
): { motif: number; side: 'left' | 'right' } {
  const s = Math.abs(slot);
  const pairSlot = Math.floor(s / 2);
  const pairIdx = bookPairForSlot(artSeed, pairSlot);
  const leadRight = ((artSeed + pairSlot * 13) & 1) === 1;
  const isSecond = s % 2 === 1;
  const side: 'left' | 'right' = leadRight !== isSecond ? 'right' : 'left';
  const motif = side === 'left' ? pairIdx * 2 : pairIdx * 2 + 1;
  return { motif, side };
}

const resolveInlineEdgeSlot = (
  pageIndex: number,
  artSeed: number,
): {
  motif: number;
  side: 'left' | 'right';
  topPct: number;
} | null => {
  const slot = pageIndex % 4;
  if (slot !== 1 && slot !== 3) return null;
  const illustrationIdx = Math.floor(pageIndex / 4) * 2 + (slot === 3 ? 1 : 0);
  const { motif, side } = bookMotifForSlot(artSeed, illustrationIdx + 2);
  const topPct =
    BOTTOM_TOP_PCTS[(illustrationIdx + artSeed) % BOTTOM_TOP_PCTS.length] ?? 42;
  return {
    motif,
    side,
    topPct,
  };
};

export const paginateSections = (
  sections: ReaderSection[],
  {
    width,
    height,
    fontScale,
    maxMeasure: maxMeasureCap = 620,
    coverLabel = 'Cover',
    titleLabel = 'Title Page',
    includeEmptyHighlightsPage = false,
    emptyHighlightsLabel = 'Highlights',
    inlineEdgeArt = false,
    artSeed = 0,
  }: PaginatorOptions,
): PaginationResult => {
  const safeW = Math.max(180, width);
  const safeH = Math.max(240, height);
  const maxMeasure = Math.min(maxMeasureCap, safeW);
  const contentHeight = Math.max(180, safeH - 36);
  const measure = getCanvasMeasurer();

  const pages: PaginatedPage[] = [];
  const toc: TocEntry[] = [];

  for (const section of sections) {
    const startPageNumber = pages.length + 1;

    if (section.kind === 'cover' && section.imageUrl) {
      toc.push({
        id: section.id || COVER_SECTION_ID,
        kind: 'cover',
        label: coverLabel,
        page: startPageNumber,
      });
      pages.push({
        index: pages.length,
        sectionId: section.id,
        kind: 'cover',
        imageUrl: section.imageUrl,
        items: [],
        anchor: { blockId: section.id, offset: 0 },
      });
      continue;
    }

    if (section.kind === 'title') {
      const titleSize = Math.round(28 * fontScale * 10) / 10;
      const authorSize = Math.round(18 * fontScale * 10) / 10;
      toc.push({
        id: section.id || TITLE_SECTION_ID,
        kind: 'title',
        label: section.heading || titleLabel,
        page: startPageNumber,
      });
      pages.push({
        index: pages.length,
        sectionId: section.id,
        kind: 'title',
        imageUrl: section.imageUrl ?? undefined,
        titleCard: {
          heading: section.heading ?? '',
          subheading: section.subheading ?? null,
          meta: section.paragraphs?.[0] ?? null,
          titleSize,
          authorSize,
          metaSize: 13.5,
        },
        items: [],
        anchor: { blockId: section.id, offset: 0 },
      });
      continue;
    }

    if (section.kind === 'bookIndex' && section.indexEntries) {
      const headingSize = Math.round(24 * fontScale * 10) / 10;
      const rowSize = Math.round(15.5 * fontScale * 10) / 10;
      const rowHeight = Math.round(rowSize * 1.45) + 10;
      const headerReserved = Math.round(headingSize * 1.5) + 56;
      const entriesPerPage = Math.max(
        5,
        Math.floor((contentHeight - headerReserved) / rowHeight),
      );

      toc.push({
        id: section.id || BOOK_INDEX_SECTION_ID,
        kind: 'bookIndex',
        label: section.heading || 'Contents',
        page: startPageNumber,
      });

      const allEntries = section.indexEntries;
      for (let i = 0; i < allEntries.length; i += entriesPerPage) {
        const slice = allEntries.slice(i, i + entriesPerPage);
        pages.push({
          index: pages.length,
          sectionId: section.id,
          kind: 'bookIndex',
          indexCard: {
            heading: section.heading ?? 'Contents',
            entries: slice,
            headingSize,
            rowSize,
          },
          items: [],
          anchor: { blockId: section.id, offset: i },
        });
      }
      continue;
    }

    if (section.kind === 'end') {
      const headingSize = Math.round(28 * fontScale * 10) / 10;
      const subSize = Math.round(14.5 * fontScale * 10) / 10;
      toc.push({
        id: section.id || END_SECTION_ID,
        kind: 'end',
        label: section.heading || 'The End',
        page: startPageNumber,
      });
      pages.push({
        index: pages.length,
        sectionId: section.id || END_SECTION_ID,
        kind: 'end',
        endCard: {
          heading: section.heading ?? 'The End',
          subheading: section.subheading ?? null,
          headingSize,
          subSize,
        },
        items: [],
        anchor: { blockId: section.id || END_SECTION_ID, offset: 0 },
      });
      continue;
    }

    toc.push({
      id: section.id,
      kind: section.kind,
      label: section.heading ?? section.id,
      page: startPageNumber,
    });

    const rawBlocks = buildSectionBlocks(section, fontScale);
    const wrappedBlocks = rawBlocks.map(block => ({
      block,
      lines: wrapParagraph(block.text, maxMeasure, sample =>
        measure(sample, block.fontSize, block.serif, block.bold, block.italic),
      ),
    }));

    let currentItems: PageFlowItem[] = [];
    let usedY = 0;

    const currentPageCap = () => {
      if (!inlineEdgeArt) return contentHeight;
      const slot = resolveInlineEdgeSlot(pages.length, artSeed);
      return slot
        ? Math.max(140, contentHeight - INLINE_EDGE_ART_H)
        : contentHeight;
    };

    const flushPage = () => {
      if (currentItems.length === 0) return;
      let bottomEdgeArt: PaginatedPage['bottomEdgeArt'];
      if (inlineEdgeArt) {
        let slot = resolveInlineEdgeSlot(pages.length, artSeed);
        if (!slot && contentHeight - usedY >= INLINE_EDGE_ART_H + 12) {
          const bonusIdx = pages.length + 1;
          const { motif, side } = bookMotifForSlot(artSeed, bonusIdx);
          slot = {
            motif,
            side,
            topPct:
              BOTTOM_TOP_PCTS[(bonusIdx + artSeed) % BOTTOM_TOP_PCTS.length] ??
              42,
          };
        }
        if (slot) {
          bottomEdgeArt = {
            motif: slot.motif,
            side: slot.side,
            topPct: slot.topPct,
          };
        }
      }
      const first = currentItems[0];
      pages.push({
        index: pages.length,
        sectionId: section.id,
        kind: 'content',
        items: currentItems,
        anchor: { blockId: first.blockId, offset: first.startOffset },
        ...(bottomEdgeArt ? { bottomEdgeArt } : {}),
      });
      currentItems = [];
      usedY = 0;
    };

    for (let bi = 0; bi < wrappedBlocks.length; bi += 1) {
      const { block, lines } = wrappedBlocks[bi];
      if (lines.length === 0) continue;

      let lineIdx = 0;
      while (lineIdx < lines.length) {
        const pageCap = currentPageCap();
        const marginTop =
          currentItems.length === 0 ? 0 : lineIdx === 0 ? block.gapBefore : 0;
        const remainingH = pageCap - usedY - marginTop;
        const maxLinesFit = Math.floor(remainingH / block.lineHeight);

        // Avoid stranding a heading/subheading at the very bottom without at least 1 line of its next block.
        if (
          lineIdx === 0 &&
          block.keepWithNext &&
          currentItems.length > 0 &&
          bi + 1 < wrappedBlocks.length
        ) {
          const nextBlock = wrappedBlocks[bi + 1].block;
          const neededWithNext =
            marginTop +
            lines.length * block.lineHeight +
            nextBlock.gapBefore +
            nextBlock.lineHeight;
          if (usedY + neededWithNext > pageCap) {
            flushPage();
            continue;
          }
        }

        if (maxLinesFit <= 0) {
          if (currentItems.length > 0) {
            flushPage();
            continue;
          }
          // Even a giant line on an empty page advances at least 1 line to guarantee termination.
          const forced = lines[lineIdx];
          currentItems.push({
            blockId: block.blockId,
            style: block.style,
            lines: [forced.text],
            fontSize: block.fontSize,
            lineHeight: block.lineHeight,
            align: block.align,
            italic: block.italic,
            bold: block.bold,
            muted: block.muted,
            serif: block.serif,
            marginTop: 0,
            startOffset: forced.startOffset,
            endOffset: forced.endOffset,
          });
          lineIdx += 1;
          flushPage();
          continue;
        }

        // Widow/orphan guard: prefer at least 2 lines before splitting multi-line prose/quotes when page isn't empty.
        if (
          currentItems.length > 0 &&
          lines.length - lineIdx >= 2 &&
          maxLinesFit === 1 &&
          (block.style === 'prose' ||
            block.style === 'quote' ||
            block.keepTogether)
        ) {
          flushPage();
          continue;
        }

        const takeCount = Math.min(lines.length - lineIdx, maxLinesFit);
        const slice = lines.slice(lineIdx, lineIdx + takeCount);

        currentItems.push({
          blockId: block.blockId,
          style: block.style,
          lines: slice.map(l => l.text),
          fontSize: block.fontSize,
          lineHeight: block.lineHeight,
          align: block.align,
          italic: block.italic,
          bold: block.bold,
          muted: block.muted,
          serif: block.serif,
          marginTop,
          startOffset: slice[0].startOffset,
          endOffset: slice[slice.length - 1].endOffset,
        });

        usedY += marginTop + slice.length * block.lineHeight;
        lineIdx += takeCount;

        if (lineIdx < lines.length) {
          flushPage();
        }
      }
    }

    flushPage();
  }

  if (includeEmptyHighlightsPage) {
    const startPageNumber = pages.length + 1;
    toc.push({
      id: EMPTY_HIGHLIGHTS_SECTION_ID,
      kind: 'empty',
      label: emptyHighlightsLabel,
      page: startPageNumber,
    });
    pages.push({
      index: pages.length,
      sectionId: EMPTY_HIGHLIGHTS_SECTION_ID,
      kind: 'empty',
      items: [],
      anchor: { blockId: EMPTY_HIGHLIGHTS_SECTION_ID, offset: 0 },
    });
  }

  return {
    pages,
    toc,
    contentWidth: maxMeasure,
    contentHeight,
  };
};

/**
 * Restore the exact 0-based page index for a stored `ReaderAnchor` after reflow.
 */
export const pageIndexForAnchor = (
  pages: PaginatedPage[],
  anchor: ReaderAnchor | null | undefined,
): number => {
  if (!anchor || pages.length === 0) return 0;

  // 1. Exact block + character offset containment.
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (
      page.anchor.blockId === anchor.blockId &&
      page.items.length === 0 &&
      page.anchor.offset === anchor.offset
    ) {
      return i;
    }
    for (const item of page.items) {
      if (
        item.blockId === anchor.blockId &&
        anchor.offset >= item.startOffset &&
        anchor.offset <= item.endOffset
      ) {
        return i;
      }
    }
  }

  // 2. Fallback to first page containing the same blockId.
  const byBlock = pages.findIndex(
    p =>
      p.anchor.blockId === anchor.blockId ||
      p.items.some(item => item.blockId === anchor.blockId),
  );
  if (byBlock !== -1) return byBlock;

  // 3. Fallback to section prefix (e.g. "chapter:abc:hl:0" -> "chapter:abc").
  const sectionPrefix = anchor.blockId.split(':').slice(0, 2).join(':');
  const bySection = pages.findIndex(
    p => p.sectionId === anchor.blockId || p.sectionId === sectionPrefix,
  );
  return bySection !== -1 ? bySection : 0;
};
