import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { itemFacts, type ZoteroItem } from './zotero.ts';

// The author's Zotero account, for a computer Zotero is not installed on:
// the items of the libraries an API key can read and the PDFs Zotero stores
// online, through Zotero's web API. The key stays in Papilot's data folder,
// readable only by this user, and is sent only to api.zotero.org. Each sync
// asks only for what changed since the last one; PDFs are downloaded when an
// entry needs one.

export const API = 'https://api.zotero.org';
export const API_HOST = 'api.zotero.org';
export interface Account { key: string; userID: number; username: string; savedAt: number }
type Facts = ReturnType<typeof itemFacts>;
interface StoredFile { parent: string; name: string; md5: string }
/** A library as last synced: the user's own (no name) or a group. */
export interface WebLibrary { prefix: string; name: string | null; version: number; items: Record<string, Facts>; files: Record<string, StoredFile> }
export interface WebCache { userID: number; libraries: WebLibrary[]; synced: number }
/** A JSON answer from the web API with its headers, null when Zotero refuses
 * or has nothing at this address, or 'unavailable' when it cannot be reached. */
export type Get = (url: string, key: string) => Promise<{ body: unknown; headers: Headers } | null | 'unavailable'>;
export type SyncProblem = 'revoked' | 'unreachable';

interface KeyInfo { userID?: number; username?: string; displayName?: string; access?: { user?: { library?: boolean }; groups?: Record<string, { library?: boolean }> } }
interface ApiItem { data?: Record<string, unknown> & { key?: string; itemType?: string; deleted?: unknown } }
const PAGE = 100;

const writeJson = (file: string, value: unknown) => {
  const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
};
const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } };
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;

/** The account and its last sync, kept beside the library. */
export class AccountStore {
  constructor(private dir: string) {}
  private get accountFile() { return path.join(this.dir, 'zotero-account.json'); }
  private get cacheFile() { return path.join(this.dir, 'zotero-account-items.json'); }
  account() { return readJson<Account>(this.accountFile); }
  cache() { return readJson<WebCache>(this.cacheFile); }
  save(account: Account) { fs.rmSync(this.cacheFile, { force: true }); writeJson(this.accountFile, account); }
  saveCache(cache: WebCache) { writeJson(this.cacheFile, cache); }
  remove() { fs.rmSync(this.accountFile, { force: true }); fs.rmSync(this.cacheFile, { force: true }); }
}

/** The account an API key belongs to, or why it cannot be used. */
export async function checkKey(key: string, get: Get): Promise<Account> {
  const info = await get(`${API}/keys/current`, key);
  if (info === 'unavailable') throw Object.assign(new Error('Could not reach zotero.org. Try again.'), { statusCode: 502 });
  const body = info?.body as KeyInfo | undefined;
  if (!body?.userID) throw Object.assign(new Error('Zotero does not accept this key. Check it and try again.'), { statusCode: 400 });
  const groups = Object.values(body.access?.groups ?? {}).some(group => group.library);
  if (!body.access?.user?.library && !groups) throw Object.assign(new Error('This key cannot read any library. Create one with library access.'), { statusCode: 400 });
  return { key, userID: body.userID, username: body.username || body.displayName || String(body.userID), savedAt: Date.now() };
}

// Fields a type names differently stand for the title and the number, as
// Zotero's base fields do.
function facts(data: Record<string, unknown>): Facts {
  return itemFacts({
    title: text(data.title) ?? text(data.caseName) ?? text(data.nameOfAct) ?? text(data.subject),
    DOI: text(data.DOI), date: text(data.date), url: text(data.url), extra: text(data.extra),
    citationKey: text(data.citationKey), archiveID: text(data.archiveID), number: text(data.number) ?? text(data.reportNumber),
  });
}

/** Take one item from the web API into a library: a regular item's facts,
 * an attachment's stored PDF, or the removal of a trashed one. */
function apply(library: WebLibrary, item: ApiItem) {
  const data = item.data, key = text(data?.key);
  if (!data || !key) return;
  delete library.items[key];
  delete library.files[key];
  if (data.deleted) return;
  if (data.itemType === 'attachment') {
    // Only stored files can be downloaded; linked files live on the
    // author's computer, and md5 is set once Zotero has the file.
    if (text(data.parentItem) && data.contentType === 'application/pdf' && (data.linkMode === 'imported_file' || data.linkMode === 'imported_url') && text(data.md5)) {
      library.files[key] = { parent: data.parentItem as string, name: text(data.filename) ?? text(data.title) ?? key, md5: data.md5 as string };
    }
    return;
  }
  if (data.itemType === 'note' || data.itemType === 'annotation') return;
  library.items[key] = facts(data);
}

/** Bring a library up to date: the items changed since its last version,
 * then those deleted since. A sync that could not finish keeps what it
 * received and its old version, so the next one asks again from there; a
 * first sync starts over, since deletions are only asked for after one. */
