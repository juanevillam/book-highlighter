import { type TrophyConfig } from '../trophies/types';

export const TROPHY_IDS = {
  firstBook: 'first-book',
  firstCover: 'first-cover',
  firstFinish: 'first-finish',
  highlights: 'highlights',
  library: 'library',
  rereads: 'rereads',
  platinum: 'platinum',
} as const;

export const TROPHY_TITLES: Record<string, string> = {
  [TROPHY_IDS.firstBook]: 'Writer',
  [TROPHY_IDS.firstCover]: 'Binder',
  [TROPHY_IDS.firstFinish]: 'Finisher',
  [TROPHY_IDS.highlights]: 'Marker',
  [TROPHY_IDS.library]: 'Shelver',
  [TROPHY_IDS.rereads]: 'Rereader',
  [TROPHY_IDS.platinum]: 'Book Highlighter',
};

export const LIBRARY_BOOK_COUNT = 10;
export const HIGHLIGHT_COUNT = 100;
export const FINISHED_BOOK_COUNT = 10;

export const TROPHY_CONFIGS: TrophyConfig[] = [
  { id: TROPHY_IDS.platinum, tier: 'platinum' },
  { id: TROPHY_IDS.rereads, tier: 'gold' },
  { id: TROPHY_IDS.highlights, tier: 'silver' },
  { id: TROPHY_IDS.library, tier: 'silver' },
  { id: TROPHY_IDS.firstBook, tier: 'bronze' },
  { id: TROPHY_IDS.firstCover, tier: 'bronze' },
  { id: TROPHY_IDS.firstFinish, tier: 'bronze' },
];
