import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export const app: FirebaseApp | null = isFirebaseConfigured
  ? initializeApp(firebaseConfig)
  : null;

export const auth: Auth | null = app ? getAuth(app) : null;

export const requireAuth = (): Auth => {
  if (!auth) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_APP_ID in .env.local.',
    );
  }
  return auth;
};

export const requireUid = (): string => {
  const uid = requireAuth().currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  return uid;
};
