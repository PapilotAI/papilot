import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../engine/node_modules/@playwright/test/index.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'task', projectId: 'paper', agent: 'codex', name: 'task', title: 'Revise the introduction', instructions: '', worktree: '/tmp/paper', threadId: 'thread', turnId: null, model: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: { state: 'editing', round: null, counts: {} } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const manuscript = { annotations: [], git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'baseline', current: true } };
let brokenReview = false;
await page.addInitScript(() => { localStorage.setItem('papilot:task', 'task'); localStorage.setItem('papilot:language', 'en'); });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/updates')) return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/indirect-changes')) return json({ indirectChanges: false });
  if (url.pathname.endsWith('/note-alternatives')) return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname.endsWith('/quick-notes')) return json({ quickNotes: null });
  if (url.pathname.endsWith('/predict')) return route.fulfill({ json: { ok: true } });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json(manuscript.git);
  if (url.pathname.endsWith('/manuscript')) return json(manuscript);
  if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.endsWith('/pdf')) {
    requests.push(url.pathname + url.search);
    if (url.searchParams.get('key') === 'broken') return route.fulfill({ status: 500, json: { error: 'PDF unavailable' } });
    return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  }
  throw new Error(`Unexpected request: ${url.pathname}`);
});
await page.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: brokenReview ? '<html><body>Unavailable</body></html>' : '<html><body><div id="root"><main id="paper"><div class="waiting">Building</div></main></div><script>window.addEventListener("latex-review:view-changed", event => { document.documentElement.dataset.view = event.detail; });</script></body></html>' }));
const preview = page.locator('.task-document-preview');
const canvas = preview.locator('.pdfViewer canvas').first();
const views = page.getByRole('group', { name: 'Workspace view' });
async function readable() { await expect(preview).toBeVisible(); await expect(canvas).toBeVisible(); assert.ok(await canvas.evaluate(el => el.width > 0 && el.height > 0)); }
async function sync() { task.updatedAt++; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
try {
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  await readable();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-split/);
  const original = await canvas.elementHandle();
  for (const status of ['queued', 'waiting_input', 'building', 'failed', 'reviewing']) {
    task.status = status;
    task.error = status === 'failed' ? 'Compile failed' : null;
    task.review = { state: status === 'failed' ? 'build_failed' : 'editing', round: null, counts: {}, job: status === 'reviewing' ? { status: 'done', outcome: 'empty' } : null };
    await sync();
    await expect(preview).toContainText(status === 'reviewing' ? 'No manuscript changes' : status === 'building' ? 'Preparing task results' : status === 'waiting_input' ? 'Needs your reply' : status === 'queued' ? 'Queued' : 'PDF comparison');
    await readable();
    assert.ok(await original.evaluate(el => el.isConnected), 'Task status must not remount the PDF');
    await expect(views.getByRole('button')).toHaveCount(3);
  }
  await expect(page.getByRole('button', { name: 'Generate PDF comparison', exact: true })).toHaveCount(0);
  // A new, unavailable PDF must leave the successfully loaded pages intact.
  manuscript.build = { status: 'failed', key: 'broken', current: false, error: 'Compile failed' };
  await sync();
  await expect.poll(() => requests.some(url => url.includes('key=broken'))).toBe(true);
  await readable(); assert.ok(await original.evaluate(el => el.isConnected));
  manuscript.build.key = 'baseline';
  task.status = 'building'; task.review = { state: 'building', round: 1, counts: {} }; await sync();
  await expect(page.locator('.review-viewport')).toHaveClass(/review-pending/);
  await readable();
  // Comparison readiness replaces the preview; the retained reader loads that
  // successful round so a later frame error brings the task's own PDF back.
  task.status = 'reviewing'; task.review.state = 'reviewing'; await sync();
  const frame = page.frameLocator('.review-frame');
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'paper');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p class="comparison-waiting" data-state="failed">Comparison failed</p>'; });
  await expect(page.getByRole('button', { name: 'Reload review', exact: true })).toBeVisible();
  await readable();
  await frame.locator('#paper').evaluate(el => { document.documentElement.dataset.papilotRound = '1'; el.innerHTML = '<p>Changes are ready</p>'; });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
  await expect.poll(() => requests.some(url => url.includes('/tasks/task/pdf?round=1'))).toBe(true);
  await frame.locator('#paper').evaluate(el => { el.insertAdjacentHTML('beforeend', '<p class="inline-error" role="alert">Could not save note</p>'); });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
  task.status = 'building'; task.review = { state: 'building', round: 2, counts: {} }; await sync();
  await expect(page.getByRole('button', { name: 'Regenerate PDF comparison', exact: true })).toHaveAttribute('aria-busy', 'true');
  await frame.locator('#paper').evaluate(() => { document.documentElement.dataset.papilotRound = '2'; });
  task.status = 'failed'; task.review = { state: 'build_failed', round: 2, counts: {}, job: { status: 'failed' } }; await sync();
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p class="empty" role="alert">Compile failed</p>'; });
  await readable();
  await expect(page.getByRole('button', { name: 'Retry build', exact: true })).toBeVisible();
  assert.ok(!requests.some(url => url.includes('round=2')), 'Never replace the PDF with a failed round');
  task.status = 'reviewing'; task.deferred = true; task.review = { state: 'done', round: 2, counts: { pending: 0, accepted: 1 }, files: ['main.tex'] }; await sync();
  await expect(page.locator('.task-document-actions').getByRole('button', { name: 'Apply to workspace', exact: true })).toBeVisible();
  task.status = 'failed'; task.deferred = false; task.review = { state: 'build_failed', round: 2, counts: {}, job: { status: 'failed' } }; await sync();
  await expect(page.locator('.task-document-actions').getByRole('button', { name: 'Apply to workspace', exact: true })).toHaveCount(0);
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/persistent-pdf-desktop.png' });
  // Reloading a failed review still has the manuscript as a fallback.
  brokenReview = true; await page.reload(); await readable();
  await expect(page.getByRole('button', { name: 'Reload review', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await readable(); await expect(views.getByRole('button')).toHaveCount(2);
  await views.getByRole('button', { name: 'Chat', exact: true }).click(); await expect(preview).toBeHidden();
  await views.getByRole('button', { name: 'Review', exact: true }).click(); await readable();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/persistent-pdf-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await views.getByRole('button', { name: 'Chat', exact: true }).click();
  task.status = 'running'; task.review = { state: 'editing', round: null, counts: {} }; await sync();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-conversation/);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:layout')), 'conversation');
  assert.deepEqual(errors, []);
  console.log('PASS: Persistent PDF across task states, no changes, failed replacement, review readiness/failure, reload, mobile, and explicit chat preference');
} finally { await browser.close(); await server.close(); }
