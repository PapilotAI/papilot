import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { FakeOverleaf } from './fixtures/overleaf-server.ts';
import { browserCookies, browserSessions, removeCookieCopies } from '../src/server/overleaf/browsers.ts';
import { OverleafService } from '../src/server/overleaf/service.ts';
import { registerOverleafRoutes } from '../src/server/overleaf/routes.ts';

// Signing in with the Overleaf session of a browser on this computer, read
// from fixture cookie stores laid out as Chrome and Firefox keep them.

const OVERLEAF = 'https://www.overleaf.com', DAY = 86_400;
const later = (seconds = 30 * DAY) => Math.floor(Date.now() / 1000) + seconds;
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-browsers-'));

interface Cookie { host: string; name: string; value: string; expires?: number; secure?: boolean; path?: string }
/** Chromium's v10/v11 format: AES-128-CBC, and from database version 24
 *  the SHA-256 of the cookie's domain before the value. */
function encrypt(value: string, host: string, password: string, iterations: number, version: number, prefix = 'v10') {
  const cipher = createCipheriv('aes-128-cbc', pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1'), Buffer.alloc(16, ' '));
  const plain = Buffer.concat([version >= 24 ? createHash('sha256').update(host).digest() : Buffer.alloc(0), Buffer.from(value)]);
  return Buffer.concat([Buffer.from(prefix), cipher.update(plain), cipher.final()]);
}
function chromium(file: string, cookies: Cookie[], options: { password: string; iterations: number; version: number; prefix?: string }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE meta (key LONGVARCHAR PRIMARY KEY, value LONGVARCHAR);
    CREATE TABLE cookies (creation_utc INTEGER, host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER);`);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('version', String(options.version));
  const insert = db.prepare('INSERT INTO cookies VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)');
  for (const cookie of cookies) {
    // Microseconds since 1601, past JavaScript's exact integers.
    const expires = cookie.expires === 0 ? 0n : BigInt(cookie.expires ?? later()) * 1_000_000n + 11_644_473_600_000_000n;
    insert.run(cookie.host, '', cookie.name, '', encrypt(cookie.value, cookie.host, options.password, options.iterations, options.version, options.prefix), cookie.path || '/', expires, cookie.secure === false ? 0 : 1);
  }
  db.close();
}
function firefox(file: string, cookies: (Cookie & { originAttributes?: string })[], schema = 17) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${schema}; PRAGMA journal_mode = WAL;
    CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER);`);
  const insert = db.prepare(`INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, isSecure, isHttpOnly) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  // Milliseconds from schema 16 on, seconds before.
  for (const cookie of cookies) insert.run(cookie.originAttributes || '', cookie.name, cookie.value, cookie.host, cookie.path || '/', (cookie.expires ?? later()) * (schema >= 16 ? 1000 : 1), cookie.secure === false ? 0 : 1);
  return db;
}
test('Chrome sessions are found without a key and decrypted only when chosen', async () => {
  const dir = home(), root = path.join(dir, 'Library/Application Support/Google/Chrome');
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' }, 'Profile 1': { name: 'Work' } } } }));
    const options = { password: 'keychain-secret', iterations: 1003, version: 24 };
    chromium(path.join(root, 'Default', 'Cookies'), [{ host: '.example.com', name: 'overleaf_session2', value: 'elsewhere' }], options);
    chromium(path.join(root, 'Profile 1', 'Cookies'), [
      { host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Awork' },
      { host: 'www.overleaf.com', name: 'GCLB', value: 'affinity', expires: 0 },
      { host: '.overleaf.com', name: 'old', value: 'expired', expires: later(-DAY) },
      { host: '.example.com', name: 'tracker', value: 'other-site' },
    ], options);
    let asked = 0;
    const secret = async () => { asked++; return 'keychain-secret'; };
    assert.deepEqual(await browserSessions(OVERLEAF, { home: dir, platform: 'darwin', secret }), [{ id: 'chrome:Profile 1', browser: 'Chrome' }]);
    assert.equal(asked, 0, 'finding sessions asks for no key, so no prompt appears');
    assert.deepEqual(await browserCookies(OVERLEAF, 'chrome:Profile 1', { home: dir, platform: 'darwin', secret }), { overleaf_session2: 's%3Awork', GCLB: 'affinity' }, 'only live cookies of the Overleaf site');
    assert.equal(asked, 1);
    await assert.rejects(browserCookies(OVERLEAF, 'chrome:Profile 1', { home: dir, platform: 'darwin', secret: async () => null }), /could not read this browser’s sign-in/, 'a declined Keychain prompt');
    await assert.rejects(browserCookies(OVERLEAF, 'chrome:Profile 1', { home: dir, platform: 'darwin', secret: async () => 'wrong' }), /could not read this browser’s sign-in/);
    await assert.rejects(browserCookies(OVERLEAF, 'chrome:../../etc', { home: dir, platform: 'darwin', secret }), /no longer available/, 'only found profiles are read');
    // With sessions in two profiles, each is named.
    chromium(path.join(root, 'Default', 'Network', 'Cookies'), [{ host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Apersonal' }], options);
    assert.deepEqual(await browserSessions(OVERLEAF, { home: dir, platform: 'darwin', secret }), [
      { id: 'chrome:Default', browser: 'Chrome', profile: 'Personal' },
      { id: 'chrome:Profile 1', browser: 'Chrome', profile: 'Work' },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    assert.equal((await browserCookies(OVERLEAF, 'chrome:Default', { home: dir, platform: 'darwin', secret })).overleaf_session2, 's%3Apersonal', 'the Network folder Chromium moved cookies to');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Linux Chromium and self-hosted servers: a fixed key or the keyring, any session cookie name', async () => {
  const dir = home(), file = path.join(dir, '.config/chromium/Default/Cookies');
  try {
    chromium(file, [{ host: 'latex.example.edu', name: 'overleaf.sid', value: 's%3Aself' }], { password: 'peanuts', iterations: 1, version: 23 });
    const server = 'https://latex.example.edu';
    assert.deepEqual(await browserSessions(server, { home: dir, platform: 'linux', secret: async () => null }), [{ id: 'chromium:Default', browser: 'Chromium' }]);
    assert.deepEqual(await browserCookies(server, 'chromium:Default', { home: dir, platform: 'linux', secret: async () => null }), { 'overleaf.sid': 's%3Aself' });
    fs.rmSync(file);
    chromium(file, [{ host: 'latex.example.edu', name: 'sharelatex.sid', value: 's%3Akeyring' }], { password: 'from-keyring', iterations: 1, version: 24, prefix: 'v11' });
    assert.deepEqual(await browserCookies(server, 'chromium:Default', { home: dir, platform: 'linux', secret: async () => 'from-keyring' }), { 'sharelatex.sid': 's%3Akeyring' });
    assert.deepEqual(await browserSessions(OVERLEAF, { home: dir, platform: 'linux' }), [], 'another server’s session is not offered');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Firefox sessions are read from a running browser’s database, outside containers', async () => {
  const dir = home(), profiles = path.join(dir, 'Library/Application Support/Firefox/Profiles');
  // Left open as a running Firefox does, with recent rows still in its write-ahead log.
  const db = firefox(path.join(profiles, 'ab12cd34.default-release', 'cookies.sqlite'), [
    { host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Afox' },
    { host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Acontainer', originAttributes: '^userContextId=2' },
  ]);
  try {
    firefox(path.join(profiles, 'ef56gh78.old', 'cookies.sqlite'), [{ host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Aold', expires: later(-DAY) }]).close();
    assert.deepEqual(await browserSessions(OVERLEAF, { home: dir, platform: 'darwin' }), [{ id: 'firefox:Library/Application Support/Firefox/Profiles/ab12cd34.default-release', browser: 'Firefox' }], 'expired sessions are not offered');
    assert.deepEqual(await browserCookies(OVERLEAF, 'firefox:Library/Application Support/Firefox/Profiles/ab12cd34.default-release', { home: dir, platform: 'darwin' }), { overleaf_session2: 's%3Afox' });
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only cookies a browser would send are taken: live, at the site root, host before domain, Secure only over HTTPS', async () => {
  const dir = home(), file = path.join(dir, '.config/google-chrome/Default/Cookies');
  try {
    chromium(file, [
      { host: '.example.edu', name: 'overleaf.sid', value: 'domain' },
      { host: 'latex.example.edu', name: 'overleaf.sid', value: 'host', secure: false },
      { host: 'latex.example.edu', name: 'sso', value: 'secret', secure: true },
      { host: 'latex.example.edu', name: 'deep', value: 'path', path: '/project' },
    ], { password: 'peanuts', iterations: 1, version: 24 });
    const options = { home: dir, platform: 'linux' as const, secret: async () => null };
    assert.deepEqual(await browserCookies('https://latex.example.edu', 'chrome:Default', options), { 'overleaf.sid': 'host', sso: 'secret' });
    assert.deepEqual(await browserCookies('http://latex.example.edu', 'chrome:Default', options), { 'overleaf.sid': 'host' }, 'a Secure cookie never goes over plain HTTP');
    fs.rmSync(file);
    chromium(file, [{ host: 'latex.example.edu', name: 'overleaf.sid', value: 'secure-only', secure: true }], { password: 'peanuts', iterations: 1, version: 24 });
    assert.deepEqual(await browserSessions('http://latex.example.edu', options), [], 'a session only HTTPS may carry is not offered for HTTP');
    // Firefox before schema 16 counts expiry in seconds.
    firefox(path.join(dir, '.mozilla/firefox/xy.default/cookies.sqlite'), [{ host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Aseconds' }], 15).close();
    assert.deepEqual(await browserCookies(OVERLEAF, 'firefox:.mozilla/firefox/xy.default', options), { overleaf_session2: 's%3Aseconds' });
    const copies = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(`papilot-cookies-${process.pid}-`));
    assert.deepEqual(copies, [], 'copies of cookie databases are removed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('closing the sign-in cancels a Keychain prompt, and copies a stopped process left are removed', async () => {
  const dir = home(), root = path.join(dir, 'Library/Application Support/Google/Chrome');
  try {
    chromium(path.join(root, 'Default', 'Cookies'), [{ host: '.overleaf.com', name: 'overleaf_session2', value: 's%3Aa' }], { password: 'keychain-secret', iterations: 1003, version: 24 });
    const stop = new AbortController();
    let asked = false;
    const secret = (_browser: unknown, signal?: AbortSignal) => new Promise<string | null>(resolve => { asked = true; signal?.addEventListener('abort', () => resolve(null)); });
    const reading = browserCookies(OVERLEAF, 'chrome:Default', { home: dir, platform: 'darwin', secret, signal: stop.signal });
    while (!asked) await new Promise(resolve => setTimeout(resolve, 5));
    stop.abort();
    await assert.rejects(reading, /could not read this browser’s sign-in/);
    // A copy named after a process that has exited is left over from a crash.
    const exited = spawnSync(process.execPath, ['-e', '']).pid!;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-copies-test-'));
    fs.mkdirSync(path.join(tmp, `papilot-cookies-${exited}-abc`));
    fs.mkdirSync(path.join(tmp, `papilot-cookies-${process.pid}-def`));
    await removeCookieCopies(tmp);
    assert.deepEqual(fs.readdirSync(tmp), [`papilot-cookies-${process.pid}-def`], 'only copies of running processes stay');
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('signing in with a browser’s session keeps that browser signed in, and only a browser here may', async () => {
  const server = await new FakeOverleaf().start(), dir = home();
  const service = new OverleafService(path.join(dir, 'overleaf'), { project: () => { throw new Error('Paper project not found.'); }, projects: () => [] }, () => undefined);
  const app = Fastify();
  try {
    const host = new URL(server.origin).hostname, profile = 'Library/Application Support/Firefox/Profiles/ab12cd34.default-release';
    // The fake server speaks plain HTTP, so its cookie is not Secure.
    firefox(path.join(dir, profile, 'cookies.sqlite'), [{ host, name: 'overleaf_session2', value: server.session, secure: false }]).close();
    service.browserOptions = { home: dir, platform: 'darwin' };
    registerOverleafRoutes(app, service, () => ({}), request => request.headers['x-test-local'] === 'yes');
    const local = { 'x-test-local': 'yes' };
    const listed = await app.inject({ method: 'POST', url: '/api/overleaf/browsers', headers: local, payload: { origin: server.origin } });
    assert.deepEqual(listed.json(), { sessions: [{ id: `firefox:${profile}`, browser: 'Firefox' }] });
    const remote = await app.inject({ method: 'POST', url: '/api/overleaf/browsers', payload: { origin: server.origin } });
    assert.deepEqual(remote.json(), { sessions: [] }, 'a browser elsewhere is not offered this computer’s sessions');
    const refused = await app.inject({ method: 'POST', url: '/api/overleaf/sign-in', payload: { origin: server.origin, browser: `firefox:${profile}` } });
    assert.equal(refused.statusCode, 403);
    const signedIn = await app.inject({ method: 'POST', url: '/api/overleaf/sign-in', headers: local, payload: { origin: server.origin, browser: `firefox:${profile}` } });
    assert.deepEqual(signedIn.json(), { origin: server.origin, email: 'author@example.com' });
    const session = server.session;
    await service.signOut(server.origin);
    assert.equal(server.session, session, 'signing out of Papilot leaves the browser signed in');
    assert.deepEqual(service.state().accounts, []);
  } finally { await app.close(); await service.stop(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
