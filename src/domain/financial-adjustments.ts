import type { Adjustment } from './types';
export function financialAdjustments(adjustments: Adjustment[]): Adjustment[] {
  return adjustments.filter(a => !a.voidedAt).flatMap(a => a.crossChannelPoints
    ? [a, { ...a, id: `${a.id}:cross`, channel: a.crossChannelPoints.channel, points: a.crossChannelPoints.points, wage: 0, event: undefined, crossChannelPoints: undefined }]
    : [a]);
}
