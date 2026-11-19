import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectTypeless, typelessShortcuts } from '../desktop/typeless.ts';
import { runTypelessHelper, typelessChord, typelessControl } from '../desktop/typeless-control.ts';

test('the real helper protocol authorizes only after preparation and a fresh focus check', async () => {
  // This child uses only stdin/stdout. It cannot post keys or record audio.
  const child = `process.stdout.write('prepared\\n'); process.stdin.once('data', data => { console.log(String(data) === 'y' ? 'sent' : 'unavailable'); process.stdin.destroy(); });`;
  let checked = 0;
  assert.equal(await runTypelessHelper(['-e', child], async () => { checked++; return true; }, { executable: process.execPath }), 'sent');
  assert.equal(checked, 1);
  assert.equal(await runTypelessHelper(['-e', child], async () => false, { executable: process.execPath }), 'unfocused');
  assert.equal(await runTypelessHelper(['-e', child], async () => { throw Error('note closed'); }, { executable: process.execPath }), 'unfocused');
  let unexpected = false;
  assert.equal(await runTypelessHelper(['-e', "console.log('permission')"], async () => { unexpected = true; return true; }, { executable: process.execPath }), 'permission');
  assert.equal(unexpected, false, 'A failed preflight never asks to authorize keys');
});

test('the real helper protocol handles missing executables, crashes and timeouts', async () => {
  assert.equal(await runTypelessHelper([], undefined, { executable: '/missing-papilot-typeless-helper' }), 'unavailable');
  assert.equal(await runTypelessHelper(['-e', 'process.exit(1)'], undefined, { executable: process.execPath }), 'unavailable');
  assert.equal(await runTypelessHelper(['-e', 'setInterval(() => {}, 1000)'], undefined, { executable: process.execPath, timeout: 30 }), 'unavailable');
});

test('native chords preserve Fn and modifier sides, rejecting unknown or ambiguous bindings', () => {
  assert.deepEqual(typelessChord('Fn'), [{ code: 63, flags: 1 << 23 }]);
  assert.deepEqual(typelessChord('LeftCtrl+F8'), [{ code: 59, flags: 1 << 18 }, { code: 100, flags: 0 }]);
  assert.deepEqual(typelessChord('RightAlt'), [{ code: 61, flags: 1 << 19 }]);
  for (const binding of ['', 'Mouse4', 'Fn+Unknown', 'A+B', 'LeftCmd+LeftCmd', 'LeftShift+RightShift', 'constructor']) assert.equal(typelessChord(binding), null, binding);
});

test('sending rereads configuration, checks focus afterwards and serializes requests without queuing toggles', async () => {
  let binding = 'Fn', focus = true, release: (() => void) | undefined;
  const calls: string[][] = [];
  const control = typelessControl({
    inspect: async () => ({ platform: 'darwin', installation: { status: 'detected', path: '/test/Typeless.app', version: 'test' }, shortcuts: { status: 'detected', source: 'featureShortcutBindings', bindings: [binding] }, control: { status: 'unverified', recording: 'unknown' } }),
    run: async args => { calls.push(args); if (args[0] === '--check') return 'ready'; await new Promise<void>(resolve => { release = resolve; }); return 'sent'; },
  });
  assert.deepEqual(await control.status(), { status: 'ready', shortcut: 'Fn' });
  binding = 'LeftCtrl+F8';
  const first = control.send(async () => focus);
  assert.deepEqual(await control.send(async () => focus), { status: 'busy' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], [String(process.pid), `${59}:${1 << 18}`, '100:0']);
  release!();
  assert.deepEqual(await first, { status: 'sent', shortcut: 'LeftCtrl+F8' });
  focus = false;
  assert.equal((await control.send(async () => focus)).status, 'unfocused');
  binding = 'Mouse4';
  assert.equal((await control.send(async () => true)).status, 'shortcut-unavailable');
  assert.equal(calls.length, 2, 'Neither focus loss nor an unsupported binding sends keys');
});

test('native failures are surfaced and do not leave the send lock held', async () => {
  let fail = true;
  const control = typelessControl({
    inspect: async () => ({ platform: 'darwin', installation: { status: 'detected', path: '/test/Typeless.app', version: 'test' }, shortcuts: { status: 'detected', source: 'featureShortcutBindings', bindings: ['Fn'] }, control: { status: 'unverified', recording: 'unknown' } }),
    run: async () => { if (fail) throw new Error('helper unavailable'); return 'permission'; },
  });
  assert.equal((await control.send(async () => true)).status, 'unavailable');
  fail = false;
  assert.equal((await control.send(async () => true)).status, 'permission');
});

