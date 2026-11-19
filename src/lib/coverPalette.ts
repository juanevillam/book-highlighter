import { useEffect, useState } from 'react';

export type HslColor = {
  /** Hue in degrees [0, 360) */
  h: number;
  /** Saturation in percent [0, 100] */
  s: number;
  /** Lightness in percent [0, 100] */
  l: number;
};

export type CoverPalette = {
  start: HslColor;
  mid: HslColor;
  end: HslColor;
  bg?: HslColor;
  startCss: string;
  midCss: string;
  endCss: string;
  startInk: '#0d0d0d' | '#ffffff';
  endInk: '#0d0d0d' | '#ffffff';
  /** True when the book cover's overall brightness is dark (< ~52%), false when light. */
  isDarkCover?: boolean;
};

const DEFAULT_START: HslColor = { h: 142, s: 78, l: 56 }; // Emerald green
const DEFAULT_END: HslColor = { h: 248, s: 86, l: 72 }; // Luminous indigo

const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

const shortestHueDelta = (fromH: number, toH: number): number => {
  const diff = ((toH - fromH + 540) % 360) - 180;
  return Math.abs(diff) < 16 ? (diff >= 0 ? 28 : -28) : diff;
};

/**
 * Clamps a raw HSL color into a luminous highlighter band that always reads
 * clearly over both dark UI surfaces (`#0d0d0d` / `#161616`) and light book
 * paper (`#f6f2e8`).
 */
export function normalizeHighlighterHsl(raw: HslColor): HslColor {
  const h = wrapHue(raw.h);
  const s = Math.max(74, Math.min(92, Math.round(raw.s)));
  // Deep blues/violets (215°–285°) need slightly higher lightness to match
  // the perceived brightness of greens/cyans/warm hues on dark & light backgrounds.
  const isDeepCool = h >= 215 && h <= 285;
  const minL = isDeepCool ? 66 : 54;
  const maxL = isDeepCool ? 74 : 64;
  const l = Math.max(minL, Math.min(maxL, Math.round(raw.l)));
  return { h, s, l };
}

export function hslToCss(c: HslColor, alpha?: number): string {
  const h = Math.round(wrapHue(c.h));
  const s = Math.round(c.s);
  const l = Math.round(c.l);
  return alpha !== undefined
    ? `hsl(${h} ${s}% ${l}% / ${alpha})`
    : `hsl(${h} ${s}% ${l}%)`;
}

