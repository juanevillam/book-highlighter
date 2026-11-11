/**
 * Photos in order → the book: page numbers repaired from their neighbours,
 * highlights opened and closed by the flags, text joined across lines and
 * pages, and each highlight filed under its chapter from the index photo.
 *
 * HOW A HIGHLIGHT IS READ: a person photographs only the pages of their
 * highlights, start page to end page. So the first flag ON a page opens a
 * highlight and the next one closes it; pages in between belong to it
 * whole. A photographed page that nothing has opened, and that carries no
 * flag, is opened at its top — it was photographed for a reason — and a
 * highlight still open when the pages stop being consecutive closes at the
 * bottom of the last one. A missed flag therefore costs a few lines, never
 * a highlight.
 */
import { type PageAnalysis, type PageLine, type TocEntry } from './analyze';

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

const SENTENCE_END = /[.!?…»”"]\s*$|[.!?…][»”"]?\s*$/;
const HYPHEN_END = /[A-Za-zÀ-ÿ][-‐‑\u00ad]$/;
const LOWER_START = /^[a-zà-ÿ]/;

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

/** Fill missing numbers and fix misreads (`52` read as `2`) from the neighbours. */
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
    if (prev !== null && String(prev).endsWith(String(cur))) nums[i] = prev;
    else if (next !== null && String(next).endsWith(String(cur))) nums[i] = next;
    else if (prev !== null && next !== null && prev === next) nums[i] = prev;
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

type Piece = { text: string; paraStart: boolean };

const pagePieces = (p: PageAnalysis, from: number, to: number): Piece[] => {
  const out: Piece[] = [];
  const lh = p.lines.length
    ? p.lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / p.lines.length
    : 20;
  for (let i = Math.max(0, from); i <= to && i < p.lines.length; i++) {
    if (i === p.headingIndex) continue;
    const l: PageLine = p.lines[i];
    const prev = p.lines[i - 1];
    const indented = l.x1 - p.columnX1 > 0.9 * lh;
    const prevShort = prev ? p.columnX2 - prev.x2 > 3 * lh && SENTENCE_END.test(prev.text) : false;
    out.push({ text: l.text, paraStart: indented || prevShort });
  }
  return out;
};

export const joinPieces = (pieces: Piece[]): string => {
  let text = '';
  for (const { text: raw, paraStart } of pieces) {
    const t = raw.trim();
    if (!t) continue;
    if (!text) text = t;
    else if (HYPHEN_END.test(text) && LOWER_START.test(t)) text = text.slice(0, -1) + t;
    else if (paraStart && SENTENCE_END.test(text)) text += `\n\n${t}`;
    else text += ` ${t}`;
  }
  return text.replace(/[ \t]{2,}/g, ' ').trim();
};

/**
 * A flag is a band two lines tall, so it can point one line low. If the
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

/** The open/close marks, before any text is cut. */
export function findMarks(
  pages: PageAnalysis[],
  nums: (number | null)[],
): { start: Mark; end: Mark }[] {
  const marks: { start: Mark; end: Mark }[] = [];
  let open: Mark | null = null;
  let lastPhoto = -1;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.kind !== 'page' || !p.lines.length) continue;
    const consecutive =
      lastPhoto >= 0 && nums[i] !== null && nums[lastPhoto] !== null && nums[i] === nums[lastPhoto]! + 1;
    if (open && lastPhoto >= 0 && !consecutive) {
      marks.push({ start: open, end: { photo: lastPhoto, line: pages[lastPhoto].lines.length - 1 } });
      open = null;
    }
    // Flags stick out of a page's OUTER edge: right on odd pages, left on even.
    const outer = nums[i] === null ? null : nums[i]! % 2 === 1 ? 'R' : 'L';
    const flagLines = [
      ...new Set(p.flags.filter(f => outer === null || f.side === outer).map(f => f.lineIndex)),
    ].sort((a, b) => a - b);
    if (!open && !flagLines.length) {
      const first = p.headingIndex === 0 ? 1 : 0;
      open = { photo: i, line: first };
    }
    for (const line of flagLines) {
      if (!open) open = { photo: i, line: snapStartLine(p, line) };
      else {
        marks.push({ start: open, end: { photo: i, line } });
        open = null;
      }
    }
    lastPhoto = i;
  }
  if (open && lastPhoto >= 0) {
    marks.push({ start: open, end: { photo: lastPhoto, line: pages[lastPhoto].lines.length - 1 } });
  }
  return marks;
}

/** Cut the text between two marks. */
export function textBetween(pages: PageAnalysis[], start: Mark, end: Mark): string {
  const pieces: Piece[] = [];
  for (let i = start.photo; i <= end.photo; i++) {
    const p = pages[i];
    if (p.kind !== 'page') continue;
    let from = i === start.photo ? start.line : 0;
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
      pp[0] = { text: l.text.slice(off), paraStart: true };
    }
    from = 0;
    pieces.push(...pp);
  }
  return joinPieces(pieces);
}

const pageLabel = (a: number | null, b: number | null) =>
  a === null ? null : b === null || b === a ? String(a) : `${a}–${b}`;

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
