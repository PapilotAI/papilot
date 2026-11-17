import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: true });
await fs.copyFile(path.join(root, 'src/runtime-worker.mjs'), path.join(root, 'dist/runtime-worker.mjs'));
await build({ absWorkingDir: root, entryPoints: ['tests/vscode.ts'], outfile: 'dist/vscode-test.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'] });
