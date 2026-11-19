// Public querying is a deployment switch; legacy personal-query authentication remains available.
import { matchAvoidanceSummary } from '../src/domain/avoidance.ts';
export function readableStore(store, auth) {
  const role = auth.authenticated ? 'admin' : auth.publicQueries ? 'public' : auth.role === 'referee' ? 'referee' : 'public';
  if (role === 'admin') return { ...store, access: { role } };
  const financialQueries = auth.publicQueries || role === 'referee';
  const referees = financialQueries ? store.referees.filter((r) => auth.publicQueries || r.id === auth.refereeId).map((r) => ({
    id: r.id, name: r.name, avoidanceColleges: r.avoidanceColleges || [],
    channels: Object.fromEntries(Object.entries(r.channels).map(([channel, stats]) => [channel, Object.fromEntries(['basePoints', 'baseLevel', 'levelOverride', 'previousWage', 'historical'].filter((key) => stats[key] !== undefined).map((key) => [key, stats[key]]))])),
  })) : [];
  return {
    version: store.version, revision: store.revision || 0, updatedAt: store.updatedAt,
    meta: { association: store.meta.association, season: store.meta.season, rulesVersion: store.meta.rulesVersion, importedAt: store.meta.importedAt, sourceFiles: [], counts: store.meta.counts },
    matches: store.matches.map((m) => ({ ...Object.fromEntries(['id', 'season', 'week', 'channel', 'event', 'competition', 'date', 'time', 'venue', 'group', 'home', 'away', 'result', 'placementMode', 'homeSource', 'awaySource', 'homeColor', 'awayColor', 'stage', 'stageDetail', 'division', 'status', 'note', 'bonuses', 'officials', 'additionalAssistants', 'interrupted', 'resumption'].map((key) => [key, key === 'officials' ? m.officials.map((o) => Object.fromEntries(['role', 'refereeId', 'name', 'substitute', 'fraction', 'dutyDate', 'dutyTime', ...(financialQueries ? ['allocationPercent', 'actualBonus'] : [])].filter(key => o[key] !== undefined).map(key => [key, o[key]]))) : m[key]])), avoidanceSummary: matchAvoidanceSummary(m, store.matches, store.teams || [], store.groupOrders || []) })),
    teams: (store.teams || []).map((team) => ({ event: team.event, name: team.name, color: team.color })),
    referees,
    adjustments: financialQueries ? store.adjustments.filter((a) => !a.voidedAt && (auth.publicQueries || a.refereeId === auth.refereeId)).map(({ penalty, voidReason, ...a }) => a) : [],
    rules: store.rules, wageStandards: store.wageStandards,
    access: { role, ...(role === 'referee' ? { refereeId: auth.refereeId } : {}) },
  };
}
