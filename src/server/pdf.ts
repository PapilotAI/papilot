import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './paths.ts';
import { reviewClient, taskRoute } from './review.ts';

const pending = new Map<string, Promise<string>>();

export async function fullPaperPdf(root: string, name: string, round: number, side: 'before' | 'after'): Promise<string> {
  const key = JSON.stringify([root, name, round, side]);
  const existing = pending.get(key);
  if (existing) return existing;
  const build = (async () => {
    const client = await reviewClient(root);
    const detail = await client.get<{ before: string; after: string }>(`${taskRoute(name)}/rounds/${round}`);
    const [{ Builder }, { Repo }, { loadProject }] = await Promise.all([
      import(pathToFileURL(path.join(ENGINE, 'src/core/build.ts')).href),
      import(pathToFileURL(path.join(ENGINE, 'src/core/git.ts')).href),
      import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href),
    ]);
    // A diff can use a partial build; explicitly compile the entire immutable
    // round revision here. The engine reuses its normal full-build cache.
    const result = await new Builder(loadProject(root), new Repo(root)).build(detail[side], ['full']);
    return result.pdf as string;
  })();
  pending.set(key, build);
  try { return await build; } finally { if (pending.get(key) === build) pending.delete(key); }
}
