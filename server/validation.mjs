const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export function validateSnapshot(input) {
  const value = input?.data || input;
  if (!value || value.version !== 1 || !value.meta || typeof value.meta.season !== 'string' || !Array.isArray(value.referees) || !Array.isArray(value.matches) || !Array.isArray(value.adjustments)) throw new Error('不是有效的平台备份文件');
  const ids = new Set();
  for (const r of value.referees) {
    if (!r.id || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || !r.channels || typeof r.channels !== 'object') throw new Error('裁判员档案格式有误');
    ids.add(r.id);
    for (const [channel, s] of Object.entries(r.channels)) {
      if (!['eleven', 'five'].includes(channel) || !s || !finite(s.basePoints) || !finite(s.previousWage) || !(channel === 'five' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E']).includes(s.baseLevel) || (s.levelOverride && !(channel === 'five' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E']).includes(s.levelOverride)) || !s.historical || !s.historical.roleCounts || ['pointsEarned', 'bonusWage', 'deductedWage', 'bonusPoints', 'deductedPoints'].some((k) => !finite(s.historical[k]))) throw new Error('裁判员积分工资档案格式有误');
    }
  }
  const matchIds = new Set();
  for (const m of value.matches) {
    if (!m.id || matchIds.has(m.id) || !date(m.date) || !['eleven', 'five'].includes(m.channel) || !['scheduled', 'completed', 'cancelled'].includes(m.status) || !Array.isArray(m.officials) || !Array.isArray(m.bonuses) || !finite(m.week) || !['group', 'knockout', 'semifinal', 'final', 'third'].includes(m.stage) || ['competition', 'time', 'venue', 'group', 'home', 'away', 'note'].some((k) => typeof m[k] !== 'string')) throw new Error('比赛记录格式有误');
    matchIds.add(m.id);
    for (const o of m.officials) if (typeof o.name !== 'string' || !(m.channel === 'five' ? ['first', 'second', 'third'] : ['referee', 'assistant1', 'assistant2', 'fourth']).includes(o.role) || (o.refereeId && !value.referees.some((r) => r.id === o.refereeId && r.channels[m.channel]))) throw new Error('选派记录关联了无效档案');
  }
  const adjustmentIds = new Set();
  for (const a of value.adjustments) {
    if (!a.id || adjustmentIds.has(a.id) || !value.referees.some((r) => r.id === a.refereeId && r.channels[a.channel]) || !finite(a.points) || !finite(a.wage) || !date(a.date) || !['reward', 'penalty'].includes(a.type) || typeof a.reason !== 'string' || typeof a.season !== 'string') throw new Error('奖惩记录格式有误');
    adjustmentIds.add(a.id);
  }
  const leaveIds = new Set();
  for (const l of value.unavailability || []) {
    if (!l.id || leaveIds.has(l.id) || !ids.has(l.refereeId) || !date(l.start) || !date(l.end) || l.start > l.end || typeof l.reason !== 'string') throw new Error('请假记录格式有误');
    leaveIds.add(l.id);
  }
  return structuredClone(value);
}
