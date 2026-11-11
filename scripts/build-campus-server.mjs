import { build } from 'esbuild';
await build({ entryPoints: ['server/campus.mjs'], outfile: 'campus-server/campus.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['node:*'], minify: true });
console.log('Built standalone campus backend; no business data or secrets are bundled.');