export function hslToHex(c: HslColor): string {
  const [r, g, b] = hslToRgb(c);
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToRgb(c: HslColor): [number, number, number] {
  const h = wrapHue(c.h) / 360;
  const s = c.s / 100;
  const l = c.l / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

/**
 * Picks dark (`#0d0d0d`) or white (`#ffffff`) badge ink for WCAG AA/AAA
 * readability over a solid `HslColor` pill.
 */
export function contrastInkForHsl(c: HslColor): '#0d0d0d' | '#ffffff' {
  const [r, g, b] = hslToRgb(c);
  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.36 ? '#0d0d0d' : '#ffffff';
}

/**
 * Interpolates smoothly between `palette.start` (`t = 0`) and `palette.end`
 * (`t = 1`) along the shortest chromatic hue arc, returning a normalized
 * highlighter color for any intermediate page or line.
 */
export function interpolatePaletteColor(
  palette: CoverPalette,
  t: number,
): HslColor {
  const clamped = Math.max(0, Math.min(1, t));
  const deltaH = shortestHueDelta(palette.start.h, palette.end.h);
  return normalizeHighlighterHsl({
    h: wrapHue(palette.start.h + deltaH * clamped),
    s: palette.start.s + (palette.end.s - palette.start.s) * clamped,
    l: palette.start.l + (palette.end.l - palette.start.l) * clamped,
  });
}

export function buildCoverPalette(
  rawStart: HslColor,
  rawEnd: HslColor,
  isDarkCover?: boolean,
  bg?: HslColor,
): CoverPalette {
  const start = normalizeHighlighterHsl(rawStart);
  const delta = shortestHueDelta(start.h, rawEnd.h);
  const end = normalizeHighlighterHsl({
    h: wrapHue(start.h + delta),
    s: rawEnd.s,
    l: rawEnd.l,
  });
  const mid = normalizeHighlighterHsl({
    h: wrapHue(start.h + delta * 0.5),
    s: (start.s + end.s) / 2,
    l: (start.l + end.l) / 2,
  });

  return {
    start,
    mid,
    end,
    ...(bg ? { bg } : {}),
    startCss: hslToCss(start),
    midCss: hslToCss(mid),
    endCss: hslToCss(end),
    startInk: contrastInkForHsl(start),
    endInk: contrastInkForHsl(end),
    ...(isDarkCover !== undefined ? { isDarkCover } : {}),
  };
}

export const DEFAULT_COVER_PALETTE: CoverPalette = buildCoverPalette(
  DEFAULT_START,
  DEFAULT_END,
);

/**
 * Deterministic fallback palette seeded from a book's id/title when the book
 * has no cover image or the cover host blocks CORS pixel reads.
 */
export function fallbackPaletteForSeed(seed: string): CoverPalette {
  if (!seed) return DEFAULT_COVER_PALETTE;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const h1 = wrapHue(Math.abs(hash) % 360);
  const h2 = wrapHue(h1 + 88 + (Math.abs(hash >> 8) % 56));
  return buildCoverPalette({ h: h1, s: 82, l: 58 }, { h: h2, s: 84, l: 64 });
}

/**
 * Extracts the two most prominent, distinct chromatic hues from an RGBA pixel
 * buffer (12 hue buckets of 30° each) and builds a high-contrast `CoverPalette`.
 */
export function extractPaletteFromRgba(
  data: Uint8ClampedArray | number[],
  fallbackSeed = '',
): CoverPalette {
  const BUCKET_COUNT = 18;
  const BUCKET_DEG = 360 / BUCKET_COUNT;
  const buckets = Array.from({ length: BUCKET_COUNT }, (_, idx) => ({
    idx,
    weight: 0,
    sumX: 0,
    sumY: 0,
    sumS: 0,
    sumL: 0,
  }));

  let lumSum = 0;
  let opaqueCount = 0;
  let bgSumX = 0;
  let bgSumY = 0;
  let bgSumS = 0;
  let bgSumL = 0;
  let bgWeight = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
    opaqueCount += 1;
    const { h, s, l } = rgbToHsl(r, g, b);

    // Track dominant field/background tone across all pixels (including dark obsidian, cream, or tinted paper)
    const bw = 1.2 - Math.min(0.6, s / 160);
    const bRad = (h * Math.PI) / 180;
    bgWeight += bw;
    bgSumX += Math.cos(bRad) * (s / 100) * bw;
    bgSumY += Math.sin(bRad) * (s / 100) * bw;
    bgSumS += s * bw;
    bgSumL += l * bw;

    // Ignore only extreme pure-black/white and neutral grays; keep gold/bronze/crimson (s >= 12, l 10..93)
    if (l < 10 || l > 93 || s < 12) continue;

    const bucketIdx = Math.floor(wrapHue(h) / BUCKET_DEG) % BUCKET_COUNT;
    const bucket = buckets[bucketIdx]!;
    const w = Math.max(0.1, thevividWeight(s, l));
    const rad = (h * Math.PI) / 180;
    bucket.weight += w;
    bucket.sumX += Math.cos(rad) * w;
    bucket.sumY += Math.sin(rad) * w;
    bucket.sumS += s * w;
    bucket.sumL += l * w;
  }

  const isDarkCover = opaqueCount > 0 ? lumSum / opaqueCount < 132 : undefined;

  const ranked = buckets
    .filter(b => b.weight > 0.35)
    .sort((a, b) => b.weight - a.weight);

  if (ranked.length === 0) {
    const fb = fallbackPaletteForSeed(fallbackSeed);
    return isDarkCover !== undefined ? { ...fb, isDarkCover } : fb;
  }

  const bucketToHsl = (b: (typeof buckets)[number]): HslColor => {
    const h = wrapHue((Math.atan2(b.sumY, b.sumX) * 180) / Math.PI);
    return {
      h,
      s: b.sumS / b.weight,
      l: b.sumL / b.weight,
    };
  };

  const first = bucketToHsl(ranked[0]!);

  // Pick the strongest secondary bucket at least 22° away so Red (~8°) + Gold (~40°) is preserved
  // instead of falling back to an artificial green shift.
  const secondBucket = ranked.find(b => {
    const cand = bucketToHsl(b);
    const dist = Math.abs(((cand.h - first.h + 540) % 360) - 180);
    return dist >= 22;
  });

  const second: HslColor = secondBucket
    ? bucketToHsl(secondBucket)
    : {
        h: wrapHue(first.h + 34),
        s: Math.max(68, first.s * 0.9),
        l: Math.min(72, first.l + 8),
      };

  const bg: HslColor | undefined =
    bgWeight > 0
      ? {
          h:
            Math.hypot(bgSumX, bgSumY) > 0.02
              ? wrapHue((Math.atan2(bgSumY, bgSumX) * 180) / Math.PI)
              : first.h,
          s: Math.round(bgSumS / bgWeight),
          l: Math.round(bgSumL / bgWeight),
        }
      : undefined;

  return buildCoverPalette(first, second, isDarkCover, bg);
}

function thevividWeight(s: number, l: number): number {
  return (s / 100) * (1 - Math.min(0.85, Math.abs(l - 52) / 55));
}

const PALETTE_STORAGE_KEY = 'bh:cover-palette:v3';
const paletteCache = new Map<string, CoverPalette>();
let storageHydrated = false;

function hydratePaletteStorage(): void {
  if (storageHydrated || typeof localStorage === 'undefined') return;
  storageHydrated = true;
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        start: HslColor;
        end: HslColor;
        isDarkCover?: boolean;
        bg?: HslColor;
      }
    >;
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry?.start && entry?.end) {
        paletteCache.set(
          key,
          buildCoverPalette(
            entry.start,
            entry.end,
            entry.isDarkCover,
            entry.bg,
          ),
        );
      }
    }
  } catch {
    // Ignore storage read errors.
  }
}

