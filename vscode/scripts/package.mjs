import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { npmCli } from '../../engine/src/core/platform.mjs';
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root = path.resolve(extension, '..');
const node = fs.realpathSync(process.execPath), nodeDirectory = path.dirname(node);
const nodeLicense = [path.join(nodeDirectory, 'LICENSE'), path.resolve(nodeDirectory, '../LICENSE')].find(file => fs.existsSync(file));
if (!nodeLicense) throw new Error('Use an official Node.js distribution with its LICENSE file to package the VS Code extension.');
const npm = npmCli();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-vsix-')), runtime = path.join(extension, 'runtime');
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
  run(node, [npm, 'run', 'build'], root);
  run(node, [npm, 'run', 'build'], path.join(root, 'engine'));
  run(node, [npm, 'run', 'build'], extension);
  const packed = JSON.parse(execFileSync(node, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }));
  fs.rmSync(runtime, { recursive: true, force: true }); fs.mkdirSync(runtime);
  run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', path.join(temporary, packed[0].filename), '--strip-components=1', '-C', runtime], root);
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(runtime, 'package-lock.json'));
  const bin = path.join(runtime, 'bin');
  const bundledNode = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  // The npm archive already contains Papilot's CLI scripts in bin/.
  fs.copyFileSync(node, bundledNode);
  fs.chmodSync(bundledNode, 0o755);
  fs.copyFileSync(nodeLicense, path.join(runtime, 'NODE-LICENSE'));
  fs.mkdirSync(path.join(runtime, 'vscode/src'), { recursive: true });
  fs.copyFileSync(path.join(extension, 'src/worker.ts'), path.join(runtime, 'vscode/src/worker.ts'));
  run(node, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
  run(node, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(runtime, 'engine'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(extension, 'LICENSE'));
  run(node, [path.join(extension, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--target', `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`, '--out', path.join(extension, `papilot-${process.platform}-${process.arch}.vsix`)], extension);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
