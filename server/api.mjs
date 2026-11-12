import { recalculateMatchBonuses } from '../src/domain/time-bonuses.ts';
import { allowedStages } from '../src/domain/stages.ts';
import { recalculateMatchWeeks } from '../src/domain/weeks.ts';
import { readableStore } from './access.mjs';
import { initialChannelStats, normalizeRefereeName, refereeNameKey } from '../src/domain/referees.ts';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { importAssignmentWorkbook } from './assignment-import.mjs';
import { additionalAssistantRoles, assignmentIssues, matchInterval } from '../src/domain/scheduling.ts';
import { applyAdvancement } from '../src/domain/avoidance.ts';
import { previewStandingsResults } from '../src/domain/standings-import.ts';
import { getMatchEvent } from '../src/domain/competitions.ts';
import { normalizeTeamName, teamColor } from '../src/domain/teams.ts';
import { Router } from './router.mjs';
import { normalizeCollegeName, normalizeColleges, normalizeMatchAvoidance, normalizeGroupOrder, validateMatchAvoidance, validateSnapshot } from './validation.mjs';

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function handleApi(request, repository, auth) {
  const before = await repository.load();
  let store = structuredClone(before);
  store.matches = applyAdvancement(store.matches, store.groupOrders || [], store.teams || []);
  recalculateMatchWeeks(store.matches, store.meta.season);
  recalculateMatchBonuses(store.matches);
  const app = new Router(request);
  const requireAdmin = (_req, res, next) => auth.authenticated ? next() : res.status(401).json({ error: '请先登录管理员账号' });
  const persist = async () => {
    const supplied = request.headers.get('If-Match');
    if (supplied === null) throw Object.assign(new Error('请刷新页面后再保存'), { status: 428 });
    if (Number(supplied) !== (before.revision || 0)) throw Object.assign(new Error('数据已被其他窗口更新，请刷新后重新编辑；本次修改尚未保存'), { status: 409 });
    recalculateMatchWeeks(store.matches, store.meta.season);
    recalculateMatchBonuses(store.matches);
    for (const adjustment of store.adjustments) {
      if (!adjustment.matchId) continue;
      const match = store.matches.find((item) => item.id === adjustment.matchId);
      if (!match) throw new Error('奖惩关联的比赛不存在，请先处理该比赛的奖惩记录');
      if (match.channel !== adjustment.channel) throw new Error('已登记奖惩的比赛不能修改赛制，请先处理相关奖惩记录');
      const event = getMatchEvent(match);
      if (!event || eventChannels[event] !== match.channel || !store.referees.some((referee) => referee.id === adjustment.refereeId && referee.channels[match.channel])) throw new Error('该比赛的赛制或赛事修改与已登记奖惩不兼容');
      Object.assign(adjustment, { channel: match.channel, season: match.season || store.meta.season, event, date: match.date });
    }
    store.revision = (before.revision || 0) + 1;
    store.updatedAt = new Date().toISOString();
    await repository.save(store, before.revision || 0, `${request.method} ${new URL(request.url).pathname}`);
  };
  const eventChannels = { 'freshmen-cup': 'eleven', 'mens-pku-cup': 'eleven', 'womens-pku-cup': 'five' };
  const eventCompetitions = { 'freshmen-cup': '新生杯', 'mens-pku-cup': '男足北大杯', 'womens-pku-cup': '女足北大杯' };
function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jerseyColor(value) {
  const color = text(value, 20);
  if (!color) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('球衣颜色格式不正确');
  return color.toUpperCase();
}

function updateMatchCounts() {
  store.meta.counts = {
    elevenMatches: store.matches.filter((match) => match.channel === 'eleven').length,
    fiveMatches: store.matches.filter((match) => match.channel === 'five').length,
    cancelledMatches: store.matches.filter((match) => match.status === 'cancelled').length,
  };
}

function assignmentContext(groupOrders = store.groupOrders || []) {
  return { referees: store.referees, teams: store.teams || [], groupOrders };
}

function advanceChangedMatches(proposed, previous, fullIds = []) {
  const previousGroupOrders = store.groupOrders || [];
  store.groupOrders = previousGroupOrders.filter((order) => {
    try { normalizeGroupOrder(order, proposed); return true; } catch { return false; }
  });
  const advanced = applyAdvancement(proposed, store.groupOrders, store.teams || []);
  validateAssignmentChanges(advanced, previous, advanced.map((match) => match.id), { fullIds, previousGroupOrders });
  return advanced;
}

function issuesFor(match, matches, groupOrders = store.groupOrders || []) {
  return assignmentIssues(match, matches, store.unavailability || [], assignmentContext(groupOrders));
}

function validateAssignmentChanges(currentMatches, previousMatches, ids, options = {}) {
  const previousGroupOrders = options.previousGroupOrders || store.groupOrders || [];
  const fullIds = new Set(options.fullIds || []);
  const oldMatches = applyAdvancement(previousMatches, previousGroupOrders, store.teams || []);
  for (const match of currentMatches) {
    const old = oldMatches.find((item) => item.id === match.id);
    if (old?.result && match.result && (old.home !== match.home || old.away !== match.away)) {
      throw new Error(`后续比赛 ${match.id} 已有赛果，请先清除或更正该场赛果，再调整上游赛果或晋级来源`);
    }
    if (match.homeSource || match.awaySource) validateMatchAvoidance(match, currentMatches, store.groupOrders || []);
  }
  for (const id of new Set(ids)) {
    const match = currentMatches.find((item) => item.id === id);
    if (!match) continue;
    const old = oldMatches.find((item) => item.id === id);
    const previousIssues = old && !fullIds.has(id) ? issuesFor(old, oldMatches, previousGroupOrders) : [];
    const issues = issuesFor(match, currentMatches).filter((issue) => !previousIssues.includes(issue) && (!options.avoidanceOnly || issue.includes('回避冲突')));
    if (issues.length) throw new Error(issues.join('；'));
  }
}

function refereeForName(rawName, channel) {
  const name = normalizeRefereeName(text(rawName, 40));
  if (!name) return null;
  const sameName = store.referees.filter((referee) => refereeNameKey(referee.name) === refereeNameKey(name));
  const sameChannel = sameName.filter((referee) => referee.channels[channel]);
  if (sameChannel.length > 1 || (!sameChannel.length && sameName.length > 1)) throw new Error('存在同名裁判员，请从列表选择具体档案');
  if (sameChannel.length === 1) return sameChannel[0];
  let referee = sameName[0];
  if (!referee) {
    referee = { id: `referee-${randomUUID()}`, name, channels: {} };
    store.referees.push(referee);
  }
  referee.channels[channel] = initialChannelStats(channel);
  return referee;
}

function validateMatch(input) {
  const date = text(input.date, 10);
  if (!validDate(date)) throw new Error('请选择有效比赛日期');
  const channel = input.channel === 'five' ? 'five' : 'eleven';
  const rawCompetition = text(input.competition, 100);
  const inferredEvent = channel === 'five' && rawCompetition.includes('女足') && rawCompetition.includes('北大杯')
    ? 'womens-pku-cup'
    : channel === 'eleven' && rawCompetition.includes('新生杯')
      ? 'freshmen-cup'
      : channel === 'eleven' && rawCompetition.includes('北大杯') ? 'mens-pku-cup' : null;
  const requestedEvent = text(input.event, 30);
  if (requestedEvent && !Object.hasOwn(eventChannels, requestedEvent)) throw new Error('请选择有效赛事分类');
  const event = requestedEvent || inferredEvent;
  if (!event) throw new Error('仅支持男足新生杯、男足北大杯和女足北大杯');
  if (eventChannels[event] !== channel) throw new Error('赛事分类与赛制不匹配');
  const competition = eventCompetitions[event];
  if (input.additionalAssistants !== undefined && typeof input.additionalAssistants !== 'boolean') throw new Error('附加助理裁判设置不正确');
  const additionalAssistants = Boolean(input.additionalAssistants);
  if (additionalAssistants && channel !== 'eleven') throw new Error('仅十一人制可以设置附加助理裁判');
  const allowedRoles = channel === 'five'
    ? ['first', 'second', 'third']
    : ['referee', 'assistant1', 'assistant2', 'fourth', ...(additionalAssistants ? additionalAssistantRoles : [])];
  const officials = Array.isArray(input.officials) ? input.officials : [];
  if (!additionalAssistants && officials.some((o) => additionalAssistantRoles.includes(o.role))) throw new Error('请先启用两名附加助理裁判');
  const status = ['scheduled', 'completed', 'cancelled'].includes(input.status) ? input.status : 'scheduled';
  const cleanOfficials = status === 'cancelled' ? [] : officials
    .filter((item) => allowedRoles.includes(item.role))
    .map((item) => {
      const refereeId = text(item.refereeId, 80) || null;
      const referee = refereeId ? store.referees.find((item) => item.id === refereeId) : refereeForName(item.name, channel);
      if (refereeId && (!referee || !referee.channels[channel])) throw new Error('裁判员没有对应赛制的档案');
      return {
        role: item.role,
        refereeId: referee?.id || null,
        name: referee?.name || '',
        substitute: Boolean(item.substitute),
      };
    });
  if (additionalAssistants && status !== 'cancelled') for (const role of additionalAssistantRoles) {
    if (!cleanOfficials.some((o) => o.role === role)) cleanOfficials.push({ role, refereeId: null, name: '', substitute: false });
  }
  const stage = input.stage || 'group';
  if (!allowedStages(channel).includes(stage)) throw new Error(channel === 'five' ? '女足北大杯仅支持常规赛、排位赛、半决赛和决赛' : '请选择有效比赛阶段');
  const bonuses = Array.isArray(input.bonuses)
    ? input.bonuses.filter((item) => ['early', 'late', 'weekday', 'badWeather'].includes(item))
    : [];
  const result = {
    id: text(input.id, 80) || `match-${randomUUID()}`,
    season: text(input.season, 30) || '2026–27',
    week: Math.max(1, Math.round(number(input.week) || 1)),
    channel,
    event,
    competition,
    date,
    time: text(input.time, 40),
    venue: text(input.venue, 60) || '未注明',
    group: text(input.group, 40),
    home: normalizeTeamName(text(input.home, 60)),
    away: normalizeTeamName(text(input.away, 60)),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.placementMode !== undefined ? { placementMode: input.placementMode } : {}),
    ...(input.avoidanceOverride !== undefined ? { avoidanceOverride: normalizeMatchAvoidance(input.avoidanceOverride, store.colleges || []) } : {}),
    ...(input.homeSource !== undefined ? { homeSource: input.homeSource } : {}),
    ...(input.awaySource !== undefined ? { awaySource: input.awaySource } : {}),
    homeColor: Object.hasOwn(input, 'homeColor') ? jerseyColor(input.homeColor) : teamColor(store, event, text(input.home, 60)),
    awayColor: Object.hasOwn(input, 'awayColor') ? jerseyColor(input.awayColor) : teamColor(store, event, text(input.away, 60)),
    stage,
    division: ['甲', '乙'].includes(input.division) ? input.division : null,
    status,
    note: text(input.note, 300),
    bonuses: [...new Set(bonuses)],
    officials: cleanOfficials,
    additionalAssistants,
  };
  if (new Set(cleanOfficials.map((o) => o.role)).size !== cleanOfficials.length) throw new Error('同一岗位不能重复');
  if (status !== 'cancelled' && !matchInterval(result)) throw new Error('比赛时间请填写有效的开始和结束时间，例如 12:00-14:00');
  const prospective = store.matches.some((item) => item.id === result.id)
    ? store.matches.map((item) => item.id === result.id ? result : item)
    : [...store.matches, result];
  return validateMatchAvoidance(result, prospective, store.groupOrders || [], { defaultPlacement: true });
}

