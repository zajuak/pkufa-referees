import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { validateSnapshot } from './validation.mjs';

export function sqliteDatabase(filename) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec(`CREATE TABLE IF NOT EXISTS snapshots(revision INTEGER PRIMARY KEY NOT NULL,at TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY NOT NULL,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS referee_credentials(referee_id TEXT PRIMARY KEY NOT NULL,password_hash TEXT NOT NULL,version INTEGER DEFAULT 1 NOT NULL,updated_at TEXT NOT NULL);`);
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      const query = {
        bind(...values) { args = values; return query; },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } }; },
      };
      return query;
    },
    close() { sqlite.close(); },
  };
}

export async function initializeCampusData(db, seedFile) {
  if (await db.prepare('SELECT revision FROM snapshots LIMIT 1').first()) return false;
  if (!seedFile) throw new Error('空数据库必须通过 SEED_FILE 指定要复制的数据，不能自动创建空库');
  const seed = validateSnapshot(JSON.parse(await readFile(seedFile, 'utf8')));
  const revision = Number.isInteger(seed.revision) ? seed.revision : 0;
  await db.prepare('INSERT INTO snapshots(revision,at,action,data) VALUES(?,?,?,?)')
    .bind(revision, new Date().toISOString(), '从云端复制初始数据（此后独立运行）', JSON.stringify({ ...seed, revision })).run();
  return true;
}
