import { create } from 'zustand';

import { PDF_FORMAT_IDS, type PdfFormatId } from '../lib/pdfExport';
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
  pdfFormat: PdfFormatId;
};

const DEFAULT_SETTINGS: StoredReaderSettings = {
  theme: null,
  pageTurn: 'slide',
  pageWidth: 'standard',
  scaleIndex: DEFAULT_TEXT_SCALE_INDEX,
  pdfFormat: 'a5',
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
    const pdfFormat =
      typeof parsed.pdfFormat === 'string' &&
      (PDF_FORMAT_IDS as readonly string[]).includes(parsed.pdfFormat)
        ? (parsed.pdfFormat as PdfFormatId)
        : 'a5';

    return { theme, pageTurn, pageWidth, scaleIndex, pdfFormat };
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
  setPdfFormat: (pdfFormat: PdfFormatId) => void;
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
        pdfFormat: get().pdfFormat,
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
        pdfFormat: get().pdfFormat,
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
        pdfFormat: get().pdfFormat,
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
        pdfFormat: get().pdfFormat,
      };
      persist(next);
      set({ scaleIndex: clamped });
    },
    setPdfFormat: pdfFormat => {
      const next = {
        theme: get().theme,
        pageTurn: get().pageTurn,
        pageWidth: get().pageWidth,
        scaleIndex: get().scaleIndex,
        pdfFormat,
      };
      persist(next);
      set({ pdfFormat });
    },
  }),
);
