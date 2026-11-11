import { describe, expect, it } from 'vitest';
import type { CompetitionEvent, DataStore, Match, Referee, Team } from '../src/domain/types';
import { analyzeAvoidance, applyAdvancement, avoidanceTeams, groupStandings, resolveMatchTeams } from '../src/domain/avoidance';
import { assignmentIssues, assignmentWarnings } from '../src/domain/scheduling';
import { initialChannelStats } from '../src/domain/referees';
// @ts-expect-error Shared Fetch API is implemented in Node ESM.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Snapshot validator is shared by Node and Worker.
import { validateSnapshot } from '../server/validation.mjs';

const season = '2026–27';

function makeMatch(id = 'm1', overrides: Partial<Match> = {}): Match {
  return {
    id, season, week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯',
    date: '2026-11-14', time: '12:00-14:00', venue: '测试场', group: 'A',
    home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'scheduled',
    note: '', bonuses: [], officials: [], ...overrides,
  };
}

function makeTeam(name: string, colleges: string[] = [], event: CompetitionEvent = 'freshmen-cup'): Team {
  return { event, name, color: '#123456', ...(colleges.length ? { colleges } : {}) };
}

function makeReferee(id = 'r1', avoidanceColleges: string[] = ['甲学院'], name = '测试裁判'): Referee {
  return { id, name, channels: { eleven: initialChannelStats('eleven') }, avoidanceColleges };
}

function seed(): DataStore {
  return {
    version: 1, revision: 0,
    meta: { association: '测试', season, rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } },
    referees: [], matches: [], adjustments: [],
  };
}

function apiFixture(initial = seed()) {
  let data = structuredClone(initial);
  let writes = 0;
  const repository = {
    async load() { return structuredClone(data); },
    async save(next: DataStore) { data = structuredClone(next); writes++; },
  };
  return {
    get data() { return data; },
    get writes() { return writes; },
    call(method: string, path: string, body?: unknown) {
      return handleApi(new Request('https://test' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'If-Match': String(data.revision || 0) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }), repository, { authenticated: true, publicQueries: true });
    },
  };
}

const itemNames = (match: Match, matches: Match[], teams: Team[] = []) => avoidanceTeams(match, matches, teams).items.map((item) => item.name);

