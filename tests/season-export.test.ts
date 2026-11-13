import { describe, expect, it } from 'vitest';
import { createSeasonWorkbook, elevenExportHeaders, fiveExportHeaders, seasonExportRows } from '../src/domain/season-export';
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

  it('生成可解析的十一人制和五人制双工作表 Excel', () => {
    const workbook = parseWorkbook(createSeasonWorkbook(store));
    expect(workbook.worksheets.map((sheet: { name: string }) => sheet.name)).toEqual(['十一人制', '五人制']);
    const eleven = workbook.getWorksheet('十一人制');
    const five = workbook.getWorksheet('五人制');
    expect(eleven.getRow(1).values.slice(1)).toEqual(elevenExportHeaders);
    expect(eleven.getRow(2).getCell(4).value).toBe('108.6');
    expect(eleven.getRow(2).getCell(29).value).toBe('192');
    expect(five.getRow(1).values.slice(1)).toEqual(fiveExportHeaders);
    expect(five.getRow(2).getCell(10).value).toBe('60');
  });
});
