import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { handleApi } from './api.mjs';
import { localRepository } from './local-repository.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = localRepository(process.env.DATA_DIR || path.join(root, 'data'));
const sessions = new Map();
const password = process.env.ADMIN_PASSWORD || 'pkufa-admin';
const app = express();
app.use('/api', express.raw({ type: () => true, limit: '5mb' }));
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  try {
    const token = req.headers.cookie?.match(/(?:^|;\s*)pkufa_session=([^;]+)/)?.[1];
    const request = new Request(`http://${req.headers.host}${req.originalUrl}`, {
      method: req.method, headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) && req.body?.length ? { body: req.body } : {}),
    });
    const response = await handleApi(request, repository, {
      authenticated: Boolean(token && (sessions.get(token) || 0) > Date.now()), development: true,
      publicQueries: process.env.PUBLIC_QUERIES !== 'false',
      login(input) {
        if (typeof input !== 'string') return null;
        const left = Buffer.from(input), right = Buffer.from(password);
        if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
        const id = randomUUID();
        sessions.set(id, Date.now() + 43200000);
        return `pkufa_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;
      },
      logout() { sessions.delete(token); },
    });
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) { next(e); }
});
if (existsSync(path.join(root, 'dist/client'))) app.use(express.static(path.join(root, 'dist/client')));
else app.use(express.static(path.join(root, 'dist')));
app.use((req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: '接口不存在' }) : res.sendFile(path.join(root, existsSync(path.join(root, 'dist/client')) ? 'dist/client/index.html' : 'dist/index.html')));
app.listen(Number(process.env.PORT || 3001), () => console.log(`PKUFA server listening on http://localhost:${process.env.PORT || 3001}`));
