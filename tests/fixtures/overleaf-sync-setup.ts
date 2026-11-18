import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOverleaf } from './overleaf-server.ts';
import { OverleafStore } from '../../src/server/overleaf/store.ts';
import { PaperSync } from '../../src/server/overleaf/engine.ts';

// A paper folder linked to a fake Overleaf, for the sync tests.
export async function until(check: () => boolean, what: string, timeout = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
export async function setup(prepare?: (server: FakeOverleaf) => void, options: { busy?: () => boolean; ignored?: string[] } = {}) {
  const server = await new FakeOverleaf().start();
  prepare?.(server);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-overleaf-')), root = path.join(dir, 'paper'), data = path.join(dir, 'data');
  fs.mkdirSync(root);
  const store = new OverleafStore(data);
  store.saveAccount({ origin: server.origin, cookies: { overleaf_session2: server.session }, userId: server.userId, email: 'author@example.com', savedAt: Date.now() });
  const link = store.createLink({ projectId: 'paper', origin: server.origin, overleafId: server.projectId, name: 'Fake paper' });
  let changed = 0;
  const sync = (instance = new PaperSync(link, root, store, { changed: () => { changed++; }, busy: options.busy ?? (() => false), ignored: async files => new Set(files.filter(file => options.ignored?.includes(file))), status: () => {} })) => instance;
  const read = (file: string) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return undefined; } };
  const write = (file: string, text: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  return { server, root, store, link, sync, read, write, changes: () => changed,
    close: async (...syncs: PaperSync[]) => { for (const item of syncs) await item.stop(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
/** A coauthor's insert right after some text. */
export const insert = (find: string, text: string) => (doc: string) => [{ p: doc.indexOf(find) + find.length, i: text }];
