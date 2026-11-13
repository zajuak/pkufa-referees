import type { Match } from './types.ts';

const weekMs = 7 * 86400000;
export type Semester = 'autumn' | 'spring';
export const semesterLabel = (semester: Semester) => semester === 'spring' ? '春季学期' : '秋季学期';
// The existing academic season runs July through June; January remains in autumn.
export const matchSemester = (match: Pick<Match, 'date'>): Semester => {
  const month = Number(match.date.slice(5, 7));
  return month >= 2 && month <= 6 ? 'spring' : 'autumn';
};

type DatedMatch = Pick<Match, 'id' | 'date' | 'season'>;
const semesterKey = (match: DatedMatch, fallbackSeason: string) => `${match.season || fallbackSeason}:${matchSemester(match)}`;
function weekStart(date: string): number {
  // Work with calendar dates in UTC so host/browser time zones cannot change week boundaries.
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return NaN;
  const day = new Date(time).getUTCDay();
  // Each match weekend spans Thursday through the following Wednesday.
  return time - ((day - 4 + 7) % 7) * 86400000;
}
export function semesterWeekStarts(matches: DatedMatch[], fallbackSeason = '2026–27'): Map<string, number> {
  const starts = new Map<string, number>();
  for (const match of matches) {
    const start = weekStart(match.date);
    if (!Number.isFinite(start)) continue;
    const key = semesterKey(match, fallbackSeason);
    starts.set(key, Math.min(starts.get(key) ?? start, start));
  }
  return starts;
}
export function matchWeek(match: DatedMatch, matches: DatedMatch[], fallbackSeason = '2026–27'): number {
  const dates = [...matches.filter((m) => m.id !== match.id), match];
  const start = semesterWeekStarts(dates, fallbackSeason).get(semesterKey(match, fallbackSeason));
  const current = weekStart(match.date);
  if (start === undefined || !Number.isFinite(current)) return 1;
  return Math.floor((current - start) / weekMs) + 1;
}
export function recalculateMatchWeeks(matches: Match[], fallbackSeason = '2026–27'): void {
  const starts = semesterWeekStarts(matches, fallbackSeason);
  for (const match of matches) {
    const start = starts.get(semesterKey(match, fallbackSeason)), current = weekStart(match.date);
    if (start !== undefined && Number.isFinite(current)) match.week = Math.floor((current - start) / weekMs) + 1;
  }
}

export function semesterWeekRange(week: number, season: string, semester: Semester, matches: DatedMatch[], fallbackSeason = '2026–27'): [string, string] | null {
  const first = semesterWeekStarts(matches, fallbackSeason).get(`${season}:${semester}`);
  if (first === undefined || week < 1) return null;
  const start = first + (week - 1) * weekMs;
  return [new Date(start).toISOString().slice(0, 10), new Date(start + 6 * 86400000).toISOString().slice(0, 10)];
}
