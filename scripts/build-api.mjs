import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { access, mkdir } from 'node:fs/promises';
let hasSeed = true;
try { await access('data/store.json'); } catch { hasSeed = false; }
await mkdir('api-dist', { recursive: true });
await build({ entryPoints: ['worker/github.mjs'], outfile: 'api-dist/worker.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto', 'node:buffer'], minify: true,
  ...(!hasSeed ? { plugins: [{ name: 'empty-seed', setup(build) { build.onResolve({ filter: /data\/store\.json$/ }, () => ({ path: fileURLToPath(new URL('../data/example-store.json', import.meta.url)) })); } }] } : {}) });
console.log('Built Worker API; business records are never part of the frontend.');
