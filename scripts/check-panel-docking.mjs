// The manuscript's side panel docks on the right, left or bottom, or floats
// over the PDF, from its position menu or by dragging; it remembers its place
// and sizes, resets, and leaves narrow windows their own layout. Real server,
// Git and LaTeX; inert agents; disposable data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium, expect } from './playwright.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-panel-docking-'));
process.env.PAPILOT_DATA = path.join(temp, 'data');
delete process.env.PAPILOT_DESKTOP;
const [{ Store }, { Workspace }, { Manuscripts }, { buildApp, gitQueue }, { Updates }, { AGENT_IDS }] = await Promise.all([
  import('../src/server/store.ts'), import('../src/server/workspace.ts'), import('../src/server/manuscript.ts'),
  import('../src/server/app.ts'), import('../src/server/updates.ts'), import('../src/shared.ts'),
]);
class InertAgent extends EventEmitter { ready = false; close() {} }
const root = path.join(temp, 'paper');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nA paragraph about pelicans.\n\\end{document}\n');
git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@localhost'); git('add', '.'); git('commit', '-qm', 'Paper');

fs.mkdirSync(process.env.PAPILOT_DATA, { recursive: true });
const store = new Store(path.join(process.env.PAPILOT_DATA, 'state.sqlite3')), manuscripts = new Manuscripts();
const noReview = async () => { throw new Error('No review engine in this check'); };
const workspace = new Workspace(store, new InertAgent(), noReview, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new InertAgent()])));
store.saveProject({ id: 'paper', name: 'Pelican paper', path: root, createdAt: Date.now() });
const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
const updates = new Updates({ root: process.cwd(), data: process.env.PAPILOT_DATA, version: '0.9.2', port: 0, supported: false, busy: () => false, shutdown() {}, latest: async () => '0.9.2' });
const server = await buildApp({ store, workspace, manuscripts, listener, csrf: 'panel-docking-test', serialGit: gitQueue(), dist: path.resolve('dist'), version: '0.9.2', connectReview: noReview, updates });
await server.listen({ host: '127.0.0.1', port: 0 }); listener.port = server.server.address().port;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
fs.mkdirSync('test-results', { recursive: true });
const shot = name => page.screenshot({ path: `test-results/panel-docking-${name}.png` });