describe('学院回避与赛程作用域', () => {
  it('多学院裁判与多学院联合球队按具体学院和球队报告冲突，无关学院不报错', () => {
    const match = makeMatch('joint', {
      home: '联合队', away: '对手队',
      officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }],
    });
    const teams = [makeTeam('联合队', ['丙学院', '乙学院']), makeTeam('对手队', ['丁学院'])];
    const analysis = analyzeAvoidance(match, [match], [makeReferee('r1', ['甲学院', '乙学院'])], teams);
    expect(analysis.issues).toEqual(['测试裁判（主裁判）的回避学院“乙学院”与球队“联合队”（本场主队）存在回避冲突']);
    expect(analysis.warnings).toEqual([]);
    expect(assignmentIssues(match, [match], [], { referees: [makeReferee('r1', ['甲学院', '乙学院'])], teams })).toEqual(analysis.issues);
    expect(analyzeAvoidance(match, [match], [makeReferee('r1', ['甲学院', '戊学院'])], teams)).toEqual({ issues: [], warnings: [] });
  });

  it('五人制即使直接域调用含晋级来源和后续引用，也只检查本场解析后的双方', () => {
    const quarterfinal = makeMatch('qf', { home: '源主队', away: '源客队', stage: 'knockout', status: 'completed', result: { home: 2, away: 0 } });
    const current = makeMatch('five-current', {
      channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage: 'semifinal',
      home: '旧主队', away: '当前客队', homeSource: { kind: 'match', matchId: 'qf', outcome: 'winner' },
      officials: [{ role: 'first', refereeId: 'r1', name: '测试裁判' }],
    });
    const next = makeMatch('five-next', {
      channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage: 'final',
      home: '', away: '后续对手', homeSource: { kind: 'match', matchId: current.id, outcome: 'winner' },
    });
    const matches = [quarterfinal, current, next];
    const teams = [makeTeam('源主队', ['乙学院'], 'womens-pku-cup'), makeTeam('当前客队', ['乙学院'], 'womens-pku-cup'), makeTeam('后续对手', ['甲学院'], 'womens-pku-cup')];
    expect(itemNames(current, matches, teams)).toEqual(['源主队', '当前客队']);
    expect(analyzeAvoidance(current, matches, [makeReferee()], teams)).toEqual({ issues: [], warnings: [] });
    const snapshot = { ...seed(), matches: [{ ...current, officials: [] }] };
    expect(() => validateSnapshot(snapshot)).toThrow('仅十一人制淘汰赛、半决赛、决赛和季军赛可以设置晋级来源');
  });

  it.each([
    { stage: 'group' as const, placementMode: undefined, reason: '同组小组赛球队' },
    { stage: 'placement' as const, placementMode: 'grouped' as const, reason: '同组排位赛球队' },
  ])('$stage 包含同赛事赛季组别的全部球队并隔离其他组别赛事赛季', ({ stage, placementMode, reason }) => {
    const current = makeMatch('current', { stage, placementMode, home: '甲', away: '乙' });
    const sameGroup = makeMatch('same', { stage, placementMode, home: '丙', away: '丁' });
    const otherGroup = makeMatch('group-b', { stage, placementMode, group: 'B', home: '戊', away: '己' });
    const otherEvent = makeMatch('event', { stage, placementMode, event: 'mens-pku-cup', competition: '男足北大杯', home: '庚', away: '辛' });
    const otherSeason = makeMatch('season', { stage, placementMode, season: '2027–28', home: '壬', away: '癸' });
    const matches = [current, sameGroup, otherGroup, otherEvent, otherSeason];
    const related = avoidanceTeams(current, matches);
    expect(related.items.map((item) => item.name)).toEqual(['甲', '乙', '丙', '丁']);
    expect(related.items.find((item) => item.name === '丙')?.reason).toBe(reason);
  });

  it('单场排位赛只检查当前双方，不扩展到同组其他排位赛', () => {
    const current = makeMatch('single', { stage: 'placement', placementMode: 'single', home: '甲', away: '乙' });
    const other = makeMatch('other', { stage: 'placement', placementMode: 'grouped', home: '丙', away: '丁' });
    expect(itemNames(current, [current, other])).toEqual(['甲', '乙']);
  });

  it('球队或裁判缺少学院绑定时只产生警告，不产生回避问题', () => {
    const match = makeMatch('unbound', { officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] });
    const referee = makeReferee('r1', []);
    const teams = [makeTeam('测试甲'), makeTeam('测试乙')];
    const analysis = analyzeAvoidance(match, [match], [referee], teams);
    expect(analysis.issues).toEqual([]);
    expect(analysis.warnings).toEqual(expect.arrayContaining([
      '球队“测试甲”未绑定学院，无法完整检查回避',
      '球队“测试乙”未绑定学院，无法完整检查回避',
      '测试裁判（主裁判）未绑定回避学院，无法完整检查回避',
    ]));
    expect(assignmentIssues(match, [match], [], { referees: [referee], teams })).toEqual([]);
    expect(assignmentWarnings(match, [match], [], { referees: [referee], teams })).toEqual(analysis.warnings);
  });

  it('取消比赛完全跳过回避检查和缺失绑定警告', () => {
    const match = makeMatch('cancelled', {
      status: 'cancelled', officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }],
    });
    expect(avoidanceTeams(match, [match])).toEqual({ items: [], warnings: [] });
    expect(analyzeAvoidance(match, [match], [makeReferee()], [])).toEqual({ issues: [], warnings: [] });
    expect(assignmentIssues(match, [match], [], { referees: [makeReferee()], teams: [] })).toEqual([]);
    expect(assignmentWarnings(match, [match], [], { referees: [makeReferee()], teams: [] })).toEqual([]);
  });
});

