import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

import { app, auth, requireAuth, requireUid } from './auth';
import { recaptchaSiteKey } from './firebaseConfig';

export { app, auth, requireAuth, requireUid };

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

export const USERS_COLLECTION = 'users';
export const BOOKS_SUBCOLLECTION = 'books';
export const BODIES_SUBCOLLECTION = 'bodies';
export const TROPHIES_SUBCOLLECTION = 'trophies';

let initializedAppCheck: AppCheck | null = null;
if (app && recaptchaSiteKey) {
  try {
    if (import.meta.env.DEV) {
      globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN =
        import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }
    initializedAppCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.warn('App Check skipped:', error);
  }
}

export const appCheck: AppCheck | null = initializedAppCheck;

export const db: Firestore | null = app
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  : null;

export const requireDb = (): Firestore => {
  if (!db) {
    throw new Error(
      'Firestore is not configured. Set VITE_FIREBASE_API_KEY in .env.local.',
    );
  }
  return db;
};
