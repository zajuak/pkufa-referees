import type { Channel, Level, Match, MatchStatus, Official, OfficialCalculation, Referee, Adjustment, WageStandards } from './types';
import { isAssistantRole, matchInterval } from './scheduling';
import { competitionEvents, getMatchEvent } from './competitions';

export const CURRENT_SEASON = '2026–27';
export const HISTORY_SEASON = '2025–26';

export const channelName = (channel: Channel) => channel === 'eleven' ? '十一人制' : '五人制';
export const roleName = (role: Official['role']) => ({
  referee: '主裁判', assistant1: '第一助理', assistant2: '第二助理', additionalAssistant1: '第一附加助理', additionalAssistant2: '第二附加助理', fourth: '第四官员',
  first: '第一裁判', second: '第二裁判', third: '第三裁判',
}[role]);

export const stageName = (stage: Match['stage']) => ({
  group: '小组赛', knockout: '淘汰赛', semifinal: '半决赛', final: '决赛', third: '季军赛',
}[stage]);

export const defaultWageStandards: WageStandards = {
  'freshmen-cup': { A: [125, 70, 45], B: [120, 65, 40], C: [110, 60, 30], D: [100, 55, 25], E: [90, 50, 20] },
  'mens-pku-cup': { A: [125, 70, 45], B: [120, 65, 40], C: [110, 60, 30], D: [100, 55, 25], E: [90, 50, 20] },
  'womens-pku-cup': { A: [60, 30], B: [50, 25], C: [40, 20] },
};
const levelOrder: Level[] = ['E', 'D', 'C', 'B', 'A'];
const channelLevels: Record<Channel, Level[]> = { eleven: ['E', 'D', 'C', 'B', 'A'], five: ['C', 'B', 'A'] };
const upgradeThresholds: Record<Channel, Partial<Record<Level, number>>> = {
  eleven: { D: 10, C: 30, B: 80, A: 140 },
  five: { B: 5, A: 15 },
};

export function levelForPoints(channel: Channel, points: number): Level {
  if (channel === 'five') return points >= 15 ? 'A' : points >= 5 ? 'B' : 'C';
  return points >= 140 ? 'A' : points >= 80 ? 'B' : points >= 30 ? 'C' : points >= 10 ? 'D' : 'E';
}

export function displayLevel(channel: Channel, baseLevel: Level, points: number): Level {
  const calculated = levelForPoints(channel, points);
  return levelOrder.indexOf(calculated) > levelOrder.indexOf(baseLevel) ? calculated : baseLevel;
}

export function calculateOfficial(match: Match, official: Official, level: Level, wageStandards?: WageStandards): OfficialCalculation {
  const event = getMatchEvent(match);
  if (!event) return { points: 0, baseWage: 0, bonusWage: 0, wage: 0 };
  const roleIndex = official.role === 'referee' ? 0 : isAssistantRole(official.role) ? 1 : 2;
  let points = match.channel === 'eleven'
    ? (official.role === 'referee' ? 4 : official.role === 'fourth' ? 1 : 2)
    : (official.role === 'third' ? 1 : 2);
  if (match.stage !== 'group') points *= 1.5;
  if (match.channel === 'eleven' && match.competition.includes('北大杯')) points *= 1.2;

  const eventWages = wageStandards?.[event] || defaultWageStandards[event];
  const levelWages = eventWages?.[level] || defaultWageStandards[event]?.[level];
  let baseWage = !levelWages ? 0 : match.channel === 'eleven'
    ? levelWages[roleIndex]
    : levelWages[official.role === 'third' ? 1 : 0];
  if (match.channel === 'eleven' && match.competition.includes('北大杯') && match.division === '甲') baseWage *= 1.1;

  let bonusWage = 0;
  const isFourth = official.role === 'fourth' || official.role === 'third';
  if (match.stage === 'semifinal') bonusWage += isFourth ? 5 : 10;
  if (match.stage === 'final') bonusWage += isFourth ? 10 : 20;
  if (match.bonuses.some((bonus) => ['early', 'late', 'weekday'].includes(bonus))) bonusWage += 10;
  if (match.bonuses.includes('badWeather')) bonusWage += 10;
  if (official.substitute) bonusWage += 10;
  return { points, baseWage, bonusWage, wage: baseWage + bonusWage };
}

export function officialBonusDescription(match: Match, official: Official) {
  const descriptions: string[] = [];
  if (match.stage === 'semifinal') descriptions.push('半决赛奖励');
  if (match.stage === 'final') descriptions.push('决赛奖励');
  if (match.bonuses.some((bonus) => ['early', 'late', 'weekday'].includes(bonus))) descriptions.push('特殊时间补贴');
  if (match.bonuses.includes('badWeather')) descriptions.push('恶劣天气补贴');
  if (official.substitute) descriptions.push('临时替补补贴');
  return descriptions.join('、');
}

export function effectiveMatchStatus(match: Match, now = new Date()): MatchStatus {
  if (match.status === 'cancelled' || match.status === 'completed') return match.status;
  const interval = matchInterval(match);
  return interval && interval[1] <= now.getTime() ? 'completed' : 'scheduled';
}

export function getRefereeMatches(refereeId: string, matches: Match[], status?: Match['status']) {
  return matches.filter((match) => (!status || effectiveMatchStatus(match) === status) && match.officials.some((official) => official.refereeId === refereeId));
}

