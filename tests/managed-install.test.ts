import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { activeInstallation, agentSdkFolder, waitForActivation, writeJson } from '../bin/installation.mjs';
import { Updates } from '../src/server/updates.ts';

// PAPILOT_INSTALL_METHOD=managed: an installation that pins its own version,
// such as a container image, a server deployment or a system package.
const root = path.resolve(import.meta.dirname, '..');
const temporary = (name: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
async function withMethod<T>(method: string | undefined, run: () => T | Promise<T>) {
  const previous = process.env.PAPILOT_INSTALL_METHOD;
  if (method === undefined) delete process.env.PAPILOT_INSTALL_METHOD; else process.env.PAPILOT_INSTALL_METHOD = method;
  try { return await run(); } finally { if (previous === undefined) delete process.env.PAPILOT_INSTALL_METHOD; else process.env.PAPILOT_INSTALL_METHOD = previous; }
}

test('a managed installation starts its own version and ignores releases installed by in-app updates', async () => {
  const dir = temporary('papilot-managed-layers-'), app = path.join(dir, 'app'), data = path.join(dir, 'data');
  const release = path.join(data, 'updates/releases/0.10.0');
  try {
    writeJson(path.join(app, 'package.json'), { name: 'papilot', version: '0.9.0' });
    writeJson(path.join(release, 'package.json'), { name: 'papilot', version: '0.10.0' });
    fs.mkdirSync(path.join(release, 'src/server'), { recursive: true }); fs.writeFileSync(path.join(release, 'src/server/start.ts'), '');
    writeJson(path.join(data, 'updates/active.json'), { version: '0.10.0', channel: 'stable', root: release });
    assert.equal(await withMethod(undefined, () => activeInstallation(app, data)), release, 'the fixture is a valid installed release');
    assert.equal(await withMethod('managed', () => activeInstallation(app, data)), app);
    // A pending activation from a live process would otherwise be waited for.
    const pending = { phase: 'pending', pid: process.pid, version: '0.10.0', root: release };
    writeJson(path.join(data, 'updates/active.json'), pending);
    const started = Date.now();
    await withMethod('managed', () => waitForActivation(data));
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'updates/active.json'), 'utf8')), pending);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a managed installation never checks, installs or changes channels, and says updates are managed outside Papilot', async () => {
  const data = temporary('papilot-managed-update-');
  try {
    await withMethod('managed', async () => {
      writeJson(path.join(data, 'updates/status.json'), { phase: 'failed', error: 'An earlier update failed.', latestVersion: '0.9.0', pid: process.pid });
      let requests = 0;
      const updates = new Updates({ data, version: '0.8.9', supported: true, latest: async () => { requests++; return '0.9.0'; }, install: async () => { throw new Error('must not install'); }, root: data, port: 7274, busy: () => false, shutdown: () => {}, restart: async () => {} });
      updates.start();
      assert.deepEqual(await updates.check(), { currentVersion: '0.8.9', latestVersion: null, phase: 'idle', checkedAt: null, error: null, canUpdate: false, packageManager: 'managed' });
      assert.throws(() => updates.install('0.9.0'), /^Error: Updates are managed outside Papilot\.$/);
      assert.throws(() => updates.setChannel('dev'), /^Error: Updates are managed outside Papilot\.$/);
      updates.close();
      assert.equal(requests, 0);
      assert.equal(fs.existsSync(path.join(data, 'updates/install.lock')), false);
      assert.equal(fs.existsSync(path.join(data, 'updates/channel.json')), false);
    });
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

test('agent SDKs outside Papilot\'s dependencies come from the data folder, the Nix runtime, or nowhere in a managed installation', async () => {
  const app = path.join(os.tmpdir(), 'papilot-app'), data = path.join(os.tmpdir(), 'papilot-data');
  assert.equal(await withMethod(undefined, () => agentSdkFolder(app, data)), path.join(data, 'agents'));
  assert.equal(await withMethod('nix', () => agentSdkFolder(app, data)), path.join(app, 'nix-agent-runtime'));
  assert.equal(await withMethod('managed', () => agentSdkFolder(app, data)), null);
  assert.equal(await withMethod('docker', () => agentSdkFolder(app, data)), path.join(data, 'agents'), 'only known methods change behavior');
});

test('a managed installation loads agent SDKs only from Papilot\'s own dependencies and never downloads one', async () => {
  const data = temporary('papilot-managed-sdk-'), previousData = process.env.PAPILOT_DATA;
  // A copy an unmanaged run downloaded into the data folder earlier.
  const sdk = path.join(data, 'agents/node_modules/papilot-test-sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'papilot-test-sdk', version: '1.0.0', type: 'module', main: 'index.js' }));
  fs.writeFileSync(path.join(sdk, 'index.js'), 'export const loaded = true;\n');
  process.env.PAPILOT_DATA = data;
  try {
    const { loadPackage, packageFile } = await import('../src/server/agents.ts');
    await withMethod(undefined, async () => {
      assert.equal(packageFile('papilot-test-sdk'), path.join(sdk, 'index.js'));
      assert.equal((await loadPackage('papilot-test-sdk', '1.0.0', 'the test SDK')).loaded, true);
    });
    await withMethod('managed', async () => {
      assert.equal(packageFile('papilot-test-sdk'), null);
      assert.ok(packageFile('fastify'), 'Papilot\'s own dependencies are still found');
      let ready = 0;
      await assert.rejects(loadPackage('papilot-test-sdk', '1.0.0', 'the test SDK', () => { ready++; }),
        { message: 'This installation does not include the test SDK. Install papilot-test-sdk@1.0.0 into Papilot\'s node_modules, then restart Papilot.' });
      assert.equal(ready, 1);
      await assert.rejects(loadPackage('papilot-test-sdk', '1.0.0', 'the test SDK', () => { throw new Error('The agent is not configured.'); }), /not configured/, 'configuration errors come first');
    });
    assert.deepEqual(fs.readdirSync(path.join(data, 'agents')), ['node_modules'], 'nothing was installed');
  } finally {
    if (previousData === undefined) delete process.env.PAPILOT_DATA; else process.env.PAPILOT_DATA = previousData;
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('the papilot command never installs Codex in a managed or Nix installation', async () => {
  const dir = temporary('papilot-managed-codex-'), tools = path.join(dir, 'tools'), home = path.join(dir, 'home');
  fs.mkdirSync(tools); fs.mkdirSync(home);
  // A Codex older than the tested version is otherwise replaced by one installed into the data folder.
  const codex = path.join(tools, 'codex');
  fs.writeFileSync(codex, `#!${process.execPath}\nconsole.log('codex-cli 0.1.0');\n`, { mode: 0o755 });
  if (process.platform === 'win32') fs.writeFileSync(`${codex}.cmd`, `@echo off\r\n"${process.execPath}" "${codex}" %*\r\n`);
  try {
    for (const [method, hint] of [['managed', 'Install a supported Codex separately, or set PAPILOT_CODEX_BIN'], ['nix', 'Install a supported Codex separately with Nix, or set PAPILOT_CODEX_BIN']]) {
      const data = path.join(dir, `data-${method}`);
      // A regression fails fast instead of downloading.
      const env = { PATH: tools, HOME: home, USERPROFILE: home, TMPDIR: os.tmpdir(), PAPILOT_INSTALL_METHOD: method, npm_config_offline: 'true', npm_config_cache: path.join(dir, 'npm-cache') };
      const result = await new Promise<{ code: number; output: string }>(resolve => execFile(process.execPath, [path.join(root, 'bin/papilot.mjs'), '--data', data, 'codex', '--version'], { env, timeout: 30000 },
        (error, stdout, stderr) => resolve({ code: error ? Number((error as any).code) || 1 : 0, output: stdout + stderr })));
      assert.equal(result.code, 1, result.output);
      assert.ok(result.output.includes(hint), result.output);
      assert.doesNotMatch(result.output, /Installing Codex/);
      assert.equal(fs.existsSync(path.join(data, 'agents')), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
