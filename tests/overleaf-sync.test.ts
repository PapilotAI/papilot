import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { insert, setup, until } from './fixtures/overleaf-sync-setup.ts';

test('an import downloads every file at its Overleaf path, and the live sync starts from it', async () => {
  const t = await setup(server => {
    server.addDoc('main.tex', '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n');
    server.addDoc('sections/intro.tex', 'Intro é 中文\n');
    server.addFile('figures/plot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
  });
  const once = t.sync();
  await once.fetchAll();
  assert.equal(t.read('main.tex'), t.server.text('main.tex'));
  assert.equal(t.read('sections/intro.tex'), 'Intro é 中文\n');
  assert.deepEqual(fs.readFileSync(path.join(t.root, 'figures/plot.png')), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
  const live = t.sync().start();
  await until(() => live.state === 'synced', 'the live sync');
  assert.deepEqual(t.server.requests, []);
  await t.close(once, live);
});

test('edits on both sides meet in the middle as they happen', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'The quick brown fox\njumps over\nthe lazy dog.\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  // The author's edit reaches Overleaf.
  t.write('main.tex', 'The quick brown fox\njumps high over\nthe lazy dog.\n');
  await until(() => t.server.text('main.tex') === 'The quick brown fox\njumps high over\nthe lazy dog.\n', 'the local edit on Overleaf');
  // A coauthor's edit reaches the file.
  t.server.edit('main.tex', insert('lazy', ', sleepy'));
  await until(() => t.read('main.tex') === 'The quick brown fox\njumps high over\nthe lazy, sleepy dog.\n', 'the remote edit in the file');
  assert.ok(t.changes() > 0);
  // Concurrent edits in one line, while Overleaf holds back its replies, keep both.
  t.server.hold = true;
  t.write('main.tex', 'The very quick brown fox\njumps high over\nthe lazy, sleepy dog.\n');
  await until(() => t.server.text('main.tex')!.includes('very'), 'the in-flight edit');
  t.server.edit('main.tex', insert('brown', ' furry'));
  t.write('main.tex', t.read('main.tex')!.replace('dog', 'cat'));
  t.server.release();
  await until(() => t.read('main.tex') === t.server.text('main.tex') && t.read('main.tex')!.includes('cat') && sync.status('paper').state === 'synced', 'convergence');
  assert.equal(t.read('main.tex'), 'The very quick brown furry fox\njumps high over\nthe lazy, sleepy cat.\n');
  await t.close(sync);
});

test('files and folders created, renamed, moved and deleted on either side follow', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('old.tex', 'Old\n'); }, { ignored: ['notes.txt'] });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.addDoc('chapters/one.tex', 'One\n');
  t.server.addFile('img/a.bin', Buffer.from([1, 2, 3]));
  await until(() => t.read('chapters/one.tex') === 'One\n' && fs.existsSync(path.join(t.root, 'img/a.bin')), 'new remote files');
  t.server.rename('old.tex', 'renamed.tex');
  t.server.move('chapters/one.tex', 'parts');
  await until(() => t.read('renamed.tex') === 'Old\n' && t.read('parts/one.tex') === 'One\n' && !t.read('old.tex'), 'remote rename and move');
  t.server.remove('img/a.bin');
  await until(() => !fs.existsSync(path.join(t.root, 'img')), 'remote delete');
  // Local changes go the other way.
  t.write('new.tex', 'Brand new\n');
  t.write('figs/b.bin', Buffer.from([4, 5, 6, 0]));
  await until(() => t.server.text('new.tex') === 'Brand new\n' && t.server.paths().includes('figs/b.bin'), 'local uploads');
  fs.renameSync(path.join(t.root, 'renamed.tex'), path.join(t.root, 'moved.tex'));
  await until(() => t.server.paths().includes('moved.tex') && !t.server.paths().includes('renamed.tex'), 'local rename');
  assert.ok(t.server.requests.some(request => request.endsWith('/rename')), 'a rename, not a new upload');
  fs.rmSync(path.join(t.root, 'new.tex'));
  await until(() => !t.server.paths().includes('new.tex'), 'local delete');
  // Build output, hidden files and Git-ignored files stay here.
  t.write('main.aux', 'aux'); t.write('main.pdf', '%PDF'); t.write('.secret', 'x'); t.write('notes.txt', 'mine');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.deepEqual(t.server.paths(), ['figs/b.bin', 'main.tex', 'moved.tex', 'parts/one.tex']);
  await t.close(sync);
});

test('a dropped connection catches up on updates both sides made meanwhile', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'alpha\nbeta\ngamma\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.disconnectAll();
  await until(() => sync.state !== 'synced', 'the disconnect');
  t.server.edit('main.tex', insert('beta', '!'));
  t.write('main.tex', 'alpha?\nbeta\ngamma\n');
  await until(() => sync.state === 'synced' && t.read('main.tex') === 'alpha?\nbeta!\ngamma\n' && t.server.text('main.tex') === 'alpha?\nbeta!\ngamma\n', 'catch-up', 15000);
  assert.deepEqual(t.store.conflicts(t.link.id), []);
  await t.close(sync);
});

