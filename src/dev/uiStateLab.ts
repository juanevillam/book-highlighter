import { create } from 'zustand';

import { STATE_LAB } from './flags';

/**
 * DEV-ONLY LAB — pins any surface's UI branch so states (skeletons, empty
 * states, error states, and every photo/TOC scanner progress state) can be
 * stepped side by side on demand. Never active in production builds.
 */
export const UI_STATE_LAB = import.meta.env.DEV && STATE_LAB;

export type HomeState = 'live' | 'skeleton' | 'empty' | 'error';
export type ChaptersState = 'live' | 'skeleton' | 'empty' | 'scanning';
export type ChapterDetailState = 'live' | 'empty' | 'scanning';
export type ScannerState = 'live' | 'scanning';
export type ReaderLabState = 'live' | 'skeleton' | 'empty' | 'error';
export type AccountState = 'live' | 'skeleton' | 'deleting';
export type TrophiesState = 'live' | 'skeleton';

export type LabScreen =
  | 'home'
  | 'chapters'
  | 'chapter'
  | 'scanner'
  | 'reader'
  | 'account'
  | 'trophies';

type Labelled<T extends string> = { value: T; label: string; note: string };

export const HOME_STATES: readonly Labelled<HomeState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real shelf data — lab off for this screen.',
  },
  {
    value: 'skeleton',
    label: 'First-load skeleton',
    note: '6 book tile bones in the shelf grid while Firestore settles.',
  },
  {
    value: 'empty',
    label: 'Empty shelf',
    note: 'Only the New Book tile stands on the shelf.',
  },
  {
    value: 'error',
    label: 'Library error',
    note: 'Subscription failed — centered error copy.',
  },
];

export const CHAPTERS_STATES: readonly Labelled<ChaptersState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real chapters list — shows highlight count or "No highlights yet" and pp. range.',
  },
  {
    value: 'skeleton',
    label: 'Loading skeleton',
    note: 'Two bone rows in the card while the book body loads from Firestore.',
  },
  {
    value: 'empty',
    label: 'No chapters',
    note: 'Animated Index Scan tutorial SVG + primary Scan Index button.',
  },
  {
    value: 'scanning',
    label: 'Scanning Index',
    note: 'Spacious loading card with spinner, progress bar, and unified percentage.',
  },
];

export const CHAPTER_DETAIL_STATES: readonly Labelled<ChapterDetailState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real highlights for this chapter.',
  },
  {
    value: 'empty',
    label: 'No highlights',
    note: 'Empty state with How it works link + primary Upload Page Photos button.',
  },
  {
    value: 'scanning',
    label: 'Scanning Pages',
    note: 'Circular progress ring with dynamic 3-phase status legend.',
  },
];

export const SCANNER_STATES: readonly Labelled<ScannerState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real photo scanner state (animated tutorial dropzone or interactive line inspector).',
  },
  {
    value: 'scanning',
    label: 'Scanning Pages',
    note: 'Spacious loading card with spinner, progress bar, and unified percentage.',
  },
];

export const READER_STATES: readonly Labelled<ReaderLabState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real paginated book in the Kindle-style reader.',
  },
  {
    value: 'skeleton',
    label: 'Loading body',
    note: 'Book body still loading before pagination.',
  },
  {
    value: 'empty',
    label: 'Empty book',
    note: 'Book has no summary and no highlights yet.',
  },
  {
    value: 'error',
    label: 'Load error',
    note: 'Book body failed to load — error message with retry.',
  },
];

export const ACCOUNT_STATES: readonly Labelled<AccountState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real account data — lab off for this sheet.',
  },
  {
    value: 'skeleton',
    label: 'Skeleton',
    note: 'Member Since stands a redacted bone while the Firestore profile is in flight.',
  },
  {
    value: 'deleting',
    label: 'Deleting Account',
    note: 'Sealed with full-screen busy overlay while deletion runs; cannot be dismissed.',
  },
];

export const TROPHIES_STATES: readonly Labelled<TrophiesState>[] = [
  {
    value: 'live',
    label: 'Live',
    note: 'Real trophy progress — lab off for this sheet.',
  },
  {
    value: 'skeleton',
    label: 'Skeleton',
    note: 'Ring, both figures, and every trophy row caption are bones.',
  },
];

type LabStore = {
  home: HomeState;
  chapters: ChaptersState;
  chapter: ChapterDetailState;
  scanner: ScannerState;
  reader: ReaderLabState;
  account: AccountState;
  trophies: TrophiesState;
  setHome: (home: HomeState) => void;
  setChapters: (chapters: ChaptersState) => void;
  setChapter: (chapter: ChapterDetailState) => void;
  setScanner: (scanner: ScannerState) => void;
  setReader: (reader: ReaderLabState) => void;
  setAccount: (account: AccountState) => void;
  setTrophies: (trophies: TrophiesState) => void;
  resetAll: () => void;
};

export const useUiStateLab = create<LabStore>(set => ({
  home: 'live',
  chapters: 'live',
  chapter: 'live',
  scanner: 'live',
  reader: 'live',
  account: 'live',
  trophies: 'live',
  setHome: home => set({ home }),
  setChapters: chapters => set({ chapters }),
  setChapter: chapter => set({ chapter }),
  setScanner: scanner => set({ scanner }),
  setReader: reader => set({ reader }),
  setAccount: account => set({ account }),
  setTrophies: trophies => set({ trophies }),
  resetAll: () =>
    set({
      home: 'live',
      chapters: 'live',
      chapter: 'live',
      scanner: 'live',
      reader: 'live',
      account: 'live',
      trophies: 'live',
    }),
}));