describe('淘汰赛后续候选回避', () => {
  it.each(['knockout', 'semifinal'] as const)('%s 在赛果前收集后续对阵两个席位的候选球队', (stage) => {
    const current = makeMatch(stage, { stage, home: '甲', away: '乙' });
    const next = makeMatch(`${stage}-next`, {
      stage: stage === 'knockout' ? 'semifinal' : 'final', home: '', away: '另一场胜者',
      homeSource: { kind: 'match', matchId: current.id, outcome: 'winner' },
    });
    const result = avoidanceTeams(current, [current, next], [makeTeam('甲'), makeTeam('乙'), makeTeam('另一场胜者')]);
    expect(result.items.map((item) => item.name)).toEqual(['甲', '乙', '另一场胜者']);
    expect(result.warnings).not.toContain('未找到后续对阵，仅检查当前参赛球队');
  });

  it('半决赛胜者和负者分别进入决赛与季军赛，赛果后各自候选收缩', () => {
    const first = makeMatch('s1', { stage: 'semifinal', home: '甲', away: '乙', group: '' });
    const second = makeMatch('s2', { stage: 'semifinal', home: '丙', away: '丁', group: '' });
    const final = makeMatch('final', {
      stage: 'final', group: '', home: '', away: '',
      homeSource: { kind: 'match', matchId: 's1', outcome: 'winner' },
      awaySource: { kind: 'match', matchId: 's2', outcome: 'winner' },
    });
    const third = makeMatch('third', {
      stage: 'third', group: '', home: '', away: '',
      homeSource: { kind: 'match', matchId: 's1', outcome: 'loser' },
      awaySource: { kind: 'match', matchId: 's2', outcome: 'loser' },
    });
    const matches = [first, second, final, third];
    expect(itemNames(first, matches).sort()).toEqual(['丁', '丙', '乙', '甲'].sort());
    expect(resolveMatchTeams(final, matches).homeCandidates).toEqual(['甲', '乙']);
    expect(resolveMatchTeams(third, matches).awayCandidates).toEqual(['丙', '丁']);

    const completed = matches.map((match) => match.id === 's1' ? { ...match, status: 'completed' as const, result: { home: 2, away: 0 } } : match);
    expect(resolveMatchTeams(final, completed)).toMatchObject({ home: '甲', homeCandidates: ['甲'] });
    expect(resolveMatchTeams(third, completed)).toMatchObject({ home: '乙', homeCandidates: ['乙'] });
    const items = avoidanceTeams(first, completed).items;
    expect(items.find((item) => item.name === '甲')?.reason).toContain('后续决赛候选球队');
    expect(items.find((item) => item.name === '甲')?.reason).not.toContain('后续季军赛候选球队');
    expect(items.find((item) => item.name === '乙')?.reason).toContain('后续季军赛候选球队');
    expect(items.find((item) => item.name === '乙')?.reason).not.toContain('后续决赛候选球队');
    expect(items.find((item) => item.name === '丙')?.reason).toContain('后续决赛候选球队');
    expect(items.find((item) => item.name === '丙')?.reason).toContain('后续季军赛候选球队');
  });

  it('决赛没有后续对阵时不产生缺失后续警告', () => {
    const final = makeMatch('final-only', { stage: 'final', home: '甲', away: '乙' });
    const result = avoidanceTeams(final, [final], [makeTeam('甲'), makeTeam('乙')]);
    expect(result.items).toEqual([
      { name: '甲', colleges: [], reason: '本场主队' },
      { name: '乙', colleges: [], reason: '本场客队' },
    ]);
    expect(result.warnings).not.toContain('未找到后续对阵，仅检查当前参赛球队');
  });
});

