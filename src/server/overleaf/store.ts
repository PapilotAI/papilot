import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { blobHash } from './files.ts';
import type { Cookies } from './http.ts';
import type { OverleafConflict } from '../../shared.ts';

// What Papilot keeps about Overleaf in its own data folder, never in the
// paper: the signed-in sessions (readable only by this user), each linked
// paper's project, and the base of the sync, the files as both sides last
// agreed on them, which three-way merges start from after time offline.

const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
};
const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; } };

/** `shared`: the session belongs to a browser on this computer, which
 *  stays signed in when Papilot signs out. */
export interface Account { origin: string; cookies: Cookies; userId: string; email: string; savedAt: number; shared?: boolean }
// choice: whose version stays where both sides differ, until a first sync completes.
export interface Link { id: string; projectId: string | null; origin: string; overleafId: string; name: string; createdAt: number; choice?: 'overleaf' | 'local' }
export interface BaseEntry { kind: 'doc' | 'file'; hash: string }
export type Base = Record<string, BaseEntry>;
/** Who wrote what in each file, by Overleaf doc id: spans of the text with
 *  this hash, as [from, to, account, when], and the accounts' names. */
export interface StoredAuthors { people: Record<string, string>; docs: Record<string, { hash: string; spans: [number, number, string, number][] }> }
export interface StoredConflict extends OverleafConflict { ours: string; theirs: string; before: string; after: string; backup?: string }

export class OverleafStore {
  constructor(readonly root: string) {}
  private get accountsFile() { return path.join(this.root, 'accounts.json'); }
  accounts() { return readJson<Record<string, Account>>(this.accountsFile) || {}; }
  account(origin: string) { return this.accounts()[origin]; }
  saveAccount(account: Account) { writeJson(this.accountsFile, { ...this.accounts(), [account.origin]: account }); }
  removeAccount(origin: string) { const accounts = this.accounts(); delete accounts[origin]; writeJson(this.accountsFile, accounts); }
  /** Keeps the cookies Overleaf renewed, unless the author signed out or
   *  in as someone else meanwhile. */
  updateCookies(account: Account) {
    const current = this.account(account.origin);
    if (current?.userId === account.userId) this.saveAccount({ ...current, cookies: { ...account.cookies } });
  }

  private dir(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid link.'); return path.join(this.root, 'links', id); }
  links(): Link[] {
    let ids: string[] = [];
    try { ids = fs.readdirSync(path.join(this.root, 'links')); } catch { return []; }
    return ids.filter(id => /^[a-f0-9-]{36}$/.test(id)).map(id => readJson<Link>(path.join(this.dir(id), 'link.json'))).filter((link): link is Link => Boolean(link));
  }
  link(id: string) { return readJson<Link>(path.join(this.dir(id), 'link.json')); }
  createLink(value: Omit<Link, 'id' | 'createdAt'>): Link {
    const link = { ...value, id: randomUUID(), createdAt: Date.now() };
    writeJson(path.join(this.dir(link.id), 'link.json'), link);
    return link;
  }
  saveLink(link: Link) { writeJson(path.join(this.dir(link.id), 'link.json'), link); }
  removeLink(id: string) { fs.rmSync(this.dir(id), { recursive: true, force: true }); }

  // Base texts are stored by hash, so unchanged files cost nothing to save again.
  base(id: string): Base { return readJson<Base>(path.join(this.dir(id), 'base.json')) || {}; }
  baseText(id: string, hash: string) { try { return fs.readFileSync(path.join(this.dir(id), 'objects', hash), 'utf8'); } catch { return undefined; } }
  saveBase(id: string, base: Base, texts: Map<string, string>, authors?: { value: StoredAuthors; texts: Map<string, string> }) {
    const objects = path.join(this.dir(id), 'objects');
    fs.mkdirSync(objects, { recursive: true, mode: 0o700 });
    const wanted = new Set<string>();
    const keep = (hash: string, text: string | undefined) => {
      wanted.add(hash);
      const target = path.join(objects, hash);
      if (text !== undefined && !fs.existsSync(target)) { fs.writeFileSync(target + '.tmp', text, { mode: 0o600 }); fs.renameSync(target + '.tmp', target); }
    };
    for (const [file, entry] of Object.entries(base)) if (entry.kind === 'doc') keep(entry.hash, texts.get(file));
    if (authors) {
      for (const [hash, text] of authors.texts) keep(hash, text);
      writeJson(path.join(this.dir(id), 'authors.json'), authors.value);
    } else for (const entry of Object.values(this.authors(id)?.docs ?? {})) wanted.add(entry.hash);
    writeJson(path.join(this.dir(id), 'base.json'), base);
    for (const name of fs.readdirSync(objects)) if (!wanted.has(name)) fs.rmSync(path.join(objects, name), { force: true });
  }
  textHash = blobHash;
  authors(id: string) { return readJson<StoredAuthors>(path.join(this.dir(id), 'authors.json')); }

  conflicts(id: string) { return readJson<StoredConflict[]>(path.join(this.dir(id), 'conflicts.json')) || []; }
  saveConflicts(id: string, conflicts: StoredConflict[]) { writeJson(path.join(this.dir(id), 'conflicts.json'), conflicts); }
  /** A copy of a local file Overleaf's version replaced, kept with the link. */
  backup(id: string, data: Buffer) {
    const name = randomUUID(), folder = path.join(this.dir(id), 'backups');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(folder, name), data, { mode: 0o600 });
    return name;
  }
  readBackup(id: string, name: string) { if (!/^[a-f0-9-]{36}$/.test(name)) return null; try { return fs.readFileSync(path.join(this.dir(id), 'backups', name)); } catch { return null; } }
  removeBackup(id: string, name: string) { if (/^[a-f0-9-]{36}$/.test(name)) fs.rmSync(path.join(this.dir(id), 'backups', name), { force: true }); }
}
