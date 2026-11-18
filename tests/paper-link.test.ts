import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { downloadPaperSource, paperLink } from '../src/server/paper-link.ts';
import { downloadAddress, publicAddress, publicLookup, requestSource, type SourceRequest, type SourceResponse } from '../src/server/paper-download.ts';
import { extractSource, PaperImports } from '../src/server/imports.ts';
import { Manuscripts } from '../src/server/manuscript.ts';

const source = '\\documentclass{article}\n\\begin{document}Hello from a link.\\end{document}\n';
const response = (url: URL, data: string | Buffer, headers: SourceResponse['headers'] = {}, status = 200): SourceResponse => ({ url, data: Buffer.from(data), headers, status });
async function archive(entries: { name: string; data?: string | Buffer; type?: 'file' | 'directory' | 'symlink' | 'link'; linkname?: string }[]) {
  const pack = tar.pack(), chunks: Buffer[] = [];
  const result = (async () => { for await (const chunk of pack) chunks.push(chunk as Buffer); return Buffer.concat(chunks); })();
  for (const entry of entries) pack.entry({ name: entry.name, type: entry.type ?? 'file', linkname: entry.linkname }, entry.data ?? '');
  pack.finalize(); return result;
}
function folder(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-paper-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}

test('paper URLs preserve arXiv versions, normalize PDF and legacy identifiers, and distinguish Overleaf sharing', () => {
  for (const input of ['https://arxiv.org/abs/1706.03762v7', 'http://www.arxiv.org/pdf/1706.03762v7.pdf?download=1#page=2', 'https://export.arxiv.org/html/1706.03762v7', 'https://arxiv.org/e-print/1706.03762v7']) {
    const link = paperLink(' ' + input + ' '); assert.equal(link.kind, 'arxiv'); assert.equal(link.url.href, 'https://arxiv.org/src/1706.03762v7');
  }
  assert.equal(paperLink('https://arxiv.org/pdf/math.GT/0309136v2').url.href, 'https://arxiv.org/src/math.GT/0309136v2');
  assert.equal(paperLink('https://arxiv.org/abs/hep-th/9901001').url.href, 'https://arxiv.org/src/hep-th/9901001');
  assert.equal(paperLink('https://overleaf.com/read/abcdefgh/#secret').url.href, 'https://www.overleaf.com/read/abcdefgh#secret');
  assert.equal(paperLink('https://www.overleaf.com/123456abcdef').kind, 'overleaf');
  assert.equal(paperLink('http://overleaf.com/project/0123456789abcdef01234567/share/?tracking=1#test-token').url.href, 'https://www.overleaf.com/project/0123456789abcdef01234567/share#test-token');
  assert.throws(() => paperLink('https://www.overleaf.com/project/0123456789abcdef01234567/share'), /full link/);
  assert.throws(() => paperLink('https://www.overleaf.com/project/0123456789abcdef01234567/share#'), /full link/);
  assert.throws(() => paperLink('https://www.overleaf.com/latex/templates/example/abcdefgh'), /Paste an arXiv/);
  assert.equal(paperLink('https://papers.example/download?token=abc').kind, 'archive');
  for (const input of [null, '', '/a.zip', 'https://arxiv.org/search', 'https://arxiv.org/abs/1706.03762v0', 'https://www.overleaf.com/project/012345678901234567890123', 'https://www.overleaf.com/read/123?x=y']) assert.throws(() => paperLink(input));
});

test('public downloads reject local, private, reserved, credential-bearing and non-HTTPS destinations', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '0.0.0.0', '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
  for (const url of ['https://127.1/a.zip', 'https://2130706433/a.zip', 'https://[::ffff:127.0.0.1]/a.zip', 'https://user:password@papers.example/a.zip', 'https://papers.example:8443/a.zip', 'file:///a.zip', 'http://papers.example/a.zip']) assert.throws(() => downloadAddress(url));
});

