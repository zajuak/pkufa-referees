import type { Match, Official } from './types';

export const officialFraction = (official: Official) => official.fraction === 0.5 ? 0.5 : 1;
export const officialDuty = (match: Match, official: Official) => ({ ...match, date: official.dutyDate || match.date, time: official.dutyTime || match.time });

export function workloadIssues(officials: Official[]) {
  const issues: string[] = [];
  for (const role of new Set(officials.map((o) => o.role))) {
    const group = officials.filter((o) => o.role === role);
    if (group.length > 2 || (group.length === 2 && group.some((o) => o.fraction !== 0.5)) || (group.length === 1 && group[0].fraction === 0.5)) issues.push('续赛换裁岗位必须保留原场、续赛两条记录，且各计 0.5 场；普通岗位不能重复');
  }
  for (const o of officials) {
    if (o.fraction !== undefined && o.fraction !== 1 && o.fraction !== 0.5) issues.push('执裁场次只能为 1 或 0.5');
    if (o.fraction === 0.5 && (typeof o.actualBonus !== 'number' || !Number.isFinite(o.actualBonus) || o.actualBonus < 0)) issues.push('0.5 场须填写本次实际补贴金额（可为 0）');
    if (o.fraction !== 0.5 && (o.actualBonus !== undefined || o.dutyDate !== undefined || o.dutyTime !== undefined)) issues.push('实际执裁时间和补贴仅用于续赛换裁的 0.5 场记录');
  }
  return [...new Set(issues)];
}
