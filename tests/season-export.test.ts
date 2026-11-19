import { describe, expect, it } from 'vitest';
import { createSeasonWorkbook, elevenExportHeaders, fiveExportHeaders, eventExportHeaders, seasonExportRows } from '../src/domain/season-export';
import type { DataStore, Match } from '../src/domain/types';

// @ts-ignore Node ESM 模块由服务端直接运行
const { parseWorkbook } = await import('../server/xlsx.mjs');

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm1', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯',
    date: '2026-11-01', time: '12:00-14:00', venue: '北场', group: 'A', home: '甲队', away: '乙队',
    stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [], ...overrides,
  };
}

const store: DataStore = {
  version: 1,
  meta: { association: '测试', season: '2026–27', rulesVersion: '2026 秋', importedAt: '', sourceFiles: [], counts: { elevenMatches: 3, fiveMatches: 2, cancelledMatches: 0 } },
  referees: [{
    id: 'r1', name: '测试裁判', channels: {
      eleven: { basePoints: 100, baseLevel: 'A', previousWage: 500, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } },
      five: { basePoints: 10, baseLevel: 'C', previousWage: 100, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } },
    },
  }],
  matches: [
    match({ officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] }),
    match({ id: 'm2', event: 'mens-pku-cup', competition: '男足北大杯', stage: 'semifinal', division: '甲', officials: [{ role: 'assistant1', refereeId: 'r1', name: '测试裁判' }] }),
    match({ id: 'm3', event: 'other' as never, competition: '其他比赛', officials: [{ role: 'fourth', refereeId: 'r1', name: '测试裁判' }] }),
    match({ id: 'm4', channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage: 'final', officials: [{ role: 'first', refereeId: 'r1', name: '测试裁判' }] }),
    match({ id: 'm5', channel: 'five', event: 'other' as never, competition: '其他比赛', officials: [{ role: 'third', refereeId: 'r1', name: '测试裁判' }] }),
    match({ id: 'm6', season: '2025–26', officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] }),
  ],
  adjustments: [
    { id: 'a1', refereeId: 'r1', channel: 'eleven', season: '2026–27', event: 'freshmen-cup', date: '2026-11-01', type: 'reward', points: 2, wage: 10, reason: '奖励' },
    { id: 'a2', refereeId: 'r1', channel: 'eleven', season: '2026–27', event: 'freshmen-cup', date: '2026-11-01', type: 'penalty', points: -1, wage: -30, reason: '处罚' },
  ],
};

describe('当前赛季积分工资表导出', () => {
  it('按原表列结构汇总岗位场次、积分、奖惩和工资', () => {
    const rows = seasonExportRows(store);
    expect(rows.eleven[0]).toEqual(elevenExportHeaders);
    expect(rows.eleven[1]).toEqual([
      '测试裁判', 'A', 100, 108.6, 'A', 7.6,
      1, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
      20, 30, 2, 1, 192,
    ]);
    expect(rows.five).toEqual([
      fiveExportHeaders,
      ['测试裁判', 10, 'C', 1, 0, 0, 0, 13, 'C', 60],
    ]);
  });

  it('按三个赛事生成独立工资表，奖金、扣分、扣薪分别成列', () => {
    const workbook = parseWorkbook(createSeasonWorkbook(store));
    expect(workbook.worksheets.map((sheet: { name: string }) => sheet.name)).toEqual(['新生杯', '男足北大杯', '女足北大杯']);
    const eleven = workbook.getWorksheet('新生杯');
    const five = workbook.getWorksheet('女足北大杯');
    expect(eleven.getRow(1).values.slice(1)).toEqual(eventExportHeaders['freshmen-cup']);
    expect(eleven.getRow(2).getCell(4).value).toBe('108.6');
    expect(eleven.getRow(2).getCell(17).value).toBe('105');
    expect(five.getRow(1).values.slice(1)).toEqual(eventExportHeaders['womens-pku-cup']);
    expect(five.getRow(2).getCell(12).value).toBe('60');
    expect(workbook.getWorksheet('男足北大杯').getRow(2).getCell(23).value).toBe('87');
  });

  it('同一裁判多场处罚按赛事累计，奖励不抵消处罚，撤销和其他赛季不计入', () => {
    const d=structuredClone(store);
    d.adjustments.push(
      {...d.adjustments[1],id:'fresh2',points:-0.8,wage:-12.35},
      {...d.adjustments[1],id:'mens',event:'mens-pku-cup',points:-3.6,wage:-20},
      {...d.adjustments[1],id:'five',channel:'five',event:'womens-pku-cup',points:-2,wage:-15},
      {...d.adjustments[0],id:'five-reward',channel:'five',event:'womens-pku-cup',points:3,wage:25},
      {...d.adjustments[1],id:'voided',points:-99,wage:-99,voidedAt:'2026-11-02T00:00:00Z',voidReason:'撤销'},
      {...d.adjustments[1],id:'old',season:'2025–26',points:-88,wage:-88},
    );
    const events=seasonExportRows(d).events;
    const values=(index:number)=>Object.fromEntries(events[index].rows[0].map((name,i)=>[name,events[index].rows[1][i]]));
    expect(values(0)).toMatchObject({'奖金':10,'额外得分':2,'累计扣除积分':1.8,'累计扣除工资':42.35,'工资':92.65});
    expect(values(1)).toMatchObject({'奖金':10,'额外得分':0,'累计扣除积分':3.6,'累计扣除工资':20,'工资':67});
    expect(values(2)).toMatchObject({'奖金':45,'额外得分':3,'累计扣除积分':2,'累计扣除工资':15,'工资':70});
    expect(events[0].rows[0]).not.toContain('北大-主甲');expect(events[1].rows[0]).not.toContain('新生-主');
    for(const event of events)expect(event.rows[1]).toHaveLength(event.rows[0].length);
  });

  it('旧处罚缺赛事字段时由关联比赛确定归属', () => {
    const d=structuredClone(store);delete d.adjustments[1].event;d.adjustments[1].matchId='m1';
    const [fresh,mens]=seasonExportRows(d).events;
    expect(fresh.rows[1][fresh.rows[0].indexOf('累计扣除工资')]).toBe(30);
    expect(mens.rows[1][mens.rows[0].indexOf('累计扣除工资')]).toBe(0);
  });

  it.each(['freshmen-cup','mens-pku-cup','womens-pku-cup'] as const)('可单独导出 %s，包含该赛事的扣分扣薪列', event => {
    const workbook=parseWorkbook(createSeasonWorkbook(store,'2026–27',event));
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].getRow(1).values.slice(1)).toEqual(eventExportHeaders[event]);
  });

  it('单独导出新生杯不受另一赛事甲乙级缺失影响；北大杯仍要求补全', () => {
    const d=structuredClone(store);d.matches[1].division=null;
    expect(()=>createSeasonWorkbook(d,'2026–27','freshmen-cup')).not.toThrow();
    expect(()=>createSeasonWorkbook(d,'2026–27','mens-pku-cup')).toThrow('甲／乙级');
  });
});
