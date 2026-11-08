import { describe, expect, it } from 'vitest';
import type { DataStore, Match, Official, Team } from '../src/domain/types';
import { allowedStages, matchStageLabel, stageOptions } from '../src/domain/stages';
import { eventTeams, teamColor } from '../src/domain/teams';
import { additionalAssistantRoles, assignmentIssues, matchRoles, vacantRoles } from '../src/domain/scheduling';
import { calculateOfficial, getSeasonWage, stageName } from '../src/domain/calculations';
import { seasonExportRows } from '../src/domain/season-export';
// @ts-expect-error Node Fetch API module.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Validates durable JSON snapshots.
import { validateSnapshot } from '../server/validation.mjs';
// @ts-expect-error Workbook importer shared by both runtimes.
import { importAssignmentWorkbook, stageFor } from '../server/assignment-import.mjs';
import { strToU8, zipSync } from 'fflate';

const match: Match = { id: 'm1', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-10-03', time: '12:00-14:00', venue: '北场', group: '', home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [] };
const official: Official = { role: 'additionalAssistant1', refereeId: 'r1', name: '测试裁判' };
function seed(): DataStore { return { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, referees: [{ id: 'r1', name: '测试裁判', channels: { eleven: { basePoints: 0, baseLevel: 'C', previousWage: 0, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } } } }], matches: [], adjustments: [] }; }

describe('赛事球队与球衣绑定', () => {
  it('同名球队按赛事隔离，历史赛程颜色不随默认色更新', () => {
    const data = seed(); data.matches = [{ ...match, homeColor: '#112233' }];
    data.teams = [{ event: 'freshmen-cup', name: '测试甲', color: '#FF0000' }, { event: 'mens-pku-cup', name: '测试甲', color: '#0000FF' }];
    expect(teamColor(data, 'freshmen-cup', ' 测试甲 ')).toBe('#FF0000');
    expect(teamColor(data, 'mens-pku-cup', '测试甲')).toBe('#0000FF');
    expect(eventTeams(data, 'freshmen-cup').find((t) => t.name === '测试乙')?.bound).toBe(false);
    expect(eventTeams(data, 'womens-pku-cup')).toEqual([]);
    data.teams[0].color = '#00FF00';
    expect(data.matches[0].homeColor).toBe('#112233');
  });
});

describe('附加助理裁判的工资、积分及岗位检查', () => {
  it.each(['group', 'semifinal', 'final'] as const)('%s 阶段与普通助理同薪同分同补贴', (stage) => {
    for (const role of additionalAssistantRoles) {
      const m = { ...match, stage, event: 'mens-pku-cup' as const, competition: '男足北大杯', division: '甲' as const, bonuses: ['early', 'badWeather'] as const };
      expect(calculateOfficial({ ...m, bonuses: [...m.bonuses] }, { ...official, role }, 'C')).toEqual(calculateOfficial({ ...m, bonuses: [...m.bonuses] }, { ...official, role: 'assistant1' }, 'C'));
    }
  });
  it('排位赛按常规积分和工资核算，不误加淘汰倍率或半决赛决赛补贴', () => {
    expect(stageName('placement')).toBe('排位赛');
    for (const role of ['referee', 'assistant1', 'additionalAssistant1', 'fourth'] as const) {
      expect(calculateOfficial({ ...match, stage: 'placement' }, { ...official, role }, 'C')).toEqual(calculateOfficial(match, { ...official, role }, 'C'));
    }
    const data = seed();
    data.matches = [{ ...match, stage: 'placement', officials: [{ ...official, role: 'assistant1' }] }];
    expect(seasonExportRows(data).eleven[1][11]).toBe(1);
    expect(seasonExportRows(data).eleven[1][13]).toBe(0);
  });
  it('半决赛和决赛自动增加奖励，普通淘汰赛不误发', () => {
    for (const role of ['referee', 'assistant1', 'additionalAssistant1', 'fourth'] as const) {
      const base = calculateOfficial(match, { ...official, role }, 'C');
      expect(calculateOfficial({ ...match, stage: 'semifinal' }, { ...official, role }, 'C').bonusWage).toBe(role === 'fourth' ? 5 : 10);
      expect(calculateOfficial({ ...match, stage: 'final' }, { ...official, role }, 'C').bonusWage).toBe(role === 'fourth' ? 10 : 20);
      expect(calculateOfficial({ ...match, stage: 'knockout' }, { ...official, role }, 'C').wage).toBe(base.wage);
    }
  });
  it('启用后增加两个岗位，冲突检查、取消比赛与工资表正确处理', () => {
    const enabled = { ...match, additionalAssistants: true, officials: [official, { role: 'additionalAssistant2' as const, refereeId: null, name: '' }] };
    expect(matchRoles(enabled)).toHaveLength(6);
    expect(vacantRoles(enabled)).toContain('additionalAssistant2');
    expect(assignmentIssues(enabled, [{ ...enabled, id: 'm2' }])).toHaveLength(1);
    const data = seed(); data.matches = [enabled];
    const rows = seasonExportRows(data).eleven;
    expect(rows[1][11]).toBe(1); // 边-乙
    expect(rows[1].at(-1)).toBe(60);
    expect(getSeasonWage(data.referees[0], 'eleven', '2026–27', [{ ...enabled, status: 'cancelled' }], [])!.total).toBe(0);
  });
});

