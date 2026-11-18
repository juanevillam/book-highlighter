/**
 * Photos of a page held in a hand are rarely square to the camera, and the
 * text detector boxes lines axis-aligned: a page turned 3° makes every box
 * swallow half of the line above and below. So the photo is turned level
 * first, by the angle that makes its rows of ink line up best.
 */
import { type Rgba } from './paddle';

const SAMPLE_W = 600;

export function estimateSkew(img: Rgba, maxDeg = 8, stepDeg = 0.25): number {
  const scale = Math.min(1, SAMPLE_W / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  // Dark, low-saturation pixels: print. Sticky flags and fabric stay out.
  const pts: number[] = [];
  let sum = 0;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4;
      const v =
        0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
      gray[y * w + x] = v;
      sum += v;
    }
  }
  const mean = sum / (w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 4; x < w - 4; x++) {
      const v = gray[y * w + x];
      if (v > 130) continue;
      // Ink sits ON paper: a bright pixel within a few px on both sides.
      // Dark fabric, shadows and the cover never have that.
      let left = 0;
      let right = 0;
      for (let k = 1; k <= 4; k++) {
        left = Math.max(left, gray[y * w + x - k]);
        right = Math.max(right, gray[y * w + x + k]);
      }
      if (left > 175 && right > 175) pts.push(x, y);
    }
  }
  void mean;
  if (pts.length < 200) return 0;
  let best = 0;
  let bestScore = -Infinity;
  const cx = w / 2;
  const cy = h / 2;
  const bins = new Float32Array(h * 2);
  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += stepDeg) {
    const t = (deg * Math.PI) / 180;
    const s = Math.sin(t);
    const c = Math.cos(t);
    bins.fill(0);
    for (let i = 0; i < pts.length; i += 2) {
      const yr = -(pts[i] - cx) * s + (pts[i + 1] - cy) * c + h;
      const b = Math.round(yr);
      if (b >= 0 && b < bins.length) bins[b] += 1;
    }
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }
  return best;
}

/** Rotate by `deg` (positive = counter-clockwise content correction), same size, white fill. */
export function rotateRgba(img: Rgba, deg: number): Rgba {
  if (Math.abs(deg) < 0.2) return img;
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const t = (deg * Math.PI) / 180;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = c * dx - s * dy + cx;
      const sy = s * dx + c * dy + cy;
      const o = (y * w + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] =
          (data[i00 + k] * (1 - fx) + data[i10 + k] * fx) * (1 - fy) +
          (data[i01 + k] * (1 - fx) + data[i11 + k] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Rotate 90° clockwise (`width × height` → `height × width`) when a top-down photo was tagged landscape. */
export function rotate90Cw(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = (x * h + (h - 1 - y)) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }
  return { data: out, width: h, height: w };
}

/** Rotate 90° counter-clockwise (`width × height` → `height × width`). */
export function rotate90Ccw(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = ((w - 1 - x) * h + y) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }
  return { data: out, width: h, height: w };
}

/** Rotate 180° (`width × height` → `width × height`) when a photo arrived upside-down. */
export function rotate180(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = ((h - 1 - y) * w + (w - 1 - x)) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }
  return { data: out, width: w, height: h };
}