describe('小组积分与晋级解析', () => {
  it('只累计已完成且比分合法的同组比赛，按胜三平一负零计算', () => {
    const matches = [
      makeMatch('win', { home: '甲', away: '乙', status: 'completed', result: { home: 2, away: 0 } }),
      makeMatch('draw', { home: '丙', away: '丁', status: 'completed', result: { home: 1, away: 1 } }),
      makeMatch('scheduled', { home: '甲', away: '丙', result: { home: 9, away: 0 } }),
      makeMatch('invalid', { home: '甲', away: '丁', status: 'completed', result: { home: -1, away: 0 } }),
      makeMatch('cancelled', { home: '甲', away: '乙', status: 'cancelled', result: { home: 9, away: 0 } }),
      makeMatch('other-group', { group: 'B', home: '甲', away: '乙', status: 'completed', result: { home: 9, away: 0 } }),
      makeMatch('other-event', { event: 'mens-pku-cup', competition: '男足北大杯', home: '甲', away: '丙', status: 'completed', result: { home: 9, away: 0 } }),
      makeMatch('other-season', { season: '2027–28', home: '甲', away: '丁', status: 'completed', result: { home: 9, away: 0 } }),
    ];
    const rows = groupStandings(matches, 'freshmen-cup', season, 'A');
    const byTeam = new Map(rows.map((row) => [row.team, row]));
    expect(byTeam.get('甲')).toMatchObject({ played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3, rank: 1 });
    expect(byTeam.get('乙')).toMatchObject({ played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2, goalDifference: -2, points: 0, rank: 4 });
    for (const name of ['丙', '丁']) expect(byTeam.get(name)).toMatchObject({ played: 1, draws: 1, goalsFor: 1, goalsAgainst: 1, goalDifference: 0, points: 1, rank: 2, tied: true });
  });

  it('同分且相互战绩相同时依次使用总净胜球和总进球数', () => {
    const goalDifference = [
      makeMatch('gd1', { group: 'GD', home: '甲', away: '丙', status: 'completed', result: { home: 3, away: 0 } }),
      makeMatch('gd2', { group: 'GD', home: '乙', away: '丁', status: 'completed', result: { home: 2, away: 0 } }),
    ];
    expect(groupStandings(goalDifference, 'freshmen-cup', season, 'GD').slice(0, 2).map((row) => row.team)).toEqual(['甲', '乙']);
    const goalsFor = [
      makeMatch('gf1', { group: 'GF', home: '甲', away: '丙', status: 'completed', result: { home: 2, away: 0 } }),
      makeMatch('gf2', { group: 'GF', home: '乙', away: '丁', status: 'completed', result: { home: 3, away: 1 } }),
    ];
    const rows = groupStandings(goalsFor, 'freshmen-cup', season, 'GF');
    expect(rows.slice(0, 2).map((row) => [row.team, row.goalDifference, row.goalsFor])).toEqual([['乙', 2, 3], ['甲', 2, 2]]);
  });

  it('同分时相互战绩优先于总净胜球', () => {
    const matches = [
      makeMatch('h2h', { home: '甲', away: '乙', status: 'completed', result: { home: 1, away: 0 } }),
      makeMatch('a-c', { home: '甲', away: '丙', status: 'completed', result: { home: 0, away: 5 } }),
      makeMatch('b-c', { home: '乙', away: '丙', status: 'completed', result: { home: 0, away: 1 } }),
    ];
    const rows = groupStandings(matches, 'freshmen-cup', season, 'A');
    expect(rows.map((row) => row.team)).toEqual(['丙', '甲', '乙']);
    expect(rows.find((row) => row.team === '甲')?.goalDifference).toBeLessThan(rows.find((row) => row.team === '乙')!.goalDifference);
  });

  it('完全并列保留名次和并列球队，显式排序只打破剩余并列', () => {
    const matches = [
      makeMatch('a-c', { home: '甲', away: '丙', status: 'completed', result: { home: 2, away: 0 } }),
      makeMatch('b-c', { home: '乙', away: '丙', status: 'completed', result: { home: 2, away: 0 } }),
    ];
    const tied = groupStandings(matches, 'freshmen-cup', season, 'A');
    expect(tied.map((row) => [row.team, row.rank, row.tied])).toEqual([['甲', 1, true], ['乙', 1, true], ['丙', 3, false]]);
    expect(tied[0].tiedWith).toEqual(['乙']);
    const ordered = groupStandings(matches, 'freshmen-cup', season, 'A', 'group', [{ event: 'freshmen-cup', season, group: 'A', teams: ['丙', '乙', '甲'] }]);
    expect(ordered.map((row) => [row.team, row.rank, row.tied])).toEqual([['乙', 1, false], ['甲', 2, false], ['丙', 3, false]]);
  });

  it('applyAdvancement 物化小组名次以及比赛胜者负者且不修改原赛程', () => {
    const group = makeMatch('group', { home: '甲', away: '乙', status: 'completed', result: { home: 2, away: 0 } });
    const byGroup = makeMatch('by-group', {
      stage: 'knockout', home: '', away: '',
      homeSource: { kind: 'group', group: 'A', rank: 1 }, awaySource: { kind: 'group', group: 'A', rank: 2 },
    });
    const semifinal = makeMatch('sf', { stage: 'semifinal', home: '丙', away: '丁', status: 'completed', result: { home: 1, away: 3 } });
    const final = makeMatch('final', { stage: 'final', home: '', away: '戊', homeSource: { kind: 'match', matchId: 'sf', outcome: 'winner' } });
    const third = makeMatch('third', { stage: 'third', home: '', away: '戊', homeSource: { kind: 'match', matchId: 'sf', outcome: 'loser' } });
    const matches = [group, byGroup, semifinal, final, third];
    const advanced = applyAdvancement(matches);
    expect(advanced.find((match) => match.id === 'by-group')).toMatchObject({ home: '甲', away: '乙' });
    expect(advanced.find((match) => match.id === 'final')?.home).toBe('丁');
    expect(advanced.find((match) => match.id === 'third')?.home).toBe('丙');
    expect(matches.find((match) => match.id === 'by-group')).toMatchObject({ home: '', away: '' });
  });
});