describe('女足北大杯四阶段', () => {
  it('女足仅显示常规、排位、半决赛和决赛，十一人制保留原阶段', () => {
    expect(stageOptions('five').map((s) => s.label)).toEqual(['常规赛', '排位赛', '半决赛', '决赛']);
    expect(allowedStages('five')).toEqual(['group', 'placement', 'semifinal', 'final']);
    expect(stageOptions('eleven').map((s) => s.label)).toEqual(['小组赛', '排位赛', '淘汰赛', '半决赛', '季军赛', '决赛']);
    expect(stageName('group', 'five')).toBe('常规赛');
    expect(stageName('group', 'eleven')).toBe('小组赛');
    expect(matchStageLabel({ ...match, channel: 'five', group: 'A', stage: 'group' })).toBe('A · 常规赛');
    expect(matchStageLabel({ ...match, channel: 'five', group: '常规赛', stage: 'group' })).toBe('常规赛');
  });
  it('常规赛名称兼容旧数据，不改变工资积分，Excel 按女足阶段识别', () => {
    const women = { ...match, channel: 'five' as const, event: 'womens-pku-cup' as const, competition: '女足北大杯' };
    expect(calculateOfficial(women, { ...official, role: 'first' }, 'C')).toMatchObject({ points: 2, wage: 40, bonusWage: 0 });
    expect(calculateOfficial({ ...women, stage: 'semifinal' }, { ...official, role: 'first' }, 'C')).toMatchObject({ points: 3, wage: 50, bonusWage: 10 });
    expect(stageFor('常规赛', 'five')).toBe('group');
    expect(stageFor('排位赛', 'five')).toBe('placement');
    expect(stageFor('季军赛', 'five')).toBe('placement');
    expect(stageFor('半决赛', 'five')).toBe('semifinal');
    expect(stageFor('决赛', 'five')).toBe('final');
    expect(() => stageFor('淘汰赛', 'five')).toThrow('女足北大杯阶段');
  });
  it('女足保存只接受四种阶段，不能从接口写入淘汰赛或季军赛', async () => {
    let data = seed();
    const repo = { async load() { return structuredClone(data); }, async save(next: DataStore) { data = next; } };
    const save = (stage: string) => handleApi(new Request('https://test/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': String(data.revision) }, body: JSON.stringify({ ...match, id: `women-${stage}`, channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage }) }), repo, { authenticated: true });
    for (const stage of allowedStages('five')) expect((await save(stage)).status).toBe(201);
    for (const stage of ['knockout', 'third']) expect((await save(stage)).status).toBe(400);
    expect(data.matches).toHaveLength(4);
    expect(validateSnapshot(data).matches).toHaveLength(4);
    expect(() => validateSnapshot({ ...data, matches: [{ ...data.matches[0], stage: 'third' }] })).toThrow('比赛记录格式');
  });
});

