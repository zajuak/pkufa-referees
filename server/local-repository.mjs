import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function localRepository(directory) {
  const file = path.join(directory, 'history.json');
  let queue = Promise.resolve();
  const records = async () => {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const initial = JSON.parse(await readFile(path.join(directory, 'store.json'), 'utf8'));
      initial.revision = 0;
      return [{ revision: 0, at: new Date().toISOString(), action: '初始数据', data: initial }];
    }
  };
  return {
    async load() { return (await records()).at(-1).data; },
    async save(data, base, action) {
      const run = queue.catch(() => {}).then(async () => {
        const all = await records();
        if (all.at(-1).revision !== base) throw Object.assign(new Error('数据已更新，请刷新后重新编辑'), { status: 409 });
        all.push({ revision: data.revision, at: data.updatedAt, action, data });
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(all));
        await rename(`${file}.tmp`, file);
      });
      queue = run;
      return run;
    },
    async history() { return (await records()).slice().reverse().slice(0, 50).map(({ data, ...r }) => ({ ...r, matches: data.matches.length, referees: data.referees.length })); },
    async snapshot(id) { return (await records()).find((r) => r.revision === id)?.data; },
  };
}
