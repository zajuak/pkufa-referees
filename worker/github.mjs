import { handleApi } from '../server/api.mjs';
import { d1Repository } from '../server/d1-repository.mjs';
import seed from '../data/store.json';
import { authEndpoint, requestAuth } from './auth.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((v) => v.trim());
    const crossOrigin = origin && origin !== url.origin;
    const cors = origin && (allowed.includes(origin) || (env.LOCAL_PREVIEW === 'true' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' } : {};
    if (crossOrigin && !cors['Access-Control-Allow-Origin']) return Response.json({ error: '来源不允许' }, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      if (!env.DB) throw new Error('Missing database');
      if (url.pathname === '/health') response = Response.json({ ok: true, authenticationRequiredForPersonalData: true });
      else {
        const repository = d1Repository(env.DB, seed);
        const auth = await requestAuth(request, env);
        auth.publicQueries = env.PUBLIC_QUERIES === 'true';
        response = await authEndpoint(request, env, repository, auth);
        if (!response) {
          // Origin is checked above. Authentication is a bearer token, not a cross-site cookie.
          const forwarded = new Request(request);
          forwarded.headers.delete('Origin');
          response = await handleApi(forwarded, repository, auth);
        }
      }
    } catch (e) {
      console.error('API error', url.pathname, e.message);
      response = Response.json({ error: e.status ? e.message : '请求暂时无法完成，请稍后重试' }, { status: e.status || 500 });
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  },
};
