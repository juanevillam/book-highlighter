import { useEffect, useState } from 'react';

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

import { auth, requireAuth } from './auth';

const USERS_COLLECTION = 'users';

const SIGNED_IN_HINT_KEY = 'bookhighlighter.signedIn';

const readSignedInHint = (): boolean => {
  try {
    return localStorage.getItem(SIGNED_IN_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

const writeSignedInHint = (signedIn: boolean) => {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // Ignore blocked storage.
  }
};

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; user: User };

const upsertOwnProfile = async (user: User): Promise<void> => {
  const [{ doc, getDoc, serverTimestamp, setDoc }, { requireDb }] =
    await Promise.all([import('firebase/firestore'), import('./firebase')]);
  const ref = doc(requireDb(), USERS_COLLECTION, user.uid);
  const existing = await getDoc(ref);
  const data = existing.exists() ? existing.data() : {};
  const hasCreatedAt = data.createdAt !== undefined;
  const displayName = user.displayName;
  const photoURL = user.photoURL;

  if (
    hasCreatedAt &&
    data.displayName === displayName &&
    data.photoURL === photoURL
  ) {
    return;
  }

  await setDoc(
    ref,
    {
      displayName,
      photoURL,
      updatedAt: serverTimestamp(),
      ...(hasCreatedAt ? null : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
};

export const useSession = (): Session => {
  const [session, setSession] = useState<Session>(() =>
    auth && readSignedInHint() ? { state: 'loading' } : { state: 'signed-out' },
  );

  useEffect(() => {
    if (!auth) {
      setSession({ state: 'signed-out' });
      return;
    }

    return onAuthStateChanged(auth, user => {
      writeSignedInHint(Boolean(user));
      setSession(user ? { state: 'signed-in', user } : { state: 'signed-out' });
      if (user) {
        upsertOwnProfile(user).catch(error =>
          console.warn('upsertOwnProfile', error),
        );
      }
    });
  }, []);

  return session;
};

export const signInWithGoogle = async (): Promise<boolean> => {
  try {
    await signInWithPopup(requireAuth(), new GoogleAuthProvider());
    writeSignedInHint(true);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      return false;
    }
    throw error;
  }
};

export const signOut = async () => {
  writeSignedInHint(false);
  if (auth) await firebaseSignOut(auth);
};
