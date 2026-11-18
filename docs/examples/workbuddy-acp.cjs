const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const entry = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
if (!fs.existsSync(entry)) { console.error('Install WorkBuddy for this user before using its ACP launcher.'); process.exit(1); }
const args = process.argv.slice(2);
const acp = args.includes('--acp');
if (acp) {
  if (!args.includes('--serve')) args.unshift('--serve');
  args.push('--host', '127.0.0.1', '--port', '0', '--auth', 'password');
}
const env = { ...process.env, CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1', CODEBUDDY_CONFIG_DIR: process.env.PAPILOT_WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy', 'papilot-acp'), CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1' };
const child = spawn(process.execPath, [entry, ...args], { cwd: process.cwd(), env, stdio: ['inherit', acp ? 'pipe' : 'inherit', 'inherit'], windowsHide: true });
if (acp) createInterface({ input: child.stdout }).on('line', line => {
  try { if (JSON.parse(line)?.jsonrpc === '2.0') process.stdout.write(line + '\n'); } catch { /* The native HTTP startup banner is not ACP. */ }
});
child.once('error', error => { console.error(error.message); process.exit(1); });
child.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
