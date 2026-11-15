/**
 * One photo → what is on it: the page's own text column (not the neighbour
 * page peeking in), its printed number, whether it is a cover or an index,
 * and the sticky flags lying ON this page.
 *
 * THE STICKY RULE (Paper Sandwich in the Margin):
 * Every flag in the book sticks out past the page edge, so a photo shows a
 * whole comb of them. Only a flag stuck to the page being photographed lies on
 * top of its paper inside the margin strip (`0.006 * W` to `0.038 * W` outside
 * the text column), sandwiched between bare low-saturation paper immediately
 * above it AND bare low-saturation paper immediately below it. Tabs on pages
 * underneath stay outside the paper edge; a thumb holding the bottom corner
 * enters from the frame edge and has no bare paper below it.
 */
import { type OcrLine, type Rgba } from '../ocr/paddle';

import { cleanOcr } from './clean';

export type PageLine = {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type PageFlag = {
  side: 'L' | 'R';
  /** `'L'` when a vertical leg spans multiple lines (single-paragraph mark); `'bar'` for a horizontal strip. */
  shape?: 'bar' | 'L';
  /** Centre of the flag band, image px. */
  y: number;
  /** Index into `lines` of the text line the flag points at. */
  lineIndex: number;
  stats?: { h: number; s: number; v: number; height: number };
};

export type TocEntry = { title: string; page: number };

export type PageAnalysis = {
  kind: 'page' | 'cover' | 'index' | 'blank';
  width: number;
  height: number;
  pageNumber: number | null;
  /** Body lines of this page, top to bottom (headers and page number removed). */
  lines: PageLine[];
  /** Left edge of the text column — indented lines start paragraphs. */
  columnX1: number;
  columnX2: number;
  /** Index into `lines` of a chapter heading on this page, if any. */
  headingIndex: number | null;
  flags: PageFlag[];
  toc: TocEntry[];
  /** Cover only: the big lines, largest first. */
  coverLines: string[];
};

const PAGE_NUM_RE = /^\D{0,2}(\d{1,4})\D{0,2}$/;
const TOC_HEADING_RE =
  /^\s*(?:[íi]ndice(?:\s+general)?|contenidos?|sumario|table\s+of\s+contents|contents)\s*$/i;
const TOC_ENTRY_RE = /^(.*?[A-Za-zÀ-ÿ].*?)[\s.·…_-]*?(\d{1,4})\s*$/;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

/** Merge OCR boxes that sit on the same row into one line, left to right. */
const groupRows = (boxes: OcrLine[]): PageLine[] => {
  const rows: OcrLine[][] = [];
  const medH = median(boxes.map(b => b.y2 - b.y1)) || 1;
  for (const b of [...boxes].sort((a, z) => (a.y1 + a.y2) / 2 - (z.y1 + z.y2) / 2)) {
    const yc = (b.y1 + b.y2) / 2;
    const row = rows.find(r => {
      const overlapsX = r.some(z => b.x1 < z.x2 - 4 && z.x1 < b.x2 - 4);
      if (overlapsX) return false;
      // Compare Y at the horizontal junction (`yRight` vs `yLeft`) so tilted rows still join cleanly.
      const neighbour = [...r].sort(
        (p, q) =>
          Math.min(Math.abs(p.x2 - b.x1), Math.abs(b.x2 - p.x1)) -
          Math.min(Math.abs(q.x2 - b.x1), Math.abs(b.x2 - q.x1)),
      )[0];
      const junctionDy = neighbour
        ? b.x1 >= neighbour.x2 - 8
          ? Math.abs((b.yLeft ?? yc) - (neighbour.yRight ?? (neighbour.y1 + neighbour.y2) / 2))
          : Math.abs((neighbour.yLeft ?? (neighbour.y1 + neighbour.y2) / 2) - (b.yRight ?? yc))
        : Infinity;
      const ry = r.reduce((s, z) => s + (z.y1 + z.y2) / 2, 0) / r.length;
      return Math.min(junctionDy, Math.abs(ry - yc)) <= 0.48 * medH;
    });
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows
    .map(r => {
      r.sort((a, z) => a.x1 - z.x1);
      return {
        text: cleanOcr(r.map(z => z.text).join(' ')),
        x1: Math.min(...r.map(z => z.x1)),
        y1: Math.min(...r.map(z => z.y1)),
        x2: Math.max(...r.map(z => z.x2)),
        y2: Math.max(...r.map(z => z.y2)),
      };
    })
    .sort((a, z) => a.y1 - z.y1);
};

/** The text column of the page this photo is OF: most long lines, nearest the centre. */
const findColumn = (boxes: OcrLine[], W: number) => {
  const long = boxes.filter(b => b.x2 - b.x1 > 0.25 * W);
  if (long.length < 3) return null;
  const clusters: OcrLine[][] = [];
  for (const b of [...long].sort((a, z) => a.x1 - z.x1)) {
    const c = clusters.find(cl => Math.abs(median(cl.map(z => z.x1)) - b.x1) < 0.08 * W);
    if (c) c.push(b);
    else clusters.push([b]);
  }
  const centreOf = (c: OcrLine[]) => (median(c.map(z => z.x1)) + median(c.map(z => z.x2))) / 2;
  const best = clusters.reduce((a, c) =>
    c.length - (2 * Math.abs(centreOf(c) - W / 2)) / W >
    a.length - (2 * Math.abs(centreOf(a) - W / 2)) / W
      ? c
      : a,
  );
  if (best.length < 3) return null;
  return {
    x1: percentile(best.map(b => b.x1), 10),
    x2: percentile(best.map(b => b.x2), 90),
    y1: Math.min(...best.map(b => b.y1)),
    y2: Math.max(...best.map(b => b.y2)),
    lineH: median(best.map(b => b.y2 - b.y1)),
  };
};

/** RGB → OpenCV-style HSV (h 0–180, s/v 0–255). */
const hsv = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 30;
    if (h < 0) h += 180;
  }
  return [h, max ? (255 * d) / max : 0, max];
};

