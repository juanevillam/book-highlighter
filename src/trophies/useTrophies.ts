import { useMemo } from 'react';

import { useTrophyStore } from './store';
import {
  type AwardedTrophy,
  type ResolvedTrophy,
  type TrophyConfig,
  type TrophyCopy,
} from './types';

export const resolveTrophies = (
  configs: TrophyConfig[],
  awarded: Record<string, AwardedTrophy>,
  copy: Record<string, TrophyCopy>,
): ResolvedTrophy[] =>
  configs.map(config => {
    const earned = awarded[config.id];
    const text = copy[config.id];

    return {
      ...config,
      title: text?.title ?? config.id,
      description: text?.description ?? '',
      unlocked: Boolean(earned),
      achievedAt: earned?.achievedAt ?? null,
    };
  });

export type TrophySummary = {
  trophies: ResolvedTrophy[];
  earned: number;
  total: number;
  earnedObjectives: number;
  totalObjectives: number;
  platinumEarned: boolean;
  hydrated: boolean;
};

export const useTrophies = (
  copy: Record<string, TrophyCopy>,
): TrophySummary => {
  const configs = useTrophyStore(state => state.configs);
  const awarded = useTrophyStore(state => state.awarded);
  const hydrated = useTrophyStore(state => state.hydrated);

  return useMemo(() => {
    const trophies = resolveTrophies(configs, awarded, copy);
    const objectives = trophies.filter(trophy => trophy.tier !== 'platinum');
    const platinum = trophies.find(trophy => trophy.tier === 'platinum');

    return {
      trophies,
      earned: trophies.filter(trophy => trophy.unlocked).length,
      total: trophies.length,
      earnedObjectives: objectives.filter(trophy => trophy.unlocked).length,
      totalObjectives: objectives.length,
      platinumEarned: Boolean(platinum?.unlocked),
      hydrated,
    };
  }, [configs, awarded, copy, hydrated]);
};
