/**
 * PaddleOCR (PP-OCR det + rec) on ONNX Runtime, free and on-device.
 *
 * Runtime-agnostic on purpose: the caller hands in an RGBA image and the two
 * sessions (onnxruntime-web in the browser worker, onnxruntime-node in the
 * evaluation script), so the exact same pipeline is what gets measured and
 * what ships.
 *
 * CURVED & TILTED LINE UNWARPING (learned on Siddhartha, 2026-11-14):
 * A hand-held photo of an open book curves toward the spine and tilts by
 * different angles at the top and bottom of the page. An axis-aligned box
 * around a tilted line is 2–3× taller than the letters and swallows the lines
 * above and below. Instead, each connected component from `det.onnx` records
 * its per-column vertical centre `yc(x)` and median stroke thickness `medH`,
 * and `rec-latin.onnx` samples along that curved centreline to produce a flat,
 * single-line strip with zero bleed from neighbouring lines.
 */

export type Rgba = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type OcrLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Vertical centre at `x1` and `x2` (in `img` px), used to join tilted fragments on the same row. */
  yLeft?: number;
  yRight?: number;
  text: string;
  score: number;
};

type Tensor = { data: Float32Array | ArrayLike<number>; dims: readonly number[] };

export type OrtLike = {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
};

export type SessionLike = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, Tensor>>;
};

export type PaddleModels = {
  ort: OrtLike;
  det: SessionLike;
  rec: SessionLike;
  /** Characters of the rec dictionary, one per line (blank and space added here). */
  dict: string[];
};

const DET_MAX_SIDE = 1280;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.45;
const REC_H = 48;
const REC_MAX_W = 960;
const REC_BATCH = 8;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const DIACRITIC_GROUPS: Record<string, string[]> = {
  á: ['á', 'à', 'â', 'ä', 'ã'],
  é: ['é', 'è', 'ê', 'ë'],
  í: ['í', 'ì', 'î', 'ï'],
  ó: ['ó', 'ò', 'ô', 'ö', 'õ'],
  ú: ['ú', 'ù', 'û', 'ü'],
  Á: ['Á', 'À', 'Â', 'Ä', 'Å'],
  É: ['É', 'È', 'Ê', 'Ë'],
  Í: ['Í', 'Ì', 'Î', 'Ï'],
  Ó: ['Ó', 'Ò', 'Ô', 'Ö', 'Õ'],
  Ú: ['Ú', 'Ù', 'Û', 'Ü'],
};

type DiacriticGroup = { canonIdx: number; idxs: number[] };

const buildDiacriticGroups = (chars: string[]): DiacriticGroup[] =>
  Object.entries(DIACRITIC_GROUPS)
    .map(([canon, variants]) => ({
      canonIdx: chars.indexOf(canon),
      idxs: variants.map(ch => chars.indexOf(ch)).filter(i => i > 0),
    }))
    .filter(g => g.canonIdx > 0 && g.idxs.length > 1);

/** Bilinear resample of a region of an RGBA image into RGB floats. */
const sampleRgb = (
  img: Rgba,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array => {
  const out = new Float32Array(dw * dh * 3);
  const { data, width, height } = img;
  for (let y = 0; y < dh; y++) {
    const fy = sy + ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < dw; x++) {
      const fx = sx + ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * width + x0) * 4 + c];
        const b = data[(y0 * width + x1) * 4 + c];
        const cc = data[(y1 * width + x0) * 4 + c];
        const d = data[(y1 * width + x1) * 4 + c];
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (cc * (1 - wx) + d * wx) * wy;
      }
    }
  }
  return out;
};

const toChw = (
  rgb: Float32Array,
  w: number,
  h: number,
  norm: (v: number, c: number) => number,
  padW = w,
): Float32Array => {
  const out = new Float32Array(3 * h * padW);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[c * h * padW + y * padW + x] = norm(rgb[(y * w + x) * 3 + c], c);
      }
    }
  }
  return out;
};

type CurvedBox = {
  minX: number;
  maxX: number;
  medH: number;
  /** Smoothed vertical centre `yc[x - minX]` in `det` grid coordinates. */
  yc: Float32Array;
};

