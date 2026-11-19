import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Fastify from 'fastify';
import { Store } from '../src/server/store.ts';
import { registerSshRoutes } from '../src/server/ssh/routes.ts';
import { sshAliases } from '../src/server/ssh/config.ts';

test('SSH picker follows Include paths, ignores patterns and deduplicates aliases', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-config-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.deepEqual(await sshAliases(home), []);
  const ssh = path.join(home, '.ssh'), sub = path.join(ssh, 'Hosts d');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(ssh, 'config'), 'Host=lab lab2 !excluded *.net # comment\nInclude "Hosts d/*.conf"\n');
  fs.writeFileSync(path.join(sub, 'one.conf'), 'host "paper" lab\ninclude config\n');
  assert.deepEqual(await sshAliases(home), ['lab', 'lab2', 'paper']);
});

test('SSH folder routes browse and save only the selected files and preserve competing edits', {
  skip: process.platform === 'win32' || spawnSync('python3', ['-V']).status !== 0,
}, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-ssh-')), parent = path.join(temp, 'group'), root = path.join(parent, "Author's papers");
  fs.mkdirSync(path.join(root, 'chapters'), { recursive: true });
  t.after(() => {
    fs.chmodSync(fs.existsSync(parent + '-moved') ? parent + '-moved' : parent, 0o700);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  // Shared lab servers often allow traversal but not listing in this parent.
  fs.chmodSync(parent, 0o111);
  const name = "chapters/A's draft.tex", target = path.join(root, name);
  fs.writeFileSync(target, '\ufeffOriginal\r\n', { mode: 0o640 });
  fs.symlinkSync(temp, path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'image'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, 'mixed.tex'), 'One\nTwo\r\n');
  // Replace the transport only. Exercise the real remote shell quoting,
  // helper, JSON protocol, SQLite bookmarks and routes without credentials.
  const executable = path.join(temp, 'ssh');
  fs.writeFileSync(executable, '#!/bin/sh\nfor arg do last="$arg"; done\nexec /bin/sh -c "$last"\n', { mode: 0o755 });
  const originalPath = process.env.PATH!;
  process.env.PATH = temp + path.delimiter + originalPath;
  t.after(() => { process.env.PATH = originalPath; });
  const store = new Store(path.join(temp, 'bookmarks.db'));
  const app = Fastify();
  registerSshRoutes(app, store);
  app.setErrorHandler((e: Error & { statusCode?: number }, _req, reply) => reply.code(e.statusCode ?? 400).send({ error: e.message }));
  t.after(async () => { await app.close(); store.db.close(); });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: '/api/ssh/' + url, payload });
  const connection = { host: '127.0.0.1', port: 2222, user: 'editor', root };
  assert.equal((await post('connect', { ...connection, host: '-invalid' })).statusCode, 400);
  assert.equal((await post('connect', { ...connection, port: 65536 })).statusCode, 400);
  const picker = await post('browse', connection);
  assert.deepEqual(picker.json(), { root: fs.realpathSync(root), page: 0, pages: 1, entries: [
    { name: 'chapters', folder: true }, { name: 'image', folder: false }, { name: 'mixed.tex', folder: false },
  ] });
  assert.equal((await post('browse', { ...connection, page: -1 })).statusCode, 400);
  const many = path.join(root, 'many');
  fs.mkdirSync(many);
  assert.deepEqual((await post('browse', { ...connection, root: many })).json().entries, []);
  for (let i = 0; i < 103; i++) fs.writeFileSync(path.join(many, 'draft-' + String(i).padStart(3, '0') + '.tex'), '');
  const first = (await post('browse', { ...connection, root: many })).json();
  const last = (await post('browse', { ...connection, root: many, page: 1 })).json();
  assert.equal(first.pages, 2); assert.equal(last.page, 1);
  assert.equal(first.entries.length, 100);
  assert.deepEqual(last.entries.map((entry: { name: string }) => entry.name), ['draft-100.tex', 'draft-101.tex', 'draft-102.tex']);
  assert.equal(store.preference('ssh-folders'), undefined, 'browsing does not create bookmarks');
  const picked = (await post('connect', { ...connection, root: path.join(picker.json().root, 'chapters') })).json().folder;
  assert.equal(picked.root, fs.realpathSync(path.join(root, 'chapters')));
  assert.ok((await post(picked.id + '/list', { path: '' })).json().entries.some((e: { name: string }) => e.name === "A's draft.tex"));
  await post(picked.id + '/forget', {});
  const confirmed = { ...connection, root: picker.json().root };
  const connected = await post('connect', confirmed);
  assert.equal(connected.statusCode, 200, connected.body);
  const { folder, entries } = connected.json();
  assert.equal(folder.root, fs.realpathSync(root));
  assert.equal(entries.some((e: { name: string }) => e.name === 'outside'), false);
  assert.deepEqual((await post('connect', confirmed)).json().folder, folder);
  const op = (action: string, payload: object) => post(folder.id + '/' + action, payload);
  assert.deepEqual((await op('list', { path: 'chapters' })).json().entries, [{ name: "A's draft.tex", folder: false }]);
  for (const invalid of ['../', '/etc', 'outside', 'chapters/..']) assert.equal((await op('list', { path: invalid })).statusCode, 400);
  assert.equal((await op('read', { path: 'image' })).statusCode, 400);
  const { revision, text } = (await op('read', { path: name })).json();
  assert.equal(text, 'Original\n');
  const edit = { path: name, revision, text: '作者\n' };
  const competing = { ...edit, text: 'Other\n' };
  const results = await Promise.all([op('save', edit), op('save', competing)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const winning = results[0].statusCode === 200 ? edit : competing;
  assert.equal(fs.readFileSync(target, 'utf8'), '\ufeff' + winning.text.replace('\n', '\r\n'));
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  assert.equal((await op('save', winning)).statusCode, 200, 'retry after losing the success response');
  const mixed = (await op('read', { path: 'mixed.tex' })).json();
  assert.equal((await op('save', { path: 'mixed.tex', revision: mixed.revision, text: 'New\n' })).statusCode, 400);
  assert.equal(fs.readFileSync(path.join(root, 'mixed.tex'), 'utf8'), 'One\nTwo\r\n');
  fs.writeFileSync(target, 'external revision');
  assert.equal((await op('save', edit)).statusCode, 409);
  assert.equal(fs.readFileSync(target, 'utf8'), 'external revision');
  fs.chmodSync(parent, 0o700);
  fs.renameSync(parent, parent + '-moved');
  fs.symlinkSync(parent + '-moved', parent);
  assert.equal((await op('read', { path: name })).statusCode, 400);
  assert.equal((await post('browse', { ...confirmed, canonical: true })).statusCode, 400);
  assert.equal((await post('connect', confirmed)).statusCode, 400, 'confirming a previously listed path must not follow a new symlink');
  assert.equal((await op('forget', {})).statusCode, 200);
  assert.equal((await op('list', { path: '' })).statusCode, 400);
  fs.writeFileSync(executable, '#!/bin/sh\necho "{}"\n');
  assert.equal((await post('connect', connection)).statusCode, 400);
  assert.deepEqual(store.preference('ssh-folders'), []);
});
