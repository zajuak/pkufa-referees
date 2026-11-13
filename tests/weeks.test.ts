import { describe, expect, it } from 'vitest';
import type { DataStore, Match } from '../src/domain/types';
import { matchSemester, matchWeek, recalculateMatchWeeks, semesterWeekRange } from '../src/domain/weeks';
// @ts-expect-error Shared Fetch API is implemented in Node ESM.
import { handleApi } from '../server/api.mjs';

const match = (id: string, date: string, season = '2026–27'): Match => ({ id, date, season, week: 99, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', time: '12:00-14:00', venue: '测试场', group: '', home: '', away: '', stage: 'placement', division: null, status: 'scheduled', note: '', bonuses: [], officials: [] });
describe('按本学期首场比赛所在周自动计算周次', () => {
  it('秋春分别从首场所在周重算，跨赛事共享本学期起点，周次与日期范围互不混合', () => {
    const matches = [match('fall', '2026-10-10'), match('jan', '2027-01-07'), match('spring', '2027-03-06'), { ...match('women', '2027-03-13'), channel: 'five' as const, event: 'womens-pku-cup' as const }, match('gap', '2027-03-27')];
    recalculateMatchWeeks(matches);
    expect(matches.map(m => m.week)).toEqual([1, 14, 1, 2, 4]);
    expect(semesterWeekRange(1, '2026–27', 'autumn', matches)).toEqual(['2026-10-08', '2026-10-14']);
    expect(semesterWeekRange(1, '2026–27', 'spring', matches)).toEqual(['2027-03-04', '2027-03-10']);
    expect(semesterWeekRange(2, '2026–27', 'spring', matches)).toEqual(['2027-03-11', '2027-03-17']);
    matches.push({ ...match('earlier-spring', '2027-02-27'), channel: 'five', event: 'womens-pku-cup' }); recalculateMatchWeeks(matches);
    expect(matches[0].week).toBe(1); expect(matches[1].week).toBe(14); expect(matches[2].week).toBe(2); expect(matches.at(-1)!.week).toBe(1);
  });
  it('1 月仍归秋季，春季 2—6 月，不同学年独立', () => {
    expect(matchSemester(match('jan', '2027-01-31'))).toBe('autumn');
    expect(matchSemester(match('feb', '2027-02-01'))).toBe('spring');
    expect(matchSemester(match('jun', '2027-06-30'))).toBe('spring');
    expect(matchSemester(match('jul', '2027-07-01', '2027–28'))).toBe('autumn');
    const matches = [match('fall', '2026-10-10'), match('spring', '2027-03-06'), match('next', '2027-10-09', '2027–28')]; recalculateMatchWeeks(matches);
    expect(matches.map(m => m.week)).toEqual([1, 1, 1]);
    expect(semesterWeekRange(1, '2027–28', 'spring', matches)).toBeNull();
  });
  it('跨学期改期预览移除原日期；缺失赛季使用默认学年', () => {
    const matches = [match('moving', '2026-10-10'), match('fall', '2026-10-17'), match('spring', '2027-03-06')];
    expect(matchWeek({ ...matches[0], date: '2027-03-13' }, matches)).toBe(2);
    matches[0].date = '2027-03-13'; matches[2].season = undefined; recalculateMatchWeeks(matches);
    expect(matches.map(m => m.week)).toEqual([2, 1, 1]);
  });
  it('首周从周四到下周三，空档周仍计数，跨赛事共用本学期周次', () => {
    const matches = [match('first', '2026-10-10')];
    expect(matchWeek(match('sun', '2026-10-11'), matches)).toBe(1);
    expect(matchWeek(match('mon', '2026-10-12'), matches)).toBe(1);
    expect(matchWeek(match('wed', '2026-10-14'), matches)).toBe(1);
    expect(matchWeek(match('thu', '2026-10-15'), matches)).toBe(2);
    expect(semesterWeekRange(1, '2026–27', 'autumn', matches)).toEqual(['2026-10-08', '2026-10-14']);
    expect(semesterWeekRange(2, '2026–27', 'autumn', matches)).toEqual(['2026-10-15', '2026-10-21']);
    expect(matchWeek(match('nov', '2026-11-14'), matches)).toBe(6);
    const five: Match = { ...match('five', '2026-11-14'), channel: 'five', event: 'womens-pku-cup' };
    expect(matchWeek(five, matches)).toBe(6);
  });
  it('跨年连续计数，其他赛季独立起算', () => {
    const matches = [match('a', '2026-12-27')];
    expect(matchWeek(match('b', '2027-01-07'), matches)).toBe(3);
    expect(matchWeek(match('next', '2027-10-10', '2027–28'), matches)).toBe(1);
  });
  it('修改首场日期会重新确定首周，旧日期不残留在预览里', () => {
    const matches = [match('a', '2026-10-10'), match('b', '2026-10-17')];
    expect(matchWeek({ ...matches[0], date: '2026-10-24' }, matches)).toBe(2);
    matches[0].date = '2026-10-24'; recalculateMatchWeeks(matches);
    expect(matches.map((m) => m.week)).toEqual([2, 1]);
    matches.push(match('earlier', '2026-10-01')); recalculateMatchWeeks(matches);
    expect(matches.map((m) => m.week)).toEqual([4, 3, 1]);
  });
  it('无效的待填日期安全回退，不把宿主时区带入计算', () => {
    expect(matchWeek(match('new', ''), [])).toBe(1);
    const matches = [match('sun', '2026-11-08'), match('wed', '2026-11-11'), match('thu', '2026-11-12')];
    recalculateMatchWeeks(matches);
    expect(matches.map((m) => m.week)).toEqual([1, 1, 2]);
  });
  it('接口读取、保存和改期均忽略手填周数，保留排位赛阶段', async () => {
    let store: DataStore = { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 1, fiveMatches: 0, cancelledMatches: 0 } }, matches: [match('first', '2026-10-10')], referees: [], adjustments: [] };
    let writes = 0;
    const repository = { async load() { return structuredClone(store); }, async save(next: DataStore) { store = structuredClone(next); writes++; } };
    const call = (method: string, url: string, body?: unknown) => handleApi(new Request('https://test' + url, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(store.revision) }, ...(body ? { body: JSON.stringify(body) } : {}) }), repository, { authenticated: true });
    const read = await (await call('GET', '/api/data')).json();
    expect(read.matches[0].week).toBe(1); expect(writes).toBe(0);
    const next = await (await call('POST', '/api/matches', { ...match('second', '2026-11-14'), week: 666 })).json();
    expect(next.week).toBe(6); expect(next.stage).toBe('placement');
    expect(store.matches.map((m) => m.week)).toEqual([1, 6]);
    await call('PUT', '/api/matches/second', match('second', '2026-10-18'));
    expect(store.matches.map((m) => m.week)).toEqual([1, 2]);
    const spring = await (await call('POST', '/api/matches', { ...match('spring', '2027-03-06'), event: 'mens-pku-cup', competition: '男足北大杯', week: 777 })).json();
    expect(spring.week).toBe(1); expect(store.matches.map(m => m.week)).toEqual([1, 2, 1]);
    await call('PUT', '/api/matches/spring', { ...match('spring', '2027-03-13'), event: 'mens-pku-cup', competition: '男足北大杯' });
    expect(store.matches.map(m => m.week)).toEqual([1, 2, 1]);
  });
});
