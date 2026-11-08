import type { Match } from './types.ts';

const weekMs = 7 * 86400000;
type DatedMatch = Pick<Match, 'id' | 'date' | 'season'>;
function weekStart(date: string): number {
  // Work with calendar dates in UTC so host/browser time zones cannot change week boundaries.
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return NaN;
  const day = new Date(time).getUTCDay();
  // Each match weekend spans Thursday through the following Wednesday.
  return time - ((day - 4 + 7) % 7) * 86400000;
}
export function seasonWeekStarts(matches: DatedMatch[], fallbackSeason = '2026–27'): Map<string, number> {
  const starts = new Map<string, number>();
  for (const match of matches) {
    const start = weekStart(match.date);
    if (!Number.isFinite(start)) continue;
    const season = match.season || fallbackSeason;
    starts.set(season, Math.min(starts.get(season) ?? start, start));
  }
  return starts;
}
export function matchWeek(match: DatedMatch, matches: DatedMatch[], fallbackSeason = '2026–27'): number {
  const dates = [...matches.filter((m) => m.id !== match.id), match];
  const start = seasonWeekStarts(dates, fallbackSeason).get(match.season || fallbackSeason);
  const current = weekStart(match.date);
  if (start === undefined || !Number.isFinite(current)) return 1;
  return Math.floor((current - start) / weekMs) + 1;
}
export function recalculateMatchWeeks(matches: Match[], fallbackSeason = '2026–27'): void {
  const starts = seasonWeekStarts(matches, fallbackSeason);
  for (const match of matches) {
    const start = starts.get(match.season || fallbackSeason), current = weekStart(match.date);
    if (start !== undefined && Number.isFinite(current)) match.week = Math.floor((current - start) / weekMs) + 1;
  }
}

export function seasonWeekRange(week: number, season: string, matches: DatedMatch[], fallbackSeason = '2026–27'): [string, string] | null {
  const first = seasonWeekStarts(matches, fallbackSeason).get(season);
  if (first === undefined || week < 1) return null;
  const start = first + (week - 1) * weekMs;
  return [new Date(start).toISOString().slice(0, 10), new Date(start + 6 * 86400000).toISOString().slice(0, 10)];
}
