import type { Adjustment, Channel, DataStore, Official, PenaltyInput, PenaltyRecord, Qualification } from './types.ts';
import { calculateOfficial, effectiveMatchStatus } from './calculations.ts';
import { getMatchEvent } from './competitions.ts';
import { financialAdjustments } from './financial-adjustments.ts';
import { officialDuty } from './workload.ts';
import { matchInterval, requiredRoles } from './scheduling.ts';
import { penaltyRules, qualifications, qualificationForRole, type Range } from './penalty-rules.ts';
export const pointRound = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const moneyRound = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const beijingToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
export const validPenaltyDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v+'T00:00:00Z').toISOString().slice(0, 10) === v;
const addDays = (date: string, n: number) => new Date(Date.parse(date+'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function addYears(date: string, years: number) {
  const d = new Date(date+'T00:00:00Z'), month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear()+years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
const valueIn = (value: unknown, range: Range, label: string, mitigated = false, integer = false): number => {
  const n = value === undefined && range[0] === range[1] ? range[0] : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < (mitigated ? 0 : range[0]) || n > range[1] || (integer && !Number.isInteger(n))) throw new Error(`${label}须在${mitigated ? 0 : range[0]}–${range[1]}范围内${integer ? '，并填写整数' : ''}`);
  return n;
};
function incidentTime(a: Adjustment, store: DataStore): number {
  const saved = a.penalty?.basis;
  const match = store.matches.find(m => m.id === a.matchId);
  return matchInterval(saved || match || { date: a.date, time: '00:00-00:01' })?.[0] ?? Date.parse(a.date+'T00:00:00+08:00');
}
export function pointsBeforeIncident(store: DataStore, refereeId: string, channel: Channel, start: number, excludedMatchId?: string): number {
  const referee = store.referees.find(r => r.id === refereeId), stats = referee?.channels[channel];
  if (!stats) return 0;
  let points = stats.basePoints;
  for (const match of store.matches) {
    if (match.id === excludedMatchId || match.channel !== channel || match.status === 'cancelled') continue;
    for (const official of match.officials.filter(o => o.refereeId === refereeId)) {
      const duty = officialDuty(match, official), interval = matchInterval(duty);
      if (interval && interval[1] <= start && effectiveMatchStatus(duty) === 'completed') points += calculateOfficial(duty, official, stats.baseLevel, store.wageStandards).points;
    }
  }
  points += financialAdjustments(store.adjustments).filter(a => a.matchId !== excludedMatchId && a.refereeId === refereeId && a.channel === channel && incidentTime(a, store) < start).reduce((sum, a) => sum+a.points, 0);
  return pointRound(Math.max(0, points));
}

export function quotePenalty(store: DataStore, input: PenaltyInput): { points: number; wage: number; crossChannelPoints?: Adjustment['crossChannelPoints']; penalty: PenaltyRecord } {
  const match = store.matches.find(m => m.id === input.matchId), referee = store.referees.find(r => r.id === input.refereeId);
  if (!match || !referee || !referee.channels[match.channel] || !getMatchEvent(match)) throw new Error('请选择有效的关联比赛和对应赛制裁判员');
  for (const key of ['originalAssignmentConfirmed', 'mitigated', 'repeat', 'schoolNotice', 'internalNotice'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('处罚选项格式不正确');
  const rule = penaltyRules.find(r => r.code === input.ruleCode);
  if (!rule) throw new Error('请选择处罚条款');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) throw new Error('请填写本场事实、情节与处理依据（最多2000字）');
  const assigned = match.officials.find(o => o.refereeId === referee.id);
  if (!assigned && input.originalAssignmentConfirmed !== true) throw new Error('原定裁判已被替换时，须明确确认原定选派及岗位并说明事实');
  const role = assigned?.role || input.role;
  if (!role || !requiredRoles(match.channel, true).includes(role)) throw new Error('请选择该场原定裁判岗位');
  const official: Official = assigned || { role, refereeId: referee.id, name: referee.name };
  const creditedDuty = officialDuty(match, official);
  if (input.dutySession !== undefined && !['original', 'resumption'].includes(input.dutySession)) throw new Error('请选择有效的原场或续赛时段');
  if (input.dutySession === 'resumption' && !match.resumption) throw new Error('该场尚未设置接续比赛时间');
  const duty = input.dutySession === 'resumption' && official.fraction !== 0.5 ? { ...match, ...match.resumption! } : creditedDuty;
  const interval = matchInterval(duty);
  if (!interval) throw new Error('关联比赛的执裁时间不完整');
  const mitigating = input.mitigated === true;
  if ((rule.recordOnly || rule.warning) && input.internalNotice) throw new Error('仅记录事件或首次警告不附加内部通报批评');
  if (mitigating && (!input.mitigationReason?.trim() || ['unavoidable', 'fight', 'bribery', 'severe-other'].includes(rule.code))) throw new Error('请明确从轻依据；已查实骂战冲突、受贿条款不得通过此选项改写');
  if (input.internalNotice === false && rule.notice && !mitigating) throw new Error('按该条款须内部通报批评；从轻处理请写明依据');
  const matchPercent = valueIn(input.matchPointsPercent, rule.custom ? [0, 100] : [rule.matchPoints, rule.matchPoints], '本场积分扣除比例', mitigating);
  const cumulativePercent = valueIn(input.cumulativePercent, rule.custom ? [0, 100] : [rule.cumulative, rule.cumulative], '累计积分扣除比例', mitigating);
  const wagePercent = valueIn(input.wagePercent, rule.wage, '工资扣除比例', mitigating);
  const extra = valueIn(input.extraPoints, rule.extra, '额外扣除裁判积分', mitigating);
  const weeks = valueIn(input.suspensionWeeks, rule.suspension, '停哨周数', mitigating, true);
  const repeated = input.repeat === true;
  if (repeated && rule.recordOnly) throw new Error('仅记录事件不能同时使用屡犯不改加罚');
  const repeatPoints = repeated ? valueIn(input.repeatPoints, [0, 10], '屡犯不改追加积分') : 0;
  const repeatWeeks = repeated ? valueIn(input.repeatWeeks, [0, 2], '屡犯不改追加停哨周数', false, true) : 0;
  const effectiveDate = input.effectiveDate || beijingToday();
  if (!validPenaltyDate(effectiveDate) || effectiveDate < duty.date) throw new Error('处罚生效日期不得早于违规执裁日期');
  let revoked: Qualification[] = [];
  if (rule.qualifications === 'all') revoked = [...qualifications];
  if (rule.qualifications === 'current') revoked = [qualificationForRole(role)];
  if (rule.qualifications === 'choose') {
    if (!Array.isArray(input.qualifications) || !input.qualifications.length || input.qualifications.length > 2 || input.qualifications.some(q => !qualifications.includes(q))) throw new Error('请按决定选择取消的一项或两项裁判资格');
    revoked = [...new Set(input.qualifications)];
  }
  const years = revoked.length ? valueIn(input.qualificationYears, rule.years ? [rule.years, rule.years] : [1, 20], '不得申请考核年限', false, true) : 0;
  if (input.schoolNotice && !['morality', 'fight', 'bribery', 'severe-other', 'custom'].includes(rule.code)) throw new Error('通报学校仅用于职业道德或裁判部另行决定');
  if (rule.schoolNotice && input.schoolNotice === false) throw new Error('按该条款须通报学校');
  const schoolNotice = input.schoolNotice ?? Boolean(rule.schoolNotice);
  const calculation = calculateOfficial(creditedDuty, official, referee.channels[match.channel]!.baseLevel, store.wageStandards);
  const credited = assigned && match.status !== 'cancelled';
  const matchPoints = credited ? calculation.points : 0, totalWage = credited ? calculation.wage : 0;
  const beforePoints = pointsBeforeIncident(store, referee.id, match.channel, interval[0], match.id);
  const prior = store.adjustments.filter(a => !a.voidedAt && a.type === 'penalty' && a.matchId === match.id && a.refereeId === referee.id && a.channel === match.channel);
  const legacyPoints = prior.filter(a => !a.penalty).reduce((sum, a) => sum + Math.max(0, -a.points), 0);
  const availableMatchPoints = pointRound(Math.max(0, matchPoints - prior.reduce((sum, a) => sum + (a.penalty?.deductions.matchPoints || 0), 0) - Math.min(legacyPoints, matchPoints)));
  const availableBeforePoints = pointRound(Math.max(0, beforePoints - prior.reduce((sum, a) => sum + (a.penalty ? a.penalty.deductions.cumulativePoints + a.penalty.deductions.extraPoints : 0), 0) - Math.max(0, legacyPoints-matchPoints)));
  const availableWage = moneyRound(Math.max(0, totalWage - prior.reduce((sum, a) => sum + Math.max(0, -a.wage), 0)));
  const matchCut = Math.min(availableMatchPoints, pointRound(matchPoints*matchPercent/100));
  const cumulativeCut = Math.min(availableBeforePoints, pointRound(beforePoints*cumulativePercent/100));
  const extraCut = Math.min(pointRound(Math.max(0, availableBeforePoints-cumulativeCut)), pointRound(extra+repeatPoints));
  const minimum = mitigating ? 0 : rule.minimumWage || 0;
  const wageCut = Math.min(availableWage, moneyRound(wagePercent > 0 ? Math.max(totalWage*wagePercent/100, minimum) : 0));
  const other: Channel = match.channel === 'eleven' ? 'five' : 'eleven';
  const otherBefore = pointsBeforeIncident(store, referee.id, other, interval[0], match.id);
  const alreadyCross = prior.reduce((sum, a) => sum + (a.crossChannelPoints?.channel === other ? Math.max(0, -a.crossChannelPoints.points) : 0), 0);
  const crossCut = rule.qualifications === 'all' && cumulativePercent === 100 ? pointRound(Math.max(0, otherBefore-alreadyCross)) : 0;
  const decision: PenaltyInput = { matchId: match.id, refereeId: referee.id, ruleCode: rule.code, reason: input.reason.trim(), originalAssignmentConfirmed: input.originalAssignmentConfirmed === true, dutySession: input.dutySession, mitigated: mitigating, mitigationReason: input.mitigationReason, repeat: repeated, schoolNotice, internalNotice: input.internalNotice ?? Boolean(rule.notice), role, matchPointsPercent: matchPercent, cumulativePercent, wagePercent, extraPoints: extra, suspensionWeeks: weeks, repeatPoints, repeatWeeks, effectiveDate, qualifications: revoked, qualificationYears: years };
  return {
    points: -pointRound(matchCut+cumulativeCut+extraCut) || 0, wage: -moneyRound(wageCut) || 0, ...(crossCut ? { crossChannelPoints: { channel: other, points: -crossCut } } : {}),
    penalty: {
      ruleCode: rule.code, title: rule.title, clause: rule.clause, ruleText: rule.text, rulesVersion: store.meta.rulesVersion, decision,
      basis: { date: duty.date, time: duty.time, role, originalAssignment: !assigned, matchPoints, baseWage: credited ? calculation.baseWage : 0, bonusWage: credited ? calculation.bonusWage : 0, totalWage, beforePoints, otherChannelBeforePoints: otherBefore, availableMatchPoints, availableWage, availableBeforePoints },
      deductions: { matchPoints: matchCut, cumulativePoints: cumulativeCut, extraPoints: extraCut, wage: wageCut }, warning: Boolean(rule.warning), notice: input.internalNotice ?? Boolean(rule.notice), schoolNotice,
      sanctions: { start: effectiveDate, ...(weeks+repeatWeeks ? { suspensionEnd: addDays(effectiveDate, (weeks+repeatWeeks)*7) } : {}), qualifications: revoked, ...(revoked.length ? { reapplyAfter: addYears(effectiveDate, years) } : {}) },
    },
  };
}

export function validateSavedPenalty(a: Adjustment): void {
  if (!a.penalty) {
    if (a.crossChannelPoints || a.voidedAt || a.voidReason) throw new Error('处罚审计信息缺少处罚明细');
    return;
  }
  const p = a.penalty, finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const fail = () => { throw new Error('处罚明细或冻结核算数据格式不正确'); };
  if (a.type !== 'penalty' || !a.matchId || a.points > 0 || a.wage > 0 || !penaltyRules.some(r => r.code === p.ruleCode) || !p.decision || p.decision.ruleCode !== p.ruleCode || p.decision.matchId !== a.matchId || p.decision.refereeId !== a.refereeId || !p.basis || !p.deductions || !p.sanctions) return fail();
  if (['title', 'clause', 'ruleText', 'rulesVersion'].some(k => typeof p[k as 'title'] !== 'string' || !p[k as 'title'])) return fail();
  const d = p.decision;
  if (typeof d.reason !== 'string' || !d.reason.trim() || d.reason.length > 2000 || d.reason !== a.reason || d.role !== p.basis.role || d.effectiveDate !== p.sanctions.start
    || ['matchPointsPercent', 'cumulativePercent', 'wagePercent'].some(k => !finite(d[k as 'wagePercent']) || d[k as 'wagePercent']! > 100)
    || ['extraPoints', 'repeatPoints', 'suspensionWeeks', 'repeatWeeks', 'qualificationYears'].some(k => !finite(d[k as 'extraPoints']))
    || ['suspensionWeeks', 'repeatWeeks', 'qualificationYears'].some(k => !Number.isInteger(d[k as 'suspensionWeeks']))
    || d.repeatPoints! > 10 || d.repeatWeeks! > 2 || d.suspensionWeeks! > 52 || d.qualificationYears! > 20
    || ['originalAssignmentConfirmed', 'mitigated', 'repeat', 'schoolNotice', 'internalNotice'].some(k => typeof d[k as 'mitigated'] !== 'boolean')
    || (d.mitigated && (typeof d.mitigationReason !== 'string' || !d.mitigationReason.trim()))
    || (d.dutySession !== undefined && !['original', 'resumption'].includes(d.dutySession))) return fail();
  if (!validPenaltyDate(p.basis.date) || !matchInterval(p.basis) || !requiredRoles(a.channel, true).includes(p.basis.role)
    || ['matchPoints', 'baseWage', 'bonusWage', 'totalWage', 'beforePoints', 'otherChannelBeforePoints', 'availableMatchPoints', 'availableWage', 'availableBeforePoints'].some(k => !finite(p.basis[k as 'matchPoints']))
    || Object.values(p.deductions).length !== 4 || Object.values(p.deductions).some(n => !finite(n)) || ['warning', 'notice', 'schoolNotice'].some(k => typeof p[k as 'warning'] !== 'boolean')) return fail();
  if (Math.abs(a.points + p.deductions.matchPoints+p.deductions.cumulativePoints+p.deductions.extraPoints) > 0.00001 || Math.abs(a.wage+p.deductions.wage) > 0.00001) return fail();
  if (!validPenaltyDate(p.sanctions.start) || !Array.isArray(p.sanctions.qualifications) || new Set(p.sanctions.qualifications).size !== p.sanctions.qualifications.length || p.sanctions.qualifications.some(q => !qualifications.includes(q))) return fail();
  if (!Array.isArray(d.qualifications) || d.qualifications.join(',') !== p.sanctions.qualifications.join(',') || p.sanctions.start < p.basis.date || p.notice !== d.internalNotice || p.schoolNotice !== d.schoolNotice
    || Math.abs(p.basis.baseWage+p.basis.bonusWage-p.basis.totalWage) > 0.00001
    || p.deductions.matchPoints > p.basis.availableMatchPoints || p.deductions.wage > p.basis.availableWage || p.deductions.cumulativePoints+p.deductions.extraPoints > p.basis.availableBeforePoints+0.00001) return fail();
  if (p.sanctions.suspensionEnd && (!validPenaltyDate(p.sanctions.suspensionEnd) || p.sanctions.suspensionEnd <= p.sanctions.start)) return fail();
  if (p.sanctions.qualifications.length && (!validPenaltyDate(p.sanctions.reapplyAfter) || p.sanctions.reapplyAfter < p.sanctions.start)) return fail();
  for (const [kind, reinstatement] of Object.entries(p.sanctions.reinstatements || {})) if (!p.sanctions.qualifications.includes(kind as Qualification) || !validPenaltyDate(reinstatement.date) || reinstatement.date < (p.sanctions.reapplyAfter || p.sanctions.start) || typeof reinstatement.reason !== 'string' || !reinstatement.reason.trim()) return fail();
  if (a.crossChannelPoints && (!['eleven', 'five'].includes(a.crossChannelPoints.channel) || a.crossChannelPoints.channel === a.channel || typeof a.crossChannelPoints.points !== 'number' || !Number.isFinite(a.crossChannelPoints.points) || a.crossChannelPoints.points >= 0 || p.sanctions.qualifications.length !== qualifications.length)) return fail();
  if (a.voidedAt && (!Number.isFinite(Date.parse(a.voidedAt)) || !a.voidReason?.trim())) return fail();
}
