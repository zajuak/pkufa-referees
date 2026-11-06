export function d1Repository(db, seed) {
  const initialize = async () => {
    await db.prepare('INSERT OR IGNORE INTO snapshots (revision, at, action, data) VALUES (0, ?, ?, ?)').bind(seed.meta.importedAt, '初始数据', JSON.stringify({ ...seed, revision: 0 })).run();
  };
  return {
    async load() {
      let row = await db.prepare('SELECT data FROM snapshots ORDER BY revision DESC LIMIT 1').first();
      if (!row) { await initialize(); row = await db.prepare('SELECT data FROM snapshots ORDER BY revision DESC LIMIT 1').first(); }
      return JSON.parse(row.data);
    },
    async save(data, base, action) {
      const result = await db.prepare('INSERT INTO snapshots (revision, at, action, data) SELECT ?, ?, ?, ? WHERE (SELECT MAX(revision) FROM snapshots) = ?').bind(base + 1, data.updatedAt, action, JSON.stringify(data), base).run();
      if (!result.meta.changes) throw Object.assign(new Error('其他管理员已更新数据，请刷新后重新编辑'), { status: 409 });
    },
    async history() {
      const { results } = await db.prepare("SELECT revision, at, action, json_array_length(data, '$.matches') AS matches, json_array_length(data, '$.referees') AS referees FROM snapshots ORDER BY revision DESC LIMIT 50").all();
      return results;
    },
    async snapshot(id) {
      const row = await db.prepare('SELECT data FROM snapshots WHERE revision = ?').bind(id).first();
      return row ? JSON.parse(row.data) : null;
    },
  };
}
