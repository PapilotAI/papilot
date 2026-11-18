import { execFile } from 'node:child_process';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Cookies } from './http.ts';
import type { OverleafBrowserSession as BrowserSession } from '../../shared.ts';

// Overleaf sessions a browser on this computer is already signed in with,
// so signing in to Papilot can reuse one instead of a pasted cookie. Only
// the cookies a browser would send to the Overleaf server's pages are read.
// Chromium browsers encrypt theirs with a key that the macOS Keychain hands
// over only after asking the person; Firefox keeps its own unencrypted.
// Safari is left out: its folder is protected, and reading it could put a
// system prompt in front of someone who chose another browser.

export type { BrowserSession };
export interface BrowserOptions {
  home?: string;
  platform?: NodeJS.Platform;
  /** The password a Chromium browser encrypts cookies with. */
  secret?: (browser: Chromium, signal?: AbortSignal) => Promise<string | null>;
  signal?: AbortSignal;
}

/** Cookie names an Overleaf session lives in: overleaf.com's, then
 *  Community and Server Pro's, then theirs before the rename. */
const SESSION = new Set(['overleaf_session2', 'overleaf.sid', 'sharelatex.sid']);
const unreadable = () => new Error('Papilot could not read this browser’s sign-in. Allow access if your computer asks, then try again.');

interface Chromium { name: string; folder: Partial<Record<NodeJS.Platform, string>>; keychain: string; account: string; keyring: string }
const CHROMIUM: Chromium[] = [
  { name: 'Chrome', folder: { darwin: 'Library/Application Support/Google/Chrome', linux: '.config/google-chrome' }, keychain: 'Chrome Safe Storage', account: 'Chrome', keyring: 'chrome' },
  { name: 'Edge', folder: { darwin: 'Library/Application Support/Microsoft Edge', linux: '.config/microsoft-edge' }, keychain: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge', keyring: 'chromium' },
  { name: 'Brave', folder: { darwin: 'Library/Application Support/BraveSoftware/Brave-Browser', linux: '.config/BraveSoftware/Brave-Browser' }, keychain: 'Brave Safe Storage', account: 'Brave', keyring: 'brave' },
  { name: 'Arc', folder: { darwin: 'Library/Application Support/Arc/User Data' }, keychain: 'Arc Safe Storage', account: 'Arc', keyring: 'arc' },
  { name: 'Vivaldi', folder: { darwin: 'Library/Application Support/Vivaldi', linux: '.config/vivaldi' }, keychain: 'Vivaldi Safe Storage', account: 'Vivaldi', keyring: 'vivaldi' },
  { name: 'Chromium', folder: { darwin: 'Library/Application Support/Chromium', linux: '.config/chromium' }, keychain: 'Chromium Safe Storage', account: 'Chromium', keyring: 'chromium' },
];
const FIREFOX: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['Library/Application Support/Firefox/Profiles'],
  linux: ['.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox'],
  win32: ['AppData/Roaming/Mozilla/Firefox/Profiles'],
};

interface Row { host: string; name: string; value: string; expires: number | null; secure: boolean }
interface Store {
  id: string; browser: string; profile?: string;
  /** Cookie names and expiry, read without a key. */
  names(): Promise<Row[]>;
  read(signal?: AbortSignal): Promise<Row[]>;
}

/** The cookie domains that apply to a host: itself, and it and each
 *  parent below the top level as a domain cookie. */
function domains(host: string) {
  const parts = host.toLowerCase().split('.'), list = [parts.join('.')];
  for (let at = 0; at < parts.length - 1; at++) list.push('.' + parts.slice(at).join('.'));
  return list;
}
const placeholders = (list: string[]) => list.map(() => '?').join(',');
const isFile = async (file: string) => (await fs.lstat(file).catch(() => null))?.isFile() ?? false;
async function folders(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
}