function validateRules(input) {
  if (!input || !Array.isArray(input.chapters) || !input.chapters.length || input.chapters.length > 30) throw new Error('管理办法章节格式不正确');
  const ids = new Set();
  const chapters = input.chapters.map((chapter) => {
    const id = text(chapter.id, 40);
    const numeral = text(chapter.numeral, 5);
    const title = text(chapter.title, 100);
    if (!id || ids.has(id) || !numeral || !title || !Array.isArray(chapter.blocks)) throw new Error('管理办法章节内容不完整');
    ids.add(id);
    const blocks = chapter.blocks.slice(0, 500).map((block) => {
      if (block.kind === 'table') {
        if (!['eleven', 'five'].includes(block.table)) throw new Error('工资表格式不正确');
        return { kind: 'table', table: block.table };
      }
      if (!['subheading', 'paragraph', 'clause'].includes(block.kind)) throw new Error('管理办法条款格式不正确');
      const value = text(block.text, 10000);
      if (!value) throw new Error('管理办法条款不能为空');
      return block.kind === 'clause'
        ? { kind: 'clause', marker: text(block.marker, 10), text: value }
        : { kind: block.kind, text: value };
    });
    return { id, numeral, title, blocks };
  });
  const wageTables = {};
  for (const channel of ['eleven', 'five']) {
    const table = input.wageTables?.[channel];
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) throw new Error('工资标准表不完整');
    const headers = table.headers.slice(0, 6).map((header) => text(header, 60));
    if (!headers.length || headers.some((header) => !header)) throw new Error('工资标准表头不能为空');
    const rows = table.rows.slice(0, 30).map((row) => {
      if (!Array.isArray(row) || row.length !== headers.length) throw new Error('工资标准表列数不一致');
      return row.map((cell) => text(cell, 30));
    });
    wageTables[channel] = { caption: text(table.caption, 100), headers, rows };
  }
  return { chapters, wageTables };
}

