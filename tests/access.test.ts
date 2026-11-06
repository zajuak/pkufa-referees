import { describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
// @ts-expect-error Shared server authorization module.
import { readableStore } from '../server/access.mjs';
// @ts-expect-error Shared Workers authentication module.
import { passwordHash, checkPassword, sessionToken, verifyToken, requestAuth, authEndpoint } from '../worker/auth.mjs';
import type { DataStore } from '../src/domain/types';

const person = (id: string) => ({ id, name: `测试裁判${id}`, channels: { eleven: { basePoints: 80, baseLevel: 'B' as const, previousWage: id === 'r1' ? 1234 : 9876, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } } } });
const store: DataStore = { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-06T00:00:00Z', sourceFiles: ['private.xlsx'], counts: { elevenMatches: 0, fiveMatches: 0, cancelledMatches: 0 } }, referees: [person('r1'), person('r2')], matches: [], adjustments: [{ id: 'a', refereeId: 'r2', channel: 'eleven', season: '2026–27', date: '2026-11-06', type: 'reward', points: 1, wage: 111, reason: '私密奖惩' }], unavailability: [{ id: 'l', refereeId: 'r2', start: '2026-12-01', end: '2026-12-01', reason: '私密请假' }] };

describe('公开赛程与裁判个人查询权限', () => {
  it('匿名结果不含积分工资、来源文件、奖惩或请假', () => {
    const result = readableStore(store, { authenticated: false });
    expect(result.access.role).toBe('public');
    expect(result.referees).toEqual([]);
    const text = JSON.stringify(result);
    for (const value of ['1234', '9876', '私密', 'private.xlsx']) expect(text).not.toContain(value);
  });
  it('裁判只能拿到自己的档案，不能通过客户端篡改编号查看他人', () => {
    const result = readableStore(store, { authenticated: false, role: 'referee', refereeId: 'r1' });
    expect(result.referees.map((r: { id: string }) => r.id)).toEqual(['r1']);
    expect(result.adjustments).toEqual([]);
    expect(result.unavailability).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('9876');
    expect(readableStore(store, { authenticated: true }).referees).toHaveLength(2);
  });
  it('密码哈希、签名防篡改与过期检查', async () => {
    const hash = await passwordHash('correct-password');
    expect(hash).not.toContain('correct-password');
    expect(await checkPassword('correct-password', hash)).toBe(true);
    expect(await checkPassword('wrong', hash)).toBe(false);
    const token = await sessionToken({ role: 'referee', refereeId: 'r1', version: 1 }, 'test-signing-secret', 1000);
    expect((await verifyToken(token, 'test-signing-secret', 2000)).refereeId).toBe('r1');
    expect(await verifyToken(token + 'x', 'test-signing-secret', 2000)).toBeNull();
    expect(await verifyToken(token, 'another-secret', 2000)).toBeNull();
    expect(await verifyToken(token, 'test-signing-secret', 1000 + 13 * 3600000)).toBeNull();
  });
  it('只有管理员能开通查询，密码重置撤销旧会话，连续失败限制尝试次数', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE referee_credentials(referee_id TEXT PRIMARY KEY,password_hash TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE login_attempts(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL)');
    const db = { prepare(sql: string) { const s = sqlite.prepare(sql); let args: SQLInputValue[] = []; const q = { bind(...v: SQLInputValue[]) { args = v; return q; }, async first() { return s.get(...args); }, async all() { return { results: s.all(...args) }; }, async run() { return s.run(...args); } }; return q; } };
    const env = { DB: db, SESSION_SECRET: 'test-only-secret', ADMIN_PASSWORD_HASH: await passwordHash('test-admin-password') };
    const repo = { async load() { return store; } };
    const request = (url: string, body?: unknown) => new Request('https://api.test' + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
      expect((await authEndpoint(request('/api/accounts'), env, repo, { authenticated: false })).status).toBe(403);
      const account = await (await authEndpoint(request('/api/accounts', { refereeId: 'r1' }), env, repo, { authenticated: true })).json();
      expect(account.password.length).toBeGreaterThan(12);
      const login = await (await authEndpoint(request('/api/referee-login', { username: 'r1', password: account.password }), env, repo, {})).json();
      const signedRequest = new Request('https://api.test/api/data', { headers: { Authorization: `Bearer ${login.token}` } });
      expect((await requestAuth(signedRequest, env)).refereeId).toBe('r1');
      await authEndpoint(request('/api/accounts', { refereeId: 'r1' }), env, repo, { authenticated: true });
      expect((await requestAuth(signedRequest, env)).role).toBe('public');
      for (let i = 0; i < 8; i++) await authEndpoint(request('/api/referee-login', { username: 'r2', password: 'wrong' }), env, repo, {});
      await expect(authEndpoint(request('/api/referee-login', { username: 'r2', password: 'wrong' }), env, repo, {})).rejects.toMatchObject({ status: 429 });
    } finally { sqlite.close(); }
  });
});
