import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { extract } from 'tar';
import { npmCli } from '../../../engine/src/core/platform.mjs';
const extension = fileURLToPath(new URL('..', import.meta.url)), root = path.resolve(extension, '../..');
const npm = npmCli(), runtime = path.join(extension, 'runtime');
const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, stdio: 'inherit' });
run(['run', 'build'], root);
run(['run', 'build'], path.join(root, 'engine'));
run(['run', 'typecheck'], extension);
run(['run', 'build'], extension);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-vsix-'));
try {
  const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }));
  await fs.rm(runtime, { recursive: true, force: true });
  await fs.mkdir(runtime, { recursive: true });
  await extract({ file: path.join(temporary, packed[0].filename), cwd: runtime, strip: 1 });
  await fs.copyFile(path.join(root, 'package-lock.json'), path.join(runtime, 'package-lock.json'));
  run(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
  run(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(runtime, 'engine'));
  // Use the same pinned optional SDKs as the existing bundled runtime.
  const agents = JSON.parse(await fs.readFile(path.join(root, 'nix/runtime/package.json'), 'utf8')).dependencies;
  // These are development dependencies in the source checkout. Promote them
  // in the staged manifest so --omit=dev actually includes them in the VSIX.
  run(['install', '--save-prod', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...Object.entries(agents).map(([name, version]) => `${name}@${version}`)], runtime);
  for (const name of Object.keys(agents)) await fs.access(path.join(runtime, 'node_modules', name, 'package.json'));
  const target = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
  run(['exec', '--', 'vsce', 'package', '--no-dependencies', '--allow-missing-repository', '--target', target], extension);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
