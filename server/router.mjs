import { Buffer } from 'node:buffer';

// Small Fetch adapter keeps the same validated API on Node and Workers.
export class Router {
  constructor(request) { this.request = request; this.routes = []; }
  get(path, ...handlers) { this.add('GET', path, handlers); }
  post(path, ...handlers) { this.add('POST', path, handlers); }
  put(path, ...handlers) { this.add('PUT', path, handlers); }
  delete(path, ...handlers) { this.add('DELETE', path, handlers); }
  add(method, path, handlers) { this.routes.push({ method, parts: path.split('/'), handlers }); }
  async dispatch() {
    let status = 200;
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    let output;
    const res = {
      status(value) { status = value; return res; },
      setHeader(key, value) { headers.set(key, value); return res; },
      json(value) { headers.set('Content-Type', 'application/json; charset=utf-8'); output = JSON.stringify(value); return res; },
      end() { output = null; return res; },
    };
    try {
      const url = new URL(this.request.url);
      const parts = url.pathname.split('/');
      const route = this.routes.find((r) => r.method === this.request.method && r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith(':') || p === parts[i]));
      if (!route) return Response.json({ error: '接口不存在' }, { status: 404 });
      const params = Object.fromEntries(route.parts.flatMap((p, i) => p.startsWith(':') ? [[p.slice(1), decodeURIComponent(parts[i])]] : []));
      let body = {};
      if (!['GET', 'HEAD'].includes(this.request.method)) {
        const origin = this.request.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host && !(['localhost', '127.0.0.1'].includes(url.hostname) && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname))) throw Object.assign(new Error('不允许跨站修改数据'), { status: 403 });
        const bytes = Buffer.from(await this.request.arrayBuffer());
        if (bytes.length > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB');
        body = url.pathname === '/api/import-assignments' ? bytes : bytes.length ? JSON.parse(bytes.toString()) : {};
      }
      const req = { body, params, headers: Object.fromEntries(this.request.headers), query: Object.fromEntries(url.searchParams) };
      const run = async (index) => {
        const handler = route.handlers[index];
        if (handler) await handler(req, res, (error) => { if (error) throw error; return run(index + 1); });
      };
      await run(0);
      if (output === undefined) throw new Error('请求未完成');
    } catch (error) {
      status = error.status || 400;
      headers.set('Content-Type', 'application/json; charset=utf-8');
      output = JSON.stringify({ error: error.message || '操作失败' });
    }
    return new Response(output, { status, headers });
  }
}