/** DB post-process: threshold, connected components, per-column centreline & thickness. */
const detCurvedBoxes = (prob: ArrayLike<number>, w: number, h: number): CurvedBox[] => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = prob[i] > DET_THRESH ? 1 : 0;
  const labels = new Int32Array(w * h);
  const out: CurvedBox[] = [];
  const stack: number[] = [];
  const colYSum = new Float64Array(w);
  const colYCnt = new Int32Array(w);
  let next = 0;

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    next += 1;
    labels[i] = next;
    stack.push(i);
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let sum = 0;

    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      area += 1;
      sum += prob[p];
      colYSum[px] += py;
      colYCnt[px] += 1;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= w * h) continue;
        if ((k === 0 && px === 0) || (k === 1 && px === w - 1)) continue;
        if (mask[q] && !labels[q]) {
          labels[q] = next;
          stack.push(q);
        }
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (Math.min(bw, bh) < 3 || area < 10 || sum / area < DET_BOX_THRESH) {
      for (let x = minX; x <= maxX; x++) {
        colYSum[x] = 0;
        colYCnt[x] = 0;
      }
      continue;
    }

    const heights: number[] = [];
    for (let x = minX; x <= maxX; x++) {
      if (colYCnt[x] > 0) heights.push(colYCnt[x]);
    }
    heights.sort((a, b) => a - b);
    const medH = Math.max(4, heights[heights.length >> 1] || 4);

    const yc = new Float32Array(bw);
    const win = Math.max(6, Math.round(medH));
    for (let x = minX; x <= maxX; x++) {
      let s = 0;
      let c = 0;
      const lo = Math.max(minX, x - win);
      const hi = Math.min(maxX, x + win);
      for (let k = lo; k <= hi; k++) {
        if (colYCnt[k]) {
          s += colYSum[k];
          c += colYCnt[k];
        }
      }
      yc[x - minX] = c ? s / c : (minY + maxY) / 2;
    }

    for (let x = minX; x <= maxX; x++) {
      colYSum[x] = 0;
      colYCnt[x] = 0;
    }

    out.push({ minX, maxX, medH, yc });
  }
  return out;
};

/** Sample a curved text line along `c.yc` into a flat CHW tensor (`3 × REC_H × padW`). */
const sampleWarpedLineChw = (
  recImg: Rgba,
  c: CurvedBox,
  kx: number,
  ky: number,
  tw: number,
  padW: number,
): Float32Array => {
  const out = new Float32Array(3 * REC_H * padW);
  const { data, width: rW, height: rH } = recImg;
  const padL = c.medH * 2.2;
  const padR = c.medH * 1.8;
  const topH = c.medH * 1.6;
  const botH = c.medH * 1.4;
  const bw = c.maxX - c.minX + 1 + padL + padR;
  const bh = topH + botH;

  for (let u = 0; u < tw; u++) {
    const dx = c.minX - padL + ((u + 0.5) * bw) / tw;
    const clampedX = Math.max(c.minX, Math.min(c.maxX, Math.round(dx)));
    const centerY = c.yc[clampedX - c.minX];
    const rx = dx * kx;
    const x0 = Math.max(0, Math.min(rW - 1, Math.floor(rx)));
    const x1 = Math.min(rW - 1, x0 + 1);
    const wx = Math.max(0, Math.min(1, rx - x0));

    for (let v = 0; v < REC_H; v++) {
      const dy = centerY - topH + ((v + 0.5) * bh) / REC_H;
      const ry = dy * ky;
      const y0 = Math.max(0, Math.min(rH - 1, Math.floor(ry)));
      const y1 = Math.min(rH - 1, y0 + 1);
      const wy = Math.max(0, Math.min(1, ry - y0));

      const i00 = (y0 * rW + x0) * 4;
      const i10 = (y0 * rW + x1) * 4;
      const i01 = (y1 * rW + x0) * 4;
      const i11 = (y1 * rW + x1) * 4;

      for (let ch = 0; ch < 3; ch++) {
        const val =
          (data[i00 + ch] * (1 - wx) + data[i10 + ch] * wx) * (1 - wy) +
          (data[i01 + ch] * (1 - wx) + data[i11 + ch] * wx) * wy;
        out[ch * REC_H * padW + v * padW + u] = val / 255 / 0.5 - 1;
      }
    }
  }
  return out;
};

const SOFT_TOKEN_RE = /^[ ;,.:?!¡¿«»<>-]$/;

const ctcDecode = (
  data: ArrayLike<number>,
  steps: number,
  classes: number,
  offset: number,
  chars: string[],
  groups: DiacriticGroup[],
  spaceIdxA: number,
  spaceIdxB: number,
): { text: string; score: number } => {
  let text = '';
  let last = -1;
  let scoreSum = 0;
  let n = 0;
  const probs = new Float32Array(classes);

  for (let t = 0; t < steps; t++) {
    const base = offset + t * classes;
    for (let c = 0; c < classes; c++) probs[c] = data[base + c];

    // Pool diacritic equivalence classes (`{á, à, â, ä, ã}` → `á`) so split
    // probability mass across foreign accents never loses to plain `a`.
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      let s = 0;
      for (let k = 0; k < grp.idxs.length; k++) {
        const idx = grp.idxs[k];
        s += probs[idx];
        probs[idx] = 0;
      }
      probs[grp.canonIdx] = s;
    }

    if (spaceIdxA > 0 && spaceIdxB > 0 && spaceIdxA !== spaceIdxB) {
      probs[spaceIdxB] += probs[spaceIdxA];
      probs[spaceIdxA] = 0;
    }

    let bestNonBlank = 1;
    let bestNonBlankP = -Infinity;
    for (let c = 1; c < classes; c++) {
      if (probs[c] > bestNonBlankP) {
        bestNonBlankP = probs[c];
        bestNonBlank = c;
      }
    }

    const pBlank = probs[0];
    const ch = chars[bestNonBlank] ?? '';
    const isSoft = SOFT_TOKEN_RE.test(ch);
    const best = pBlank < (isSoft ? 0.68 : 0.52) ? bestNonBlank : 0;

    if (best !== 0 && best !== last) {
      text += chars[best] ?? '';
      scoreSum += bestNonBlankP;
      n += 1;
    }
    last = best;
  }
  return { text, score: n ? scoreSum / n : 0 };
};

