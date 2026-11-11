import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from 'firebase/analytics';

import { app } from './auth';

/**
 * Google Analytics for Firebase — counts which parts of Book Highlighter are
 * used, never who used them (`docs/telemetry-and-abuse.md`).
 *
 * No `setUserId`, no book titles, authors, or highlight text — only fixed event
 * names and screen names. Every call is fire-and-forget.
 */
export type AppEvent =
  | { name: 'add_book' }
  | { name: 'scan_book' }
  | { name: 'open_reader' }
  | { name: 'save_highlights' }
  | { name: 'export_pdf' }
  | { name: 'trophy_unlocked'; trophyId: string };

let analyticsPromise: Promise<Analytics | null> | null = null;

const resolveAnalytics = (): Promise<Analytics | null> => {
  if (!app || typeof window === 'undefined') return Promise.resolve(null);
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then(ok => (ok && app ? getAnalytics(app) : null))
      .catch(() => null);
  }
  return analyticsPromise;
};

export const track = (event: AppEvent): void => {
  void resolveAnalytics().then(instance => {
    if (!instance) return;
    try {
      logEvent(
        instance,
        event.name,
        'trophyId' in event ? { trophy_id: event.trophyId } : undefined,
      );
    } catch {
      // Never let analytics surface an error.
    }
  });
};

export const trackScreen = (screenName: string): void => {
  void resolveAnalytics().then(instance => {
    if (!instance) return;
    try {
      logEvent(instance, 'screen_view', {
        firebase_screen: screenName,
        firebase_screen_class: screenName,
      });
    } catch {
      // As above.
    }
  });
};
