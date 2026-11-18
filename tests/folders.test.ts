import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { listFolders } from '../src/server/folders.ts';
import { guard } from '../src/server/access.ts';

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-folders-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['paper 10', 'paper 2', 'Beta', 'alpha', '.git', '.hidden']) fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, 'main.tex'), '');
  return root;
}

test('lists visible subfolders in natural order without files or hidden folders', async t => {
  const root = fixture(t);
  const value = await listFolders({ path: root });
  assert.equal(value.path, root);
  assert.equal(value.parent, path.dirname(root));
  assert.deepEqual(value.folders.map(folder => folder.name), ['alpha', 'Beta', 'paper 2', 'paper 10']);
  assert.deepEqual(value.folders.map(folder => folder.path), value.folders.map(folder => path.join(root, folder.name)));
});

test('follows folder links but not file links', { skip: process.platform === 'win32' && 'Creating symlinks needs elevated rights on Windows.' }, async t => {
  const root = fixture(t);
  fs.symlinkSync(path.join(root, 'alpha'), path.join(root, 'linked'));
  fs.symlinkSync(path.join(root, 'main.tex'), path.join(root, 'file-link'));
  fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'broken'));
  assert.deepEqual((await listFolders({ path: root })).folders.map(folder => folder.name), ['alpha', 'Beta', 'linked', 'paper 2', 'paper 10']);
});

test('a partly typed, missing or file path opens its nearest existing folder', async t => {
  const root = fixture(t);
  assert.equal((await listFolders({ path: path.join(root, 'alpha', 'not yet', 'created') })).path, path.join(root, 'alpha'));
  assert.equal((await listFolders({ path: path.join(root, 'main.tex') })).path, root);
  assert.equal((await listFolders({ path: path.join(root, 'alpha') + path.sep })).path, path.join(root, 'alpha'));
});

test('an empty path or ~ starts in the home folder; the filesystem root has no parent', async () => {
  assert.equal((await listFolders({})).path, path.resolve(os.homedir()));
  assert.equal((await listFolders({ path: '  ' })).path, path.resolve(os.homedir()));
  assert.equal((await listFolders({ path: '~' })).path, path.resolve(os.homedir()));
  const root = path.parse(process.cwd()).root;
  assert.equal((await listFolders({ path: root })).parent, null);
});

test('rejects relative, malformed and unreadable paths with product errors', { skip: process.platform === 'win32' && 'POSIX permissions only.' }, async t => {
  assert.equal((await listFolders({ path: 'papers/mine' })).path, os.homedir(), 'A relative path starts browsing at home');
  await assert.rejects(listFolders({ path: 42 }), { message: 'Invalid file path.' });
  await assert.rejects(listFolders({ path: '/tmp/\0' }), { message: 'Invalid file path.' });
  await assert.rejects(listFolders({ path: '/' + 'a'.repeat(4001) }), { message: 'Invalid file path.' });
  if (process.getuid?.() === 0) return; // Root can read any folder.
  const root = fixture(t), locked = path.join(root, 'alpha');
  fs.chmodSync(locked, 0o000);
  try { await assert.rejects(listFolders({ path: locked }), { message: 'Papilot cannot read this folder.' }); }
  finally { fs.chmodSync(locked, 0o700); }
});

test('folder listings require the workspace CSRF token', async t => {
  const app = Fastify();
  guard(app, { listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, csrf: 'folders-test-token' });
  app.post('/api/folders', request => listFolders((request.body || {}) as any));
  t.after(() => app.close());
  const root = fixture(t), headers = { host: '127.0.0.1:7274', 'content-type': 'application/json' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { path: root } })).statusCode, 403);
  const allowed = await app.inject({ method: 'POST', url: '/api/folders', headers: { ...headers, 'x-papilot-token': 'folders-test-token' }, payload: { path: root } });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json().path, root);
});
