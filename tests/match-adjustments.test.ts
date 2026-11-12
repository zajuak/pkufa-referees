import { describe, expect, it } from 'vitest';
import type { DataStore, Match, Official } from '../src/domain/types';
import { initialChannelStats } from '../src/domain/referees';
import { getChannelSummary, getCompetitionSummaries, getSeasonWage } from '../src/domain/calculations';
// @ts-expect-error Shared Node/Worker API.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Durable snapshot validation.
import { validateSnapshot } from '../server/validation.mjs';

const season = '2026–27';
const match: Match = { id: 'm1', season, week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-10-03', time: '12:00-14:00', venue: '北场', group: '', home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判甲' }] };
const input = { matchId: 'm1', refereeId: 'r1', type: 'penalty', points: 1.5, wage: 25, reason: '本场技术性失误' };

function fixture() {
  let data: DataStore = { version: 1, revision: 0, meta: { association: '测试', season, rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 1, fiveMatches: 0, cancelledMatches: 0 } }, matches: [structuredClone(match)], referees: ['甲', '乙'].map((name, index) => ({ id: `r${index + 1}`, name: `测试裁判${name}`, channels: { eleven: initialChannelStats('eleven'), five: initialChannelStats('five') } })), adjustments: [] };
  let writes = 0;
  const repository = { load: async () => structuredClone(data), save: async (next: DataStore) => { data = structuredClone(next); writes++; } };
  const call = (method: string, path: string, body?: unknown, authenticated = true, revision = data.revision) => handleApi(new Request('https://test'+path, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), repository, { authenticated, publicQueries: true });
  return { get data() { return data; }, get writes() { return writes; }, call };
}