test('GitHub repositories download the default branch without guessing its name or importing history', async () => {
  for (const input of ['https://github.com/author/paper', 'https://github.com/author/paper.git/', 'https://www.github.com/author/paper?tab=readme-ov-file#readme']) {
    const link = paperLink(input);
    assert.equal(link.kind, 'github');
    assert.equal(link.url.href, 'https://api.github.com/repos/author/paper/zipball');
    const value = await downloadPaperSource(input, async url => response(url, source, { 'content-disposition': 'attachment; filename="author-paper-abc123.zip"' }));
    assert.equal(value.name, 'paper'); assert.equal(value.data.toString(), source);
  }
  for (const url of ['https://github.com/author', 'https://github.com/author/paper/tree/main', 'https://github.com/author/paper/issues/1']) assert.throws(() => paperLink(url), /public GitHub repository/);
  assert.equal(paperLink('https://github.com/author/paper/archive/refs/heads/main.zip').kind, 'archive');
  for (const status of [401, 403, 404]) await assert.rejects(downloadPaperSource('https://github.com/author/private-paper', async url => response(url, 'not found', {}, status)), /Check that it is public/);
});

test('the socket lookup checks all DNS answers and returns those exact validated addresses', async t => {
  let addresses = [{ address: '8.8.8.8', family: 4 }];
  t.mock.method(dns, 'lookup', (_host: string, _options: unknown, callback: Function) => callback(null, addresses)); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const resolve = () => new Promise((resolve, reject) => publicLookup('papers.example', { all: true }, (error, values) => error ? reject(error) : resolve(values)));
  assert.deepEqual(await resolve(), addresses);
  addresses = [...addresses, { address: '192.168.0.1', family: 4 }];
  await assert.rejects(resolve(), /public HTTPS/);
});

test('downloads validate redirect destinations, isolate cookies and cancel oversized bodies early', async t => {
  const previous = process.env.no_proxy; process.env.no_proxy = '*';
  t.after(() => { if (previous === undefined) delete process.env.no_proxy; else process.env.no_proxy = previous; });
  const calls: { url: URL; options: any }[] = [], bodies: Readable[] = [];
  let mode = 'redirect', pulls = 0;
  t.mock.method(https, 'request', (url: URL, options: any, callback: Function) => {
    calls.push({ url, options });
    const body = mode === 'large' ? new Readable({ highWaterMark: 0, read() { pulls++; this.push(Buffer.alloc(1024)); } }) : Readable.from(['source']);
    Object.assign(body, { statusCode: mode === 'redirect' ? 302 : 200, headers: mode === 'redirect' ? { location: 'https://127.0.0.1/private' } : {} }); bodies.push(body);
    const request = new EventEmitter() as any; request.end = () => queueMicrotask(() => callback(body)); return request;
  });
  await assert.rejects(requestSource(new URL('https://papers.example/source.zip')), /public HTTPS/);
  assert.equal(calls.length, 1); assert.equal(bodies[0].destroyed, true); assert.equal(calls[0].options.lookup, publicLookup);
  await assert.rejects(requestSource(new URL('https://other.example/file'), { origin: 'https://www.overleaf.com', headers: { Cookie: 'secret' } }), /unexpected website/);
  assert.equal(calls.length, 1, 'No session-bearing request reaches another origin');
  mode = 'large';
  await assert.rejects(requestSource(new URL('https://papers.example/source.zip'), { limit: 1024 }), /too large/);
  assert.ok(pulls <= 3); assert.equal(bodies.at(-1)!.destroyed, true);
});

