import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { DataStore, Match, Official } from '../src/domain/types';
import { initialChannelStats } from '../src/domain/referees';
import { calculateOfficial, formatPoints, getChannelSummary, getSeasonWage } from '../src/domain/calculations';
import { assignmentIssues, vacantRoles } from '../src/domain/scheduling';
import { interruptionIssues, interruptionSettings, resumptionReady } from '../src/domain/workload';
import { createSeasonWorkbook, elevenExportHeaders, seasonExportRows } from '../src/domain/season-export';
// @ts-expect-error Shared server entry.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Shared backup validator.
import { validateSnapshot } from '../server/validation.mjs';
// @ts-expect-error Actual XLSX parser.
import { parseWorkbook } from '../server/xlsx.mjs';
// @ts-expect-error Shared assignment importer.
import { importAssignmentWorkbook } from '../server/assignment-import.mjs';

const half = (refereeId: string, role: Official['role'] = 'referee', actualBonus = 0): Official => ({ role, refereeId, name: refereeId, fraction: 0.5, actualBonus });
const match = (patch: Partial<Match> = {}): Match => ({ id: 'm1', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-10-03', time: '12:00-14:00', venue: '测试场', group: '', home: '甲队', away: '乙队', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [half('r1'), half('r2')], ...patch });
function seed(): DataStore {
  return { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '', sourceFiles: [], counts: { elevenMatches: 1, fiveMatches: 0, cancelledMatches: 0 } }, referees: ['r1', 'r2'].map(id => ({ id, name: id, channels: { eleven: initialChannelStats('eleven'), five: initialChannelStats('five') } })), matches: [match()], adjustments: [] };
}
function apiFixture() {
  let data = seed(), writes = 0;
  const repo = { load: async () => structuredClone(data), save: async (next: DataStore) => { data = structuredClone(next); writes++; } };
  const call = (body: Match) => handleApi(new Request('https://test/api/matches/m1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(data.revision) }, body: JSON.stringify(body) }), repo, { authenticated: true, publicQueries: true });
  return { get data() { return data; }, get writes() { return writes; }, call };
}
const cell = (row: (string | number)[], name: string) => row[elevenExportHeaders.indexOf(name)];

describe('续赛换裁与赛事分项导出', () => {
  it('正常比赛默认隐藏，只有中断且完整填写接续时间才允许开启续赛选派', () => {
    const normal = match({ officials: [{ role: 'referee', refereeId: 'r1', name: 'r1' }] });
    expect(interruptionSettings(normal)).toEqual({ interrupted: false, resumption: undefined });
    expect(resumptionReady(normal)).toBe(false);
    expect(resumptionReady({ ...normal, interrupted: true })).toBe(false);
    expect(resumptionReady({ ...normal, interrupted: true, resumption: { date: '2026-10-04', time: '' } })).toBe(false);
    expect(resumptionReady({ ...normal, interrupted: true, resumption: { date: '2026-10-04', time: '14:00-16:00' } })).toBe(true);
  });
  it('兼容旧半场记录，按续赛裁判的实际时间恢复中断及接续设置', () => {
    const legacy = match({ officials: [half('r1'), { ...half('r2'), dutyDate: '2026-10-04', dutyTime: '14:00-16:00' }] });
    expect(interruptionSettings(legacy)).toEqual({ interrupted: true, resumption: { date: '2026-10-04', time: '14:00-16:00' } });
    expect(interruptionIssues(legacy)).toEqual([]); expect(resumptionReady(legacy)).toBe(true);
    expect(interruptionIssues({ ...legacy, interrupted: false })).not.toEqual([]);
  });
  it('可先保存中断但时间未定的比赛，再设置接续时间和换裁', async () => {
    const f = apiFixture(); const normal = match({ interrupted: true, officials: [{ role: 'referee', refereeId: 'r1', name: 'r1' }] });
    expect((await f.call(normal)).status).toBe(200); expect(f.data.matches[0].interrupted).toBe(true); expect(f.data.matches[0].resumption).toBeUndefined();
    const resumed = { ...match(), interrupted: true, resumption: { date: '2026-10-04', time: '14:00-16:00' } };
    expect((await f.call(resumed)).status).toBe(200); expect(f.data.matches[0].resumption).toEqual(resumed.resumption);
    expect(() => validateSnapshot(f.data)).not.toThrow();
  });
  it.each([
    { interrupted: false }, { interrupted: true, resumption: { date: '2026-10-04', time: '' } },
    { interrupted: true, resumption: { date: '2026-02-30', time: '14:00-16:00' } },
    { interrupted: true, resumption: { date: '2026-10-04', time: '25:00-26:00' } },
  ])('不允许以未中断或无有效接续时间的状态保存换裁：%j', async (settings) => {
    const f = apiFixture(), before = structuredClone(f.data);
    expect((await f.call(match(settings))).status).toBe(400); expect(f.writes).toBe(0); expect(f.data).toEqual(before);
    const bad = structuredClone(before); Object.assign(bad.matches[0], settings); expect(() => validateSnapshot(bad)).toThrow();
  });
  it('新生杯不混入北大杯甲乙分项，原等级与人工确认后的等级仍可对照', () => {
    const d = seed(); d.referees[0].channels.eleven!.levelOverride = 'C';
    d.matches.push(match({ id: 'm2', stage: 'knockout', event: 'mens-pku-cup', competition: '男足北大杯', division: '甲', officials: [half('r1', 'assistant1'), half('r2', 'assistant1')] }));
    const row = seasonExportRows(d).eleven[1];
    expect(cell(row, '新生-主')).toBe(0.5); expect(cell(row, '北大-主乙')).toBe(0); expect(cell(row, '北大-边甲淘')).toBe(0.5);
    expect(cell(row, '原级别')).toBe('E'); expect(cell(row, '现级别')).toBe('C');
    const wb = parseWorkbook(createSeasonWorkbook(d));
    expect(Number(wb.getWorksheet('十一人制').getRow(2).getCell(elevenExportHeaders.indexOf('新生-主') + 1).value)).toBe(0.5);
    expect(wb.getWorksheet('十一人制').columnCount).toBe(29);
  });

  it('续赛两人各半场、积分和基础工资各半，实际补贴不折半也不重复自动发放', () => {
    const m = match({ stage: 'final', event: 'mens-pku-cup', competition: '男足北大杯', division: '甲', bonuses: ['badWeather'], officials: [half('r1', 'assistant1', 5), half('r2', 'assistant1', 15)] });
    const a = calculateOfficial(m, m.officials[0], 'E'), b = calculateOfficial(m, m.officials[1], 'E');
    expect(a.points).toBeCloseTo(1.8); expect(b.points).toBeCloseTo(1.8);
    expect(a.baseWage).toBeCloseTo(27.5); expect(b.baseWage).toBeCloseTo(27.5);
    expect(a.bonusWage).toBe(5); expect(b.bonusWage).toBe(15); expect(a.wage + b.wage).toBeCloseTo(75);
    const d = seed(); d.matches = [m];
    expect(getSeasonWage(d.referees[0], 'eleven', '2026–27', d.matches, [])!.total).toBeCloseTo(32.5);
  });

  it('五人制第三裁判半场及 0.75 分保留精度', () => {
    const d = seed(); d.matches = [match({ channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage: 'semifinal', officials: [half('r1', 'third', 1), half('r2', 'third', 2)] })];
    const rows = seasonExportRows(d).five;
    expect(rows[1][4]).toBe(0.5); expect(rows[1][7]).toBe(0.75); expect(rows[1][9]).toBe(11); expect(rows[2][9]).toBe(12);
    expect(formatPoints(0.75)).toBe('0.75'); expect(formatPoints(4)).toBe('4.0');
  });

  it('12 个北大杯分项按甲乙、阶段及岗位分别统计，附加助理计入助理', () => {
    const d = seed(); d.matches = [];
    for (const role of ['referee', 'assistant1', 'fourth'] as const) for (const division of ['甲', '乙'] as const) for (const stage of ['group', 'knockout'] as const) d.matches.push(match({ id: `${role}-${division}-${stage}`, event: 'mens-pku-cup', competition: '男足北大杯', role, division, stage, officials: [{ role, refereeId: 'r1', name: 'r1' }] } as Partial<Match>));
    const row = seasonExportRows(d).eleven[1]; expect(row.slice(6, 12)).toEqual([0, 0, 0, 0, 0, 0]); expect(row.slice(12, 24)).toEqual(Array(12).fill(1));
    d.matches = [match({ officials: [half('r1', 'additionalAssistant1'), half('r2', 'additionalAssistant1')], additionalAssistants: true })];
    expect(cell(seasonExportRows(d).eleven[1], '新生-边')).toBe(0.5);
  });

  it('北大杯未设置甲乙级时明确阻止导出，不悄悄计入乙级', () => {
    const d = seed(); d.matches[0].event = 'mens-pku-cup'; d.matches[0].competition = '男足北大杯';
    expect(() => createSeasonWorkbook(d)).toThrow(/尚未设置.*甲／乙级/);
    d.matches[0].status = 'scheduled'; d.matches[0].date = '2099-10-03'; d.matches[0].officials[0].dutyDate = '2026-10-03';
    expect(() => createSeasonWorkbook(d)).toThrow(/尚未设置/);
    d.matches[0].event = 'freshmen-cup'; expect(() => createSeasonWorkbook(d)).not.toThrow();
  });

  it('已完成的原场半场可核算，尚未进行的续赛半场、取消比赛及其他赛季不计入', () => {
    const d = seed(); d.matches = [match({ status: 'scheduled', date: '2099-10-03', officials: [{ ...half('r1'), dutyDate: '2026-10-03', dutyTime: '12:00-14:00' }, { ...half('r2'), dutyDate: '2099-10-03', dutyTime: '12:00-14:00' }] }), match({ id: 'cancel', status: 'cancelled' }), match({ id: 'old', season: '2025–26' })];
    expect(cell(seasonExportRows(d).eleven[1], '新生-主')).toBe(0.5); expect(cell(seasonExportRows(d).eleven[2], '新生-主')).toBe(0);
    expect(getChannelSummary(d.referees[0], 'eleven', d.matches, [])!.contributions[0].match.date).toBe('2026-10-03');
  });

  it('冲突和请假按各自实际执裁时段判断，续赛岗位未选派也能提示', () => {
    const original = match({ officials: [half('r1'), { ...half('r2'), dutyDate: '2026-10-04', dutyTime: '12:00-14:00' }] });
    const other = match({ id: 'other', officials: [{ role: 'referee', refereeId: 'r2', name: 'r2' }] });
    expect(assignmentIssues(original, [original, other])).toEqual([]);
    expect(assignmentIssues(original, [original, { ...other, date: '2026-10-04' }]).some(issue => issue.includes('冲突'))).toBe(true);
    expect(assignmentIssues(original, [original], [{ id: 'leave', refereeId: 'r2', start: '2026-10-04', end: '2026-10-04', reason: '请假' }]).some(issue => issue.includes('请假'))).toBe(true);
    expect(vacantRoles(match({ officials: [half('r1'), { ...half('r2'), refereeId: null, name: '' }] }))).toContain('referee');
  });

  it('实际保存及备份保留两名裁判、半场、日期和实际补贴', async () => {
    const f = apiFixture(); const input = match({ officials: [half('r1', 'referee', 5), { ...half('r2', 'referee', 10), dutyDate: '2026-10-04', dutyTime: '14:00-16:00' }] });
    expect((await f.call(input)).status).toBe(200); expect(f.writes).toBe(1); expect(f.data.matches[0].officials[1]).toMatchObject(input.officials[1]); expect(validateSnapshot(f.data).matches[0].officials).toHaveLength(2);
  });

  it.each([
    [half('r1')], [half('r1'), { ...half('r2'), fraction: 1 }], [half('r1'), { ...half('r2'), fraction: 0.25 }],
    [half('r1'), { ...half('r2'), actualBonus: -1 }], [half('r1'), { ...half('r2'), actualBonus: undefined }],
    [half('r1'), { ...half('r2'), dutyDate: '2026-02-30' }], [half('r1'), { ...half('r2'), dutyTime: '25:00-26:00' }], [half('r1'), half('r1')],
  ])('错误的续赛记录被原子拒绝：%j', async (...officials) => {
    const f = apiFixture(), before = structuredClone(f.data);
    expect((await f.call(match({ officials: officials as Official[] }))).status).toBe(400); expect(f.writes).toBe(0); expect(f.data).toEqual(before);
  });

  it('普通选派 Excel 重传保留已有续赛信息，改变该岗位时明确拒绝覆盖', () => {
    const d = seed();
    const file = (name: string) => {
      const rows = [['日期', '时间', '场地', '主队', '客队', '主裁判'], ['10.3', '12-14', '测试场', '甲队', '乙队', name]];
      const xml = rows.map((row, i) => `<row r="${i+1}">${row.map((value, c) => `<c r="${String.fromCharCode(65+c)}${i+1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
      return zipSync({ 'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试" sheetId="1" r:id="rId1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) });
    };
    importAssignmentWorkbook(d, file('r1')); expect(d.matches[0].officials.filter(o => o.role === 'referee')).toHaveLength(2); expect(d.matches[0].officials[0].fraction).toBe(0.5);
    expect(() => importAssignmentWorkbook(d, file('改名裁判'))).toThrow(/续赛换裁/);
  });
});
