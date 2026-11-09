import { describe, expect, it } from 'vitest';
import type { DataStore, Match } from '../src/domain/types';
import { getSeasonWage } from '../src/domain/calculations';
import { initialChannelStats } from '../src/domain/referees';
// @ts-expect-error Shared Fetch API is implemented in Node ESM.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Snapshot validator is shared by Node and Worker.
import { validateSnapshot } from '../server/validation.mjs';

const match: Match = { id: 'm1', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-11-14', time: '12:00-14:00', venue: '测试场', group: 'A', home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [{ role: 'referee', refereeId: null, name: '新裁判甲' }] };
function fixture() {
  let data: DataStore = { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, referees: [], matches: [], adjustments: [] };
  let writes = 0;
  const repository = { async load() { return structuredClone(data); }, async save(next: DataStore) { data = structuredClone(next); writes++; } };
  return {
    get data() { return data; }, get writes() { return writes; },
    call(method: string, path: string, body?: unknown, admin = true, revision = data.revision || 0) {
      return handleApi(new Request('https://test'+path, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) }, ...(body ? { body: JSON.stringify(body) } : {}) }), repository, { authenticated: admin, publicQueries: true });
    },
  };
}

describe('按姓名选派并自动建立裁判档案', () => {
  it('新姓名与比赛一次保存，附加助理也关联档案并参与工资积分计算', async () => {
    const f = fixture();
    const response = await f.call('POST', '/api/matches', { ...match, additionalAssistants: true, officials: [...match.officials, { role: 'additionalAssistant1', refereeId: null, name: '新裁判乙', substitute: true }] });
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(f.data.referees).toHaveLength(2); expect(f.writes).toBe(1);
    for (const official of saved.officials.filter((o: { name: string }) => o.name)) {
      const referee = f.data.referees.find((r) => r.id === official.refereeId)!;
      expect(referee.name).toBe(official.name);
      expect(referee.channels.eleven).toEqual(initialChannelStats('eleven'));
      expect(getSeasonWage(referee, 'eleven', '2026–27', f.data.matches, [])!.total).toBe(official.role === 'referee' ? 90 : 60);
    }
    expect(validateSnapshot(f.data).matches[0].officials[0].refereeId).toBeTruthy();
    const publicData = await (await f.call('GET', '/api/data', undefined, false)).json();
    expect(publicData.matches[0].officials[0].name).toBe('新裁判甲');
    expect(publicData.referees).toHaveLength(2);
  });
  it('编辑比赛时也可新增，重复保存或按带空格的同名选派不会重复建档', async () => {
    const f = fixture(); await f.call('POST', '/api/matches', { ...match, officials: [] });
    const first = await (await f.call('PUT', '/api/matches/m1', match)).json();
    const again = await (await f.call('PUT', '/api/matches/m1', { ...match, officials: [{ ...match.officials[0], name: ' 新 裁判甲 ' }] })).json();
    expect(f.data.referees).toHaveLength(1);
    expect(again.officials[0]).toMatchObject({ refereeId: first.officials[0].refereeId, name: '新裁判甲' });
  });
  it('跨赛制沿用同一身份并新增零基础的五人制 C 级档案，原积分工资不变', async () => {
    const f = fixture(); const original = { ...initialChannelStats('eleven'), basePoints: 80, previousWage: 500 };
    f.data.referees.push({ id: 'existing', name: '新裁判甲', channels: { eleven: original } });
    const response = await f.call('POST', '/api/matches', { ...match, channel: 'five', event: 'womens-pku-cup', stage: 'group', officials: [{ role: 'first', refereeId: null, name: '新裁判甲' }] });
    expect(response.status).toBe(201); expect(f.data.referees).toHaveLength(1);
    expect(f.data.matches[0].officials[0].refereeId).toBe('existing');
    expect(f.data.referees[0].channels.eleven).toEqual(original);
    expect(f.data.referees[0].channels.five).toEqual(initialChannelStats('five'));
    expect(getSeasonWage(f.data.referees[0], 'five', '2026–27', f.data.matches, [])!.total).toBe(40);
  });
  it('重复选派同一新姓名或已有姓名的时间冲突都会拒绝，失败不留下新档案', async () => {
    const f = fixture();
    const duplicated = await f.call('POST', '/api/matches', { ...match, officials: [...match.officials, { role: 'assistant1', refereeId: null, name: '新 裁判甲' }] });
    expect(duplicated.status).toBe(400); expect((await duplicated.json()).error).toContain('重复选派');
    expect(f.data.referees).toHaveLength(0); expect(f.writes).toBe(0);
    await f.call('POST', '/api/matches', match);
    const conflict = await f.call('POST', '/api/matches', { ...match, id: 'm2', officials: [...match.officials, { role: 'assistant1', refereeId: null, name: '不应保存' }] });
    expect(conflict.status).toBe(400); expect((await conflict.json()).error).toContain('时间冲突');
    expect(f.data.referees).toHaveLength(1); expect(f.data.matches).toHaveLength(1);
  });
  it('无效比赛、过期版本和未登录请求均不能创建档案', async () => {
    const f = fixture();
    expect((await f.call('POST', '/api/matches', { ...match, time: '无效' })).status).toBe(400);
    expect((await f.call('POST', '/api/matches', match, false)).status).toBe(401);
    expect((await f.call('POST', '/api/matches', match, true, 99)).status).toBe(409);
    expect(f.data.referees).toHaveLength(0); expect(f.writes).toBe(0);
    expect((await f.call('POST', '/api/matches', { ...match, status: 'cancelled' })).status).toBe(201);
    expect(f.data.referees).toHaveLength(0);
  });
  it('同名多档案必须明确选择，错误 ID 不按姓名静默替换', async () => {
    const f = fixture();
    f.data.referees.push(...['r1','r2'].map((id) => ({ id, name: '新裁判甲', channels: { eleven: initialChannelStats('eleven') } })));
    expect((await f.call('POST', '/api/matches', match)).status).toBe(400);
    expect((await f.call('POST', '/api/matches', { ...match, officials: [{ ...match.officials[0], refereeId: 'missing' }] })).status).toBe(400);
    expect(f.writes).toBe(0);
    expect((await f.call('POST', '/api/matches', { ...match, officials: [{ ...match.officials[0], refereeId: 'r2' }] })).status).toBe(201);
    expect(f.data.matches[0].officials[0].refereeId).toBe('r2'); expect(f.data.referees).toHaveLength(2);
  });
});
