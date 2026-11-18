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
import { cleanOcr, polishSpanishProse } from './clean';
import { type OcrLine, type Rgba } from '../ocr/paddle';

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
  /** Index into `lines` of the text line the flag points at (start line for L-flags). */
  lineIndex: number;
  /** End line index into `lines` when a vertical/L flag spans multiple lines on the same page. */
  endLineIndex?: number;
  stats?: { h: number; s: number; v: number; br?: number; height: number };
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
const RUNNING_HEADER_NUM_RE =
  /^(?:(\d{1,4})\s+[A-Za-zÀ-ÿ].*|[A-Za-zÀ-ÿ].*?\s+(\d{1,4}))$/;
const TOC_HEADING_RE =
  /^\s*(?:[íi]ndice(?:\s+general)?|contenidos?|sumario|table\s+of\s+contents|contents)\s*$/i;
const TOC_ENTRY_RE = /^(.*?[A-Za-zÀ-ÿ].*?)[\s.·…_-]*?(\d{1,4})\s*$/;

const normDigits = (s: string) =>
  s.trim().replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, '1');

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[
    Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))
  ];
};

/** Merge OCR boxes that sit on the same row into one line, left to right. */
const groupRows = (boxes: OcrLine[]): PageLine[] => {
  const rows: OcrLine[][] = [];
  const medH = median(boxes.map(b => b.y2 - b.y1)) || 1;
  for (const b of [...boxes].sort(
    (a, z) => (a.y1 + a.y2) / 2 - (z.y1 + z.y2) / 2,
  )) {
    const yc = (b.y1 + b.y2) / 2;
    const bw = Math.max(1, b.x2 - b.x1);
    const row = rows.find(r => {
      const overlapsX = r.some(z => {
        const zw = Math.max(1, z.x2 - z.x1);
        const ov = Math.min(b.x2, z.x2) - Math.max(b.x1, z.x1);
        if (ov <= 0) return false;
        // Allow small junction overlaps (<= 0.85 * medH) where OCR split one line into two boxes,
        // or tiny duplicate fragments (< 1.5 * medH wide) sitting inside an existing box.
        if (Math.min(bw, zw) < 1.5 * medH) return false;
        return ov > Math.max(0.85 * medH, 0.25 * Math.min(bw, zw));
      });
      if (overlapsX) return false;
      // Compare Y at the horizontal junction (`yRight` vs `yLeft`) so tilted rows still join cleanly.
      const neighbour = [...r].sort(
        (p, q) =>
          Math.min(Math.abs(p.x2 - b.x1), Math.abs(b.x2 - p.x1)) -
          Math.min(Math.abs(q.x2 - b.x1), Math.abs(b.x2 - q.x1)),
      )[0];
      const junctionDy = neighbour
        ? b.x1 >= neighbour.x1
          ? Math.abs(
              (b.yLeft ?? yc) -
                (neighbour.yRight ?? (neighbour.y1 + neighbour.y2) / 2),
            )
          : Math.abs(
              (neighbour.yLeft ?? (neighbour.y1 + neighbour.y2) / 2) -
                (b.yRight ?? yc),
            )
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
      const kept: OcrLine[] = [];
      for (const box of r) {
        const prev = kept[kept.length - 1];
        // Reject faint reverse-page bleed-through sitting in the blank space after a short line.
        if (prev && box.x1 - prev.x2 > 2 * medH && (box.score ?? 1) < 0.78) {
          continue;
        }
        // Drop tiny duplicate OCR fragments overlapped by a larger box on the same row.
        if (
          prev &&
          Math.min(prev.x2, box.x2) - Math.max(prev.x1, box.x1) >
            0.35 * Math.min(prev.x2 - prev.x1, box.x2 - box.x1)
        ) {
          if (box.x2 - box.x1 > prev.x2 - prev.x1) {
            kept[kept.length - 1] = box;
          }
          continue;
        }
        // Strip 1–3 duplicate boundary characters when two boxes slightly overlap at a mid-line split.
        let text = box.text;
        if (prev && prev.x2 - box.x1 > -4 && prev.x2 - box.x1 < 1.2 * medH) {
          const mDup = /^(\S{1,3})\s+(.*)$/.exec(text.trim());
          if (
            mDup &&
            prev.text.trim().toLowerCase().endsWith(mDup[1].toLowerCase())
          ) {
            text = mDup[2];
          }
        }
        kept.push({ ...box, text });
      }
      return {
        text: cleanOcr(kept.map(z => z.text).join(' ')),
        x1: Math.min(...kept.map(z => z.x1)),
        y1: Math.min(...kept.map(z => z.y1)),
        x2: Math.max(...kept.map(z => z.x2)),
        y2: Math.max(...kept.map(z => z.y2)),
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
    const c = clusters.find(
      cl => Math.abs(median(cl.map(z => z.x1)) - b.x1) < 0.08 * W,
    );
    if (c) c.push(b);
    else clusters.push([b]);
  }
  const centreOf = (c: OcrLine[]) =>
    (median(c.map(z => z.x1)) + median(c.map(z => z.x2))) / 2;
  const best = clusters.reduce((a, c) =>
    c.length - (2 * Math.abs(centreOf(c) - W / 2)) / W >
    a.length - (2 * Math.abs(centreOf(a) - W / 2)) / W
      ? c
      : a,
  );
  if (best.length < 3) return null;
  return {
    x1: percentile(
      best.map(b => b.x1),
      10,
    ),
    x2: percentile(
      best.map(b => b.x2),
      90,
    ),
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
  headingIndex: number | null,
): PageFlag[] => {
  const { width: W, height: H, data } = img;
  const flags: PageFlag[] = [];
  const ylo = Math.max(20, Math.round(col.y1 - 0.04 * H));
  const yhi = Math.min(H - 20, Math.round(col.y2 + 0.02 * H));
  const startLi = headingIndex === 0 ? 1 : 0;
  const bodyLines = lines.slice(startLi);
  const leftEdge = bodyLines.length
    ? Math.min(col.x1, ...bodyLines.map(l => l.x1))
    : col.x1;

  for (const side of ['R', 'L'] as const) {
    // 1) High-saturation neon sticky notes (orange/pink/red/yellow) in the column margin strip
    const a = Math.max(
      0,
      Math.round(side === 'R' ? col.x2 + 0.006 * W : col.x1 - 0.038 * W),
    );
    const b = Math.min(
      W,
      Math.round(side === 'R' ? col.x2 + 0.038 * W : col.x1 - 0.006 * W),
    );
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

    const usedLines = new Set<number>();
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
          aboveV > 110 &&
          belowV > 110 &&
          meanS >= 95 &&
          meanS - Math.max(aboveS, belowS) >= 48;

        if (paperSandwiched) {
          const isLShape = bh > 4.0 * col.lineH || fracH > 0.12;
          // An L-flag's horizontal bar sits at the top (or bottom) of its vertical leg;
          // a single horizontal bar points at its vertical midpoint.
          const targetY = isLShape
            ? start + Math.min(bh / 2, col.lineH * 0.8)
            : start + bh / 2;
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
            usedLines.add(best);
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

    // 2) Pastel teal & pale frosted translucent sticky notes outside all text/hanging numbers
    if (!lines.length || usedLines.size > 0) continue;
    const edge = side === 'R' ? col.x2 : leftEdge;
    const makeBand = (d1: number, d2: number) => {
      const pa = Math.max(
        0,
        Math.round(side === 'R' ? edge + d1 * W : edge - d2 * W),
      );
      const pb = Math.min(
        W,
        Math.round(side === 'R' ? edge + d2 * W : edge - d1 * W),
      );
      return (y1: number, y2: number) => {
        if (pb - pa < Math.max(6, Math.round(0.008 * W))) {
          return { h: 20, s: 15, v: 200, br: -12 };
        }
        const ya = Math.max(0, Math.round(y1));
        const yb = Math.min(H - 1, Math.round(y2));
        let h = 0;
        let s = 0;
        let v = 0;
        let br = 0;
        let c = 0;
        for (let y = ya; y <= yb; y++) {
          for (let x = pa; x < pb; x++) {
            const o = (y * W + x) * 4;
            const [hh, ss, vv] = hsv(data[o], data[o + 1], data[o + 2]);
            h += hh;
            s += ss;
            v += vv;
            br += data[o + 2] - data[o];
            c += 1;
          }
        }
        return c
          ? { h: h / c, s: s / c, v: v / c, br: br / c }
          : { h: 20, s: 15, v: 200, br: -12 };
      };
    };

    const bandStats = makeBand(0.008, 0.04);
    const midBand = makeBand(0.04, 0.075);
    const outBand = makeBand(0.075, 0.115);

    const ls = lines.map(l => bandStats(l.y1, l.y2));
    const ms = lines.map(l => midBand(l.y1, l.y2));
    const os = lines.map(l => outBand(l.y1, l.y2));
    const aboveBandOf = (idx: number) =>
      idx > startLi
        ? ls[idx - 1]
        : idx > 0
          ? ls[0]
          : bandStats(
              lines[0].y1 - 2.2 * col.lineH,
              lines[0].y1 - 0.8 * col.lineH,
            );
    const belowBandOf = (idx: number) =>
      idx + 1 < lines.length
        ? ls[idx + 1]
        : bandStats(
            lines[idx].y2 + 0.8 * col.lineH,
            lines[idx].y2 + 2.2 * col.lineH,
          );

    // 2a) Pastel teal sticky bands (cool cyan hue H >= 38 and positive/neutral B-R jump)
    let i = startLi;
    while (i < lines.length) {
      const startsTeal =
        (ls[i].br >= -1.0 && ls[i].h >= 42 && ls[i].v >= 110) ||
        (ls[i].h >= 40 &&
          ls[i].br >= -5.5 &&
          ls[i].v >= 140 &&
          i + 1 < lines.length &&
          ls[i + 1].br >= -1.0 &&
          ls[i + 1].h >= 42);
      if (startsTeal) {
        let j = i;
        while (
          j + 1 < lines.length &&
          ls[j + 1].br >= -2.0 &&
          ls[j + 1].h >= 38
        )
          j += 1;
        const above = aboveBandOf(i);
        const below = belowBandOf(j);
        const peakBR = Math.max(...ls.slice(i, j + 1).map(z => z.br));
        if (peakBR - Math.min(above.br, below.br) >= 8) {
          for (let k = i; k <= j; k++) usedLines.add(k);
          const span = j - i + 1;
          const y1 = lines[i].y1;
          const y2 = lines[j].y2;
          if (span >= 4) {
            const topArmEnd = Math.min(j, i + 1);
            const botArmStart = Math.max(i, j - 1);
            const topStrong =
              Math.max(ls[i].s, ls[topArmEnd].s) >= 35 &&
              Math.max(ms[i].br, ms[topArmEnd].br) >= 8;
            const botStrong =
              Math.max(ls[botArmStart].s, ls[j].s) >= 35 &&
              Math.max(ms[botArmStart].br, ms[j].br) >= 8;
            let midValley = false;
            for (let k = i + 1; k < j; k++) {
              if (ms[k].br <= -5.0) midValley = true;
            }
            if (topStrong && botStrong && midValley) {
              const botLine = ls[j].s >= ls[botArmStart].s ? j : botArmStart;
              flags.push({
                side,
                shape: 'L',
                y: (lines[i].y1 + lines[topArmEnd].y2) / 2,
                lineIndex: i,
                endLineIndex: topArmEnd,
                stats: {
                  h: ls[i].h,
                  s: ls[i].s,
                  v: ls[i].v,
                  br: ls[i].br,
                  height: (y2 - y1) / H,
                },
              });
              flags.push({
                side,
                shape: 'L',
                y: (lines[botLine].y1 + lines[j].y2) / 2,
                lineIndex: botLine,
                endLineIndex: j,
                stats: {
                  h: ls[botLine].h,
                  s: ls[botLine].s,
                  v: ls[botLine].v,
                  br: ls[botLine].br,
                  height: (y2 - y1) / H,
                },
              });
            } else {
              const topScore = Math.max(
                ls[i].br + ms[i].br,
                ls[topArmEnd].br + ms[topArmEnd].br,
              );
              const botScore = Math.max(
                ls[j].br + ms[j].br,
                ls[botArmStart].br + ms[botArmStart].br,
              );
              const armLine =
                botScore > topScore + 8
                  ? ls[botArmStart].br + ms[botArmStart].br >=
                    ls[j].br + ms[j].br
                    ? botArmStart
                    : j
                  : i;
              flags.push({
                side,
                shape: 'L',
                y: (lines[armLine].y1 + lines[armLine].y2) / 2,
                lineIndex: armLine,
                endLineIndex: j,
                stats: {
                  h: ls[armLine].h,
                  s: ls[armLine].s,
                  v: ls[armLine].v,
                  br: peakBR,
                  height: (y2 - y1) / H,
                },
              });
            }
          } else {
            flags.push({
              side,
              shape: 'bar',
              y: (y1 + y2) / 2,
              lineIndex: i,
              endLineIndex: j,
              stats: {
                h: ls[i].h,
                s: ls[i].s,
                v: ls[i].v,
                br: peakBR,
                height: (y2 - y1) / H,
              },
            });
          }
          i = j + 1;
          continue;
        }
      }
      i += 1;
    }

    // 2b) Pale frosted L-strips (5..10 lines with cool hue plateau, including when bottom touches a teal bar)
    for (let s = startLi; s < lines.length; s++) {
      if (usedLines.has(s)) continue;
      for (let e = Math.min(lines.length - 1, s + 9); e >= s + 4; e--) {
        let anyUsed = false;
        for (let k = s; k <= e; k++) {
          if (usedLines.has(k)) anyUsed = true;
        }
        if (anyUsed) continue;

        const above = aboveBandOf(s);
        const touchesTealBelow = e + 1 < lines.length && usedLines.has(e + 1);
        const belowCands = [ls[e + 1], ls[e + 2], ls[e + 3]].filter(Boolean);
        const below = belowCands.length
          ? belowCands.reduce((p, q) => (q.h < p.h ? q : p))
          : belowBandOf(e);
        if (above.v < 160 || above.h > 33) continue;
        if (!touchesTealBelow && (below.v < 155 || below.h > 31)) continue;

        const minHThresh = touchesTealBelow ? 31 : 34;
        let minH = Infinity;
        let ok = true;
        for (let k = s; k <= e; k++) {
          if (ls[k].v < 168 || ls[k].h < minHThresh) {
            ok = false;
            break;
          }
          minH = Math.min(minH, ls[k].h);
        }
        if (!ok) continue;

        const topDV = ls[s].v - above.v;
        const topDH = ls[s].h - above.h;
        const botDH = touchesTealBelow ? 10 : ls[e].h - below.h;
        const topDBR = ls[s].br - above.br;
        const botDBR = touchesTealBelow ? 2.0 : ls[e].br - below.br;
        const hasStemInInner = s + 2 <= e && ls[s + 2].h - ms[s + 2].h >= 5.0;
        const barEndedEarly =
          !hasStemInInner &&
          s + 2 <= e &&
          ls[s + 2].v - ls[s + 1].v >= 5.0 &&
          ls[e].v < ls[s + 2].v - 8;

        if (
          !barEndedEarly &&
          minH >= minHThresh &&
          topDH >= 8.0 &&
          botDH >= 4.5 &&
          topDV <= -5.0 &&
          topDBR >= 1.5 &&
          botDBR >= 0.4
        ) {
          for (let k = s; k <= e; k++) usedLines.add(k);
          const y1 = lines[s].y1;
          const y2 = lines[e].y2;
          const topScore = Math.max(
            ls[s].h + ms[s].h,
            ls[s + 1].h + ms[s + 1].h,
          );
          const botScore = Math.max(
            ls[e].h + ms[e].h,
            ls[e - 1].h + ms[e - 1].h,
          );
          const armLine =
            botScore > topScore + 8
              ? ls[e - 1].h + ms[e - 1].h >= ls[e].h + ms[e].h
                ? e - 1
                : e
              : s;
          flags.push({
            side,
            shape: 'L',
            y: (lines[armLine].y1 + lines[armLine].y2) / 2,
            lineIndex: armLine,
            endLineIndex: e,
            stats: {
              h: ls[armLine].h,
              s: ls[armLine].s,
              v: ls[armLine].v,
              br: ls[armLine].br,
              height: (y2 - y1) / H,
            },
          });
          break;
        }
      }
    }

    // 2c) Pale frosted horizontal bars (1..2 lines with crisp two-sided V dip and cool/neutral shift)
    const aboveMidOf = (idx: number) =>
      idx > startLi
        ? ms[idx - 1]
        : idx > 0
          ? ms[0]
          : midBand(
              lines[0].y1 - 2.2 * col.lineH,
              lines[0].y1 - 0.8 * col.lineH,
            );
    const belowMidOf = (idx: number) =>
      idx + 1 < lines.length
        ? ms[idx + 1]
        : midBand(
            lines[idx].y2 + 0.8 * col.lineH,
            lines[idx].y2 + 2.2 * col.lineH,
          );
    const aboveOutOf = (idx: number) =>
      idx > startLi
        ? os[idx - 1]
        : idx > 0
          ? os[0]
          : outBand(
              lines[0].y1 - 2.2 * col.lineH,
              lines[0].y1 - 0.8 * col.lineH,
            );
    const belowOutOf = (idx: number) =>
      idx + 1 < lines.length
        ? os[idx + 1]
        : outBand(
            lines[idx].y2 + 0.8 * col.lineH,
            lines[idx].y2 + 2.2 * col.lineH,
          );

    for (let s = startLi; s < lines.length; s++) {
      if (usedLines.has(s)) continue;
      for (let e = Math.min(lines.length - 1, s + 1); e >= s; e--) {
        if (usedLines.has(e)) continue;
        const above = aboveBandOf(s);
        const below = belowBandOf(e);
        if (above.v < 160 || below.v < 150) continue;
        const topDV = ls[s].v - above.v;
        const botDV = ls[e].v - below.v;
        const topDH = ls[s].h - above.h;
        const botDH = ls[e].h - below.h;
        const topDBR = ls[s].br - above.br;
        const botDBR = ls[e].br - below.br;

        let coolBar = below.v >= 155 && above.h <= 33;
        for (let k = s; k <= e; k++) {
          if (ls[k].v < 150 || ls[k].h < 27) coolBar = false;
        }
        const matchedCool =
          coolBar &&
          topDV <= -6.5 &&
          botDV <= -5.5 &&
          ((topDH >= 4.0 && (botDH >= 4.0 || topDH >= 10.0)) ||
            (topDBR >= 3.5 && botDBR >= 3.5));

        const matchedWarmLit =
          below.v >= 155 &&
          above.h <= 33 &&
          ls[s].v >= 180 &&
          ls[e].v >= 180 &&
          topDV <= -9.5 &&
          botDV <= -9.5 &&
          botDH >= 4.0 &&
          botDBR >= 2.0 &&
          os[s].s <= 10 &&
          os[s].h >= 45;

        const abMid = aboveMidOf(s);
        const blMid = belowMidOf(e);
        const abOut = aboveOutOf(s);
        const blOut = belowOutOf(e);
        const midTopDV = ms[s].v - abMid.v;
        const midBotDV = ms[e].v - blMid.v;
        const outTopDV = os[s].v - abOut.v;
        const outBotDV = os[e].v - blOut.v;

        const matchedNeutralStrip =
          e === s &&
          ls[s].s <= 25 &&
          ((topDV <= -10.0 &&
            botDV <= -7.0 &&
            midTopDV <= -7.0 &&
            midBotDV <= -6.5 &&
            (outTopDV <= -8.0 || outBotDV <= -8.0)) ||
            (topDV <= -20.0 &&
              botDV <= -5.0 &&
              midTopDV <= -18.0 &&
              topDH >= 3.5));

        if (matchedCool || matchedWarmLit || matchedNeutralStrip) {
          for (let k = s; k <= e; k++) usedLines.add(k);
          const y1 = lines[s].y1;
          const y2 = lines[e].y2;
          flags.push({
            side,
            shape: 'bar',
            y: (y1 + y2) / 2,
            lineIndex: s,
            endLineIndex: e,
            stats: {
              h: ls[s].h,
              s: ls[s].s,
              v: ls[s].v,
              br: ls[s].br,
              height: (y2 - y1) / H,
            },
          });
          break;
        }
      }
    }

    // 2d) Baseline-straddling translucent bar (tab placed along the baseline/paragraph gap under line s)
    if (!flags.some(f => f.side === side)) {
      const lh = col.lineH || 28;
      for (let s = startLi; s < lines.length; s++) {
        const subIn = bandStats(
          lines[s].y2 - 0.25 * lh,
          lines[s].y2 + 1.25 * lh,
        );
        const subMid = midBand(
          lines[s].y2 - 0.25 * lh,
          lines[s].y2 + 1.25 * lh,
        );
        const subOut = outBand(
          lines[s].y2 - 0.25 * lh,
          lines[s].y2 + 1.25 * lh,
        );
        const subAbIn = bandStats(
          lines[s].y1 - 0.9 * lh,
          lines[s].y1 + 0.1 * lh,
        );
        const subBlIn = bandStats(
          lines[s].y2 + 1.55 * lh,
          lines[s].y2 + 2.55 * lh,
        );
        const subAbMid = midBand(
          lines[s].y1 - 0.9 * lh,
          lines[s].y1 + 0.1 * lh,
        );
        const subBlMid = midBand(
          lines[s].y2 + 1.55 * lh,
          lines[s].y2 + 2.55 * lh,
        );
        const subAbOut = outBand(
          lines[s].y1 - 0.9 * lh,
          lines[s].y1 + 0.1 * lh,
        );
        const subBlOut = outBand(
          lines[s].y2 + 1.55 * lh,
          lines[s].y2 + 2.55 * lh,
        );
        if (subAbIn.v < 180 || subBlIn.v < 180 || subIn.s > 20) continue;
        const sTopDV = subIn.v - subAbIn.v;
        const sBotDV = subIn.v - subBlIn.v;
        const sMidTop = subMid.v - subAbMid.v;
        const sMidBot = subMid.v - subBlMid.v;
        const sOutTop = subOut.v - subAbOut.v;
        const sOutBot = subOut.v - subBlOut.v;
        if (
          (sTopDV <= -12.0 &&
            sBotDV <= -8.0 &&
            sMidTop <= -12.0 &&
            sMidBot <= -8.0 &&
            sOutTop <= -12.0) ||
          (sTopDV <= -5.5 &&
            sBotDV <= -2.8 &&
            sMidTop <= -2.8 &&
            sMidBot <= -2.5 &&
            sOutTop <= -15.0 &&
            sOutBot <= -11.0)
        ) {
          usedLines.add(s);
          flags.push({
            side,
            shape: 'bar',
            y: lines[s].y2,
            lineIndex: s,
            endLineIndex: s,
            stats: {
              h: subIn.h,
              s: subIn.s,
              v: subIn.v,
              br: subIn.br,
              height: (1.5 * lh) / H,
            },
          });
          break;
        }
      }
    }
  }
  return flags.sort((p, q) => p.y - q.y);
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};
const fromRoman = (s: string): number | null => {
  const u = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(u)) return null;
  let total = 0;
  for (let i = 0; i < u.length; i++) {
    const v = ROMAN_VALUES[u[i]];
    const next = i + 1 < u.length ? ROMAN_VALUES[u[i + 1]] : 0;
    total += v < next ? -v : v;
  }
  return total;
};
const toRoman = (n: number): string => {
  const pairs: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rem = n;
  let out = '';
  for (const [val, sym] of pairs) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
};

/**
 * An index photo: titles on the left, page numbers on the right. On a page
 * photographed at an angle the two columns drift apart vertically, so they
 * are read as two lists and zipped in order rather than row by row.
 */
export const parseToc = (boxes: OcrLine[]): TocEntry[] => {
  const NUM_ONLY = /^[\s.·…_-]*(\d{1,4})\s*$/;
  type Item = {
    y: number;
    x1: number;
    x2: number;
    title?: string;
    page?: number;
  };
  const items: Item[] = [];
  for (const b of boxes) {
    const t = polishSpanishProse(cleanOcr(b.text.trim()));
    const y = (b.y1 + b.y2) / 2;
    const n = NUM_ONLY.exec(t);
    if (n) {
      items.push({ y, x1: b.x1, x2: b.x2, page: Number(n[1]) });
      continue;
    }
    const m = TOC_ENTRY_RE.exec(t);
    if (m && /[A-Za-zÀ-ÿ]{2,}/.test(m[1])) {
      items.push({
        y,
        x1: b.x1,
        x2: b.x2,
        title: m[1].replace(/[\s.·…_-]+$/, '').trim(),
      });
      items.push({ y, x1: b.x1, x2: b.x2, page: Number(m[2]) });
      continue;
    }
    const title = t.replace(/[\s.·…_-]+$/, '').trim();
    if (/[A-Za-zÀ-ÿ]{2,}/.test(title) && !TOC_HEADING_RE.test(title)) {
      items.push({ y, x1: b.x1, x2: b.x2, title });
    }
  }
  const complete = items.filter(i => i.title && i.page);
  let titles = items.filter(i => i.title && !i.page).sort((a, b) => a.y - b.y);
  const pages = items.filter(i => !i.title && i.page).sort((a, b) => a.y - b.y);

  // Drop neighbour-page bleed fragments hugging the far left/right edge outside the TOC title column.
  if (titles.length >= 3) {
    const medX1 = median(titles.map(t => t.x1));
    if (medX1 > 80) {
      const colTitles = titles.filter(t => t.x1 >= medX1 - 80);
      if (colTitles.length >= Math.min(pages.length, 2)) titles = colTitles;
    }
  }

  if (titles.length > pages.length) {
    const caps = titles.filter(i => i.title === i.title!.toUpperCase());
    if (titles.length - caps.length >= pages.length) {
      titles = titles.filter(i => i.title !== i.title!.toUpperCase());
    }
  }
  const out: TocEntry[] = complete.map(i => ({
    title: i.title!,
    page: i.page!,
  }));
  if (titles.length === pages.length) {
    titles.forEach((t, k) =>
      out.push({ title: t.title!, page: pages[k].page! }),
    );
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
  const sorted = out.filter(e => e.page > 0).sort((a, b) => a.page - b.page);
  // Repair Roman numeral sequence when OCR drops a stroke between (n - 1) and (n + 1), e.g. VIII, X, X -> VIII, IX, X.
  const ROMAN_TITLE_RE = /^(.+?\s+)([IVXLCDM]+)$/i;
  for (let i = 1; i < sorted.length - 1; i++) {
    const mPrev = ROMAN_TITLE_RE.exec(sorted[i - 1].title);
    const mCur = ROMAN_TITLE_RE.exec(sorted[i].title);
    const mNext = ROMAN_TITLE_RE.exec(sorted[i + 1].title);
    if (!mPrev || !mCur || !mNext) continue;
    const nPrev = fromRoman(mPrev[2]);
    const nCur = fromRoman(mCur[2]);
    const nNext = fromRoman(mNext[2]);
    if (nPrev !== null && nNext === nPrev + 2 && nCur !== nPrev + 1) {
      sorted[i] = { ...sorted[i], title: `${mCur[1]}${toRoman(nPrev + 1)}` };
    }
  }
  return sorted;
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
  const letters = boxes.reduce(
    (n, b) => n + (b.text.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0),
    0,
  );
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

  // Everything inside the column (short last lines, headings, and hanging section numbers too).
  const inCol = boxes.filter(b => {
    const cx = (b.x1 + b.x2) / 2;
    return (
      cx > col.x1 - 0.065 * W &&
      cx < col.x2 + 0.065 * W &&
      b.x1 > col.x1 - 0.085 * W &&
      b.x2 < col.x2 + 0.085 * W
    );
  });
  let rows = groupRows(inCol);

  // The printed number: a lone number above or below the body.
  let pageNumber: number | null = null;
  const numRows = rows.filter(
    r =>
      PAGE_NUM_RE.test(normDigits(r.text)) &&
      (r.y2 >= col.y2 - 0.5 * col.lineH || r.y1 <= col.y1 + 0.8 * col.lineH),
  );
  if (numRows.length) {
    const r = numRows.reduce((a, z) =>
      Math.min(Math.abs(z.y1 - col.y2), Math.abs(col.y1 - z.y2)) <
      Math.min(Math.abs(a.y1 - col.y2), Math.abs(col.y1 - a.y2))
        ? z
        : a,
    );
    pageNumber = Number(PAGE_NUM_RE.exec(normDigits(r.text))![1]);
    rows = rows.filter(z => z !== r);
  } else if (rows.length >= 2) {
    const last = rows[rows.length - 1];
    if (
      last.y1 > col.y2 + 0.3 * col.lineH &&
      last.x2 - last.x1 < 0.08 * W &&
      /^[sS]{1,3}$/.test(last.text.trim())
    ) {
      pageNumber = Number(last.text.trim().replace(/[sS]/g, '5'));
      rows = rows.slice(0, -1);
    }
  }
  rows = rows.filter(r => !PAGE_NUM_RE.test(normDigits(r.text)));

  // Strip top running header (e.g. "26 Meditaciones", "Libro IV 41", or centred running title near top).
  if (rows.length >= 2 && rows[0].y1 < 0.18 * H) {
    const r0 = rows[0];
    const r1 = rows[1];
    const mHeaderNum = RUNNING_HEADER_NUM_RE.exec(normDigits(r0.text));
    if (mHeaderNum) {
      const n = Number(mHeaderNum[1] ?? mHeaderNum[2]);
      if (pageNumber === null && n > 0 && n < 2000) pageNumber = n;
      rows = rows.slice(1);
    } else if (
      r1.y1 - r0.y2 < 2.2 * col.lineH &&
      r0.x1 > col.x1 + 0.12 * (col.x2 - col.x1) &&
      r0.x2 < col.x2 - 0.12 * (col.x2 - col.x1) &&
      r0.text.length <= 50
    ) {
      rows = rows.slice(1);
    }
  }

  // A chapter heading: a short centred line with a clear gap under it, dropped from the top margin.
  let headingIndex: number | null = null;
  if (rows.length >= 2) {
    const r0 = rows[0];
    const r1 = rows[1];
    const centred =
      r0.x1 > col.x1 + 0.08 * (col.x2 - col.x1) &&
      r0.x2 < col.x2 - 0.08 * (col.x2 - col.x1);
    if (
      centred &&
      r0.text.length <= 60 &&
      r1.y1 - r0.y2 >= 2.2 * col.lineH &&
      r0.y1 >= 0.18 * H &&
      r0.y1 < col.y1 + 0.55 * (col.y2 - col.y1)
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
    flags: findFlags(img, col, rows, headingIndex),
  };
}
