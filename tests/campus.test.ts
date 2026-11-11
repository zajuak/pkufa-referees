import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import type { DataStore, Match } from '../src/domain/types';
// @ts-expect-error Standalone Node server shared with the deployed bundle.
import { startCampusServer } from '../server/campus.mjs';
// @ts-expect-error Shared authentication implementation.
import { passwordHash, sessionToken } from '../worker/auth.mjs';

describe('服务器独立运行与持久化', () => {
  it('通过 current 符号链接启动时确实监听服务', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pkufa-cli-'));
    const entry = path.join(directory, 'current.mjs'), seedFile = path.join(directory, 'seed.json');
    await symlink(fileURLToPath(new URL('../server/campus.mjs', import.meta.url)), entry);
    await writeFile(seedFile, JSON.stringify({ version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-11T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, matches: [], referees: [], adjustments: [] }));
    const child = spawn(process.execPath, [entry], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: path.join(directory, 'data'), SEED_FILE: seedFile, ADMIN_PASSWORD_HASH: await passwordHash('test'), SESSION_SECRET: 'cli-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      const port = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('服务未启动')), 4000);
        child.stdout.on('data', (data: Buffer) => { const match = data.toString().match(/listening on port (\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`服务提前退出 ${code}`)); });
      });
      expect((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).dataMode).toBe('independent');
    } finally { child.kill('SIGTERM'); await exited; await rm(directory, { recursive: true, force: true }); }
  });
  it('复制一次后只修改本地数据，重启保留修改，旧云端会话和跨站写入被拒绝', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pkufa-campus-'));
    const seedFile = path.join(directory, 'seed.json'), publicDirectory = path.join(directory, 'public');
    const match: Match = { id: 'copied-match', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-11-14', time: '12:00-14:00', venue: '测试场', group: 'A', home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [] };
    const data: DataStore = { version: 1, revision: 7, updatedAt: '2026-11-11T00:00:00Z', meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: ['private-source.xlsx'], counts: { elevenMatches: 1, fiveMatches: 0, cancelledMatches: 0 } }, referees: [], matches: [match], adjustments: [], teams: [{ event: 'freshmen-cup', name: '测试甲', color: '#123456' }] };
    const copied = JSON.stringify({ format: 'pkufa-referees-v1', data });
    await mkdir(publicDirectory); await writeFile(path.join(publicDirectory, 'index.html'), '<html>campus</html>'); await writeFile(seedFile, copied);
    const env = { PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(directory, 'data'), SEED_FILE: seedFile, STATIC_DIR: publicDirectory, PUBLIC_QUERIES: 'true', ADMIN_PASSWORD_HASH: await passwordHash('test-password'), SESSION_SECRET: 'independent-test-secret' };
    let server = await startCampusServer(env);
    const base = () => `http://127.0.0.1:${server.address().port}`;
    let token = '';
    const request = (url: string, method = 'GET', body?: unknown, revision = 7) => fetch(base()+url, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(revision), ...(token ? { Authorization: 'Bearer '+token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const close = () => new Promise<void>((resolve, reject) => server.close((error: Error) => error ? reject(error) : resolve()));
    try {
      expect((await (await request('/health')).json()).dataMode).toBe('independent');
      const before = await (await request('/api/data')).json(); expect(before.revision).toBe(7); expect(before.teams).toEqual(data.teams);
      token = await sessionToken({ role: 'admin' }, 'different-cloud-secret');
      expect((await (await request('/api/session')).json()).authenticated).toBe(false);
      expect((await request('/api/matches', 'POST', match)).status).toBe(401);
      token = (await (await request('/api/login', 'POST', { password: 'test-password' })).json()).token; expect(token).toBeTruthy();
      const changed = { ...match, id: 'local-only', officials: [{ role: 'referee', refereeId: null, name: '本地新裁判' }] };
      const forbidden = await fetch(base()+'/api/matches', { method: 'POST', headers: { Origin: 'https://external.test', Authorization: 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify(changed) });
      expect(forbidden.status).toBe(403);
      expect((await request('/api/matches', 'POST', changed)).status).toBe(201);
      expect((await request('/api/matches', 'POST', { ...match, id: 'stale' })).status).toBe(409);
      expect(await readFile(seedFile, 'utf8')).toBe(copied);
      expect((await (await request('/api/backups')).json()).map((entry: { revision: number }) => entry.revision)).toEqual([8, 7]);
      expect((await fetch(base()+'/api/login', { method: 'POST', body: 'x'.repeat(5*1024*1024+1) })).status).toBe(413);
      expect((await request('/seed.json')).status).toBe(404); expect((await request('/%2e%2e%2fseed.json')).status).toBe(404);
      await close();
      await writeFile(seedFile, 'invalid seed must not be re-imported');
      server = await startCampusServer(env);
      const after = await (await request('/api/data')).json(); expect(after.revision).toBe(8); expect(after.matches).toHaveLength(2); expect(after.referees[0].name).toBe('本地新裁判');
      expect((await (await request('/api/session')).json()).authenticated).toBe(true);
      expect((await (await request('/api/backups/7')).json()).data).toEqual(data);
    } finally { if (server.listening) await close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('未提供初始副本时不以空数据上线', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pkufa-empty-'));
    try { await expect(startCampusServer({ PORT: '0', DATA_DIR: directory })).rejects.toThrow('空数据库'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
