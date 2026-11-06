import { Buffer } from 'node:buffer';
const encoder = new TextEncoder();
const b64 = (v) => Buffer.from(v).toString('base64url');
const random = (n = 24) => b64(crypto.getRandomValues(new Uint8Array(n)));
export const newPassword = () => random(12);
export async function passwordHash(password, salt = random(16)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${salt}$${b64(bits)}`;
}
const constantEqual = (a, b) => {
  const left = encoder.encode(String(a)), right = encoder.encode(String(b));
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] || 0) ^ (right[i] || 0);
  return difference === 0;
};
export async function checkPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 200 || !hash?.startsWith('pbkdf2$')) return false;
  return constantEqual(await passwordHash(password, hash.split('$')[1]), hash);
}
const hmacKey = (secret) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function sessionToken(claims, secret, now = Date.now()) {
  const body = b64(JSON.stringify({ ...claims, exp: now + 12 * 60 * 60 * 1000 }));
  return body + '.' + b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body)));
}
export async function verifyToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 2048) return null;
  try {
    const [body, signature, extra] = token.split('.');
    if (extra || !signature || !await crypto.subtle.verify('HMAC', await hmacKey(secret), Buffer.from(signature, 'base64url'), encoder.encode(body))) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.exp > now && ['admin', 'referee'].includes(claims.role) ? claims : null;
  } catch { return null; }
}
export async function requestAuth(request, env) {
  const claims = await verifyToken(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.SESSION_SECRET);
  if (claims?.role === 'admin') return { authenticated: true, role: 'admin', development: false };
  if (claims?.role === 'referee') {
    const account = await env.DB.prepare('SELECT version FROM referee_credentials WHERE referee_id = ?').bind(claims.refereeId).first();
    if (account && account.version === claims.version) return { authenticated: false, role: 'referee', refereeId: claims.refereeId, development: false };
  }
  return { authenticated: false, role: 'public', development: false };
}
async function rateLimit(request, env, user) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Date.now(), reset = now + 15 * 60000;
  for (const [label, max] of [[ip, 120], [`${ip}:${user}`, 8]]) {
    const key = b64(await crypto.subtle.digest('SHA-256', encoder.encode(label)));
    const row = await env.DB.prepare('INSERT INTO login_attempts (key, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END RETURNING attempts').bind(key, reset, now, now, reset).first();
    if (row.attempts > max) throw Object.assign(new Error('尝试次数过多，请 15 分钟后重试'), { status: 429 });
  }
}
export async function authEndpoint(request, env, repository, auth) {
  const pathname = new URL(request.url).pathname;
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (pathname === '/api/session') return json({ authenticated: auth.authenticated, role: auth.role, refereeId: auth.refereeId, development: false });
  if (request.method === 'POST' && ['/api/login', '/api/referee-login'].includes(pathname)) {
    if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD_HASH) return json({ error: '登录服务尚未配置' }, 503);
    const input = await request.json();
    const username = typeof input.username === 'string' ? input.username.trim().slice(0, 80) : '';
    await rateLimit(request, env, pathname === '/api/login' ? 'admin' : username);
    let claims;
    if (pathname === '/api/login') {
      if (await checkPassword(input.password, env.ADMIN_PASSWORD_HASH)) claims = { role: 'admin' };
    } else {
      const store = await repository.load();
      const candidates = store.referees.filter((r) => r.id === username || r.name === username);
      const account = candidates.length === 1 ? await env.DB.prepare('SELECT * FROM referee_credentials WHERE referee_id = ?').bind(candidates[0].id).first() : null;
      if (account && await checkPassword(input.password, account.password_hash)) claims = { role: 'referee', refereeId: account.referee_id, version: account.version };
    }
    if (!claims) return json({ error: '账号或密码不正确；未开通查询的裁判员请联系管理员' }, 401);
    return json({ authenticated: claims.role === 'admin', role: claims.role, refereeId: claims.refereeId, token: await sessionToken(claims, env.SESSION_SECRET) });
  }
  if (pathname === '/api/logout') return json({ authenticated: false });
  if (pathname === '/api/accounts') {
    if (!auth.authenticated) return json({ error: '需要管理员权限' }, 403);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT referee_id AS refereeId, version, updated_at AS updatedAt FROM referee_credentials ORDER BY updated_at DESC').all();
      return json(results);
    }
    if (request.method === 'POST') {
      const input = await request.json();
      const store = await repository.load();
      if (!store.referees.some((r) => r.id === input.refereeId)) return json({ error: '请选择有效裁判员' }, 400);
      const password = newPassword();
      const hash = await passwordHash(password);
      await env.DB.prepare('INSERT INTO referee_credentials (referee_id, password_hash, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(referee_id) DO UPDATE SET password_hash = excluded.password_hash, version = version + 1, updated_at = excluded.updated_at').bind(input.refereeId, hash, new Date().toISOString()).run();
      return json({ refereeId: input.refereeId, password });
    }
  }
  if (pathname === '/api/me/password' && request.method === 'POST') {
    if (auth.role !== 'referee') return json({ error: '请先登录裁判查询账号' }, 401);
    const input = await request.json();
    if (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 100) return json({ error: '新密码须为 10–100 个字符' }, 400);
    const account = await env.DB.prepare('SELECT * FROM referee_credentials WHERE referee_id = ?').bind(auth.refereeId).first();
    if (!await checkPassword(input.oldPassword, account?.password_hash)) return json({ error: '原密码不正确' }, 401);
    const updated = await env.DB.prepare('UPDATE referee_credentials SET password_hash = ?, version = version + 1, updated_at = ? WHERE referee_id = ? AND version = ? RETURNING version').bind(await passwordHash(input.password), new Date().toISOString(), auth.refereeId, account.version).first();
    if (!updated) return json({ error: '账号刚被更新，请重新登录' }, 409);
    return json({ token: await sessionToken({ role: 'referee', refereeId: auth.refereeId, version: updated.version }, env.SESSION_SECRET) });
  }
  return null;
}