test('the helper can recheck the original target after its startup delay', async () => {
  let focus = true, posted = false;
  const control = typelessControl({
    inspect: async () => ({ platform: 'darwin', installation: { status: 'detected', path: '/test/Typeless.app', version: 'test' }, shortcuts: { status: 'detected', source: 'featureShortcutBindings', bindings: ['Fn'] }, control: { status: 'unverified', recording: 'unknown' } }),
    run: async (_args, focused) => { focus = false; if (!await focused!()) return 'unfocused'; posted = true; return 'sent'; },
  });
  assert.equal((await control.send(async () => focus)).status, 'unfocused');
  assert.equal(posted, false);
});

test('dictation uses current configured bindings, including multiple keyboards', () => {
  assert.deepEqual(typelessShortcuts({
    featureShortcutBindings: { dictationMode: ['Fn', 'LeftCtrl+F8', 'Fn'], askAnythingMode: ['Fn+Space'] },
    keyboardShortcut: { pushToTalk: 'RightAlt' },
  }), { status: 'detected', bindings: ['Fn', 'LeftCtrl+F8'], source: 'featureShortcutBindings' });
});

test('empty or malformed current bindings never fall back to stale legacy bindings', () => {
  assert.deepEqual(typelessShortcuts({ featureShortcutBindings: { dictationMode: [] }, keyboardShortcut: { pushToTalk: 'Fn' } }), {
    status: 'detected', bindings: [], source: 'featureShortcutBindings',
  });
  for (const current of [null, {}, [], { dictationMode: 'Fn' }, { dictationMode: ['Fn', null] }, { dictationMode: [' '] }]) {
    assert.equal(typelessShortcuts({ featureShortcutBindings: current, keyboardShortcut: { pushToTalk: 'Fn' } }).status, 'unavailable');
  }
});

test('legacy shortcuts are read only when configured; missing settings do not assume Fn', () => {
  assert.deepEqual(typelessShortcuts({ keyboardShortcut: { pushToTalk: 'LeftCtrl+F8', handlesFreeMode: 'Fn+Space' } }), {
    status: 'detected', bindings: ['LeftCtrl+F8'], source: 'keyboardShortcut',
  });
  for (const settings of [undefined, null, [], {}, { keyboardShortcut: {} }, { keyboardShortcut: { pushToTalk: '' } }]) {
    assert.equal(typelessShortcuts(settings).status, 'unavailable');
  }
});

test('the probe validates the app identity, reads only shortcut settings and leaves control unverified', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'papilot-typeless-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'Library', 'Application Support', 'Typeless');
  await mkdir(directory, { recursive: true });
  const settings = path.join(directory, 'app-settings.json');
  await writeFile(settings, JSON.stringify({ featureShortcutBindings: { dictationMode: ['Fn'] }, unrelatedPrivateSetting: 'never-return-this' }));
  const visited: string[] = [];
  const options = { platform: 'darwin', home, applications: ['system', 'user'], bundle: async (directory: string) => {
    visited.push(directory);
    return { id: directory.startsWith('system') ? 'another.typeless.app' : 'now.typeless.desktop', version: '2.11.0' };
  } };
  const detected = await inspectTypeless(options);
  assert.deepEqual(visited, [path.join('system', 'Typeless.app'), path.join('user', 'Typeless.app')]);
  assert.deepEqual(detected.installation, { status: 'detected', path: path.join('user', 'Typeless.app'), version: '2.11.0' });
  assert.equal(detected.shortcuts.status, 'detected');
  assert.deepEqual(detected.control, { status: 'unverified', recording: 'unknown' });
  assert.ok(!JSON.stringify(detected).includes('never-return-this'));
  await writeFile(settings, '{');
  assert.deepEqual((await inspectTypeless(options)).shortcuts, { status: 'unavailable', reason: 'invalid' });
  await rm(settings);
  assert.deepEqual((await inspectTypeless(options)).shortcuts, { status: 'unavailable', reason: 'unreadable' });
});

test('an unsupported platform or undetected app does not imply a usable integration', async () => {
  let reads = 0;
  const unsupported = await inspectTypeless({ platform: 'win32', bundle: async () => { reads++; throw new Error('must not inspect a Mac bundle'); } });
  assert.equal(reads, 0);
  assert.equal(unsupported.installation.status, 'unsupported-platform');
  assert.equal(unsupported.control.recording, 'unknown');
  const absent = await inspectTypeless({ platform: 'darwin', applications: [], home: '/not-used' });
  assert.equal(absent.installation.status, 'not-detected');
  assert.equal(absent.shortcuts.status, 'unavailable');
});
