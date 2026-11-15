/**
 * Photos in order → the highlight (or full book) and its TOC chapters:
 * - Page numbers repaired from their neighbours (`52` read as `2`, unnumbered
 *   chapter-start/end pages inferred).
 * - Highlights opened and closed by the sticky flags (`bar` or `L`).
 * - Paragraphs reconstructed across 5 typographic signals: first-line indent,
 *   short previous line ("punto y aparte sin sangría"), vertical block gap,
 *   dialogue em-dash (`—`), and right-aligned verse/epigraph continuations.
 * - Hyphenated words joined seamlessly across line and page breaks.
 */
import {
  parseToc,
  type PageAnalysis,
  type PageFlag,
  type PageLine,
  type TocEntry,
} from './analyze';
import { polishSpanishProse } from './clean';

export type Mark = { photo: number; line: number };

export type DraftHighlight = {
  id: string;
  start: Mark;
  end: Mark;
  /** Printed page label, e.g. "25–41". */
  page: string;
  text: string;
};

export type DraftChapter = {
  id: string;
  name: string;
  pages: string;
  highlights: DraftHighlight[];
};

export type DraftBook = {
  title: string;
  author: string;
  coverPhoto: number | null;
  /** Repaired printed page number per photo (null for cover/index/blank). */
  pageNumbers: (number | null)[];
  toc: TocEntry[];
  marks: { start: Mark; end: Mark }[];
  chapters: DraftChapter[];
};

