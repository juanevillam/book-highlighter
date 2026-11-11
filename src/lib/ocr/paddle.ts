/**
 * PaddleOCR (PP-OCR det + rec) on ONNX Runtime, free and on-device.
 *
 * Runtime-agnostic on purpose: the caller hands in an RGBA image and the two
 * sessions (onnxruntime-web in the browser worker, onnxruntime-node in the
 * evaluation script), so the exact same pipeline is what gets measured and
 * what ships.
 */

export type Rgba = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type OcrLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
const DET_UNCLIP = 1.2;
const REC_H = 48;
const REC_MAX_W = 960;
const REC_BATCH = 8;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

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

type Box = { x1: number; y1: number; x2: number; y2: number };

/** DB post-process: threshold, connected components, score, unclip. */
const detBoxes = (prob: ArrayLike<number>, w: number, h: number): Box[] => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = prob[i] > DET_THRESH ? 1 : 0;
  const labels = new Int32Array(w * h);
  const boxes: Box[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    next += 1;
    labels[i] = next;
    stack.push(i);
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0, sum = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      area += 1;
      sum += prob[p];
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
    if (Math.min(bw, bh) < 3 || area < 10) continue;
    if (sum / area < DET_BOX_THRESH) continue;
    const perim = 2 * (bw + bh);
    const d = (bw * bh * DET_UNCLIP) / perim;
    boxes.push({
      x1: Math.max(0, minX - d),
      y1: Math.max(0, minY - d),
      x2: Math.min(w - 1, maxX + d),
      y2: Math.min(h - 1, maxY + d),
    });
  }
  return boxes;
};

const ctcDecode = (
  data: ArrayLike<number>,
  steps: number,
  classes: number,
  offset: number,
  chars: string[],
): { text: string; score: number } => {
  let text = '';
  let last = -1;
  let scoreSum = 0;
  let n = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -Infinity;
    const base = offset + t * classes;
    for (let c = 0; c < classes; c++) {
      const p = data[base + c];
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    if (best !== 0 && best !== last) {
      text += chars[best] ?? '';
      scoreSum += bestP;
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
  const boxes = detBoxes(prob.data, dw, dh)
    .map(b => ({
      x1: (b.x1 * img.width) / dw,
      y1: (b.y1 * img.height) / dh,
      x2: (b.x2 * img.width) / dw,
      y2: (b.y2 * img.height) / dh,
    }))
    .filter(b => b.x2 - b.x1 >= 4 && b.y2 - b.y1 >= 4);

  const chars = ['', ...dict, ' '];
  const lines: OcrLine[] = [];
  const order = boxes
    .map((b, i) => ({ b, i, ratio: (b.x2 - b.x1) / (b.y2 - b.y1) }))
    .sort((a, b) => a.ratio - b.ratio);

  for (let s = 0; s < order.length; s += REC_BATCH) {
    const batch = order.slice(s, s + REC_BATCH);
    const maxRatio = batch[batch.length - 1].ratio;
    const padW = Math.min(REC_MAX_W, Math.max(32, Math.ceil(REC_H * maxRatio)));
    const input = new Float32Array(batch.length * 3 * REC_H * padW);
    const k2 = recImg.width / img.width;
    batch.forEach(({ b }, k) => {
      const bw = b.x2 - b.x1;
      const bh = b.y2 - b.y1;
      const tw = Math.min(padW, Math.max(1, Math.ceil((REC_H * bw) / bh)));
      const crop = sampleRgb(recImg, b.x1 * k2, b.y1 * k2, bw * k2, bh * k2, tw, REC_H);
      const chw = toChw(crop, tw, REC_H, v => v / 255 / 0.5 - 1, padW);
      input.set(chw, k * 3 * REC_H * padW);
    });
    const out = await rec.run({
      [rec.inputNames[0]]: new ort.Tensor('float32', input, [batch.length, 3, REC_H, padW]),
    });
    const t = out[rec.outputNames[0]];
    const [, steps, classes] = t.dims as number[];
    batch.forEach(({ b }, k) => {
      const { text, score } = ctcDecode(t.data, steps, classes, k * steps * classes, chars);
      const clean = text.trim();
      if (clean && score >= 0.5) lines.push({ ...b, text: clean, score });
    });
  }

  return lines.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}
