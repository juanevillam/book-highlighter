import { type CoverPalette } from './coverPalette';

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
  dark: { page: '#000000', text: '#E5E5EA', muted: '#8E8E93', dark: true },
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
  _coverPalette?: CoverPalette | null,
  scheme: 'light' | 'dark' = 'dark',
): ReaderPalette => {
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
  theme === 'book'
    ? bookThemePalette(coverPalette, scheme)
    : PALETTES[theme];

export const PAGE_TURNS = ['slide', 'scroll'] as const;
export type PageTurn = (typeof PAGE_TURNS)[number];

export const TEXT_SCALES = [
  0.76, 0.84, 0.92, 1, 1.1, 1.22, 1.36,
] as const;
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
