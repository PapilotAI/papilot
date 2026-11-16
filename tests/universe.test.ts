import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PaperCreations } from '../src/server/create-paper.ts';
import { Universe, templateChoice, universeBase } from '../src/server/universe.ts';
import type { Project } from '../src/shared.ts';

const BASE = 'https://universe.test/universe/';
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Stored entries are enough for the reader; names are written verbatim so unsafe ones can be tested.
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), body = Buffer.from(text), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, body); centrals.push(central, filename);
    offset += local.length + filename.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const MAIN = '\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}\n';
function entry(id: string, archive: Buffer, extra: Record<string, unknown> = {}) {
  return {
    id, version: '1.0.0', name: 'Thesis', description: 'A thesis.', i18n: { 'zh-CN': { name: '学位论文' } },
    category: 'thesis', tags: ['thesis'], languages: ['zh'], organization: 'Example University', license: 'LPPL-1.3c',
    main: 'thesis.tex', engine: 'xelatex', page: `t/${id}/`, thumbnail: `v1/templates/${id}/1.0.0/thumbnail.png`,
    archive: { url: `v1/templates/${id}/1.0.0.zip`, sha256: createHash('sha256').update(archive).digest('hex'), size: archive.length },
    ...extra,
  };
}
function universe(t: TestContext, files: Record<string, Buffer | null>, index?: unknown) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url === BASE + 'v1/index.json') return index === undefined ? new Response('missing', { status: 404 }) : Response.json(index);
    const body = files[url.slice(BASE.length)];
    if (body === null) throw new TypeError('fetch failed');
    return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
  }) as typeof fetch;
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-universe-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'papers'); fs.mkdirSync(parent);
  const register = async (root: string, name: string): Promise<Project> => ({ id: randomUUID(), name, path: root, createdAt: Date.now() });
  const client = new Universe(BASE, fetcher);
  return { client, calls, parent, register, creations: new PaperCreations(path.join(directory, 'data'), client) };
}

test('index keeps valid templates under the Universe base and caches the list', async t => {
  const archive = zip({ 'thesis.tex': MAIN });
  const index = { schema: 1, templates: [
    entry('thesis', archive),
    entry('elsewhere', archive, { archive: { url: 'https://example.com/x.zip', sha256: 'a'.repeat(64), size: 10 } }),
    entry('Bad_ID', archive),
    entry('thesis', archive, { name: 'Duplicate' }),
    { id: 'broken' },
    entry('pldi', archive, { name: 'PLDI', category: 'conference', template: 'thesis', venue: { name: 'PLDI', ccf: 'A', area: 'se', full: 'Programming Language Design and Implementation', basis: 'high' } }),
    entry('popl', archive, { name: 'POPL', category: 'conference', template: '../x', venue: { name: 'POPL', year: 'soon', ccf: 'S' } }),
  ] };
  const f = universe(t, {}, index);
  const templates = await f.client.templates();
  assert.deepEqual(templates.map(item => item.id), ['thesis', 'pldi', 'popl']);
  // A conference keeps its CCF data and the template it reuses; a year is optional and bad values are dropped.
  assert.deepEqual(templates[1].venue, { name: 'PLDI', ccf: 'A', area: 'se', full: 'Programming Language Design and Implementation' });
  assert.equal(templates[1].template, 'thesis');
  assert.deepEqual(templates[2].venue, { name: 'POPL' });
  assert.equal(templates[2].template, undefined);
  assert.equal(templates[0].zh?.name, '学位论文');
  assert.equal(templates[0].thumbnail, BASE + 'v1/templates/thesis/1.0.0/thumbnail.png');
  assert.equal(templates[0].archive.url, BASE + 'v1/templates/thesis/1.0.0.zip');
  await f.client.templates();
  assert.equal(f.calls.length, 1, 'A fresh list is reused');
  const offline = universe(t, {});
  await assert.rejects(offline.client.templates(), /Could not load templates/);
});

