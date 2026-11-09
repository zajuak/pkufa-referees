import type { Channel, ChannelStats } from './types.ts';

export const normalizeRefereeName = (name: string) => name.trim().replace(/\s+/g, ' ');
export const refereeNameKey = (name: string) => normalizeRefereeName(name).replace(/\s/g, '');

export function initialChannelStats(channel: Channel): ChannelStats {
  return {
    basePoints: 0,
    baseLevel: channel === 'five' ? 'C' : 'E',
    previousWage: 0,
    historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 },
  };
}
