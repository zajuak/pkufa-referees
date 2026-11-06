import type { Channel, CompetitionEvent, Match } from './types';

export const competitionEvents: { id: CompetitionEvent; name: string; term: string; channel: Channel; competition: string }[] = [
  { id: 'freshmen-cup', name: '男足新生杯', term: '秋季学期', channel: 'eleven', competition: '新生杯' },
  { id: 'mens-pku-cup', name: '男足北大杯', term: '春季学期', channel: 'eleven', competition: '男足北大杯' },
  { id: 'womens-pku-cup', name: '女足北大杯', term: '全学年', channel: 'five', competition: '女足北大杯' },
];

export function getMatchEvent(match: Pick<Match, 'event' | 'channel' | 'competition'>): CompetitionEvent | null {
  if (match.event && competitionEvents.some((item) => item.id === match.event)) return match.event;
  if (match.channel === 'five' && match.competition.includes('女足') && match.competition.includes('北大杯')) return 'womens-pku-cup';
  if (match.channel === 'eleven' && match.competition.includes('新生杯')) return 'freshmen-cup';
  if (match.channel === 'eleven' && match.competition.includes('北大杯')) return 'mens-pku-cup';
  return null;
}

export function eventName(event: CompetitionEvent) {
  return competitionEvents.find((item) => item.id === event)?.name || '';
}

export function defaultCompetition(event: CompetitionEvent) {
  return competitionEvents.find((item) => item.id === event)?.competition || '';
}

export function eventsForChannel(channel: Channel) {
  return competitionEvents.filter((item) => !item.channel || item.channel === channel);
}
