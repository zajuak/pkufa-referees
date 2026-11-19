import type { Adjustment, Role } from './types.ts';
import { qualificationForRole, qualificationNames } from './penalty-rules.ts';
export function penaltyEligibilityIssues(refereeId: string, role: Role, date: string, adjustments: Adjustment[]): string[] {
  const issues = new Set<string>(), kind = qualificationForRole(role);
  for (const a of adjustments) {
    if (a.voidedAt || a.refereeId !== refereeId || !a.penalty) continue;
    const sanctions = a.penalty.sanctions;
    if (date < sanctions.start) continue;
    if (sanctions.suspensionEnd && date < sanctions.suspensionEnd) issues.add(`处于停哨期（${sanctions.start} 至 ${sanctions.suspensionEnd}前），不可选派`);
    if (sanctions.qualifications.includes(kind)) {
      const restored = sanctions.reinstatements?.[kind];
      if (!restored || date < restored.date) issues.add(`${qualificationNames[kind]}资格已取消，须重新考核并登记恢复后才能选派`);
    }
  }
  return [...issues];
}
export function recentPenalty(refereeId: string, date: string, adjustments: Adjustment[]): boolean {
  const start = Date.parse(date+'T00:00:00Z')-30*86400000;
  return adjustments.some(a => !a.voidedAt && a.type === 'penalty' && a.refereeId === refereeId
    && (a.points < 0 || a.wage < 0 || Boolean(a.penalty?.sanctions.suspensionEnd) || Boolean(a.penalty?.sanctions.qualifications.length))
    && Date.parse((a.penalty?.sanctions.start || a.date)+'T00:00:00Z') >= start && (a.penalty?.sanctions.start || a.date) <= date);
}
