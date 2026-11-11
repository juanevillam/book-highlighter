import { type ReaderAnchor } from '../books';
import {
  COVER_SECTION_ID,
  TITLE_SECTION_ID,
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
};

export type PaginatedPage = {
  /** 0-based page index. */
  index: number;
  sectionId: string;
  kind: 'cover' | 'title' | 'content';
  imageUrl?: string;
  titleCard?: {
    heading: string;
    subheading: string | null;
    meta: string | null;
    titleSize: number;
    authorSize: number;
    metaSize: number;
  };
  items: PageFlowItem[];
  anchor: ReaderAnchor;
};

export type TocEntry = {
  id: string;
  kind: ReaderSection['kind'];
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
  coverLabel?: string;
  titleLabel?: string;
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
      else if ('ilI.,:;\'!| '.includes(ch)) units += 0.3;
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
      const quoted = `“${hl.text.trim()}”`;
      blocks.push({
        blockId: `${section.id}:hl:${idx}`,
        style: 'quote',
        text: quoted,
        fontSize: bodySize,
        lineHeight: Math.round(bodySize * 1.52),
        align: 'left',
        italic: false,
        bold: false,
        muted: false,
        serif: true,
        gapBefore: idx === 0 ? Math.round(20 * scale) : Math.round(20 * scale),
        keepWithNext: Boolean(hl.page),
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
export const paginateSections = (
  sections: ReaderSection[],
  {
    width,
    height,
    fontScale,
    coverLabel = 'Cover',
    titleLabel = 'Title Page',
  }: PaginatorOptions,
): PaginationResult => {
  const safeW = Math.max(280, width);
  const safeH = Math.max(360, height);
  const maxMeasure = Math.min(620, safeW - Math.max(44, Math.round(safeW * 0.12)));
  const topInset = 68;
  const bottomInset = 56;
  const contentHeight = Math.max(180, safeH - topInset - bottomInset);
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
      const titleSize = Math.round(32 * fontScale * 10) / 10;
      const authorSize = Math.round(19.5 * fontScale * 10) / 10;
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

    const flushPage = () => {
      if (currentItems.length === 0) return;
      const first = currentItems[0];
      pages.push({
        index: pages.length,
        sectionId: section.id,
        kind: 'content',
        items: currentItems,
        anchor: { blockId: first.blockId, offset: first.startOffset },
      });
      currentItems = [];
      usedY = 0;
    };

    for (let bi = 0; bi < wrappedBlocks.length; bi += 1) {
      const { block, lines } = wrappedBlocks[bi];
      if (lines.length === 0) continue;

      let lineIdx = 0;
      while (lineIdx < lines.length) {
        const marginTop =
          currentItems.length === 0
            ? 0
            : lineIdx === 0
              ? block.gapBefore
              : 0;
        const remainingH = contentHeight - usedY - marginTop;
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
          if (usedY + neededWithNext > contentHeight) {
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
          (block.style === 'prose' || block.style === 'quote' || block.keepTogether)
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
    if (page.anchor.blockId === anchor.blockId && page.items.length === 0) {
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
