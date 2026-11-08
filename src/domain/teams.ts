import type { CompetitionEvent, DataStore, Team } from './types.ts';
import { getMatchEvent } from './competitions.ts';

export const normalizeTeamName = (name: string) => name.trim().replace(/\s+/g, ' ');
export function eventTeams(data: Pick<DataStore, 'teams' | 'matches'>, event: CompetitionEvent): (Team & { bound: boolean })[] {
  const choices = new Map<string, Team & { bound: boolean }>();
  for (const match of data.matches) {
    if (getMatchEvent(match) !== event) continue;
    for (const name of [match.home, match.away].map(normalizeTeamName).filter(Boolean)) choices.set(name, { event, name, color: '', bound: false });
  }
  for (const team of data.teams || []) if (team.event === event) choices.set(team.name, { ...team, bound: true });
  return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
export function teamColor(data: Pick<DataStore, 'teams'>, event: CompetitionEvent, name: string): string {
  return data.teams?.find((team) => team.event === event && team.name === normalizeTeamName(name))?.color || '';
}