test('configured proxies CONNECT to validated public IPs while Host and TLS retain the paper website', async t => {
  const saved = { ...process.env };
  t.after(() => { for (const key of ['https_proxy', 'no_proxy', 'NO_PROXY']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } t.mock.restoreAll(); syncBuiltinESMExports(); });
  const targets: string[] = [], proxy = http.createServer();
  proxy.on('connect', (request, socket) => { targets.push(request.url!); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  process.env.https_proxy = `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
  process.env.no_proxy = ''; process.env.NO_PROXY = '';
  t.mock.method(dns, 'lookup', (_host: string, _options: unknown, callback: Function) => callback(null, [{ address: '8.8.8.8', family: 4 }])); syncBuiltinESMExports();
  const rejected = await requestSource(new URL('https://papers.example/source.zip'));
  assert.equal(rejected.status, 403); assert.deepEqual(targets, ['8.8.8.8:443']);
  let used: any;
  t.mock.method(https, 'request', (_url: URL, options: any, callback: Function) => {
    used = options;
    const body = Object.assign(Readable.from([Buffer.from('source')]), { statusCode: 200, headers: {} });
    const request = new EventEmitter() as any; request.end = () => queueMicrotask(() => callback(body)); return request;
  });
  await requestSource(new URL('https://papers.example/source.zip'));
  assert.equal(used.hostname, '8.8.8.8'); assert.equal(used.servername, 'papers.example'); assert.equal(used.headers.Host, 'papers.example');
  assert.equal(used.checkServerIdentity('proxy.example', { subjectaltname: 'DNS:papers.example' }), undefined);
  await requestSource(new URL('https://8.8.8.8/source.zip'));
  assert.equal(used.servername, ''); assert.equal(used.headers.Host, '8.8.8.8');
  assert.equal(used.checkServerIdentity('proxy.example', { subjectaltname: 'IP Address:8.8.8.8' }), undefined);
  assert.equal(used.checkServerIdentity('proxy.example', { subjectaltname: 'IP Address:1.1.1.1' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  process.env.no_proxy = 'papers.example';
  await requestSource(new URL('https://papers.example/source.zip'));
  assert.equal(used.agent, false); assert.equal(used.hostname, undefined); assert.equal(used.lookup, publicLookup);
});

test('stalled proxy CONNECT and TLS handshakes respect cancellation and close the pending socket', { timeout: 10000 }, async t => {
  const saved = { ...process.env }, sockets = new Set<import('node:net').Socket>(), proxy = http.createServer();
  let connected: () => void, peerEnded: () => void, stage = 'connect';
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (_request, socket) => {
    socket.once('end', () => { peerEnded(); socket.end(); }); socket.resume();
    if (stage === 'connect') connected();
    else { socket.once('data', () => connected()); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => proxy.close(() => resolve()));
    for (const key of ['https_proxy', 'no_proxy', 'NO_PROXY']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });
  process.env.https_proxy = `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
  process.env.no_proxy = ''; process.env.NO_PROXY = '';
  for (stage of ['connect', 'tls']) {
    const controller = new AbortController();
    const accepted = new Promise<void>(resolve => { connected = resolve; }), ended = new Promise<void>(resolve => { peerEnded = resolve; });
    const rejected = assert.rejects(requestSource(new URL('https://8.8.8.8/source.zip'), { signal: controller.signal }), /abort/i);
    await accepted; controller.abort(); await rejected; await ended;
  }
});

test('arXiv source fetching uses the exact version, and maps unavailable, throttled and timed-out responses', async () => {
  const downloaded = await downloadPaperSource('https://arxiv.org/pdf/1706.03762v7', async url => { assert.equal(url.href, 'https://arxiv.org/src/1706.03762v7'); return response(url, gzipSync(source)); });
  assert.equal(downloaded.name, 'arXiv 1706.03762v7');
  for (const [status, expected] of [[404, /No source/], [429, /Wait a little/], [503, /Could not download/]] as const) await assert.rejects(downloadPaperSource('https://arxiv.org/abs/1706.03762', async url => response(url, '', {}, status)), expected);
  await assert.rejects(downloadPaperSource('https://arxiv.org/abs/1706.03762', async () => { throw new DOMException('aborted', 'AbortError'); }), /timed out/);
});

test('Overleaf grants an anonymous session with CSRF, rotates cookies, preserves hash prefixes and downloads a ZIP', async () => {
  const calls: string[] = [];
  const fetcher: SourceRequest = async (url, options) => {
    calls.push(url.href); assert.equal(options?.origin, 'https://www.overleaf.com');
    assert.equal(url.hash, '');
    if (calls.length === 1) return response(url, '<meta content="token&amp;value" name="ol-csrfToken">', { 'set-cookie': ['session=first; Path=/; Secure'] });
    if (calls.length === 2) {
      assert.equal(url.pathname, '/read/abcdefgh/grant'); assert.equal(options?.method, 'POST');
      assert.equal(options?.headers?.Cookie, 'session=first'); assert.equal(options?.headers?.['X-CSRF-Token'], 'token&value');
      assert.deepEqual(JSON.parse(options?.body ?? ''), { tokenHashPrefix: '#prefix' });
      return response(url, JSON.stringify({ redirect: '/project/0123456789abcdef01234567', grantAnonymousAccess: 'readOnly' }), { 'set-cookie': ['session=granted; Path=/; Secure'] });
    }
    assert.equal(url.pathname, '/project/0123456789abcdef01234567/download/zip'); assert.equal(options?.headers?.Cookie, 'session=granted');
    return response(url, 'PKfixture', { 'content-disposition': "attachment; filename*=UTF-8''My%20paper.zip" });
  };
  const result = await downloadPaperSource('https://www.overleaf.com/read/abcdefgh#prefix', fetcher);
  assert.equal(result.name, 'My paper'); assert.equal(result.zip, true); assert.equal(calls.length, 3);
});

test('new Overleaf project share links validate their fragment and download with the anonymous session', async () => {
  const project = '/project/0123456789abcdef01234567', calls: string[] = [];
  const result = await downloadPaperSource('https://www.overleaf.com' + project + '/share#fixture-token', async (url, options) => {
    calls.push(url.pathname);
    assert.equal(url.origin, 'https://www.overleaf.com'); assert.equal(url.hash, '');
    assert.equal(options?.origin, url.origin);
    assert.ok(!JSON.stringify(options?.headers ?? {}).includes('fixture-token'));
    if (calls.length === 1) {
      assert.equal(url.pathname, project + '/share');
      assert.equal(options?.headers?.Cookie, undefined);
      return response(url, '<meta name="ol-csrfToken" content="csrf">', { 'set-cookie': ['session=landing; Path=/; Secure'] });
    }
    if (calls.length === 2) {
      assert.equal(url.pathname, project + '/share/validate'); assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(options?.body ?? ''), { token: 'fixture-token' });
      assert.equal(options?.headers?.['X-CSRF-Token'], 'csrf');
      assert.equal(options?.headers?.Origin, url.origin);
      assert.equal(options?.headers?.Referer, url.origin + project + '/share');
      assert.equal(options?.headers?.Cookie, 'session=landing');
      return response(url, JSON.stringify({ valid: true, redirect: true }), { 'set-cookie': ['session=authorized; Path=/; Secure'] });
    }
    assert.equal(url.pathname, project + '/download/zip'); assert.equal(options?.method, undefined);
    assert.equal(options?.headers?.Cookie, 'session=authorized');
    return response(url, 'PKfixture', { 'content-disposition': 'attachment; filename="Shared paper.zip"' });
  });
  assert.equal(result.name, 'Shared paper'); assert.equal(result.zip, true); assert.equal(calls.length, 3);
});

test('new Overleaf sharing refuses incomplete, revoked and login-required invitations without joining or following redirects', async () => {
  const link = 'https://www.overleaf.com/project/0123456789abcdef01234567/share#fixture-token';
  for (const validation of [null, {}, { valid: false, redirect: true }, { valid: true }, { valid: true, redirect: false }, { valid: true, redirect: '/login' }, { valid: true, redirect: 'https://other.example/' }, { valid: true, redirect: '/project/abcdef0123456789abcdef01' }]) {
    let count = 0;
    await assert.rejects(downloadPaperSource(link, async url => {
      count++;
      if (count === 1) return response(url, '<meta name="ol-csrfToken" content="csrf">');
      assert.equal(url.pathname, '/project/0123456789abcdef01234567/share/validate');
      return response(url, JSON.stringify(validation));
    }), /sharing is enabled/);
    assert.equal(count, 2);
  }
  let calls = 0;
  await assert.rejects(downloadPaperSource(link.split('#')[0], async () => { calls++; throw new Error('Unexpected network request'); }), /full link/);
  assert.equal(calls, 0);
});

test('Overleaf rejects login pages, revoked links and grants that redirect outside a project', async () => {
  const link = 'https://www.overleaf.com/read/abcdefgh';
  await assert.rejects(downloadPaperSource(link, async url => response(url, 'Sign in')), /read-only/);
  await assert.rejects(downloadPaperSource(link, async url => response(url, '', {}, 403)), /sharing is enabled/);
  await assert.rejects(downloadPaperSource(link, async url => response(url, url.pathname.endsWith('/grant') ? 'null' : '<meta name="ol-csrfToken" content="csrf">')), /read-only/);
  for (const redirect of ['/login', 'https://other.example/project/0123456789abcdef01234567', '/project/../private', '//other.example/']) {
    let count = 0;
    await assert.rejects(downloadPaperSource(link, async url => response(url, ++count === 1 ? '<meta name="ol-csrfToken" content="csrf">' : JSON.stringify({ redirect }))), /read-only/);
    assert.equal(count, 2);
  }
});

test('source imports accept tar, tar.gz and single TeX, preserve assets and skip repository metadata', async t => {
  const directory = folder(t), data = await archive([{ name: './', type: 'directory' }, { name: './export/main.tex', data: source }, { name: './export/figure.png', data: Buffer.from([0, 255, 10]) }, { name: './export/.git/config', data: 'untrusted' }]);
  for (const [index, bytes] of [data, gzipSync(data), Buffer.from(source), gzipSync(source)].entries()) {
    const imports = new PaperImports(new Manuscripts(), path.join(directory, String(index)), undefined, async () => ({ data: bytes, name: 'Downloaded paper', zip: false }));
    const draft = await imports.create({ url: 'https://papers.example/source.tar.gz' });
    assert.equal(draft.name, 'Downloaded paper'); assert.equal(draft.main, 'main.tex'); assert.equal(draft.copied, true);
    assert.equal(fs.readFileSync(path.join(draft.path, 'main.tex'), 'utf8'), source); assert.equal(fs.existsSync(path.join(draft.path, '.git')), false);
    if (index < 2) assert.deepEqual(fs.readFileSync(path.join(draft.path, 'figure.png')), Buffer.from([0, 255, 10]));
  }
});

test('source downloads keep the workspace busy until import or cleanup completes', async t => {
  const directory = folder(t);
  let release: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const imports = new PaperImports(new Manuscripts(), directory, undefined, async () => { await pending; return { data: gzipSync(source), name: 'Paper', zip: false }; });
  const created = imports.create({ url: 'https://arxiv.org/abs/1706.03762' });
  assert.equal(imports.busy, true); release!(); await created; assert.equal(imports.busy, false);
  const failed = new PaperImports(new Manuscripts(), directory, undefined, async () => { throw new Error('fixture network failure'); });
  await assert.rejects(failed.create({ url: 'https://arxiv.org/abs/1706.03762' }), /fixture network failure/);
  assert.equal(failed.busy, false); assert.equal(fs.readdirSync(path.join(directory, 'papers')).length, 1);
});

test('failed source imports reject traversal, links, duplicates, PDFs, HTML and incomplete downloads, leaving no copies', async t => {
  const directory = folder(t);
  const invalid = [Buffer.from('%PDF-1.7\nfixture'), gzipSync('%PDF-1.7\nfixture'), Buffer.from('<html>Sign in</html>'), Buffer.from('not an archive'), await archive([{ name: 'README.md', data: 'No source' }])];
  for (const entries of [
    [{ name: '../outside.tex', data: source }], [{ name: '/outside.tex', data: source }], [{ name: 'a\\b.tex', data: source }],
    [{ name: 'main.tex', type: 'symlink' as const, linkname: '../outside' }], [{ name: 'main.tex', type: 'link' as const, linkname: '../outside' }],
    [{ name: 'main.tex', data: source }, { name: 'MAIN.tex', data: source }],
  ]) invalid.push(await archive(entries));
  invalid.push((await archive([{ name: 'main.tex', data: source }])).subarray(0, 530));
  for (const data of invalid) {
    const imports = new PaperImports(new Manuscripts(), directory, undefined, async () => ({ data, name: 'Invalid', zip: false }));
    await assert.rejects(imports.create({ url: 'https://papers.example/file.zip' }));
    assert.deepEqual(fs.readdirSync(path.join(directory, 'papers')), []);
  }
  await assert.rejects(extractSource(gzipSync(Buffer.alloc(65 * 1024 * 1024)), directory), /64 MB/);
  await assert.rejects(extractSource(Buffer.from(source), directory, true), /source ZIP/);
  const imports = new PaperImports(new Manuscripts(), directory);
  await assert.rejects(imports.create({ url: 'https://papers.example/file.zip', files: [] }), /Choose one/);
});