describe('持久化、接口权限、备份及导入', () => {
  it('绑定保存在版本快照，比赛缺省自动填色并生成成对附加岗位', async () => {
    let data = seed();
    const repository = { async load() { return structuredClone(data); }, async save(next: DataStore) { data = structuredClone(next); }, async history() { return []; }, async snapshot() { return data; } };
    const call = (method: string, url: string, body?: unknown, admin = true) => handleApi(new Request('https://test'+url, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(data.revision || 0) }, ...(body ? { body: JSON.stringify(body) } : {}) }), repository, { authenticated: admin, publicQueries: true });
    const binding: Team = { event: 'freshmen-cup', name: '测试甲', color: '#FF0000' };
    expect((await call('PUT', '/api/teams', binding, false)).status).toBe(401);
    expect((await call('PUT', '/api/teams', binding)).status).toBe(200);
    expect((await call('PUT', '/api/teams', { ...binding, color: '#00FF00' })).status).toBe(200);
    expect(data.teams).toHaveLength(1);
    const saved = await call('POST', '/api/matches', { ...match, stage: 'placement', additionalAssistants: true, officials: [official] });
    expect(saved.status).toBe(201);
    const m = await saved.json();
    expect(m.homeColor).toBe('#00FF00');
    expect(m.stage).toBe('placement');
    expect(validateSnapshot(data).matches[0].stage).toBe('placement');
    expect(m.officials.filter((o: Official) => additionalAssistantRoles.includes(o.role))).toHaveLength(2);
    expect(validateSnapshot(data).teams).toEqual(data.teams);
    const oldRevision = data.revision;
    expect((await call('POST', '/api/matches', { ...match, id: 'bad', channel: 'five', event: 'womens-pku-cup', additionalAssistants: true })).status).toBe(400);
    expect((await call('PUT', '/api/teams', { ...binding, color: 'invalid' })).status).toBe(400);
    expect(data.revision).toBe(oldRevision);
    expect(() => validateSnapshot({ ...data, teams: [...data.teams!, ...data.teams!] })).toThrow();
    const publicView = await (await call('GET', '/api/data', undefined, false)).json();
    expect(publicView.teams).toEqual(data.teams);
    expect(publicView.matches[0].additionalAssistants).toBe(true);
    expect((await call('DELETE', '/api/teams?event=freshmen-cup&name='+encodeURIComponent(binding.name))).status).toBe(204);
    expect(data.teams).toHaveLength(0);
    expect(data.matches[0].homeColor).toBe('#00FF00');
  });
  it('Excel 阶段识别不会把四分之一、八分之一决赛当作决赛发补贴', () => {
    for (const label of ['1/4决赛', '1／8决赛', '四分之一决赛', '八分之一决赛', '淘汰赛']) expect(stageFor(label)).toBe('knockout');
    for (const label of ['半决赛', '1/2决赛', '二分之一决赛']) expect(stageFor(label)).toBe('semifinal');
    expect(stageFor('甲组决赛')).toBe('final');
    expect(stageFor('季军赛')).toBe('third');
    for (const label of ['排位赛', '5-8名排位赛', '9-12名排名赛', '名次赛']) expect(stageFor(label)).toBe('placement');
  });
  it('重传原始四岗位 Excel 不会清除手动启用的附加助理', () => {
    const data = seed();
    const original = { ...match, id: 'existing', status: 'scheduled' as const, group: 'A', additionalAssistants: true, officials: [official, { role: 'additionalAssistant2' as const, refereeId: null, name: '' }] };
    data.matches = [original];
    const row = (values: string[], n: number) => `<row r="${n}">${values.map((v, i) => `<c r="${String.fromCharCode(65+i)}${n}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`;
    const workbook = zipSync({ 'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试" sheetId="1" r:id="rId1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${row(['日期','时间','场地','组别','主队','客队','主裁','助理1','助理2','四官'],1)}${row(['10.3','12:00-14:00','北场','A','测试甲','测试乙','','','',''],2)}</sheetData></worksheet>`) });
    importAssignmentWorkbook(data, workbook, '2026–27');
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].additionalAssistants).toBe(true);
    expect(data.matches[0].officials.find((o) => o.role === 'additionalAssistant1')?.refereeId).toBe('r1');
  });
});
