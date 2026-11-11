import { analyzeAvoidance } from './avoidance.ts';
import type { GroupOrder, Match, Referee, Role, Team, Unavailability } from './types.ts';

export const additionalAssistantRoles: Role[] = ['additionalAssistant1', 'additionalAssistant2'];
export const isAssistantRole = (role: Role) => ['assistant1', 'assistant2', ...additionalAssistantRoles].includes(role);
export const usesAdditionalAssistants = (match: Pick<Match, 'channel' | 'additionalAssistants' | 'officials'>) => match.channel === 'eleven' && (match.additionalAssistants ?? match.officials.some((o) => additionalAssistantRoles.includes(o.role)));
export const requiredRoles = (channel: Match['channel'], additional = false): Role[] => channel === 'eleven'
  ? ['referee', 'assistant1', 'assistant2', ...(additional ? additionalAssistantRoles : []), 'fourth'] : ['first', 'second', 'third'];
export const matchRoles = (match: Pick<Match, 'channel' | 'additionalAssistants' | 'officials'>) => requiredRoles(match.channel, usesAdditionalAssistants(match));

export function matchInterval(match: Pick<Match, 'date' | 'time'>): [number, number] | null {
  const parts = match.time.replace(/[—–~～]/g, '-').replace(/\s/g, '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!parts) return null;
  const [h1, m1, h2, m2] = parts.slice(1).map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const start = Date.parse(`${match.date}T${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}:00+08:00`);
  let end = Date.parse(`${match.date}T${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00+08:00`);
  if (end < start) end += 86400000;
  if (!Number.isFinite(start) || end === start) return null;
  return [start, end];
}

export interface AssignmentContext {
  referees?: Referee[];
  teams?: Team[];
  groupOrders?: GroupOrder[];
}

export function assignmentAnalysis(match: Match, matches: Match[], leave: Unavailability[] = [], context?: AssignmentContext): { issues: string[]; warnings: string[] } {
  if (match.status === 'cancelled') return { issues: [], warnings: [] };
  const issues = new Set<string>();
  const interval = matchInterval(match);
  const assigned = match.officials.filter((o) => o.refereeId);
  const ids = assigned.map((o) => o.refereeId);
  if (new Set(ids).size !== ids.length) issues.add('同一场比赛不能重复选派同一名裁判员');
  for (const official of assigned) {
    if (interval && leave.some((item) => item.refereeId === official.refereeId && Date.parse(`${item.start}T00:00:00+08:00`) < interval[1] && Date.parse(`${item.end}T00:00:00+08:00`) + 86400000 > interval[0])) issues.add(`${official.name}在比赛时段已登记请假`);
    if (!interval) continue;
    for (const other of matches) {
      if (other.id === match.id || other.status === 'cancelled' || !other.officials.some((o) => o.refereeId === official.refereeId)) continue;
      const otherTime = matchInterval(other);
      if (otherTime && interval[0] < otherTime[1] && otherTime[0] < interval[1]) issues.add(`${official.name}与 ${other.date} ${other.time} ${other.home || other.group}—${other.away} 的选派时间冲突`);
    }
  }
  const avoidance = context ? analyzeAvoidance(match, matches, context.referees || [], context.teams || [], context.groupOrders || []) : { issues: [], warnings: [] };
  avoidance.issues.forEach((issue) => issues.add(issue));
  return { issues: [...issues], warnings: avoidance.warnings };
}

export function assignmentIssues(match: Match, matches: Match[], leave: Unavailability[] = [], context?: AssignmentContext): string[] {
  return assignmentAnalysis(match, matches, leave, context).issues;
}

export function assignmentWarnings(match: Match, matches: Match[], leave: Unavailability[] = [], context?: AssignmentContext): string[] {
  return assignmentAnalysis(match, matches, leave, context).warnings;
}

export function vacantRoles(match: Match) {
  return match.status === 'cancelled' ? [] : matchRoles(match).filter((role) => !match.officials.some((o) => o.role === role && o.refereeId));
}