describe('奖惩必须关联具体比赛', () => {
  it.each([undefined, '', 'missing'])('缺少或不存在的比赛不能登记，失败不落库：%s', async (matchId) => {
    const f = fixture(), before = structuredClone(f.data);
    const response = await f.call('POST', '/api/adjustments', { ...input, matchId });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('关联比赛');
    expect(f.writes).toBe(0); expect(f.data).toEqual(before);
  });

  it('不能处罚未在该场选派的裁判员，也不能绕过登录', async () => {
    const f = fixture();
    expect((await f.call('POST', '/api/adjustments', { ...input, refereeId: 'r2' })).status).toBe(400);
    expect((await f.call('POST', '/api/adjustments', input, false)).status).toBe(401);
    expect(f.writes).toBe(0);
  });

  it('以比赛信息为准归属扣罚，客户端伪造赛制、赛事、赛季和日期无效', async () => {
    const f = fixture(), referee = f.data.referees[0];
    const before = getSeasonWage(referee, 'eleven', season, f.data.matches, [])!;
    const points = getChannelSummary(referee, 'eleven', f.data.matches, [])!.points;
    const response = await f.call('POST', '/api/adjustments', { ...input, channel: 'five', event: 'womens-pku-cup', season: '2020–21', date: '2020-01-01' });
    expect(response.status).toBe(201);
    const adjustment = await response.json();
    expect(adjustment).toMatchObject({ matchId: 'm1', refereeId: 'r1', channel: 'eleven', event: 'freshmen-cup', season, date: match.date, points: -1.5, wage: -25 });
    expect(getChannelSummary(referee, 'eleven', f.data.matches, f.data.adjustments)!.points).toBe(points - 1.5);
    expect(getSeasonWage(referee, 'eleven', season, f.data.matches, f.data.adjustments)!.total).toBe(before.total - 25);
    expect(getCompetitionSummaries(referee, 'eleven', season, f.data.matches, f.data.adjustments).find(item => item.event === 'freshmen-cup')!.adjustmentWage).toBe(-25);
    expect(getSeasonWage(referee, 'five', season, f.data.matches, f.data.adjustments)!.adjustmentWage).toBe(0);
    expect(validateSnapshot(f.data).adjustments[0].matchId).toBe('m1');
    expect((await (await f.call('GET', '/api/data', undefined, false)).json()).adjustments[0].matchId).toBe('m1');
  });

  it.each(['first', 'second', 'third'] as const)('女足的%s裁判可以按本场比赛登记奖励', async (role) => {
    const f = fixture();
    Object.assign(f.data.matches[0], { channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', officials: [{ role, refereeId: 'r1', name: '测试裁判甲' }] });
    const response = await f.call('POST', '/api/adjustments', { ...input, type: 'reward', points: 2, wage: 10 });
    expect(response.status).toBe(201);
    expect(f.data.adjustments[0]).toMatchObject({ matchId: 'm1', channel: 'five', event: 'womens-pku-cup', points: 2, wage: 10 });
    expect(getSeasonWage(f.data.referees[0], 'five', season, f.data.matches, f.data.adjustments)!.adjustmentWage).toBe(10);
    expect(getSeasonWage(f.data.referees[0], 'eleven', season, f.data.matches, f.data.adjustments)!.adjustmentWage).toBe(0);
  });

  it('附加助理也属于该场裁判，可登记扣罚', async () => {
    const f = fixture();
    f.data.matches[0].additionalAssistants = true;
    f.data.matches[0].officials.push({ role: 'additionalAssistant1', refereeId: 'r2', name: '测试裁判乙' }, { role: 'additionalAssistant2', refereeId: null, name: '' });
    expect((await f.call('POST', '/api/adjustments', { ...input, refereeId: 'r2' })).status).toBe(201);
    expect(f.data.adjustments[0].refereeId).toBe('r2');
  });

  it.each([{ reason: '' }, { points: 0, wage: 0 }])('事由和非零变动仍为必填：%j', async (overrides) => {
    const f = fixture(); expect((await f.call('POST', '/api/adjustments', { ...input, ...overrides })).status).toBe(400); expect(f.writes).toBe(0);
  });

  it('有关联奖惩的比赛不能直接删除，先删除奖惩后可以删除比赛', async () => {
    const f = fixture(); await f.call('POST', '/api/adjustments', input);
    expect((await f.call('DELETE', '/api/matches/m1')).status).toBe(400); expect(f.writes).toBe(1);
    expect((await f.call('DELETE', '/api/adjustments/'+f.data.adjustments[0].id)).status).toBe(204);
    expect((await f.call('DELETE', '/api/matches/m1')).status).toBe(204); expect(f.data.matches).toHaveLength(0);
  });

  it('比赛改期或更改归属时奖惩跟随该场，之后调整选派仍保留已发生的处罚', async () => {
    const f = fixture(); await f.call('POST', '/api/adjustments', input);
    const changed = { ...f.data.matches[0], date: '2027-10-02', season: '2027–28', event: 'mens-pku-cup', competition: '男足北大杯', officials: [] };
    expect((await f.call('PUT', '/api/matches/m1', changed)).status).toBe(200);
    expect(f.data.adjustments[0]).toMatchObject({ matchId: 'm1', season: '2027–28', event: 'mens-pku-cup', date: '2027-10-02', points: -1.5, wage: -25 });
    expect(getSeasonWage(f.data.referees[0], 'eleven', '2027–28', f.data.matches, f.data.adjustments)!.adjustmentWage).toBe(-25);
    expect(getSeasonWage(f.data.referees[0], 'eleven', season, f.data.matches, f.data.adjustments)!.adjustmentWage).toBe(0);
    expect(() => validateSnapshot(f.data)).not.toThrow();
  });

  it('已登记奖惩后不能把比赛切到另一赛制，失败保持原比赛和核算不变', async () => {
    const f = fixture(); await f.call('POST', '/api/adjustments', input); const before = structuredClone(f.data);
    const officials: Official[] = [{ role: 'first', refereeId: 'r1', name: '测试裁判甲' }];
    const response = await f.call('PUT', '/api/matches/m1', { ...f.data.matches[0], channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', officials });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('不能修改赛制'); expect(f.data).toEqual(before); expect(f.writes).toBe(1);
  });

  it('备份拒绝不存在或归属不一致的关联比赛，同时兼容既有历史记录', async () => {
    const f = fixture(); await f.call('POST', '/api/adjustments', input);
    for (const overrides of [{ matchId: 'missing' }, { channel: 'five' }, { season: '2020–21' }, { event: 'womens-pku-cup' }, { date: '2020-01-01' }]) {
      const data = structuredClone(f.data); Object.assign(data.adjustments[0], overrides); expect(() => validateSnapshot(data)).toThrow(/关联比赛/);
    }
    const legacy = structuredClone(f.data); delete legacy.adjustments[0].matchId; expect(() => validateSnapshot(legacy)).not.toThrow();
  });

  it('过期页面提交不登记重复扣罚', async () => {
    const f = fixture(); await f.call('POST', '/api/adjustments', input);
    expect((await f.call('POST', '/api/adjustments', input, true, 0)).status).toBe(409);
    expect(f.data.adjustments).toHaveLength(1); expect(f.writes).toBe(1);
  });
});
