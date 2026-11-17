import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NEW_PAPER_SOURCE, EXAMPLE_PAPER_SOURCE, PaperCreations, newPaperName } from '../src/server/create-paper.ts';
import type { Project } from '../src/shared.ts';
import { Manuscripts } from '../src/server/manuscript.ts';

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t: TestContext) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-create-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'papers'), data = path.join(directory, 'data'); fs.mkdirSync(parent);
  const projects = new Map<string, Project>(); let calls = 0;
  const register = async (root: string, name: string) => {
    calls++;
    if (!projects.has(root)) projects.set(root, { id: randomUUID(), name, path: root, createdAt: Date.now() });
    return projects.get(root)!;
  };
  return { directory, parent, data, creations: new PaperCreations(data), projects, register, calls: () => calls };
}

test('new paper has portable source and its own clean Git history, including Unicode names', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: '研究论文 % draft', parent: f.parent };
  const project = await f.creations.create(input, f.register);
  assert.equal(project.name, input.name);
  assert.equal(project.path, path.join(f.parent, input.name));
  assert.equal(fs.readFileSync(path.join(project.path, 'main.tex'), 'utf8'), NEW_PAPER_SOURCE);
  assert.equal(/[^\x00-\x7f]/.test(NEW_PAPER_SOURCE), false, 'A Unicode label does not require a Unicode TeX engine');
  assert.equal(git(project.path, 'log', '-1', '--format=%s'), 'Create paper in Papilot');
  assert.equal(git(project.path, 'status', '--porcelain'), '');
  assert.deepEqual(git(project.path, 'ls-files').split('\n'), ['.gitignore', 'main.tex']);
  fs.writeFileSync(path.join(project.path, 'main.pdf'), 'compiled output');
  assert.equal(git(project.path, 'status', '--porcelain'), '');
  assert.equal(f.creations.busy, false);
});

test('same request joins an in-flight creation and survives response loss and restart without rewriting source', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Retry paper', parent: f.parent };
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let reached!: () => void;
  const registering = new Promise<void>(resolve => { reached = resolve; });
  const register = async (root: string, name: string) => { reached(); await gate; return f.register(root, name); };
  const first = f.creations.create(input, register), second = f.creations.create(input, register);
  await registering;
  assert.equal(f.creations.busy, true);
  await assert.rejects(f.creations.create({ ...input, name: 'Changed' }, register), /another paper/);
  finish();
  const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.equal(f.calls(), 1);
  const edited = NEW_PAPER_SOURCE + '% User work after creation\n'; fs.writeFileSync(path.join(a.path, 'main.tex'), edited);
  const recovered = new PaperCreations(f.data);
  assert.deepEqual(await recovered.create(input, f.register), a);
  assert.equal(fs.readFileSync(path.join(a.path, 'main.tex'), 'utf8'), edited);
  await assert.rejects(recovered.create({ ...input, name: 'Changed' }, f.register), /another paper/);
  assert.equal(f.projects.size, 1);
});

test('example projects have sample sections and cannot reuse a blank creation receipt', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Example', parent: f.parent, example: true };
  const project = await f.creations.create(input, f.register);
  assert.equal(fs.readFileSync(path.join(project.path, 'main.tex'), 'utf8'), EXAMPLE_PAPER_SOURCE);
  assert.match(EXAMPLE_PAPER_SOURCE, /\\section\{Introduction\}/);
  assert.doesNotMatch(NEW_PAPER_SOURCE, /\\section/);
  assert.equal((await new PaperCreations(f.data).create(input, f.register)).id, project.id);
  await assert.rejects(f.creations.create({ ...input, example: false }, f.register), /another paper/);
  await assert.rejects(f.creations.create({ ...input, id: randomUUID(), example: 'yes' }, f.register), /one paper source/);
  await assert.rejects(f.creations.create({ ...input, id: randomUUID(), template: { id: 'example', version: '1' } }, f.register), /one paper source/);
});

test('existing files, folders and symlinks are never overwritten or adopted by another request', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.parent, 'Existing'));
  fs.writeFileSync(path.join(f.parent, 'Existing', 'main.tex'), 'keep me');
  fs.writeFileSync(path.join(f.parent, 'File'), 'keep file');
  for (const name of ['Existing', 'File']) await assert.rejects(f.creations.create({ id: randomUUID(), name, parent: f.parent }, f.register), /already exists/);
  const first = await f.creations.create({ id: randomUUID(), name: 'Created', parent: f.parent }, f.register);
  await assert.rejects(f.creations.create({ id: randomUUID(), name: 'Created', parent: f.parent }, f.register), /already exists/);
  if (process.platform !== 'win32') {
    fs.symlinkSync(first.path, path.join(f.parent, 'Link'), 'dir');
    await assert.rejects(f.creations.create({ id: randomUUID(), name: 'Link', parent: f.parent }, f.register), /already exists/);
  }
  assert.equal(fs.readFileSync(path.join(f.parent, 'Existing', 'main.tex'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(f.parent, 'File'), 'utf8'), 'keep file');
  assert.equal(f.projects.size, 1);
});

