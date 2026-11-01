import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexExecutable } from '../bin/codex-executable.mjs';

test('Windows resolves global and local npm Codex packages without executing shell shims', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot codex '));
  try {
    const native = path.join(root, 'node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    fs.mkdirSync(path.dirname(native), { recursive: true }); fs.writeFileSync(native, '');
    fs.writeFileSync(path.join(root, 'codex'), '#!/bin/sh');
    assert.equal(codexExecutable('codex', { PATH: root }, 'win32', 'x64'), native);
    assert.equal(codexExecutable(path.join(root, 'node_modules/.bin/codex'), {}, 'win32', 'x64'), native);
    fs.rmSync(native);
    assert.equal(codexExecutable('codex', { PATH: root }, 'win32', 'x64'), undefined);
    const exe = path.join(root, 'codex.exe'); fs.writeFileSync(exe, '');
    assert.equal(codexExecutable('codex', { PATH: root }, 'win32', 'x64'), exe);
    assert.equal(codexExecutable(exe, {}, 'win32', 'x64'), exe);
    assert.equal(codexExecutable('codex', { PATH: root }, 'linux', 'x64'), path.join(root, 'codex'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Windows resolves the optional architecture package, including paths with spaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot codex '));
  try {
    const pkg = path.join(root, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64');
    const native = path.join(pkg, 'vendor/aarch64-pc-windows-msvc/bin/codex.exe');
    fs.mkdirSync(path.dirname(native), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex-win32-arm64' }));
    fs.writeFileSync(native, '');
    assert.equal(codexExecutable('codex', { PATH: root }, 'win32', 'arm64'), native);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
