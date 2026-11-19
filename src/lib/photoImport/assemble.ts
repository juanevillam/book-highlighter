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

const SENTENCE_END = /[.!?…:»”"]\s*$|[.!?…][»”"—.]*\s*$/;
const HYPHEN_END = /[A-Za-zÀ-ÿ«][-‐‑\u00ad]["'”»]?\s*$/;
const LOWER_START = /^[[«"“']?[a-zà-ÿ]/;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const normHeading = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\b([ivxlcdm]*)[l|]([ivxlcdm]*)\b/g, (_, a, b) => `${a}i${b}`)
    .replace(/\s+/g, ' ');

/** Fill missing numbers and fix misreads (`52` read as `2`, `27` read as `2`) from the neighbours and TOC. */
export function repairPageNumbers(
  pages: PageAnalysis[],
  toc?: TocEntry[],
): (number | null)[] {
  const tocList =
    toc ?? pages.filter(p => p.kind === 'index').flatMap(p => p.toc);
  const nums = pages.map(p => {
    if (p.kind !== 'page') return null;
    if (p.pageNumber !== null) return p.pageNumber;
    if (p.headingIndex !== null && p.lines[p.headingIndex]) {
      const h = normHeading(p.lines[p.headingIndex].text);
      const match = tocList.find(e => normHeading(e.title) === h);
      if (match) return match.page;
    }
    return null;
  });
  const isPage = pages.map(p => p.kind === 'page');
  const prevKnown = (i: number) => {
    for (let j = i - 1; j >= 0; j--)
      if (isPage[j]) return nums[j] === null ? null : nums[j]! + (i - j);
    return null;
  };
  const nextKnown = (i: number) => {
    for (let j = i + 1; j < pages.length; j++)
      if (isPage[j] && nums[j] !== null) return nums[j]! - (j - i);
    return null;
  };
  for (let i = 0; i < pages.length; i++) {
    if (!isPage[i]) continue;
    const prev = prevKnown(i);
    const next = nextKnown(i);
    const cur = nums[i];
    if (cur === null) {
      const fSides = new Set(pages[i].flags.map(f => f.side));
      const fSide = fSides.size === 1 ? [...fSides][0] : null;
      const matchesParity = (cand: number | null) =>
        cand !== null &&
        (fSide === null || (cand % 2 === 1 ? 'R' : 'L') === fSide);
      const validPrev = matchesParity(prev) ? prev : null;
      const validNext = matchesParity(next) ? next : null;
      nums[i] =
        pages[i].headingIndex !== null
          ? (validNext ?? validPrev)
          : (validPrev ?? validNext);
      continue;
    }
    const fitsPrev = prev !== null && cur === prev;
    const fitsNext = next !== null && cur === next;
    if (fitsPrev || fitsNext) continue;
    if (
      prev !== null &&
      (String(prev).endsWith(String(cur)) ||
        String(prev).startsWith(String(cur)))
    ) {
      nums[i] = prev;
    } else if (
      next !== null &&
      (String(next).endsWith(String(cur)) ||
        String(next).startsWith(String(cur)))
    ) {
      nums[i] = next;
    } else if (prev !== null && next !== null && prev === next) {
      nums[i] = prev;
    }
  }
  return nums;
}

/** Where to begin inside the flagged line: after a sentence that ends mid-line. */
const startOffset = (
  line: string,
  indented: boolean,
  prevEnded: boolean,
): number => {
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
  if (SENTENCE_END.test(t) && !HYPHEN_END.test(t) && !nextLower(from))
    return { line: from, cut: null };
  const c0 = lineCut(t, 0.55);
  if (c0 !== null && !nextLower(from)) return { line: from, cut: c0 };
  if (from + 1 < lines.length) {
    const t1 = lines[from + 1].text;
    const c1 = lineCut(t1, 0.25);
    if (c1 !== null) return { line: from + 1, cut: c1 };
    if (
      (SENTENCE_END.test(t1) && !HYPHEN_END.test(t1) && !nextLower(from + 1)) ||
      from + 2 >= lines.length ||
      !nextLower(from + 1)
    ) {
      return { line: from + 1, cut: null };
    }
    const t2 = lines[from + 2].text;
    const c2 = lineCut(t2, 0.25);
    return { line: from + 2, cut: c2 };
  }
  return { line: from, cut: null };
};

type Piece = {
  text: string;
  paraStart: boolean;
  endsShort: boolean;
  verse?: boolean;
  verseAlign?: 'left' | 'right';
};

const pagePieces = (p: PageAnalysis, from: number, to: number): Piece[] => {
  const out: Piece[] = [];
  const lh = p.lines.length
    ? p.lines.reduce((s, l) => s + (l.y2 - l.y1), 0) / p.lines.length
    : 20;
  const colW = Math.max(1, p.columnX2 - p.columnX1);

  const pitches: number[] = [];
  for (let i = 1; i < p.lines.length; i++) {
    const dy =
      (p.lines[i].y1 + p.lines[i].y2) / 2 -
      (p.lines[i - 1].y1 + p.lines[i - 1].y2) / 2;
    if (dy > 0) pitches.push(dy);
  }
  const medPitch = median(pitches) || lh * 1.35;

  const isHangingRight = (idx: number) => {
    const l = p.lines[idx];
    if (!l) return false;
    return (
      l.x1 - p.columnX1 > 0.38 * colW && /^[[(]\s*[A-Za-zÀ-ÿ]/.test(l.text)
    );
  };

  const isHangingLeft = (idx: number) => {
    const l = p.lines[idx];
    if (!l) return false;
    return /^\d{1,3}\.\s/.test(l.text) || p.columnX1 - l.x1 > 0.4 * lh;
  };

  // Detect verse stanzas (lines grouped around a right-aligned `[...` turnover line or stanza gap).
  const verseLines = new Set<number>();
  for (let i = 0; i < p.lines.length; i++) {
    if (isHangingRight(i)) {
      verseLines.add(i);
      if (i > 0 && i - 1 !== p.headingIndex) verseLines.add(i - 1);
      for (let j = i + 1; j < p.lines.length; j++) {
        verseLines.add(j);
        const next = p.lines[j + 1];
        if (!next) break;
        const dy =
          (next.y1 + next.y2) / 2 - (p.lines[j].y1 + p.lines[j].y2) / 2;
        if (dy > 1.32 * medPitch || SENTENCE_END.test(p.lines[j].text)) break;
      }
    }
  }

  for (let i = Math.max(0, from); i <= to && i < p.lines.length; i++) {
    if (i === p.headingIndex) continue;
    const l: PageLine = p.lines[i];
    const prev = i > 0 && i - 1 !== p.headingIndex ? p.lines[i - 1] : undefined;

    // Local column left/right margin in a sliding window so a 1–3° camera tilt never triggers false indents.
    const winX1: number[] = [];
    const winX2: number[] = [];
    for (
      let w = Math.max(0, i - 4);
      w <= Math.min(p.lines.length - 1, i + 4);
      w++
    ) {
      if (
        w === p.headingIndex ||
        isHangingRight(w) ||
        isHangingLeft(w) ||
        verseLines.has(w)
      )
        continue;
      winX1.push(p.lines[w].x1);
      if (p.lines[w].x2 - p.lines[w].x1 > 0.5 * colW) winX2.push(p.lines[w].x2);
    }
    winX1.sort((a, b) => a - b);
    winX2.sort((a, b) => a - b);
    const localX1 = winX1.length
      ? winX1[Math.floor(winX1.length * 0.2)]
      : p.columnX1;
    const localX2 = winX2.length
      ? winX2[Math.floor(winX2.length * 0.8)]
      : p.columnX2;

    const hangingRight = isHangingRight(i);
    const verse = verseLines.has(i);
    const indented = !hangingRight && !verse && l.x1 - localX1 > 0.72 * lh;
    const prevShort = prev
      ? localX2 - prev.x2 > 1.15 * lh && SENTENCE_END.test(prev.text)
      : false;
    const pitch = prev ? (l.y1 + l.y2) / 2 - (prev.y1 + prev.y2) / 2 : 0;
    const extraGap = prev ? pitch > 1.32 * medPitch : false;
    const dialogueStart =
      /^—/.test(l.text) && (prev ? SENTENCE_END.test(prev.text) : true);
    const sectionStart = /^\d{1,3}\.\s/.test(l.text);
    const endsShort =
      !verse && localX2 - l.x2 > 1.15 * lh && SENTENCE_END.test(l.text);

    out.push({
      text: l.text,
      paraStart:
        indented ||
        prevShort ||
        extraGap ||
        dialogueStart ||
        sectionStart ||
        (verse && !verseLines.has(i - 1)),
      endsShort: endsShort || (verse && !verseLines.has(i + 1)),
      verse,
      verseAlign: hangingRight ? 'right' : 'left',
    });
  }
  return out;
};

export const joinPieces = (
  pieces: {
    text: string;
    paraStart: boolean;
    endsShort?: boolean;
    verse?: boolean;
    verseAlign?: 'left' | 'right';
  }[],
): string => {
  let text = '';
  let prevEndedShort = false;
  let prevVerse = false;
  for (const { text: raw, paraStart, endsShort, verse, verseAlign } of pieces) {
    const t = raw.trim();
    if (!t) continue;
    if (verse) {
      const formattedVerse =
        verseAlign === 'right'
          ? `                                  *${t}*`
          : `*${t}*`;
      if (!text) {
        text = formattedVerse;
      } else if (prevVerse) {
        text += `\n${formattedVerse}`;
      } else {
        text += `\n\n${formattedVerse}`;
      }
      prevEndedShort = Boolean(endsShort);
      prevVerse = true;
      continue;
    }
    const cleanTarget = t
      .replace(/^\.\s*(?=[a-zà-ÿ])/, '')
      .replace(/^[—–-]\s*(?=[a-zà-ÿ])/, '');
    if (!text) {
      text = t;
    } else if (prevVerse) {
      text += `\n\n${t}`;
    } else if (
      HYPHEN_END.test(text) &&
      (LOWER_START.test(cleanTarget) || /^[A-Za-zÀ-ÿ]+»/.test(cleanTarget))
    ) {
      text = text.replace(/[-‐‑\u00ad]["'”»]?\s*$/, '') + cleanTarget;
    } else if (
      !prevEndedShort &&
      /\b(?:desha|indi|em|in|im|sub|trans|pre|pro|anti|auto|contra|entre|sobre|super|ultra|vice|die)\.\s*$/i.test(
        text,
      ) &&
      /^[a-zà-ÿ]/.test(cleanTarget)
    ) {
      text = text.replace(/\.\s*$/, '') + cleanTarget;
    } else if (
      !prevEndedShort &&
      /[a-zà-ÿ]\.\s*$/.test(text) &&
      /^(?:ron|cerse|ferente|virti[eé]ndol[oa]s?|plearl[oa]s?|mente|ci[oó]n|si[oó]n|ciones|siones|dad|dades|miento|mientos|ble|bles|ndo|ndose|ndole|ndoles|ndolo|ndola|ndolos|ndolas|ndome|ndote|ndonos|rse|rlo|rla|rlos|rlas|rle|rles|rme|rte|rnos)(?![a-zà-ÿ])/i.test(
        cleanTarget,
      )
    ) {
      text = text.replace(/\.\s*$/, '') + cleanTarget;
    } else if (
      (paraStart || prevEndedShort) &&
      SENTENCE_END.test(text) &&
      !LOWER_START.test(t)
    ) {
      text += `\n\n${t}`;
    } else {
      text += ` ${t}`;
    }
    prevEndedShort = Boolean(endsShort);
    prevVerse = false;
  }
  return polishSpanishProse(
    text.replace(/[ \t]{2,}/g, m => (m.length >= 16 ? m : ' ')).trim(),
  );
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
    const begins =
      !LOWER_START.test(t) || /[.!?…][»”"]?\s+[—–-]?\s*[A-ZÀ-Þ¡¿«]/.test(t);
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
  const bodyLines = p.lines.filter(l => !/^\d{1,3}\.\s/.test(l.text));
  const bodyX1 = bodyLines.length
    ? median(bodyLines.map(l => l.x1))
    : p.columnX1;
  const isNumberedSection = /^\d{1,3}\.\s/.test(p.lines[startLine]?.text ?? '');

  for (let i = startLine; i < p.lines.length - 1; i++) {
    const cur = p.lines[i];
    const next = p.lines[i + 1];
    if (isNumberedSection) {
      if (/^\d{1,3}\.\s/.test(next.text)) return i;
      continue;
    }
    const nextIndented =
      next.x1 - bodyX1 > 0.65 * lh || /^\d{1,3}\.\s/.test(next.text);
    const curShort =
      p.columnX2 - cur.x2 > 1.15 * lh && SENTENCE_END.test(cur.text);
    if ((nextIndented || curShort) && SENTENCE_END.test(cur.text)) return i;
  }
  return p.lines.length - 1;
};

export const formatPageSpan = (a: number | null, b: number | null): string =>
  a === null
    ? b === null
      ? ''
      : String(b)
    : b === null || b === a
      ? String(a)
      : `${a}–${b}`;

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
    const uniqueLines = [...new Set(flags.map(f => f.lineIndex))].sort(
      (a, b) => a - b,
    );
    if (uniqueLines.length >= 2) {
      return {
        start: {
          photo: firstIdx,
          line: snapStartLine(firstPage, uniqueLines[0]),
        },
        end: { photo: firstIdx, line: uniqueLines[uniqueLines.length - 1] },
        page,
      };
    }
    if (uniqueLines.length === 1) {
      const startLine = snapStartLine(firstPage, uniqueLines[0]);
      const flag = flags[0];
      const endLine =
        flag?.shape === 'L'
          ? findParagraphEnd(firstPage, startLine)
          : firstPage.lines.length - 1;
      return {
        start: { photo: firstIdx, line: startLine },
        end: { photo: firstIdx, line: endLine },
        page,
      };
    }
    const firstLine =
      firstPage.headingIndex === 0
        ? Math.min(1, firstPage.lines.length - 1)
        : 0;
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

/** The open/close marks across a batch of photos (one or many highlights). */
export function findMarks(
  pages: PageAnalysis[],
  nums: (number | null)[],
): { start: Mark; end: Mark }[] {
  const pageIdxs = pages
    .map((p, i) => (p.kind === 'page' && p.lines.length > 0 ? i : -1))
    .filter(i => i >= 0);
  if (!pageIdxs.length) return [];

  const marks: { start: Mark; end: Mark }[] = [];
  const barPages = pages.map(p => ({ ...p, flags: [...p.flags] }));
  const barPageIdxs: number[] = [];

  for (let pos = 0; pos < pageIdxs.length; pos++) {
    const pi = pageIdxs[pos];
    const fl = outerFlags(pages[pi], nums[pi]);
    const lFlags = fl.filter(f => f.shape === 'L');
    const bFlags = fl.filter(f => f.shape !== 'L');

    const prevPi = pos > 0 ? pageIdxs[pos - 1] : null;
    const nextPi = pos + 1 < pageIdxs.length ? pageIdxs[pos + 1] : null;
    const prevConsecutiveZero =
      prevPi !== null &&
      nums[prevPi] !== null &&
      nums[pi] !== null &&
      nums[pi] === nums[prevPi]! + 1 &&
      outerFlags(pages[prevPi], nums[prevPi]).length === 0;
    const nextConsecutiveZero =
      nextPi !== null &&
      nums[nextPi] !== null &&
      nums[pi] !== null &&
      nums[nextPi] === nums[pi]! + 1 &&
      outerFlags(pages[nextPi], nums[nextPi]).length === 0;

    // An L flag is a standalone single-unit highlight unless it is the sole flag on an endpoint of a 0-flag multi-page run.
    const standaloneL =
      lFlags.length >= 2 ||
      (lFlags.length === 1 && bFlags.length >= 1) ||
      (lFlags.length === 1 && !prevConsecutiveZero && !nextConsecutiveZero);

    if (standaloneL) {
      for (const lf of lFlags) {
        const sLine = snapStartLine(pages[pi], lf.lineIndex);
        const eLine = findParagraphEnd(pages[pi], sLine);
        marks.push({
          start: { photo: pi, line: sLine },
          end: { photo: pi, line: eLine },
        });
      }
      if (bFlags.length > 0) {
        barPages[pi] = { ...pages[pi], flags: bFlags };
        barPageIdxs.push(pi);
      }
    } else {
      barPageIdxs.push(pi);
    }
  }

  const slices: number[][] = [];
  let current: number[] = [];

  for (let pos = 0; pos < barPageIdxs.length; pos++) {
    const idx = barPageIdxs[pos];
    if (!current.length) {
      current.push(idx);
      continue;
    }
    const prevIdx = current[current.length - 1];
    const prevNum = nums[prevIdx];
    const curNum = nums[idx];
    const pageGap =
      prevNum !== null && curNum !== null && curNum !== prevNum + 1;

    const firstFlags = outerFlags(barPages[current[0]], nums[current[0]]);
    const prevFlags = outerFlags(barPages[prevIdx], nums[prevIdx]);
    const curFlags = outerFlags(barPages[idx], curNum);
    const closedMultiPage = current.length >= 2 && prevFlags.length > 0;
    const closedSinglePage =
      current.length === 1 &&
      new Set(firstFlags.map(f => f.lineIndex)).size >= 2;
    const selfContainedCurrent =
      new Set(curFlags.map(f => f.lineIndex)).size >= 2;

    if (
      pageGap ||
      closedMultiPage ||
      closedSinglePage ||
      selfContainedCurrent
    ) {
      slices.push(current);
      current = [idx];
    } else {
      current.push(idx);
    }
  }
  if (current.length) slices.push(current);

  for (const slice of slices) {
    const subPages = slice.map(i => barPages[i]);
    const subNums = slice.map(i => nums[i]);
    const span = findHighlightSpan(subPages, subNums);
    if (span) {
      marks.push({
        start: { photo: slice[span.start.photo], line: span.start.line },
        end: { photo: slice[span.end.photo], line: span.end.line },
      });
    }
  }

  return marks.sort(
    (a, b) => a.start.photo - b.start.photo || a.start.line - b.start.line,
  );
}

/** Cut the text between two marks. */
export function textBetween(
  pages: PageAnalysis[],
  start: Mark,
  end: Mark,
): string {
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
      pp[pp.length - 1] = {
        ...pp[pp.length - 1],
        text: p.lines[to].text.slice(0, cut),
      };
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
      endPage !== null && endPage > entry.page
        ? `${entry.page}–${endPage}`
        : String(entry.page);
    return { name: entry.title, pages: pagesLabel };
  });
}
