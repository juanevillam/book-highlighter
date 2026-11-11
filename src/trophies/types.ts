export type TrophyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type TrophyConfig = {
  id: string;
  tier: TrophyTier;
};

export type TrophyCopy = {
  title: string;
  description: string;
};

export type AwardedTrophy = { achievedAt: number };

export type ResolvedTrophy = TrophyConfig & {
  title: string;
  description: string;
  unlocked: boolean;
  achievedAt: number | null;
};

export type TrophyPersistenceAdapter = {
  load: () => Promise<Record<string, AwardedTrophy>>;
  save: (trophyId: string, achievedAt: number) => Promise<void>;
};

export type QueuedTrophy = { id: string; tier: TrophyTier };
