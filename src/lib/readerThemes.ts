import { hslToHex, type CoverPalette } from './coverPalette';

export const READER_THEMES = [
  'light',
  'dark',
  'sepia',
  'paper',
  'book',
] as const;

export type ReaderTheme = (typeof READER_THEMES)[number];

export type BookOrnamentStyle =
  | 'astral'
  | 'botanical'
  | 'geometric'
  | 'classic';

export type ReaderPalette = {
  page: string;
  text: string;
  muted: string;
  dark: boolean;
  accent?: string;
  accentSecondary?: string;
  ornament?: BookOrnamentStyle;
};

const PALETTES: Record<Exclude<ReaderTheme, 'book'>, ReaderPalette> = {
  light: { page: '#FFFFFF', text: '#1C1C1E', muted: '#8A8A8E', dark: false },
  dark: { page: '#0D0D0D', text: '#F5F5F5', muted: '#A3A3A3', dark: true },
  sepia: { page: '#F3E9D2', text: '#3B2F22', muted: '#8C7A62', dark: false },
  paper: { page: '#CFCFCB', text: '#1A1A1A', muted: '#55554F', dark: false },
};

const ORNAMENT_STYLES: readonly BookOrnamentStyle[] = [
  'astral',
  'botanical',
  'geometric',
  'classic',
];

export const bookThemePalette = (
  coverPalette?: CoverPalette | null,
  scheme: 'light' | 'dark' = 'dark',
): ReaderPalette => {
  if (!coverPalette) {
    if (scheme === 'dark') {
      return {
        page: '#141210',
        text: '#F4EFE6',
        muted: '#A89F91',
        dark: true,
        accent: '#D4A359',
        accentSecondary: '#8FA882',
        ornament: 'botanical',
      };
    }
    return {
      page: '#FAF6EE',
      text: '#1C1915',
      muted: '#6E655B',
      dark: false,
      accent: '#9E6B2E',
      accentSecondary: '#5A7550',
      ornament: 'botanical',
    };
  }

  const h1 = coverPalette.start.h;
  const h2 = coverPalette.end.h;
  const bg = coverPalette.bg;
  const useDark = coverPalette.isDarkCover ?? scheme === 'dark';

  if (useDark) {
    const bgHue = bg ? bg.h : h1;
    // A black/charcoal cover (e.g. Red + Black + Gold) stays deep obsidian (`s: 6..12%, l: 6..8%`),
    // while a saturated dark cover (e.g. Red + Forest Green) takes a richer chromatic ground (`s: 20..32%, l: 9..11%`).
    const pageSat = bg
      ? Math.max(5, Math.min(34, Math.round(bg.s * 0.72)))
      : 22;
    const pageLight = bg
      ? Math.max(6, Math.min(12, Math.round(bg.l * 0.22 + 4)))
      : 9;
    return {
      page: hslToHex({ h: bgHue, s: pageSat, l: pageLight }),
      text: hslToHex({ h: h2, s: 28, l: 93 }),
      muted: hslToHex({ h: h2, s: 18, l: 64 }),
      dark: true,
      accent: hslToHex({
        h: h1,
        s: Math.max(66, Math.min(88, coverPalette.start.s)),
        l: Math.max(60, Math.min(72, coverPalette.start.l)),
      }),
      accentSecondary: hslToHex({
        h: h2,
        s: Math.max(62, Math.min(86, coverPalette.end.s)),
        l: Math.max(58, Math.min(72, coverPalette.end.l)),
      }),
      ornament: 'botanical',
    };
  }

  const lightHue = bg ? bg.h : h1;
  const lightSat = bg
    ? Math.max(16, Math.min(44, Math.round(bg.s * 0.75 + 10)))
    : 36;
  return {
    page: hslToHex({ h: lightHue, s: lightSat, l: 94 }),
    text: hslToHex({ h: h1, s: 32, l: 13 }),
    muted: hslToHex({ h: h2, s: 20, l: 41 }),
    dark: false,
    accent: hslToHex({
      h: h1,
      s: Math.max(64, Math.min(86, coverPalette.start.s)),
      l: Math.max(34, Math.min(46, coverPalette.start.l - 16)),
    }),
    accentSecondary: hslToHex({
      h: h2,
      s: Math.max(58, Math.min(82, coverPalette.end.s)),
      l: Math.max(36, Math.min(48, coverPalette.end.l - 14)),
    }),
    ornament: 'botanical',
  };
};

export const effectiveTheme = (
  chosen: ReaderTheme | null,
  scheme: 'light' | 'dark',
): ReaderTheme => chosen ?? scheme;

export const readerPalette = (
  theme: ReaderTheme,
  coverPalette?: CoverPalette | null,
  scheme: 'light' | 'dark' = 'dark',
): ReaderPalette =>
  theme === 'book' ? bookThemePalette(coverPalette, scheme) : PALETTES[theme];

export const PAGE_TURNS = ['slide', 'scroll'] as const;
export type PageTurn = (typeof PAGE_TURNS)[number];

export const PAGE_WIDTHS = ['standard', 'extended'] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];

export const TEXT_SCALES = [0.76, 0.84, 0.92, 1, 1.1, 1.22, 1.36] as const;
export const DEFAULT_TEXT_SCALE_INDEX = 3;

export const LEGACY_TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const;

export const nearestScaleIndex = (scale: number): number =>
  TEXT_SCALES.reduce(
    (best, step, index) =>
      Math.abs(step - scale) < Math.abs(TEXT_SCALES[best] - scale)
        ? index
        : best,
    0,
  );
