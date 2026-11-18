import { useSyncExternalStore } from 'react';

import {
  SUPPORTED_LOCALES,
  translations,
  type Locale,
} from './i18n/translations';

const LOCALE_KEY = 'bookhighlighter.locale';

const chosenLocale = (): Locale | null => {
  try {
    const saved = localStorage.getItem(LOCALE_KEY) as Locale | null;
    return saved && SUPPORTED_LOCALES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
};

const pickLocale = (): Locale => {
  if (typeof navigator === 'undefined') return 'en';
  const chosen = chosenLocale();
  if (chosen) return chosen;

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0] as Locale;
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }

  return 'en';
};

export let locale: Locale = pickLocale();

const listeners = new Set<() => void>();

export const useLocale = (): Locale =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
  );

export { SUPPORTED_LOCALES, type Locale };

export const setLocale = (next: Locale) => {
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // Private browsing: choice lasts for this session.
  }
  locale = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
  listeners.forEach(listener => listener());
};

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
}

type Tree = { readonly [key: string]: string | Tree };

export const t = (
  key: string,
  values?: Record<string, string | number>,
): string => {
  const found = key
    .split('.')
    .reduce<
      string | Tree | undefined
    >((node, part) => (typeof node === 'object' ? node[part] : undefined), translations[locale] as Tree);
  const text = typeof found === 'string' ? found : key;

  return values
    ? text.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] !== undefined ? String(values[name]) : match,
      )
    : text;
};

/** Pluralize `{ one, other }` branches like `book.chapterCount` and `home.seriesCount`. */
export const plural = (baseKey: string, count: number): string =>
  t(`${baseKey}.${count === 1 ? 'one' : 'other'}`, { count });
