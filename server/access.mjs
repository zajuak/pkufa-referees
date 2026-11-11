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
    matches: store.matches.map((m) => ({ ...Object.fromEntries(['id', 'season', 'week', 'channel', 'event', 'competition', 'date', 'time', 'venue', 'group', 'home', 'away', 'result', 'placementMode', 'homeSource', 'awaySource', 'homeColor', 'awayColor', 'stage', 'division', 'status', 'note', 'bonuses', 'officials', 'additionalAssistants'].map((key) => [key, key === 'officials' ? m.officials.map((o) => ({ role: o.role, refereeId: o.refereeId, name: o.name, substitute: o.substitute })) : m[key]])), avoidanceSummary: matchAvoidanceSummary(m, store.matches, store.teams || [], store.groupOrders || []) })),
    teams: (store.teams || []).map((team) => ({ event: team.event, name: team.name, color: team.color })),
    referees,
    adjustments: financialQueries ? store.adjustments.filter((a) => auth.publicQueries || a.refereeId === auth.refereeId) : [],
    rules: store.rules, wageStandards: store.wageStandards,
    access: { role, ...(role === 'referee' ? { refereeId: auth.refereeId } : {}) },
  };
}
