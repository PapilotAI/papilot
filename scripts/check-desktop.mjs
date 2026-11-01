import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { _electron as electron, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';

const require = createRequire(import.meta.url);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-desktop-test-'));
const env = { ...process.env, PAPILOT_DESKTOP_DATA: data, PAPILOT_DESKTOP_NODE: process.execPath, PAPILOT_UPDATE_PROBE: '1', LANG: 'en_US.UTF-8' };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.PAPILOT_DESKTOP_EXECUTABLE;
if (packaged) {
  // Exercise the bundled tools with no development Node on PATH.
  env.PATH = '/usr/bin:/bin';
  const resources = process.env.PAPILOT_DESKTOP_RESOURCES || path.resolve(path.dirname(packaged), process.platform === 'darwin' ? '../Resources' : 'resources');
  const node = path.join(resources, 'runtime/bin/node'), server = path.join(resources, 'server');
  assert.match(execFileSync(node, ['--version'], { encoding: 'utf8' }), /^v\d+\./);
  assert.match(execFileSync(node, [path.join(resources, 'runtime/lib/node_modules/npm/bin/npm-cli.js'), '--version'], { encoding: 'utf8' }), /^\d+\./);
  assert.match(execFileSync(node, [path.join(server, 'node_modules/@openai/codex/bin/codex.js'), '--version'], { encoding: 'utf8' }), /codex-cli/);
  const help = execFileSync(node, ['--import', path.join(server, 'node_modules/tsx/dist/loader.mjs'), path.join(server, 'vendor/latex-review/src/cli.ts'), '--help'], { encoding: 'utf8', cwd: data, env });
  assert.match(help, /Usage:/);
}
// Keep Chromium's sandbox in native/CI checks. The opt-out is only for a
// disposable Docker container whose kernel disallows nested user namespaces.
const launch = () => electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : ['.desktop/app'], env,
  chromiumSandbox: process.env.PAPILOT_DESKTOP_TEST_CONTAINER !== '1', timeout: 90000 });
let application, origin;
try {
  application = await launch();
  const page = await application.firstWindow({ timeout: 90000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:*/', { timeout: 60000 });
  origin = new URL(page.url()).origin;
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.name, 'Papilot');
  assert.equal(health.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.ok(state.csrf); assert.equal(state.viewer.role, 'owner');
  assert.equal(state.projects.length, 1, 'First launch includes the demo paper');
  const demo = state.projects[0];
  const manuscript = await (await fetch(`${origin}/api/projects/${demo.id}/manuscript`)).json();
  assert.equal(manuscript.build.status, 'ready', 'The first PDF is ready without a local TeX build');
  const pdf = await fetch(`${origin}/api/projects/${demo.id}/manuscript.pdf?key=${manuscript.build.key}`);
  assert.equal(pdf.status, 200); assert.match(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), /%PDF-/);
  assert.equal(await page.locator('.desktop-window-drag').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')), 'drag');
  assert.equal(await page.evaluate(() => window.papilotDesktop?.platform), process.platform);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  assert.equal((await page.locator('.pdf-toolbar').boundingBox()).y, 0, 'The content toolbar reaches the top of the window');
  await page.getByRole('button', { name: /^(Hide task list|隐藏任务列表)$/ }).click();
  const restoreSidebar = page.getByRole('button', { name: /^(Show task list|显示任务列表)$/ });
  await expect(restoreSidebar).toBeVisible();
  assert.ok((await restoreSidebar.boundingBox()).x >= (process.platform === 'linux' ? 112 : 92), 'Controls never overlap the window buttons when the sidebar is hidden');
  await restoreSidebar.click();
  if (process.platform === 'linux') {
    const maximize = page.getByRole('button', { name: /^(Maximize or restore window|最大化或还原窗口)$/ });
    await maximize.click();
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
    await maximize.click();
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  }
  await expect(page.locator('.pdf-viewer canvas, .pdfViewer canvas').first()).toBeVisible({ timeout: 30000 });
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/desktop-demo-${packaged ? 'packaged' : 'dev'}.png` });
  assert.ok(fs.existsSync(path.join(data, 'papilot.sqlite')), 'The bundled Node runtime can open SQLite');
  const rejected = await fetch(`${origin}/api/state`, { headers: { Origin: 'https://example.com' } });
  assert.equal(rejected.status, 403, 'The ephemeral port still enforces origin checks');
  const status = await (await fetch(`${origin}/api/updates`)).json();
  assert.equal(status.canUpdate, false);
  assert.equal(status.downloadUrl, 'https://github.com/PapilotAI/papilot/releases/latest');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const windowOptions = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation };
  });
  assert.deepEqual(windowOptions, { sandbox: true, nodeIntegration: false, contextIsolation: true });
  const settings = page.getByRole('button', { name: /^(Settings|设置)$/ });
  await settings.click();
  await page.getByRole('button', { name: /^(Updates|版本更新)$/ }).click();
  await expect(page.getByRole('link', { name: /Download desktop updates|下载桌面版更新/ })).toBeVisible();
  assert.equal(await page.getByRole('combobox', { name: /Update channel|更新通道/ }).count(), 0);
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/desktop-${packaged ? 'packaged' : 'dev'}.png` });
  assert.deepEqual(errors, []);
  await page.evaluate(() => localStorage.setItem('papilot:desktop-smoke', 'keep draft'));
  await application.close(); application = null;
  await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) }), 'Quitting Electron stops its backend');
  application = await launch();
  const reopened = await application.firstWindow({ timeout: 90000 });
  await reopened.waitForURL(origin + '/');
  assert.equal(await reopened.evaluate(() => localStorage.getItem('papilot:desktop-smoke')), 'keep draft', 'Local preferences survive a desktop restart');
  await application.close(); application = null;
  const occupied = createServer();
  await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(Number(new URL(origin).port), '127.0.0.1', resolve); });
  try {
    application = await launch();
    const moved = await application.firstWindow({ timeout: 90000 });
    await moved.waitForURL('http://127.0.0.1:*/');
    assert.notEqual(new URL(moved.url()).origin, origin, 'An occupied saved port falls back to a free port');
    if (process.platform === 'linux') {
      const closed = application.waitForEvent('close');
      await moved.getByRole('button', { name: /^(Close window|关闭窗口)$/ }).click();
      await closed;
      const movedOrigin = new URL(moved.url()).origin;
      await assert.rejects(fetch(`${movedOrigin}/api/health`, { signal: AbortSignal.timeout(5000) }), 'Closing the Linux window stops the backend');
    } else await application.close();
    application = null;
  } finally { await new Promise(resolve => occupied.close(resolve)); }
  console.log(`Desktop smoke passed (${packaged ? 'packaged app' : 'development'}, ${health.version}).`);
} finally {
  await application?.close();
  fs.rmSync(data, { recursive: true, force: true });
}
