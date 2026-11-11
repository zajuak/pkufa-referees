import { handleApi } from './api.mjs';
import { d1Repository } from './d1-repository.mjs';
import { authEndpoint, requestAuth } from '../worker/auth.mjs';

export function createCampusHandler(env) {
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) throw new Error('必须配置独立的管理员密码哈希与会话密钥');
  const repository = d1Repository(env.DB, null);
  return async (request) => {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允许跨站访问本地接口' }, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    try {
      const auth = await requestAuth(request, env);
      auth.publicQueries = env.PUBLIC_QUERIES === 'true';
      const response = await authEndpoint(request, env, repository, auth) || await handleApi(request, repository, auth);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error('Campus API error:', error.message);
      return Response.json({ error: error.status ? error.message : '请求暂时无法完成，请稍后重试' }, { status: error.status || 500 });
    }
  };
}
