import { allowedStages } from '../src/domain/stages.ts';
import { additionalAssistantRoles, usesAdditionalAssistants, requiredRoles } from '../src/domain/scheduling.ts';
import { resolveMatchTeams } from '../src/domain/avoidance.ts';
import { getMatchEvent } from '../src/domain/competitions.ts';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const safeScore = (v) => Number.isSafeInteger(v) && v >= 0;
const events = ['freshmen-cup', 'mens-pku-cup', 'womens-pku-cup'];
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const cleanName = (value) => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
const nameKey = (value) => cleanName(value).toLocaleLowerCase();
const seasonKey = (value) => nameKey(value);

export function normalizeCollegeName(value) {
  return cleanName(value);
}

export function normalizeColleges(input, registry, limit = 20) {
  if (!Array.isArray(input) || input.length > limit) throw new Error(`每项回避绑定最多选择 ${limit} 个学院`);
  const known = new Map((Array.isArray(registry) ? registry : []).map((name) => [nameKey(name), name]));
  const colleges = new Map();
  for (const value of input) {
    const name = normalizeCollegeName(value);
    if (!name || name.length > 40) throw new Error('学院名称须为 1 至 40 个字符');
    const canonical = known.get(nameKey(name));
    if (!canonical) throw new Error(`学院“${name}”尚未登记`);
    colleges.set(nameKey(canonical), canonical);
  }
  return [...colleges.values()];
}

function validateCollegeBinding(input, registry, message, limit = 20) {
  if (input === undefined) return;
  const normalized = normalizeColleges(input, registry, limit);
  if (normalized.length !== input.length || normalized.some((name, index) => name !== input[index])) throw new Error(message);
}

export function normalizeMatchAvoidance(input, registry) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['supplement', 'replace'].includes(input.mode)) throw new Error('本场回避设置格式不正确');
  return { mode: input.mode, colleges: normalizeColleges(input.colleges, registry, 100) };
}

