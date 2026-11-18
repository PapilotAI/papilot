import test from 'node:test';
import assert from 'node:assert/strict';
import { carry, tidy, type Span } from '../src/server/overleaf/authors.ts';
import { PaperSync } from '../src/server/overleaf/engine.ts';
import { insert, setup, until } from './fixtures/overleaf-sync-setup.ts';

const span = (from: number, to: number, user = 'ada', at = 1): Span => ({ from, to, user, at });
const words = (text: string, spans: Span[]) => spans.map(item => `${item.user}:${text.slice(item.from, item.to)}`);

test('who wrote what moves with the text around it', () => {
  // "Hello brave world": Ada wrote "brave ".
  const before = 'Hello brave world', spans = [span(6, 12)];
  // Text typed before, after and inside her words belongs to no one.
  let after = 'Oh, Hello brave world!';
  assert.deepEqual(words(after, carry(before, after, spans)), ['ada:brave ']);
  after = 'Hello bravest world';
  assert.deepEqual(words(after, carry(before, after, spans)), ['ada:brave', 'ada: ']);
  // Removing part of her words takes that part away; removing all of them, the span.
  after = 'Hello bra world';
  assert.deepEqual(words(after, carry(before, after, spans)), ['ada:bra ']);
  assert.deepEqual(carry(before, 'Hello world', spans), []);
  // A replacement over her words is the new writer's.
  after = 'Hello stoic world';
  assert.deepEqual(words(after, carry(before, after, spans, 'grace', 2)), ['grace:stoic', 'ada: ']);
  // Her own next edit joins the words she already wrote.
  after = 'Hello brave new world';
  assert.deepEqual(words(after, carry(before, after, spans, 'ada', 3)), ['ada:brave new ']);
  assert.equal(carry(before, after, spans, 'ada', 3)[0].at, 3);
  // Unchanged text keeps its spans as they are.
  assert.equal(carry(before, before, spans), spans);
  assert.deepEqual(tidy([span(4, 6), span(0, 2), span(2, 4), span(6, 6), span(6, 8, 'grace')]), [span(0, 6), span(6, 8, 'grace')]);
});

test('a coauthor’s words are theirs in the file, through edits and restarts, and the author’s are not', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'The quick fox\njumps.\n'); });
  let sync = t.sync().start();
  await until(() => sync.state === 'synced', 'the first sync');
  t.server.edit('main.tex', insert('quick ', 'brown '));
  await until(() => t.read('main.tex') === 'The quick brown fox\njumps.\n', 'the coauthor’s edit');
  const ada = (authors: { from: number; to: number; name: string; id: string; you?: boolean }[], text: string) => authors.map(item => `${item.name}${item.you ? ' (you)' : ''}:${text.slice(item.from, item.to)}`);
  // Her name comes from the project's members.
  let text = t.read('main.tex')!;
  assert.deepEqual(ada(sync.authors('main.tex', text), text), ['Ada Lovelace:brown ']);
  assert.equal(sync.authors('main.tex', text)[0].id, t.server.coauthor._id);
  // The author's typing before her words moves them and is not hers.
  t.write('main.tex', 'So, the quick brown fox\njumps.\n');
  await until(() => t.server.text('main.tex') === 'So, the quick brown fox\njumps.\n', 'the author’s edit on Overleaf');
  text = t.read('main.tex')!;
  assert.deepEqual(ada(sync.authors('main.tex', text), text), ['Ada Lovelace:brown ']);
  // An editor's unsaved text is answered as it reads, without changing what is kept.
  assert.deepEqual(ada(sync.authors('main.tex', 'X' + text), 'X' + text), ['Ada Lovelace:brown ']);
  // The author's own edits made on Overleaf in a browser say so.
  t.server.edit('main.tex', insert('jumps', ' high'), t.server.userId);
  await until(() => t.read('main.tex')!.includes('jumps high'), 'the author’s edit from a browser');
  text = t.read('main.tex')!;
  assert.deepEqual(ada(sync.authors('main.tex', text), text), ['Ada Lovelace:brown ', 'Author (you): high']);
  // What was written is kept with the link, and follows edits made while
  // Papilot was not running.
  await sync.stop();
  t.write('main.tex', 'Yes. ' + t.read('main.tex'));
  sync = t.sync(new PaperSync(t.link, t.root, t.store, { changed: () => {}, busy: () => false, ignored: async () => new Set(), status: () => {} })).start();
  await until(() => sync.state === 'synced' && t.server.text('main.tex')!.startsWith('Yes. '), 'the sync after a restart');
  text = t.read('main.tex')!;
  assert.deepEqual(ada(sync.authors('main.tex', text), text), ['Ada Lovelace:brown ', 'Author (you): high']);
  assert.deepEqual(sync.authors('other.tex', text), []);
  await t.close(sync);
});

test('who has the project open shows by account, with the file they are in, as they come, move and go', async () => {
  const t = await setup(server => { server.addDoc('main.tex', 'One\nTwo\n'); server.addDoc('intro.tex', 'Intro\n'); server.visit('P.grace', undefined, undefined, undefined, { _id: 'f'.repeat(24), first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' }); });
  let statuses = 0, moves = 0;
  const sync = t.sync(new PaperSync(t.link, t.root, t.store, { changed: () => {}, busy: () => false, ignored: async () => new Set(), status: () => { statuses++; }, presence: () => { moves++; } })).start();
  // Someone already there when Papilot connects is listed.
  await until(() => sync.status('paper').collaborators.length === 1, 'the connected users');
  assert.deepEqual(sync.status('paper').collaborators, [{ id: 'f'.repeat(24), name: 'Grace Hopper' }]);
  // A coauthor opening a file is listed with it, and their cursor with its line.
  t.server.visit('P.ada', 'intro.tex', 0, 3);
  await until(() => sync.status('paper').collaborators.length === 2, 'the coauthor');
  assert.deepEqual(sync.status('paper').collaborators[0], { id: t.server.coauthor._id, name: 'Ada Lovelace', file: 'intro.tex' });
  assert.deepEqual(sync.cursors(), [{ id: t.server.coauthor._id, name: 'Ada Lovelace', file: 'intro.tex', client: 'P.ada', line: 0, column: 3 }]);
  // Moving within the file moves the cursor without changing the list.
  const listed = statuses, moved = moves;
  t.server.visit('P.ada', 'intro.tex', 0, 5);
  await until(() => sync.cursors()[0]?.column === 5, 'the cursor move');
  assert.equal(statuses, listed);
  assert.ok(moves > moved);
  // Two windows of one account are one person, where they were last.
  t.server.visit('P.ada-2', 'main.tex', 1, 0);
  await until(() => sync.status('paper').collaborators.some(person => person.file === 'main.tex'), 'the second window');
  assert.equal(sync.status('paper').collaborators.length, 2);
  assert.equal(sync.cursors().length, 2);
  // This account in a browser is listed last, as the author.
  t.server.visit('P.browser', 'main.tex', 0, 0, { _id: t.server.userId, first_name: 'Author', last_name: '', email: 'author@example.com' });
  await until(() => sync.status('paper').collaborators.length === 3, 'the author’s browser');
  assert.deepEqual(sync.status('paper').collaborators.at(-1), { id: t.server.userId, name: 'Author', you: true, file: 'main.tex' });
  // Leaving takes them off.
  t.server.leave('P.ada'); t.server.leave('P.ada-2'); t.server.leave('P.browser'); t.server.leave('P.grace');
  await until(() => sync.status('paper').collaborators.length === 0, 'everyone leaving');
  assert.deepEqual(sync.cursors(), []);
  await t.close(sync);
});
