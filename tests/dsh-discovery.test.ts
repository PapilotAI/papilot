import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { agentDirs, findExecutable, WINDOWS } from '../bin/agent-paths.mjs';

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-dsh-中文 & '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const env = { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, 'Local'), APPDATA: path.join(root, 'Roaming'), PATH: '', PATHEXT: '.EXE;.CMD' };
  const install = (name: string) => {
    const location = path.join(root, name);
    const cli = path.join(location, 'resources/runtime/cli/bin/dsh.cmd');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '@echo off\r\n');
    return { location, cli };
  };
  const registry = (read: () => object) => {
    const mock = t.mock.method(childProcess, 'spawnSync', (...args: unknown[]) => {
      const options = args[2] as childProcess.SpawnSyncOptions;
      assert.equal(options.windowsHide, true);
      assert.equal(options.encoding, 'utf8');
      assert.ok(options.timeout! > 0 && options.timeout! <= 5000);
      return read();
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    return mock;
  };
  return { root, env, install, registry };
}

test('Windows discovers a custom Harness installation without dsh on PATH', { skip: !WINDOWS }, t => {
  const f = fixture(t), app = f.install('Apps 中文 & tools/DeepSeek Harness');
  const query = f.registry(() => ({ status: 0, stdout: JSON.stringify([app.location]) }));
  for (const command of ['dsh', 'DSH.CMD']) {
    assert.equal(path.relative(findExecutable(command, f.env)!, app.cli), '');
  }
  assert.equal(query.mock.callCount(), 2);
});

test('Windows keeps PATH, default installs and explicit paths ahead of registry discovery', { skip: !WINDOWS }, t => {
  const f = fixture(t), custom = f.install('preferred');
  const query = f.registry(() => { throw new Error('Registry discovery must not run'); });
  assert.equal(path.relative(findExecutable('dsh', { ...f.env, PATH: path.dirname(custom.cli) })!, custom.cli), '');
  assert.equal(path.relative(findExecutable(custom.cli, f.env)!, custom.cli), '');
  assert.equal(findExecutable(path.join(f.root, 'missing/dsh.cmd'), f.env), null);
  assert.equal(findExecutable('missing-agent', f.env), null);
  const standard = f.install('Local/Programs/DeepSeek Harness');
  assert.equal(path.relative(findExecutable('dsh', f.env)!, standard.cli), '');
  assert.equal(query.mock.callCount(), 0);
});

test('Windows skips stale installations and discovers newly installed Harness on reconnect', { skip: !WINDOWS }, t => {
  const f = fixture(t), first = f.install('first'), second = f.install('second');
  let locations = [path.join(f.root, 'uninstalled'), first.location, second.location];
  f.registry(() => ({ status: 0, stdout: JSON.stringify(locations) }));
  assert.equal(path.relative(findExecutable('dsh', f.env)!, first.cli), '');
  fs.rmSync(first.location, { recursive: true });
  assert.equal(path.relative(findExecutable('dsh', f.env)!, second.cli), '');
  locations = [];
  assert.equal(findExecutable('dsh', f.env), null);
  locations = [second.location];
  assert.equal(path.relative(findExecutable('dsh', f.env)!, second.cli), '');
});

test('Windows treats unavailable or malformed installation records as not found', { skip: !WINDOWS }, t => {
  const f = fixture(t), app = f.install('installed');
  let response: object;
  f.registry(() => response);
  for (response of [
    { status: 1, stdout: JSON.stringify([app.location]) },
    { status: null, error: new Error('timeout'), stdout: '' },
    { status: 0, stdout: 'not JSON' },
    { status: 0, stdout: JSON.stringify(app.location) },
    { status: 0, stdout: JSON.stringify([null, {}, '', 'relative/path', path.join(f.root, 'missing')]) },
  ]) assert.equal(findExecutable('dsh', f.env), null);
});

test('non-Windows executable lookup does not query the Windows registry', { skip: WINDOWS }, t => {
  const f = fixture(t);
  const query = f.registry(() => { throw new Error('Windows discovery must not run'); });
  // Exercise the missing-executable path even when the host has dsh installed.
  t.mock.method(fs, 'statSync', () => { throw new Error('ENOENT'); });
  assert.equal(findExecutable('dsh', f.env), null);
  assert.equal(query.mock.callCount(), 0);
});

test('the dsh command inside the DeepSeek Harness app for macOS is found after the usual places', () => {
  const home = path.join(os.tmpdir(), 'papilot-dsh-home');
  const dirs = agentDirs({ HOME: home, USERPROFILE: home });
  const bundle = (apps: string) => path.join(apps, 'DeepSeek Harness.app/Contents/Resources/runtime/cli/bin');
  const system = dirs.indexOf(bundle('/Applications')), personal = dirs.indexOf(bundle(path.join(home, 'Applications')));
  assert.ok(system > dirs.indexOf('/usr/local/bin'), 'a dsh installed on PATH or with Homebrew comes first');
  assert.ok(personal > system);
});