describe('回避与晋级服务端接口', () => {
  it('管理员绑定学院后执行冲突拦截、无冲突保存、赛果晋级和引用删除保护', async () => {
    const f = apiFixture();
    for (const name of ['甲学院', '乙学院', '丙学院']) expect((await f.call('POST', '/api/colleges', { name })).status).toBe(201);
    for (const [name, colleges] of [['联合队', ['甲学院', '乙学院']], ['对手队', ['丙学院']], ['中立队', ['丙学院']]] as const) {
      expect((await f.call('PUT', '/api/teams', { event: 'freshmen-cup', name, color: '#123456', colleges })).status).toBe(200);
    }
    const created = await f.call('POST', '/api/referees', { name: '测试裁判', channel: 'eleven' });
    expect(created.status).toBe(201);
    const referee = await created.json();
    expect((await f.call('PUT', `/api/referees/${referee.id}/avoidance`, { colleges: ['甲学院', '乙学院'] })).status).toBe(200);
    const official = { role: 'referee' as const, refereeId: referee.id, name: '测试裁判' };

    const revision = f.data.revision;
    const writes = f.writes;
    const conflict = await f.call('POST', '/api/matches', makeMatch('conflict', { home: '联合队', away: '对手队', officials: [official] }));
    expect(conflict.status).toBe(400);
    expect((await conflict.json()).error).toContain('测试裁判（主裁判）的回避学院“甲学院”与球队“联合队”（本场主队）存在回避冲突');
    expect(f.data.revision).toBe(revision);
    expect(f.writes).toBe(writes);
    expect(f.data.matches).toHaveLength(0);

    expect((await f.call('POST', '/api/matches', makeMatch('safe', { home: '对手队', away: '中立队', officials: [official] }))).status).toBe(201);
    const source = makeMatch('source', { stage: 'knockout', group: '', home: '联合队', away: '对手队' });
    expect((await f.call('POST', '/api/matches', source)).status).toBe(201);
    const final = makeMatch('final', { stage: 'final', group: '', home: '', away: '中立队', homeSource: { kind: 'match', matchId: 'source', outcome: 'winner' } });
    expect((await f.call('POST', '/api/matches', final)).status).toBe(201);
    expect((await f.call('PUT', '/api/matches/source', { ...source, status: 'completed', result: { home: 2, away: 1 } })).status).toBe(200);
    expect(f.data.matches.find((match) => match.id === 'final')?.home).toBe('联合队');

    const beforeInvalid = f.data.revision;
    const tied = await f.call('POST', '/api/matches', makeMatch('tied', { stage: 'knockout', home: '对手队', away: '中立队', status: 'completed', result: { home: 1, away: 1 } }));
    expect(tied.status).toBe(400);
    expect((await tied.json()).error).toContain('必须填写不相等的点球比分');
    expect(f.data.revision).toBe(beforeInvalid);
    const deletion = await f.call('DELETE', '/api/matches/source');
    expect(deletion.status).toBe(400);
    expect((await deletion.json()).error).toContain('仍被后续对阵引用');
    expect(f.data.revision).toBe(beforeInvalid);
    expect(validateSnapshot(f.data).matches).toHaveLength(3);
  });

  it('小组排序接口要求完整球队名单并据剩余并列自动更新晋级球队', async () => {
    const initial = seed();
    initial.matches = [
      makeMatch('draw', { home: '甲', away: '乙', status: 'completed', result: { home: 1, away: 1 } }),
      makeMatch('derived', { stage: 'knockout', home: '', away: '丙', homeSource: { kind: 'group', group: 'A', rank: 1 } }),
    ];
    const f = apiFixture(initial);
    expect((await f.call('PUT', '/api/group-order', { event: 'freshmen-cup', season, group: 'A', teams: ['乙'] })).status).toBe(400);
    expect(f.data.revision).toBe(0);
    expect((await f.call('PUT', '/api/group-order', { event: 'freshmen-cup', season, group: 'A', teams: ['乙', '甲'] })).status).toBe(200);
    expect(f.data.matches.find((match) => match.id === 'derived')?.home).toBe('乙');
    expect(validateSnapshot(f.data).groupOrders?.[0].teams).toEqual(['乙', '甲']);
  });

  it('旧快照无需新字段，循环引用、重复晋级席位、未知学院和跨赛事来源会被拒绝', () => {
    const old = seed();
    old.matches = [makeMatch('old', { status: 'completed', result: { home: 1, away: 0 } })];
    const validated = validateSnapshot(old);
    expect(validated).toEqual(old);
    expect(validated).not.toBe(old);

    const first = makeMatch('cycle-a', { stage: 'semifinal', homeSource: { kind: 'match', matchId: 'cycle-b', outcome: 'winner' } });
    const second = makeMatch('cycle-b', { stage: 'final', homeSource: { kind: 'match', matchId: 'cycle-a', outcome: 'winner' } });
    expect(() => validateSnapshot({ ...seed(), matches: [first, second] })).toThrow('晋级来源存在循环引用');

    const source = makeMatch('source', { stage: 'semifinal' });
    const final = makeMatch('final', { stage: 'final', homeSource: { kind: 'match', matchId: 'source', outcome: 'winner' } });
    const third = makeMatch('third', { stage: 'third', homeSource: { kind: 'match', matchId: 'source', outcome: 'winner' } });
    expect(() => validateSnapshot({ ...seed(), matches: [source, final, third] })).toThrow('同一胜负结果只能供一个晋级席位使用');

    expect(() => validateSnapshot({ ...seed(), colleges: ['甲学院'], referees: [makeReferee('r1', ['未知学院'])] })).toThrow('学院“未知学院”尚未登记');
    const crossEvent = makeMatch('cross-event', { event: 'mens-pku-cup', competition: '男足北大杯', stage: 'final', homeSource: { kind: 'match', matchId: 'source', outcome: 'winner' } });
    expect(() => validateSnapshot({ ...seed(), matches: [source, crossEvent] })).toThrow('晋级来源必须属于同一赛事和赛季');
  });
});