const SENTENCE_END = /[.!?…:»”"]\s*$|[.!?…][»”"—.]*\s*$/;
const HYPHEN_END = /[A-Za-zÀ-ÿ«][-‐‑\u00ad]$/;
const LOWER_START = /^[[«"“']?[a-zà-ÿ]/;

let seq = 0;
const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${(seq += 1)}`;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Fill missing numbers and fix misreads (`52` read as `2`, `27` read as `2`) from the neighbours. */
export function repairPageNumbers(pages: PageAnalysis[]): (number | null)[] {
  const nums = pages.map(p => (p.kind === 'page' ? p.pageNumber : null));
  const isPage = pages.map(p => p.kind === 'page');
  const prevKnown = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (isPage[j]) return nums[j] === null ? null : nums[j]! + (i - j);
    return null;
  };
  const nextKnown = (i: number) => {
    for (let j = i + 1; j < pages.length; j++)
      if (isPage[j] && pages[j].pageNumber !== null) return pages[j].pageNumber! - (j - i);
    return null;
  };
  for (let i = 0; i < pages.length; i++) {
    if (!isPage[i]) continue;
    const prev = prevKnown(i);
    const next = nextKnown(i);
    const cur = nums[i];
    if (cur === null) {
      nums[i] = prev ?? next;
      continue;
    }
    const fitsPrev = prev !== null && cur === prev;
    const fitsNext = next !== null && cur === next;
    if (fitsPrev || fitsNext) continue;
    if (
      prev !== null &&
      (String(prev).endsWith(String(cur)) || String(prev).startsWith(String(cur)))
    ) {
      nums[i] = prev;
    } else if (
      next !== null &&
      (String(next).endsWith(String(cur)) || String(next).startsWith(String(cur)))
    ) {
      nums[i] = next;
    } else if (prev !== null && next !== null && prev === next) {
      nums[i] = prev;
    }
  }
  return nums;
}

/** Where to begin inside the flagged line: after a sentence that ends mid-line. */
const startOffset = (line: string, indented: boolean, prevEnded: boolean): number => {
  if (indented || prevEnded || !LOWER_START.test(line)) return 0;
  const m = /[.!?…][»”"]?\s+(?=[—–-]?\s*[A-ZÀ-Þ¡¿«])/.exec(line);
  return m ? m.index + m[0].length : 0;
};

const lineCut = (s: string, minRatio = 0): number | null => {
  const re =
    /[.!?…][»”"]?(?=\s)|(?<=[a-zà-ÿ])\s+(?=[¡¿«]|(?:Qué|Cómo|Dónde|Cuándo|Quién|Cuál)(?=\s|$))/g;
  let cut: number | null = null;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const pos = m.index + (m[0].startsWith(' ') ? 0 : m[0].length);
    if (pos > minRatio * s.length) cut = pos;
  }
  return cut;
};

/**
 * Where to stop. The flag marks a LINE, and the highlight ends at a sentence:
 * if the flagged line closes a sentence late, cut there; if the sentence is
 * still running, follow it onto the next line (`satisfac-` /
 * `ciones a los viejos samanas.`).
 */
const endCut = (
  lines: { text: string }[],
  from: number,
): { line: number; cut: number | null } => {
  const t = lines[from]?.text ?? '';
  const nextLower = (i: number) => LOWER_START.test(lines[i + 1]?.text ?? '');
  if (SENTENCE_END.test(t) && !HYPHEN_END.test(t) && !nextLower(from)) return { line: from, cut: null };
  const c0 = lineCut(t, 0.55);
  if (c0 !== null && !nextLower(from)) return { line: from, cut: c0 };
  if (from + 1 < lines.length) {
    const t1 = lines[from + 1].text;
    const c1 = lineCut(t1, 0.25);
    if (c1 !== null) return { line: from + 1, cut: c1 };
    return { line: from + 1, cut: null };
  }
  return { line: from, cut: null };
};

type Piece = { text: string; paraStart: boolean; endsShort: boolean };

const pagePieces = (p: PageAnalysis, from: number, to: number): Piece[] => {
  const out: Piece[] = [];
  const lh = p.lines.length
    ? p.lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / p.lines.length
    : 20;
  const colW = Math.max(1, p.columnX2 - p.columnX1);

  const pitches: number[] = [];
  for (let i = 1; i < p.lines.length; i++) {
    const dy = (p.lines[i].y1 + p.lines[i].y2) / 2 - (p.lines[i - 1].y1 + p.lines[i - 1].y2) / 2;
    if (dy > 0) pitches.push(dy);
  }
  const medPitch = median(pitches) || lh * 1.35;

  for (let i = Math.max(0, from); i <= to && i < p.lines.length; i++) {
    if (i === p.headingIndex) continue;
    const l: PageLine = p.lines[i];
    const prev = i > 0 && i - 1 !== p.headingIndex ? p.lines[i - 1] : undefined;

    // Right-aligned hanging poetic continuation (`[en el Atmán,`) is part of the same line/stanza.
    const hangingRight = l.x1 - p.columnX1 > 0.42 * colW && /^[[(a-zà-ÿ]/.test(l.text);
    const indented = !hangingRight && l.x1 - p.columnX1 > 0.65 * lh;
    const prevShort = prev
      ? p.columnX2 - prev.x2 > 1.15 * lh && SENTENCE_END.test(prev.text)
      : false;
    const pitch = prev ? (l.y1 + l.y2) / 2 - (prev.y1 + prev.y2) / 2 : 0;
    const extraGap = prev ? pitch > 1.32 * medPitch : false;
    const dialogueStart = /^—/.test(l.text) && (prev ? SENTENCE_END.test(prev.text) : true);
    const endsShort = p.columnX2 - l.x2 > 1.15 * lh && SENTENCE_END.test(l.text);

    out.push({
      text: l.text,
      paraStart: indented || prevShort || extraGap || dialogueStart,
      endsShort,
    });
  }
  return out;
};

export const joinPieces = (pieces: { text: string; paraStart: boolean; endsShort?: boolean }[]): string => {
  let text = '';
  let prevEndedShort = false;
  for (const { text: raw, paraStart, endsShort } of pieces) {
    const t = raw.trim();
    if (!t) continue;
    if (!text) {
      text = t;
    } else if (HYPHEN_END.test(text) && (LOWER_START.test(t) || /^[A-Za-zÀ-ÿ]+»/.test(t))) {
      text = text.slice(0, -1) + t;
    } else if ((paraStart || prevEndedShort) && SENTENCE_END.test(text)) {
      text += `\n\n${t}`;
    } else {
      text += ` ${t}`;
    }
    prevEndedShort = Boolean(endsShort);
  }
  return polishSpanishProse(text.replace(/[ \t]{2,}/g, ' ').trim());
};

/**
 * A flag is a band ~2 lines tall, so it can point one line low. If the
 * flagged line is a bare continuation (lower-case start, no sentence
 * beginning in it), the highlight really starts on the line above.
 */
export const snapStartLine = (p: PageAnalysis, line: number): number => {
  let i = line;
  for (let step = 0; step < 2 && i > 0; step++) {
    const t = p.lines[i].text;
    const begins = !LOWER_START.test(t) || /[.!?…][»”"]?\s+[—–-]?\s*[A-ZÀ-Þ¡¿«]/.test(t);
    if (begins || i - 1 === p.headingIndex) break;
    i -= 1;
  }
  return i;
};

const outerFlags = (p: PageAnalysis, pageNum: number | null): PageFlag[] => {
  const outer = pageNum === null ? null : pageNum % 2 === 1 ? 'R' : 'L';
  const filtered = p.flags.filter(f => outer === null || f.side === outer);
  return filtered.length ? filtered : p.flags;
};

const findParagraphEnd = (p: PageAnalysis, startLine: number): number => {
  const lh = p.lines.length
    ? p.lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / p.lines.length
    : 20;
  for (let i = startLine; i < p.lines.length - 1; i++) {
    const cur = p.lines[i];
    const next = p.lines[i + 1];
    const nextIndented = next.x1 - p.columnX1 > 0.65 * lh;
    const curShort = p.columnX2 - cur.x2 > 1.15 * lh && SENTENCE_END.test(cur.text);
    if ((nextIndented || curShort) && SENTENCE_END.test(cur.text)) return i;
  }
  return p.lines.length - 1;
};

export const formatPageSpan = (a: number | null, b: number | null): string =>
  a === null ? (b === null ? '' : String(b)) : b === null || b === a ? String(a) : `${a}–${b}`;

/**
 * Given the photos of ONE highlight (`1..N` pages in order), find its exact
 * start mark on the first page and end mark on the last page.
 * Intermediate pages (`1 .. N-2`) are always included in full.
 */
export function findHighlightSpan(
  pages: PageAnalysis[],
  nums: (number | null)[],
): { start: Mark; end: Mark; page: string } | null {
  const pageIdxs = pages
    .map((p, i) => (p.kind === 'page' && p.lines.length > 0 ? i : -1))
    .filter(i => i >= 0);
  if (!pageIdxs.length) return null;

  const firstIdx = pageIdxs[0];
  const lastIdx = pageIdxs[pageIdxs.length - 1];
  const firstPage = pages[firstIdx];
  const lastPage = pages[lastIdx];
  const page = formatPageSpan(nums[firstIdx] ?? null, nums[lastIdx] ?? null);

  if (firstIdx === lastIdx) {
    const flags = outerFlags(firstPage, nums[firstIdx]);
    const uniqueLines = [...new Set(flags.map(f => f.lineIndex))].sort((a, b) => a - b);
    if (uniqueLines.length >= 2) {
      return {
        start: { photo: firstIdx, line: snapStartLine(firstPage, uniqueLines[0]) },
        end: { photo: firstIdx, line: uniqueLines[uniqueLines.length - 1] },
        page,
      };
    }
    if (uniqueLines.length === 1) {
      const startLine = snapStartLine(firstPage, uniqueLines[0]);
      const flag = flags[0];
      const endLine =
        flag?.shape === 'L' ? findParagraphEnd(firstPage, startLine) : firstPage.lines.length - 1;
      return {
        start: { photo: firstIdx, line: startLine },
        end: { photo: firstIdx, line: endLine },
        page,
      };
    }
    const firstLine = firstPage.headingIndex === 0 ? Math.min(1, firstPage.lines.length - 1) : 0;
    return {
      start: { photo: firstIdx, line: firstLine },
      end: { photo: firstIdx, line: firstPage.lines.length - 1 },
      page,
    };
  }

  // Multi-page highlight: first photo opens it, last photo closes it, all middle photos are whole.
  const startFlags = outerFlags(firstPage, nums[firstIdx]);
  const startLine = startFlags.length
    ? snapStartLine(firstPage, startFlags[0].lineIndex)
    : firstPage.headingIndex === 0
      ? Math.min(1, firstPage.lines.length - 1)
      : 0;

  const endFlags = outerFlags(lastPage, nums[lastIdx]);
  const endLine = endFlags.length
    ? endFlags[endFlags.length - 1].lineIndex
    : lastPage.lines.length - 1;

  return {
    start: { photo: firstIdx, line: startLine },
    end: { photo: lastIdx, line: endLine },
    page,
  };
}

/** The open/close marks across a batch of photos. */
export function findMarks(
  pages: PageAnalysis[],
  nums: (number | null)[],
): { start: Mark; end: Mark }[] {
  const span = findHighlightSpan(pages, nums);
  return span ? [{ start: span.start, end: span.end }] : [];
}

/** Cut the text between two marks. */
export function textBetween(pages: PageAnalysis[], start: Mark, end: Mark): string {
  const pieces: Piece[] = [];
  for (let i = start.photo; i <= end.photo; i++) {
    const p = pages[i];
    if (p.kind !== 'page') continue;
    const from = i === start.photo ? start.line : 0;
    let to = i === end.photo ? end.line : p.lines.length - 1;
    let cut: number | null = null;
    if (i === end.photo) ({ line: to, cut } = endCut(p.lines, to));
    const pp = pagePieces(p, from, to);
    if (cut !== null && pp.length) {
      pp[pp.length - 1] = { ...pp[pp.length - 1], text: p.lines[to].text.slice(0, cut) };
    }
    if (i === start.photo && pp.length) {
      const l = p.lines[from];
      const prev = p.lines[from - 1];
      const off = startOffset(
        l.text,
        pp[0].paraStart,
        prev ? SENTENCE_END.test(prev.text) : true,
      );
      pp[0] = { ...pp[0], text: l.text.slice(off), paraStart: true };
    }
    pieces.push(...pp);
  }
  return joinPieces(pieces);
}

const pageLabel = (a: number | null, b: number | null) =>
  a === null ? (b === null ? null : String(b)) : b === null || b === a ? String(a) : `${a}–${b}`;

/**
 * Extract chapters (`name` + `pages` range) from 1..N photos of a book's
 * table of contents (`ÍNDICE` / `Contents`). Even if a continuation page of the
 * TOC has no `ÍNDICE` heading at the top, its lines are parsed as TOC entries.
 */
export function extractChaptersFromToc(
  pages: PageAnalysis[],
): { name: string; pages: string }[] {
  const entries: TocEntry[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const raw =
      p.toc.length > 0
        ? p.toc
        : parseToc(p.lines.map(l => ({ ...l, score: 1 })));
    for (const e of raw) {
      const title = e.title.trim();
      const key = `${title.toLowerCase()}@${e.page}`;
      if (!title || e.page <= 0 || seen.has(key)) continue;
      seen.add(key);
      entries.push({ title, page: e.page });
    }
  }
  entries.sort((a, b) => a.page - b.page);
  return entries.map((entry, idx) => {
    const next = entries[idx + 1];
    const endPage = next && next.page > entry.page ? next.page - 1 : null;
    const pagesLabel =
      endPage !== null && endPage > entry.page ? `${entry.page}–${endPage}` : String(entry.page);
    return { name: entry.title, pages: pagesLabel };
  });
}

export function assembleBook(
  pages: PageAnalysis[],
  overrides?: { marks?: { start: Mark; end: Mark }[] },
): DraftBook {
  const nums = repairPageNumbers(pages);
  const toc = pages
    .filter(p => p.kind === 'index')
    .flatMap(p => p.toc)
    .sort((a, b) => a.page - b.page);
  const coverPhoto = pages.findIndex(p => p.kind === 'cover');
  const cover = coverPhoto >= 0 ? pages[coverPhoto].coverLines : [];

  const marks = overrides?.marks ?? findMarks(pages, nums);
  const chapters: DraftChapter[] = [];
  for (const m of marks) {
    const startNum = nums[m.start.photo];
    const endNum = nums[m.end.photo];
    const text = textBetween(pages, m.start, m.end);
    if (!text) continue;
    const entry = startNum === null ? undefined : [...toc].reverse().find(e => e.page <= startNum);
    const name = entry?.title ?? '';
    let ch = chapters.find(c => c.name === name);
    if (!ch) {
      ch = { id: makeId(), name, pages: '', highlights: [] };
      chapters.push(ch);
    }
    ch.highlights.push({
      id: makeId(),
      start: m.start,
      end: m.end,
      page: pageLabel(startNum, endNum) ?? '',
      text,
    });
  }
  for (const ch of chapters) {
    const first = ch.highlights[0]?.page.split('–')[0] ?? '';
    const last = ch.highlights[ch.highlights.length - 1]?.page.split('–').pop() ?? '';
    ch.pages = first && last && first !== last ? `${first}–${last}` : first;
  }

  return {
    title: cover[0] ? titleCase(cover[0]) : '',
    author: cover.length > 1 ? titleCase(cover.slice(1, 3).join(' ')) : '',
    coverPhoto: coverPhoto >= 0 ? coverPhoto : null,
    pageNumbers: nums,
    toc,
    marks,
    chapters,
  };
}
