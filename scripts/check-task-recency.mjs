import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect, webkit } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const baseline = process.env.PAPILOT_BASELINE === '1';
const server = Fastify();
await server.register(staticFiles, { root: path.resolve(process.env.PAPILOT_WEB_DIST || 'dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = process.env.PAPILOT_TASK_LIST_BROWSER === 'webkit' ? await webkit.launch()
  : await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1200, height: 780 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const now = Date.now();
const task = (id, createdAt) => ({ id, projectId: 'paper', agent: 'codex', name: id, title: id === 'older' ? 'Earlier conversation' : 'Newer conversation', instructions: 'Review the paper.', worktree: '/tmp/paper', threadId: id, turnId: null, status: 'reviewing', createdAt, updatedAt: createdAt, review: null });
const older = task('older', now - 120000), newer = task('newer', now - 60000);
const runtime = { connected: true, authenticated: true, models: [] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Example paper', path: '/tmp/paper' }], tasks: [older, newer], requests: [], runtime, runtimes: { codex: runtime } };
const items = [], pinWrites = [];
let timelineWait, releaseTimeline, timelineHeld = 0;
const routeApi = async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  const mutation = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(pin|archive|delete)$/);
  if (mutation) {
    const [, id, action] = mutation, body = route.request().postDataJSON();
    const row = snapshot.tasks.find(row => row.id === id);
    assert.ok(row);
    if (action === 'pin') {
      pinWrites.push([id, body.pinned]);
      snapshot.pinnedTaskIds ??= [];
      if (body.pinned && !snapshot.pinnedTaskIds.includes(id)) snapshot.pinnedTaskIds.push(id);
      if (!body.pinned) snapshot.pinnedTaskIds = snapshot.pinnedTaskIds.filter(pinned => pinned !== id);
      return json({ pinned: body.pinned });
    }
    if (action === 'archive') {
      row.archivedAt = body.archived ? Date.now() : undefined;
      return json(row);
    }
    snapshot.tasks = snapshot.tasks.filter(row => row.id !== id);
    snapshot.pinnedTaskIds = snapshot.pinnedTaskIds.filter(pinned => pinned !== id);
    return json({ ok: true });
  }
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/items')) {
    if (timelineWait && url.pathname.includes('/newer/')) { timelineHeld++; await timelineWait; }
    return json({ items });
  }
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
  throw Error(`Unexpected fixture request ${url.pathname}`);
};
await page.route('**/api/**', routeApi);
try {
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  const titles = page.locator('.task-list .task-title');
  await expect(titles).toHaveText(['Newer conversation', 'Earlier conversation']);
  // The state endpoint retains insertion order after a follow-up updates the older task.
  older.updatedAt = Date.now();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(titles).toHaveText(baseline ? ['Newer conversation', 'Earlier conversation'] : ['Earlier conversation', 'Newer conversation']);
  await page.screenshot({ animations: 'disabled', path: `test-results/task-recency-${baseline ? 'before' : 'after'}.png` });
  await page.reload();
  await expect(titles).toHaveText(baseline ? ['Newer conversation', 'Earlier conversation'] : ['Earlier conversation', 'Newer conversation']);
  newer.updatedAt = Date.now() + 1000;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(titles).toHaveText(['Newer conversation', 'Earlier conversation']);
  older.updatedAt = newer.updatedAt;
  await page.reload();
  await expect(titles).toHaveText(['Newer conversation', 'Earlier conversation']);
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('Earlier');
  await expect(titles).toHaveText(['Earlier conversation']);
  assert.deepEqual(snapshot.tasks.map(task => task.id), ['older', 'newer']);
  if (!baseline) {
    const earlierTitle = older.title, newerTitle = newer.title;
    await page.getByRole('button', { name: 'Clear task search' }).click();
    const action = (client, row) => client.getByRole('button', { name: `Task actions for ${row.title}`, exact: true });
    const choose = async (client, row, name, tap = false) => {
      const trigger = action(client, row);
      if (tap) await trigger.tap(); else await trigger.click();
      const item = client.getByRole('menuitem', { name, exact: true });
      if (tap) await item.tap(); else await item.click();
    };
    const pin = (client, row) => client.locator(`[data-task="${row.id}"]`).getByRole('button', { name: 'Pin task', exact: true });

    // The existing menu keeps keyboard focus through the pin and row move.
    async function chooseWithKeyboard(row, label) {
      const trigger = action(page, row);
      await trigger.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem', { name: 'Rename…', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await chooseWithKeyboard(older, 'Pin task');
    await expect(titles).toHaveText([earlierTitle, newerTitle]);
    await expect(action(page, older)).toBeFocused();
    await expect(pin(page, older)).toHaveAttribute('aria-pressed', 'true');
    await expect(pin(page, newer)).toHaveCSS('opacity', '0');
    await page.locator('[data-task="newer"] .task-title').hover();
    await expect(pin(page, newer)).toHaveCSS('opacity', '1');
    await expect(pin(page, newer)).toHaveAccessibleDescription(newerTitle);
    await pin(page, newer).click();
    await expect(pin(page, newer)).toHaveAttribute('aria-pressed', 'true');

    const added = { ...task('added', now + 2000), title: 'Recent addition' };
    snapshot.tasks.push(added);
    older.updatedAt = now + 5000;
    newer.updatedAt = now + 6000;
    added.updatedAt = now + 8000;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(titles).toHaveText([earlierTitle, newerTitle, added.title]);
    await page.reload();
    await expect(titles).toHaveText([earlierTitle, newerTitle, added.title]);
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('Newer');
    await expect(titles).toHaveText([newerTitle]);
    await expect(pin(page, older)).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear task search' }).click();
    await page.screenshot({ animations: 'disabled', path: 'test-results/task-pins-desktop.png' });

    const phone = await browser.newPage({ locale: 'en-US', colorScheme: 'dark', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', error => errors.push(error.message));
    await phone.route('**/api/**', routeApi);
    try {
      await phone.goto(page.url());
      await phone.getByRole('button', { name: 'Show task list' }).tap();
      await expect(phone.locator('.task-list .task-title')).toHaveText([earlierTitle, newerTitle, added.title]);
      await expect(pin(phone, added)).toHaveCSS('opacity', '1');
      const touchTarget = await pin(phone, older).boundingBox();
      assert.ok(touchTarget?.width >= 40 && touchTarget?.height >= 40, 'the pin has a touch-sized hit area');
      await phone.screenshot({ animations: 'disabled', path: 'test-results/task-pins-mobile.png' });
      await action(phone, older).tap();
      await expect(phone.getByRole('menuitem', { name: 'Unpin task', exact: true })).toBeVisible();
      await phone.screenshot({ animations: 'disabled', path: 'test-results/task-pins-menu.png' });
      await phone.keyboard.press('Escape');
      await pin(phone, older).tap();
      await expect(phone.locator('.task-list .task-title')).toHaveText([newerTitle, added.title, earlierTitle]);
      await expect(titles).toHaveText([newerTitle, added.title, earlierTitle]);
      await expect(pin(phone, older)).toHaveAttribute('aria-pressed', 'false');
    } finally { await phone.close(); }

    const selected = page.locator('[data-task="newer"] .task-link');
    await selected.click();
    await expect(selected).toHaveAttribute('aria-current', 'page');
    timelineWait = new Promise(resolve => { releaseTimeline = resolve; });
    await pin(page, newer).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => timelineHeld).toBeGreaterThan(0);
    await expect(titles).toHaveText([added.title, newerTitle, earlierTitle]);
    await expect(pin(page, newer)).toBeFocused();
    await expect(pin(page, newer)).toHaveAttribute('aria-pressed', 'false');
    await expect(pin(page, newer)).toBeDisabled();
    const writesWhilePending = pinWrites.length;
    await page.keyboard.press('Enter');
    assert.equal(pinWrites.length, writesWhilePending);
    timelineWait = undefined; releaseTimeline();
    await expect(pin(page, newer)).toBeEnabled();
    await choose(page, newer, 'Pin task');
    await expect(titles).toHaveText([newerTitle, added.title, earlierTitle]);

    await choose(page, newer, 'Archive task');
    await expect(titles).toHaveText([added.title, earlierTitle]);
    await page.getByRole('button', { name: 'Show archived tasks' }).click();
    await expect(titles).toHaveText([newerTitle]);
    await expect(pin(page, newer)).toHaveCount(0);
    await choose(page, newer, 'Restore task');
    await expect(titles).toHaveText([newerTitle, added.title, earlierTitle]);
    await expect(pin(page, newer)).toHaveAttribute('aria-pressed', 'true');

    snapshot.projects.push({ id: 'other', name: 'Second paper', path: '/tmp/second-paper' });
    const other = { ...task('other', now), projectId: 'other', title: 'Second paper task' };
    snapshot.tasks.push(other);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Paper: Example paper' }).click();
    await page.getByRole('menuitemradio', { name: 'Second paper', exact: true }).click();
    await expect(titles).toHaveText([other.title]);
    await choose(page, other, 'Pin task');
    await expect(pin(page, other)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Paper: Second paper' }).click();
    await page.getByRole('menuitemradio', { name: 'Example paper', exact: true }).click();
    await expect(titles).toHaveText([newerTitle, added.title, earlierTitle]);

    await choose(page, newer, 'Delete task…');
    await page.getByRole('dialog', { name: /^Delete task/ }).getByRole('button', { name: 'Delete task', exact: true }).click();
    await expect(titles).toHaveText([added.title, earlierTitle]);
    assert.deepEqual(snapshot.pinnedTaskIds, [other.id]);
    assert.deepEqual(pinWrites, [[older.id, true], [newer.id, true], [older.id, false], [newer.id, false], [newer.id, true], [other.id, true]]);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${baseline ? 'baseline reproduces stale ordering' : 'follow-up reorders live list and survives reload'}; subsequent updates, ties, search, and pins checked.`);
} finally { releaseTimeline?.(); await browser.close(); await server.close(); }