describe('审查回归：候选完整性与级联保护', () => {
  it('小组尚有未赛场次时，领先队不提前锁定，保留所有可能晋级球队', () => {
    const games = [makeMatch('a-b', { home: '甲', away: '乙', status: 'completed', result: { home: 2, away: 0 } }), makeMatch('b-c', { home: '乙', away: '丙' })];
    const next = makeMatch('next', { stage: 'knockout', home: '', homeSource: { kind: 'group', group: 'A', rank: 1 } });
    expect(resolveMatchTeams(next, [...games,next])).toMatchObject({ home: '', homeCandidates: expect.arrayContaining(['甲','乙','丙']) });
    games[1] = { ...games[1], status: 'completed', result: { home: 0, away: 0 } };
    expect(resolveMatchTeams(next,[...games,next]).home).toBe(''); // 甲丙尚未建立赛程。
  });
  it('分组排位赛不混入同名小组或单场排位赛', () => {
    const games = [makeMatch('regular',{home:'甲',away:'乙'}),makeMatch('placement',{stage:'placement',placementMode:'grouped',home:'丙',away:'丁'}),makeMatch('single',{stage:'placement',placementMode:'single',home:'戊',away:'己'})];
    const order = [{ event:'freshmen-cup' as const,season,group:'A',teams:['甲','乙'] }];
    expect(groupStandings(games,'freshmen-cup',season,'A','placement',order).map(r=>r.team).sort()).toEqual(['丙','丁'].sort());
    expect(itemNames(games[1],games)).toEqual(['丙','丁']);
  });
  it('新增同组对阵会检查之前已选派的比赛，而非只检查新比赛', async () => {
    const initial=seed();initial.colleges=['甲学院'];initial.referees=[makeReferee()];initial.teams=[makeTeam('丙',['甲学院'])];initial.matches=[makeMatch('old',{home:'甲',away:'乙',officials:[{role:'referee',refereeId:'r1',name:'测试裁判'}]})];const f=apiFixture(initial);
    const response=await f.call('POST','/api/matches',makeMatch('new',{home:'丙',away:'丁'}));expect(response.status).toBe(400);expect((await response.json()).error).toContain('回避冲突');expect(f.data.matches).toHaveLength(1);expect(f.writes).toBe(0);
  });
  it('上游改赢家不能把已有决赛比分套给新球队，同赢家修正可以保存', async () => {
    const source=makeMatch('semi',{stage:'semifinal',group:'',home:'甲',away:'乙',status:'completed',result:{home:1,away:0}});
    const final=makeMatch('final',{stage:'final',group:'',home:'甲',away:'丙',homeSource:{kind:'match',matchId:'semi',outcome:'winner'},status:'completed',result:{home:2,away:0}});
    const initial=seed();initial.matches=[source,final];const f=apiFixture(initial);
    const blocked=await f.call('PUT','/api/matches/semi',{...source,result:{home:0,away:1}});expect(blocked.status).toBe(400);expect((await blocked.json()).error).toContain('已有赛果');expect(f.writes).toBe(0);
    expect((await f.call('PUT','/api/matches/semi',{...source,result:{home:3,away:0}})).status).toBe(200);
  });
  it('来源换队时同步默认球衣；小组同一名次不能占用多个晋级席位', () => {
    const source=makeMatch('semi',{stage:'semifinal',home:'甲',away:'乙',status:'completed',result:{home:0,away:1}});
    const final=makeMatch('final',{stage:'final',home:'甲',away:'丙',homeColor:'#FFFFFF',homeSource:{kind:'match',matchId:'semi',outcome:'winner'}});
    expect(applyAdvancement([source,final],[],[makeTeam('乙')])[1]).toMatchObject({home:'乙',homeColor:'#123456'});
    const duplicate={...final,homeSource:{kind:'group' as const,group:'A',rank:1}};
    expect(()=>validateSnapshot({...seed(),matches:[duplicate,{...duplicate,id:'other',stage:'knockout'}]})).toThrow('同一胜负结果');
  });
});
