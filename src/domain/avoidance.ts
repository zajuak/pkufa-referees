import { getMatchEvent } from './competitions.ts';
import type { CompetitionEvent, GroupOrder, Match, MatchTeamSource, Referee, Role, Stage, Team } from './types.ts';

export interface GroupStanding {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank: number;
  tied: boolean;
  tiedWith: string[];
}

interface ResolvedSlot {
  name: string;
  candidates: string[];
  warnings: string[];
}

interface ResolvedTeams {
  home: string;
  away: string;
  homeCandidates: string[];
  awayCandidates: string[];
  warnings: string[];
}

interface CompletedGame {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

const cleanName = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
const nameKey = (value: unknown) => cleanName(value).toLocaleLowerCase();
const seasonKey = (value: unknown) => nameKey(value);
const unique = (values: string[]) => [...new Set(values)];
const validScore = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function uniqueNames(values: unknown[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = cleanName(value);
    const key = nameKey(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return [...names.values()];
}

function matchEvent(match: Match): CompetitionEvent | null {
  if (match.event) return match.event;
  return typeof match.competition === 'string' ? getMatchEvent(match) : null;
}

function sameGroupOrder(order: GroupOrder, event: CompetitionEvent, season: string, group: string) {
  return order.event === event && seasonKey(order.season) === seasonKey(season) && nameKey(order.group) === nameKey(group);
}

function completedGame(match: Match): CompletedGame | null {
  if (match.status !== 'completed' || !match.result || !validScore(match.result.home) || !validScore(match.result.away)) return null;
  const home = cleanName(match.home);
  const away = cleanName(match.away);
  if (!home || !away) return null;
  return { home, away, homeScore: match.result.home, awayScore: match.result.away };
}

function directSlot(match: Match, side: 'home' | 'away'): ResolvedSlot {
  const savedName = typeof match[side] === 'string' ? match[side] : '';
  return { name: savedName, candidates: uniqueNames([savedName]), warnings: [] };
}

function resolveSlot(
  match: Match,
  side: 'home' | 'away',
  source: MatchTeamSource,
  matches: Match[],
  groupOrders: GroupOrder[],
  visiting: Set<Match>,
): ResolvedSlot {
  const sideName = side === 'home' ? '主队' : '客队';
  if (source.kind === 'group') {
    const event = matchEvent(match);
    if (!event) return { name: '', candidates: [], warnings: [`${sideName}来源小组无法确定所属赛事`] };
    if (!Number.isInteger(source.rank) || source.rank < 1) {
      return { name: '', candidates: [], warnings: [`${sideName}来源小组“${source.group}”的名次无效`] };
    }
    const standings = groupStandings(matches, event, match.season || '', source.group, 'group', groupOrders);
    const games = matches.filter((item) => item.status !== 'cancelled' && item.stage === 'group'
      && matchEvent(item) === event && seasonKey(item.season) === seasonKey(match.season) && nameKey(item.group) === nameKey(source.group));
    const pairs = new Set(games.map((item) => [nameKey(item.home), nameKey(item.away)].sort().join('\0')));
    const complete = standings.length > 1 && games.length > 0 && games.every((item) => completedGame(item))
      && standings.every((left) => standings.every((right) => left === right || pairs.has([nameKey(left.team), nameKey(right.team)].sort().join('\0'))));
    if (!complete) return { name: '', candidates: standings.map((row) => row.team), warnings: [`${sideName}来源小组“${source.group}”赛程或赛果尚未完整，保留全部候选球队`] };
    const rows = standings.filter((row) => row.rank === source.rank);
    if (rows.length === 1) return { name: rows[0].team, candidates: [rows[0].team], warnings: [] };
    if (rows.length > 1) {
      return {
        name: '',
        candidates: uniqueNames(rows.map((row) => row.team)),
        warnings: [`${sideName}来源小组“${source.group}”第 ${source.rank} 名仍有并列，保留全部候选球队`],
      };
    }
    const unresolved = standings.some((row) => row.tied);
    return {
      name: '',
      candidates: unresolved ? uniqueNames(standings.map((row) => row.team)) : [],
      warnings: [`${sideName}来源小组“${source.group}”第 ${source.rank} 名暂时无法确定`],
    };
  }

  if (source.kind !== 'match' || !source.matchId) {
    return { name: '', candidates: [], warnings: [`${sideName}晋级来源无效`] };
  }
  const referenced = matches.find((item) => item.id === source.matchId);
  if (!referenced) return { name: '', candidates: [], warnings: [`${sideName}来源比赛 ${source.matchId} 不存在`] };
  if (visiting.has(referenced)) {
    return {
      name: '',
      candidates: uniqueNames([referenced.home, referenced.away]),
      warnings: [`${sideName}来源比赛 ${source.matchId} 存在循环引用`],
    };
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(referenced);
  const resolved = resolveTeams(referenced, matches, groupOrders, nextVisiting);
  const candidates = uniqueNames([...resolved.homeCandidates, ...resolved.awayCandidates]);
  const outcomeName = source.outcome === 'loser' ? '负者' : '胜者';
  if (referenced.status === 'cancelled') {
    return { name: '', candidates, warnings: unique([...resolved.warnings, `${sideName}来源比赛 ${referenced.id} 已取消，无法确定${outcomeName}`]) };
  }
  const result = referenced.status === 'completed' && referenced.result && validScore(referenced.result.home) && validScore(referenced.result.away)
    ? referenced.result
    : null;
  if (!result) {
    return { name: '', candidates, warnings: unique([...resolved.warnings, `${sideName}来源比赛 ${referenced.id} 尚无有效赛果，保留全部候选球队`]) };
  }

  let winningSide: 'home' | 'away' | null = null;
  if (result.home > result.away) winningSide = 'home';
  if (result.away > result.home) winningSide = 'away';
  if (!winningSide && referenced.result && validScore(referenced.result.homePenalties) && validScore(referenced.result.awayPenalties) && referenced.result.homePenalties !== referenced.result.awayPenalties) {
    winningSide = referenced.result.homePenalties > referenced.result.awayPenalties ? 'home' : 'away';
  }
  if (!winningSide) {
    return { name: '', candidates, warnings: unique([...resolved.warnings, `${sideName}来源比赛 ${referenced.id} 尚未分出胜负，保留全部候选球队`]) };
  }

  const selectedSide = source.outcome === 'loser' ? (winningSide === 'home' ? 'away' : 'home') : winningSide;
  const selected = selectedSide === 'home'
    ? { name: resolved.home, candidates: resolved.homeCandidates }
    : { name: resolved.away, candidates: resolved.awayCandidates };
  return {
    name: selected.name,
    candidates: selected.name ? uniqueNames([selected.name]) : uniqueNames(selected.candidates),
    warnings: unique(resolved.warnings),
  };
}

function resolveTeams(match: Match, matches: Match[], groupOrders: GroupOrder[], visiting: Set<Match>): ResolvedTeams {
  const home = match.homeSource ? resolveSlot(match, 'home', match.homeSource, matches, groupOrders, visiting) : directSlot(match, 'home');
  const away = match.awaySource ? resolveSlot(match, 'away', match.awaySource, matches, groupOrders, visiting) : directSlot(match, 'away');
  return {
    home: home.name,
    away: away.name,
    homeCandidates: home.candidates,
    awayCandidates: away.candidates,
    warnings: unique([...home.warnings, ...away.warnings]),
  };
}

export function resolveMatchTeams(match: Match, matches: Match[], groupOrders: GroupOrder[] = []): ResolvedTeams {
  return resolveTeams(match, Array.isArray(matches) ? matches : [], Array.isArray(groupOrders) ? groupOrders : [], new Set([match]));
}

export function applyAdvancement(matches: Match[], groupOrders: GroupOrder[] = [], teams: Team[] = []): Match[] {
  const source = Array.isArray(matches) ? matches : [];
  return source.map((match) => {
    if (!match.homeSource && !match.awaySource) return match;
    const resolved = resolveMatchTeams(match, source, groupOrders);
    return {
      ...match,
      ...(match.homeSource ? { home: resolved.home } : {}),
      ...(match.awaySource ? { away: resolved.away } : {}),
      ...(match.homeSource && match.home !== resolved.home ? { homeColor: teams.find((team) => team.event === matchEvent(match) && nameKey(team.name) === nameKey(resolved.home))?.color || '' } : {}),
      ...(match.awaySource && match.away !== resolved.away ? { awayColor: teams.find((team) => team.event === matchEvent(match) && nameKey(team.name) === nameKey(resolved.away))?.color || '' } : {}),
    };
  });
}

export function groupStandings(
  matches: Match[],
  event: CompetitionEvent,
  season: string,
  group: string,
  stage: Stage = 'group',
  groupOrders: GroupOrder[] = [],
): GroupStanding[] {
  const order = stage === 'group' ? (Array.isArray(groupOrders) ? groupOrders : []).find((item) => sameGroupOrder(item, event, season, group)) : undefined;
  const selected = (Array.isArray(matches) ? matches : []).filter((match) => match.status !== 'cancelled'
    && matchEvent(match) === event
    && seasonKey(match.season) === seasonKey(season)
    && nameKey(match.group) === nameKey(group)
    && match.stage === stage && (stage !== 'placement' || match.placementMode !== 'single'));
  const teams = uniqueNames([
    ...selected.flatMap((match) => [match.home, match.away]),
    ...(order?.teams || []),
  ]);
  const games = selected.map(completedGame).filter((game): game is CompletedGame => Boolean(game));
  const rows: GroupStanding[] = teams.map((team) => ({
    team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    rank: 0,
    tied: false,
    tiedWith: [],
  }));
  const byTeam = new Map(rows.map((row) => [nameKey(row.team), row]));

  const addResult = (row: GroupStanding, goalsFor: number, goalsAgainst: number) => {
    row.played += 1;
    row.goalsFor += goalsFor;
    row.goalsAgainst += goalsAgainst;
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    if (goalsFor > goalsAgainst) {
      row.wins += 1;
      row.points += 3;
    } else if (goalsFor === goalsAgainst) {
      row.draws += 1;
      row.points += 1;
    } else {
      row.losses += 1;
    }
  };

  for (const game of games) {
    const home = byTeam.get(nameKey(game.home));
    const away = byTeam.get(nameKey(game.away));
    if (!home || !away || home === away) continue;
    addResult(home, game.homeScore, game.awayScore);
    addResult(away, game.awayScore, game.homeScore);
  }

  const headToHead = (tiedTeams: Set<string>) => {
    const stats = new Map<string, { points: number; goalDifference: number; goalsFor: number }>();
    for (const key of tiedTeams) stats.set(key, { points: 0, goalDifference: 0, goalsFor: 0 });
    for (const game of games) {
      const homeKey = nameKey(game.home);
      const awayKey = nameKey(game.away);
      if (!tiedTeams.has(homeKey) || !tiedTeams.has(awayKey) || homeKey === awayKey) continue;
      const home = stats.get(homeKey)!;
      const away = stats.get(awayKey)!;
      home.goalsFor += game.homeScore;
      away.goalsFor += game.awayScore;
      home.goalDifference += game.homeScore - game.awayScore;
      away.goalDifference += game.awayScore - game.homeScore;
      if (game.homeScore > game.awayScore) home.points += 3;
      else if (game.awayScore > game.homeScore) away.points += 3;
      else {
        home.points += 1;
        away.points += 1;
      }
    }
    return stats;
  };

  const orderIndexes = new Map<string, number>();
  order?.teams.forEach((team, index) => {
    const key = nameKey(team);
    if (key && !orderIndexes.has(key)) orderIndexes.set(key, index);
  });
  const compare = (a: GroupStanding, b: GroupStanding) => {
    if (a.points !== b.points) return b.points - a.points;
    const tiedTeams = new Set(rows.filter((row) => row.points === a.points).map((row) => nameKey(row.team)));
    const mini = headToHead(tiedTeams);
    const aMini = mini.get(nameKey(a.team))!;
    const bMini = mini.get(nameKey(b.team))!;
    if (aMini.points !== bMini.points) return bMini.points - aMini.points;
    if (tiedTeams.size > 2 && aMini.goalDifference !== bMini.goalDifference) return bMini.goalDifference - aMini.goalDifference;
    if (tiedTeams.size > 2 && aMini.goalsFor !== bMini.goalsFor) return bMini.goalsFor - aMini.goalsFor;
    if (a.goalDifference !== b.goalDifference) return b.goalDifference - a.goalDifference;
    if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
    const aOrder = orderIndexes.get(nameKey(a.team));
    const bOrder = orderIndexes.get(nameKey(b.team));
    if (aOrder !== undefined || bOrder !== undefined) {
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return 0;
  };

  const sorted = [...rows].sort(compare);
  sorted.forEach((row, index) => {
    row.rank = index > 0 && compare(row, sorted[index - 1]) === 0 ? sorted[index - 1].rank : index + 1;
  });
  for (const row of sorted) {
    row.tiedWith = sorted.filter((other) => other !== row && other.rank === row.rank).map((other) => other.team);
    row.tied = row.tiedWith.length > 0;
  }
  return sorted;
}

const roleLabels: Record<Role, string> = {
  referee: '主裁判',
  assistant1: '第一助理',
  assistant2: '第二助理',
  additionalAssistant1: '第一附加助理',
  additionalAssistant2: '第二附加助理',
  fourth: '第四官员',
  first: '第一裁判',
  second: '第二裁判',
  third: '第三裁判',
};

const stageLabels: Record<Stage, string> = {
  group: '小组赛',
  placement: '排位赛',
  knockout: '淘汰赛',
  semifinal: '半决赛',
  final: '决赛',
  third: '季军赛',
};

interface AvoidanceItem {
  name: string;
  colleges: string[];
  reason: string;
}

function referencesMatch(match: Match, matchId: string) {
  return [match.homeSource, match.awaySource].some((source) => source?.kind === 'match' && source.matchId === matchId);
}

export function avoidanceTeams(
  match: Match,
  matches: Match[],
  teams: Team[] = [],
  groupOrders: GroupOrder[] = [],
): { items: AvoidanceItem[]; warnings: string[] } {
  if (match.status === 'cancelled') return { items: [], warnings: [] };
  const allMatches = Array.isArray(matches) ? matches : [];
  const allTeams = Array.isArray(teams) ? teams : [];
  const items = new Map<string, AvoidanceItem>();
  const warnings: string[] = [];

  const add = (name: unknown, reason: string) => {
    const cleaned = cleanName(name);
    const key = nameKey(cleaned);
    if (!key) return;
    const existing = items.get(key);
    if (existing) {
      if (!existing.reason.includes(reason)) existing.reason = `${existing.reason}；${reason}`;
    } else {
      items.set(key, { name: cleaned, colleges: [], reason });
    }
  };
  const addResolved = (resolved: ResolvedTeams, homeReason: string, awayReason: string) => {
    resolved.homeCandidates.forEach((name) => add(name, homeReason));
    resolved.awayCandidates.forEach((name) => add(name, awayReason));
    warnings.push(...resolved.warnings);
  };

  const current = resolveMatchTeams(match, allMatches, groupOrders);
  addResolved(current, '本场主队', '本场客队');
  const event = matchEvent(match);

  if (match.channel === 'eleven' && (match.stage === 'group' || (match.stage === 'placement' && match.placementMode !== 'single')) && !nameKey(match.group)) {
    warnings.push('尚未设置组别，无法完整检查同组回避');
  } else if (match.channel === 'eleven' && match.stage === 'group') {
    const related = allMatches.filter((other) => other.channel === 'eleven' && other.stage === 'group'
      && matchEvent(other) === event && seasonKey(other.season) === seasonKey(match.season) && nameKey(other.group) === nameKey(match.group));
    for (const other of related) {
      if (other.id === match.id) continue;
      addResolved(resolveMatchTeams(other, allMatches, groupOrders), '同组小组赛球队', '同组小组赛球队');
    }
    const order = groupOrders.find((item) => event && sameGroupOrder(item, event, match.season || '', match.group));
    order?.teams.forEach((name) => add(name, '同组小组赛球队'));
  } else if (match.channel === 'eleven' && match.stage === 'placement' && match.placementMode !== 'single') {
    const related = allMatches.filter((other) => other.channel === 'eleven' && other.stage === 'placement' && other.placementMode !== 'single'
      && matchEvent(other) === event && seasonKey(other.season) === seasonKey(match.season) && nameKey(other.group) === nameKey(match.group));
    for (const other of related) {
      if (other.id === match.id) continue;
      addResolved(resolveMatchTeams(other, allMatches, groupOrders), '同组排位赛球队', '同组排位赛球队');
    }
  } else if (match.channel === 'eleven' && ['knockout', 'semifinal', 'final', 'third'].includes(match.stage)) {
    const nextMatches = allMatches.filter((other) => other.id !== match.id && other.status !== 'cancelled'
      && matchEvent(other) === event && seasonKey(other.season) === seasonKey(match.season) && referencesMatch(other, match.id));
    for (const next of nextMatches) {
      const reason = `后续${stageLabels[next.stage]}候选球队`;
      addResolved(resolveMatchTeams(next, allMatches, groupOrders), reason, reason);
    }
    if (!nextMatches.length && (match.stage === 'knockout' || match.stage === 'semifinal')) {
      warnings.push('未找到后续对阵，仅检查当前参赛球队');
    }
  }

  const boundItems = [...items.values()].map((item) => {
    const bindings = allTeams.filter((team) => nameKey(team.name) === nameKey(item.name) && (!event || team.event === event));
    item.colleges = uniqueNames(bindings.flatMap((team) => Array.isArray(team.colleges) ? team.colleges : []));
    if (!item.colleges.length) warnings.push(`球队“${item.name}”未绑定学院，无法完整检查回避`);
    return item;
  });
  return { items: boundItems, warnings: unique(warnings) };
}

export function analyzeAvoidance(
  match: Match,
  matches: Match[],
  referees: Referee[],
  teams: Team[],
  groupOrders: GroupOrder[] = [],
): { issues: string[]; warnings: string[] } {
  if (match.status === 'cancelled') return { issues: [], warnings: [] };
  const related = avoidanceTeams(match, matches, teams, groupOrders);
  const issues = new Set<string>();
  const warnings = new Set<string>(related.warnings);
  const allReferees = Array.isArray(referees) ? referees : [];
  const officials = Array.isArray(match.officials) ? match.officials : [];

  for (const official of officials) {
    if (!official.refereeId) continue;
    const referee = allReferees.find((item) => item.id === official.refereeId);
    if (!referee) {
      warnings.add(`未找到裁判员“${official.name || official.refereeId}”的资料，无法检查学院回避`);
      continue;
    }
    const refereeName = cleanName(referee.name) || cleanName(official.name) || referee.id;
    const role = roleLabels[official.role] || '比赛官员';
    if (!Array.isArray(referee.avoidanceColleges) || !referee.avoidanceColleges.length) warnings.add(`${refereeName}（${role}）未绑定回避学院，无法完整检查回避`);
    for (const college of uniqueNames(Array.isArray(referee.avoidanceColleges) ? referee.avoidanceColleges : [])) {
      for (const item of related.items) {
        if (!item.colleges.some((bound) => nameKey(bound) === nameKey(college))) continue;
        issues.add(`${refereeName}（${role}）的回避学院“${college}”与球队“${item.name}”（${item.reason}）存在回避冲突`);
      }
    }
  }
  return { issues: [...issues], warnings: [...warnings] };
}
