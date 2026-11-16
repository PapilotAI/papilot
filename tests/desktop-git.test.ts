import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bundledGitEnvironment, withBundledGit } from '../desktop/git.ts';
import { verifyGitArchive } from '../scripts/bundle-git.mjs';

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundled = path.join(root, 'bundled');
  for (const name of ['bin/git', 'cmd/git.exe']) {
    const file = path.join(bundled, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture', { mode: 0o755 });
  }
  return { root, bundled };
}

test('desktop without a Git distribution leaves source and managed environments alone', async t => {
  const f = fixture(t), env = { PATH: '' };
  assert.equal(await withBundledGit(env, path.join(f.root, 'absent')), env);
});

test('a missing Git falls back without changing the inherited environment', async t => {
  const { bundled } = fixture(t), env = { PATH: '', GIT_AUTHOR_NAME: 'Author', GIT_CONFIG_GLOBAL: '/author/config' };
  const result = await withBundledGit(env, bundled);
  assert.notEqual(result, env); assert.equal(env.PATH, '');
  assert.equal(result.GIT_AUTHOR_NAME, 'Author'); assert.equal(result.GIT_CONFIG_GLOBAL, '/author/config');
  assert.ok(result.PATH!.startsWith(path.join(bundled, process.platform === 'win32' ? 'cmd' : 'bin')));
  assert.ok(result.GIT_EXEC_PATH!.startsWith(bundled));
});

test('keep a working system Git, but replace a broken executable', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), system = path.join(f.root, 'system'); fs.mkdirSync(system);
  fs.writeFileSync(path.join(system, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { PATH: system, GIT_EXEC_PATH: '/custom/helpers' }, seen: string[] = [];
  const working = await withBundledGit(env, f.bundled, 'linux', 'x64', async file => { seen.push(file); return true; });
  assert.equal(working, env); assert.deepEqual(seen, [path.join(system, 'git')]);
  const broken = await withBundledGit(env, f.bundled, 'linux', 'x64', async () => false);
  assert.equal(broken.GIT_EXEC_PATH, path.join(f.bundled, 'libexec/git-core'));
});

test('macOS fallback never executes the installer placeholder without developer tools', { skip: process.platform !== 'darwin' }, async t => {
  const f = fixture(t), seen: string[] = [];
  const result = await withBundledGit({ PATH: '/usr/bin' }, f.bundled, 'darwin', 'arm64', async file => { seen.push(file); return false; });
  assert.deepEqual(seen, ['/usr/bin/xcode-select']);
  assert.equal(result.GIT_EXEC_PATH, path.join(f.bundled, 'libexec/git-core'));
});

test('relocated distributions use their own helpers and retain explicit author configuration', () => {
  const directory = path.resolve('with spaces', 'Git');
  const base = { PATH: '/tools', Path: 'C:\\tools', GIT_TEMPLATE_DIR: '/templates', GIT_SSL_CAINFO: '/company/ca.pem', GIT_CONFIG_SYSTEM: '/company/gitconfig' };
  for (const platform of ['darwin', 'linux', 'win32'] as const) for (const arch of ['x64', 'arm64'] as const) {
    const env = bundledGitEnvironment(base, directory, platform, arch);
    assert.equal(env.GIT_CONFIG_SYSTEM, base.GIT_CONFIG_SYSTEM);
    assert.equal(env.GIT_TEMPLATE_DIR, base.GIT_TEMPLATE_DIR);
    assert.equal(env.GIT_SSL_CAINFO, base.GIT_SSL_CAINFO);
    if (platform === 'win32') {
      assert.equal(env.Path, undefined);
      assert.equal(env.GIT_EXEC_PATH, path.join(directory, arch === 'arm64' ? 'clangarm64' : 'ucrt64', 'libexec/git-core'));
      assert.ok(env.PATH!.includes(path.join(directory, 'usr/bin')));
    } else assert.equal(env.GIT_EXEC_PATH, path.join(directory, 'libexec/git-core'));
    if (platform === 'linux') assert.equal(env.PREFIX, directory);
  }
  const linux = bundledGitEnvironment({}, directory, 'linux');
  assert.equal(linux.GIT_TEMPLATE_DIR, path.join(directory, 'share/git-core/templates'));
  assert.equal(linux.GIT_SSL_CAINFO, path.join(directory, 'ssl/cacert.pem'));
});

test('Git downloads are verified against the checked-in checksum before extraction', () => {
  const archive = Buffer.from('trusted archive'), checksum = createHash('sha256').update(archive).digest('hex');
  verifyGitArchive(archive, checksum);
  assert.throws(() => verifyGitArchive(Buffer.from('changed archive'), checksum), /checksum mismatch/);
});