const findFlags = (
  img: Rgba,
  col: NonNullable<ReturnType<typeof findColumn>>,
  lines: PageLine[],
): PageFlag[] => {
  const { width: W, height: H, data } = img;
  const flags: PageFlag[] = [];
  const ylo = Math.max(20, Math.round(col.y1 - 0.04 * H));
  const yhi = Math.min(H - 20, Math.round(col.y2 + 0.02 * H));

  for (const side of ['R', 'L'] as const) {
    const a = Math.max(0, Math.round(side === 'R' ? col.x2 + 0.006 * W : col.x1 - 0.038 * W));
    const b = Math.min(W, Math.round(side === 'R' ? col.x2 + 0.038 * W : col.x1 - 0.006 * W));
    const spanW = b - a;
    if (spanW < Math.max(6, Math.round(0.008 * W))) continue;

    const rowH = new Float32Array(H);
    const rowS = new Float32Array(H);
    const rowV = new Float32Array(H);

    for (let y = Math.max(0, ylo - 30); y <= Math.min(H - 1, yhi + 30); y++) {
      let sh = 0;
      let ss = 0;
      let sv = 0;
      for (let x = a; x < b; x++) {
        const o = (y * W + x) * 4;
        const [h, s, v] = hsv(data[o], data[o + 1], data[o + 2]);
        sh += h;
        ss += s;
        sv += v;
      }
      rowH[y] = sh / spanW;
      rowS[y] = ss / spanW;
      rowV[y] = sv / spanW;
    }

    let start = -1;
    for (let y = ylo; y <= yhi + 1; y++) {
      const active = y <= yhi && rowS[y] >= 80 && rowV[y] >= 110;
      if (active) {
        if (start < 0) start = y;
        continue;
      }
      if (start < 0) continue;

      const bh = y - start;
      const fracH = bh / H;
      if (fracH >= 0.012 && fracH <= 0.22) {
        // Paper Sandwich check: bare low-saturation paper must sit both above AND below the band.
        let aboveS = 0;
        let aboveV = 0;
        let belowS = 0;
        let belowV = 0;
        let cnt = 0;
        for (let d = 6; d <= 24; d++) {
          const ya = Math.max(0, start - d);
          const yb = Math.min(H - 1, y + d);
          aboveS += rowS[ya];
          aboveV += rowV[ya];
          belowS += rowS[yb];
          belowV += rowV[yb];
          cnt += 1;
        }
        aboveS /= cnt;
        aboveV /= cnt;
        belowS /= cnt;
        belowV /= cnt;

        let meanH = 0;
        let meanS = 0;
        let meanV = 0;
        for (let yy = start; yy < y; yy++) {
          meanH += rowH[yy];
          meanS += rowS[yy];
          meanV += rowV[yy];
        }
        meanH /= bh;
        meanS /= bh;
        meanV /= bh;

        const paperSandwiched =
          aboveS < 42 &&
          belowS < 42 &&
          aboveV > 135 &&
          belowV > 135 &&
          meanS >= 95 &&
          meanS - Math.max(aboveS, belowS) >= 48;

        if (paperSandwiched) {
          const isLShape = bh > 2.6 * col.lineH || fracH > 0.075;
          // An L-flag's horizontal bar sits at the top (or bottom) of its vertical leg;
          // a single horizontal bar points at its vertical midpoint.
          const targetY = isLShape ? start + Math.min(bh / 2, col.lineH * 0.8) : start + bh / 2;
          let best = -1;
          let bestD = Infinity;
          lines.forEach((l, k) => {
            const d = Math.abs((l.y1 + l.y2) / 2 - targetY);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          });
          if (best >= 0 && bestD <= 2.5 * col.lineH) {
            flags.push({
              side,
              shape: isLShape ? 'L' : 'bar',
              y: targetY,
              lineIndex: best,
              stats: { h: meanH, s: meanS, v: meanV, height: fracH },
            });
          }
        }
      }
      start = -1;
    }
  }
  return flags.sort((p, q) => p.y - q.y);
};

