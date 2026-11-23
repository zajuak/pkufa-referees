import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { DataStore, Match } from '../src/domain/types';
import { additionalAssistantRoles, assignmentIssues, matchRoles } from '../src/domain/scheduling';
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
function workbook(rows: string[][], columns = header) {
  const escape = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="赛程" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[columns, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`),
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
  it('同日改时间更新原比赛编号并保留空白表格未提供的网站选派', async () => {
    const d = seed(); upload(d, workbook([row('11.21', '甲队', '乙队', '网站裁判')])); const original = d.matches[0];
    const f = fixture(d), changed = row('11.21'); changed[1] = '20-22'; const file = workbook([changed]);
    const preview = await (await f.call('/preview', file)).json(); expect(preview.rows[0]).toMatchObject({ action: 'reschedule', existingId: original.id, previousSchedule: { time: '16:00-18:00' } });
    expect((await f.call('', file, { revision: 3, weeks: ['2026-11-19'] })).status).toBe(200);
    expect(f.data.matches).toHaveLength(1); expect(f.data.matches[0]).toMatchObject({ id: original.id, time: '20:00-22:00', officials: original.officials, bonuses: ['late'] }); expect(f.data.referees).toHaveLength(1);
  });
  it('同周跨日改期更新原场，跨周须确认原场或明确新增', async () => {
    const d = seed(); upload(d, workbook([row('11.21')])); const original = d.matches[0];
    const same = fixture(d); expect((await same.call('', workbook([row('11.22')]), { revision: 3, weeks: ['2026-11-19'] })).status).toBe(200); expect(same.data.matches).toHaveLength(1); expect(same.data.matches[0].id).toBe(original.id);
    const cross = fixture(d), file = workbook([row('11.28')]); const p = await (await cross.call('/preview', file)).json(); expect(p.rows[0].action).toBe('confirm');
    expect((await cross.call('', file, { revision: 3, weeks: ['2026-11-26'] })).status).toBe(400); expect(cross.writes).toBe(0);
    expect((await cross.call('', file, { revision: 3, weeks: ['2026-11-26'], matchTargets: { '赛程:2': original.id } })).status).toBe(200); expect(cross.data.matches).toHaveLength(1);
    const separate = fixture(d); expect((await separate.call('', file, { revision: 3, weeks: ['2026-11-26'], matchTargets: { '赛程:2': 'new' } })).status).toBe(200); expect(separate.data.matches).toHaveLength(2);
  });
  it('同周同对阵多个候选须确认，仅修改指定比赛', async () => {
    const d = seed(); upload(d, workbook([row('11.21')])); const original = d.matches[0]; d.matches.push({ ...structuredClone(original), id: 'other', time: '18:00-20:00' });
    const f = fixture(d), changed = row('11.21'); changed[1] = '20-22'; const file = workbook([changed]); const p = await (await f.call('/preview', file)).json(); expect(p.rows[0].action).toBe('confirm'); expect(p.rows[0].matchCandidates).toHaveLength(2);
    expect((await f.call('', file, { revision: 3, weeks: ['2026-11-19'] })).status).toBe(400); expect(f.writes).toBe(0);
    expect((await f.call('', file, { revision: 3, weeks: ['2026-11-19'], matchTargets: { '赛程:2': original.id } })).status).toBe(200); expect(f.data.matches).toHaveLength(2); expect(f.data.matches.find(m => m.id === 'other')?.time).toBe('18:00-20:00');
  });
  it('明确两场赛程不会错误合并，重复行和多行指向同一场会被拒绝', async () => {
    const d = seed(); upload(d, workbook([row('11.21')])); const original = d.matches[0]; const later = row('11.21'); later[1] = '20-22';
    const f = fixture(d); expect((await f.call('', workbook([row('11.21'), later]), { revision: 3, weeks: ['2026-11-19'] })).status).toBe(200); expect(f.data.matches).toHaveLength(2);
    const duplicate = fixture(d); expect((await duplicate.call('', workbook([row('11.21'), row('11.21')]))).status).toBe(400); expect(duplicate.writes).toBe(0);
    const early = row('11.21'); early[1] = '12-14'; const ambiguous = fixture(d); expect((await ambiguous.call('', workbook([early, later]), { revision: 3, weeks: ['2026-11-19'], matchTargets: { '赛程:2': original.id, '赛程:3': original.id } })).status).toBe(400); expect(ambiguous.writes).toBe(0);
  });
  it('同一轮次别名可以改期，不同淘汰轮次不会合并', () => {
    const d = seed(), first = row('11.21'); first[3] = '四分之一决赛'; upload(d, workbook([first])); const original = d.matches[0];
    const same = row('11.21'); same[1] = '20-22'; same[3] = '1/4决赛'; upload(d, workbook([same])); expect(d.matches).toHaveLength(1); expect(d.matches[0].id).toBe(original.id);
    const different = row('11.22'); different[3] = '1/8决赛'; upload(d, workbook([different])); expect(d.matches).toHaveLength(2);
  });
  it('已完成场次须确认且保留赛果，改期冲突时整批不保存', async () => {
    const d = seed(); upload(d, workbook([row('11.21', '甲队', '乙队', '网站裁判')])); const original = d.matches[0]; original.status = 'completed'; original.result = { home: 1, away: 0 };
    const changed = row('11.21'); changed[1] = '20-22'; const file = workbook([changed]); const done = fixture(d);
    expect((await done.call('', file, { revision: 3, weeks: ['2026-11-19'] })).status).toBe(400); expect((await done.call('', file, { revision: 3, weeks: ['2026-11-19'], matchTargets: { '赛程:2': original.id } })).status).toBe(200); expect(done.data.matches[0].result).toEqual(original.result);
    original.status = 'scheduled'; delete original.result; d.matches.push({ ...structuredClone(original), id: 'conflict', home: '丙队', away: '丁队', time: '20:00-22:00' }); const conflict = fixture(d), before = structuredClone(conflict.data);
    expect((await conflict.call('', file, { revision: 3, weeks: ['2026-11-19'] })).status).toBe(400); expect(conflict.writes).toBe(0); expect(conflict.data).toEqual(before);
  });
  it('十一人制小组赛保留组名，具体轮次仅替换淘汰阶段的通用显示', () => {
    expect(matchStageLabel({ channel: 'eleven', stage: 'group', stageDetail: '小组赛', group: 'A' })).toBe('A');
    expect(matchStageLabel({ channel: 'eleven', stage: 'knockout', stageDetail: '1/4决赛', group: '淘汰赛' })).toBe('1/4决赛');
  });
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

const additionalHeader = [...header.slice(0,10), '附加助理1', '附加助理2', ...header.slice(10)];
function additionalRow(date: string, stage: string, first = '', second = '', note = '') {
  const values=row(date,'甲队','乙队','','甲学院',note);values[3]=stage;values.splice(10,0,first,second);return values;
}
describe('十一人制附加助理 Excel 识别',()=>{
  it.each(['半决赛','1/2决赛','二分之一决赛','决赛'])('旧四岗位表的 %s 自动补齐两个待选派附加岗位',stage=>{
    const d=seed(),values=row('11.28');values[3]=stage;const file=workbook([values]);
    const preview=previewAssignmentWorkbook(d,file,season);expect(preview.rows[0]).toMatchObject({additionalAssistants:true,additionalOfficials:[{role:'additionalAssistant1',name:''},{role:'additionalAssistant2',name:''}]});expect(d.matches).toHaveLength(0);
    upload(d,file);expect(d.matches[0].additionalAssistants).toBe(true);expect(matchRoles(d.matches[0])).toHaveLength(6);expect(d.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role))).toHaveLength(2);expect(d.referees).toHaveLength(0);expect(()=>validateSnapshot(d)).not.toThrow();
  });
  it.each(['1/4决赛','1/8决赛','季军赛','排位赛','小组赛'])('%s 即使共用六岗位表头，空白附加列也不会误启用',stage=>{
    const d=seed();upload(d,workbook([additionalRow('11.28',stage)],additionalHeader));expect(d.matches[0].additionalAssistants).toBe(false);expect(d.matches[0].officials).toHaveLength(4);
  });
  it.each([['附加助理1','附加助理2'],['第一附加助理','第二附加助理'],['第一附加助理裁判员','第二附加助理裁判员'],['附加助理１','附加助理２']])('按表头读取 %s/%s，两人同普通助理计薪计分', (first,second)=>{
    const d=seed(),columns=[...additionalHeader];columns[10]=first;columns[11]=second;
    const file=workbook([additionalRow('11.28','半决赛','附加甲','附加乙')],columns);upload(d,file);
    const m=d.matches[0];expect(m.officials.filter(o=>additionalAssistantRoles.includes(o.role)).map(o=>o.name)).toEqual(['附加甲','附加乙']);expect(d.referees).toHaveLength(2);
    for(const o of m.officials.filter(o=>additionalAssistantRoles.includes(o.role)))expect(calculateOfficial(m,o,'C')).toEqual(calculateOfficial(m,{...o,role:'assistant1'},'C'));
    expect(m.avoidanceOverride?.colleges).toEqual(['甲学院']);expect(()=>validateSnapshot(d)).not.toThrow();
  });
  it('用户表同周两场半决赛、两场排位赛分别识别，备注和回避不因新增两列错位',()=>{
    const d=seed(),semi=additionalRow('11.28','半决赛'),rank=additionalRow('11.28','排位赛');rank[1]='16-18';rank[4]='丙队';
    const semi2=additionalRow('11.29','半决赛','','','恶劣天气'),rank2=additionalRow('11.29','排位赛');semi2[4]='戊队';rank2[4]='己队';rank2[1]='18-20';
    const file=workbook([semi,rank,rank2,semi2],additionalHeader),preview=previewAssignmentWorkbook(d,file,season);
    expect(preview.rows.map((r:{additionalAssistants:boolean})=>r.additionalAssistants)).toEqual([true,false,false,true]);upload(d,file);expect(d.matches).toHaveLength(4);expect(d.matches.filter(m=>m.additionalAssistants)).toHaveLength(2);expect(d.matches[3]).toMatchObject({note:'恶劣天气',bonuses:['badWeather'],avoidanceOverride:{colleges:['甲学院']}});
  });
  it('补正已导入的半决赛时更新原比赛，不重复建场或重复附加岗位；旧表缺列保留网站选派',()=>{
    const d=seed(),file=workbook([additionalRow('11.28','半决赛','附加甲','附加乙')],additionalHeader);upload(d,file);const id=d.matches[0].id;
    d.matches[0].additionalAssistants=false;d.matches[0].officials=d.matches[0].officials.filter(o=>!additionalAssistantRoles.includes(o.role));
    expect(upload(d,file)).toMatchObject({added:0,updated:1,newReferees:0});expect(d.matches[0].id).toBe(id);expect(d.matches[0].officials).toHaveLength(6);
    const original=structuredClone(d.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role))),legacy=row('11.28');legacy[3]='半决赛';upload(d,workbook([legacy]));
    expect(d.matches).toHaveLength(1);expect(d.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role))).toEqual(original);
    upload(d,workbook([additionalRow('11.28','半决赛')],additionalHeader));expect(d.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role)).map(o=>o.name)).toEqual(['','']);
  });
  it('阶段列空白保留网站半决赛时，也补齐缺失岗位；其他阶段明确填入附加裁判时同样启用',()=>{
    const d=seed(),values=row('11.28');values[3]='半决赛';upload(d,workbook([values]));d.matches[0].additionalAssistants=false;d.matches[0].officials=d.matches[0].officials.slice(0,4);values[3]='';upload(d,workbook([values]));expect(d.matches[0].additionalAssistants).toBe(true);expect(d.matches[0].officials).toHaveLength(6);
    const e=seed();upload(e,workbook([additionalRow('11.28','排位赛','附加甲')],additionalHeader));expect(e.matches[0].additionalAssistants).toBe(true);expect(e.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role))).toHaveLength(2);
  });
  it('缺少一个附加表头时仍生成一对岗位，重复附加表头拒绝导入',()=>{
    const columns=[...additionalHeader],values=additionalRow('11.28','半决赛','附加甲');columns.splice(11,1);values.splice(11,1);const d=seed();upload(d,workbook([values],columns));expect(d.matches[0].officials.filter(o=>additionalAssistantRoles.includes(o.role)).map(o=>o.name)).toEqual(['附加甲','']);
    columns.splice(11,0,'第一附加助理');values.splice(11,0,'另一个人');expect(()=>upload(seed(),workbook([values],columns))).toThrow('岗位表头重复');
  });
  it('取消的决赛不创建裁判档案；只导入选定周次时不创建其他周附加裁判',()=>{
    const d=seed();upload(d,workbook([additionalRow('11.28','决赛','取消甲','取消乙','比赛取消')],additionalHeader));expect(d.matches[0].officials).toEqual([]);expect(d.referees).toHaveLength(0);
    const e=seed();upload(e,workbook([additionalRow('11.21','半决赛','旧周甲','旧周乙'),additionalRow('11.28','决赛','新周甲','新周乙')],additionalHeader),{weeks:['2026-11-26']});expect(e.matches).toHaveLength(1);expect(e.referees.map(r=>r.name)).toEqual(['新周甲','新周乙']);
  });
  it('附加裁判参与 API 重复选派检查，失败整批不落库；预览只读',async()=>{
    const f=fixture(),values=additionalRow('11.28','半决赛','重复裁判','附加乙');values[6]='重复裁判';const file=workbook([values],additionalHeader);expect((await f.call('/preview',file)).status).toBe(200);expect(f.writes).toBe(0);const response=await f.call('',file,{revision:3,weeks:['2026-11-26']});expect(response.status).toBe(400);expect(f.writes).toBe(0);expect(f.data.matches).toHaveLength(0);expect(f.data.referees).toHaveLength(0);
  });
  it('附加岗位续赛换裁沿用同场记录，并保留已确认的半场比例和补贴',()=>{
    const d=seed();upload(d,workbook([additionalRow('11.14','半决赛','原附加甲','附加乙')],additionalHeader));const id=d.matches[0].id;
    const file=workbook([additionalRow('11.21','半决赛','续附加甲','附加乙','接续比赛')],additionalHeader),preview=previewAssignmentWorkbook(d,file,season);
    expect(preview.rows[0].candidates[0].roles[0].role).toBe('additionalAssistant1');
    upload(d,file,{continuations:{'赛程:2':{matchId:id,roles:{additionalAssistant1:{originalPercent:80,resumedPercent:60,originalBonus:5,resumedBonus:10}}}}});expect(d.matches).toHaveLength(1);expect(d.matches[0].additionalAssistants).toBe(true);const pair=d.matches[0].officials.filter(o=>o.role==='additionalAssistant1');expect(pair.map(o=>o.allocationPercent)).toEqual([80,60]);expect(pair.map(o=>o.actualBonus)).toEqual([5,10]);expect(()=>validateSnapshot(d)).not.toThrow();
    const legacy=row('11.14');legacy[3]='半决赛';upload(d,workbook([legacy]));expect(d.matches[0].officials.filter(o=>o.role==='additionalAssistant1')).toEqual(pair);
  });
});
