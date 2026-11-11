import { create } from 'zustand';

import {
  DEFAULT_TEXT_SCALE_INDEX,
  PAGE_TURNS,
  READER_THEMES,
  TEXT_SCALES,
  type PageTurn,
  type ReaderTheme,
} from '../lib/readerThemes';

const READER_SETTINGS_KEY = 'bookhighlighter.reader';

type StoredReaderSettings = {
  theme: ReaderTheme | null;
  pageTurn: PageTurn;
  scaleIndex: number;
};

const DEFAULT_SETTINGS: StoredReaderSettings = {
  theme: null,
  pageTurn: 'curl',
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
        : 'curl';
    const scaleIndex =
      typeof parsed.scaleIndex === 'number' &&
      Number.isInteger(parsed.scaleIndex) &&
      parsed.scaleIndex >= 0 &&
      parsed.scaleIndex < TEXT_SCALES.length
        ? parsed.scaleIndex
        : DEFAULT_TEXT_SCALE_INDEX;

    return { theme, pageTurn, scaleIndex };
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
  setScaleIndex: (scaleIndex: number) => void;
};

export const useReaderSettingsStore = create<ReaderSettingsState>()(
  (set, get) => ({
    ...(typeof window !== 'undefined' ? readSettings() : DEFAULT_SETTINGS),
    setReaderTheme: theme => {
      const next = {
        theme,
        pageTurn: get().pageTurn,
        scaleIndex: get().scaleIndex,
      };
      persist(next);
      set({ theme });
    },
    setPageTurn: pageTurn => {
      const next = {
        theme: get().theme,
        pageTurn,
        scaleIndex: get().scaleIndex,
      };
      persist(next);
      set({ pageTurn });
    },
    setScaleIndex: scaleIndex => {
      const clamped = Math.max(
        0,
        Math.min(TEXT_SCALES.length - 1, Math.round(scaleIndex)),
      );
      const next = {
        theme: get().theme,
        pageTurn: get().pageTurn,
        scaleIndex: clamped,
      };
      persist(next);
      set({ scaleIndex: clamped });
    },
  }),
);
