import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';
import { buildLayer } from './desktop-layer.mjs';
import { findCommand } from '../engine/src/core/platform.mjs';
import { _electron as electron, expect } from './playwright.mjs';
import { selectOption, selectedValue } from './select.mjs';
import { checkDesktopNotifications } from './check-desktop-notifications.mjs';
import { checkWindowsHitRegions } from './check-desktop-windows.mjs';
import { assertInstalledTools } from './desktop-requirements.mjs';

const require = createRequire(import.meta.url);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-desktop-test-'));
if (process.platform === 'win32') fs.writeFileSync(path.join(data, 'environment.json'), JSON.stringify({ kind: 'native' }));
const env = { ...process.env, PAPILOT_DESKTOP_DATA: data, PAPILOT_DESKTOP_NODE: process.execPath, PAPILOT_UPDATE_PROBE: '1', LANG: 'en_US.UTF-8' };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.PAPILOT_DESKTOP_EXECUTABLE;
const packageManaged = process.env.PAPILOT_EXPECT_PACKAGE_MANAGED === '1';
const layerUpdates = Boolean(packaged && !packageManaged);
const resources = packaged && (process.env.PAPILOT_DESKTOP_RESOURCES || path.resolve(path.dirname(packaged), process.platform === 'darwin' ? '../Resources' : 'resources'));
const base = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
// A nightly dev build bundles a dev version.
const version = packaged ? JSON.parse(fs.readFileSync(path.join(resources, 'server/package.json'), 'utf8')).version : base;
if (packaged) {
  if (process.platform === 'win32') {
    const asar = require('@electron/asar'), archive = path.join(resources, 'app.asar'), helper = 'windows-update.ps1';
    assert.ok(!fs.existsSync(path.join(resources, helper)), 'The Windows installer helper has no loose resource');
    assert.ok(!asar.statFile(archive, helper).unpacked, 'The Windows installer helper is inside the app archive');
    assert.deepEqual(asar.extractFile(archive, helper), fs.readFileSync(path.join('desktop', helper)));
  }
  // Exercise the bundled tools with no development Node on PATH.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  const git = process.platform === 'win32' && findCommand('git');
  env.PATH = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), ...(git ? [path.dirname(git)] : [])].join(path.delimiter)
    : '/usr/bin:/bin';
  const node = path.join(resources, 'runtime/bin', process.platform === 'win32' ? 'node.exe' : 'node'), server = path.join(resources, 'server');
  assert.match(execFileSync(node, ['--version'], { encoding: 'utf8' }), /^v\d+\./);
  assert.match(execFileSync(node, [path.join(resources, 'runtime/lib/node_modules/npm/bin/npm-cli.js'), '--version'], { encoding: 'utf8' }), /^\d+\./);
  // Codex is a host tool; the installer does not carry it.
  assert.ok(!fs.existsSync(path.join(server, 'node_modules/@openai/codex')), 'the installer does not bundle Codex');
  const help = execFileSync(node, ['--import', pathToFileURL(path.join(server, 'node_modules/tsx/dist/loader.mjs')).href, path.join(server, 'engine/src/cli.ts'), '--help'], { encoding: 'utf8', cwd: data, env });
  assert.match(help, /Usage:/);
}
// Keep Chromium's sandbox in native/CI checks. The opt-out is only for a
// disposable Docker container whose kernel disallows nested user namespaces.
const launch = () => electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : ['.desktop/app'], env,
  chromiumSandbox: process.env.PAPILOT_DESKTOP_TEST_CONTAINER !== '1', timeout: 90000 });
