import { describe, expect, it } from 'vitest';
import { availableSeasons, calculateOfficial, displayLevel, effectiveMatchStatus, getChannelSummary, getCompetitionSummaries, getSeasonPoints, getSeasonWage, getUpgradeRecommendation, HISTORY_SEASON } from '../src/domain/calculations';
import type { Match, Referee } from '../src/domain/types';

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1', season: '2026–27', week: 1, channel: 'eleven', competition: '新生杯', date: '2026-11-01', time: '12:00-14:00', venue: '北场', group: 'A', home: '甲', away: '乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [], ...overrides,
  };
}

const referee: Referee = {
  id: 'r1', name: '测试裁判', channels: {
    eleven: { basePoints: 0, baseLevel: 'E', previousWage: 100, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } },
    five: { basePoints: 0, baseLevel: 'C', previousWage: 50, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } },
  },
};

describe('工资和积分规则', () => {
  it('叠加十一人制北大杯与甲组倍率', () => {
    const result = calculateOfficial(match({ competition: '男足北大杯', division: '甲' }), { role: 'referee', refereeId: 'r1', name: '测试裁判' }, 'A');
    expect(result.points).toBeCloseTo(4.8);
    expect(result.baseWage).toBeCloseTo(137.5);
  });

  it('计算半决赛积分与早场补贴', () => {
    const result = calculateOfficial(match({ stage: 'semifinal', time: '09:00-11:00', bonuses: ['early'] }), { role: 'assistant1', refereeId: 'r1', name: '测试裁判' }, 'B');
    expect(result.points).toBe(3);
    expect(result.bonusWage).toBe(20);
    expect(result.wage).toBe(85);
  });

  it('临时替补在基础工资外增加 10 元且不改变积分', () => {
    const result = calculateOfficial(match(), { role: 'referee', refereeId: 'r1', name: '测试裁判', substitute: true }, 'A');
    expect(result.points).toBe(4);
    expect(result.baseWage).toBe(125);
    expect(result.bonusWage).toBe(10);
    expect(result.wage).toBe(135);
  });

  it('按五人制岗位和决赛阶段计算', () => {
    const game = match({ channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', stage: 'final' });
    expect(calculateOfficial(game, { role: 'first', refereeId: 'r1', name: '测试裁判' }, 'C')).toMatchObject({ points: 3, wage: 60 });
    expect(calculateOfficial(game, { role: 'third', refereeId: 'r1', name: '测试裁判' }, 'C')).toMatchObject({ points: 1.5, wage: 30 });
  });

  it('保持渠道独立并按赛季汇总工资', () => {
    const matches = [
      match({ officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] }),
      match({ id: 'm2', channel: 'five', event: 'womens-pku-cup', competition: '女足北大杯', officials: [{ role: 'first', refereeId: 'r1', name: '测试裁判' }] }),
      match({ id: 'm3', date: '2999-11-01', status: 'scheduled', officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] }),
    ];
    const adjustments = [{ id: 'a1', refereeId: 'r1', channel: 'eleven' as const, season: '2026–27', date: '2026-11-01', type: 'reward' as const, points: 2, wage: 10, reason: '测试' }];
    expect(getChannelSummary(referee, 'eleven', matches, adjustments)?.points).toBe(6);
    expect(getChannelSummary(referee, 'five', matches, adjustments)?.points).toBe(2);
    expect(getSeasonWage(referee, 'eleven', '2026–27', matches, adjustments)?.total).toBe(100);
    expect(getSeasonWage(referee, 'eleven', HISTORY_SEASON, matches, adjustments)?.total).toBe(100);
    expect(availableSeasons(matches, adjustments)).toContain(HISTORY_SEASON);
  });

  it('按当前赛季和赛事独立核算，不重复历史基础积分', () => {
    const experienced: Referee = { ...referee, channels: { ...referee.channels, eleven: { ...referee.channels.eleven!, basePoints: 100 } } };
    const official = { role: 'referee' as const, refereeId: 'r1', name: '测试裁判' };
    const matches = [
      match({ event: 'freshmen-cup', officials: [official] }),
      match({ id: 'm2', event: 'mens-pku-cup', competition: '男足北大杯', division: '甲', officials: [official] }),
      match({ id: 'm3', event: 'other' as never, competition: '集智计电', officials: [official] }),
      match({ id: 'm4', season: HISTORY_SEASON, event: 'freshmen-cup', officials: [official] }),
      match({ id: 'm5', date: '2999-11-01', status: 'scheduled', event: 'freshmen-cup', officials: [official] }),
    ];
    const adjustments = [
      { id: 'a1', refereeId: 'r1', channel: 'eleven' as const, season: '2026–27', event: 'freshmen-cup' as const, date: '2026-11-01', type: 'reward' as const, points: 2, wage: 10, reason: '赛事奖励' },
      { id: 'a2', refereeId: 'r1', channel: 'eleven' as const, season: '2026–27', date: '2026-11-01', type: 'reward' as const, points: 3, wage: 20, reason: '未归赛事' },
    ];
    const summaries = getCompetitionSummaries(experienced, 'eleven', '2026–27', matches, adjustments);
    expect(summaries.find((item) => item.event === 'freshmen-cup')).toMatchObject({ points: 6, total: 100 });
    const mens = summaries.find((item) => item.event === 'mens-pku-cup');
    expect(mens?.points).toBeCloseTo(4.8);
    expect(mens?.total).toBeCloseTo(99);
    expect(summaries).toHaveLength(3);
    expect(summaries.reduce((sum, item) => sum + item.points, 0)).toBeCloseTo(10.8);
    expect(summaries.find((item) => item.event === 'womens-pku-cup')).toMatchObject({ points: 0, total: 0 });
    const eventWage = summaries.reduce((sum, item) => sum + item.total, 0);
    expect(eventWage + 20).toBeCloseTo(getSeasonWage(experienced, 'eleven', '2026–27', matches, adjustments)?.total || 0);
    const historicalEvents = getCompetitionSummaries(experienced, 'eleven', HISTORY_SEASON, matches, adjustments);
    expect(historicalEvents.find((item) => item.event === 'freshmen-cup')).toMatchObject({ points: 4, total: 90 });
    expect(historicalEvents.reduce((sum, item) => sum + item.total, 0)).toBe(90);
  });

  it('按指定赛事应用自定义工资标准，历史工资不受影响', () => {
    const official = { role: 'referee' as const, refereeId: 'r1', name: '测试裁判' };
    const custom = { 'freshmen-cup': { A: [126, 71, 46], E: [91, 51, 21] } };
    const freshmen = match({ event: 'freshmen-cup', officials: [official] });
    const mens = match({ event: 'mens-pku-cup', competition: '男足北大杯', officials: [official] });
    expect(calculateOfficial(freshmen, official, 'A', custom).baseWage).toBe(126);
    expect(calculateOfficial(mens, official, 'A', custom).baseWage).toBe(125);
    expect(calculateOfficial(match({ event: 'other' as never, competition: '集智计电' }), official, 'A', custom).wage).toBe(0);
    expect(getSeasonWage(referee, 'eleven', '2026–27', [freshmen], [], custom)?.total).toBe(91);
    expect(getSeasonWage(referee, 'eleven', HISTORY_SEASON, [freshmen], [], custom)?.total).toBe(100);
  });

  it('遗留其他赛事不再计算积分、工资、补贴或奖惩', () => {
    const legacyMatch = match({ event: 'other' as never, competition: '集智计电', stage: 'final', bonuses: ['early', 'badWeather'], officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判', substitute: true }] });
    const official = legacyMatch.officials[0];
    const result = calculateOfficial(legacyMatch, official, 'A');
    expect(result).toMatchObject({ points: 0, baseWage: 0, bonusWage: 0, wage: 0 });
    const legacyAdjustment = { id: 'legacy', refereeId: 'r1', channel: 'eleven' as const, season: '2026–27', event: 'other' as never, date: '2026-11-01', type: 'reward' as const, points: 5, wage: 50, reason: '遗留记录' };
    expect(getSeasonPoints(referee, 'eleven', '2026–27', [legacyMatch], [legacyAdjustment])?.total).toBe(0);
    expect(getSeasonWage(referee, 'eleven', '2026–27', [legacyMatch], [legacyAdjustment])?.total).toBe(0);
  });

  it('本赛季积分不包含历史基础积分', () => {
    const experienced: Referee = { ...referee, channels: { eleven: { ...referee.channels.eleven!, basePoints: 100 } } };
    const matches = [match({ officials: [{ role: 'referee', refereeId: 'r1', name: '测试裁判' }] })];
    expect(getSeasonPoints(experienced, 'eleven', '2026–27', matches, [])).toMatchObject({ matchPoints: 4, adjustmentPoints: 0, total: 4 });
    expect(getChannelSummary(experienced, 'eleven', matches, [])?.points).toBe(104);
  });

  it('赛季中不自动升级，等级仅由后台人工调整', () => {
    const manual: Referee = { ...referee, channels: { eleven: { ...referee.channels.eleven!, basePoints: 100, baseLevel: 'E' } } };
    expect(displayLevel('eleven', 'E', 100)).toBe('B');
    expect(getChannelSummary(manual, 'eleven', [], [])?.level).toBe('E');
    manual.channels.eleven!.levelOverride = 'D';
    expect(getChannelSummary(manual, 'eleven', [], [])?.level).toBe('D');
  });

  it('提示达到升级条件及下一等级积分90%的裁判', () => {
    expect(getUpgradeRecommendation('eleven', 'E', 8.9)).toBeNull();
    expect(getUpgradeRecommendation('eleven', 'E', 9)).toMatchObject({ kind: 'approaching', level: 'D', targetPoints: 10 });
    expect(getUpgradeRecommendation('eleven', 'E', 10)).toMatchObject({ kind: 'ready', level: 'D' });
    expect(getUpgradeRecommendation('eleven', 'E', 100)).toMatchObject({ kind: 'ready', level: 'B' });
    expect(getUpgradeRecommendation('five', 'C', 4.5)).toMatchObject({ kind: 'approaching', level: 'B', targetPoints: 5 });
    expect(getUpgradeRecommendation('five', 'C', 15)).toMatchObject({ kind: 'ready', level: 'A' });
    expect(getUpgradeRecommendation('eleven', 'A', 200)).toBeNull();
  });

  it('按比赛结束时间自动完成，保留取消与手动完成状态', () => {
    const now = new Date('2026-11-01T14:00:00+08:00');
    expect(effectiveMatchStatus(match({ status: 'scheduled', time: '12:00-14:00' }), now)).toBe('completed');
    expect(effectiveMatchStatus(match({ status: 'scheduled', time: '14:00-16:00' }), now)).toBe('scheduled');
    expect(effectiveMatchStatus(match({ status: 'cancelled', time: '12:00-14:00' }), now)).toBe('cancelled');
    expect(effectiveMatchStatus(match({ status: 'completed', date: '2026-11-02' }), now)).toBe('completed');
  });

  it('积分增加可升级，扣分不自动降低历史等级', () => {
    expect(displayLevel('eleven', 'E', 30)).toBe('C');
    expect(displayLevel('eleven', 'A', 20)).toBe('A');
    expect(displayLevel('five', 'C', 15)).toBe('A');
  });
});