try {
  await expect.poll(async () => (await manuscripts.state('paper', root)).build.status, { timeout: 90000 }).toBe('ready');
  await page.addInitScript(() => { localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await page.goto(`http://127.0.0.1:${listener.port}`);
  await expect(page.locator('.pdf-view .textLayer span', { hasText: 'pelicans' }).first()).toBeVisible({ timeout: 60000 });
  const area = page.locator('.manuscript'), side = page.locator('.manuscript-side'), pages = page.locator('.manuscript-pages');
  const resizer = area.locator('> .panel-resizer'), header = page.locator('.manuscript-side-header');
  const button = header.getByRole('button', { name: 'Panel position' });
  const box = locator => locator.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
  const choose = async name => { await button.click(); await page.getByRole('menuitemradio', { name }).click(); };
  const settled = () => page.waitForTimeout(150);

  // On the right by default, as before.
  await expect(area).toHaveAttribute('data-dock', 'right');
  assert.ok((await box(side)).x > (await box(pages)).x);
  await button.click();
  await expect(page.getByRole('menuitemradio', { name: 'Dock on the right' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // On the left: the edge between them resizes it from the other side.
  await choose('Dock on the left');
  await expect(area).toHaveAttribute('data-dock', 'left');
  await expect(area.locator('[aria-live=polite]'), 'the move is announced').toHaveText('Docked on the left');
  let s = await box(side), p = await box(pages);
  assert.ok(s.right <= p.x + 1, `the panel is left of the pages: ${JSON.stringify({ s, p })}`);
  const edge = await box(resizer);
  assert.ok(Math.abs(edge.x + edge.width / 2 - s.right) <= 6, 'the resize edge is between them');
  await page.mouse.move(edge.x + 4, edge.y + 300); await page.mouse.down(); await page.mouse.move(edge.x + 104, edge.y + 300, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await box(side)).width)).toBe(Math.round(s.width + 100));
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:manuscript-width')), String(Math.round(s.width + 100)));
  await shot('left');

  // At the bottom: below the pages, sized by its top edge and the keyboard.
  await choose('Dock at the bottom');
  await expect(area).toHaveAttribute('data-dock', 'bottom');
  s = await box(side); p = await box(pages);
  assert.ok(s.y >= p.bottom - 1 && Math.abs(s.width - p.width) <= 1, `the panel is under the pages: ${JSON.stringify({ s, p })}`);
  await expect(resizer).toHaveAttribute('aria-orientation', 'horizontal');
  await resizer.focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(async () => Math.round((await box(side)).height)).toBe(Math.round(s.height + 24));
  await shot('bottom');

  // Floating over the pages, which take the whole width.
  await choose('Float over the page');
  await expect(area).toHaveAttribute('data-dock', 'float');
  s = await box(side); p = await box(pages);
  const a = await box(area);
  assert.equal(Math.round(p.width), Math.round(a.width), 'the pages take the whole area');
  assert.ok(s.x > p.x && s.right < p.right && s.y > p.y, 'the panel floats inside the area');
  assert.notEqual(await side.evaluate(element => getComputedStyle(element).boxShadow), 'none');
  await shot('float');

  // Its header's empty space moves it.
  const tabs = header.locator('.side-tabs'), grab = await box(tabs);
  const hold = { x: grab.right - 12, y: grab.y + grab.height / 2 };
  await page.mouse.move(hold.x, hold.y); await page.mouse.down();
  await page.mouse.move(hold.x - 300, hold.y + 120, { steps: 6 });
  await expect(page.locator('.dock-preview'), 'a floating panel moves itself, with no preview').toHaveCount(0);
  await page.mouse.up();
  const movedBox = await box(side);
  assert.ok(Math.abs(movedBox.x - (s.x - 300)) <= 2 && Math.abs(movedBox.y - (s.y + 120)) <= 2, `moved: ${JSON.stringify({ s, movedBox })}`);
  // Its corner resizes it.
  const corner = await box(area.locator('> .panel-corner'));
  await page.mouse.move(corner.x + 8, corner.y + 8); await page.mouse.down(); await page.mouse.move(corner.x + 68, corner.y + 48, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => { const b = await box(side); return [Math.round(b.width - movedBox.width), Math.round(b.height - movedBox.height)]; }).toEqual([60, 40]);

  // Escape puts a dragged panel back.
  const before = await box(side), button0 = await box(button);
  await page.mouse.move(button0.x + 14, button0.y + 14); await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 300, { steps: 6 });
  await expect(page.locator('.dock-preview'), 'an edge shows where the panel would dock').toBeVisible();
  await shot('dragging');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dock-preview')).toHaveCount(0);
  await page.mouse.up();
  await expect(area).toHaveAttribute('data-dock', 'float');
  assert.deepEqual(await box(side), before);
  await expect(page.getByRole('menu', { name: 'Panel position' }), 'a drag does not open the menu').toBeHidden();

  // Dropping it on an edge docks it there.
  await page.mouse.move(button0.x + 14, button0.y + 14); await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 300, { steps: 6 }); await page.mouse.up();
  await expect(area).toHaveAttribute('data-dock', 'left');
  await expect(page.getByRole('menu', { name: 'Panel position' })).toBeHidden();
  // The keyboard still opens the menu after a drag.
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Panel position' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Panel position' })).toBeHidden();
  // And dropping it away from the edges floats it there.
  const header0 = await box(tabs);
  await page.mouse.move(header0.x + header0.width - 12, header0.y + header0.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + 500, a.y + 200, { steps: 6 }); await page.mouse.up();
  await expect(area).toHaveAttribute('data-dock', 'float');
  await settled();

  // The place survives a reload.
  const floated = await box(side);
  await page.reload();
  await expect(page.locator('.pdf-view .textLayer span', { hasText: 'pelicans' }).first()).toBeVisible({ timeout: 60000 });
  await expect(area).toHaveAttribute('data-dock', 'float');
  assert.deepEqual(await box(side), floated);

  // A narrow window keeps its stacked layout, and a wider one the place.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(area).not.toHaveAttribute('data-dock');
  await expect(button).toHaveCount(0);
  s = await box(side); p = await box(pages);
  assert.ok(s.y >= p.bottom - 1, 'stacked below the pages');
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(area).toHaveAttribute('data-dock', 'float');

  // Dark theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await settled();
  await shot('float-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // In a window of its own, from the menu: the page takes the whole area, the
  // toolbar can bring the window forward, and the panel keeps its header, whose
  // menu docks it again.
  await choose('Dock on the right');
  let [popup] = await Promise.all([page.waitForEvent('popup'), choose('Open in a new window')]);
  await popup.setViewportSize({ width: 420, height: 760 });
  await expect(area).toHaveAttribute('data-dock', 'window');
  await expect(side).toHaveCount(0);
  assert.equal(Math.round((await box(pages)).width), Math.round((await box(area)).width), 'the pages take the whole area');
  await expect(page.getByRole('button', { name: 'Show panel window' })).toBeVisible();
  const outSide = popup.locator('.manuscript-side');
  await expect(outSide.getByRole('tab', { name: 'New task' })).toBeVisible();
  await expect(outSide.locator('.manuscript-side-header'), 'a narrow window keeps the header').toBeVisible();
  await popup.screenshot({ path: 'test-results/panel-docking-window.png' });
  await outSide.getByRole('button', { name: /^Panel position/ }).click();
  await popup.getByRole('menuitemradio', { name: 'Dock on the left' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(area).toHaveAttribute('data-dock', 'left');
  await expect(side).toBeVisible();

  // Dragged past the window's edge, it opens in a window of its own; closing
  // that window docks it where it was.
  const handle = await box(button);
  await page.mouse.move(handle.x + 14, handle.y + 14); await page.mouse.down();
  await page.mouse.move(handle.x + 200, handle.y + 200, { steps: 4 });
  const opened = page.waitForEvent('popup');
  await page.mouse.move(-60, 400, { steps: 6 });
  await expect(page.locator('.dock-preview[data-zone=window]')).toContainText('Release to open in a new window');
  await shot('drag-out');
  await page.mouse.up();
  popup = await opened;
  await expect(area).toHaveAttribute('data-dock', 'window');
  await expect(popup.locator('.manuscript-side')).toBeVisible();
  await popup.close();
  await expect(area).toHaveAttribute('data-dock', 'left');
  await expect(side).toBeVisible();
  // Leaving the paper closes the panel's window; coming back finds it docked.
  [popup] = await Promise.all([page.waitForEvent('popup'), choose('Open in a new window')]);
  await page.getByRole('button', { name: /^Library/ }).first().click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await page.getByRole('button', { name: /^Manuscript/ }).first().click();
  await expect(area).toHaveAttribute('data-dock', 'left');
  await expect(side).toBeVisible();

  // Reset puts it back on the right at its usual width.
  await button.click();
  await page.getByRole('menuitem', { name: 'Reset panel layout' }).click();
  await expect(area).toHaveAttribute('data-dock', 'right');
  assert.equal(await page.evaluate(() => [localStorage.getItem('papilot:dock:manuscript'), localStorage.getItem('papilot:manuscript-width')].join()), ',');
  assert.equal(Math.round((await box(side)).width), 340);

  assert.deepEqual(errors, []);
  console.log('PASS: the manuscript panel docks right, left and at the bottom, floats, opens in a window of its own from its menu or when dragged out of the window and docks again when that window closes, moves and resizes by dragging, docks when dropped on an edge, cancels with Escape, keeps its place across reloads and narrow windows, and resets');
} catch (error) {
  if (errors.length) console.error('Page errors:', errors);
  await shot('failure').catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  updates?.close();
  workspace?.close();
  store?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
