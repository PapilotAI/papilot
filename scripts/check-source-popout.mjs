// The LaTeX source editor in a window of its own, through the browser,
// against a real Papilot server, Git and LaTeX: it moves out with its draft
// and undo history, saves and compiles from there, follows the theme, and
// comes back to its tab when the window closes. Only the agents are inert;
// the repository, state and browser profile are disposable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium, expect } from './playwright.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-source-popout-'));
process.env.PAPILOT_DATA = path.join(temp, 'data');
delete process.env.PAPILOT_DESKTOP;
const [{ Store }, { Workspace }, { Manuscripts }, { buildApp, gitQueue }, { Updates }, { AGENT_IDS }] = await Promise.all([
  import('../src/server/store.ts'), import('../src/server/workspace.ts'), import('../src/server/manuscript.ts'),
  import('../src/server/app.ts'), import('../src/server/updates.ts'), import('../src/shared.ts'),
]);
class InertAgent extends EventEmitter { ready = false; close() {} }
const root = path.join(temp, 'paper'), intro = path.join(root, 'intro.tex');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{intro}\n\\end{document}\n');
fs.writeFileSync(intro, 'A paragraph about pelicans.\nPelicans glide over the water.\n');
git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@localhost');
git('add', '.'); git('commit', '-qm', 'Paper');

