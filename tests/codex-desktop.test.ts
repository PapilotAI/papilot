import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { desktopCodexCandidates } from '../bin/codex-desktop.mjs';
import { codexInstallations, firstRunnable } from '../bin/codex-lookup.mjs';

test('macOS discovers both desktop app names and CLI layouts, without choosing the GUI', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-desktop-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = path.join(root, 'Applications/Codex.app/Contents/Resources/codex');
  const current = path.join(root, 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
  for (const file of [old, current]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '', { mode: 0o755 }); }
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (file: fs.PathLike, ...args: any[]) => {
    if (!String(file).startsWith(root)) throw new Error('outside fixture');
    return (stat as any)(file, ...args);
  });
  const discover = async () => (await desktopCodexCandidates({ HOME: root }, { platform: 'darwin' })).map(file => path.normalize(file));
  assert.deepEqual(await discover(), [old, current]);
  fs.rmSync(old);
  assert.deepEqual(await discover(), [current], 'a removed app is not cached');
});

test('Windows discovers the registered package on a custom drive and refreshes after an update', async t => {
  const locations = ['D:\\Apps with spaces\\OpenAI.Codex_2', 'D:\\Apps with spaces\\OpenAI.Codex_3'];
  let version = 0;
  const calls: any[] = [];
  t.mock.method(childProcess, 'execFile', (file: string, args: string[], options: any, callback: any) => {
    calls.push({ file, args, options });
    callback(null, JSON.stringify(locations[version]));
  });
  const files = locations.map(dir => path.win32.join(dir, 'app/resources/codex.exe'));
  t.mock.method(fs, 'statSync', (file: fs.PathLike) => {
    assert.ok(files.includes(String(file)), 'only the bundled CLI is inspected');
    return { isFile: () => true };
  });
  t.mock.method(fs, 'accessSync', () => {});
  const env = { SystemRoot: 'C:\\Windows', PATH: '' };
  assert.deepEqual(await desktopCodexCandidates(env, { platform: 'win32' }), [files[0]]);
  version++;
  assert.deepEqual(await desktopCodexCandidates(env, { platform: 'win32' }), [files[1]]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, 5000);
  assert.match(calls[0].args.at(-1), /Get-AppxPackage -Name OpenAI\.Codex/);
  assert.doesNotMatch(calls[0].args.at(-1), /-AllUsers/);
  assert.deepEqual(env, { SystemRoot: 'C:\\Windows', PATH: '' }, 'discovery does not change the host environment');
});

test('Windows skips missing packages, invalid output, inaccessible files and query failures', async t => {
  let response: unknown = '', failure: Error | null = null;
  t.mock.method(childProcess, 'execFile', (_file: string, _args: string[], _options: any, callback: any) => callback(failure, response));
  t.mock.method(fs, 'statSync', () => { throw new Error('EACCES'); });
  for (response of ['', 'not JSON', '{"unexpected":true}', '[null,"relative"]', '"C:\\\\Packages\\\\OpenAI.Codex"']) {
    assert.deepEqual(await desktopCodexCandidates({}, { platform: 'win32' }), []);
  }
  failure = new Error('PowerShell timed out');
  assert.deepEqual(await desktopCodexCandidates({}, { platform: 'win32' }), []);
});

test('desktop discovery respects explicit overrides, Linux/WSL and cancellation', async t => {
  let queries = 0;
  t.mock.method(childProcess, 'execFile', (_file: string, _args: string[], options: any, callback: any) => {
    queries++;
    options.signal.addEventListener('abort', () => callback(new Error('aborted')));
  });
  assert.deepEqual(await desktopCodexCandidates({ PAPILOT_CODEX_BIN: 'chosen.exe' }, { platform: 'win32' }), []);
  assert.deepEqual(await desktopCodexCandidates({ WSL_DISTRO_NAME: 'Ubuntu' }, { platform: 'linux' }), []);
  assert.deepEqual(await desktopCodexCandidates({}, { platform: 'win32', signal: AbortSignal.abort() }), []);
  assert.equal(queries, 0);
  const stop = new AbortController();
  const lookup = desktopCodexCandidates({}, { platform: 'win32', signal: stop.signal });
  stop.abort();
  assert.deepEqual(await lookup, []);
  assert.equal(queries, 1);
});

test('a working CLI wins without querying desktop apps and overrides never fall back', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-desktop-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  fs.writeFileSync(file, process.platform === 'win32' ? '@echo codex-cli 0.1.0\r\n' : '#!/bin/sh\necho codex-cli 0.1.0\n', { mode: 0o755 });
  t.mock.method(childProcess, 'execFile', () => { throw new Error('must not query desktop apps'); });
  const env = { PATH: root, HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec };
  assert.equal((await firstRunnable(codexInstallations(env, root, root), env))?.toLowerCase(), file.toLowerCase());
  const override = { ...env, PAPILOT_CODEX_BIN: path.join(root, 'missing') };
  const found: string[] = [];
  for await (const candidate of codexInstallations(override, root, root)) found.push(candidate);
  assert.deepEqual(found, [override.PAPILOT_CODEX_BIN]);
});