test('after time apart, both sides merge from the base, and Overleaf keeps a passage both changed', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'one\ntwo\nthree\nfour\n'); server.addFile('data.bin', Buffer.from('v1')); });
  let sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  await sync.stop();
  t.server.forgetUpdates();
  t.server.edit('main.tex', doc => [{ p: doc.indexOf('four'), d: 'four' }, { p: doc.indexOf('four'), i: 'FOUR' }]);
  t.server.edit('main.tex', doc => [{ p: doc.indexOf('two'), d: 'two' }, { p: doc.indexOf('two'), i: 'TWO (Overleaf)' }]);
  t.write('main.tex', 'ONE\ntwo (mine)\nthree\nfour\n');
  t.write('data.bin', 'local v2');
  sync = t.sync().start();
  await until(() => sync.status('paper').state === 'synced' && t.server.text('main.tex') === t.read('main.tex'), 'the merge', 15000);
  assert.equal(t.read('main.tex'), 'ONE\nTWO (Overleaf)\nthree\nFOUR\n');
  await until(() => t.server.byPath('data.bin') !== null && (t.server.byPath('data.bin')!.entity as { data: Buffer }).data.toString() === 'local v2', 'the binary upload');
  const [conflict] = t.store.conflicts(t.link.id);
  assert.equal(conflict.path, 'main.tex');
  assert.match(conflict.ours, /two \(mine\)/);
  await sync.useMine(conflict.id);
  await until(() => t.server.text('main.tex') === 'ONE\ntwo (mine)\nthree\nFOUR\n', 'the restored passage on Overleaf');
  assert.deepEqual(t.store.conflicts(t.link.id), []);
  await t.close(sync);
});

test('history-ot files keep tracked deletions hidden and accept edits around them', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'keep this removed text and this', 'history-ot', [{ pos: 10, length: 13 }]); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  assert.equal(t.read('main.tex'), 'keep this and this');
  t.write('main.tex', 'keep this and that');
  await until(() => t.server.text('main.tex') === 'keep this and that', 'the edit');
  t.server.edit('main.tex', () => [{ textOperation: [0, 'Please ', 31].filter(Boolean) }]);
  await until(() => t.read('main.tex') === 'Please keep this and that', 'the remote history edit');
  await t.close(sync);
});

test('line endings, unsupported characters, read-only access and Git merges are respected', async () => {
  let merging = false;
  const t = await setup(server => { server.addDoc('main.tex', 'a\nb\n'); }, { busy: () => merging });
  t.write('main.tex', 'a\r\nb\r\n');
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.edit('main.tex', insert('b', 'c'));
  await until(() => t.read('main.tex') === 'a\r\nbc\r\n', 'CRLF kept');
  t.write('main.tex', 'a\r\nbc 😀\r\n');
  await until(() => t.server.text('main.tex') === 'a\nbc \uFFFD\uFFFD\n' && t.read('main.tex') === 'a\r\nbc \uFFFD\uFFFD\r\n', 'replacement characters on both sides');
  merging = true;
  await until(() => sync.state === 'paused', 'the pause');
  t.write('main.tex', 'a\r\n<<<<<<< ours\r\n');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(t.server.text('main.tex'), 'a\nbc \uFFFD\uFFFD\n');
  t.write('main.tex', 'a\r\nbc resolved\r\n');
  merging = false;
  await until(() => sync.state === 'synced' && t.server.text('main.tex') === 'a\nbc resolved\n', 'resume after the merge', 15000);
  await t.close(sync);
});

test('a read-only project only receives', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'shared\n'); server.permissions = 'readOnly'; });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  assert.equal(sync.status('paper').readOnly, true);
  t.write('main.tex', 'shared\nmine\n');
  t.write('extra.tex', 'x');
  t.server.edit('main.tex', () => [{ p: 0, i: 'very ' }]);
  await until(() => t.read('main.tex') === 'very shared\nmine\n', 'the remote edit around local ones');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(t.server.text('main.tex'), 'very shared\n');
  assert.deepEqual(t.server.requests, []);
  await t.close(sync);
});

test('a refused upgrade is retried at once, and an expired session waits for a new sign-in', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Hello\n'); server.failUpgrades = 2; });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the sync after two refused upgrades', 4000);
  // The session expires on Overleaf.
  t.server.session = 'session-renewed';
  t.server.disconnectAll();
  await until(() => sync.state === 'signed-out', 'the signed-out state', 15000);
  t.write('main.tex', 'Hello again\n');
  t.store.saveAccount({ ...t.store.account(t.server.origin)!, cookies: { overleaf_session2: 'session-renewed' } });
  sync.retry();
  await until(() => sync.state === 'synced' && t.server.text('main.tex') === 'Hello again\n', 'the sync after signing in again', 15000);
  await t.close(sync);
});

test('edits go as tracked changes while Overleaf tracks this author, and directly once it stops', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Draft\n'); server.trackChanges = { [server.userId]: true }; });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  assert.equal(sync.status('paper').tracking, true);
  t.write('main.tex', 'Draft two\n');
  await until(() => t.server.text('main.tex') === 'Draft two\n', 'the tracked edit');
  assert.match(t.server.seeds.at(-1) || '', /^[0-9a-f]{18}$/);
  t.server.broadcast('toggle-track-changes', [false]);
  await until(() => !sync.status('paper').tracking, 'track changes off');
  t.write('main.tex', 'Draft three\n');
  await until(() => t.server.text('main.tex') === 'Draft three\n', 'the direct edit');
  assert.equal(t.server.seeds.at(-1), undefined);
  await t.close(sync);
});
