/**
 * The Firebase web app "Book Highlighter Web" (registered 2026-11-10) in
 * project `book-highlighter-juanevillam` (`us-east1`). These values are PUBLIC
 * by design: what protects the data is `firestore.rules` (owner-only), App
 * Check, and the API key's HTTP-referrer restriction in Google Cloud.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || ({} as Record<string, string | undefined>);

const projectId =
  (env.VITE_FIREBASE_PROJECT_ID ?? '').trim() || 'book-highlighter-juanevillam';

export const firebaseConfig = {
  apiKey:
    (env.VITE_FIREBASE_API_KEY ?? '').trim() ||
    'AIzaSyBAkrBWMU7XWQoGhWafUW9i6w53V5lOxJY',
  authDomain:
    (env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim() ||
    `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket:
    (env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim() ||
    `${projectId}.firebasestorage.app`,
  messagingSenderId:
    (env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim() || '56830931919',
  appId:
    (env.VITE_FIREBASE_APP_ID ?? '').trim() ||
    '1:56830931919:web:8ad55bb1f99bec6b49d8ba',
  measurementId:
    (env.VITE_FIREBASE_MEASUREMENT_ID ?? '').trim() || 'G-W9LZXTNJV8',
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
