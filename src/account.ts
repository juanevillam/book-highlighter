import {
  deleteUser,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';

import {
  BODIES_SUBCOLLECTION,
  BOOKS_SUBCOLLECTION,
  requireAuth,
  requireDb,
  TROPHIES_SUBCOLLECTION,
  USERS_COLLECTION,
} from './firebase';
import { clearCoverPalettes } from './lib/coverPalette';
import { cleanupMyMedia, destroyAsset, uploadImage } from './media';
import { useBodiesStore } from './store/bodies';
import { blockTrophySync } from './trophies';

export const MIN_NAME_LENGTH = 2;

const requireUser = () => {
  const user = requireAuth().currentUser;
  if (!user) throw new Error('Not signed in');
  return user;
};

const ownDoc = (uid: string) => doc(requireDb(), USERS_COLLECTION, uid);

let cachedMemberSince: { uid: string; value: number | null } | null = null;

export const peekMemberSince = (uid: string): number | null | undefined =>
  cachedMemberSince?.uid === uid ? cachedMemberSince.value : undefined;

export const forgetMemberSince = () => {
  cachedMemberSince = null;
};

export const readMemberSince = async (): Promise<number | null> => {
  const uid = requireUser().uid;
  if (cachedMemberSince?.uid === uid) return cachedMemberSince.value;
  const data = (await getDoc(ownDoc(uid))).data();
  const value = data?.createdAt
    ? (data.createdAt as Timestamp).toMillis()
    : null;
  cachedMemberSince = { uid, value };
  return value;
};

export const setOwnName = async (name: string) => {
  const user = requireUser();

  await updateProfile(user, { displayName: name });
  await setDoc(
    ownDoc(user.uid),
    { displayName: name, updatedAt: serverTimestamp() },
    { merge: true },
  );
};

export const setOwnPhoto = async (file: Blob | null) => {
  const user = requireUser();
  const ref = ownDoc(user.uid);
  const previous = (await getDoc(ref)).data()?.photoPublicId as
    | string
    | undefined;
  const asset = file ? await uploadImage(file, 'profiles') : null;

  await updateProfile(user, { photoURL: asset?.url ?? '' });
  await setDoc(
    ref,
    {
      photoURL: asset?.url ?? null,
      photoPublicId: asset?.publicId ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  if (previous && previous !== asset?.publicId) {
    void destroyAsset(previous, 'image');
  }
};

export class ReauthCancelled extends Error {
  constructor() {
    super('reauth-cancelled');
    this.name = 'ReauthCancelled';
  }
}

const sweep = async (uid: string) => {
  const firestore = requireDb();

  for (const sub of [
    BODIES_SUBCOLLECTION,
    BOOKS_SUBCOLLECTION,
    TROPHIES_SUBCOLLECTION,
  ]) {
    const snap = await getDocs(
      collection(firestore, USERS_COLLECTION, uid, sub),
    );
    await Promise.all(snap.docs.map(entry => deleteDoc(entry.ref)));
  }

  await deleteDoc(ownDoc(uid));
};

export const deleteAccount = async () => {
  const user = requireUser();

  try {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/user-cancelled'
    ) {
      throw new ReauthCancelled();
    }
    throw error;
  }

  blockTrophySync(true);
  try {
    await cleanupMyMedia();
    await sweep(user.uid);
    forgetMemberSince();
    clearCoverPalettes();
    useBodiesStore.getState().reset();
    await deleteUser(user);
  } catch (error) {
    blockTrophySync(false);
    throw error;
  }
};