/**
 * An index photo: titles on the left, page numbers on the right. On a page
 * photographed at an angle the two columns drift apart vertically, so they
 * are read as two lists and zipped in order rather than row by row.
 */
export const parseToc = (boxes: OcrLine[]): TocEntry[] => {
  const NUM_ONLY = /^[\s.·…_-]*(\d{1,4})\s*$/;
  type Item = { y: number; title?: string; page?: number };
  const items: Item[] = [];
  for (const b of boxes) {
    const t = cleanOcr(b.text.trim());
    const y = (b.y1 + b.y2) / 2;
    const n = NUM_ONLY.exec(t);
    if (n) {
      items.push({ y, page: Number(n[1]) });
      continue;
    }
    const m = TOC_ENTRY_RE.exec(t);
    if (m && /[A-Za-zÀ-ÿ]{2,}/.test(m[1])) {
      items.push({ y, title: m[1].replace(/[\s.·…_-]+$/, '').trim() });
      items.push({ y, page: Number(m[2]) });
      continue;
    }
    const title = t.replace(/[\s.·…_-]+$/, '').trim();
    if (/[A-Za-zÀ-ÿ]{2,}/.test(title) && !TOC_HEADING_RE.test(title)) items.push({ y, title });
  }
  const complete = items.filter(i => i.title && i.page);
  let titles = items.filter(i => i.title && !i.page).sort((a, b) => a.y - b.y);
  const pages = items.filter(i => !i.title && i.page).sort((a, b) => a.y - b.y);
  if (titles.length > pages.length) {
    const caps = titles.filter(i => i.title === i.title!.toUpperCase());
    if (titles.length - caps.length >= pages.length) {
      titles = titles.filter(i => i.title !== i.title!.toUpperCase());
    }
  }
  const out: TocEntry[] = complete.map(i => ({ title: i.title!, page: i.page! }));
  if (titles.length === pages.length) {
    titles.forEach((t, k) => out.push({ title: t.title!, page: pages[k].page! }));
  } else {
    const used = new Set<number>();
    for (const t of titles) {
      let best = -1;
      let bestD = Infinity;
      pages.forEach((p, k) => {
        if (used.has(k)) return;
        const d = Math.abs(p.y - t.y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best >= 0) {
        used.add(best);
        out.push({ title: t.title!, page: pages[best].page! });
      }
    }
  }
  return out.filter(e => e.page > 0).sort((a, b) => a.page - b.page);
};

export function analyzePage(img: Rgba, boxes: OcrLine[]): PageAnalysis {
  const { width: W, height: H } = img;
  const empty: PageAnalysis = {
    kind: 'blank',
    width: W,
    height: H,
    pageNumber: null,
    lines: [],
    columnX1: 0,
    columnX2: W,
    headingIndex: null,
    flags: [],
    toc: [],
    coverLines: [],
  };

  const all = groupRows(boxes);
  const tocHead = all.find(l => TOC_HEADING_RE.test(l.text));
  if (tocHead) {
    const toc = parseToc(boxes.filter(b => b.y1 > tocHead.y2 - 2));
    if (toc.length >= 2) return { ...empty, kind: 'index', lines: all, toc };
  }

  const col = findColumn(boxes, W);
  const letters = boxes.reduce((n, b) => n + (b.text.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0), 0);
  if (!col || letters < 120) {
    if (letters >= 120) {
      return { ...empty, kind: 'page', lines: all };
    }
    const biggest = [...boxes]
      .filter(b => /[A-Za-zÀ-ÿ]{2,}/.test(b.text))
      .sort((a, z) => z.y2 - z.y1 - (a.y2 - a.y1))
      .slice(0, 4);
    const big = [biggest[0], ...biggest.slice(1).sort((a, z) => a.y1 - z.y1)]
      .filter(Boolean)
      .map(b => b.text);
    return big.length ? { ...empty, kind: 'cover', coverLines: big } : empty;
  }

  // Everything inside the column (short last lines and headings too).
  const inCol = boxes.filter(b => {
    const cx = (b.x1 + b.x2) / 2;
    return (
      cx > col.x1 - 0.02 * W &&
      cx < col.x2 + 0.02 * W &&
      b.x1 > col.x1 - 0.06 * W &&
      b.x2 < col.x2 + 0.06 * W
    );
  });
  let rows = groupRows(inCol);

  // The printed number: a lone number above or below the body.
  let pageNumber: number | null = null;
  const numRows = rows.filter(
    r => PAGE_NUM_RE.test(r.text.trim()) && (r.y1 >= col.y2 - 4 || r.y2 <= col.y1 + 4),
  );
  if (numRows.length) {
    const r = numRows.reduce((a, z) =>
      Math.min(Math.abs(z.y1 - col.y2), Math.abs(col.y1 - z.y2)) <
      Math.min(Math.abs(a.y1 - col.y2), Math.abs(col.y1 - a.y2))
        ? z
        : a,
    );
    pageNumber = Number(PAGE_NUM_RE.exec(r.text.trim())![1]);
    rows = rows.filter(z => z !== r);
  }
  rows = rows.filter(r => !PAGE_NUM_RE.test(r.text.trim()));

  // A chapter heading: a short centred line with a clear gap under it, near the top.
  let headingIndex: number | null = null;
  if (rows.length >= 2) {
    const r0 = rows[0];
    const r1 = rows[1];
    const centred =
      r0.x1 > col.x1 + 0.08 * (col.x2 - col.x1) && r0.x2 < col.x2 - 0.08 * (col.x2 - col.x1);
    if (
      centred &&
      r0.text.length <= 60 &&
      r1.y1 - r0.y2 > 1.3 * col.lineH &&
      r0.y1 < col.y1 + 0.5 * (col.y2 - col.y1)
    ) {
      headingIndex = 0;
    }
  }

  return {
    ...empty,
    kind: 'page',
    pageNumber,
    lines: rows,
    columnX1: col.x1,
    columnX2: col.x2,
    headingIndex,
    flags: findFlags(img, col, rows),
  };
}