// Copies of cookie databases live in folders named after the process that
// made them, so ones a stopped process left behind can be removed.
const COPIES = 'papilot-cookies-';
/** Removes cookie copies left by Papilot processes that have stopped. */
export async function removeCookieCopies(directory = os.tmpdir()) {
  for (const name of await fs.readdir(directory).catch(() => [] as string[])) {
    const pid = Number(/^papilot-cookies-(\d+)-/.exec(name)?.[1]);
    if (!pid || pid === process.pid) continue;
    let running = true;
    try { process.kill(pid, 0); } catch (error) { running = (error as NodeJS.ErrnoException).code === 'EPERM'; }
    if (!running) await fs.rm(path.join(directory, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Opens a copy of a browser's cookie database, with its journal or
 *  write-ahead log, so a running browser's lock never stands in the way.
 *  A copy taken mid-write can be unreadable; a second copy is not. */
async function snapshot<T>(file: string, query: (db: DatabaseSync) => T, again = true): Promise<T> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), `${COPIES}${process.pid}-`));
  try {
    const copy = path.join(folder, 'cookies.db');
    await fs.copyFile(file, copy);
    for (const suffix of ['-wal', '-journal']) await fs.copyFile(file + suffix, copy + suffix).catch(() => undefined);
    const db = new DatabaseSync(copy);
    try { return query(db); } finally { db.close(); }
  } catch (error) {
    if (again) return snapshot(file, query, false);
    throw error;
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

// Chromium writes times as microseconds since 1601; zero means the cookie
// ends with the browser session.
const fromChromium = (value: number | bigint) => Number(value) ? Number(value) / 1e6 - 11_644_473_600 : null;

async function chromiumStores(home: string, platform: NodeJS.Platform, host: string, options: BrowserOptions): Promise<Store[]> {
  const stores: Store[] = [];
  for (const browser of CHROMIUM) {
    const relative = browser.folder[platform];
    if (!relative) continue;
    const root = path.join(home, relative);
    let names: Record<string, { name?: string }> = {};
    try { names = JSON.parse(await fs.readFile(path.join(root, 'Local State'), 'utf8'))?.profile?.info_cache || {}; } catch { /* Profiles keep their folder names. */ }
    for (const folder of await folders(root)) {
      if (folder !== 'Default' && !/^Profile \d+$/.test(folder)) continue;
      let file = '';
      for (const candidate of [path.join(root, folder, 'Network', 'Cookies'), path.join(root, folder, 'Cookies')]) if (await isFile(candidate)) { file = candidate; break; }
      if (!file) continue;
      const query = () => snapshot(file, db => {
        const version = Number((db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get() as { value?: string } | undefined)?.value || 0);
        const columns = new Set((db.prepare('PRAGMA table_info(cookies)').all() as { name: string }[]).map(column => column.name));
        const list = domains(host);
        const statement = db.prepare(`SELECT host_key AS host, name, value, encrypted_value AS encrypted, expires_utc AS expires, is_secure AS secure FROM cookies WHERE host_key IN (${placeholders(list)}) AND path = '/'${columns.has('top_frame_site_key') ? ` AND top_frame_site_key = ''` : ''}`);
        // Microseconds since 1601 pass JavaScript's exact integers.
        statement.setReadBigInts(true);
        const rows = statement.all(...list) as unknown as { host: string; name: string; value: string; encrypted: Uint8Array | null; expires: bigint; secure: bigint }[];
        return { rows, version };
      });
      const row = (item: { host: string; name: string; expires: bigint; secure: bigint }, value: string): Row => ({ host: item.host, name: item.name, value, expires: fromChromium(item.expires), secure: Boolean(item.secure) });
      stores.push({
        id: `${browser.name.toLowerCase()}:${folder}`, browser: browser.name, profile: names[folder]?.name || folder,
        names: async () => (await query()).rows.map(item => row(item, '')),
        read: async signal => {
          const { rows, version } = await query();
          const sealed = rows.filter(item => !item.value && item.encrypted?.length).map(item => Buffer.from(item.encrypted!).subarray(0, 3).toString('latin1'));
          const decrypt = sealed.length ? await chromiumKey(browser, platform, options, sealed.includes('v11'), signal) : null;
          return rows.map(item => row(item, item.value || (decrypt && item.encrypted?.length ? decrypt(item.encrypted, item.host, version) : '')));
        },
      });
    }
  }
  return stores;
}

/** Decrypts Chromium's "v10" and "v11" cookie values: AES-128-CBC with a
 *  key from the browser's password, and, from database version 24, the
 *  SHA-256 of the cookie's domain in front of the value. */
async function chromiumKey(browser: Chromium, platform: NodeJS.Platform, options: BrowserOptions, keyring: boolean, signal?: AbortSignal) {
  // On Linux, Chromium uses a fixed password ("v10") unless a keyring holds
  // one ("v11"); an empty keyring entry leaves the password empty.
  const secret = platform === 'darwin' || keyring ? await (options.secret || systemSecret(platform))(browser, signal) : null;
  if (signal?.aborted) throw unreadable();
  const key = (password: string) => pbkdf2Sync(password, 'saltysalt', platform === 'darwin' ? 1003 : 1, 16, 'sha1');
  const keys: Record<string, Buffer[]> = platform === 'darwin'
    ? { v10: secret ? [key(secret)] : [] }
    : { v10: [key('peanuts')], v11: [...(secret ? [key(secret)] : []), key('')] };
  if (platform === 'darwin' && !secret) throw unreadable();
  return (encrypted: Uint8Array, host: string, version: number) => {
    const data = Buffer.from(encrypted);
    for (const candidate of keys[data.subarray(0, 3).toString('latin1')] || []) {
      try {
        const decipher = createDecipheriv('aes-128-cbc', candidate, Buffer.alloc(16, ' '));
        let plain = Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]);
        if (version >= 24) {
          if (plain.length < 32 || !plain.subarray(0, 32).equals(createHash('sha256').update(host).digest())) continue;
          plain = plain.subarray(32);
        }
        return plain.toString('latin1');
      } catch { /* Not this key. */ }
    }
    return '';
  };
}

