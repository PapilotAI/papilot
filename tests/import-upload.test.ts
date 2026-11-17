import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { PaperImports } from '../src/server/imports.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { guard } from '../src/server/access.ts';
import { registerImportUpload } from '../src/server/import-upload.ts';

const source = '\\documentclass{article}\n\\begin{document}Hello\\end{document}';
const boundary = 'papilot-upload-test';
const part = (name: string) => `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${encodeURIComponent(name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
const end = `\r\n--${boundary}--\r\n`;
async function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-stream-import-'));
  const imports = new PaperImports(new Manuscripts(), directory), app = Fastify();
  registerImportUpload(app, imports);
  await app.ready();
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const upload = (payload: Iterable<string | Buffer>, archive = false) => app.inject({ method: 'POST', url: `/api/imports/upload?archive=${archive}`, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Readable.from(payload) });
  return { directory, imports, upload };
}

test('multipart folder import streams more than 64 MiB and 5,000 files with nested paths', async t => {
  const f = await fixture(t), chunk = Buffer.alloc(1024 * 1024, 123);
  function* body() {
    yield part('paper/main.tex'); yield source;
    yield '\r\n' + part('paper/figures/large.bin');
    for (let index = 0; index < 65; index++) yield chunk;
    for (let index = 0; index < 5001; index++) { yield '\r\n' + part(`paper/assets/${index}.dat`); yield 'a'; }
    yield '\r\n' + part('paper/.git/config'); yield 'ignored';
    yield end;
  }
  const response = await f.upload(body());
  assert.equal(response.statusCode, 200, response.body);
  const value = response.json();
  assert.equal(value.main, 'main.tex'); assert.equal(value.copied, true);
  assert.equal(fs.statSync(path.join(value.path, 'figures/large.bin')).size, 65 * 1024 * 1024);
  assert.equal(fs.readdirSync(path.join(value.path, 'assets')).length, 5001);
  assert.equal(fs.existsSync(path.join(value.path, '.git')), false);
});

// Stored ZIP with one streamed asset: both the compressed and expanded sizes
// exceed the old cap, without constructing a large test buffer.
function* largeZip() {
  const filename = Buffer.from('large.bin'), size = 65 * 1024 * 1024;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(size, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + size, 16);
  yield local; yield filename;
  const chunk = Buffer.alloc(1024 * 1024, 42);
  for (let index = 0; index < 65; index++) yield chunk;
  yield central; yield filename; yield end;
}
test('multipart ZIP import extracts from disk beyond the old compressed and expanded limits', async t => {
  const f = await fixture(t);
  function* body() { yield part('source.zip'); yield* largeZip(); yield end; }
  const response = await f.upload(body(), true);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(fs.statSync(path.join(response.json().path, 'large.bin')).size, 65 * 1024 * 1024);
  assert.ok(!fs.readdirSync(f.directory).some(name => name.startsWith('upload-')));
});

test('multipart import rejects traversal, duplicate files, corrupt ZIPs and incomplete requests, cleaning partial copies', async t => {
  const f = await fixture(t);
  for (const [body, archive] of [
    [[part('../outside.tex'), source, end], false],
    [[part('paper/main.tex'), source, '\r\n' + part('paper/main.tex'), source, end], false],
    [[part('source.zip'), 'invalid ZIP', end], true],
    [[part('paper/main.tex'), source], false],
    [[`--${boundary}--\r\n`], false],
  ] as [string[], boolean][]) {
    const response = await f.upload(body, archive);
    assert.ok(response.statusCode >= 400, response.body);
    assert.equal(fs.existsSync(path.join(f.directory, 'outside.tex')), false);
    assert.deepEqual(fs.readdirSync(path.join(f.directory, 'papers')), []);
    assert.ok(!fs.readdirSync(f.directory).some(name => name.startsWith('upload-')));
    assert.equal(f.imports.busy, false);
  }
});

test('interrupted file streams remove staged imports and allow retry', async t => {
  const f = await fixture(t);
  async function* files() {
    yield { filename: 'main.tex', file: Readable.from([source]) };
    yield { filename: 'asset.bin', file: Readable.from((async function* () { yield Buffer.alloc(1024); throw new Error('Connection lost'); })()) };
  }
  await assert.rejects(f.imports.upload(files(), 'Interrupted', false), /Connection lost/);
  assert.deepEqual(fs.readdirSync(path.join(f.directory, 'papers')), []);
  assert.equal(f.imports.busy, false);
  const response = await f.upload([part('main.tex'), source, end]);
  assert.equal(response.statusCode, 200, response.body);
});

test('multipart filenames preserve quotes, percent escapes and Unicode without collisions', async t => {
  const f = await fixture(t), names = ['main.tex', 'a%22b.tex', '论文/图像%20.png'];
  // Windows forbids literal quotes in filenames; percent escapes must still survive.
  if (process.platform !== 'win32') names.push('a"b.tex');
  function* body() { for (const name of names) { yield part('paper/' + name); yield source; yield '\r\n'; } yield `--${boundary}--\r\n`; }
  const response = await f.upload(body());
  assert.equal(response.statusCode, 200, response.body);
  for (const name of names) assert.equal(fs.readFileSync(path.join(response.json().path, name), 'utf8'), source);
});

test('cancellation after receiving a ZIP prevents extraction and removes temporary files', async t => {
  const f = await fixture(t), controller = new AbortController();
  async function* files() {
    yield { filename: 'source.zip', file: Readable.from((async function* () { yield* largeZip(); controller.abort(); })()) };
  }
  await assert.rejects(f.imports.upload(files(), 'Canceled', true, controller.signal), /abort/i);
  assert.deepEqual(fs.readdirSync(path.join(f.directory, 'papers')), []);
  assert.ok(!fs.readdirSync(f.directory).some(name => name.startsWith('upload-')));
});

test('ZIP import accepts more than 5,000 archive entries', async t => {
  const f = await fixture(t);
  function* zip() {
    const centralEntries: Buffer[] = [];
    let offset = 0;
    for (let index = 0; index < 5002; index++) {
      const name = Buffer.from(index === 0 ? 'paper/main.tex' : `paper/assets/${index}.dat`);
      const body = Buffer.from(index === 0 ? source : ''), local = Buffer.alloc(30), central = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
      central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
      yield local; yield name; yield body;
      offset += local.length + name.length + body.length;
      centralEntries.push(central, name);
    }
    const central = Buffer.concat(centralEntries), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(5002, 8); end.writeUInt16LE(5002, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    yield central; yield end;
  }
  function* body() { yield part('source.zip'); yield* zip(); yield end; }
  const response = await f.upload(body(), true);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().main, 'main.tex');
  assert.equal(fs.readdirSync(path.join(response.json().path, 'assets')).length, 5001);
});


test('streaming uploads inherit the workspace CSRF guard before accepting files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-upload-access-'));
  const imports = new PaperImports(new Manuscripts(), directory), app = Fastify();
  guard(app, { listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, csrf: 'upload-test-token' });
  registerImportUpload(app, imports);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1:7274', 'content-type': `multipart/form-data; boundary=${boundary}` };
  const payload = part('main.tex') + source + end;
  const denied = await app.inject({ method: 'POST', url: '/api/imports/upload', headers, payload });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(fs.readdirSync(directory), []);
  const allowed = await app.inject({ method: 'POST', url: '/api/imports/upload', headers: { ...headers, 'x-papilot-token': 'upload-test-token' }, payload });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json().main, 'main.tex');
});

test('malformed filename escapes report an invalid path instead of a decoder error', async t => {
  const f = await fixture(t);
  async function* files() { yield { filename: 'paper%E0%A4%A.tex', file: Readable.from([source]) }; }
  await assert.rejects(f.imports.upload(files(), 'Malformed', false), { message: 'Invalid file path in upload.' });
  assert.deepEqual(fs.readdirSync(path.join(f.directory, 'papers')), []);
});

test('staging and incomplete copies left by an earlier server process are removed on startup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-upload-restart-'));
  try {
    const ids = { interrupted: '00000000-0000-4000-8000-000000000001', imported: '00000000-0000-4000-8000-000000000002', registered: '00000000-0000-4000-8000-000000000003' };
    fs.mkdirSync(path.join(directory, 'upload-stale')); fs.writeFileSync(path.join(directory, 'upload-stale', 'source.zip'), 'partial');
    for (const id of [...Object.values(ids), 'not-an-import']) { fs.mkdirSync(path.join(directory, 'papers', id), { recursive: true }); fs.writeFileSync(path.join(directory, 'papers', id, 'main.tex'), source); }
    fs.mkdirSync(path.join(directory, 'imports'));
    fs.writeFileSync(path.join(directory, 'imports', ids.imported + '.json'), JSON.stringify({ id: ids.imported, path: path.join(directory, 'papers', ids.imported), copied: true, name: 'Imported', phase: 'ready' }));
    new PaperImports(new Manuscripts(), directory, root => root === path.join(directory, 'papers', ids.registered));
    assert.deepEqual(fs.readdirSync(directory).sort(), ['imports', 'papers']);
    assert.deepEqual(fs.readdirSync(path.join(directory, 'papers')).sort(), [ids.imported, ids.registered, 'not-an-import'].sort());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ZIP path conflicts fail promptly and remove staged files', async t => {
  const f = await fixture(t);
  // "asset" is extracted as a file, so creating the parent of "asset/child.bin" fails before its stream is read.
  function* zip() {
    const entries = [['main.tex', source], ['asset', 'file'], ['asset/child.bin', 'child']], central: Buffer[] = [];
    let offset = 0;
    for (const [entryName, content] of entries) {
      const name = Buffer.from(entryName), body = Buffer.from(content), local = Buffer.alloc(30), header = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
      header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 6); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(body.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
      yield local; yield name; yield body;
      offset += local.length + name.length + body.length; central.push(header, name);
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    yield directory; yield end;
  }
  function* body() { yield part('source.zip'); yield* zip(); yield end; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([f.upload(body(), true), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ZIP extraction did not finish')), 5000); })]).finally(() => clearTimeout(timer));
  assert.ok(response.statusCode >= 400, response.body);
  assert.deepEqual(fs.readdirSync(path.join(f.directory, 'papers')), []);
  assert.ok(!fs.readdirSync(f.directory).some(name => name.startsWith('upload-')));
  assert.equal(f.imports.busy, false);
});
