#!/usr/bin/env node
// The papilot command: starts the workspace, or adds the example paper first.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const usage = `Usage: papilot [demo | service install | service stop] [--port <number>] [--data <folder>]

  papilot                  Start Papilot at http://127.0.0.1:4317
  papilot demo             Add the example paper, then start
  papilot service install  Run Papilot in the background after login (macOS)
  papilot service stop     Stop the background service
  --port <number>          Listen on another local port (PAPILOT_PORT)
  --data <folder>          Keep state in another folder (PAPILOT_DATA, default ~/.papilot)
  --version                Print the version`;

const args = process.argv.slice(2);
let demo = false, service = '';
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === 'demo') demo = true;
  else if (arg === 'service' && ['install', 'stop'].includes(args[i + 1])) service = args[++i];
  else if (arg === '--port' && args[i + 1]) process.env.PAPILOT_PORT = args[++i];
  else if (arg === '--data' && args[i + 1]) process.env.PAPILOT_DATA = path.resolve(args[++i]);
  else if (arg === '--version' || arg === '-v') {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    process.exit(0);
  } else {
    console.log(usage);
    process.exit(arg === '--help' || arg === '-h' ? 0 : 1);
  }
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 22)) {
  console.error(`Papilot needs Node.js 22.22 or newer; this is ${process.versions.node}.`);
  process.exit(1);
}
if (spawnSync('latexmk', ['-v'], { stdio: 'ignore' }).error)
  console.warn('latexmk was not found. Install a TeX distribution such as MacTeX or TeX Live to build PDFs.');

// Node 22 marks node:sqlite as experimental; that notice is noise for users.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => String(warning).includes('SQLite') ? undefined : emitWarning.call(process, warning, ...rest);
process.env.PAPILOT_DATA ||= path.join(os.homedir(), '.papilot');
const { register } = await import('tsx/esm/api');
register();
if (service) {
  process.argv.splice(2, Infinity, service);
  await import('../scripts/service.ts');
} else {
  if (demo) await import('../scripts/demo.ts');
  await import('../src/server/main.ts');
}
