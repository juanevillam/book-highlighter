import { useSyncExternalStore } from 'react';

export const SUPPORTED_THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof SUPPORTED_THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';

const THEME_KEY = 'bookhighlighter.theme';

const darkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

const readTheme = (): Theme => {
  try {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    return saved && SUPPORTED_THEMES.includes(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

export let theme: Theme =
  typeof window !== 'undefined' ? readTheme() : DEFAULT_THEME;
export let scheme: 'light' | 'dark' = 'dark';

const listeners = new Set<() => void>();

const apply = () => {
  scheme =
    theme === 'system'
      ? (darkQuery?.matches ?? true)
        ? 'dark'
        : 'light'
      : theme;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = scheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', scheme === 'dark' ? '#0d0d0d' : '#f2f2f7');
  }
  listeners.forEach(listener => listener());
};

apply();
darkQuery?.addEventListener('change', () => {
  if (theme === 'system') apply();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useTheme = (): Theme =>
  useSyncExternalStore(subscribe, () => theme);

export const useScheme = (): 'light' | 'dark' =>
  useSyncExternalStore(subscribe, () => scheme);

export const setTheme = (next: Theme) => {
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private browsing: choice lasts for this session.
  }
  theme = next;
  apply();
};
