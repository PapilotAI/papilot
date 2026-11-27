import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import net from 'node:net';
import { chromium } from '../../scripts/playwright.mjs';
import { connectWebviews } from './webview-targets.mjs';
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
const host = path.join(temp, 'host.cjs');
await build({ entryPoints: [path.join(root, 'tests/host.ts')], outfile: host, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
fs.mkdirSync(path.join(temp, 'user/User'), { recursive: true });
fs.writeFileSync(path.join(temp, 'user/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'window.titleBarStyle': 'custom', 'workbench.startupEditor': 'none', 'update.mode': 'none', 'extensions.autoUpdate': false, 'chat.disableAIFeatures': true }));
console.log(temp);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(process.env.PAPILOT_CODE || 'code', ['--wait', '--new-window', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', path.join(temp, 'user'), '--extensions-dir', path.join(temp, 'extensions'), '--extensionDevelopmentPath', extension, '--extensionTestsPath', host, `--remote-debugging-port=${port}`, fixture], {
  env: { ...process.env, PAPILOT_WORKTREES: path.join(temp, 'worktrees'), PAPILOT_MEMORY: path.join(temp, 'memory.md'), PAPILOT_HOST_ARTIFACTS: temp, PAPILOT_HOST_INSPECT: '1' }, stdio: 'inherit',
});
let exited = false;
const completion = new Promise(resolve => child.on('exit', (code, signal) => { exited = true; resolve(signal || code); }));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostError = path.join(temp, 'host-error');
async function waitFor(check, message) {
  const deadline = Date.now() + 120000;
  while (Date.now() <= deadline) {
    if (fs.existsSync(hostError)) throw new Error(fs.readFileSync(hostError, 'utf8'));
    if (exited) throw new Error(`${message} VS Code exited with status ${await completion}.`);
    const result = await check();
    if (result) return result;
    await wait(200);
  }
  throw new Error(message);
}
const waitForHost = (marker, message) => waitFor(() => fs.existsSync(path.join(temp, marker)), message);
const stageButton = (view, click) => {
  const button = [...view.querySelectorAll('button')].find(button => /^Stage(?: all)?(?: \(|$)/.test(button.textContent.trim()));
  if (click) button?.click();
  return Boolean(button);
};
const reviewStyle = view => {
  const canvas = view.querySelector('.paper-slice canvas'), strips = [...view.querySelectorAll('.pdf-strip img')];
  if (!canvas || !strips.length || strips.some(image => !image.naturalWidth || !image.getClientRects().length)) return;
  const style = element => view.defaultView.getComputedStyle(element);
  return { theme: view.documentElement.dataset.theme, page: style(canvas).filter, strips: strips.map(image => style(image).filter),
    marks: [...view.querySelectorAll('.pdf-focus-marks, .pdf-unit-marks')].map(mark => style(mark).mixBlendMode) };
};
let browser, webviews;
try {
  await waitForHost('host-ready', 'VS Code host checks did not finish.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  webviews = await connectWebviews(port, page);
  await waitFor(() => webviews.find(view => view.body.innerText.includes('Select a task in Papers, or start a new conversation.')), 'The conversation did not render.');
  const paper = await waitFor(() => webviews.find(view => Boolean(view.querySelector('canvas'))), 'The PDF did not render.');
  await page.screenshot({ path: path.join(temp, 'native-dark.png') });
  assert.ok(await paper(view => {
    const button = [...view.querySelectorAll('button')].find(button => button.textContent.trim() === 'Changes');
    button?.click();
    return Boolean(button);
  }), 'The PDF did not offer a Changes button.');
  const review = await waitFor(() => webviews.find(stageButton), 'Working changes did not become reviewable.');
  // Full PDF pages and changed passages must use the same theme. The latter
  // are images, so inheriting a light CSS text color cannot make them readable.
  const dark = await waitFor(() => review(reviewStyle), 'The review did not render its PDF and changed passages.');
  assert.notEqual(dark.page, 'none', 'The dark PDF page was not themed.');
  for (const filter of dark.strips) assert.equal(filter, dark.page);
  for (const mode of dark.marks) assert.equal(mode, 'screen');
  await page.screenshot({ path: path.join(temp, 'native-review-pending-dark.png') });
  assert.ok(await review(stageButton, true));
  await waitFor(() => review(view => view.body.innerText.includes('Save your edited files before applying or rejecting changes.')), 'Review did not prompt to save the draft.');
  if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture, encoding: 'utf8' }).trim()) throw new Error('Review staged a dirty editor.');
  fs.writeFileSync(path.join(temp, 'revert-draft'), 'ready');
  await waitForHost('draft-reverted', 'The native editor did not clear its draft.');
  assert.ok(await review(stageButton, true));
  await waitFor(async () => {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture, encoding: 'utf8' }).trim();
    if (staged === 'paper/main.tex') return true;
    const alerts = await review(view => [...view.querySelectorAll('[role=alert]')].map(alert => alert.textContent));
    if (alerts?.length) console.log(alerts);
    return false;
  }, 'Review did not stage the paper in Git.');
  await page.screenshot({ path: path.join(temp, 'native-review-dark.png') });
  fs.writeFileSync(path.join(temp, 'light-theme'), 'ready');
  const light = await waitFor(async () => {
    const style = await review(reviewStyle);
    return style?.theme === 'light' && style;
  }, 'The review did not switch to the light theme.');
  for (const filter of light.strips) assert.equal(filter, 'none');
  for (const mode of light.marks) assert.equal(mode, 'multiply');
  await page.screenshot({ path: path.join(temp, 'native-review-light.png') });
  console.log('Native host passed: independent papers, source navigation, diagnostics, rendered PDF, separate conversation and Git staging from review.');
  fs.writeFileSync(path.join(temp, 'inspected'), 'done');
  await browser.close(); browser = undefined;
  const code = await completion;
  if (fs.existsSync(hostError)) throw new Error(fs.readFileSync(hostError, 'utf8'));
  if (code !== 0) throw new Error(`VS Code exited with status ${code}.`);
} finally {
  webviews?.close();
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
