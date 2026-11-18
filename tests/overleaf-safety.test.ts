import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { insert, setup, until } from './fixtures/overleaf-sync-setup.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('an acknowledgement never uploads a file through a replaced directory', async context => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('sections/intro.tex', 'Intro\n'); });
  const sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.hold = true;
  t.write('sections/intro.tex', 'Safe local edit\n');
  await until(() => t.server.text('sections/intro.tex') === 'Safe local edit\n', 'the unacknowledged edit');
  const outside = path.join(path.dirname(t.root), 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'intro.tex'), 'PRIVATE SECRET\n');
  fs.renameSync(path.join(t.root, 'sections'), path.join(path.dirname(t.root), 'saved-sections'));
  fs.symlinkSync(outside, path.join(t.root, 'sections'), 'junction');
  t.server.release();
  await pause(2500);
  assert.equal(t.server.text('sections/intro.tex'), 'Safe local edit\n');
  assert.equal(fs.readFileSync(path.join(outside, 'intro.tex'), 'utf8'), 'PRIVATE SECRET\n');
});

test('remote edits pause immediately when Git starts merging', async context => {
  let merging = false;
  const t = await setup(server => server.addDoc('main.tex', 'Main\n'), { busy: () => merging });
  const sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  merging = true;
  const conflict = '<<<<<<< HEAD\nMine\n=======\nTheirs\n>>>>>>> branch\n';
  t.write('main.tex', conflict);
  t.server.edit('main.tex', () => [{ p: 0, i: 'Remote ' }]);
  await until(() => sync.state === 'paused', 'the Git pause');
  assert.equal(t.read('main.tex'), conflict);
  assert.equal(t.server.text('main.tex'), 'Remote Main\n');
  t.write('main.tex', 'Main resolved\n');
  merging = false;
  sync.retry();
  await until(() => t.server.text('main.tex') === 'Remote Main resolved\n' && t.read('main.tex') === 'Remote Main resolved\n', 'convergence after Git finishes');
});

test('a remote file arriving while the paper folder is missing cannot recreate it', async context => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('intro.tex', 'Intro\n'); });
  const sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  fs.renameSync(t.root, t.root + '-moved');
  t.server.addDoc('new.tex', 'New\n');
  await pause(2500);
  assert.equal(fs.existsSync(t.root), false);
  assert.deepEqual(t.server.paths(), ['intro.tex', 'main.tex', 'new.tex']);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
  fs.renameSync(t.root + '-moved', t.root);
  sync.retry();
  await until(() => t.read('new.tex') === 'New\n' && sync.state === 'synced', 'recovery of the original folder');
});

test('Git starting during a remote edit preserves the pending remote text on resume', async context => {
  let merging = false;
  const t = await setup(server => server.addDoc('main.tex', 'Main text ends.\n'), { busy: () => merging });
  const sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  // A fresh save makes readStable wait while the remote edit is processed.
  const readFile = fs.readFileSync;
  let armed = true;
  context.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = readFile(...args);
    if (armed && args[0] === path.join(t.root, 'main.tex')) { armed = false; queueMicrotask(() => { merging = true; }); }
    return data;
  });
  t.write('main.tex', 'Main text ends. local\n');
  t.server.edit('main.tex', () => [{ p: 0, i: 'Remote ' }]);
  await until(() => sync.state === 'paused', 'the pause during the read');
  assert.equal(t.read('main.tex'), 'Main text ends. local\n');
  t.write('main.tex', 'Main text ends. resolved\n');
  merging = false;
  sync.retry();
  await until(() => sync.state === 'synced' && t.read('main.tex') === 'Remote Main text ends. resolved\n' && t.server.text('main.tex') === 'Remote Main text ends. resolved\n', 'both edits after resuming');
});

test('an unreadable subfolder is never treated as deleted', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async context => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('sections/intro.tex', 'Intro\n'); });
  const sync = t.sync().start();
  context.after(async () => { fs.chmodSync(path.join(t.root, 'sections'), 0o755); await t.close(sync); });
  await until(() => sync.state === 'synced', 'the first sync');
  fs.chmodSync(path.join(t.root, 'sections'), 0o000);
  await pause(2500);
  assert.deepEqual(t.server.paths(), ['main.tex', 'sections/intro.tex']);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
});

test('a binary edited during a download is saved before the remote version replaces it', async context => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addFile('fig.png', Buffer.from('original')); });
  let sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  t.server.addFile('fig.png', Buffer.from('remote replacement'));
  let changed = false;
  t.server.before = (method, route) => {
    if (!changed && method === 'GET' && route.includes('/file/')) { changed = true; t.write('fig.png', 'local edit during download'); }
  };
  sync = t.sync().start();
  await until(() => changed && sync.state === 'synced', 'the downloaded file');
  assert.equal(t.read('fig.png'), 'remote replacement');
  const conflict = sync.status('paper').conflicts.find(item => item.path === 'fig.png');
  assert.ok(conflict, 'the competing local edit is saved');
  await sync.useMine(conflict.id);
  assert.equal(t.read('fig.png'), 'local edit during download');
});

