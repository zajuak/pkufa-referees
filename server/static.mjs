import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStaticHandler } from './static-handler.mjs';

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const root = process.env.STATIC_DIR || fileURLToPath(new URL('../campus-dist', import.meta.url));
  const server = createServer(createStaticHandler({ root, release: process.env.RELEASE || '' }));
  server.listen(Number(process.env.PORT || 8081), process.env.HOST || '0.0.0.0', () => console.log(`PKUFA static site listening on port ${process.env.PORT || 8081}`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
