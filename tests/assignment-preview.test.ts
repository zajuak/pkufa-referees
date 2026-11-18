import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { DataStore, Match } from '../src/domain/types';
import { assignmentIssues } from '../src/domain/scheduling';
import { assignmentOccurrences } from '../src/domain/workload';
import { matchAvoidanceSummary } from '../src/domain/avoidance';
import { matchStageLabel } from '../src/domain/stages';
import { calculateOfficial } from '../src/domain/calculations';
// @ts-expect-error Shared server importer.
import { importAssignmentWorkbook, previewAssignmentWorkbook } from '../server/assignment-import.mjs';
// @ts-expect-error Shared Fetch API.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Shared public serializer.
import { readableStore } from '../server/access.mjs';
// @ts-expect-error Shared snapshot validator.
import { validateSnapshot } from '../server/validation.mjs';
const season = '2026–27';
const header = ['日期', '时间', '场地', '比赛类别', '主队', '客队', '主裁判', '第一助理', '第二助理', '第四官员', '回避', '备注'];
const row = (date: string, home = '甲队', away = '乙队', name = '', avoidance = '', note = '') => [date, '16-18', '北场', '十二进八', home, away, name, '', '', '', avoidance, note];
function workbook(rows: string[][]) {
  const escape = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="赛程" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[header, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`),
  });
}
function seed(): DataStore {
  return { version: 1, revision: 3, meta: { association: '测试', season, rulesVersion: '测试', importedAt: '', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, matches: [], referees: [], adjustments: [], colleges: ['甲学院', '乙学院', '丙学院'] };
}
const upload = (d: DataStore, file: Uint8Array, options = {}) => importAssignmentWorkbook(d, file, season, 'freshmen-cup', options);
function fixture(initial = seed()) {
  let data = structuredClone(initial), writes = 0;
  const repo = { load: async () => structuredClone(data), save: async (next: DataStore) => { data = structuredClone(next); writes++; } };
  const call = (path: string, file: Uint8Array, options?: object, authenticated = true) => handleApi(new Request('https://test/api/import-assignments'+path+'?event=freshmen-cup&season='+encodeURIComponent(season)+(options ? '&options='+encodeURIComponent(JSON.stringify(options)) : ''), { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'If-Match': String(data.revision) }, body: Buffer.from(file) }), repo, { authenticated, publicQueries: true });
  return { call, get data() { return data; }, get writes() { return writes; } };
}

describe('选派导入预览、按周确认及续赛合并', () => {
  it.each(['1/4决赛', '1/8决赛', '四分之一决赛', '十二进八'])('保留 Excel 具体阶段名称 %s，工资积分仍按淘汰赛计算', detail => {
    const d = seed(), values = row('11.21'); values[3] = detail;
    upload(d, workbook([values])); const m = d.matches[0];
    expect(m).toMatchObject({ stage: 'knockout', stageDetail: detail }); expect(matchStageLabel(m)).toBe(detail);
    const official = { role: 'referee' as const, refereeId: null, name: '' };
    expect(calculateOfficial(m, official, 'C')).toEqual(calculateOfficial({ ...m, stageDetail: undefined }, official, 'C'));
    expect(readableStore(d, { authenticated: false }).matches[0].stageDetail).toBe(detail);
    expect(validateSnapshot(d).matches[0].stageDetail).toBe(detail);
    values[3] = ''; upload(d, workbook([values]));
    expect(d.matches[0]).toMatchObject({ stage: 'knockout', stageDetail: detail });
  });
  it('比赛设定保存及公开读取保留具体阶段名称，不允许显示名称误导阶段核算', async () => {
    let d = seed(); upload(d, workbook([row('11.21')])); let writes = 0;
    const repo = { load: async () => structuredClone(d), save: async (next: DataStore) => { d = structuredClone(next); writes++; } };
    const call = (detail: unknown) => handleApi(new Request('https://test/api/matches/'+d.matches[0].id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(d.revision) }, body: JSON.stringify({ ...d.matches[0], stageDetail: detail }) }), repo, { authenticated: true });
    expect((await call('1/4决赛')).status).toBe(200); expect(d.matches[0].stageDetail).toBe('1/4决赛');
    const before = structuredClone(d);
    for (const detail of ['决赛', 'x'.repeat(61), 123]) expect((await call(detail)).status).toBe(400);
    expect(writes).toBe(1); expect(d).toEqual(before);
    expect(() => validateSnapshot({ ...d, matches: [{ ...d.matches[0], stageDetail: '决赛' }] })).toThrow(/不一致/);
    expect((await call('')).status).toBe(200); expect(d.matches[0].stageDetail).toBeUndefined();
  });
  it('预览不创建裁判、不写库，按周四至周三和春秋学期分组', async () => {
    const f = fixture(), before = structuredClone(f.data);
    const response = await f.call('/preview', workbook([row('11.18', '甲队', '乙队', '新裁判'), row('11.19'), row('3.6')]));
    expect(response.status).toBe(200); const p = await response.json();
    expect(p.weeks.map((w: { key: string; count: number }) => [w.key, w.count])).toEqual([['2027-03-04', 1], ['2026-11-19', 1], ['2026-11-12', 1]]);
    expect(p.weeks[0]).toMatchObject({ semester: 'spring', week: 1 }); expect(p.weeks[2]).toMatchObject({ semester: 'autumn', week: 1 });
    expect(f.writes).toBe(0); expect(f.data).toEqual(before);
  });
  it('只更新勾选周，未勾选周的网站编辑与裁判档案不被本地旧表覆盖', () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '原裁判'), row('11.21', '丙队', '丁队')]));
    Object.assign(d.matches[0], { note: '仅在网站更新', venue: '网站场地', avoidanceOverride: { mode: 'replace', colleges: ['丙学院'] } });
    const original = structuredClone(d.matches[0]);
    upload(d, workbook([row('11.14', '甲队', '乙队', '不应创建的新裁判', '未知学院'), row('11.21', '丙队', '丁队', '新裁判', '甲学院、乙学院')]), { weeks: ['2026-11-19'] });
    expect(d.matches[0]).toEqual(original); expect(d.referees.some(r => r.name === '不应创建的新裁判')).toBe(false);
    expect(d.matches[1].officials[0].name).toBe('新裁判'); expect(d.matches[1].avoidanceOverride).toEqual({ mode: 'replace', colleges: ['甲学院', '乙学院'] });
  });
  it('显式回避覆盖旧名单，支持多种分隔符和去重，空白保留，明确无回避可清空', () => {
    const d = seed(); upload(d, workbook([row('11.21', '甲队', '乙队', '', '甲学院，乙学院；甲学院\n丙学院')]));
    expect(matchAvoidanceSummary(d.matches[0], d.matches)).toEqual({ colleges: ['甲学院', '乙学院', '丙学院'], complete: true });
    upload(d, workbook([row('11.21')])); expect(d.matches[0].avoidanceOverride?.colleges).toHaveLength(3);
    upload(d, workbook([row('11.21', '甲队', '乙队', '', '无')])); expect(d.matches[0].avoidanceOverride?.colleges).toEqual([]);
  });
  it('未知学院在预览中提示，确认时整批拒绝，线上不产生部分更新', async () => {
    const f = fixture(), file = workbook([row('11.21', '甲队', '乙队', '新裁判', '未登记学院')]);
    const p = await (await f.call('/preview', file)).json(); expect(p.rows[0].unknownColleges).toEqual(['未登记学院']);
    const response = await f.call('', file, { revision: 3, weeks: ['2026-11-19'] });
    expect(response.status).toBe(400); expect(f.writes).toBe(0); expect(f.data.referees).toEqual([]);
  });
  it.each([[], ['2026-01-01'], 'all'])('非法周次不会隐式退化成全部导入：%j', async weeks => {
    const f = fixture(); expect((await f.call('', workbook([row('11.21')]), { revision: 3, weeks })).status).toBe(400); expect(f.writes).toBe(0);
  });
  it('预览过期则拒绝确认，预览接口仅管理员可访问', async () => {
    const f = fixture(), file = workbook([row('11.21')]);
    expect((await f.call('/preview', file, undefined, false)).status).toBe(401);
    expect((await f.call('', file, { revision: 2, weeks: ['2026-11-19'] })).status).toBe(409); expect(f.writes).toBe(0);
  });
  it('接续备注必须显式确认；关联原场并合并空白重复记录，不覆盖原场选派和其他周', async () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '原裁判')]));
    const original = d.matches[0]; d.matches.push({ ...structuredClone(original), id: 'empty-duplicate', date: '2026-11-21', week: 2, officials: original.officials.map(o => ({ role: o.role, refereeId: null, name: '' })) });
    const f = fixture(d), file = workbook([row('11.14', '甲队', '乙队', '本地旧裁判'), row('11.21', '甲队', '乙队', '', '甲学院、乙学院', '接续比赛')]);
    expect((await f.call('', file, { revision: 3, weeks: ['2026-11-19'] })).status).toBe(400); expect(f.writes).toBe(0);
    const p = await (await f.call('/preview', file)).json(); expect(p.rows[1].candidates[0].id).toBe(original.id);
    const response = await f.call('', file, { revision: 3, weeks: ['2026-11-19'], continuations: { '赛程:3': { matchId: original.id } } });
    expect(response.status).toBe(200); expect(f.data.matches).toHaveLength(1); expect(f.data.matches[0]).toMatchObject({ id: original.id, date: '2026-11-14', interrupted: true, resumption: { date: '2026-11-21', time: '16:00-18:00' } });
    expect(f.data.matches[0].officials[0].name).toBe('原裁判'); expect(f.data.referees.some(r => r.name === '本地旧裁判')).toBe(false);
    expect(validateSnapshot(f.data).matches).toHaveLength(1);
  });
  it('同一文件首次导入可以关联其中的原场，文件顺序不要求先原场后续赛', async () => {
    const f = fixture(), file = workbook([row('11.21', '甲队', '乙队', '', '甲学院', '接续比赛'), row('11.14', '甲队', '乙队', '原裁判')]);
    const p = await (await f.call('/preview', file)).json(); expect(p.rows[0].candidates[0].id).toBe('row:赛程:3');
    const response = await f.call('', file, { revision: 3, weeks: ['2026-11-12', '2026-11-19'], continuations: { '赛程:2': { matchId: 'row:赛程:3' } } });
    expect(response.status).toBe(200); expect(f.data.matches).toHaveLength(1); expect(f.data.matches[0].resumption?.date).toBe('2026-11-21');
  });
  it('同时选中原场周时，换裁预览按表中将更新的原场选派计算', () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '网站原裁判')]));
    const p = previewAssignmentWorkbook(d, workbook([row('11.14', '甲队', '乙队', '本地原裁判'), row('11.21', '甲队', '乙队', '网站原裁判', '', '接续比赛')]));
    const candidate = p.rows[1].candidates[0];
    expect(candidate.roles).toEqual([]); expect(candidate.uploadedOriginal).toMatchObject({ weekKey: '2026-11-12', roles: [{ role: 'referee', originalName: '本地原裁判', resumedName: '网站原裁判' }] });
  });
  it('换裁须确认实际补贴，比例可独立超过100%；重复导入保留已确认的分配', async () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '原裁判')])); const original = d.matches[0];
    const f = fixture(d), file = workbook([row('11.21', '甲队', '乙队', '续赛裁判', '甲学院', '接续比赛')]);
    const options = { revision: 3, weeks: ['2026-11-19'], continuations: { '赛程:2': { matchId: original.id, roles: {} } } };
    expect((await f.call('', file, options)).status).toBe(400); expect(f.writes).toBe(0);
    Object.assign(options.continuations['赛程:2'].roles, { referee: { originalBonus: 10, resumedBonus: 20, originalPercent: 80, resumedPercent: 60 } });
    expect((await f.call('', file, options)).status).toBe(200);
    const pair = f.data.matches[0].officials.filter(o => o.role === 'referee'); expect(pair.map(o => o.fraction)).toEqual([0.5, 0.5]); expect(pair.map(o => o.allocationPercent)).toEqual([80, 60]); expect(pair.map(o => o.actualBonus)).toEqual([10, 20]);
    expect(pair[1]).toMatchObject({ dutyDate: '2026-11-21', dutyTime: '16:00-18:00' });
    expect(validateSnapshot(f.data)).toBeTruthy();
    expect((await f.call('', file, { ...options, revision: 4 })).status).toBe(200); expect(f.data.matches[0].officials.filter(o => o.role === 'referee')).toEqual(pair);
  });
  it.each(['选派', '赛果', '奖惩', '晋级引用'])('独立续赛记录含%s时禁止自动删除，原子保留', async kind => {
    const d = seed(); upload(d, workbook([row('11.14')])); const original = d.matches[0];
    const duplicate = { ...structuredClone(original), id: 'duplicate', date: '2026-11-21' } as Match;
    if (kind === '选派') duplicate.officials[0].name = '网站已选裁判';
    if (kind === '赛果') { duplicate.status = 'completed'; duplicate.result = { home: 1, away: 0 }; }
    if (kind === '奖惩') d.adjustments.push({ id: 'a', matchId: duplicate.id, refereeId: 'r', channel: 'eleven', season, date: duplicate.date, type: 'reward', points: 1, wage: 1, reason: '测试' });
    if (kind === '晋级引用') d.matches.push({ ...structuredClone(original), id: 'later', date: '2026-11-28', home: '', homeSource: { kind: 'match', matchId: duplicate.id, outcome: 'winner' } });
    d.matches.push(duplicate); const f = fixture(d), before = structuredClone(f.data);
    expect((await f.call('', workbook([row('11.21', '甲队', '乙队', '', '', '接续比赛')]), { revision: 3, weeks: ['2026-11-19'], continuations: { '赛程:2': { matchId: original.id } } })).status).toBe(400);
    expect(f.writes).toBe(0); expect(f.data).toEqual(before);
  });
  it('原班裁判续赛时也检查续赛当天的跨场冲突和请假', () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '原裁判')])); const original = d.matches[0];
    original.interrupted = true; original.resumption = { date: '2026-11-21', time: '16:00-18:00' };
    const other = { ...structuredClone(original), id: 'other', date: '2026-11-21', interrupted: false, resumption: undefined };
    expect(assignmentIssues(original, [original, other]).some(s => s.includes('时间冲突'))).toBe(true);
    expect(assignmentIssues(other, [original, other]).some(s => s.includes('时间冲突'))).toBe(true);
    expect(assignmentIssues(original, [original], [{ id: 'l', refereeId: original.officials[0].refereeId!, start: '2026-11-21', end: '2026-11-21', reason: '请假' }]).some(s => s.includes('请假'))).toBe(true);
  });
  it('公开首页及日历按原场、续赛日期展示，使用各自裁判，业务库仍只有一场且计算元数据保留', () => {
    const d = seed(); upload(d, workbook([row('11.14', '甲队', '乙队', '原裁判')])); const m = d.matches[0];
    m.interrupted = true; m.resumption = { date: '2026-11-21', time: '16:00-18:00' };
    m.officials = [{ role: 'referee', refereeId: 'r1', name: '原裁判', fraction: 0.5, allocationPercent: 80, actualBonus: 10 }, { role: 'referee', refereeId: 'r2', name: '续赛裁判', fraction: 0.5, allocationPercent: 60, actualBonus: 20, dutyDate: '2026-11-21', dutyTime: '16:00-18:00' }];
    const before = structuredClone(d), publicData = readableStore(d, { publicQueries: true, authenticated: false });
    const schedule = assignmentOccurrences(publicData.matches);
    expect(schedule.map(s => [s.date, s.week, s.officials[0].name])).toEqual([['2026-11-14', 1, '原裁判'], ['2026-11-21', 2, '续赛裁判']]);
    expect(schedule[1].sourceMatchId).toBe(m.id); expect(publicData.matches[0].officials[1].allocationPercent).toBe(60); expect(d).toEqual(before);
  });
});