async function dismissInitialSetup(page) {
  const requirements = await (await fetch(`${new URL(page.url()).origin}/api/runtime/requirements`)).json();
  assertInstalledTools(requirements, env);
  if (requirements.checks.some(check => !check.ok)) {
    const setup = page.getByRole('dialog', { name: /^(Git|LaTeX)$/ });
    await expect(setup).toBeVisible();
    await setup.getByRole('button', { name: /^(Close|关闭)$/ }).click();
    await expect(setup).toHaveCount(0);
  }
}
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
  assert.equal(health.version, version);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.ok(state.csrf); assert.equal('viewer' in state, false, 'Desktop uses the single-user workspace');
  assert.equal(state.projects.length, 1, 'First launch includes the demo paper');
  await dismissInitialSetup(page);
  const demo = state.projects[0];
  const manuscript = await (await fetch(`${origin}/api/projects/${demo.id}/manuscript`)).json();
  assert.equal(manuscript.build.status, 'ready', 'The first PDF is ready without a local TeX build');
  const pdf = await fetch(`${origin}/api/projects/${demo.id}/manuscript.pdf?key=${manuscript.build.key}`);
  assert.equal(pdf.status, 200); assert.match(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), /%PDF-/);
  assert.equal(await page.locator('.desktop-window-drag').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')), 'drag');
  assert.equal(await page.evaluate(() => window.papilotDesktop?.platform), process.platform);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  // The toolbar can re-render while the paper loads, so read its box until it settles.
  await expect.poll(async () => (await page.locator('.pdf-toolbar').boundingBox())?.y, { message: 'The content toolbar reaches the top of the window' }).toBe(0);
  await page.getByRole('button', { name: /^(Hide task list|隐藏任务列表)$/ }).click();
  const restoreSidebar = page.getByRole('button', { name: /^(Show task list|显示任务列表)$/ });
  await expect(restoreSidebar).toBeVisible();
  // Loading the paper can briefly replace this button after the visibility check.
  // Wait for the replacement while preserving each platform's window controls.
  const sidebarLeft = () => restoreSidebar.boundingBox().then(box => box?.x ?? null);
  if (process.platform === 'win32') await expect.poll(async () => await sidebarLeft() ?? Infinity).toBeLessThan(92);
  else await expect.poll(async () => await sidebarLeft() ?? -Infinity, {
    message: 'Controls never overlap the window buttons when the sidebar is hidden',
  }).toBeGreaterThanOrEqual(process.platform === 'linux' ? 112 : 92);
  await restoreSidebar.click();
  if (process.platform === 'win32') {
    const buttons = page.locator('.desktop-window-buttons button');
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', /^(Minimize window|最小化窗口)$/);
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', /^(Maximize or restore window|最大化或还原窗口)$/);
    await expect(buttons.nth(2)).toHaveAttribute('aria-label', /^(Close window|关闭窗口)$/);
    const close = await buttons.nth(2).boundingBox();
    assert.equal(close.x + close.width, await page.evaluate(() => innerWidth), 'Close is at the right window edge');
    const overlap = await page.evaluate(() => {
      const controls = document.querySelector('.desktop-window-buttons').getBoundingClientRect();
      return [...document.querySelectorAll('button,a,input,select')].filter(element => !element.closest('.desktop-window-buttons')).some(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top < controls.bottom && box.bottom > controls.top && box.right > controls.left && box.left < controls.right;
      });
    });
    assert.equal(overlap, false, 'Toolbar controls stay clear of the Windows window buttons');
  }
  if (process.platform !== 'darwin') {
    await checkWindowsHitRegions(application, page);
    const maximize = page.getByRole('button', { name: /^(Maximize or restore window|最大化或还原窗口)$/ });
    await maximize.click();
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
    await checkWindowsHitRegions(application, page);
    await maximize.click();
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  }
  await expect(page.locator('.pdf-viewer canvas, .pdfViewer canvas').first()).toBeVisible({ timeout: 30000 });
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/desktop-demo-${packaged ? 'packaged' : 'dev'}.png` });
  const zoomMenu = id => application.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
  const zoomFactor = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  const captureZoom = async name => {
    // Capture the native content area so page zoom does not crop the screenshot.
    const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(`test-results/desktop-${name}-${packaged ? 'packaged' : 'dev'}.png`, Buffer.from(png, 'base64'));
  };
  const originalSize = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0], size = window.getSize();
    window.setSize(900, 620);
    return size;
  });
  for (let step = 0; step < 5; step++) await zoomMenu('zoom-in');
  await expect.poll(zoomFactor).toBeCloseTo(2);
  await expect.poll(() => page.locator('.main').evaluate(main => Math.round(main.getBoundingClientRect().width) === innerWidth)).toBe(true);
  const narrowSidebar = page.locator('.main .sidebar-toggle');
  await expect(narrowSidebar).toBeInViewport({ ratio: 1 });
  if (process.platform !== 'win32') {
    const dragRegion = page.locator('.desktop-window-drag');
    await expect.poll(async () => (await narrowSidebar.boundingBox()).x >= (await dragRegion.boundingBox()).width).toBe(true);
  }
  await page.locator('.workspace-navigation .manuscript-view-selector').getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.pdf-toolbar .zoom-chip')).toBeInViewport({ ratio: 1 });
  if (process.platform === 'win32') {
    const actions = page.locator('.workspace-nav-end');
    const windowButtons = page.locator('.desktop-window-buttons');
    await expect.poll(async () => {
      const { x, width } = await actions.boundingBox();
      return x + width <= (await windowButtons.boundingBox()).x;
    }).toBe(true);
  }
  await captureZoom('zoom-200');
  await zoomMenu('zoom-reset');
  await expect.poll(zoomFactor).toBeCloseTo(1);
  await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
  if (process.platform === 'darwin') {
    const menuSettings = await application.evaluate(({ Menu }) => {
      const settings = Menu.getApplicationMenu().items[0].submenu.getMenuItemById('open-settings');
      return settings && { label: settings.label, accelerator: settings.accelerator };
    });
    assert.deepEqual(menuSettings, { label: 'Settings…', accelerator: 'Cmd+,' });
    const openSettings = () => application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('open-settings').click());
    const settings = page.locator('dialog').filter({ has: page.locator('.settings-dialog') });
    const close = () => settings.getByRole('button', { name: /^(Close|关闭)$/ }).click();
    const draft = page.getByPlaceholder(/^(Describe the revision|描述修改)/);
    await draft.fill('Keep this workspace draft.');
    await expect(draft).toBeFocused();
    await openSettings();
    await expect(settings).toBeVisible();
    await expect(settings.locator('#settings-title')).toHaveText(/^(General|常规)$/);

    await settings.locator('[data-settings-page="git"]').click();
    const search = settings.getByRole('searchbox');
    await search.fill('Git');
    const firstDialog = await settings.elementHandle();
    await openSettings();
    await expect(settings).toHaveCount(1);
    await expect(settings.locator('#settings-title')).toHaveText('Git');
    await expect(search).toHaveValue('Git');
    await expect(search).toBeFocused();
    assert.equal(await firstDialog.evaluate(dialog => dialog.open), true);
    await firstDialog.dispose();
    await close();
    await expect(draft).toHaveValue('Keep this workspace draft.');
    await expect(draft).toBeFocused();
    await draft.fill('');

    const pdfFocus = page.locator('.pdf-container');
    await pdfFocus.focus();
    await expect(pdfFocus).toBeFocused();
    await openSettings();
    await expect(settings).toBeVisible();
    await expect(settings.locator('#settings-title')).toHaveText(/^(General|常规)$/);
    await page.screenshot({ path: 'test-results/desktop-macos-settings.png', animations: 'disabled' });
    await close();
    await expect(pdfFocus).toBeFocused();
  }
  if (process.platform === 'win32') {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(900);
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect.poll(async () => (await page.locator('.main').boundingBox()).x).toBe(0);
    await checkWindowsHitRegions(application, page);
    await page.screenshot({ path: 'test-results/desktop-windows-compact.png' });
    await page.getByRole('button', { name: /^(Show task list|显示任务列表)$/ }).click();
    await page.locator('.sidebar').getByRole('button', { name: /^(Version Management|版本管理)/ }).click();
    await expect(page.locator('.git-workspace')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await checkWindowsHitRegions(application, page);
    await page.screenshot({ path: 'test-results/desktop-windows-version-management.png' });
    await page.getByRole('button', { name: /^(Show task list|显示任务列表)$/ }).click();
    await page.locator('.sidebar').getByRole('button', { name: /^(Manuscript|稿件)/ }).click();
    await expect(page.locator('.pdf-toolbar')).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 900));
  }
  assert.ok(fs.existsSync(path.join(data, 'papilot.sqlite')), 'The bundled Node runtime can open SQLite');
  const rejected = await fetch(`${origin}/api/state`, { headers: { Origin: 'https://example.com' } });
  assert.equal(rejected.status, 403, 'The ephemeral port still enforces origin checks');
  // Only standalone installers use update layers and channels.
  const status = await (await fetch(`${origin}/api/updates`)).json();
  const expectedUpdates = layerUpdates
    ? [true, undefined, /-dev\./.test(version) ? 'dev' : 'stable']
    : [false, packageManaged ? undefined : 'https://github.com/PapilotAI/papilot/releases', undefined];
  assert.deepEqual([status.canUpdate, status.downloadUrl, status.channel], expectedUpdates);
  assert.equal(status.packageManager, packageManaged ? 'managed' : undefined);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const windowOptions = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation };
  });
  assert.deepEqual(windowOptions, { sandbox: true, nodeIntegration: false, contextIsolation: true });
  // Import or open offers every source; Open existing folder uses the system picker and
  // opens the original paper in place, without uploading or copying it.
  const localPaper = path.join(data, 'local-paper'); fs.mkdirSync(localPaper);
  fs.writeFileSync(path.join(localPaper, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nLocal paper.\n\\end{document}\n');
  const largeAsset = path.join(localPaper, 'large.dat'); fs.writeFileSync(largeAsset, ''); fs.truncateSync(largeAsset, 65 * 1024 * 1024);
  const openRequests = [];
  page.on('request', request => { const route = new URL(request.url()).pathname; if (request.method() === 'POST' && /^\/api\/(imports|projects\/open)/.test(route)) openRequests.push({ route, body: request.postDataJSON() }); });
  const pick = folder => application.evaluate(({ dialog }, folder) => {
    globalThis.originalOpenDialog ||= dialog.showOpenDialog; globalThis.pickerCalls = 0;
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.pickerCalls++;
      if (JSON.stringify(options.properties) !== '["openDirectory"]') throw new Error('Expected a native folder chooser');
      return folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] };
    };
  }, folder);
  const paperMenu = page.getByRole('button', { name: /^Paper:|^论文：/ });
  const importDialog = page.getByRole('dialog', { name: /^(New paper|新建论文)$/ });
  const openFromSidebar = async () => { await paperMenu.click(); await page.getByRole('menuitem', { name: /^(Import or open|导入或打开)$/ }).click(); await importDialog.getByRole('button', { name: /^(Choose folder…|选择文件夹…)$/ }).click(); };
  const openFromFileMenu = () => application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('open-folder').click());
  const opened = name => expect(page.getByRole('button', { name: new RegExp(`^(Paper: |论文：)${name}$`) })).toBeVisible({ timeout: 30000 });
  await pick(null);
  await openFromSidebar();
  await expect.poll(() => application.evaluate(() => globalThis.pickerCalls)).toBe(1);
  await expect(importDialog).toBeVisible();
  assert.equal(openRequests.length, 0, 'Canceling the picker opens nothing');
  await pick(localPaper);
  await importDialog.getByRole('button', { name: /^(Choose folder…|选择文件夹…)$/ }).click();
  await opened('local-paper');
  await expect(importDialog).toBeHidden();
  assert.deepEqual(openRequests, [{ route: '/api/projects/open', body: { path: localPaper } }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(localPaper, '.git/papilot/settings.json'), 'utf8')), { main: 'main.tex', engine: 'pdflatex', source_dir: '' });
  assert.ok(fs.existsSync(path.join(localPaper, '.git')), 'The opened folder gets its version history in place');
  // File › Open Paper… asks for the main file only when several could be it.
  const twoMains = path.join(data, 'two-mains'); fs.mkdirSync(twoMains);
  for (const name of ['a.tex', 'b.tex']) fs.writeFileSync(path.join(twoMains, name), '\\documentclass{article}\n\\begin{document}\nPaper.\n\\end{document}\n');
  await pick(twoMains);
  await openFromFileMenu();
  const mainDialog = page.getByRole('dialog', { name: 'two-mains' });
  await expect(mainDialog).toBeVisible();
  assert.deepEqual(fs.readdirSync(twoMains).sort(), ['a.tex', 'b.tex'], 'Asking for the main file changes nothing');
  await selectOption(mainDialog.getByRole('combobox', { name: /^(Main TeX file|TeX 主文件)$/ }), 'b.tex');
  await mainDialog.screenshot({ path: 'test-results/desktop-main-file.png' });
  await mainDialog.getByRole('button', { name: /^(Open paper|打开论文)$/ }).click();
  await opened('two-mains');
  await expect(mainDialog).toBeHidden();
  assert.deepEqual(openRequests.slice(1), [{ route: '/api/projects/open', body: { path: twoMains } }, { route: '/api/projects/open', body: { path: twoMains, main: 'b.tex' } }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(twoMains, '.git/papilot/settings.json'), 'utf8')).main, 'b.tex');
  // A folder already in Papilot opens again instead of being added twice.
  await pick(localPaper);
  await openFromFileMenu();
  await opened('local-paper');
  assert.equal((await (await fetch(`${origin}/api/state`)).json()).projects.length, 3);
  // A paper moves by choosing its folder, never by typing a path.
  await paperMenu.click();
  await page.getByRole('menuitem', { name: /^(Edit local-paper|编辑 local-paper)$/ }).click();
  const paperDialog = page.getByRole('dialog', { name: /^(Edit paper|编辑论文)$/ });
  const location = paperDialog.getByRole('group', { name: /^(Location|位置)$/ });
  await expect(location).toContainText(path.basename(localPaper));
  assert.equal(await paperDialog.getByRole('textbox').count(), 1, 'Only the paper name is typed');
  await pick(twoMains);
  await location.getByRole('button', { name: /^(Change…|更改…)$/ }).click();
  await expect(location).toContainText('two-mains');
  await expect.poll(() => application.evaluate(() => globalThis.pickerCalls)).toBe(1);
  await paperDialog.screenshot({ path: 'test-results/desktop-paper-dialog.png' });
  await paperDialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click();
  await application.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalOpenDialog; delete globalThis.originalOpenDialog; });
  const settings = page.getByRole('button', { name: /^(Settings|设置)$/ });
  await checkDesktopNotifications(application, page, await (await fetch(`${origin}/api/state`)).json());
  await settings.click();
  await page.getByRole('button', { name: /^(Updates|版本更新)$/ }).click();
  const checkUpdate = page.getByRole('button', { name: /^(Check for updates|检查更新)$/ });
  if (packageManaged) {
    await expect(page.getByText(/^(Updates are managed outside Papilot\.|更新不由 Papilot 管理。)$/)).toBeVisible();
    await expect(checkUpdate).toHaveCount(0);
    await page.screenshot({ path: 'test-results/desktop-apt-updates.png' });
  } else await expect(checkUpdate).toBeVisible();
  await expect(page.locator('.update-current-version')).toBeVisible();
  // A download appears only with a newer release; the app menu keeps the releases page.
  assert.equal(await page.getByRole('link', { name: /Download desktop updates|下载桌面版更新/ }).count(), 0);
  assert.equal(await page.getByRole('combobox', { name: /Update channel|更新通道/ }).count(), layerUpdates ? 1 : 0);
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/desktop-${packaged ? 'packaged' : 'dev'}.png` });
  assert.deepEqual(errors, []);
  // View › Zoom In steps the saved interface size, which zooms the whole window.
  await zoomMenu('zoom-in'); await zoomMenu('zoom-in');
  await expect.poll(zoomFactor).toBeCloseTo(1.25);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('papilot:appearance'))).size, 1.25);
  await captureZoom('zoom');
  await page.evaluate(() => localStorage.setItem('papilot:desktop-smoke', 'keep draft'));
  await application.close(); application = null;
  await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) }), 'Quitting Electron stops its backend');
  application = await launch();
  const reopened = await application.firstWindow({ timeout: 90000 });
  await reopened.waitForURL(origin + '/');
  assert.equal(await reopened.evaluate(() => localStorage.getItem('papilot:desktop-smoke')), 'keep draft', 'Local preferences survive a desktop restart');
  await expect.poll(zoomFactor, { message: 'Interface size survives a desktop restart' }).toBeCloseTo(1.25);
  await zoomMenu('zoom-reset');
  await expect.poll(zoomFactor).toBeCloseTo(1);
  await application.close(); application = null;
  const occupied = createServer();
  await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(Number(new URL(origin).port), '127.0.0.1', resolve); });
  try {
    application = await launch();
    const moved = await application.firstWindow({ timeout: 90000 });
    await moved.waitForURL('http://127.0.0.1:*/');
    assert.notEqual(new URL(moved.url()).origin, origin, 'An occupied saved port falls back to a free port');
    // A new origin has fresh browser storage, so its first-visit guide appears
    // again and must be dismissed before clicking the HTML window controls.
    await dismissInitialSetup(moved);
    if (process.platform !== 'darwin') {
      await checkWindowsHitRegions(application, moved);
      const closed = application.waitForEvent('close');
      await moved.getByRole('button', { name: /^(Close window|关闭窗口)$/ }).click();
      await closed;
      const movedOrigin = new URL(moved.url()).origin;
      await assert.rejects(fetch(`${movedOrigin}/api/health`, { signal: AbortSignal.timeout(5000) }), 'Closing the window stops the backend');
    } else await application.close();
    application = null;
  } finally { await new Promise(resolve => occupied.close(resolve)); }
  {
    // Legacy npm releases must never replace the desktop bundle, even on restart.
    const next = '999.0.0';
    const root = path.join(data, `updates/releases/${next}-smoke/node_modules/papilot`), active = path.join(data, 'updates/active.json');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, 'src/server'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/server/start.ts'), 'process.exit(3);\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'papilot', version: next, desktopShell: 1 }));
    fs.writeFileSync(active, JSON.stringify({ root, version: next, id: 'smoke', phase: 'active' }));
    const opened = async () => {
      application = await launch();
      const window = await application.firstWindow({ timeout: 90000 });
      await window.waitForURL('http://127.0.0.1:*/');
      const address = new URL(window.url()).origin;
      return { health: await (await fetch(`${address}/api/health`)).json(), status: await (await fetch(`${address}/api/updates`)).json() };
    };
    const run = await opened();
    assert.equal(run.health.version, version, 'The app always runs its bundled server');
    assert.equal(run.status.currentVersion, version);
    assert.equal(run.status.canUpdate, layerUpdates);
    assert.equal(fs.existsSync(active), true, 'Legacy records are ignored without deleting shared data');
    await application.close(); application = null;
  }
  // Linux runs this once, on the AppImage, whose path changes at every launch.
  if (layerUpdates && process.env.PAPILOT_DESKTOP_UPDATE_CHECK !== '0') {
    // A newer dev build for this installer's shell installs in place: only
    // Papilot's own code is downloaded, from a local stand-in for GitHub.
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-layer-'));
    const built = buildLayer(process.cwd(), output, 'b'.repeat(40));
    const files = Object.fromEntries(['desktop.json', built.layer.name].map(name => [name, fs.readFileSync(path.join(output, name))]));
    let source = '';
    const github = http.createServer((request, response) => {
      // Release downloads only: no stable release, and this dev build.
      const route = new URL(request.url, 'http://localhost').pathname;
      const file = files[route.replace(/^\/PapilotAI\/papilot\/releases\/download\/desktop-dev\//, '')];
      if (file && route.startsWith('/PapilotAI/papilot/releases/download/desktop-dev/')) response.end(file); else response.writeHead(404).end();
    });
    await new Promise(resolve => github.listen(0, '127.0.0.1', resolve));
    source = `http://127.0.0.1:${github.address().port}`;
    env.PAPILOT_DESKTOP_UPDATE_SOURCE = source;
    const opened = async () => {
      application = await launch();
      const view = await application.firstWindow({ timeout: 90000 });
      await view.waitForURL('http://127.0.0.1:*/');
      return { view, address: new URL(view.url()).origin };
    };
    const running = async address => (await (await fetch(`${address}/api/health`)).json()).version;
    try {
      const { view, address } = await opened();
      await view.getByRole('button', { name: /^(Settings|设置)$/ }).click();
      await view.getByRole('button', { name: /^(Updates|版本更新)$/ }).click();
      const channel = view.getByRole('combobox', { name: /Update channel|更新通道/ });
      if (await selectedValue(channel) === 'dev') await view.getByRole('button', { name: /^(Check for updates|检查更新)$/ }).click();
      else await selectOption(channel, 'dev');
      await view.getByRole('button', { name: /^(Update now|立即更新)$/ }).click();
      try {
        await expect.poll(() => running(address).catch(() => null), { timeout: 120000, message: 'The app restarts on the downloaded layer' }).toBe(built.version);
      } catch (error) {
        console.error('Desktop update status:', await (await fetch(`${address}/api/updates`)).json().catch(() => null));
        const log = path.join(data, 'updates/desktop/install.log');
        if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').slice(-8000));
        throw error;
      }
      // The page reloads itself on the new version.
      await expect(view.locator('.brand-version').first()).toHaveText(`v${built.version.slice(0, -33)}`, { timeout: 30000 });
      const record = JSON.parse(fs.readFileSync(path.join(data, 'updates/desktop/active.json'), 'utf8'));
      assert.equal(record.phase, 'active'); assert.equal(record.installer, version);
      // An AppImage runs from a new mount or extraction on each launch.
      assert.ok(fs.readlinkSync(path.join(record.root, 'node_modules')).endsWith(`${path.sep}server${path.sep}node_modules`), 'The layer runs on the installer dependencies');
      // A dev installer starts on the Dev channel; a stable one saved the choice.
      assert.equal((await (await fetch(`${address}/api/updates`)).json()).channel, 'dev');
      await application.close(); application = null;
      const reopened = await opened();
      assert.equal(await running(reopened.address), built.version, 'The update survives a restart');
      await application.close(); application = null;
      // A layer that no longer starts falls back to the installer's own server.
      fs.writeFileSync(path.join(record.root, 'src/server/start.ts'), 'process.exit(3);\n');
      const fallback = await opened();
      assert.equal(await running(fallback.address), version);
      const after = await (await fetch(`${fallback.address}/api/updates`)).json();
      assert.equal(after.phase, 'failed'); assert.match(after.error, /did not start/);
      assert.equal(fs.existsSync(path.join(data, 'updates/desktop/active.json')), false);
      await application.close(); application = null;
    } finally {
      delete env.PAPILOT_DESKTOP_UPDATE_SOURCE;
      await new Promise(resolve => github.close(resolve));
      fs.rmSync(output, { recursive: true, force: true });
    }
  }
  console.log(`Desktop smoke passed (${packaged ? 'packaged app' : 'development'}, ${health.version}).`);
} finally {
  await application?.close();
  fs.rmSync(data, { recursive: true, force: true });
}
