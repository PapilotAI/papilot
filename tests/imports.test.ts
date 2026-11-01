import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PaperImports, inspectPaper, prepareRepository, texFiles } from '../src/server/imports.ts';
import { Manuscripts } from '../src/server/manuscript.ts';

const source = '\\documentclass{article}\n\\begin{document}\nHello paper.\n\\end{document}\n';
const data = (text: string) => Buffer.from(text).toString('base64');
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-import-'))), root = path.join(directory, 'original'); fs.mkdirSync(root);
  const manuscripts = new Manuscripts(); let result: 'ready' | 'failed' = 'failed', calls = 0;
  manuscripts.state = async () => { calls++; return { git: {} as any, build: { status: result, current: result === 'ready', error: result === 'failed' ? 'Missing package.sty' : undefined } }; };
  const imports = new PaperImports(manuscripts, path.join(directory, 'data'));
  return { directory, root, imports, manuscripts, calls: () => calls, ready: () => { result = 'ready'; }, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
async function settled(imports: PaperImports, id: string, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = imports.get(id); if (!['building', 'repairing'].includes(value.phase)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Import did not settle');
}
// Construct a stored ZIP so malicious names can be tested without trusting an archiver.
function archive(name: string, text = source, mode = 0o100644, size?: number) {
  const filename = Buffer.from(name), body = Buffer.from(text), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size ?? body.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size ?? body.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + body.length, 16);
  return Buffer.concat([local, filename, body, central, filename, end]);
}

test('folder upload preserves binary assets, unwraps export folder, and detects nested mains', async () => {
  const f = fixture();
  try {
    const binary = Buffer.from([0, 255, 4, 0, 128]);
    const value = await f.imports.create({ name: 'My paper', files: [{ path: 'export/docs/main.tex', data: data(source) }, { path: 'export/figures/image.png', data: binary.toString('base64') }, { path: 'export/.git/config', data: data('never import git config') }, { path: 'export/.GIT/hooks/post-checkout', data: data('never import hooks') }] });
    assert.equal(value.main, 'docs/main.tex'); assert.equal(value.name, 'My paper'); assert.equal(value.copied, true);
    assert.deepEqual(fs.readFileSync(path.join(value.path, 'figures/image.png')), binary);
    assert.equal(fs.existsSync(path.join(value.path, '.git')), false);
    assert.equal((await f.imports.build(value.id, {})).phase, 'building');
    const failed = await settled(f.imports, value.id); assert.equal(failed.phase, 'failed'); assert.equal(failed.versioned, true);
    assert.ok(git(value.path, 'rev-parse', 'HEAD')); assert.equal(f.calls(), 1);
    const recovered = new PaperImports(f.manuscripts, path.join(f.directory, 'data')); assert.equal(recovered.get(value.id).error, 'Missing package.sty');
    f.ready(); await recovered.build(value.id, {}); assert.equal((await settled(recovered, value.id)).phase, 'ready');
    const project = { id: 'paper', path: value.path, name: value.name, createdAt: 1 };
    assert.deepEqual(await recovered.finish(value.id, async () => project), project);
    assert.deepEqual(await recovered.finish(value.id, async () => project), project, 'Finalization is retryable');
  } finally { f.close(); }
});

test('ZIP import unwraps source and rejects traversal, symlinks, oversized and invalid archives', async () => {
  const f = fixture();
  try {
    const value = await f.imports.create({ zip: archive('export/main.tex').toString('base64') }); assert.equal(value.main, 'main.tex');
    for (const zip of [archive('../outside.tex'), archive('/absolute.tex'), archive('link.tex', 'outside', 0o120777), archive('large.tex', '', 0o100644, 70 * 1024 * 1024), Buffer.from('not a zip')]) {
      await assert.rejects(f.imports.create({ zip: zip.toString('base64') }));
    }
    assert.equal(fs.readdirSync(path.join(f.directory, 'data/papers')).length, 1, 'Failed uploads leave no partial copies');
    assert.equal(fs.existsSync(path.join(f.directory, 'outside.tex')), false);
    await assert.rejects(f.imports.create({ files: [{ path: '../outside.tex', data: data(source) }] }));
    await assert.rejects(f.imports.create({ files: [{ path: 'a.tex', data: '%%%=' }] }));
  } finally { f.close(); }
});

test('ambiguous mains need a choice; engine hints and existing configuration are honored', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'a.tex'), source); fs.writeFileSync(path.join(f.root, 'b.tex'), source);
    let value = await inspectPaper(f.root); assert.equal(value.main, ''); assert.equal(value.candidates.length, 2);
    fs.writeFileSync(path.join(f.root, '.latex-review.json'), JSON.stringify({ main: 'b.tex', engine: 'lualatex', partial_builds: false }));
    value = await inspectPaper(f.root); assert.equal(value.main, 'b.tex'); assert.equal(value.engine, 'lualatex');
    const imported = await f.imports.create({ path: f.root });
    await assert.rejects(f.imports.build(imported.id, { main: '../outside.tex' }), /existing/);
    await f.imports.build(imported.id, {}); await settled(f.imports, imported.id);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, '.latex-review.json'), 'utf8')).partial_builds, false);
  } finally { f.close(); }
});

