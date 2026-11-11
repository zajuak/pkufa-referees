import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { DataStore } from '../src/domain/types';
import { calculateOfficial } from '../src/domain/calculations';
// @ts-expect-error Shared workbook importer is Node ESM.
import { importAssignmentWorkbook } from '../server/assignment-import.mjs';
// @ts-expect-error Shared Fetch API is Node ESM.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Shared snapshot validation is Node ESM.
import { validateSnapshot } from '../server/validation.mjs';

const season = '2026–27';
function seed(): DataStore {
  return { version: 1, revision: 0, meta: { association: '测试', season, rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, referees: [], matches: [], adjustments: [] };
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function workbook(rows: string[][], merges = '') {
  const sheet = rows.map((cells, index) => `<row r="${index + 1}">${cells.map((cell, col) => `<c r="${String.fromCharCode(65 + col)}${index + 1}" t="inlineStr"><is><t>${escape(cell)}</t></is></c>`).join('')}</row>`).join('');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="五人制测试" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData>${merges}</worksheet>`),
  });
}
const header = ['日期', '时间', '场地', '组别', '主队', '客队', '一裁', '二裁', '三裁', '回避', '备注'];
const values = ['11.14', '16:00-17:00', '测试场', '常规赛', '测试甲队', '测试乙队', '测试裁判甲', '测试裁判乙', '测试裁判丙', '', ''];
const upload = (data: DataStore, file: Uint8Array, event = 'womens-pku-cup') => importAssignmentWorkbook(data, file, season, event);

describe('五人制三岗位选派 Excel', () => {
  it.each([true, false])('组别整列省略或留空均能导入，并在重传时保留已有组别：省略=%s', (omitted) => {
    const data = seed();
    upload(data, workbook([header, values]));
    const match = data.matches[0]; match.group = 'F'; match.stage = 'semifinal';
    const columns = [...header], row = [...values]; row[3] = ''; row[8] = '测试新三裁';
    if (omitted) { columns.splice(3, 1); row.splice(3, 1); }
    expect(upload(data, workbook([columns, row]))).toMatchObject({ added: 0, updated: 1 });
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]).toMatchObject({ id: match.id, group: 'F', stage: 'semifinal' });
    expect(data.matches[0].officials[2].name).toBe('测试新三裁');
    const empty = seed(); upload(empty, workbook([columns, row]));
    expect(empty.matches[0]).toMatchObject({ group: '', stage: 'group' });
  });

  it.each(['常规赛', '排位赛', '半决赛', '决赛'])('可选比赛类别独立设置五人制阶段：%s', (stage) => {
    const data = seed(); upload(data, workbook([header, values]));
    const match = data.matches[0]; match.group = 'F'; match.stage = 'semifinal';
    const columns = [...header]; columns[3] = '比赛类别';
    const row = [...values]; row[3] = stage;
    expect(upload(data, workbook([columns, row]))).toMatchObject({ added: 0, updated: 1 });
    expect(data.matches[0]).toMatchObject({ group: 'F', stage: ({ 常规赛: 'group', 排位赛: 'placement', 半决赛: 'semifinal', 决赛: 'final' })[stage] });
  });

  it('同时间对阵存在多个组别时不猜测更新，明确组别后只更新对应比赛', () => {
    const data = seed(); upload(data, workbook([header, values]));
    data.matches[0].group = 'F';
    data.matches.push({ ...structuredClone(data.matches[0]), id: 'other-match', group: 'G' });
    const row = [...values]; row[3] = '';
    expect(() => upload(data, workbook([header, row]))).toThrow(/多场比赛.*组别/);
    row[3] = 'G'; row[8] = '另一个三裁';
    expect(upload(data, workbook([header, row]))).toMatchObject({ added: 0, updated: 1 });
    expect(data.matches[0].officials[2].name).toBe('测试裁判丙');
    expect(data.matches[1].officials[2].name).toBe('另一个三裁');
  });

  it.each(['比赛类别', '组别', '省略'])('十一人制按列名识别并更新原场次，保留晋级组别及回避设定：%s', (groupHeader) => {
    const data = seed();
    const columns = ['日期', '时间', '场地', '组别', '主队', '客队', '主裁判', '第一助理', '第二助理', '第四官员', '回避', '备注'];
    const row = ['11.14', '18-20', '测试场', 'F', '甲', '乙', '原主裁', '', '', '', '', ''];
    upload(data, workbook([columns, row]), 'freshmen-cup');
    const match = data.matches[0]; match.stage = 'placement'; match.placementMode = 'grouped'; match.avoidanceOverride = { mode: 'replace', colleges: ['测试学院'] };
    if (groupHeader === '省略') { columns.splice(3, 1); row.splice(3, 1); row[5] = '新主裁'; }
    else { columns[3] = groupHeader; row[3] = groupHeader === '组别' ? '' : '排位赛'; row[6] = '新主裁'; }
    expect(upload(data, workbook([columns, row]), 'freshmen-cup')).toMatchObject({ added: 0, updated: 1 });
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]).toMatchObject({ id: match.id, group: 'F', stage: 'placement', placementMode: 'grouped', avoidanceOverride: match.avoidanceOverride });
    expect(data.matches[0].officials.map(o => o.name)).toEqual(['新主裁', '', '', '']);
  });

  it('十一人制“十二进八”识别为淘汰赛，组别与阶段可分列，备注随列移动', () => {
    const data = seed();
    upload(data, workbook([['日期', '时间', '主队', '客队', '主裁判', '组别', '比赛类别', '备注'], ['11.14', '18-20', '甲', '乙', '测试主裁', 'F', '十二进八', '恶劣天气']]), 'freshmen-cup');
    expect(data.matches[0]).toMatchObject({ group: 'F', stage: 'knockout', note: '恶劣天气', bonuses: ['badWeather'] });
    expect(data.matches[0].officials[0].name).toBe('测试主裁');
  });

  it('不会将其他赛季同日期对阵误认成本赛季比赛', () => {
    const data = seed(); upload(data, workbook([header, values]));
    data.matches[0].season = '2025–26';
    expect(upload(data, workbook([header, values]))).toMatchObject({ added: 1, updated: 0 });
    expect(data.matches).toHaveLength(2);
  });

  it.each([
    ['一裁', '二裁', '三裁'],
    ['第一裁判', '第二裁判', '第三裁判'],
    ['主裁', '副裁', '三裁'],
  ])('完整模板 %s/%s/%s 正确识别为五人制，并导入双方、场地与三岗位', (...labels) => {
    const data = seed(); const columns = [...header]; columns.splice(6, 3, ...labels);
    expect(upload(data, workbook([columns, values]))).toMatchObject({ added: 1, newReferees: 3 });
    const match = data.matches[0];
    expect(match).toMatchObject({ channel: 'five', event: 'womens-pku-cup', venue: '测试场', home: '测试甲队', away: '测试乙队', stage: 'group' });
    expect(match.officials.map(o => [o.role, o.name])).toEqual([['first', '测试裁判甲'], ['second', '测试裁判乙'], ['third', '测试裁判丙']]);
    expect(data.referees.every(r => r.channels.five && !r.channels.eleven)).toBe(true);
    expect(calculateOfficial({ ...match, status: 'completed' }, match.officials[2], 'C').points).toBe(1);
    expect(calculateOfficial({ ...match, status: 'completed' }, match.officials[2], 'C').baseWage).toBeGreaterThan(0);
    expect(() => validateSnapshot(data)).not.toThrow();
  });

  it('紧凑三岗位模板无需占位列，按表头识别岗位，可留空待选派并正确重传更新', () => {
    const data = seed();
    const columns = ['日期', '时间', '组别', '三裁', '一裁', '二裁', '备注'];
    const file = workbook([columns, ['11.14', '16-17', '半决赛', '', '测试甲', '测试乙', '']]);
    upload(data, file); const id = data.matches[0].id;
    expect(data.matches[0].officials.map(o => [o.role, o.name])).toEqual([['first', '测试甲'], ['second', '测试乙'], ['third', '']]);
    expect(data.matches[0]).toMatchObject({ home: '', away: '', venue: '未注明', stage: 'semifinal' });
    expect(upload(data, file)).toMatchObject({ added: 0, updated: 1, newReferees: 0 });
    expect(data.matches[0].id).toBe(id);
    upload(data, workbook([columns, ['11.14', '16-17', '半决赛', '测试丙', '测试甲', '测试乙', '']]));
    expect(data.matches[0].officials[2].name).toBe('测试丙'); expect(data.matches).toHaveLength(1);
    upload(data, file); expect(data.matches[0].officials[2]).toMatchObject({ refereeId: null, name: '' });
  });

  it.each([{ roles: ['一裁', '二裁'] }, { roles: ['主裁', '三裁'] }, { roles: ['一裁', '一裁', '二裁', '三裁'] }])('新格式漏列或岗位重复时给出明确错误：$roles', ({ roles }) => {
    expect(() => upload(seed(), workbook([['日期', '时间', '组别', ...roles], ['11.14', '16-17', '常规赛', '测试甲', '测试乙']]))).toThrow(/须同时包含|岗位表头重复/);
  });

  it('兼容旧单主裁及合并时间列的主裁/副裁模板，均保留三个岗位', () => {
    const single = seed(); upload(single, workbook([['日期', '时间', '组别', '主裁', '备注'], ['11.14', '16-17', '常规赛', '测试甲', '']]));
    expect(single.matches[0].officials.map(o => o.role)).toEqual(['first', 'second', 'third']);
    expect(single.referees).toHaveLength(1);
    const double = seed(); upload(double, workbook([['日期', '时间', '', '组别', '主裁', '副裁', '备注'], ['11.14', '16-17', '', '常规赛', '测试甲', '测试乙', '']], '<mergeCells><mergeCell ref="B1:C1"/><mergeCell ref="B2:C2"/></mergeCells>'));
    expect(double.matches[0].officials.map(o => o.name)).toEqual(['测试甲', '测试乙', '']);
  });

  it('重传旧表保留其缺少的岗位及手动赛果、回避设置，新表空白则清空相应岗位', () => {
    const data = seed(); data.colleges = ['测试学院'];
    const columns = ['日期', '时间', '组别', '一裁', '二裁', '三裁', '备注'];
    const file = workbook([columns, ['11.14', '16-17', '常规赛', '测试甲', '测试乙', '测试丙', '']]);
    upload(data, file); const match = data.matches[0]; match.status = 'completed'; match.result = { home: 1, away: 0 }; match.avoidanceOverride = { mode: 'replace', colleges: ['测试学院'] };
    const ids = match.officials.map(o => o.refereeId);
    upload(data, workbook([['日期', '时间', '组别', '主裁', '备注'], ['11.14', '16-17', '常规赛', '测试甲', '']]));
    expect(data.matches[0].officials.map(o => o.refereeId)).toEqual(ids);
    expect(data.matches[0].result).toEqual({ home: 1, away: 0 }); expect(data.matches[0].avoidanceOverride).toEqual(match.avoidanceOverride);
    upload(data, workbook([columns, ['11.14', '16-17', '常规赛', '测试甲', '测试乙', '', '']]));
    expect(data.matches[0].officials[2].refereeId).toBeNull();
  });

  it('取消比赛清空全部三个岗位，不为被取消的选派新建档案', () => {
    const data = seed(); const cancelled = [...values]; cancelled[10] = '比赛取消';
    upload(data, workbook([header, cancelled]));
    expect(data.matches[0].status).toBe('cancelled'); expect(data.matches[0].officials).toEqual([]); expect(data.referees).toEqual([]);
  });

  it('十一人制原表继续识别为四岗位十一人制，三岗位模板不误用十一人制工资', () => {
    const data = seed();
    upload(data, workbook([['日期', '时间', '场地', '组别', '主队', '客队', '主裁判', '第一助理', '第二助理', '第四官员', '回避', '备注'], ['11.14', '16-17', '测试场', 'A', '甲', '乙', '测试甲', '测试乙', '测试丙', '测试丁', '', '']]), 'freshmen-cup');
    expect(data.matches[0].channel).toBe('eleven'); expect(data.matches[0].officials.map(o => o.role)).toEqual(['referee', 'assistant1', 'assistant2', 'fourth']);
  });

  it('实际 API 导入三岗位并持久化，重复选派冲突时整次导入不写入', async () => {
    let data = seed(); let writes = 0;
    const repo = { load: async () => structuredClone(data), save: async (next: DataStore) => { data = structuredClone(next); writes++; } };
    const call = (file: Uint8Array) => handleApi(new Request('https://test/api/import-assignments?event=womens-pku-cup&season='+encodeURIComponent(season), { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'If-Match': String(data.revision) }, body: Buffer.from(file) }), repo, { authenticated: true, publicQueries: true });
    expect((await call(workbook([header, values]))).status).toBe(200); expect(writes).toBe(1); expect(data.referees).toHaveLength(3); expect(data.matches[0].officials[2].role).toBe('third');
    const before = structuredClone(data), conflict = [...values]; conflict[8] = conflict[6];
    const response = await call(workbook([header, conflict])); expect(response.status).toBe(400); expect((await response.json()).error).toContain('重复'); expect(data).toEqual(before); expect(writes).toBe(1);
  });
});
