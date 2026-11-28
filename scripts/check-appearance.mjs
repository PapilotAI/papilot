import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { selectOption } from './select.mjs';
import { expect } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 960 } });
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'appearance-task', projectId: 'appearance-paper', name: 'p-appearance', title: 'Refine the introduction', instructions: '', worktree: '/tmp/appearance', threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: { state: 'reviewing', round: 1, counts: { pending: 1, commented: 0 } } };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'model', name: 'Model', isDefault: true, efforts: ['high'], defaultEffort: 'high' }] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: task.projectId, name: 'Example paper', path: '/tmp/appearance', createdAt: 1 }], tasks: [task], requests: [], runtime };
const api = route => {
  const url = new URL(route.request().url());
  const json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { annotations: [], build: { status: 'idle' }, git: { files: [] } } });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', checkedAt: 1, error: null, canUpdate: true });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json({ remote: false, branch: 'main', upstream: null, ahead: 0, behind: 0, head: null, files: [] });
  if (url.pathname === '/api/quick-model') return json({ choice: null });
  if (url.pathname.endsWith('/manuscript/evidence')) return json({ key: url.searchParams.get('key'), marks: [], running: false });
  throw new Error(`Unexpected appearance request: ${url.pathname}`);
};
await context.route('**/api/**', api);
await context.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><div class="bar">Review</div><main id="paper">Paper</main></body></html>' }));
const dialog = page.locator('.settings-dialog');
const modes = dialog.getByRole('radiogroup', { name: 'Mode', exact: true });
const open = async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
};
const variable = (target, name) => target.locator('html').evaluate((el, name) => getComputedStyle(el).getPropertyValue(name).trim(), name);
const rootHas = async (name, value) => page.waitForFunction(([name, value]) => document.documentElement.style.getPropertyValue(name) === value, [name, value]);
const choose = async (name, value) => selectOption(dialog.getByRole('combobox', { name, exact: true }), value);
try {
  await page.goto(origin);
  await page.getByRole('button', { name: /^Refine the introduction/ }).click();
  await page.frameLocator('.review-frame').locator('#paper').waitFor();
  await open();
  await page.screenshot({ animations: 'disabled', path: 'test-results/appearance-light-desktop.png' });
  for (const preset of ['papilot', 'paper', 'slate']) {
    await choose('Theme', preset);
    for (const mode of ['Light', 'Dark']) {
      await modes.getByRole('radio', { name: mode, exact: true }).check();
      await page.screenshot({ animations: 'disabled', path: `test-results/appearance-preset-${preset}-${mode.toLowerCase()}.png` });
    }
  }
  await modes.getByRole('radio', { name: 'Light', exact: true }).check();
  await choose('Theme', 'paper');
  await rootHas('--bg', '#faf9f6');
  await choose('Accent', 'graphite');
  await rootHas('--primary', '#55565a');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Task list actions', exact: true }).press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Archive all tasks…', exact: true })).toHaveCSS('background-color', 'rgb(71, 72, 76)');
  await page.keyboard.press('Escape');
  await open();
  const background = dialog.getByRole('textbox', { name: 'Background', exact: true });
  await background.fill('#fef9ed');
  await background.press('Enter');
  await rootHas('--bg', '#fef9ed');
  await page.frameLocator('.review-frame').locator('html').evaluate(el => new Promise(resolve => {
    if (el.style.getPropertyValue('--bg') === '#fef9ed') return resolve();
    const observer = new MutationObserver(() => { if (el.style.getPropertyValue('--bg') === '#fef9ed') { observer.disconnect(); resolve(); } });
    observer.observe(el, { attributes: true });
  }));
  await background.fill('badhex');
  await background.press('Enter');
  assert.equal(await background.getAttribute('aria-invalid'), 'true');
  assert.equal(await variable(page, '--bg'), '#fef9ed');
  await background.press('Escape');
  assert.equal(await background.inputValue(), '#FEF9ED');
  await modes.getByRole('radio', { name: 'Dark', exact: true }).check();
  await rootHas('--bg', '#282724');
  await background.fill('#252229');
  await background.press('Enter');
  await rootHas('--bg', '#252229');
  await dialog.getByRole('radiogroup', { name: 'PDF appearance', exact: true }).getByRole('radio', { name: 'Original', exact: true }).check();
  await rootHas('--pdf-filter', 'none');
  assert.equal(await variable(page.frameLocator('.review-frame'), '--pdf-filter'), 'none');
  const reviewOptions = dialog.getByRole('radiogroup', { name: 'Review appearance', exact: true });
  await expect(dialog.locator('.appearance-paper-card').getByRole('switch')).toHaveCount(0);
  await expect(reviewOptions).toBeVisible();
  await expect(reviewOptions.getByRole('radio', { name: 'PDF', exact: true })).toBeChecked();
  await expect(page.frameLocator('.review-frame').locator('html')).toHaveAttribute('data-review-theme', 'light');
  await reviewOptions.getByRole('radio', { name: 'Auto', exact: true }).check();
  await expect(page.frameLocator('.review-frame').locator('html')).toHaveAttribute('data-review-theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/appearance-custom-dark-desktop.png' });
  await page.reload();
  await page.frameLocator('.review-frame').locator('#paper').waitFor();
  await rootHas('--bg', '#252229');
  assert.equal(await variable(page, '--primary'), '#55565a');
  assert.equal(await variable(page, '--review-theme'), 'dark');
  await open();
  await expect(reviewOptions.getByRole('radio', { name: 'Auto', exact: true })).toBeChecked();
  await modes.getByRole('radio', { name: 'Light', exact: true }).check();
  await rootHas('--bg', '#fef9ed');
  await dialog.getByLabel('Choose Foreground color', { exact: true }).fill('#40364a');
  await rootHas('--text', '#40364a');
  assert.equal(await dialog.getByRole('textbox', { name: 'Foreground', exact: true }).inputValue(), '#40364A');
  await page.screenshot({ animations: 'disabled', path: 'test-results/appearance-custom-light-desktop.png' });

  // Both preferences and their resolved colors stay in sync across windows.
  const other = await context.newPage();
  await other.goto(origin);
  await other.waitForFunction(() => document.documentElement.style.getPropertyValue('--bg') === '#fef9ed');
  // Keep the window receiving pointer input active; the second tab only
  // observes storage changes and may otherwise throttle the first renderer.
  await page.bringToFront();
  await reviewOptions.getByRole('radio', { name: 'PDF', exact: true }).check();
  await other.waitForFunction(() => JSON.parse(localStorage.getItem('papilot:appearance')).review === 'pdf');
  await reviewOptions.getByRole('radio', { name: 'Original', exact: true }).check();
  await other.waitForFunction(() => JSON.parse(localStorage.getItem('papilot:appearance')).review === 'light');
  await choose('Theme', 'slate');
  await other.waitForFunction(() => document.documentElement.style.getPropertyValue('--bg') === '#f6f7f8');
  await modes.getByRole('radio', { name: 'System', exact: true }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await rootHas('--bg', '#24272b');
  await page.emulateMedia({ colorScheme: 'light' });
  await rootHas('--bg', '#f6f7f8');
  const editorFont = dialog.getByRole('combobox', { name: 'Editor font size', exact: true });
  await expect(editorFont).toHaveAttribute('data-value', '12');
  await choose('Editor font size', '16');
  await other.waitForFunction(() => localStorage.getItem('papilot:editor-font-size') === '16');
  await page.screenshot({ animations: 'disabled', path: 'test-results/appearance-slate-desktop.png' });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await dialog.locator('.settings-content').evaluate(el => el.scrollWidth > el.clientWidth), false, `No horizontal overflow at ${width}px`);
    await page.screenshot({ animations: 'disabled', path: `test-results/appearance-mobile-${width}.png` });
  }
  await dialog.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await rootHas('--bg', '#ffffff');
  await expect(editorFont).toHaveAttribute('data-value', '12');
  await rootHas('--primary', '#0b8af0');
  await expect(reviewOptions.getByRole('radio', { name: 'PDF', exact: true })).toBeChecked();
  await other.waitForFunction(() => document.documentElement.style.getPropertyValue('--bg') === '#ffffff');
  // The theme select follows the select-only combobox pattern: Escape cancels
  // without closing Settings, Tab accepts, and a space typed into a search
  // stays part of it instead of closing the list.
  await page.setViewportSize({ width: 1100, height: 844 });
  // A resize closes an open list, so let the resize land before opening one.
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const theme = dialog.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(theme).toHaveAttribute('aria-expanded', 'false');
  await expect(theme).toHaveAttribute('data-value', 'papilot');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Enter'); await page.keyboard.press('s'); await page.keyboard.press('Tab');
  await expect(theme).toHaveAttribute('data-value', 'slate');
  await theme.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('p'); await page.keyboard.press(' ');
  await expect(theme).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(theme).toHaveAttribute('data-value', 'papilot');
  await other.evaluate(() => localStorage.setItem('papilot:appearance', '{broken'));
  await rootHas('--bg', '#ffffff');
  await other.close();

  // Browsers keep their own page zoom; Settings points to it instead of a size picker.
  await expect(dialog.getByRole('combobox', { name: 'Interface size', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Use your browser’s zoom to scale text and controls.')).toBeVisible();

  // The desktop app zooms its window to the saved interface size, and its
  // View menu steps the same setting.
  const desktop = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 960 } });
  desktop.setDefaultTimeout(15000);
  await desktop.addInitScript(() => {
    window.zoomCalls = [];
    const listeners = new Set();
    window.zoomMenu = direction => { for (const listener of listeners) listener(direction); };
    window.papilotDesktop = { platform: 'linux', minimize() {}, maximize() {}, close() {},
      setZoom: factor => window.zoomCalls.push(factor),
      onZoom: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  });
  await desktop.route('**/api/**', api);
  const app = await desktop.newPage();
  app.on('pageerror', error => errors.push(error.message));
  const lastZoom = () => app.evaluate(() => window.zoomCalls.at(-1));
  await app.goto(origin);
  await app.waitForFunction(() => window.zoomCalls.length > 0);
  assert.equal(await lastZoom(), 1);
  await app.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = app.locator('.settings-dialog');
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  const size = settings.getByRole('combobox', { name: 'Interface size', exact: true });
  await selectOption(size, '1.5');
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1.5);
  await app.evaluate(() => window.zoomMenu('in'));
  await expect(size).toHaveAttribute('data-value', '1.75');
  assert.equal(await lastZoom(), 1.75);
  await app.evaluate(() => window.zoomMenu('out'));
  await app.evaluate(() => window.zoomMenu('out'));
  await expect(size).toHaveAttribute('data-value', '1.25');
  // Electron zoom shrinks the layout viewport (and raises the pixel ratio, which
  // does not affect layout); Settings must stay usable at the largest sizes.
  // The default window (1380×900) and the minimum one (900×620) at large sizes.
  for (const [factor, width, height] of [[1.5, 1380, 900], [2, 1380, 900], [2, 900, 620]]) {
    await selectOption(size, String(factor));
    await app.setViewportSize({ width: Math.round(width / factor), height: Math.round(height / factor) });
    await size.scrollIntoViewIfNeeded();
    await expect(size).toBeInViewport();
    assert.equal(await settings.locator('.settings-content').evaluate(el => el.scrollWidth > el.clientWidth), false, `No horizontal overflow at ${factor * 100}% of ${width}px`);
    await app.screenshot({ animations: 'disabled', path: `test-results/appearance-size-${factor * 100}-${width}.png` });
  }
  await settings.locator('.settings-mobile-back').click();
  await expect(settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('radio', { name: 'Dark', exact: true }).check();
  await size.scrollIntoViewIfNeeded();
  await app.screenshot({ animations: 'disabled', path: 'test-results/appearance-size-200-900-dark.png' });
  await app.setViewportSize({ width: 1440, height: 960 });
  await selectOption(size, '1.25');
  await app.reload();
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1.25);
  assert.equal(JSON.parse(await app.evaluate(() => localStorage.getItem('papilot:appearance'))).size, 1.25);
  await app.evaluate(() => { window.zoomMenu('in'); window.zoomMenu('in'); });
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1.75);
  await app.evaluate(() => window.zoomMenu('reset'));
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1);
  await app.evaluate(() => window.zoomMenu('in'));
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1.1);
  await app.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await app.waitForFunction(() => window.zoomCalls.at(-1) === 1);
  await desktop.close();

  // Window buttons follow the system: Windows on the right, Linux as the
  // desktop app reports its desktop's layout, and a left-side close-first
  // layout when that is unknown. Toolbar controls never sit under them.
  const layouts = [
    ['linux-default', 'linux', undefined, 'left', ['Close window', 'Minimize window', 'Maximize or restore window']],
    ['linux-gnome', 'linux', { side: 'right', buttons: ['close'] }, 'right', ['Close window']],
    ['linux-right', 'linux', { side: 'right', buttons: ['minimize', 'maximize', 'close'] }, 'right', ['Minimize window', 'Maximize or restore window', 'Close window']],
    ['linux-left', 'linux', { side: 'left', buttons: ['close', 'maximize'] }, 'left', ['Close window', 'Maximize or restore window']],
    ['windows', 'win32', undefined, 'right', ['Minimize window', 'Maximize or restore window', 'Close window']],
    // macOS draws its own traffic lights in the leading space.
    ['macos', 'darwin', undefined, 'left', []],
  ];
  for (const [name, platform, windowButtons, side, labels] of layouts) {
    const chrome = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 960 } });
    chrome.setDefaultTimeout(15000);
    await chrome.addInitScript(([platform, windowButtons]) => {
      window.papilotDesktop = { platform, windowButtons, minimize() {}, maximize() {}, close() {} };
    }, [platform, windowButtons]);
    await chrome.route('**/api/**', api);
    await chrome.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><div class="bar">Review</div><main id="paper">Paper</main></body></html>' }));
    const window = await chrome.newPage();
    window.on('pageerror', error => errors.push(error.message));
    await window.goto(origin);
    await window.getByRole('button', { name: /^Refine the introduction/ }).click();
    await expect(window.locator('html')).toHaveAttribute('data-desktop-controls', side);
    const buttons = window.locator('.desktop-window-buttons button');
    assert.deepEqual(await buttons.evaluateAll(list => list.map(button => button.getAttribute('aria-label'))), labels, `${name}: buttons and order`);
    const clear = async state => {
      const result = await window.evaluate(() => {
        const buttons = document.querySelector('.desktop-window-buttons');
        const controls = buttons ? buttons.getBoundingClientRect() : { left: 0, top: 0, right: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-leading-space')), bottom: 28 };
        const overlaps = [...document.querySelectorAll('button,a,input,select,[role="combobox"]')].filter(element => !element.closest('.desktop-window-buttons')).filter(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top < controls.bottom && box.bottom > controls.top && box.right > controls.left && box.left < controls.right;
        }).map(element => element.getAttribute('aria-label') || element.textContent.trim());
        return { left: controls.left, right: controls.right, width: innerWidth, overlaps };
      });
      assert.deepEqual(result.overlaps, [], `${name} (${state}): toolbar controls stay clear of the window buttons`);
      if (side === 'right') assert.ok(Math.abs(result.right - result.width) <= 1, `${name} (${state}): buttons reach the right edge`);
      else assert.ok(result.left < 20, `${name} (${state}): buttons start at the left edge`);
      if (platform === 'win32') {
        const hasOneDivider = await window.locator('.desktop-window-drag').evaluate((chrome, compact) => {
          const rule = getComputedStyle(chrome, '::after');
          if (compact) return rule.content === 'none';
          const toolbar = getComputedStyle(document.querySelector('.activity-panel > .panel-heading'));
          return rule.left === '0px' && rule.right === '0px' && rule.bottom === '0px'
            && rule.borderBottom === toolbar.borderBottom && rule.pointerEvents === 'none';
        }, result.width <= 680);
        assert.ok(hasOneDivider, `${name} (${state}): the toolbar divider continues beneath the window buttons without duplication`);
      }
    };
    await clear('sidebar open');
    await window.screenshot({ animations: 'disabled', path: `test-results/window-buttons-${name}.png` });
    await window.getByRole('button', { name: 'Hide task list', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Show task list', exact: true })).toBeVisible();
    await clear('sidebar hidden');
    // Wherever the chat docks, the toolbar now touching the controls' edge
    // keeps clear of them.
    const position = async place => {
      await window.locator('.activity-panel').getByRole('button', { name: /^Panel position/ }).click();
      await window.getByRole('menuitemradio', { name: place, exact: true }).click();
      await window.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    };
    for (const place of ['Dock on the left', 'Dock at the bottom', 'Float over the page']) {
      await position(place);
      await clear(`sidebar hidden, chat: ${place}`);
    }
    await position('Dock on the right');
    // Narrow windows show the task list as a drawer over the workspace, so
    // check the toolbars with it closed.
    for (const width of [900, 680]) {
      await window.setViewportSize({ width, height: 700 });
      await window.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
      await clear(`${width}px`);
    }
    await window.screenshot({ animations: 'disabled', path: `test-results/window-buttons-${name}-680.png` });
    await chrome.close();
  }

  assert.deepEqual(errors, []);
  console.log('Appearance: live colors, iframe sync, validation, per-mode persistence, system mode, cross-tab sync, reset, interface size, responsive layouts and system window button layouts passed.');
} catch (error) { await page.screenshot({ animations: 'disabled', path: 'test-results/appearance-failure.png' }); console.error(await page.locator('body').innerText()); throw error; } finally { await browser.close(); await server.close(); }
