export const READER_THEMES = ['light', 'dark', 'sepia', 'paper'] as const;

export type ReaderTheme = (typeof READER_THEMES)[number];

export type ReaderPalette = {
  page: string;
  text: string;
  muted: string;
  dark: boolean;
};

const PALETTES: Record<ReaderTheme, ReaderPalette> = {
  light: { page: '#FFFFFF', text: '#1C1C1E', muted: '#8A8A8E', dark: false },
  dark: { page: '#000000', text: '#E5E5EA', muted: '#8E8E93', dark: true },
  sepia: { page: '#F3E9D2', text: '#3B2F22', muted: '#8C7A62', dark: false },
  paper: { page: '#CFCFCB', text: '#1A1A1A', muted: '#55554F', dark: false },
};

export const effectiveTheme = (
  chosen: ReaderTheme | null,
  scheme: 'light' | 'dark',
): ReaderTheme => chosen ?? scheme;

export const readerPalette = (theme: ReaderTheme): ReaderPalette =>
  PALETTES[theme];

export const PAGE_TURNS = ['curl', 'slide', 'scroll'] as const;
export type PageTurn = (typeof PAGE_TURNS)[number];

export const TEXT_SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2] as const;
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
