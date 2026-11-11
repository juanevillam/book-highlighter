import { type TrophyTier } from './types';

export const TIER_COLORS: Record<TrophyTier, string> = {
  bronze: '#BE7B3A',
  silver: '#78889B',
  gold: '#CC9A34',
  platinum: '#6FA9C6',
};

export const tierColor = (tier: TrophyTier): string => TIER_COLORS[tier];
