import { type Genre, isGenre } from '../lib/genres';

/**
 * One small line icon per genre FAMILY, for the book stage's genre chips.
 * Families, not genres: 46 bespoke icons would be noise, and a reader
 * recognises "science" or "story" faster than a pictogram for each. Same
 * stroke as glyphs.tsx so the chips sit with the rest of the UI.
 */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

type Family =
  | 'story'
  | 'future'
  | 'magic'
  | 'mystery'
  | 'heart'
  | 'compass'
  | 'feather'
  | 'time'
  | 'idea'
  | 'spirit'
  | 'science'
  | 'mind'
  | 'tech'
  | 'money'
  | 'society'
  | 'art'
  | 'moon';

const FAMILY: Record<Genre, Family> = {
  fiction: 'story',
  'literary-fiction': 'story',
  'historical-fiction': 'time',
  'science-fiction': 'future',
  fantasy: 'magic',
  mystery: 'mystery',
  thriller: 'mystery',
  'action-adventure': 'compass',
  romance: 'heart',
  horror: 'moon',
  classics: 'story',
  'short-stories': 'story',
  poetry: 'feather',
  drama: 'story',
  'graphic-novels': 'art',
  fables: 'magic',
  biography: 'feather',
  memoir: 'feather',
  history: 'time',
  philosophy: 'idea',
  religion: 'spirit',
  essays: 'feather',
  aphorisms: 'idea',
  science: 'science',
  'popular-science': 'science',
  physics: 'science',
  astronomy: 'moon',
  biology: 'science',
  neuroscience: 'mind',
  psychology: 'mind',
  mathematics: 'science',
  technology: 'tech',
  computing: 'tech',
  futurism: 'future',
  business: 'money',
  economics: 'money',
  'personal-finance': 'money',
  leadership: 'idea',
  'self-help': 'idea',
  education: 'idea',
  politics: 'society',
  sociology: 'society',
  art: 'art',
  health: 'heart',
  travel: 'compass',
};

