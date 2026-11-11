type RelativeTimeOptions = {
  now: string;
  locale: string;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const formatRelativeTime = (
  ms: number | null,
  { now, locale }: RelativeTimeOptions,
): string => {
  if (!ms) return '';

  const diff = Date.now() - ms;

  if (diff < MINUTE) return now;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < 5 * WEEK) return `${Math.floor(diff / WEEK)}w`;

  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();

  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};