test('local folders can exceed upload limits and inspection leaves their files untouched', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'main.tex'), source);
    const assets = path.join(f.root, 'assets'); fs.mkdirSync(assets);
    for (let index = 0; index < 5001; index++) fs.writeFileSync(path.join(assets, `${index}.dat`), '');
    // A large sparse asset must not be read into an upload buffer.
    const large = path.join(assets, 'large.dat'); fs.writeFileSync(large, ''); fs.truncateSync(large, 65 * 1024 * 1024);
    const value = await f.imports.create({ path: f.root });
    assert.equal(value.path, f.root); assert.equal(value.copied, false); assert.equal(value.main, 'main.tex');
    assert.equal(value.phase, 'choose'); assert.equal(value.error, undefined); assert.equal(f.calls(), 0);
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['assets', 'main.tex']);
    assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), source);
    assert.equal(fs.statSync(large).size, 65 * 1024 * 1024);
    // Compilation validates the same folder without reintroducing the scan cap.
    f.ready(); await f.imports.build(value.id, {});
    assert.equal((await settled(f.imports, value.id)).phase, 'ready');
  } finally { f.close(); }
});

test('main files deeper than twenty folders are discoverable without following symlinks', async () => {
  const f = fixture();
  try {
    const main = [...Array(22).fill('chapter'), 'main.tex'].join('/');
    fs.mkdirSync(path.dirname(path.join(f.root, main)), { recursive: true });
    fs.writeFileSync(path.join(f.root, main), source);
    fs.symlinkSync(f.root, path.join(f.root, 'loop'), 'dir');
    fs.symlinkSync(path.join(f.root, main), path.join(f.root, 'linked.tex'));
    assert.deepEqual(texFiles(f.root), [main]);
    assert.equal((await f.imports.create({ path: f.root })).main, main);
  } finally { f.close(); }
});

test('existing repositories retain commits, staged edits and Git identity during import', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'main.tex'), source); await prepareRepository(f.root);
    const head = git(f.root, 'rev-parse', 'HEAD'); fs.writeFileSync(path.join(f.root, 'main.tex'), source + '% staged\n'); git(f.root, 'add', 'main.tex');
    const index = git(f.root, 'write-tree'); fs.appendFileSync(path.join(f.root, 'main.tex'), '% unstaged\n');
    const original = fs.readFileSync(path.join(f.root, 'main.tex'));
    const value = await f.imports.create({ path: f.root }); await f.imports.build(value.id, {}); await settled(f.imports, value.id);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'write-tree'), index); assert.deepEqual(fs.readFileSync(path.join(f.root, 'main.tex')), original);
    assert.throws(() => git(f.root, 'config', '--local', 'user.name'));
  } finally { f.close(); }
});

test('parent repositories are refused before changing source and empty Git repositories are prepared', async () => {
  const f = fixture();
  try {
    git(f.root, 'init'); const nested = path.join(f.root, 'nested'); fs.mkdirSync(nested); fs.writeFileSync(path.join(nested, 'main.tex'), source);
    const value = await f.imports.create({ path: nested }); await f.imports.build(value.id, {});
    assert.match((await settled(f.imports, value.id)).error!, /parent Git/); assert.equal(fs.existsSync(path.join(nested, '.latex-review.json')), false);
    fs.writeFileSync(path.join(f.root, 'main.tex'), source); await prepareRepository(f.root); assert.ok(git(f.root, 'rev-parse', 'HEAD'));
  } finally { f.close(); }
});

test('repair runs once, preserves baseline and retries compilation; unavailable helpers leave a recoverable import', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'main.tex'), source);
    const value = await f.imports.create({ path: f.root }); await f.imports.build(value.id, {}); await settled(f.imports, value.id);
    const head = git(f.root, 'rev-parse', 'HEAD'); let repairs = 0;
    const repair = async (root: string, error: string) => { repairs++; assert.equal(error, 'Missing package.sty'); fs.appendFileSync(path.join(root, 'main.tex'), '% fixed\n'); f.ready(); return 'Restored the missing package.'; };
    await Promise.all([f.imports.build(value.id, {}, repair), f.imports.build(value.id, {}, repair)]);
    const ready = await settled(f.imports, value.id); assert.equal(repairs, 1); assert.equal(ready.phase, 'ready'); assert.match(ready.summary!, /Restored/); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.match(git(f.root, 'status', '--porcelain'), /main.tex/);
    await f.imports.build(value.id, {}, async () => { throw new Error('Sign in to an assistant.'); });
    assert.match((await settled(f.imports, value.id)).error!, /Sign in/);
    assert.equal((await f.imports.finish(value.id, async (root, name) => ({ id: 'p', path: root, name, createdAt: 1 }))).path, f.root);
  } finally { f.close(); }
});

test('a real imported paper compiles with the manuscript builder', { timeout: 60000 }, async t => {
  try { execFileSync('latexmk', ['--version']); execFileSync('pdflatex', ['--version']); } catch { t.skip('needs TeX Live'); return; }
  const f = fixture();
  try {
    const imports = new PaperImports(new Manuscripts(), path.join(f.directory, 'real'));
    const value = await imports.create({ zip: archive('main.tex').toString('base64') });
    // A real TeX build can exceed the mock tests' six-second wait on busy CI
    // or while packaging the desktop app. Do not remove its files mid-build.
    await imports.build(value.id, {}); const ready = await settled(imports, value.id, 45000); assert.equal(ready.phase, 'ready', ready.error);
  } finally { f.close(); }
});