export function getChannelSummary(referee: Referee, channel: Channel, matches: Match[], adjustments: Adjustment[], wageStandards?: WageStandards) {
  const stats = referee.channels[channel];
  if (!stats) return null;
  const completed = getRefereeMatches(referee.id, matches, 'completed').filter((match) => match.channel === channel && getMatchEvent(match));
  const contributions = completed.flatMap((match) => match.officials
    .filter((official) => official.refereeId === referee.id)
    .map((official) => ({ match, official, ...calculateOfficial(match, official, stats.baseLevel, wageStandards) })));
  const ownAdjustments = adjustments.filter((item) => item.refereeId === referee.id && item.channel === channel && (!item.event || competitionEvents.some((config) => config.id === item.event)));
  const matchPoints = contributions.reduce((sum, item) => sum + item.points, 0);
  const adjustmentPoints = ownAdjustments.reduce((sum, item) => sum + item.points, 0);
  const points = Math.max(0, stats.basePoints + matchPoints + adjustmentPoints);
  return {
    stats, contributions, adjustments: ownAdjustments, points,
    level: stats.levelOverride || stats.baseLevel,
    matchPoints, adjustmentPoints,
  };
}

export function getSeasonPoints(referee: Referee, channel: Channel, season: string, matches: Match[], adjustments: Adjustment[], wageStandards?: WageStandards) {
  const summary = getChannelSummary(referee, channel, matches, adjustments, wageStandards);
  if (!summary) return null;
  const contributions = summary.contributions.filter((item) => (item.match.season || CURRENT_SEASON) === season);
  const seasonAdjustments = summary.adjustments.filter((item) => item.season === season);
  const matchPoints = contributions.reduce((sum, item) => sum + item.points, 0);
  const adjustmentPoints = seasonAdjustments.reduce((sum, item) => sum + item.points, 0);
  return { matchPoints, adjustmentPoints, total: matchPoints + adjustmentPoints };
}

export function getSeasonWage(referee: Referee, channel: Channel, season: string, matches: Match[], adjustments: Adjustment[], wageStandards?: WageStandards) {
  const summary = getChannelSummary(referee, channel, matches, adjustments, wageStandards);
  if (!summary) return null;
  const historical = season === HISTORY_SEASON ? summary.stats.previousWage : 0;
  const contributions = summary.contributions.filter((item) => (item.match.season || CURRENT_SEASON) === season);
  const seasonAdjustments = summary.adjustments.filter((item) => item.season === season);
  const matchWage = contributions.reduce((sum, item) => sum + item.baseWage, 0);
  const bonusWage = contributions.reduce((sum, item) => sum + item.bonusWage, 0);
  const adjustmentWage = seasonAdjustments.reduce((sum, item) => sum + item.wage, 0);
  return {
    historical, contributions, adjustments: seasonAdjustments,
    matchWage, bonusWage, adjustmentWage,
    total: historical + matchWage + bonusWage + adjustmentWage,
  };
}

export function getCompetitionSummaries(referee: Referee, channel: Channel, season: string, matches: Match[], adjustments: Adjustment[], wageStandards?: WageStandards) {
  const summary = getChannelSummary(referee, channel, matches, adjustments, wageStandards);
  if (!summary) return [];
  const contributions = summary.contributions.filter((item) => (item.match.season || CURRENT_SEASON) === season);
  const seasonAdjustments = summary.adjustments.filter((item) => item.season === season);
  return competitionEvents.map(({ id }) => {
    const eventContributions = contributions.filter((item) => getMatchEvent(item.match) === id);
    const eventAdjustments = seasonAdjustments.filter((item) => item.event === id);
    const matchPoints = eventContributions.reduce((sum, item) => sum + item.points, 0);
    const adjustmentPoints = eventAdjustments.reduce((sum, item) => sum + item.points, 0);
    const matchWage = eventContributions.reduce((sum, item) => sum + item.baseWage, 0);
    const bonusWage = eventContributions.reduce((sum, item) => sum + item.bonusWage, 0);
    const adjustmentWage = eventAdjustments.reduce((sum, item) => sum + item.wage, 0);
    return {
      event: id, contributions: eventContributions, adjustments: eventAdjustments,
      matchPoints, adjustmentPoints, points: matchPoints + adjustmentPoints,
      matchWage, bonusWage, adjustmentWage,
      total: matchWage + bonusWage + adjustmentWage,
    };
  });
}

export function availableSeasons(matches: Match[], adjustments: Adjustment[]) {
  return [...new Set([CURRENT_SEASON, HISTORY_SEASON, ...matches.map((match) => match.season || CURRENT_SEASON), ...adjustments.map((item) => item.season)])]
    .sort((a, b) => b.localeCompare(a, 'zh-CN'));
}

export function nextLevelTarget(channel: Channel, currentLevel: Level) {
  const levels = channelLevels[channel];
  const nextLevel = levels[levels.indexOf(currentLevel) + 1];
  return nextLevel ? upgradeThresholds[channel][nextLevel] ?? null : null;
}

export function getUpgradeRecommendation(channel: Channel, currentLevel: Level, points: number) {
  const levels = channelLevels[channel];
  const currentIndex = levels.indexOf(currentLevel);
  if (currentIndex < 0) return null;
  const nextLevel = levels[currentIndex + 1];
  if (!nextLevel) return null;
  const targetPoints = upgradeThresholds[channel][nextLevel]!;
  const earnedLevel = levelForPoints(channel, points);
  if (levels.indexOf(earnedLevel) > currentIndex) return { kind: 'ready' as const, level: earnedLevel, targetPoints };
  if (points >= targetPoints * 0.9) return { kind: 'approaching' as const, level: nextLevel, targetPoints };
  return null;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: value % 1 ? 1 : 0 }).format(value);
}

export function formatDate(date: string, includeYear = false) {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric', weekday: 'short',
  }).format(parsed);
}
