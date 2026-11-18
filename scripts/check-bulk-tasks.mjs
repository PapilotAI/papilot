import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const runtime = { connected: true, authenticated: true, models: [] };
const makeTask = (id, extra = {}) => ({ id, projectId: 'paper', agent: 'codex', name: id, title: id, instructions: 'Review the paper.', worktree: '/tmp/paper', threadId: id, turnId: null, status: 'reviewing', createdAt: 1, updatedAt: 1, review: null, ...extra });
const errors = [];
async function fixture(options = {}) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 850 }, ...options });
  await context.addInitScript(() => {
    localStorage.setItem('papilot:task', 'Current one');
    localStorage.setItem('papilot:project', 'paper');
    localStorage.setItem('papilot:draft:Current one', 'Keep until deleted');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Example paper', path: '/tmp/paper' }, { id: 'other', name: 'Other paper', path: '/tmp/other' }], tasks: [makeTask('Current one'), makeTask('Current two'), makeTask('Archived', { archivedAt: 1 }), makeTask('Other paper task', { projectId: 'other' })], requests: [], runtime, runtimes: { codex: runtime } };
  const requests = [], fail = new Set();
  let release, held, holdNext = false;
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname, json = data => route.fulfill({ json: data });
    if (pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (pathname === '/api/state') return json(snapshot);
    if (pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
    if (pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
    if (pathname === '/api/indirect-changes') return json({ indirectChanges: false });
    if (pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (pathname.endsWith('/items')) return json({ items: [] });
    if (pathname.endsWith('/note-results')) return json({ notes: [] });
    if (pathname.endsWith('/files')) return json({ document: null, files: [] });
    if (pathname.endsWith('/skills')) return json({ skills: [] });
    if (pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
    if (pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
    const match = pathname.match(/^\/api\/tasks\/([^/]+)\/(archive|delete)$/);
    if (match) {
      const [, rawId, action] = match, id = decodeURIComponent(rawId), body = route.request().postDataJSON();
      requests.push({ id, action, body });
      if (holdNext) { holdNext = false; await held; }
      const task = snapshot.tasks.find(task => task.id === id);
      if (fail.has(id) || (action === 'delete' && task.status === 'running')) return route.fulfill({ status: 409, json: { error: 'Pause the task and wait for its current work to finish.' } });
      if (action === 'archive') { task.archivedAt = Date.now(); return json(task); }
      snapshot.tasks = snapshot.tasks.filter(task => task.id !== id); return json({ ok: true });
    }
    throw Error(`Unexpected fixture request ${pathname}`);
  });
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  await expect(page.locator('.task-row.active')).toHaveCount(1);
  if (options.hasTouch) await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  return { context, page, snapshot, requests, fail, hold() { holdNext = true; held = new Promise(resolve => { release = resolve; }); }, release() { release(); } };
}
async function open(page, name) {
  await page.getByRole('button', { name: 'Task list actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  const dialog = page.locator('.bulk-task-backdrop'); await expect(dialog).toBeVisible(); return dialog;
}
try {
  const f = await fixture(), { page } = f;
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('one');
  let dialog = await open(page, 'Archive all tasks…');
  await expect(dialog.locator('.delete-task-name')).toHaveText('Example paper · 2 tasks');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); assert.equal(f.requests.length, 0);
  await expect(page.getByRole('button', { name: 'Task list actions', exact: true })).toBeFocused();
  dialog = await open(page, 'Archive all tasks…');
  f.fail.add('Current one'); f.hold();
  await dialog.getByRole('button', { name: 'Archive all', exact: true }).dblclick();
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  f.snapshot.tasks.push(makeTask('Arrived later'));
  f.release();
  await expect(dialog.getByRole('alert')).toContainText('1 task failed.');
  assert.deepEqual(f.requests.map(r => r.id), ['Current one', 'Current two']);
  await page.screenshot({ path: 'test-results/bulk-tasks-error-desktop.png', animations: 'disabled' });
  f.fail.clear();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.deepEqual(f.requests.map(r => r.id), ['Current one', 'Current two', 'Current one']);
  assert.ok(f.requests.every(r => r.body.archived === true));
  assert.equal(f.snapshot.tasks.find(t => t.id === 'Arrived later').archivedAt, undefined);
  assert.equal(f.snapshot.tasks.find(t => t.projectId === 'other').archivedAt, undefined);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:draft:Current one')), 'Keep until deleted');
  await expect(page.locator('.task-row.active')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('');
  await expect(page.locator('.task-title')).toHaveText(['Arrived later']);
  await page.getByRole('button', { name: 'Show archived tasks', exact: true }).click();
  dialog = await open(page, 'Delete all archived tasks…');
  await expect(dialog.locator('.delete-task-name')).toHaveText('Example paper · 3 tasks');
  await page.screenshot({ path: 'test-results/bulk-tasks-delete-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('No archived tasks', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Task list actions', exact: true })).toBeDisabled();
  assert.deepEqual(f.snapshot.tasks.map(t => t.id), ['Other paper task', 'Arrived later']);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:draft:Current one')), null);
  await f.context.close();

  // An unrelated selected current task must not pull the archive back to the current list.
  const archive = await fixture();
  await archive.page.getByRole('button', { name: 'Show archived tasks', exact: true }).click();
  dialog = await open(archive.page, 'Delete all archived tasks…');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(archive.page.getByRole('button', { name: 'Show current tasks', exact: true })).toHaveAttribute('aria-pressed', 'true');
  dialog = await open(archive.page, 'Delete all archived tasks…');
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(archive.page.getByText('No archived tasks', { exact: true })).toBeVisible();
  await expect(archive.page.getByRole('searchbox', { name: 'Search tasks', exact: true })).toBeFocused();
  await expect(archive.page.locator('.activity-panel')).toBeVisible();
  assert.deepEqual(archive.snapshot.tasks.map(t => t.id), ['Current one', 'Current two', 'Other paper task']);
  await archive.context.close();

  const mobile = await fixture({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: 'dark' });
  mobile.snapshot.tasks[1].status = 'running';
  dialog = await open(mobile.page, 'Delete all current tasks…');
  await expect(dialog.getByRole('button', { name: 'Delete all', exact: true })).toBeInViewport();
  await mobile.page.screenshot({ path: 'test-results/bulk-tasks-delete-mobile-dark.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Current two');
  assert.deepEqual(mobile.snapshot.tasks.map(t => t.id), ['Current two', 'Archived', 'Other paper task']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(mobile.page.locator('.task-title')).toHaveText(['Current two']);
  mobile.snapshot.tasks[0].status = 'interrupted';
  dialog = await open(mobile.page, 'Delete all current tasks…');
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mobile.page.getByText('No tasks yet', { exact: true })).toBeVisible();
  assert.deepEqual(mobile.snapshot.tasks.map(t => t.id), ['Archived', 'Other paper task']);
  await mobile.page.getByRole('button', { name: 'Show archived tasks', exact: true }).click();
  dialog = await open(mobile.page, 'Delete all archived tasks…');
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(mobile.page.getByText('No archived tasks', { exact: true })).toBeVisible();
  assert.deepEqual(mobile.snapshot.tasks.map(t => t.id), ['Other paper task']);
  await mobile.context.close();
  for (const [language, width, action, title] of [
    ['zh-CN', 390, '删除全部未归档任务…', '删除全部未归档任务？'],
    ['de', 320, 'Alle aktuellen Aufgaben löschen…', 'Alle aktuellen Aufgaben löschen?'],
  ]) {
    const localized = await fixture({ viewport: { width, height: 844 }, hasTouch: true });
    await localized.page.evaluate(language => localStorage.setItem('papilot:language', language), language);
    await localized.page.reload();
    await localized.page.locator('.main .sidebar-toggle').click();
    await localized.page.locator('.task-list-tools > .menu-anchor > button').click();
    await localized.page.getByRole('menuitem', { name: action, exact: true }).click();
    dialog = localized.page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.button-row button').last()).toBeInViewport();
    assert.equal(await dialog.locator('.modal').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await localized.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await localized.page.screenshot({ path: `test-results/bulk-tasks-${language}-mobile.png`, animations: 'disabled' });
    await localized.context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Bulk task checks passed: scope, confirmation, search, fixed targets, busy guard, partial failures, retry, drafts, selection, empty states and mobile.');
} finally { await browser.close(); await server.close(); }
