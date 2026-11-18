import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the macOS signer scans unpacked dependencies with only 256 file descriptors', { skip: process.platform === 'win32' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-signing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const framework = path.join(directory, 'Example.framework');
  fs.mkdirSync(framework);
  const expected = [framework];
  for (let i = 0; i < 1200; i++) {
    const file = path.join(framework, `binary-${i}`);
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3]));
    expected.push(file);
  }
  fs.writeFileSync(path.join(framework, 'index.js'), 'export const value = 1;\n');
  const temporary = path.join(framework, 'old.cstemp');
  fs.writeFileSync(temporary, 'old signature');
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const walker = path.join(path.dirname(appBuilderRequire.resolve('@electron/osx-sign')), 'util.js');
  const preload = fileURLToPath(new URL('../scripts/desktop-signing.cjs', import.meta.url));
  // Set both limits: Node raises a soft limit to the hard limit at startup.
  const result = spawnSync('bash', ['-c', 'ulimit -n 256; exec "$@"', 'signing-test',
    process.execPath, '--require', preload, '-e',
    'require(process.argv[1]).walkAsync(process.argv[2]).then(files => console.log(JSON.stringify(files)))', walker, directory],
  { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).sort(), expected.sort());
  assert.equal(fs.existsSync(temporary), false);
});
