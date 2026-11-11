import { create } from 'zustand';

import {
  type AwardedTrophy,
  type QueuedTrophy,
  type TrophyConfig,
  type TrophyPersistenceAdapter,
} from './types';

const nowMs = () => Date.now();

type TrophyState = {
  configs: TrophyConfig[];
  byId: Record<string, TrophyConfig>;
  adapter: TrophyPersistenceAdapter | null;
  awarded: Record<string, AwardedTrophy>;
  hydrated: boolean;
  buffered: string[];
  queue: QueuedTrophy[];
  configure: (
    configs: TrophyConfig[],
    adapter: TrophyPersistenceAdapter,
  ) => Promise<void>;
  award: (id: string) => void;
  dequeue: () => void;
  reset: () => void;
};

export const useTrophyStore = create<TrophyState>()((set, get) => {
  const award = (id: string) => {
    const state = get();

    if (!state.hydrated) {
      if (!state.buffered.includes(id))
        set({ buffered: [...state.buffered, id] });
      return;
    }

    const config = state.byId[id];
    if (!config || state.awarded[id]) return;

    const achievedAt = nowMs();
    const awarded = { ...state.awarded, [id]: { achievedAt } };

    set({
      awarded,
      queue: [...state.queue, { id, tier: config.tier }],
    });

    state.adapter?.save(id, achievedAt).catch(() => {});

    const platinum = state.configs.find(c => c.tier === 'platinum');
    if (platinum && platinum.id !== id) {
      const others = state.configs.filter(c => c.id !== platinum.id);
      if (others.every(c => awarded[c.id])) award(platinum.id);
    }
  };

  return {
    configs: [],
    byId: {},
    adapter: null,
    awarded: {},
    hydrated: false,
    buffered: [],
    queue: [],

    configure: async (configs, adapter) => {
      const byId = Object.fromEntries(
        configs.map(config => [config.id, config]),
      );
      set({ configs, byId, adapter, hydrated: false, buffered: [] });

      let loaded: Record<string, AwardedTrophy> = {};
      try {
        loaded = await adapter.load();
      } catch {
        loaded = {};
      }

      if (get().adapter !== adapter) return;

      set({ awarded: loaded, hydrated: true });

      const platinum = configs.find(config => config.tier === 'platinum');
      if (platinum && !loaded[platinum.id]) {
        const objectives = configs.filter(config => config.id !== platinum.id);
        if (
          objectives.length > 0 &&
          objectives.every(config => loaded[config.id])
        )
          award(platinum.id);
      }

      const { buffered } = get();
      if (buffered.length > 0) {
        set({ buffered: [] });
        buffered.forEach(award);
      }
    },

    award,

    dequeue: () => set(state => ({ queue: state.queue.slice(1) })),

    reset: () =>
      set({
        configs: [],
        byId: {},
        adapter: null,
        awarded: {},
        hydrated: false,
        buffered: [],
        queue: [],
      }),
  };
});

export const awardTrophy = (id: string) => useTrophyStore.getState().award(id);

export const configureTrophies = (
  configs: TrophyConfig[],
  adapter: TrophyPersistenceAdapter,
) => useTrophyStore.getState().configure(configs, adapter);

export const resetTrophies = () => useTrophyStore.getState().reset();