test('a template creates a committed paper with its main file and engine', async t => {
  const archive = zip({ 'thesis.tex': MAIN, 'chapters/intro.tex': 'Hello.\n', 'figures/logo.txt': 'logo' });
  const f = universe(t, { 'v1/templates/thesis/1.0.0.zip': archive }, { schema: 1, templates: [entry('thesis', archive)] });
  const project = await f.creations.create({ id: randomUUID(), name: '我的论文', parent: f.parent, template: { id: 'thesis', version: '1.0.0' } }, f.register);
  assert.equal(fs.readFileSync(path.join(project.path, 'chapters/intro.tex'), 'utf8'), 'Hello.\n');
  assert.deepEqual(git(project.path, 'ls-files').split('\n').sort(), ['.gitignore', 'chapters/intro.tex', 'figures/logo.txt', 'thesis.tex']);
  assert.equal(git(project.path, 'log', '--format=%s'), 'Create paper from Thesis (thesis 1.0.0) in Papilot');
  assert.equal(git(project.path, 'status', '--porcelain'), '');
  const settings = JSON.parse(fs.readFileSync(path.join(project.path, '.git/papilot/settings.json'), 'utf8'));
  assert.equal(settings.main, 'thesis.tex'); assert.equal(settings.engine, 'xelatex');
});

test('failed downloads, bad checksums, unsafe names and withdrawn versions leave no folder', async t => {
  const good = zip({ 'thesis.tex': MAIN }), unsafe = zip({ 'thesis.tex': MAIN, '../escape.tex': 'x' });
  const index = { schema: 1, templates: [entry('thesis', good), entry('tampered', good), entry('offline', good), entry('unsafe', unsafe), entry('nomain', zip({ 'other.tex': MAIN }))] };
  const f = universe(t, { 'v1/templates/thesis/1.0.0.zip': good, 'v1/templates/tampered/1.0.0.zip': zip({ 'thesis.tex': MAIN + '%' }), 'v1/templates/offline/1.0.0.zip': null, 'v1/templates/unsafe/1.0.0.zip': unsafe, 'v1/templates/nomain/1.0.0.zip': zip({ 'other.tex': MAIN }) }, index);
  const create = (id: string, version = '1.0.0') => f.creations.create({ id: randomUUID(), name: 'Paper ' + id, parent: f.parent, template: { id, version } }, f.register);
  await assert.rejects(create('tampered'), /checksum/);
  await assert.rejects(create('offline'), /Could not download the template/);
  await assert.rejects(create('unsafe'), /could not be read/);
  await assert.rejects(create('nomain'), /missing its main file/);
  await assert.rejects(create('thesis', '0.9.0'), /no longer available/);
  await assert.rejects(create('missing'), /no longer available/);
  assert.deepEqual(fs.readdirSync(f.parent), [], 'Nothing is written before the template is verified');
  await assert.rejects(f.creations.create({ id: randomUUID(), name: 'x', parent: f.parent, template: { id: '../x', version: '1' } }, f.register), /Choose a template/);
  await assert.rejects(new PaperCreations(path.join(f.parent, '..', 'other-data')).create({ id: randomUUID(), name: 'x', parent: f.parent, template: { id: 'thesis', version: '1.0.0' } }, f.register), /not available/);
});

test('template choices and the Universe address are validated', () => {
  assert.equal(templateChoice(undefined), undefined);
  assert.deepEqual(templateChoice({ id: 'neurips', version: '2026' }), { id: 'neurips', version: '2026' });
  assert.throws(() => templateChoice({ id: 'NeurIPS', version: '2026' }), /Choose a template/);
  assert.throws(() => templateChoice({ id: 'neurips', version: 'latest' }), /Choose a template/);
  assert.equal(universeBase(undefined), 'https://papilot.ai/universe/');
  assert.equal(universeBase('http://127.0.0.1:4410/universe'), 'http://127.0.0.1:4410/universe/');
  assert.throws(() => universeBase('http://example.com/universe/'), /https/);
});
