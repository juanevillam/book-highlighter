/**
 * Firebase Web & service endpoints for Book Highlighter (`bookhighlighter.juanevillam.com`).
 *
 * Configured via `VITE_*` environment variables (`.env.local` in dev or Pages
 * build variables in production) with clean defaults for project and service URLs.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || ({} as Record<string, string | undefined>);

const projectId = (env.VITE_FIREBASE_PROJECT_ID ?? '').trim() || 'book-highlighter';

export const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY ?? '').trim(),
  authDomain:
    (env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim() ||
    `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket:
    (env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim() ||
    `${projectId}.firebasestorage.app`,
  messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
  appId: (env.VITE_FIREBASE_APP_ID ?? '').trim(),
};

/** Whether a real Firebase Web API key has been configured yet. */
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey);

/**
 * Optional reCAPTCHA Enterprise site key for Firebase App Check.
 * When empty (before App Check is enabled on the Firebase project),
 * `initializeAppCheck` is skipped gracefully so sign-in & Firestore work immediately.
 */
export const recaptchaSiteKey = (env.VITE_RECAPTCHA_SITE_KEY ?? '').trim();

export const mediaWorkerUrl = (
  (env.VITE_MEDIA_WORKER_URL ?? '').trim() ||
  'https://book-highlighter-media-worker.juanesvillamendoza.workers.dev'
).replace(/\/+$/, '');

export const scannerBaseUrl = (
  (env.VITE_SCANNER_URL ?? '').trim() || 'http://localhost:8787'
).replace(/\/+$/, '');
