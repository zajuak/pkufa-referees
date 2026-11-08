import type { Bonus, Match } from './types.ts';

export const timeBonusKinds = ['early', 'late', 'weekday'] as const;
export type TimeBonus = (typeof timeBonusKinds)[number];
export const timeBonusLabels: Record<TimeBonus, string> = { early: '早场', late: '晚场', weekday: '非常规时间' };
export function automaticTimeBonuses(match: Pick<Match, 'date' | 'time'>): TimeBonus[] {
  const bonuses: TimeBonus[] = [];
  // Classify by the opening time, not the ending time (including overnight matches).
  const start = match.time.replace(/\s/g, '').match(/^(\d{1,2}):(\d{2})(?:[-—–~～至]|$)/);
  if (start) {
    const hour = Number(start[1]), minute = Number(start[2]);
    if (hour < 24 && minute < 60) {
      const minutes = hour * 60 + minute;
      if (minutes <= 600) bonuses.push('early');
      if (minutes >= 1200) bonuses.push('late');
    }
  }
  // Dates are Beijing calendar dates. Artificial UTC midnight avoids host-time-zone drift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(match.date)) {
    const date = new Date(`${match.date}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match.date && ![0, 6].includes(date.getUTCDay())) bonuses.push('weekday');
  }
  return bonuses;
}
export function matchBonuses(match: Pick<Match, 'date' | 'time' | 'bonuses'>): Bonus[] {
  const manual = match.bonuses.filter((bonus) => !timeBonusKinds.includes(bonus as TimeBonus));
  return [...automaticTimeBonuses(match), ...new Set(manual)];
}
export function recalculateMatchBonuses(matches: Match[]): void {
  for (const match of matches) match.bonuses = matchBonuses(match);
}