/** Asks the macOS Keychain, or a Linux keyring, for a browser's cookie
 *  password. macOS shows the person a prompt first. */
const systemSecret = (platform: NodeJS.Platform) => (browser: Chromium, signal?: AbortSignal): Promise<string | null> => {
  const [command, args] = platform === 'darwin'
    ? ['security', ['find-generic-password', '-w', '-s', browser.keychain, '-a', browser.account]]
    : ['secret-tool', ['lookup', 'application', browser.keyring]];
  return new Promise(resolve => execFile(command, args, { signal }, (error, stdout) => resolve(error ? null : stdout.replace(/\n$/, '') || null)));
};

async function firefoxStores(home: string, platform: NodeJS.Platform, host: string): Promise<Store[]> {
  const stores: Store[] = [];
  for (const relative of FIREFOX[platform] || []) {
    const root = path.join(home, relative);
    for (const folder of await folders(root)) {
      const file = path.join(root, folder, 'cookies.sqlite');
      if (!await isFile(file)) continue;
      const read = () => snapshot(file, db => {
        const list = domains(host);
        const statement = db.prepare(`SELECT host, name, value, expiry, isSecure AS secure FROM moz_cookies WHERE host IN (${placeholders(list)}) AND path = '/' AND originAttributes = ''`);
        statement.setReadBigInts(true);
        const rows = statement.all(...list) as unknown as { host: string; name: string; value: string; expiry: bigint; secure: bigint }[];
        // Firefox counts expiry in seconds, and in milliseconds since 2024.
        return rows.map(row => { const expiry = Number(row.expiry); return { host: row.host, name: row.name, value: row.value, secure: Boolean(row.secure), expires: expiry ? expiry > 1e11 ? expiry / 1000 : expiry : null }; });
      });
      stores.push({ id: `firefox:${relative}/${folder}`, browser: 'Firefox', profile: folder.replace(/^[^.]*\./, ''), names: read, read });
    }
  }
  return stores;
}

async function stores(origin: string, options: BrowserOptions) {
  const home = options.home || os.homedir(), platform = options.platform || process.platform, host = new URL(origin).hostname;
  return (await Promise.all([chromiumStores(home, platform, host, options), firefoxStores(home, platform, host)])).flat();
}
/** Cookies a browser would send to the server's pages: unexpired, and
 *  not marked Secure when the server is reached without HTTPS. */
const usable = (origin: string) => (row: Row) => (row.expires === null || row.expires * 1000 > Date.now()) && (!row.secure || new URL(origin).protocol === 'https:');

/** Browsers and profiles on this computer holding a session for an
 *  Overleaf server. Nothing is decrypted, so no prompt appears. */
export async function browserSessions(origin: string, options: BrowserOptions = {}): Promise<BrowserSession[]> {
  const found: BrowserSession[] = [];
  for (const store of await stores(origin, options)) {
    // Names are stored in the clear; reading them needs no key.
    const rows = await store.names().catch(() => []);
    if (rows.some(row => SESSION.has(row.name) && usable(origin)(row))) found.push({ id: store.id, browser: store.browser, ...(store.profile ? { profile: store.profile } : {}) });
  }
  // Name profiles only where one browser has several.
  return found.map(session => found.filter(other => other.browser === session.browser).length > 1 ? session : { id: session.id, browser: session.browser });
}

/** The cookies of a browser session found by `browserSessions`. */
export async function browserCookies(origin: string, id: string, options: BrowserOptions = {}): Promise<Cookies> {
  const store = (await stores(origin, options)).find(item => item.id === id);
  if (!store) throw new Error('This browser’s sign-in is no longer available. Sign in again.');
  const cookies: Cookies = {};
  // Host cookies override domain cookies of the same name, as a browser sends them.
  const rows = (await store.read(options.signal)).filter(usable(origin)).sort((a, b) => Number(!a.host.startsWith('.')) - Number(!b.host.startsWith('.')));
  for (const row of rows) if (/^[!#$%&'*+\-.^_`|~\w]+$/.test(row.name) && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(row.value)) cookies[row.name] = row.value;
  if (!Object.keys(cookies).some(name => SESSION.has(name))) throw unreadable();
  return cookies;
}
