import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const extension = fileURLToPath(new URL('..', import.meta.url)), root = path.resolve(extension, '../..');
const testedExtension = process.env.PAPILOT_VSCODE_EXTENSION_PATH || extension;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-vscode-')), repo = path.join(home, 'paper'), report = path.join(home, 'report.json');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(home, 'no-hooks'));
fs.writeFileSync(path.join(repo, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nOriginal wording.\n\\end{document}\n');
git('add', '.'); git('commit', '-qm', 'Initial');
// Start in a multi-folder workspace: converting a folder window during a test
// restarts the extension host and interrupts the running test.
const second = path.join(home, 'second'), workspace = path.join(home, 'papers.code-workspace');
fs.mkdirSync(second);
fs.writeFileSync(workspace, JSON.stringify({ folders: [{ path: repo }, { path: second }] }));
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const code = process.env.PAPILOT_VSCODE_EXECUTABLE || (process.platform === 'win32' ? 'code.cmd' : 'code');
let display;
const environment = { ...process.env, PAPILOT_EXTENSION_TEST: '1', PAPILOT_TEST_REPORT: report, PAPILOT_TEST_ROOT: root, PAPILOT_TEST_DEBUG_PORT: String(port) };
if (process.platform === 'linux') {
  display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1440x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] });
  const number = await new Promise((resolve, reject) => { display.once('error', reject); display.stdio[3].once('data', data => resolve(String(data).trim())); });
  environment.DISPLAY = `:${number}`;
  delete environment.WAYLAND_DISPLAY;
}
const child = spawn(code, ['--new-window', '--wait', '--disable-workspace-trust', '--disable-extensions', '--skip-welcome', '--skip-release-notes',
  '--user-data-dir', path.join(home, 'user'), '--extensions-dir', path.join(home, 'extensions'),
  `--remote-debugging-port=${port}`, `--extensionDevelopmentPath=${testedExtension}`, `--extensionTestsPath=${path.join(extension, 'dist/vscode-test.cjs')}`, workspace],
  { stdio: 'inherit', env: environment });
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 180000);
try {
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : { ok: false, error: `VS Code exited with ${code} before writing its report.` };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) { console.error(`Test files: ${home}`); process.exitCode = 1; }
  else {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (await fetch(result.url + 'api/health').then(() => true, () => false)) throw new Error('Papilot kept serving after the extension host exited.');
    fs.rmSync(home, { recursive: true, force: true });
  }
} finally { clearTimeout(timeout); display?.kill(); }