function savePaletteToStorage(key: string, palette: CoverPalette): void {
  paletteCache.set(key, palette);
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<
          string,
          {
            start: HslColor;
            end: HslColor;
            isDarkCover?: boolean;
            bg?: HslColor;
          }
        >)
      : {};
    parsed[key] = {
      start: palette.start,
      end: palette.end,
      ...(palette.isDarkCover !== undefined
        ? { isDarkCover: palette.isDarkCover }
        : {}),
      ...(palette.bg ? { bg: palette.bg } : {}),
    };
    const keys = Object.keys(parsed);
    if (keys.length > 80) {
      delete parsed[keys[0]!];
    }
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage quota errors.
  }
}

export function forgetCoverPalette(
  bookId: string,
  artUrl?: string | null,
  bookName?: string | null,
): void {
  hydratePaletteStorage();
  const keysToRemove = new Set<string>();
  const cleanUrl = (artUrl ?? '').trim();
  if (cleanUrl) keysToRemove.add(cleanUrl);
  if (bookName) keysToRemove.add(`seed:${bookId}:${bookName}`);
  const prefix = `seed:${bookId}:`;
  for (const k of paletteCache.keys()) {
    if (k.startsWith(prefix)) keysToRemove.add(k);
  }
  if (keysToRemove.size === 0) return;
  for (const k of keysToRemove) {
    paletteCache.delete(k);
  }
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;
    for (const k of keysToRemove) {
      if (k in parsed) {
        delete parsed[k];
        changed = true;
      }
    }
    for (const k of Object.keys(parsed)) {
      if (k.startsWith(prefix)) {
        delete parsed[k];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // Ignore storage errors.
  }
}

export async function loadCoverPalette(
  artUrl: string | null | undefined,
  seed: string,
): Promise<CoverPalette> {
  hydratePaletteStorage();
  const cleanUrl = (artUrl ?? '').trim();
  const cacheKey = cleanUrl || `seed:${seed}`;
  const cached = paletteCache.get(cacheKey);
  if (cached) return cached;

  if (!cleanUrl || typeof document === 'undefined') {
    const fallback = fallbackPaletteForSeed(seed);
    paletteCache.set(cacheKey, fallback);
    return fallback;
  }

  return new Promise<CoverPalette>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      try {
        const w = 36;
        const h = 54;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const fb = fallbackPaletteForSeed(seed);
          paletteCache.set(cacheKey, fb);
          resolve(fb);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const palette = extractPaletteFromRgba(data, seed);
        savePaletteToStorage(cacheKey, palette);
        if (seed) savePaletteToStorage(`seed:${seed}`, palette);
        resolve(palette);
      } catch {
        const fb = fallbackPaletteForSeed(seed);
        paletteCache.set(cacheKey, fb);
        resolve(fb);
      }
    };

    img.onerror = () => {
      const fb = fallbackPaletteForSeed(seed);
      paletteCache.set(cacheKey, fb);
      resolve(fb);
    };

    img.src = cleanUrl;
  });
}

export function useBookCoverPalette(
  artUrl: string | null | undefined,
  seed: string,
): CoverPalette {
  hydratePaletteStorage();
  const cleanUrl = (artUrl ?? '').trim();
  const cacheKey = cleanUrl || `seed:${seed}`;
  const [palette, setPalette] = useState<CoverPalette>(
    () =>
      paletteCache.get(cacheKey) ??
      paletteCache.get(`seed:${seed}`) ??
      fallbackPaletteForSeed(seed),
  );

  useEffect(() => {
    let cancelled = false;
    void loadCoverPalette(cleanUrl, seed).then(res => {
      if (!cancelled) setPalette(res);
    });
    return () => {
      cancelled = true;
    };
  }, [cleanUrl, seed]);

  return palette;
}
