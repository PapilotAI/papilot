import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import net from 'node:net';
import { chromium, expect } from '../../scripts/playwright.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-vscode-host-'));
const fixture = path.join(temp, 'project'); fs.mkdirSync(fixture);
let extension = root;
if (process.env.PAPILOT_TEST_VSIX) {
  const unpacked = path.join(temp, 'package');
  execFileSync('unzip', ['-q', path.resolve(process.env.INIT_CWD || process.cwd(), process.env.PAPILOT_TEST_VSIX), '-d', unpacked]);
  extension = path.join(unpacked, 'extension');
}
for (const [folder, text] of [['paper', 'Paper text.'], ['slides', 'Slide text.']]) {
  fs.mkdirSync(path.join(fixture, folder));
  fs.writeFileSync(path.join(fixture, folder, 'main.tex'), `\\documentclass{article}\n\\begin{document}\n${text}\n\\end{document}\n`);
}
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'ignore' });
git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Initial');
await build({ entryPoints: [path.join(root, 'tests/host.ts')], outfile: path.join(root, 'dist/host.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
fs.mkdirSync(path.join(temp, 'user/User'), { recursive: true });
fs.writeFileSync(path.join(temp, 'user/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'window.titleBarStyle': 'custom', 'workbench.startupEditor': 'none', 'update.mode': 'none', 'extensions.autoUpdate': false, 'chat.disableAIFeatures': true }));
console.log(temp);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(process.env.PAPILOT_CODE || 'code', ['--wait', '--new-window', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', path.join(temp, 'user'), '--extensions-dir', path.join(temp, 'extensions'), '--extensionDevelopmentPath', extension, '--extensionTestsPath', path.join(root, 'dist/host.cjs'), `--remote-debugging-port=${port}`, fixture], {
  env: { ...process.env, PAPILOT_WORKTREES: path.join(temp, 'worktrees'), PAPILOT_MEMORY: path.join(temp, 'memory.md'), PAPILOT_HOST_ARTIFACTS: temp, PAPILOT_HOST_INSPECT: '1' }, stdio: 'inherit',
});
let exited = false;
const completion = new Promise(resolve => child.on('exit', (code, signal) => { exited = true; resolve(signal || code); }));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostError = path.join(temp, 'host-error');
async function waitForHost(marker, message, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!fs.existsSync(path.join(temp, marker))) {
    if (fs.existsSync(hostError)) throw new Error(fs.readFileSync(hostError, 'utf8'));
    if (exited) throw new Error(`${message} VS Code exited with status ${await completion}.`);
    if (Date.now() > deadline) throw new Error(message);
    await wait(200);
  }
}
let browser;
try {
  await waitForHost('host-ready', 'VS Code host checks did not finish.');
  const deadline = Date.now() + 120000;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const frames = async () => {
    const found = [];
    for (const frame of page.frames()) {
      if (!await frame.locator('#root').count()) continue;
      let visible = true;
      for (let ancestor = frame; ancestor.parentFrame(); ancestor = ancestor.parentFrame()) {
        if (!await (await ancestor.frameElement()).isVisible()) { visible = false; break; }
      }
      if (visible) found.push(frame);
    }
    return found;
  };
  let paper, chat;
  while (Date.now() < deadline) {
    const candidates = await frames();
    paper = candidates.find(frame => frame.url().includes('purpose=webviewView') === false && frame !== page.mainFrame());
    for (const frame of candidates) {
      if (await frame.getByText('Select a task in Papers, or start a new conversation.').count()) chat = frame;
      if (await frame.locator('canvas').count()) paper = frame;
    }
    if (chat && paper && await paper.locator('canvas').count()) break;
    await wait(200);
  }
  if (!chat || !paper || !await paper.locator('canvas').count()) throw new Error('The PDF or conversation webview did not render.');
  await page.screenshot({ path: path.join(temp, 'native-dark.png') });
  await paper.getByRole('button', { name: 'Changes', exact: true }).click();
  let review;
  const reviewDeadline = Date.now() + 120000;
  while (Date.now() < reviewDeadline) {
    for (const frame of await frames()) if (await frame.getByRole('button', { name: /^Stage(?: all)?(?: \(|$)/ }).count()) review = frame;
    if (review) break;
    await wait(200);
  }
  if (!review) throw new Error('Working changes did not become reviewable.');
  // Full PDF pages and changed passages must use the same theme. The latter
  // are images, so inheriting a light CSS text color cannot make them readable.
  const strips = review.locator('.pdf-strip img');
  await expect(strips.first()).toBeVisible();
  const pageFilter = await review.locator('.paper-slice canvas').first().evaluate(element => getComputedStyle(element).filter);
  if (pageFilter === 'none') throw new Error('The dark PDF page was not themed.');
  for (const strip of await strips.all()) await expect(strip).toHaveCSS('filter', pageFilter);
  for (const marks of await review.locator('.pdf-focus-marks, .pdf-unit-marks').all()) await expect(marks).toHaveCSS('mix-blend-mode', 'screen');
  await page.screenshot({ path: path.join(temp, 'native-review-pending-dark.png') });
  await review.getByRole('button', { name: /^Stage(?: all)?(?: \(|$)/ }).first().click();
  await expect(review.getByText('Save your edited files before applying or rejecting changes.', { exact: true })).toBeVisible();
  if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture, encoding: 'utf8' }).trim()) throw new Error('Review staged a dirty editor.');
  fs.writeFileSync(path.join(temp, 'revert-draft'), 'ready');
  await waitForHost('draft-reverted', 'The native editor did not clear its draft.');
  await review.getByRole('button', { name: /^Stage(?: all)?(?: \(|$)/ }).first().click();
  const stagingDeadline = Date.now() + 120000;
  while (Date.now() < stagingDeadline) {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture, encoding: 'utf8' }).trim();
    if (staged === 'paper/main.tex') break;
    if (await review.getByRole('alert').count()) console.log(await review.getByRole('alert').allTextContents());
    await wait(200);
  }
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture, encoding: 'utf8' }).trim();
  if (staged !== 'paper/main.tex') throw new Error('Review did not stage the paper in Git.');
  await page.screenshot({ path: path.join(temp, 'native-review-dark.png') });
  fs.writeFileSync(path.join(temp, 'light-theme'), 'ready');
  await expect(review.locator('html')).toHaveAttribute('data-theme', 'light');
  for (const strip of await strips.all()) await expect(strip).toHaveCSS('filter', 'none');
  for (const marks of await review.locator('.pdf-focus-marks, .pdf-unit-marks').all()) await expect(marks).toHaveCSS('mix-blend-mode', 'multiply');
  await page.screenshot({ path: path.join(temp, 'native-review-light.png') });
  console.log('Native host passed: independent papers, source navigation, diagnostics, rendered PDF, separate conversation and Git staging from review.');
  fs.writeFileSync(path.join(temp, 'inspected'), 'done');
  await browser.close(); browser = undefined;
  const code = await completion;
  if (fs.existsSync(hostError)) throw new Error(fs.readFileSync(hostError, 'utf8'));
  if (code !== 0) throw new Error(`VS Code exited with status ${code}.`);
} finally {
  if (browser && !exited) {
    // This connection belongs to the isolated test window, never the user's editor.
    const session = await browser.newBrowserCDPSession().catch(() => null);
    await session?.send('Browser.close').catch(() => undefined);
  }
  await browser?.close();
  fs.writeFileSync(path.join(temp, 'inspected'), 'done');
  if (!exited) child.kill();
  if (!process.env.PAPILOT_HOST_INSPECT) fs.rmSync(temp, { recursive: true, force: true });
}