async function syncLibrary(target: { prefix: string; name: string | null }, old: WebLibrary | undefined, key: string, get: Get) {
  const since = old?.version ?? 0;
  const library: WebLibrary = { prefix: target.prefix, name: target.name, version: since, items: since ? { ...old?.items } : {}, files: since ? { ...old?.files } : {} };
  let version: number | null = null, complete = true, start = 0, failed: 'refused' | 'unavailable' | null = null;
  for (;;) {
    const page = await get(`${API}/${target.prefix}/items?since=${since}&includeTrashed=1&limit=${PAGE}&start=${start}`, key);
    if (!page || page === 'unavailable') { complete = false; failed = page ? 'unavailable' : 'refused'; break; }
    const at = Number(page.headers.get('last-modified-version'));
    // A library that changed while it was being read is read again next time.
    if (version === null) version = at; else if (at !== version) complete = false;
    const items = Array.isArray(page.body) ? page.body as ApiItem[] : [];
    for (const item of items) apply(library, item);
    start += items.length;
    const total = Number(page.headers.get('total-results'));
    if (!items.length || (Number.isFinite(total) && start >= total)) break;
  }
  if (complete && since) {
    const deleted = await get(`${API}/${target.prefix}/deleted?since=${since}`, key);
    if (!deleted || deleted === 'unavailable') { complete = false; failed = deleted ? 'unavailable' : 'refused'; }
    else for (const removed of (deleted.body as { items?: string[] }).items ?? []) { delete library.items[removed]; delete library.files[removed]; }
  }
  if (complete && version !== null && Number.isFinite(version)) library.version = version;
  return { library, failed };
}

/** Sync every library the key can read: the user's own and their groups. */
export async function syncAccount(account: Account, previous: WebCache | null, get: Get, now = Date.now()): Promise<{ cache: WebCache | null; problem: SyncProblem | null }> {
  const old = previous?.userID === account.userID ? previous : null;
  const keep = (problem: SyncProblem) => ({ cache: old, problem });
  const info = await get(`${API}/keys/current`, account.key);
  if (info === 'unavailable') return keep('unreachable');
  const access = (info?.body as KeyInfo | undefined)?.access;
  if (!info || !access) return keep('revoked');
  const targets: { prefix: string; name: string | null }[] = access.user?.library ? [{ prefix: `users/${account.userID}`, name: null }] : [];
  if (Object.values(access.groups ?? {}).some(group => group.library)) {
    for (let start = 0; ;) {
      const page = await get(`${API}/users/${account.userID}/groups?limit=${PAGE}&start=${start}`, account.key);
      if (page === 'unavailable') return keep('unreachable');
      const groups = Array.isArray(page?.body) ? page.body as { id?: number; data?: { name?: string } }[] : [];
      for (const group of groups) {
        if (group.id && (access.groups?.all?.library || access.groups?.[String(group.id)]?.library)) targets.push({ prefix: `groups/${group.id}`, name: group.data?.name || String(group.id) });
      }
      start += groups.length;
      const total = Number(page?.headers.get('total-results'));
      if (!groups.length || !Number.isFinite(total) || start >= total) break;
    }
  }
  const libraries: WebLibrary[] = [];
  let problem: SyncProblem | null = null;
  for (const target of targets) {
    const { library, failed } = await syncLibrary(target, old?.libraries.find(item => item.prefix === target.prefix), account.key, get);
    libraries.push(library);
    if (failed === 'unavailable') problem = 'unreachable';
  }
  return { cache: { userID: account.userID, libraries, synced: now }, problem };
}

/** The synced items that have a stored PDF, as Zotero items. */
export function webItems(cache: WebCache | null): ZoteroItem[] {
  const items: ZoteroItem[] = [];
  for (const library of cache?.libraries ?? []) {
    const files = new Map<string, { key: string; name: string; md5: string }[]>();
    for (const [key, file] of Object.entries(library.files)) files.set(file.parent, [...files.get(file.parent) ?? [], { key, name: file.name, md5: file.md5 }]);
    for (const [key, item] of Object.entries(library.items)) {
      const stored = files.get(key);
      if (stored) items.push({ key: `${library.prefix}/${key}`, ...item, pdfs: [], remote: stored.map(file => ({ url: `${API}/${library.prefix}/items/${file.key}/file`, name: file.name, md5: file.md5 })) });
    }
  }
  return items;
}

/** Each library's name and how many of its items have a PDF and a key. */
export function webCounts(cache: WebCache | null) {
  return (cache?.libraries ?? []).map(library => {
    const parents = new Set(Object.values(library.files).map(file => file.parent));
    const items = Object.entries(library.items);
    return { name: library.name, items: items.length, withPdf: items.filter(([key]) => parents.has(key)).length, citationKeys: items.filter(([, item]) => item.citationKeys.length).length };
  });
}
