import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, until } from './fixtures/overleaf-sync-setup.ts';

test('a missing or emptied folder and symbolic links never delete files on Overleaf', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('sections/intro.tex', 'Intro\n'); server.addFile('fig.png', Buffer.from([1, 2, 3])); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  const paths = t.server.paths();
  // The folder is moved away, as in Finder, or its disk unmounted.
  fs.renameSync(t.root, t.root + '-moved');
  await until(() => sync.state === 'paused', 'the pause for the missing folder');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.deepEqual(t.server.paths(), paths);
  fs.renameSync(t.root + '-moved', t.root);
  await until(() => sync.state === 'synced', 'the sync once the folder is back', 15000);
  // A synced folder replaced by a link to one elsewhere stays on Overleaf.
  const shared = path.join(path.dirname(t.root), 'shared-sections');
  fs.renameSync(path.join(t.root, 'sections'), shared);
  fs.symlinkSync(shared, path.join(t.root, 'sections'));
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.deepEqual(t.server.paths(), paths);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
  await t.close(sync);
});

test('the connection can drop while reconciling, and syncing picks up again', async () => {
  let dropped = false;
  const t = await setup(server => {
    server.addDoc('main.tex', 'Hello\n'); server.addFile('fig.png', Buffer.from([1, 2, 3]));
    server.before = async (_method, route) => { if (!dropped && route.includes('/file/')) { dropped = true; server.disconnectAll(); await new Promise(resolve => setTimeout(resolve, 200)); } };
  });
  const sync = t.sync().start();
  await until(() => dropped && sync.state === 'synced' && t.server.clients.size === 1, 'the sync after the drop', 15000);
  t.write('main.tex', 'Hello local\n');
  t.server.edit('main.tex', () => [{ p: 0, i: 'Remote ' }]);
  await until(() => t.server.text('main.tex') === 'Remote Hello local\n' && t.read('main.tex') === 'Remote Hello local\n', 'convergence after the drop', 15000);
  await t.close(sync);
});

test('an edit Overleaf applies late, after a reconnect, is not applied twice', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'alpha\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.deferUpdate = true;
  t.write('main.tex', 'alpha beta\n');
  await until(() => t.server.deferred !== null, 'the edit held by Overleaf');
  t.server.disconnectAll();
  await until(() => t.server.text('main.tex') === 'alpha beta\n' && sync.status('paper').state === 'synced', 'the late edit applied once', 20000);
  t.write('main.tex', 'alpha beta\ngamma\n');
  await until(() => t.server.text('main.tex') === 'alpha beta\ngamma\n', 'the next edit');
  assert.equal(t.read('main.tex'), 'alpha beta\ngamma\n');
  await t.close(sync);
});

test('an edit Overleaf never confirms is sent again', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'one\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.dropUpdate = true;
  t.write('main.tex', 'one two\n');
  await until(() => t.server.text('main.tex') === 'one two\n' && sync.status('paper').state === 'synced', 'the resent edit', 12000);
  await t.close(sync);
});

test('stopping while connecting leaves the folder and the link alone', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Remote\n'); server.before = async (_method, route) => { if (route === `/project/${server.projectId}`) await new Promise(resolve => setTimeout(resolve, 500)); }; });
  const sync = t.sync().start();
  await new Promise(resolve => setTimeout(resolve, 100));
  await sync.stop();
  t.store.removeLink(t.link.id);
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(t.read('main.tex'), undefined);
  assert.equal(t.server.clients.size, 0);
  assert.equal(t.store.link(t.link.id), undefined);
  await t.close();
});

test('a coauthor moving a file to a name this folder does not sync keeps it on Overleaf', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.addDoc('latexmkrc', '$pdf_mode = 5;\n'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced' && t.read('latexmkrc') !== undefined, 'the first sync');
  t.server.rename('latexmkrc', '.latexmkrc');
  await until(() => t.read('latexmkrc') === undefined, 'the file leaving the folder');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.deepEqual(t.server.paths(), ['.latexmkrc', 'main.tex']);
  assert.ok(!t.server.requests.some(request => request.startsWith('DELETE')));
  assert.deepEqual(sync.status('paper').conflicts.map(conflict => conflict.path), ['latexmkrc'], 'kept to put back');
  await t.close(sync);
});

test('characters Overleaf already stores stay, and files created while reconciling are uploaded', async () => {
  let written = false;
  const t = await setup(server => {
    server.addDoc('main.tex', 'Let $x \\in 𝔸$.\n'); server.addFile('fig.png', Buffer.from([1, 2, 3]));
    server.before = async (_method, route) => { if (!written && route.includes('/file/')) { written = true; fs.writeFileSync(path.join(t.root, 'new-figure.png'), Buffer.from([9, 9, 9])); } };
  });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced' && t.server.paths().includes('new-figure.png'), 'the upload of the file made meanwhile');
  assert.equal(t.read('main.tex'), 'Let $x \\in 𝔸$.\n');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(t.server.text('main.tex'), 'Let $x \\in 𝔸$.\n');
  await t.close(sync);
});

test('a file Overleaf refuses is set aside without holding up the rest', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Main\n'); server.failUpload.add('data.bin'); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.write('data.bin', Buffer.from([0, 1, 2, 3]));
  t.write('new.tex', 'New\n');
  await until(() => t.server.text('new.tex') === 'New\n' && sync.status('paper').skipped.includes('data.bin'), 'the other upload');
  t.write('main.tex', 'Main edited\n');
  await until(() => t.server.text('main.tex') === 'Main edited\n', 'later edits');
  await t.close(sync);
});

test('history-ot edits go as tracked changes while Overleaf tracks this author', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'keep this word please', 'history-ot'); server.trackChanges = true; });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.write('main.tex', 'keep this please');
  await until(() => t.server.text('main.tex') === 'keep this please', 'the tracked deletion');
  const doc = t.server.byPath('main.tex')!.entity as unknown as { text: { content: string; deleted: Uint8Array } };
  assert.equal(doc.text.content, 'keep this word please', 'the removed word stays as a suggestion');
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(t.read('main.tex'), 'keep this please');
  await t.close(sync);
});

test('a file rewritten through an empty moment never empties Overleaf, and a rename of case only holds', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'Some text\n'); server.addFile('fig.png', Buffer.from([1, 2, 3])); });
  const sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  let emptied = false;
  const watch = setInterval(() => { if (t.server.text('main.tex') === '') emptied = true; }, 10);
  // An editor that truncates the file and writes it again.
  t.write('main.tex', '');
  await new Promise(resolve => setTimeout(resolve, 600));
  t.write('main.tex', 'Some new text\n');
  await until(() => t.server.text('main.tex') === 'Some new text\n', 'the rewritten file');
  clearInterval(watch);
  assert.equal(emptied, false);
  t.server.rename('fig.png', 'Fig.png');
  await until(() => fs.readdirSync(t.root).includes('Fig.png'), 'the case change here');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.deepEqual(t.server.paths(), ['Fig.png', 'main.tex']);
  assert.ok(fs.readdirSync(t.root).includes('Fig.png'));
  await t.close(sync);
});
