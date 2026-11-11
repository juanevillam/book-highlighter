export const GENRES = [
  // Fiction
  'fiction',
  'literary-fiction',
  'historical-fiction',
  'science-fiction',
  'fantasy',
  'mystery',
  'thriller',
  'action-adventure',
  'romance',
  'horror',
  'classics',
  'short-stories',
  'poetry',
  'drama',
  'graphic-novels',
  'fables',
  // Non-fiction
  'biography',
  'memoir',
  'history',
  'philosophy',
  'religion',
  'essays',
  'aphorisms',
  'science',
  'popular-science',
  'physics',
  'astronomy',
  'biology',
  'neuroscience',
  'psychology',
  'mathematics',
  'technology',
  'computing',
  'futurism',
  'business',
  'economics',
  'personal-finance',
  'leadership',
  'self-help',
  'education',
  'politics',
  'sociology',
  'art',
  'health',
  'travel',
] as const;

export type Genre = (typeof GENRES)[number];

export const isGenre = (value: string): value is Genre =>
  (GENRES as readonly string[]).includes(value);

export const genreLabel = (
  translate: (key: string) => string,
  genre: string,
): string => (isGenre(genre) ? translate(`genres.${genre}`) : genre);