function cleanSource(source, side) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${side}晋级来源格式不正确`);
  if (source.kind === 'match') {
    const matchId = typeof source.matchId === 'string' ? source.matchId.trim() : '';
    if (!matchId || matchId.length > 80 || !['winner', 'loser'].includes(source.outcome)) throw new Error(`${side}比赛来源格式不正确`);
    return { kind: 'match', matchId, outcome: source.outcome };
  }
  if (source.kind === 'group') {
    const group = cleanName(source.group);
    if (!group || group.length > 40 || !Number.isSafeInteger(source.rank) || source.rank < 1) throw new Error(`${side}小组来源格式不正确`);
    return { kind: 'group', group, rank: source.rank };
  }
  throw new Error(`${side}晋级来源格式不正确`);
}

function sourceClaim(source, match) {
  if (source?.kind === 'match') return `${source.matchId}:${source.outcome}`;
  return source?.kind === 'group' ? `group:${getMatchEvent(match)}:${seasonKey(match.season)}:${nameKey(source.group)}:${source.rank}` : null;
}

export function validateMatchAvoidance(match, matches, groupOrders = [], options = {}) {
  const output = { ...match };
  const hasResult = Object.hasOwn(match, 'result') && match.result !== undefined;
  if (hasResult) {
    const result = match.result;
    if (!result || typeof result !== 'object' || Array.isArray(result) || !safeScore(result.home) || !safeScore(result.away)) throw new Error('赛果比分必须是非负安全整数');
    if (['homePenalties', 'awayPenalties'].some((key) => result[key] !== undefined && !safeScore(result[key]))) throw new Error('点球比分必须是非负安全整数');
    if (match.status !== 'completed') throw new Error(match.status === 'cancelled' ? '已取消比赛不能保留赛果' : '只有已完成比赛可以填写赛果');
    output.result = {
      home: result.home,
      away: result.away,
      ...(result.homePenalties !== undefined ? { homePenalties: result.homePenalties } : {}),
      ...(result.awayPenalties !== undefined ? { awayPenalties: result.awayPenalties } : {}),
    };
    if (['knockout', 'semifinal', 'final', 'third'].includes(match.stage) && result.home === result.away
      && (!safeScore(result.homePenalties) || !safeScore(result.awayPenalties) || result.homePenalties === result.awayPenalties)) {
      throw new Error('淘汰赛常规比分持平时，必须填写不相等的点球比分');
    }
  } else delete output.result;

  const hasPlacementMode = match.placementMode !== undefined;
  if (hasPlacementMode && !['grouped', 'single'].includes(match.placementMode)) throw new Error('排位赛模式不正确');
  if (match.channel === 'eleven' && match.stage === 'placement') {
    if (options.defaultPlacement || hasPlacementMode) output.placementMode = match.placementMode || 'grouped';
  } else if (hasPlacementMode) throw new Error('仅十一人制排位赛可以设置排位赛模式');

  const sourceStages = ['knockout', 'semifinal', 'final', 'third'];
  for (const [key, side] of [['homeSource', '主队'], ['awaySource', '客队']]) {
    if (match[key] === undefined) {
      delete output[key];
      continue;
    }
    if (match.channel !== 'eleven' || !sourceStages.includes(match.stage)) throw new Error('仅十一人制淘汰赛、半决赛、决赛和季军赛可以设置晋级来源');
    output[key] = cleanSource(match[key], side);
  }

  const fullMatches = (Array.isArray(matches) ? matches : []).map((item) => item.id === output.id ? output : item);
  if (!fullMatches.some((item) => item.id === output.id)) fullMatches.push(output);
  for (const key of ['homeSource', 'awaySource']) {
    const source = output[key];
    if (!source) continue;
    if (source.kind === 'match') {
      if (source.matchId === output.id) throw new Error('比赛不能引用自身作为晋级来源');
      const referenced = fullMatches.find((item) => item.id === source.matchId);
      if (!referenced) throw new Error(`晋级来源比赛 ${source.matchId} 不存在`);
      if (getMatchEvent(output) !== getMatchEvent(referenced) || seasonKey(output.season) !== seasonKey(referenced.season)) throw new Error('晋级来源必须属于同一赛事和赛季');
    }
    const claim = sourceClaim(source, output);
    if (fullMatches.some((other) => other.id !== output.id && [other.homeSource, other.awaySource].some((item) => sourceClaim(item, other) === claim))) {
      throw new Error('同一场来源比赛的同一胜负结果只能供一个晋级席位使用');
    }
  }
  if (output.homeSource && output.awaySource && sourceClaim(output.homeSource, output) === sourceClaim(output.awaySource, output)) {
    throw new Error('同一场来源比赛的同一胜负结果不能同时占用主客队席位');
  }
  const resolved = resolveMatchTeams(output, fullMatches, Array.isArray(groupOrders) ? groupOrders : []);
  if (resolved.warnings.some((warning) => warning.includes('循环引用'))) throw new Error('晋级来源存在循环引用');
  if (resolved.home && resolved.away && nameKey(resolved.home) === nameKey(resolved.away)) throw new Error('比赛主客队不能是同一支球队');
  if (hasResult && (!resolved.home || !resolved.away)) throw new Error('参赛球队尚未确定，不能录入赛果');
  if (hasResult && ((output.homeSource && nameKey(output.home) !== nameKey(resolved.home)) || (output.awaySource && nameKey(output.away) !== nameKey(resolved.away)))) throw new Error('赛果对应的球队与晋级来源不一致，请先更新对阵');
  return output;
}

export function normalizeGroupOrder(input, matches) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !events.includes(input.event)) throw new Error('请选择有效赛事分类');
  const season = cleanName(input.season), group = cleanName(input.group);
  if (!season || season.length > 30 || !group || group.length > 40) throw new Error('小组排序必须填写有效赛季和组别');
  if (!Array.isArray(input.teams) || input.teams.length > 100) throw new Error('小组排序球队格式不正确');
  const submitted = input.teams.map((value) => {
    const name = cleanName(value);
    if (!name || name.length > 60) throw new Error('小组排序包含无效球队名称');
    return name;
  });
  if (new Set(submitted.map(nameKey)).size !== submitted.length) throw new Error('小组排序球队不能重复');
  const expected = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (match.status === 'cancelled' || match.stage !== 'group' || getMatchEvent(match) !== input.event
      || seasonKey(match.season) !== seasonKey(season) || nameKey(match.group) !== nameKey(group)) continue;
    for (const value of [match.home, match.away]) {
      const name = cleanName(value);
      if (name && !expected.has(nameKey(name))) expected.set(nameKey(name), name);
    }
  }
  if (!expected.size || expected.size !== submitted.length || submitted.some((name) => !expected.has(nameKey(name)))) {
    throw new Error('排序球队必须与对应小组赛中的全部球队完全一致');
  }
  return { event: input.event, season, group, teams: submitted.map((name) => expected.get(nameKey(name))) };
}

export function validateSnapshot(input) {
  const value = input?.data || input;
  if (!value || value.version !== 1 || !value.meta || typeof value.meta.season !== 'string' || !Array.isArray(value.referees) || !Array.isArray(value.matches) || !Array.isArray(value.adjustments)) throw new Error('不是有效的平台备份文件');
  if (value.colleges !== undefined && !Array.isArray(value.colleges)) throw new Error('学院登记格式不正确');
  const colleges = value.colleges || [];
  if (colleges.length > 100) throw new Error('学院登记最多保留 100 个学院');
  const collegeKeys = new Set();
  for (const name of colleges) {
    const normalized = normalizeCollegeName(name), key = nameKey(name);
    if (!normalized || normalized.length > 40 || normalized !== name || collegeKeys.has(key)) throw new Error('学院登记格式不正确');
    collegeKeys.add(key);
  }
  const ids = new Set();
  for (const r of value.referees) {
    if (!r.id || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || !r.channels || typeof r.channels !== 'object') throw new Error('裁判员档案格式有误');
    ids.add(r.id);
    validateCollegeBinding(r.avoidanceColleges, colleges, '裁判员回避学院格式不正确');
    for (const [channel, s] of Object.entries(r.channels)) {
      if (!['eleven', 'five'].includes(channel) || !s || !finite(s.basePoints) || !finite(s.previousWage) || !(channel === 'five' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E']).includes(s.baseLevel) || (s.levelOverride && !(channel === 'five' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E']).includes(s.levelOverride)) || !s.historical || !s.historical.roleCounts || ['pointsEarned', 'bonusWage', 'deductedWage', 'bonusPoints', 'deductedPoints'].some((k) => !finite(s.historical[k]))) throw new Error('裁判员积分工资档案格式有误');
    }
  }
  const matchIds = new Set();
  for (const m of value.matches) {
    if (m.avoidanceOverride !== undefined) {
      normalizeMatchAvoidance(m.avoidanceOverride, colleges);
      validateCollegeBinding(m.avoidanceOverride.colleges, colleges, '本场回避学院格式不正确', 100);
    }
    if (!m.id || matchIds.has(m.id) || !date(m.date) || !['eleven', 'five'].includes(m.channel) || !['scheduled', 'completed', 'cancelled'].includes(m.status) || !Array.isArray(m.officials) || !Array.isArray(m.bonuses) || !finite(m.week) || !allowedStages(m.channel).includes(m.stage) || ['competition', 'time', 'venue', 'group', 'home', 'away', 'note'].some((k) => typeof m[k] !== 'string')) throw new Error('比赛记录格式有误');
    matchIds.add(m.id);
    if (m.additionalAssistants !== undefined && typeof m.additionalAssistants !== 'boolean') throw new Error('附加助理裁判设置不正确');
    if (m.additionalAssistants && m.channel !== 'eleven') throw new Error('仅十一人制可设置附加助理裁判');
    if (usesAdditionalAssistants(m) && m.status !== 'cancelled' && additionalAssistantRoles.some((role) => !m.officials.some((o) => o.role === role))) throw new Error('附加助理裁判必须保留两个岗位');
    if (new Set(m.officials.map((o) => o.role)).size !== m.officials.length) throw new Error('选派岗位重复');
    for (const o of m.officials) if (typeof o.name !== 'string' || !requiredRoles(m.channel, usesAdditionalAssistants(m)).includes(o.role) || (o.refereeId && !value.referees.some((r) => r.id === o.refereeId && r.channels[m.channel]))) throw new Error('选派记录关联了无效档案');
  }
  if (value.groupOrders !== undefined && !Array.isArray(value.groupOrders)) throw new Error('小组排序格式不正确');
  const orderKeys = new Set();
  for (const order of value.groupOrders || []) {
    const normalized = normalizeGroupOrder(order, value.matches);
    const key = `${order.event}:${seasonKey(order.season)}:${nameKey(order.group)}`;
    if (orderKeys.has(key) || order.season !== normalized.season || order.group !== normalized.group
      || order.teams.some((name, index) => name !== normalized.teams[index])) throw new Error('小组排序重复或格式不正确');
    orderKeys.add(key);
  }
  for (const match of value.matches) validateMatchAvoidance(match, value.matches, value.groupOrders || []);
  const adjustmentIds = new Set();
  for (const a of value.adjustments) {
    if (!a.id || adjustmentIds.has(a.id) || !value.referees.some((r) => r.id === a.refereeId && r.channels[a.channel]) || !finite(a.points) || !finite(a.wage) || !date(a.date) || !['reward', 'penalty'].includes(a.type) || typeof a.reason !== 'string' || typeof a.season !== 'string') throw new Error('奖惩记录格式有误');
    if (a.matchId !== undefined) {
      const match = value.matches.find((item) => item.id === a.matchId);
      if (typeof a.matchId !== 'string' || !match || a.channel !== match.channel || a.season !== (match.season || value.meta.season) || a.event !== getMatchEvent(match) || a.date !== match.date) throw new Error('奖惩记录与关联比赛不一致');
    }
    adjustmentIds.add(a.id);
  }
  const leaveIds = new Set();
  for (const l of value.unavailability || []) {
    if (!l.id || leaveIds.has(l.id) || !ids.has(l.refereeId) || !date(l.start) || !date(l.end) || l.start > l.end || typeof l.reason !== 'string') throw new Error('请假记录格式有误');
    leaveIds.add(l.id);
  }
  if (value.teams !== undefined && !Array.isArray(value.teams)) throw new Error('球队绑定格式不正确');
  const teamKeys = new Set();
  for (const t of value.teams || []) {
    const key = `${t.event}:${t.name}`;
    if (!events.includes(t.event) || typeof t.name !== 'string' || !t.name.trim() || t.name !== t.name.trim().replace(/\s+/g, ' ') || t.name.length > 60 || !/^#[0-9a-fA-F]{6}$/.test(t.color) || teamKeys.has(key)) throw new Error('球队或球衣颜色绑定格式不正确');
    validateCollegeBinding(t.colleges, colleges, '球队学院绑定格式不正确');
    teamKeys.add(key);
  }
  return structuredClone(value);
}
