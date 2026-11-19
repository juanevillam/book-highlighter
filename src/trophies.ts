import { useEffect } from 'react';

import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';

import { track } from './analytics';
import {
  FINISHED_BOOK_COUNT,
  HIGHLIGHT_COUNT,
  LIBRARY_BOOK_COUNT,
  TROPHY_CONFIGS,
  TROPHY_IDS,
} from './constants/trophies';
import {
  requireDb,
  TROPHIES_SUBCOLLECTION,
  USERS_COLLECTION,
} from './firebase';
import { selectShelf, useBooksStore } from './store/books';
import {
  awardTrophy,
  configureTrophies,
  resetTrophies,
  useTrophyStore,
} from './trophies/store';
import {
  type AwardedTrophy,
  type TrophyPersistenceAdapter,
} from './trophies/types';

let blocked = false;
const pendingSaves = new Set<Promise<void>>();

export const blockTrophySync = (block: boolean) => {
  blocked = block;
  if (block) pendingSaves.clear();
};

export const flushTrophies = async (): Promise<void> => {
  if (pendingSaves.size === 0) return;
  await Promise.allSettled([...pendingSaves]);
};

const adapterFor = (uid: string): TrophyPersistenceAdapter => ({
  load: async () => {
    const snapshot = await getDocs(
      collection(requireDb(), USERS_COLLECTION, uid, TROPHIES_SUBCOLLECTION),
    );
    const awarded: Record<string, AwardedTrophy> = {};
    snapshot.docs.forEach(entry => {
      const achievedAt = entry.data().achievedAt as Timestamp | undefined;
      awarded[entry.id] = { achievedAt: achievedAt?.toMillis() ?? Date.now() };
    });
    return awarded;
  },
  save: async trophyId => {
    if (blocked) return;
    const task = setDoc(
      doc(requireDb(), USERS_COLLECTION, uid, TROPHIES_SUBCOLLECTION, trophyId),
      { achievedAt: serverTimestamp() },
      { merge: true },
    ).then(() => {
      track({ name: 'trophy_unlocked', trophyId });
    });
    pendingSaves.add(task);
    try {
      await task;
    } finally {
      pendingSaves.delete(task);
    }
  },
});

/**
 * Mount once inside the signed-in app: hydrates trophies from Firestore and
 * awards all 7 objectives straight from live book state (excluding Recently Deleted).
 */
export const useTrophySystem = (uid: string) => {
  useEffect(() => {
    blocked = false;
    void configureTrophies(TROPHY_CONFIGS, adapterFor(uid));
    return () => {
      resetTrophies();
    };
  }, [uid]);

  const hydrated = useTrophyStore(state => state.hydrated);
  const books = useBooksStore(state => state.books);
  const hasSettled = useBooksStore(state => state.hasSettled);

  useEffect(() => {
    if (!hydrated || !hasSettled || blocked) return;

    const shelf = selectShelf({ books });
    const highlights = shelf.reduce(
      (sum, book) => sum + book.highlightCount,
      0,
    );
    const finished = shelf.filter(book => book.finishedAt !== null).length;

    if (shelf.length >= 1) awardTrophy(TROPHY_IDS.firstBook);
    if (shelf.some(book => Boolean(book.artUrl)))
      awardTrophy(TROPHY_IDS.firstCover);
    if (finished >= 1) awardTrophy(TROPHY_IDS.firstFinish);
    if (shelf.length >= LIBRARY_BOOK_COUNT) awardTrophy(TROPHY_IDS.library);
    if (highlights >= HIGHLIGHT_COUNT) awardTrophy(TROPHY_IDS.highlights);
    if (finished >= FINISHED_BOOK_COUNT) awardTrophy(TROPHY_IDS.rereads);
  }, [books, hasSettled, hydrated]);
};
