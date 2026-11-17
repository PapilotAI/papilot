import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chooseFolder, closeFolderPicker, pickerCommands } from '../src/server/folder-picker.ts';
import { isLocalRequest } from '../src/server/security.ts';

const title = 'Choose "paper" `$(touch hacked)`', start = '/Users/you/papers & "notes"';

test('system pickers receive the title and start folder as data, not script text', () => {
  const [mac] = pickerCommands('darwin', {}, title, start);
  assert.equal(mac.command, 'osascript');
  assert.deepEqual(mac.args.slice(-2), [title, start]);
  assert.ok(mac.args.slice(0, -2).every(arg => !arg.includes('paper')));
  const [windows] = pickerCommands('win32', {}, title, start);
  assert.deepEqual(windows.env, { PAPILOT_PICKER_TITLE: title, PAPILOT_PICKER_START: start });
  assert.ok(windows.args.every(arg => !arg.includes('paper')));
  assert.deepEqual(pickerCommands('linux', {}, title, start), [], 'A server without a display cannot show a picker');
  assert.deepEqual(pickerCommands('linux', { WAYLAND_DISPLAY: 'wayland-0' }, title, start).map(command => command.command), ['zenity', 'kdialog']);
});

test('only direct requests on this computer may open the system picker', () => {
  assert.equal(isLocalRequest({ host: '127.0.0.1:7274' }, 7274), true);
  assert.equal(isLocalRequest({ host: 'localhost:7274' }, 7274), true);
  assert.equal(isLocalRequest({ host: 'laptop.tailnet.ts.net', 'tailscale-user-login': 'me@example.com' }, 7274), false);
  assert.equal(isLocalRequest({ host: '127.0.0.1:7274', 'x-forwarded-for': '100.64.0.2' }, 7274), false);
  assert.equal(isLocalRequest({ host: '127.0.0.1:7274', 'tailscale-user-login': 'me@example.com' }, 7274), false);
});

// Fake Linux pickers on PATH exercise selection, cancellation and fallbacks without a display.
test('Linux pickers report choices, cancellation and unavailability', { skip: process.platform === 'win32' && 'Uses POSIX shell scripts.' }, async t => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-picker-')), PATH = process.env.PATH;
  t.after(() => { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); });
  process.env.PATH = bin;
  const env = { DISPLAY: ':0' };
  const write = (name: string, body: string) => { fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body); fs.chmodSync(path.join(bin, name), 0o755); };
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { unavailable: true });
  write('kdialog', 'printf "%s\\n" "$2/kde paper"');
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { path: '/home/you/kde paper' }, 'kdialog is used when zenity is missing');
  write('zenity', 'sleep 0.2; printf "%s\\n" "$6chosen/"');
  const [first, second] = await Promise.all([chooseFolder('Choose', '/home/you', undefined, 'linux', env), chooseFolder('Again', '/elsewhere', undefined, 'linux', env)]);
  assert.deepEqual(first, { path: '/home/you/chosen' });
  assert.equal(second, first, 'A second request waits for the open picker instead of showing another');
  write('zenity', 'exit 1');
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { path: null });
  write('zenity', "printf '%s\\n' 'E:\\'");
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { path: 'E:\\' }, 'A drive root keeps its separator');
  write('zenity', 'echo "Gtk-WARNING: cannot open display" >&2; exit 5');
  const warn = t.mock.method(console, 'warn', () => undefined);
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { unavailable: true }, 'A picker that cannot show browses in the page');
  assert.match(String(warn.mock.calls[0].arguments[0]), /cannot open display/);
});

test('a shared picker closes only after every waiting request leaves', { skip: process.platform === 'win32' && 'Uses POSIX shell scripts.' }, async t => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-picker-')), PATH = process.env.PATH, marker = path.join(bin, 'stopped');
  t.after(() => { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); });
  process.env.PATH = bin + path.delimiter + PATH;
  // The fake picker answers after a moment unless it is stopped first.
  fs.writeFileSync(path.join(bin, 'zenity'), `#!/bin/sh\ntrap 'touch "${marker}"; exit 143' TERM\nsleep 0.4 & wait $!\nprintf "/home/you/kept\\n"\n`); fs.chmodSync(path.join(bin, 'zenity'), 0o755);
  const env = { DISPLAY: ':0' }, first = new AbortController(), second = new AbortController();
  const one = chooseFolder('Choose', '/home/you', first.signal, 'linux', env), two = chooseFolder('Choose', '/home/you', second.signal, 'linux', env);
  first.abort();
  await assert.rejects(one, { name: 'AbortError' });
  assert.deepEqual(await two, { path: '/home/you/kept' }, 'The remaining request still receives the choice');
  assert.equal(fs.existsSync(marker), false);
  const alone = new AbortController(), only = chooseFolder('Choose', '/home/you', alone.signal, 'linux', env);
  setTimeout(() => alone.abort(), 50);
  await assert.rejects(only, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(marker), true, 'The picker stops when nobody is waiting');
  assert.deepEqual(await chooseFolder('Choose', '/home/you', undefined, 'linux', env), { path: '/home/you/kept' }, 'A new request opens a new picker');
});

test('an open picker closes when the server shuts down or exits', { skip: process.platform === 'win32' && 'Uses POSIX shell scripts.' }, async t => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-picker-')), PATH = process.env.PATH;
  const ready = path.join(bin, 'ready'), stopped = path.join(bin, 'stopped');
  t.after(() => { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); });
  process.env.PATH = bin + path.delimiter + PATH;
  // The fake picker stays open until it is stopped, and reports when it can be.
  fs.writeFileSync(path.join(bin, 'zenity'), `#!/bin/sh\ntrap 'touch "${stopped}"; exit 143' TERM\ntouch "${ready}"\nsleep 30 & wait $!\n`); fs.chmodSync(path.join(bin, 'zenity'), 0o755);
  const until = async (file: string) => { for (let i = 0; i < 200 && !fs.existsSync(file); i++) await new Promise(resolve => setTimeout(resolve, 25)); return fs.existsSync(file); };
  const waiting = chooseFolder('Choose', '/home/you', undefined, 'linux', { DISPLAY: ':0' });
  assert.ok(await until(ready));
  closeFolderPicker();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.ok(await until(stopped), 'Shutdown closes the picker');
  fs.rmSync(ready); fs.rmSync(stopped);
  // A server that exits without shutting down, such as after its shutdown timeout, still closes the picker.
  const exiting = `import fs from 'node:fs';
import { chooseFolder } from ${JSON.stringify(new URL('../src/server/folder-picker.ts', import.meta.url).href)};
void chooseFolder('Choose', '/home/you', undefined, 'linux', { DISPLAY: ':0' }).catch(() => undefined);
const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(ready)})) { clearInterval(timer); process.exit(0); } }, 25);`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', exiting], { env: process.env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(await until(stopped), 'Exiting closes the picker');
});
