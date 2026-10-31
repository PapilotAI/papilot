import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { activeInstallation, newerVersion, readJson, stableVersion, writeJson } from '../bin/installation.mjs';
import { Updates } from '../src/server/updates.ts';
import { health, loaderFor, probeInstallation, sleep } from '../src/server/update-install.ts';
import { restartRelease } from '../src/server/update-worker.ts';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-update-test-'));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(overrides: Record<string, any> = {}) {
  const data = temporary();
  const updates = new Updates({ root: process.cwd(), data, version: '0.6.0', port: 1, supported: true, latest: async () => '0.7.0', busy: () => false, shutdown() {}, ...overrides });
  return { data, updates, close() { updates.close(); fs.rmSync(data, { recursive: true, force: true }); } };
}
test('release comparisons reject unsafe targets and never downgrade', () => {
  for (const version of ['latest', '../1.0.0', '1.2.3;whoami', '1.2.3-beta.1', '01.2.3', '1.2']) assert.equal(stableVersion(version), false, version);
  assert.ok(newerVersion('0.10.0', '0.9.0'));
  assert.ok(newerVersion('1.0.0', '1.0.0-beta.2'));
  assert.equal(newerVersion('0.6.0', '0.6.0'), false);
  assert.equal(newerVersion('0.6.0', '0.7.0'), false);
});
test('checks are shared, transient failures preserve an available version, and forged install targets are refused', async () => {
  let release!: (value: string) => void;
  const f = fixture({ latest: () => new Promise<string>(resolve => { release = resolve; }) });
  try {
    const checking = f.updates.check(); assert.equal(f.updates.check(), checking);
    release('0.7.0'); await checking;
    assert.equal(f.updates.snapshot().phase, 'available');
    assert.throws(() => f.updates.install('0.8.0'), /Check for/);
    assert.throws(() => f.updates.install('0.7.0 --prefix /tmp/other'), /Check for/);
    const retry = f.updates.check(); release('not-a-version'); await retry;
    assert.equal(f.updates.snapshot().latestVersion, '0.7.0');
    assert.equal(f.updates.snapshot().phase, 'available');
    assert.match(f.updates.snapshot().error!, /Could not check/);
  } finally { f.close(); }
});
test('installation is deduplicated, allows ongoing work, and restarts only after tasks and HTTP operations finish', async () => {
  let done!: (root: string) => void, busy = true, installs = 0, restarts = 0;
  const f = fixture({ busy: () => busy, install: () => { installs++; return new Promise<string>(resolve => { done = resolve; }); }, restart: async () => { restarts++; } });
  try {
    await f.updates.check();
    assert.equal(f.updates.install('0.7.0').phase, 'installing');
    assert.equal(f.updates.install('0.7.0').phase, 'installing');
    assert.equal(installs, 1); assert.equal(f.updates.restarting, false);
    done('/prepared'); await tick();
    assert.equal(f.updates.snapshot().phase, 'waiting'); assert.equal(restarts, 0);
    const finish = f.updates.enter(); busy = false; await f.updates.activate();
    assert.equal(restarts, 0); finish(); finish();
    await f.updates.activate(); assert.equal(restarts, 1); assert.equal(f.updates.restarting, true);
    await f.updates.activate(); assert.equal(restarts, 1);
  } finally { f.close(); }
});
test('failed installation and restart preserve the current version and permit a retry', async () => {
  let attempts = 0;
  const f = fixture({ install: async () => { if (++attempts === 1) throw new Error('Download failed'); return '/prepared'; }, restart: async () => { throw new Error('Cannot restart'); } });
  try {
    await f.updates.check(); f.updates.install('0.7.0'); await tick();
    assert.equal(f.updates.snapshot().phase, 'failed'); assert.equal(f.updates.snapshot().currentVersion, '0.6.0');
    assert.equal(fs.existsSync(path.join(f.data, 'updates/active.json')), false);
    f.updates.install('0.7.0'); await tick();
    assert.equal(f.updates.snapshot().phase, 'failed'); assert.match(f.updates.snapshot().error!, /Cannot restart/);
    assert.equal(fs.existsSync(path.join(f.data, 'updates/install.lock')), false);
  } finally { f.close(); }
});
test('an interrupted update is recoverable and another live installer owns the lock', async () => {
  const f = fixture();
  try {
    await f.updates.check();
    writeJson(path.join(f.data, 'updates/install.lock'), { pid: process.pid });
    assert.throws(() => f.updates.install('0.7.0'), /already updating/);
    writeJson(path.join(f.data, 'updates/status.json'), { ...f.updates.snapshot(), phase: 'restarting', pid: 2147483647 });
    const resumed = new Updates({ root: process.cwd(), data: f.data, version: '0.6.0', port: 1, supported: true, busy: () => false, shutdown() {} });
    assert.equal(resumed.snapshot().phase, 'failed'); assert.match(resumed.snapshot().error!, /interrupted/); resumed.close();
  } finally { f.close(); }
});
test('launchers select only a newer complete release inside the managed directory', () => {
  const data = temporary(), root = path.join(data, 'original'), release = path.join(data, 'updates/releases/next/node_modules/papilot');
  try {
    fs.mkdirSync(root, { recursive: true }); writeJson(path.join(root, 'package.json'), { name: 'papilot', version: '0.6.0' });
    fs.mkdirSync(path.join(release, 'src/server'), { recursive: true }); fs.writeFileSync(path.join(release, 'src/server/start.ts'), '');
    writeJson(path.join(release, 'package.json'), { name: 'papilot', version: '0.7.0' });
    writeJson(path.join(data, 'updates/active.json'), { root: release, version: '0.7.0' });
    assert.equal(activeInstallation(root, data), release);
    assert.equal(activeInstallation(release, data), release);
    writeJson(path.join(root, 'package.json'), { name: 'papilot', version: '0.8.0' });
    assert.equal(activeInstallation(root, data), root);
    writeJson(path.join(data, 'updates/active.json'), { root: '/tmp/untrusted', version: '9.0.0' });
    assert.equal(activeInstallation(root, data), root);
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
function fakeRelease(root: string, version: string, broken = false) {
  fs.mkdirSync(path.join(root, 'src/server'), { recursive: true });
  writeJson(path.join(root, 'package.json'), { name: 'papilot', version, type: 'module' });
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, 'src/server/main.ts'), `
    import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
    const data = process.env.PAPILOT_DATA;
    fs.mkdirSync(data, {recursive:true}); fs.writeFileSync(path.join(data,'child.pid'),String(process.pid));
    ${broken ? "fs.writeFileSync(path.join(data,'papilot.sqlite'),'broken migration');" : ''}
    const server = http.createServer((req,res) => {
      let active = {}; try { active = JSON.parse(fs.readFileSync(path.join(data,'updates/active.json'),'utf8')); } catch {}
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ name:'Papilot', version:${JSON.stringify(broken ? 'wrong' : version)}, updateInstance:active.id }));
    }); server.listen(Number(process.env.PAPILOT_PORT),'127.0.0.1');
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `);
  fs.writeFileSync(path.join(root, 'src/server/start.ts'), '');
}
for (const broken of [false, true]) test(`detached activation ${broken ? 'restores the previous runtime and database when health checks fail' : 'starts the new runtime and retains the data directory'}`, async () => {
  const data = temporary(), root = path.join(data, 'updates/releases/next'), previousRoot = path.join(data, 'old'), port = await freePort();
  try {
    fakeRelease(root, '0.7.0', broken); fakeRelease(previousRoot, '0.6.0');
    fs.writeFileSync(path.join(data, 'papilot.sqlite'), 'original database');
    fs.writeFileSync(path.join(data, 'papilot.sqlite-wal'), 'committed WAL pages');
    writeJson(path.join(data, 'updates/status.json'), { currentVersion: '0.6.0', latestVersion: '0.7.0', phase: 'restarting' });
    await restartRelease({ id: 'test-instance', root, version: '0.7.0', previousRoot, previousVersion: '0.6.0', data, port, parent: 2147483647, service: false }, () => {}, broken ? 3 : 30);
    for (let i = 0; i < 30 && !(await health(port, broken ? '0.6.0' : '0.7.0')); i++) await sleep(100);
    assert.ok(await health(port, broken ? '0.6.0' : '0.7.0'));
    assert.equal(readJson(path.join(data, 'updates/status.json')).phase, broken ? 'failed' : 'updated');
    assert.equal(fs.readFileSync(path.join(data, 'papilot.sqlite'), 'utf8'), 'original database');
    assert.equal(fs.readFileSync(path.join(data, 'papilot.sqlite-wal'), 'utf8'), 'committed WAL pages');
    assert.equal(fs.existsSync(path.join(data, 'updates/install.lock')), false);
    assert.equal(readJson(path.join(data, 'updates/active.json'))?.version, broken ? undefined : '0.7.0');
  } finally {
    const pid = Number(fs.existsSync(path.join(data, 'child.pid')) && fs.readFileSync(path.join(data, 'child.pid'), 'utf8'));
    if (pid) try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
    fs.rmSync(data, { recursive: true, force: true });
  }
});
test('downloaded releases must pass a real isolated server startup before activation', async () => {
  const stage = temporary(), root = path.join(stage, 'candidate'), log = fs.openSync(path.join(stage, 'probe.log'), 'w');
  try { fakeRelease(root, '0.7.0'); await probeInstallation(root, '0.7.0', stage, log); }
  finally { fs.closeSync(log); fs.rmSync(stage, { recursive: true, force: true }); }
});

test('a browser install restarts the real server and the original launcher keeps the selected version and data', async () => {
  const folder = temporary(), original = path.join(folder, 'original'), data = path.join(original, '.papilot');
  const candidate = path.join(data, 'updates/releases/next/node_modules/papilot'), port = await freePort();
  const log = fs.openSync(path.join(folder, 'server.log'), 'w');
  let started: ReturnType<typeof spawn> | undefined;
  const copy = (root: string, version: string) => {
    fs.mkdirSync(root, { recursive: true });
    fs.cpSync(path.join(process.cwd(), 'src'), path.join(root, 'src'), { recursive: true });
    fs.cpSync(path.join(process.cwd(), 'bin'), path.join(root, 'bin'), { recursive: true });
    writeJson(path.join(root, 'package.json'), { ...readJson(path.join(process.cwd(), 'package.json')), version });
    fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir');
    fs.symlinkSync(path.join(process.cwd(), 'vendor'), path.join(root, 'vendor'), 'dir');
    const start = path.join(root, 'src/server/start.ts');
    fs.appendFileSync(start, "\nfs.writeFileSync(path.join(DATA, 'test-server.pid'), String(process.pid));\n");
  };
  const stop = async () => {
    const file = path.join(data, 'test-server.pid');
    const pid = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : started?.pid;
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { return; }
      for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { return; } await sleep(100); }
      try { process.kill(pid, 'SIGKILL'); } catch { /* stopped */ }
    }
  };
  try {
    copy(original, '0.6.0'); copy(candidate, '0.7.0');
    const { Store } = await import('../src/server/store.ts');
    const store = new Store(path.join(data, 'papilot.sqlite'));
    store.saveProject({ id: 'kept-paper', name: 'Preserved paper', path: '/unused', createdAt: 1 }); store.close();
    fs.writeFileSync(path.join(original, 'boot.ts'), `
      import { Updates } from './src/server/updates.ts';
      const check = Updates.prototype.check;
      Updates.prototype.check = function () { this.options.latest = async () => '0.7.0'; this.options.install = async () => ${JSON.stringify(candidate)}; return check.call(this); };
      await import('./src/server/main.ts');
    `);
    const env: NodeJS.ProcessEnv = { ...process.env, PAPILOT_PORT: String(port), PAPILOT_PUBLIC_ORIGIN: '', PAPILOT_ACCOUNT_ORIGIN: '', PAPILOT_SERVICE_MANAGER: '', XPC_SERVICE_NAME: '', PAPILOT_UPDATE_PROBE: '1' };
    delete env.PAPILOT_DATA;
    const launch = (file: string) => spawn(process.execPath, ['--import', loaderFor(original), path.join(original, file)], { cwd: original, env, stdio: ['ignore', log, log] });
    started = launch('boot.ts');
    for (let i = 0; i < 60 && !(await health(port, '0.6.0')); i++) await sleep(100);
    assert.ok(await health(port, '0.6.0'));
    const base = `http://127.0.0.1:${port}`, before = await (await fetch(base + '/api/state')).json();
    const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Papilot-Token': before.csrf }, body: JSON.stringify(body) });
    assert.equal((await (await post('/api/updates/check', {})).json()).phase, 'available');
    assert.equal((await (await post('/api/updates/install', { version: '0.7.0' })).json()).phase, 'installing');
    for (let i = 0; i < 100 && !(await health(port, '0.7.0')); i++) await sleep(100);
    const diagnostics = () => [path.join(folder, 'server.log'), path.join(data, 'updates/restart.log'), path.join(data, 'updates/server.log'), path.join(data, 'updates/status.json')].filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
    assert.ok(await health(port, '0.7.0'), diagnostics());
    for (let i = 0; i < 30 && readJson(path.join(data, 'updates/status.json'))?.phase !== 'updated'; i++) await sleep(100);
    assert.equal(readJson(path.join(data, 'updates/status.json')).phase, 'updated');
    assert.deepEqual((await (await fetch(base + '/api/state')).json()).projects.map((project: any) => project.id), ['kept-paper']);
    assert.equal(execFileSync(process.execPath, [path.join(original, 'bin/papilot.mjs'), '--data', data, '--version'], { encoding: 'utf8' }).trim(), '0.7.0');
    await stop(); started = launch('src/server/main.ts');
    for (let i = 0; i < 60 && !(await health(port, '0.7.0')); i++) await sleep(100);
    assert.ok(await health(port, '0.7.0'));
    assert.deepEqual((await (await fetch(base + '/api/state')).json()).projects.map((project: any) => project.id), ['kept-paper']);
  } finally { await stop(); fs.closeSync(log); fs.rmSync(folder, { recursive: true, force: true }); }
});