const wageStandardEvents = {
  'freshmen-cup': { levels: ['A', 'B', 'C', 'D', 'E'], columns: 3 },
  'mens-pku-cup': { levels: ['A', 'B', 'C', 'D', 'E'], columns: 3 },
  'womens-pku-cup': { levels: ['A', 'B', 'C'], columns: 2 },
};

function validateWageStandards(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工资标准格式不正确');
  if (Object.keys(input).some((event) => !Object.hasOwn(wageStandardEvents, event))) throw new Error('工资标准包含不支持的赛事');
  const standards = {};
  for (const [event, config] of Object.entries(wageStandardEvents)) {
    const eventStandards = input[event];
    if (!eventStandards || typeof eventStandards !== 'object' || Array.isArray(eventStandards)) throw new Error('工资标准赛事不完整');
    if (Object.keys(eventStandards).some((level) => !config.levels.includes(level))) throw new Error('工资标准包含无效等级');
    standards[event] = {};
    for (const level of config.levels) {
      const rates = eventStandards[level];
      if (!Array.isArray(rates) || rates.length !== config.columns) throw new Error('工资标准岗位金额不完整');
      standards[event][level] = rates.map((rate) => {
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) throw new Error('工资金额必须是有限非负数');
        return rate;
      });
    }
  }
  return standards;
}