export async function runPaddleOcr(
  img: Rgba,
  models: PaddleModels,
  /** A sharper copy of the same photo to read the lines from (boxes stay in `img` px). */
  recImg: Rgba = img,
): Promise<OcrLine[]> {
  const { ort, det, rec, dict } = models;
  const scale = Math.min(1, DET_MAX_SIDE / Math.max(img.width, img.height));
  const dw = Math.max(32, Math.round((img.width * scale) / 32) * 32);
  const dh = Math.max(32, Math.round((img.height * scale) / 32) * 32);
  const rgb = sampleRgb(img, 0, 0, img.width, img.height, dw, dh);
  const detInput = toChw(rgb, dw, dh, (v, c) => (v / 255 - MEAN[c]) / STD[c]);
  const detOut = await det.run({
    [det.inputNames[0]]: new ort.Tensor('float32', detInput, [1, 3, dh, dw]),
  });
  const prob = detOut[det.outputNames[0]];
  const curved = detCurvedBoxes(prob.data, dw, dh);

  const chars = ['', ...dict, ' '];
  const groups = buildDiacriticGroups(chars);
  const spaceIdxA = chars.indexOf(' ', 1);
  const spaceIdxB = chars.length - 1;

  const sx = img.width / dw;
  const sy = img.height / dh;
  const kx = recImg.width / dw;
  const ky = recImg.height / dh;

  const items = curved
    .map(c => {
      const padL = c.medH * 2.2;
      const padR = c.medH * 1.8;
      const topH = c.medH * 1.6;
      const botH = c.medH * 1.4;
      const bw = c.maxX - c.minX + 1 + padL + padR;
      const bh = topH + botH;
      const midY = c.yc[c.yc.length >> 1];
      const yLeft = c.yc[0] * sy;
      const yRight = c.yc[c.yc.length - 1] * sy;
      const x1 = Math.max(0, (c.minX - padL * 0.6) * sx);
      const x2 = Math.min(img.width - 1, (c.maxX + padR * 0.6) * sx);
      const y1 = Math.max(0, (midY - topH * 0.85) * sy);
      const y2 = Math.min(img.height - 1, (midY + botH * 0.85) * sy);
      const ratio = (bw * kx) / (bh * ky);
      return { c, x1, y1, x2, y2, yLeft, yRight, ratio };
    })
    .filter(item => item.x2 - item.x1 >= 4 && item.y2 - item.y1 >= 4)
    .sort((a, b) => a.ratio - b.ratio);

  const lines: OcrLine[] = [];

  for (let s = 0; s < items.length; s += REC_BATCH) {
    const batch = items.slice(s, s + REC_BATCH);
    const maxRatio = batch[batch.length - 1].ratio;
    const padW = Math.min(REC_MAX_W, Math.max(32, Math.ceil(REC_H * maxRatio)));
    const input = new Float32Array(batch.length * 3 * REC_H * padW);

    batch.forEach((item, k) => {
      const tw = Math.min(padW, Math.max(1, Math.ceil(REC_H * item.ratio)));
      const chw = sampleWarpedLineChw(recImg, item.c, kx, ky, tw, padW);
      input.set(chw, k * 3 * REC_H * padW);
    });

    const out = await rec.run({
      [rec.inputNames[0]]: new ort.Tensor('float32', input, [batch.length, 3, REC_H, padW]),
    });
    const t = out[rec.outputNames[0]];
    const [, steps, classes] = t.dims as number[];

    batch.forEach((item, k) => {
      const { text, score } = ctcDecode(
        t.data,
        steps,
        classes,
        k * steps * classes,
        chars,
        groups,
        spaceIdxA,
        spaceIdxB,
      );
      const clean = text.trim();
      if (clean && score >= 0.42) {
        lines.push({
          x1: item.x1,
          y1: item.y1,
          x2: item.x2,
          y2: item.y2,
          yLeft: item.yLeft,
          yRight: item.yRight,
          text: clean,
          score,
        });
      }
    });
  }

  return lines.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}