fs.mkdirSync(process.env.PAPILOT_DATA, { recursive: true });
const store = new Store(path.join(process.env.PAPILOT_DATA, 'state.sqlite3')), manuscripts = new Manuscripts();
const noReview = async () => { throw new Error('No review engine in this check'); };
const workspace = new Workspace(store, new InertAgent(), noReview, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new InertAgent()])));
store.saveProject({ id: 'paper', name: 'Pelican paper', path: root, createdAt: Date.now() });
const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
const updates = new Updates({ root: process.cwd(), data: process.env.PAPILOT_DATA, version: '0.9.2', port: 0, supported: false, busy: () => false, shutdown() {}, latest: async () => '0.9.2' });
const server = await buildApp({ store, workspace, manuscripts, listener, csrf: 'source-popout-test', serialGit: gitQueue(), dist: path.resolve('dist'), version: '0.9.2', connectReview: noReview, updates });
await server.listen({ host: '127.0.0.1', port: 0 }); listener.port = server.server.address().port;
const origin = `http://127.0.0.1:${listener.port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
const watch = target => {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
watch(page);
page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
fs.mkdirSync('test-results', { recursive: true });
const settle = async () => {
  let result;
  await expect.poll(async () => { result = await manuscripts.state('paper', root); return result.build.status; }, { timeout: 90000 }).not.toBe('building');
  return result.build;
};
const lines = editor => editor.evaluate(content => [...content.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n'));
let popup;

try {
  assert.equal((await settle()).status, 'ready');
  await page.addInitScript(() => { localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await page.goto(origin);
  await expect(page.locator('.pdf-view .textLayer span', { hasText: 'pelicans' }).first()).toBeVisible({ timeout: 60000 });

  const fileMenu = page.locator('.manuscript-row').getByRole('button', { name: /^Files/ });
  await fileMenu.click();
  await page.getByRole('list', { name: 'Repository files' }).getByRole('button', { name: 'intro.tex', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Manuscript panels' });
  const field = page.locator('.source-panel').getByRole('textbox', { name: 'Edit LaTeX source' });
  await expect(field).toContainText('Pelicans glide');
  // A draft with an undo step, made in this window.
  await field.locator('.cm-line', { hasText: 'Pelicans glide' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Herons wade.');
  await expect(tabs.locator('.side-tab-close[data-dirty]')).toBeVisible();

  // Opening it in a window moves the editor there, with its draft.
  const popOut = tabs.getByRole('button', { name: 'Open in a new window', exact: true });
  [popup] = await Promise.all([page.waitForEvent('popup'), popOut.click()]);
  watch(popup);
  await popup.setViewportSize({ width: 820, height: 700 });
  const away = page.locator('.source-panel-away');
  await expect(away).toContainText('This file is open in a separate window.');
  await expect(popOut, 'an editor in a window has no pop-out button').toHaveCount(0);
  const outField = popup.getByRole('textbox', { name: 'Edit LaTeX source' });
  await expect(outField).toContainText('Herons wade.');
  await expect(popup.locator('.popout-source-file')).toHaveText('intro.tex');
  await expect.poll(() => popup.title()).toBe('• intro.tex — Papilot');
  // The workspace's stylesheets apply there.
  assert.notEqual(await popup.locator('.popout-root').evaluate(element => getComputedStyle(element).position), 'static');
  await expect(outField, 'the editor keeps the focus where it went').toBeFocused();
  await popup.screenshot({ path: 'test-results/source-popout-window.png' });
  await page.screenshot({ path: 'test-results/source-popout-away.png' });

  // Its undo history came along.
  await popup.keyboard.press('ControlOrMeta+z');
  await expect(outField).not.toContainText('Herons wade.');
  await popup.keyboard.press('ControlOrMeta+Shift+z');
  await expect(outField).toContainText('Herons wade.');

  // It saves and compiles from the window; the main tab follows.
  await outField.click();
  await popup.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFileSync(intro, 'utf8')).toContain('Pelicans glide over the water. Herons wade.');
  await expect(tabs.locator('.side-tab-close[data-dirty]'), 'a saved file has no dot').toHaveCount(0);
  await expect.poll(() => popup.title()).toBe('intro.tex — Papilot');
  assert.equal((await settle()).status, 'ready');
  await expect(page.locator('.pdf-view .textLayer span', { hasText: 'Herons' }).first()).toBeVisible({ timeout: 60000 });

  // Escape in the window leaves it open.
  await outField.click();
  await popup.keyboard.press('Escape');
  await expect(away).toBeVisible();

  // The window follows the workspace's theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => popup.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const background = () => popup.locator('.popout-root').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(await background(), await page.locator('.manuscript-side').evaluate(element => getComputedStyle(element).backgroundColor));
  assert.notEqual(await background(), 'rgb(255, 255, 255)');
  await popup.screenshot({ path: 'test-results/source-popout-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(background).toBe('rgb(255, 255, 255)');

  // Moving it back keeps the editor and its history.
  await popup.locator('.popout-source-header').getByRole('button', { name: 'Move back to the main window' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(away).toHaveCount(0);
  await expect(field).toContainText('Herons wade.');
  await expect(field).toBeFocused();
  await page.keyboard.insertText(' Egrets.');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(field).not.toContainText('Egrets.');
  await expect(field).toContainText('Herons wade.');

  // Closing the window from its frame brings the editor back too.
  [popup] = await Promise.all([page.waitForEvent('popup'), popOut.click()]);
  watch(popup);
  await expect(popup.getByRole('textbox', { name: 'Edit LaTeX source' })).toContainText('Herons wade.');
  await popup.close();
  await expect(away).toHaveCount(0);
  await expect(field).toContainText('Herons wade.');
  assert.equal(await lines(field), 'A paragraph about pelicans.\nPelicans glide over the water. Herons wade.\n');

  // A phone has no windows to spare.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(field).toBeVisible();
  await expect(popOut).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });

  // Closing the tab while the editor is out closes the window.
  [popup] = await Promise.all([page.waitForEvent('popup'), popOut.click()]);
  watch(popup);
  await expect(popup.getByRole('textbox', { name: 'Edit LaTeX source' })).toBeVisible();
  await tabs.locator('.side-tab-close').click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(tabs.getByRole('tab', { name: 'intro.tex' })).toHaveCount(0);

  assert.deepEqual(errors, []);
  console.log('PASS: the source editor opens in a window of its own with its draft and history, saves and compiles from there, follows the theme, and returns to its tab when the window or tab closes');
} catch (error) {
  if (errors.length) console.error('Page errors:', errors);
  await page.screenshot({ path: 'test-results/source-popout-failure.png' }).catch(() => {});
  if (popup && !popup.isClosed()) await popup.screenshot({ path: 'test-results/source-popout-failure-window.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  updates?.close();
  workspace?.close();
  store?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