test('invalid names and save paths leave no project directories', async t => {
  const f = fixture(t);
  for (const name of ['', '..', '.', '../escape', 'a/b', 'a\\b', 'C:paper', 'CON', 'nul.tex', 'LPT1', 'com².log', 'trailing.', 'a*', 'a?', 'a|b', '\u0000x', 'a'.repeat(121)]) {
    assert.throws(() => newPaperName(name));
    await assert.rejects(f.creations.create({ id: randomUUID(), name, parent: f.parent }, f.register));
  }
  for (const parent of ['relative', path.join(f.directory, 'missing')]) await assert.rejects(f.creations.create({ id: randomUUID(), name: 'Valid', parent }, f.register));
  fs.writeFileSync(path.join(f.directory, 'file'), 'preserve');
  await assert.rejects(f.creations.create({ id: randomUUID(), name: 'Valid', parent: path.join(f.directory, 'file') }, f.register), /existing folder/);
  assert.deepEqual(fs.readdirSync(f.parent), []); assert.equal(f.calls(), 0);
});

test('failed preparation rolls back its own new directory and permits retry', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Retry', parent: f.parent };
  // A parent repository must never be changed or accidentally committed.
  git(f.parent, 'init', '-q'); fs.writeFileSync(path.join(f.parent, 'keep.txt'), 'author content');
  await assert.rejects(f.creations.create(input, f.register), /parent Git repository/);
  assert.equal(fs.existsSync(path.join(f.parent, 'Retry')), false);
  assert.equal(fs.readFileSync(path.join(f.parent, 'keep.txt'), 'utf8'), 'author content');
  assert.equal(git(f.parent, 'status', '--porcelain'), '?? keep.txt');
  assert.equal(f.creations.busy, false);
  fs.rmSync(path.join(f.parent, '.git'), { recursive: true });
  assert.equal((await f.creations.create(input, f.register)).name, 'Retry');
});

test('registration failure leaves a prepared paper that can safely retry', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Retry register', parent: f.parent };
  await assert.rejects(f.creations.create(input, async () => { throw new Error('Temporary registration error'); }), /registration error/);
  const root = path.join(f.parent, input.name), head = git(root, 'rev-parse', 'HEAD');
  const recovered = new PaperCreations(f.data);
  const paper = await recovered.create(input, f.register);
  assert.equal(paper.path, root); assert.equal(git(root, 'rev-parse', 'HEAD'), head);
});

test('unwritable save location reports an actionable error and can retry', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Retry permissions', parent: f.parent };
  fs.chmodSync(f.parent, 0o500);
  try { await assert.rejects(f.creations.create(input, f.register), /permissions/); }
  finally { fs.chmodSync(f.parent, 0o700); }
  assert.deepEqual(fs.readdirSync(f.parent), []);
  assert.equal((await f.creations.create(input, f.register)).name, input.name);
});


test('a failed resumed creation preserves user files and modified starter source', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Interrupted', parent: f.parent }, root = path.join(f.parent, input.name);
  git(f.parent, 'init', '-q');
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'main.tex'), 'User draft'); fs.writeFileSync(path.join(root, 'notes.txt'), 'User notes');
  fs.mkdirSync(path.join(f.data, 'paper-creations'), { recursive: true });
  const stat = fs.lstatSync(root);
  fs.writeFileSync(path.join(f.data, 'paper-creations', input.id + '.json'), JSON.stringify({ ...input, root, dev: stat.dev, ino: stat.ino, prepared: false }));
  await assert.rejects(f.creations.create(input, f.register), /Paper files were kept at/);
  assert.equal(fs.readFileSync(path.join(root, 'main.tex'), 'utf8'), 'User draft');
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'User notes');
  fs.rmSync(path.join(f.parent, '.git'), { recursive: true });
  assert.equal((await f.creations.create(input, f.register)).path, root);
  assert.equal(fs.readFileSync(path.join(root, 'main.tex'), 'utf8'), 'User draft');
});


test('the created minimal paper compiles through the normal manuscript workspace', { timeout: 60000 }, async t => {
  try { execFileSync('latexmk', ['--version']); execFileSync('pdflatex', ['--version']); } catch { t.skip('needs TeX Live'); return; }
  const f = fixture(t), manuscripts = new Manuscripts();
  const project = await f.creations.create({ id: randomUUID(), name: '论文 starter', parent: f.parent }, f.register);
  let state = await manuscripts.state(project.id, project.path);
  const deadline = Date.now() + 45000;
  while (state.build.status === 'building' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25)); state = await manuscripts.state(project.id, project.path);
  }
  assert.equal(state.build.status, 'ready', state.build.error);
  assert.equal(git(project.path, 'status', '--porcelain'), '', 'Workspace compilation does not dirty the initial paper');
});

test('missing Git leaves no partial paper and gives an installation instruction', async t => {
  const f = fixture(t), input = { id: randomUUID(), name: 'Without Git', parent: f.parent }, originalPath = process.env.PATH;
  process.env.PATH = f.directory;
  try { await assert.rejects(f.creations.create(input, f.register), /Install Git.*retry/); }
  finally { process.env.PATH = originalPath; }
  assert.deepEqual(fs.readdirSync(f.parent), []);
  assert.equal((await f.creations.create(input, f.register)).name, input.name);
});
