export const parseGenres = (text: string): string[] =>
  text
    .split(/[,/]/)
    .map(genre => genre.trim().replace(/\.$/, ''))
    .filter(Boolean);

export const formatGenres = (genres: string[]): string => genres.join(', ');

export const parseYear = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^-?\d{1,4}$/.test(trimmed)) return null;

  return Number(trimmed);
};

export const parsePageRef = (text: string): string | null => {
  const tidy = text
    .trim()
    .replace(/\s*[-–—]+\s*/g, '–')
    .replace(/\s*,\s*/g, ', ');

  return tidy || null;
};

export const formatYear = (year: number, bc: (year: number) => string) =>
  year < 0 ? bc(-year) : String(year);