test('an unreadable binary stays on Overleaf when reconnecting', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async context => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addFile('fig.png', Buffer.from([1, 2, 3])); });
  let sync = t.sync().start();
  context.after(async () => { fs.chmodSync(path.join(t.root, 'fig.png'), 0o644); await t.close(sync); });
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  fs.chmodSync(path.join(t.root, 'fig.png'), 0o000);
  sync = t.sync().start();
  await until(() => sync.state === 'synced' && sync.status('paper').skipped.includes('fig.png'), 'the unreadable file set aside');
  assert.deepEqual(t.server.paths(), ['fig.png', 'main.tex']);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
});

test('Use mine restores a text conflict after Overleaf clears the whole file', async context => {
  const t = await setup(server => server.addDoc('main.tex', 'original text'));
  let sync = t.sync().start();
  context.after(() => t.close(sync));
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  t.write('main.tex', 'local rewrite');
  t.server.edit('main.tex', text => [{ p: 0, d: text }]);
  sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the conflict');
  assert.equal(t.read('main.tex'), '');
  const [conflict] = sync.status('paper').conflicts;
  assert.ok(conflict);
  await sync.useMine(conflict.id);
  await until(() => t.server.text('main.tex') === 'local rewrite', 'the restored text');
});

test('a folder left with only build output deletes nothing on Overleaf when Papilot starts', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('sections/intro.tex', 'Intro\n'); server.addFile('fig.png', Buffer.from([1, 2, 3])); });
  let sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  // A branch without the sources, with the last build's output left over.
  for (const file of ['main.tex', 'sections/intro.tex', 'fig.png']) fs.rmSync(path.join(t.root, file));
  t.write('main.pdf', '%PDF'); t.write('main.log', 'log'); t.write('main.aux', 'aux');
  sync = t.sync().start();
  await until(() => sync.state === 'paused', 'the pause');
  await pause(2000);
  assert.deepEqual(t.server.paths(), ['fig.png', 'main.tex', 'sections/intro.tex']);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
  await t.close(sync);
});

test('renaming the folder that holds the paper moves the files on Overleaf, keeping their history', async () => {
  const t = await setup(server => { server.addDoc('paper/main.tex', 'Main\n'); server.addDoc('paper/intro.tex', 'Intro\n'); server.addFile('paper/fig.png', Buffer.from([1, 2, 3])); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  const ids = ['paper/main.tex', 'paper/intro.tex', 'paper/fig.png'].map(file => t.server.byPath(file)!.entity.id);
  fs.renameSync(path.join(t.root, 'paper'), path.join(t.root, 'manuscript'));
  await until(() => t.server.paths().join() === 'manuscript/fig.png,manuscript/intro.tex,manuscript/main.tex', 'the moves');
  assert.deepEqual(['manuscript/main.tex', 'manuscript/intro.tex', 'manuscript/fig.png'].map(file => t.server.byPath(file)!.entity.id), ids);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE') || request.includes('/upload')));
  await t.close(sync);
});

test('a coauthor renaming a file onto a local file Papilot does not sync never uploads that file', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('draft.tex', 'Coauthor draft\n'); }, { ignored: ['notes.tex'] });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.write('notes.tex', 'PRIVATE: my reviewer notes\n');
  await pause(1500);
  t.server.rename('draft.tex', 'notes.tex');
  await until(() => t.read('notes.tex') === 'Coauthor draft\n', 'the coauthor’s file under its new name');
  await pause(2500);
  assert.equal(t.server.text('notes.tex'), 'Coauthor draft\n');
  assert.deepEqual(t.server.paths(), ['main.tex', 'notes.tex']);
  assert.ok(sync.status('paper').conflicts.some(conflict => conflict.path === 'notes.tex'), 'the private file is kept to put back');
  await t.close(sync);
});

test('a file whose merge cannot be written is set aside without undoing the coauthor’s edit', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'one\ntwo\nthree\n'); });
  let sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  t.server.forgetUpdates();
  t.server.edit('main.tex', doc => [{ p: doc.length, i: 'coauthor four\n' }]);
  t.write('main.tex', 'ONE\ntwo\nthree\n');
  fs.chmodSync(t.root, 0o555);
  try {
    sync = t.sync().start();
    await until(() => sync.state === 'synced' && sync.status('paper').skipped.includes('main.tex'), 'the file set aside');
    await pause(2500);
    assert.equal(t.server.text('main.tex'), 'one\ntwo\nthree\ncoauthor four\n');
  } finally { fs.chmodSync(t.root, 0o755); }
  await t.close(sync);
});

test('a burst of coauthor edits reaches the file at once', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'start\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  for (let i = 0; i < 60; i++) t.server.edit('main.tex', insert('start', ` ${i}`));
  const sent = Date.now();
  await until(() => t.read('main.tex') === t.server.text('main.tex'), 'the burst in the file', 8000);
  assert.ok(Date.now() - sent < 3000, `the burst took ${Date.now() - sent} ms`);
  await t.close(sync);
});