app.get('/api/data', (_req, res) => res.json(readableStore(store, auth)));

app.get('/api/standings-results', requireAdmin, async (_req, res, next) => {
  try {
    const source = auth.standingsSourceUrl || 'https://football-standings-api.junkaizhao404.workers.dev/api/records';
    const response = await (auth.standingsFetch || fetch)(source, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`积分榜返回 HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 5 * 1024 * 1024) throw new Error('积分榜数据超过 5 MB');
    res.json({ records: JSON.parse(body), source: source.startsWith('http://127.0.0.1') ? '服务器积分榜' : '线上积分榜' });
  } catch { next(new Error('无法读取积分榜，请检查积分榜服务，或上传积分榜工具导出的 JSON 文件')); }
});
app.post('/api/standings-results/preview', requireAdmin, (req, res, next) => {
  try {
    if (!Object.hasOwn(eventChannels, req.body?.event)) throw new Error('请选择赛事');
    res.json(previewStandingsResults(store, req.body.records, req.body.event, text(req.body.season, 30)));
  } catch (error) { next(error); }
});
app.post('/api/standings-results/import', requireAdmin, async (req, res, next) => {
  try {
    if (!Object.hasOwn(eventChannels, req.body?.event)) throw new Error('请选择赛事');
    const preview = previewStandingsResults(store, req.body.records, req.body.event, text(req.body.season, 30));
    if (!preview.matched.length) return res.json(preview);
    const previousMatches = store.matches;
    const selected = new Map(preview.matched.map((item) => [item.matchId, item.result]));
    const advanced = advanceChangedMatches(previousMatches.map((match) => selected.has(match.id)
      ? { ...match, status: 'completed', result: selected.get(match.id) } : match), previousMatches);
    for (const match of advanced) if (selected.has(match.id)) validateMatchAvoidance(match, advanced, store.groupOrders || []);
    store.matches = advanced;
    await persist(); res.json(preview);
  } catch (error) { next(error); }
});

app.put('/api/teams', requireAdmin, async (req, res, next) => {
  try {
    const event = text(req.body?.event, 30);
    const name = normalizeTeamName(text(req.body?.name, 60));
    if (!Object.hasOwn(eventChannels, event) || !name) throw new Error('请选择赛事并填写球队名称');
    const color = jerseyColor(req.body?.color);
    if (!color) throw new Error('请为球队选择球衣颜色');
    const teams = [...(store.teams || [])];
    const index = teams.findIndex((item) => item.event === event && item.name === name);
    const previous = index >= 0 ? teams[index] : null;
    const colleges = req.body?.colleges === undefined ? previous?.colleges || [] : normalizeColleges(req.body.colleges, store.colleges || []);
    const team = { event, name, color, ...(colleges.length ? { colleges } : {}) };
    if (index >= 0) teams[index] = team; else teams.push(team);
    store.teams = teams;
    await persist(); res.json(team);
  } catch (error) { next(error); }
});
app.delete('/api/teams', requireAdmin, async (req, res, next) => {
  try {
    const event = text(req.query.event, 30), name = normalizeTeamName(text(req.query.name, 60));
    const teams = store.teams || [];
    if (!teams.some((team) => team.event === event && team.name === name)) return res.status(404).json({ error: '该球队尚未绑定颜色' });
    store.teams = teams.filter((team) => team.event !== event || team.name !== name);
    await persist(); res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/colleges', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeCollegeName(req.body?.name);
    if (!name || name.length > 40) throw new Error('学院名称须为 1 至 40 个字符');
    const colleges = [...(store.colleges || [])];
    const key = name.toLocaleLowerCase();
    if (colleges.some((item) => normalizeCollegeName(item).toLocaleLowerCase() === key)) throw new Error('该学院已经登记');
    if (colleges.length >= 100) throw new Error('学院登记最多保留 100 个学院');
    colleges.push(name);
    store.colleges = colleges;
    await persist(); res.status(201).json({ name });
  } catch (error) { next(error); }
});
app.delete('/api/colleges', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeCollegeName(req.query.name), key = name.toLocaleLowerCase();
    if (!key || !(store.colleges || []).some((item) => normalizeCollegeName(item).toLocaleLowerCase() === key)) return res.status(404).json({ error: '该学院尚未登记' });
    const used = store.referees.some((referee) => (referee.avoidanceColleges || []).some((item) => normalizeCollegeName(item).toLocaleLowerCase() === key))
      || (store.teams || []).some((team) => (team.colleges || []).some((item) => normalizeCollegeName(item).toLocaleLowerCase() === key))
      || store.matches.some((match) => (match.avoidanceOverride?.colleges || []).some((item) => normalizeCollegeName(item).toLocaleLowerCase() === key));
    if (used) throw new Error('该学院仍被裁判员、球队或比赛回避设置使用，不能删除');
    store.colleges = (store.colleges || []).filter((item) => normalizeCollegeName(item).toLocaleLowerCase() !== key);
    await persist(); res.status(204).end();
  } catch (error) { next(error); }
});
app.put('/api/group-order', requireAdmin, async (req, res, next) => {
  try {
    const previousOrders = store.groupOrders || [];
    const previousMatches = store.matches;
    const order = normalizeGroupOrder(req.body, previousMatches);
    const seasonKey = normalizeCollegeName(order.season).toLocaleLowerCase();
    const groupKey = normalizeCollegeName(order.group).toLocaleLowerCase();
    const affected = previousMatches.map((match) => match.id);
    store.groupOrders = [...previousOrders.filter((item) => !(item.event === order.event
      && normalizeCollegeName(item.season).toLocaleLowerCase() === seasonKey
      && normalizeCollegeName(item.group).toLocaleLowerCase() === groupKey)), order];
    const advanced = applyAdvancement(previousMatches, store.groupOrders, store.teams || []);
    validateAssignmentChanges(advanced, previousMatches, affected, { previousGroupOrders: previousOrders, avoidanceOnly: true });
    store.matches = advanced;
    await persist(); res.json(order);
  } catch (error) { next(error); }
});

app.put('/api/wage-standards', requireAdmin, async (req, res, next) => {
  try {
    store.wageStandards = validateWageStandards(req.body);
    await persist();
    res.json(store.wageStandards);
  } catch (error) { next(error); }
});

app.delete('/api/wage-standards', requireAdmin, async (_req, res) => {
  delete store.wageStandards;
  await persist();
  res.status(204).end();
});

app.put('/api/rules', requireAdmin, async (req, res, next) => {
  try {
    store.rules = validateRules(req.body);
    await persist();
    res.json(store.rules);
  } catch (error) { next(error); }
});

app.delete('/api/rules', requireAdmin, async (_req, res) => {
  delete store.rules;
  await persist();
  res.status(204).end();
});

app.post('/api/import-assignments', requireAdmin, async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('请选择要上传的 Excel 文件');
    const previousMatches = structuredClone(store.matches);
    const result = importAssignmentWorkbook(store, req.body, text(req.query.season, 30) || '2026–27', text(req.query.event, 30) || 'freshmen-cup');
    // Validate changed matches in the transaction; unrelated old conflicts do not block imports.
    const oldMatches = applyAdvancement(previousMatches, store.groupOrders || [], store.teams || []);
    const changedIds = store.matches.filter((match) => {
      const old = oldMatches.find((item) => item.id === match.id);
      return !old || JSON.stringify(old) !== JSON.stringify(match);
    }).map((match) => match.id);
    store.matches = advanceChangedMatches(store.matches, previousMatches, changedIds);
    await persist();
    res.json(result);
  } catch (error) { next(error); }
});

app.post('/api/matches', requireAdmin, async (req, res, next) => {
  try {
    const match = validateMatch(req.body);
    if (store.matches.some((item) => item.id === match.id)) throw new Error('比赛编号已经存在');
    const previousMatches = store.matches;
    const advanced = advanceChangedMatches([...previousMatches, match], previousMatches, [match.id]);
    store.matches = advanced;
    updateMatchCounts();
    await persist();
    res.status(201).json(store.matches.find((item) => item.id === match.id));
  } catch (error) { next(error); }
});

app.put('/api/matches/:id', requireAdmin, async (req, res, next) => {
  try {
    const index = store.matches.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: '未找到该比赛' });
    const match = validateMatch({ ...req.body, id: req.params.id });
    const previousMatches = store.matches;
    const advanced = advanceChangedMatches(previousMatches.map((item) => item.id === match.id ? match : item), previousMatches, [match.id]);
    store.matches = advanced;
    updateMatchCounts();
    await persist();
    res.json(store.matches.find((item) => item.id === match.id));
  } catch (error) { next(error); }
});

app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
  const index = store.matches.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到该比赛' });
  if (store.adjustments.some((item) => item.matchId === req.params.id)) {
    return res.status(400).json({ error: '该比赛已关联奖惩记录，请先删除相关奖惩记录后再删除比赛' });
  }
  if (store.matches.some((item) => item.id !== req.params.id
    && [item.homeSource, item.awaySource].some((source) => source?.kind === 'match' && source.matchId === req.params.id))) {
    return res.status(400).json({ error: '该比赛仍被后续对阵引用，请先调整晋级来源' });
  }
  const previousMatches = store.matches;
  const proposed = previousMatches.filter((item) => item.id !== req.params.id);
  const advanced = advanceChangedMatches(proposed, previousMatches);
  store.matches = advanced;
  updateMatchCounts();
  await persist();
  res.status(204).end();
});

app.post('/api/referees', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeRefereeName(text(req.body?.name, 40));
    if (!name) throw new Error('请输入裁判员姓名');
    const channel = req.body?.channel === 'five' ? 'five' : 'eleven';
    if (store.referees.some((item) => refereeNameKey(item.name) === refereeNameKey(name) && item.channels[channel])) throw new Error('该渠道已存在同名裁判，请在原记录中处理');
    const referee = refereeForName(name, channel);
    await persist();
    res.status(201).json(referee);
  } catch (error) { next(error); }
});

app.put('/api/referees/:id/avoidance', requireAdmin, async (req, res, next) => {
  try {
    const referee = store.referees.find((item) => item.id === req.params.id);
    if (!referee) return res.status(404).json({ error: '未找到该裁判员' });
    referee.avoidanceColleges = normalizeColleges(req.body?.colleges, store.colleges || []);
    await persist(); res.json(referee);
  } catch (error) { next(error); }
});

app.put('/api/referees/:id/level', requireAdmin, async (req, res, next) => {
  try {
    const referee = store.referees.find((item) => item.id === req.params.id);
    if (!referee) return res.status(404).json({ error: '未找到该裁判员' });
    const channel = text(req.body?.channel, 10);
    if (!['eleven', 'five'].includes(channel) || !referee.channels[channel]) throw new Error('该裁判没有对应渠道档案');
    const level = text(req.body?.level, 1).toUpperCase();
    if (level && !(channel === 'five' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E']).includes(level)) throw new Error('请选择有效裁判等级');
    if (level) referee.channels[channel].levelOverride = level;
    else delete referee.channels[channel].levelOverride;
    await persist();
    res.json(referee);
  } catch (error) { next(error); }
});

app.post('/api/adjustments', requireAdmin, async (req, res, next) => {
  try {
    const match = store.matches.find((item) => item.id === req.body?.matchId);
    if (!match) throw new Error('请选择有效的关联比赛');
    const referee = store.referees.find((item) => item.id === req.body?.refereeId);
    if (!referee) throw new Error('请选择有效裁判员');
    if (!match.officials.some((official) => official.refereeId === referee.id)) throw new Error('只能为该场比赛已选派的裁判员登记奖惩');
    const channel = match.channel;
    if (!referee.channels[channel]) throw new Error('该裁判没有对应渠道档案');
    const event = getMatchEvent(match);
    if (!event || eventChannels[event] !== channel) throw new Error('关联比赛的赛事归属不正确');
    const reason = text(req.body?.reason, 300);
    if (!reason) throw new Error('请填写奖惩事由');
    const sign = req.body?.type === 'penalty' ? -1 : 1;
    if (!number(req.body?.points) && !number(req.body?.wage)) throw new Error('请至少填写一项积分或工资变动');
    const adjustment = {
      id: `adjustment-${randomUUID()}`,
      matchId: match.id,
      refereeId: referee.id,
      channel,
      season: match.season || store.meta.season,
      event,
      date: match.date,
      type: req.body?.type === 'penalty' ? 'penalty' : 'reward',
      points: sign * Math.abs(number(req.body?.points)),
      wage: sign * Math.abs(number(req.body?.wage)),
      reason,
    };
    store.adjustments.push(adjustment);
    await persist();
    res.status(201).json(adjustment);
  } catch (error) { next(error); }
});

app.delete('/api/adjustments/:id', requireAdmin, async (req, res) => {
  const index = store.adjustments.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到该奖惩记录' });
  store.adjustments.splice(index, 1);
  await persist();
  res.status(204).end();
});


  registerManagement(app, { getStore: () => store, setStore: (value) => { store = value; }, persist, requireAdmin, repository, auth, validateRules, validateWageStandards, text });
  return app.dispatch();
}

function registerManagement(app, { getStore, setStore, persist, requireAdmin, repository, auth, validateRules, validateWageStandards, text }) {
  app.get('/api/session', (_req, res) => res.json({ authenticated: auth.authenticated, development: auth.development }));
  app.post('/api/login', async (req, res) => {
    const cookie = await auth.login?.(req.body?.password);
    if (!cookie) return res.status(401).json({ error: '管理员密码不正确' });
    res.setHeader('Set-Cookie', cookie).json({ authenticated: true });
  });
  app.post('/api/logout', requireAdmin, (_req, res) => {
    auth.logout?.();
    res.setHeader('Set-Cookie', 'pkufa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ authenticated: false, platform: !auth.development });
  });
  app.post('/api/unavailability', requireAdmin, async (req, res, next) => {
    try {
      const store = getStore();
      const { refereeId, start, end } = req.body;
      if (!store.referees.some((r) => r.id === refereeId)) throw new Error('请选择裁判员');
      if (!validDate(start) || !validDate(end) || start > end) throw new Error('请选择有效的起止日期');
      if ((store.unavailability || []).some((l) => l.refereeId === refereeId && l.start <= end && l.end >= start)) throw new Error('该裁判已有重叠的请假记录');
      const leave = { id: `leave-${randomUUID()}`, refereeId, start, end, reason: text(req.body.reason, 200) };
      store.unavailability = [...(store.unavailability || []), leave];
      await persist(); res.status(201).json(leave);
    } catch (error) { next(error); }
  });
  app.delete('/api/unavailability/:id', requireAdmin, async (req, res, next) => {
    try {
      const store = getStore();
      if (!(store.unavailability || []).some((l) => l.id === req.params.id)) return res.status(404).json({ error: '记录不存在' });
      store.unavailability = store.unavailability.filter((l) => l.id !== req.params.id);
      await persist(); res.status(204).end();
    } catch (error) { next(error); }
  });
  app.get('/api/backups', requireAdmin, async (_req, res) => res.json(await repository.history()));
  app.get('/api/backups/:id', requireAdmin, async (req, res) => {
    const data = await repository.snapshot(Number(req.params.id));
    if (!data) return res.status(404).json({ error: '备份不存在' });
    res.json({ format: 'pkufa-referees-v1', exportedAt: new Date().toISOString(), data });
  });
  app.post('/api/restore', requireAdmin, async (req, res, next) => {
    try {
      const restored = validateSnapshot(req.body);
      restored.matches = applyAdvancement(restored.matches, restored.groupOrders || []);
      setStore(restored);
      if (restored.rules) restored.rules = validateRules(restored.rules);
      if (restored.wageStandards) restored.wageStandards = validateWageStandards(restored.wageStandards);
      await persist(); res.json({ revision: getStore().revision });
    } catch (error) { next(error); }
  });
}
