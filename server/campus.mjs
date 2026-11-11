import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { sqliteDatabase, initializeCampusData } from './sqlite.mjs';
import { createCampusHandler } from './campus-handler.mjs';
import { createStaticHandler } from './static-handler.mjs';

export async function startCampusServer(env = process.env) {
  const dataDirectory = path.resolve(env.DATA_DIR || '/var/lib/pkufa-referees');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const db = sqliteDatabase(path.join(dataDirectory, 'referees.sqlite'));
  try { await initializeCampusData(db, env.SEED_FILE); }
  catch (error) { db.close(); throw error; }
  let api;
  try { api = createCampusHandler({ ...env, DB: db }); }
  catch (error) { db.close(); throw error; }
  const serveStatic = createStaticHandler({ root: env.STATIC_DIR || fileURLToPath(new URL('../campus-dist', import.meta.url)), dataMode: 'independent', release: env.RELEASE || '' });
  const server = createServer(async (req, res) => {
    if (!req.url.startsWith('/api/')) return serveStatic(req, res);
    try {
      if (Number(req.headers['content-length']) > 5 * 1024 * 1024) throw Object.assign(new Error('文件不能超过 5 MB'), { status: 413 });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      headers.set('CF-Connecting-IP', req.socket.remoteAddress || 'local');
      let size = 0; const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) throw Object.assign(new Error('文件不能超过 5 MB'), { status: 413 });
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const response = await api(new Request(url, { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) && body.length ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      req.resume();
      res.writeHead(error.status || 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.status ? error.message : '请求格式不正确' }));
    }
  });
  server.on('close', () => db.close());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.PORT || 8081), env.HOST || '0.0.0.0', resolve); });
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const server = await startCampusServer();
  console.log(`Independent PKUFA site listening on port ${server.address().port}`);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
