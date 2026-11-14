import type { Match, Official } from './types';

export const officialFraction = (official: Official) => official.fraction === 0.5 ? 0.5 : 1;
export const officialAllocationFraction = (official: Official) => official.fraction === 0.5 ? (official.allocationPercent ?? 50) / 100 : 1;
export const officialDuty = (match: Match, official: Official) => ({ ...match, date: official.dutyDate || match.date, time: official.dutyTime || match.time });

type InterruptedMatch = Pick<Match, 'date' | 'time' | 'officials' | 'interrupted' | 'resumption'>;
export function interruptionSettings(match: InterruptedMatch) {
  const resumed = match.officials.find((official, index, all) => official.fraction === 0.5 && all.findIndex(o => o.role === official.role) !== index);
  const legacy = match.interrupted === undefined && resumed;
  return {
    interrupted: match.interrupted ?? Boolean(resumed),
    resumption: match.resumption === undefined && legacy ? { date: resumed.dutyDate || match.date, time: resumed.dutyTime || match.time } : match.resumption,
  };
}
function validResumption(value: Match['resumption']) {
  if (!value || typeof value.date !== 'string' || typeof value.time !== 'string') return false;
  const timestamp = Date.parse(`${value.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value.date) return false;
  const parts = value.time.replace(/[—–~～]/g, '-').replace(/\s/g, '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  return Boolean(parts && Number(parts[1]) <= 23 && Number(parts[3]) <= 23 && Number(parts[2]) <= 59 && Number(parts[4]) <= 59 && (Number(parts[1]) !== Number(parts[3]) || parts[2] !== parts[4]));
}
export function resumptionReady(match: InterruptedMatch) {
  const settings = interruptionSettings(match);
  return settings.interrupted === true && validResumption(settings.resumption);
}
export function interruptionIssues(match: InterruptedMatch) {
  if (match.interrupted !== undefined && typeof match.interrupted !== 'boolean') return ['比赛中断设置格式不正确'];
  if (match.resumption !== undefined && !validResumption(match.resumption)) return ['请完整填写有效的接续比赛日期和时间'];
  if (match.resumption && !interruptionSettings(match).interrupted) return ['请先选择比赛中断，再设置接续比赛时间'];
  if (match.officials.some(o => o.fraction === 0.5) && !resumptionReady(match)) return ['请选择比赛中断并填写接续比赛时间后，再设置续赛裁判'];
  return [];
}

export function workloadIssues(officials: Official[]) {
  const issues: string[] = [];
  for (const role of new Set(officials.map((o) => o.role))) {
    const group = officials.filter((o) => o.role === role);
    if (group.length > 2 || (group.length === 2 && group.some((o) => o.fraction !== 0.5)) || (group.length === 1 && group[0].fraction === 0.5)) issues.push('续赛换裁岗位必须保留原场、续赛两条记录，且各计 0.5 场；普通岗位不能重复');
  }
  for (const o of officials) {
    if (o.fraction !== undefined && o.fraction !== 1 && o.fraction !== 0.5) issues.push('执裁场次只能为 1 或 0.5');
    if (o.fraction === 0.5 && (typeof o.actualBonus !== 'number' || !Number.isFinite(o.actualBonus) || o.actualBonus < 0)) issues.push('0.5 场须填写本次实际补贴金额（可为 0）');
    if (o.allocationPercent !== undefined && (typeof o.allocationPercent !== 'number' || !Number.isFinite(o.allocationPercent) || o.allocationPercent < 0)) issues.push('分配比例须为有效的非负百分比');
    if (o.fraction !== 0.5 && o.allocationPercent !== undefined) issues.push('分配比例仅用于续赛换裁记录');
    if (o.fraction !== 0.5 && (o.actualBonus !== undefined || o.dutyDate !== undefined || o.dutyTime !== undefined)) issues.push('实际执裁时间和补贴仅用于续赛换裁的 0.5 场记录');
  }
  return [...new Set(issues)];
}
