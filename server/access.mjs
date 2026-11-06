// Only schedule and published rules are anonymous; personal financial data is filtered server-side.
export function readableStore(store, auth) {
  const role = auth.authenticated ? 'admin' : auth.role === 'referee' ? 'referee' : 'public';
  if (role === 'admin') return { ...store, access: { role } };
  const result = {
    version: store.version, revision: store.revision || 0, updatedAt: store.updatedAt,
    meta: { association: store.meta.association, season: store.meta.season, rulesVersion: store.meta.rulesVersion, importedAt: store.meta.importedAt, sourceFiles: [], counts: store.meta.counts },
    matches: store.matches.map((m) => Object.fromEntries(['id', 'season', 'week', 'channel', 'event', 'competition', 'date', 'time', 'venue', 'group', 'home', 'away', 'homeColor', 'awayColor', 'stage', 'division', 'status', 'note', 'bonuses', 'officials'].map((key) => [key, key === 'officials' ? m.officials.map((o) => ({ role: o.role, refereeId: o.refereeId, name: o.name, substitute: o.substitute })) : m[key]]))), referees: [], adjustments: [], rules: store.rules, wageStandards: store.wageStandards,
    access: { role, ...(role === 'referee' ? { refereeId: auth.refereeId } : {}) },
  };
  if (role === 'referee') {
    result.referees = store.referees.filter((r) => r.id === auth.refereeId);
    result.adjustments = store.adjustments.filter((a) => a.refereeId === auth.refereeId);
  }
  return result;
}
