import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root = path.resolve(extension, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-vsix-')), runtime = path.join(extension, 'runtime');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
try {
  run(npm, ['run', 'build'], root);
  run(npm, ['run', 'build'], path.join(root, 'engine'));
  run(npm, ['run', 'build'], extension);
  const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }));
  fs.rmSync(runtime, { recursive: true, force: true }); fs.mkdirSync(runtime);
  run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', path.join(temporary, packed[0].filename), '--strip-components=1', '-C', runtime], root);
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(runtime, 'package-lock.json'));
  fs.mkdirSync(path.join(runtime, 'vscode/src'), { recursive: true });
  fs.copyFileSync(path.join(extension, 'src/worker.ts'), path.join(runtime, 'vscode/src/worker.ts'));
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(runtime, 'engine'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(extension, 'LICENSE'));
  run(process.execPath, [path.join(extension, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--target', `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`, '--out', path.join(extension, `papilot-${process.platform}-${process.arch}.vsix`)], extension);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
