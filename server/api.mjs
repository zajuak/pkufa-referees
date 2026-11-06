import { readableStore } from './access.mjs';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { importAssignmentWorkbook } from './assignment-import.mjs';
import { assignmentIssues, matchInterval } from '../src/domain/scheduling.ts';
import { Router } from './router.mjs';
import { validateSnapshot } from './validation.mjs';

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function handleApi(request, repository, auth) {
  const before = await repository.load();
  let store = structuredClone(before);
  const app = new Router(request);
  const requireAdmin = (_req, res, next) => auth.authenticated ? next() : res.status(401).json({ error: '请先登录管理员账号' });
  const persist = async () => {
    const supplied = request.headers.get('If-Match');
    if (supplied === null) throw Object.assign(new Error('请刷新页面后再保存'), { status: 428 });
    if (Number(supplied) !== (before.revision || 0)) throw Object.assign(new Error('数据已被其他窗口更新，请刷新后重新编辑；本次修改尚未保存'), { status: 409 });
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
  const allowedRoles = channel === 'five'
    ? ['first', 'second', 'third']
    : ['referee', 'assistant1', 'assistant2', 'fourth'];
  const officials = Array.isArray(input.officials) ? input.officials : [];
  const status = ['scheduled', 'completed', 'cancelled'].includes(input.status) ? input.status : 'scheduled';
  const cleanOfficials = status === 'cancelled' ? [] : officials
    .filter((item) => allowedRoles.includes(item.role))
    .map((item) => {
      const refereeId = text(item.refereeId, 80) || null;
      const referee = refereeId ? store.referees.find((item) => item.id === refereeId) : null;
      if (refereeId && (!referee || !referee.channels[channel])) throw new Error('裁判员没有对应赛制的档案');
      return {
        role: item.role,
        refereeId,
        name: referee?.name || text(item.name, 40),
        substitute: Boolean(item.substitute),
      };
    });
  const stage = ['group', 'knockout', 'semifinal', 'final', 'third'].includes(input.stage) ? input.stage : 'group';
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
    home: text(input.home, 60),
    away: text(input.away, 60),
    homeColor: jerseyColor(input.homeColor),
    awayColor: jerseyColor(input.awayColor),
    stage,
    division: ['甲', '乙'].includes(input.division) ? input.division : null,
    status,
    note: text(input.note, 300),
    bonuses: [...new Set(bonuses)],
    officials: cleanOfficials,
  };
  if (new Set(cleanOfficials.map((o) => o.role)).size !== cleanOfficials.length) throw new Error('同一岗位不能重复');
  if (status !== 'cancelled' && !matchInterval(result)) throw new Error('比赛时间请填写有效的开始和结束时间，例如 12:00-14:00');
  const issues = assignmentIssues(result, store.matches, store.unavailability || []);
  if (issues.length) throw new Error(issues.join('；'));
  return result;
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
    const result = importAssignmentWorkbook(store, req.body, text(req.query.season, 30) || '2026–27', text(req.query.event, 30) || 'freshmen-cup');
    // Import is validated as one transaction; a conflict leaves the stored data untouched.
    for (const match of store.matches) {
      const issues = assignmentIssues(match, store.matches, store.unavailability || []);
      if (issues.length && !before.matches.some((old) => old.id === match.id && JSON.stringify(old) === JSON.stringify(match))) throw new Error(issues.join('；'));
    }
    await persist();
    res.json(result);
  } catch (error) { next(error); }
});

app.post('/api/matches', requireAdmin, async (req, res, next) => {
  try {
    const match = validateMatch(req.body);
    store.matches.push(match);
    updateMatchCounts();
    await persist();
    res.status(201).json(match);
  } catch (error) { next(error); }
});

app.put('/api/matches/:id', requireAdmin, async (req, res, next) => {
  try {
    const index = store.matches.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: '未找到该比赛' });
    const match = validateMatch({ ...req.body, id: req.params.id });
    store.matches[index] = match;
    updateMatchCounts();
    await persist();
    res.json(match);
  } catch (error) { next(error); }
});

app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
  const index = store.matches.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到该比赛' });
  store.matches.splice(index, 1);
  updateMatchCounts();
  await persist();
  res.status(204).end();
});

app.post('/api/referees', requireAdmin, async (req, res, next) => {
  try {
    const name = text(req.body?.name, 40);
    if (!name) throw new Error('请输入裁判员姓名');
    const channel = req.body?.channel === 'five' ? 'five' : 'eleven';
    const emptyStats = () => ({
      basePoints: 0,
      baseLevel: channel === 'five' ? 'C' : 'E',
      previousWage: 0,
      historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 },
    });
    let referee = store.referees.find((item) => item.name === name && !item.channels[channel]);
    if (referee) {
      referee.channels[channel] = emptyStats();
    } else {
      if (store.referees.some((item) => item.name === name)) throw new Error('该渠道已存在同名裁判，请在原记录中处理');
      referee = { id: `referee-${randomUUID()}`, name, channels: { [channel]: emptyStats() } };
      store.referees.push(referee);
    }
    await persist();
    res.status(201).json(referee);
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
    const referee = store.referees.find((item) => item.id === req.body?.refereeId);
    if (!referee) throw new Error('请选择有效裁判员');
    const channel = req.body?.channel === 'five' ? 'five' : 'eleven';
    if (!referee.channels[channel]) throw new Error('该裁判没有对应渠道档案');
    const event = text(req.body?.event, 30);
    if (event && !Object.hasOwn(eventChannels, event)) throw new Error('请选择赛事归属');
    if (event && eventChannels[event] !== channel) throw new Error('赛事归属与渠道不匹配');
    const reason = text(req.body?.reason, 300);
    if (!reason) throw new Error('请填写奖惩事由');
    const sign = req.body?.type === 'penalty' ? -1 : 1;
    if (!number(req.body?.points) && !number(req.body?.wage)) throw new Error('请至少填写一项积分或工资变动');
    const adjustment = {
      id: `adjustment-${randomUUID()}`,
      refereeId: referee.id,
      channel,
      season: text(req.body?.season, 30) || '2026–27',
      ...(event ? { event } : {}),
      date: text(req.body?.date, 10) || new Date().toISOString().slice(0, 10),
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
      setStore(restored);
      if (restored.rules) restored.rules = validateRules(restored.rules);
      if (restored.wageStandards) restored.wageStandards = validateWageStandards(restored.wageStandards);
      await persist(); res.json({ revision: getStore().revision });
    } catch (error) { next(error); }
  });
}
