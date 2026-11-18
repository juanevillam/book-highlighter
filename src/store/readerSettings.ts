import { create } from 'zustand';

import {
  DEFAULT_TEXT_SCALE_INDEX,
  PAGE_TURNS,
  PAGE_WIDTHS,
  READER_THEMES,
  TEXT_SCALES,
  type PageTurn,
  type PageWidth,
  type ReaderTheme,
} from '../lib/readerThemes';

const READER_SETTINGS_KEY = 'bookhighlighter.reader';

type StoredReaderSettings = {
  theme: ReaderTheme | null;
  pageTurn: PageTurn;
  pageWidth: PageWidth;
  scaleIndex: number;
};

const DEFAULT_SETTINGS: StoredReaderSettings = {
  theme: null,
  pageTurn: 'slide',
  pageWidth: 'standard',
  scaleIndex: DEFAULT_TEXT_SCALE_INDEX,
};

const readSettings = (): StoredReaderSettings => {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StoredReaderSettings>;
    const theme =
      parsed.theme === null ||
      (typeof parsed.theme === 'string' &&
        (READER_THEMES as readonly string[]).includes(parsed.theme))
        ? (parsed.theme as ReaderTheme | null)
        : null;
    const pageTurn =
      typeof parsed.pageTurn === 'string' &&
      (PAGE_TURNS as readonly string[]).includes(parsed.pageTurn)
        ? (parsed.pageTurn as PageTurn)
        : 'slide';
    const pageWidth =
      typeof parsed.pageWidth === 'string' &&
      (PAGE_WIDTHS as readonly string[]).includes(parsed.pageWidth)
        ? (parsed.pageWidth as PageWidth)
        : 'standard';
    const scaleIndex =
      typeof parsed.scaleIndex === 'number' &&
      Number.isInteger(parsed.scaleIndex) &&
      parsed.scaleIndex >= 0 &&
      parsed.scaleIndex < TEXT_SCALES.length
        ? parsed.scaleIndex
        : DEFAULT_TEXT_SCALE_INDEX;

    return { theme, pageTurn, pageWidth, scaleIndex };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const persist = (settings: StoredReaderSettings) => {
  try {
    localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors.
  }
};

type ReaderSettingsState = StoredReaderSettings & {
  setReaderTheme: (theme: ReaderTheme | null) => void;
  setPageTurn: (pageTurn: PageTurn) => void;
  setPageWidth: (pageWidth: PageWidth) => void;
  setScaleIndex: (scaleIndex: number) => void;
};

export const useReaderSettingsStore = create<ReaderSettingsState>()(
  (set, get) => ({
    ...(typeof window !== 'undefined' ? readSettings() : DEFAULT_SETTINGS),
    setReaderTheme: theme => {
      const next = {
        theme,
        pageTurn: get().pageTurn,
        pageWidth: get().pageWidth,
        scaleIndex: get().scaleIndex,
      };
      persist(next);
      set({ theme });
    },
    setPageTurn: pageTurn => {
      const next = {
        theme: get().theme,
        pageTurn,
        pageWidth: get().pageWidth,
        scaleIndex: get().scaleIndex,
      };
      persist(next);
      set({ pageTurn });
    },
    setPageWidth: pageWidth => {
      const next = {
        theme: get().theme,
        pageTurn: get().pageTurn,
        pageWidth,
        scaleIndex: get().scaleIndex,
      };
      persist(next);
      set({ pageWidth });
    },
    setScaleIndex: scaleIndex => {
      const clamped = Math.max(
        0,
        Math.min(TEXT_SCALES.length - 1, Math.round(scaleIndex)),
      );
      const next = {
        theme: get().theme,
        pageTurn: get().pageTurn,
        pageWidth: get().pageWidth,
        scaleIndex: clamped,
      };
      persist(next);
      set({ scaleIndex: clamped });
    },
  }),
);