const PATHS: Record<Family, React.ReactNode> = {
  story: (
    <path
      d="M12 6.8C9.2 4.8 5.8 5 3.5 5.6v12.2c2.3-.5 5.7-.7 8.5 1.3 2.8-2 6.2-1.8 8.5-1.3V5.6c-2.3-.6-5.7-.8-8.5 1.2Zm0 0v12.3"
      {...stroke}
    />
  ),
  future: (
    <>
      <path
        d="M14.5 4.5c2.6-.9 4.4-.7 5-.1.6.6.8 2.4-.1 5-1 2.8-3.6 5.4-6.4 6.9l-4.3-4.3c1.5-2.8 4.1-5.4 6.8-6.5Z"
        {...stroke}
      />
      <path
        d="M8.7 12 5 12.5l2-3.3h3.4M12 15.3l-.5 3.7 3.3-2v-3.4"
        {...stroke}
      />
      <path d="M6.5 17.5 4 20" {...stroke} />
    </>
  ),
  magic: (
    <>
      <path d="M4 20 15 9" {...stroke} />
      <path
        d="M17 3.5v3M15.5 5h3M19.5 9.5v2M18.5 10.5h2M10 4v2M9 5h2"
        {...stroke}
      />
    </>
  ),
  mystery: (
    <>
      <circle cx="10.5" cy="10.5" r="6" {...stroke} />
      <path d="m15 15 5 5" {...stroke} />
    </>
  ),
  heart: (
    <path
      d="M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.5c0 5.2-7.5 9.6-7.5 9.6Z"
      {...stroke}
    />
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" {...stroke} />
    </>
  ),
  feather: (
    <>
      <path
        d="M19.5 4.5c-6 0-11 4.5-11 11v4M8.5 15.5c5 0 9.5-3.5 11-11"
        {...stroke}
      />
      <path d="M8.5 15.5h5" {...stroke} />
    </>
  ),
  time: (
    <>
      <path d="M6.5 3.5h11M6.5 20.5h11" {...stroke} />
      <path
        d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"
        {...stroke}
      />
    </>
  ),
  idea: (
    <>
      <path
        d="M9 17v-1.6c0-1-.6-1.8-1.3-2.6A5.5 5.5 0 1 1 16.3 12.8c-.7.8-1.3 1.6-1.3 2.6V17Z"
        {...stroke}
      />
      <path d="M9.5 20.5h5" {...stroke} />
    </>
  ),
  spirit: (
    <path
      d="M12 3.5c.6 4.4 2.7 6.9 7 8.5-4.3 1.6-6.4 4.1-7 8.5-.6-4.4-2.7-6.9-7-8.5 4.3-1.6 6.4-4.1 7-8.5Z"
      {...stroke}
    />
  ),
  science: (
    <>
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" {...stroke} />
      <ellipse
        cx="12"
        cy="12"
        rx="9"
        ry="3.6"
        transform="rotate(60 12 12)"
        {...stroke}
      />
      <ellipse
        cx="12"
        cy="12"
        rx="9"
        ry="3.6"
        transform="rotate(-60 12 12)"
        {...stroke}
      />
    </>
  ),
  mind: (
    <>
      <path
        d="M11.5 5.5a3 3 0 0 0-5.6 1.2 3 3 0 0 0-1.4 5 3.2 3.2 0 0 0 2 5.2 3 3 0 0 0 5 1.6V5.5Z"
        {...stroke}
      />
      <path
        d="M12.5 5.5a3 3 0 0 1 5.6 1.2 3 3 0 0 1 1.4 5 3.2 3.2 0 0 1-2 5.2 3 3 0 0 1-5 1.6"
        {...stroke}
      />
    </>
  ),
  tech: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" {...stroke} />
      <path
        d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"
        {...stroke}
      />
    </>
  ),
  money: (
    <>
      <path d="M4 19.5h16" {...stroke} />
      <path d="M6.5 16v-4M11 16V8M15.5 16v-6M20 16V5" {...stroke} />
    </>
  ),
  society: (
    <>
      <path d="M3.5 9 12 4l8.5 5h-17ZM4 19.5h16" {...stroke} />
      <path
        d="M6.5 11.5v5.5M10.5 11.5v5.5M13.5 11.5v5.5M17.5 11.5v5.5"
        {...stroke}
      />
    </>
  ),
  art: (
    <>
      <path
        d="M12 3.8a8.2 8.2 0 1 0 0 16.4c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.8-1.3-3s.9-1.8 2.2-1.8h1.7c2.1 0 3.8-1.3 3.8-3.6 0-3.5-3.7-6.3-8.2-6.3Z"
        {...stroke}
      />
      <circle cx="7.8" cy="11" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7.6" r="1" fill="currentColor" />
      <circle cx="14.8" cy="7.8" r="1" fill="currentColor" />
    </>
  ),
  moon: (
    <path
      d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z"
      {...stroke}
    />
  ),
};

export const YEAR_TINT = '#f5c451';

const TINTS: Record<Family, string> = {
  story: '#64d2ff',
  future: '#5e5ce6',
  magic: '#bf5af2',
  mystery: '#ff6961',
  heart: '#ff6482',
  compass: '#ff9f0a',
  feather: '#5ac8fa',
  time: '#e8965a',
  idea: '#ffd60a',
  spirit: '#da8fff',
  science: '#30d158',
  mind: '#a78bfa',
  tech: '#409cff',
  money: '#34d399',
  society: '#38bdf8',
  art: '#f472b6',
  moon: '#818cf8',
};

export function genreTint(genre: string): string {
  const family: Family = isGenre(genre) ? FAMILY[genre] : 'story';
  return TINTS[family];
}

export function GenreGlyph({ genre }: { genre: string }) {
  const family: Family = isGenre(genre) ? FAMILY[genre] : 'story';
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[family]}
    </svg>
  );
}

export const CalendarGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" {...stroke} />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...stroke} />
  </svg>
);
