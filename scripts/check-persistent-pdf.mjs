import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

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
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const firstProblems = ['main.tex:8: Undefined control sequence.\nl.8 \\undefinedmacro\n' + 'Additional compiler context for the retained PDF.\n'.repeat(18)];
const retained = new Map([
  [1, { errors: firstProblems, download: gate() }],
  [3, { errors: ['chapters/results.tex:14: Missing $ inserted.'], metadata: gate(), download: gate() }],
  [4, { errors: ['These problems belong to a PDF that failed to download.'], failPdf: true }],
  [5, { failMetadata: true }],
  [6, { download: gate() }],
]);
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
  if (url.pathname.endsWith('/commit-message')) return json({ message: 'Revise the introduction', agent: 'codex' });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json(manuscript.git);
  if (url.pathname.endsWith('/manuscript')) return json(manuscript);
  if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.endsWith('/pdf')) {
    requests.push(url.pathname + url.search);
    const round = Number(url.searchParams.get('round')), source = retained.get(round);
    if (url.searchParams.get('metadata') === '1') {
      await source?.metadata?.promise;
      if (source?.failMetadata) return route.fulfill({ status: 503, json: { error: 'PDF metadata unavailable' } });
      return json({ url: `${url.pathname}?round=${round}&build=round-${round}`, ...(source?.errors ? { errors: source.errors } : {}) });
    }
    if (url.searchParams.has('build')) {
      await source?.download?.promise;
      if (source?.failPdf) return route.fulfill({ status: 404, json: { error: 'PDF unavailable' } });
    }
    if (url.searchParams.get('key') === 'broken') return route.fulfill({ status: 500, json: { error: 'PDF unavailable' } });
    return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  }
  throw new Error(`Unexpected request: ${url.pathname}`);
});
await page.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: brokenReview ? '<html><body>Unavailable</body></html>' : '<html><body><div id="root"><main id="paper"><div class="waiting">Building</div></main></div><script>window.addEventListener("papilot:review:view-changed", event => { document.documentElement.dataset.view = event.detail; });</script></body></html>' }));
const preview = page.locator('.task-document-preview');
const canvas = preview.locator('.pdfViewer canvas').first();
const pdfPage = preview.locator('.pdfViewer .page').first();
const views = page.getByRole('group', { name: 'Workspace view' });
async function readable() {
  await expect(preview).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(preview.locator('.review-loading')).toHaveCount(0);
  await expect.poll(() => preview.locator('.pdfViewer').evaluate(viewer => {
    const host = viewer.closest('.pdf-scroll-host')?.getBoundingClientRect();
    if (!host) return false;
    return Array.from(viewer.querySelectorAll('canvas')).some(el => {
      if (el.width <= 0 || el.height <= 0) return false;
      const rect = el.getBoundingClientRect();
      const left = Math.max(rect.left, host.left), right = Math.min(rect.right, host.right);
      const top = Math.max(rect.top, host.top), bottom = Math.min(rect.bottom, host.bottom);
      if (right <= left || bottom <= top) return false;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return Boolean(hit?.closest('.pdfViewer'));
    });
  })).toBe(true);
}
async function sync() { task.updatedAt++; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
try {
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  await readable();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-split/);
  let original = await pdfPage.elementHandle();
  for (const status of ['queued', 'waiting_input', 'building', 'failed', 'reviewing']) {
    task.status = status;
    task.error = status === 'failed' ? 'Compile failed' : null;
    task.review = { state: status === 'failed' ? 'build_failed' : 'editing', round: null, counts: {}, job: status === 'reviewing' ? { status: 'done', outcome: 'empty' } : null };
    await sync();
    await expect(page.locator(`[data-task="${task.id}"] .status`)).toContainText(status === 'reviewing' ? 'Completed' : status === 'building' ? 'Preparing task results' : status === 'waiting_input' ? 'Needs your reply' : status === 'queued' ? 'Queued' : 'Needs attention');
    await expect(preview.locator('.review-placeholder')).toHaveCount(0);
    await readable();
    assert.ok(await original.evaluate(el => el.isConnected), 'Task status must not remount the PDF');
    await expect(views.getByRole('button')).toHaveCount(3);
    // A stopped turn can build its first comparison from the toolbar, without
    // a prompt over the PDF; waiting turns and answers have nothing to build.
    await expect(preview.getByRole('button', { name: 'Generate PDF comparison', exact: true })).toHaveCount(['building', 'failed'].includes(status) ? 1 : 0);
  }
  await expect(page.getByRole('button', { name: 'Generate PDF comparison', exact: true })).toHaveCount(0);
  // Until a task has a review, its PDF takes every marking tool. Marks join
  // the chat's unsent message, drawn on the PDF they were made on; undo takes
  // them back, and a written note opens the chat with it.
  const rail = preview.getByRole('toolbar', { name: 'Marking tools' });
  await expect(rail.getByRole('button', { name: 'Note', exact: true })).toBeVisible();
  const word = preview.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: /\S/ }).first();
  // pdf.js redraws the pages under a selection when the reader resizes, such
  // as when a failed build's message appears; select again until the page
  // offers its tools.
  const addNote = preview.locator('.add-note');
  const selectWord = () => expect.poll(async () => {
    if (!await addNote.isVisible()) await word.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    return addNote.isVisible();
  }).toBe(true);
  const unsent = () => page.evaluate(() => JSON.parse(localStorage.getItem('papilot:review-notes:task') || '{"notes":[]}').notes);
  await selectWord(); await rail.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await unsent()).map(note => [note.kind, note.paper?.key, note.strip])).toEqual([['delete', 'baseline', 'paper:0']]);
  await expect(preview.locator('.note-mark[data-kind="delete"]').first()).toBeVisible();
  await rail.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await unsent()).length).toBe(0);
  await expect(preview.locator('.note-mark')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Select', exact: true }).click();
  await selectWord(); await rail.getByRole('button', { name: 'Note', exact: true }).click();
  const noteText = page.getByRole('textbox', { name: 'Edit note 1', exact: true });
  await noteText.fill('Say this more plainly.'); await noteText.press('Enter');
  await expect.poll(async () => (await unsent()).map(note => [note.comment, note.paper?.key])).toEqual([['Say this more plainly.', 'baseline']]);
  await expect(page.getByLabel('Review feedback')).toContainText('Say this more plainly.');
  await expect(preview.locator('.note-tag')).toHaveCount(1);
  await rail.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await unsent()).length).toBe(0);
  await expect(preview.locator('.note-mark')).toHaveCount(0);
  // Resizing redraws the canvas inside a retained page. Track the page itself
  // to distinguish a new document from a new raster at the current width.
  await readable();
  original = await pdfPage.elementHandle();
  // A new, unavailable PDF must leave the successfully loaded pages intact.
  manuscript.build = { status: 'failed', key: 'broken', current: false, error: 'Compile failed' };
  await sync();
  await expect.poll(() => requests.some(url => url.includes('key=broken'))).toBe(true);
  await readable(); assert.ok(await original.evaluate(el => el.isConnected));
  // The retained PDF still takes marks: they name its build, show on it, and
  // undo takes them back.
  await rail.getByRole('button', { name: 'Select', exact: true }).click();
  await selectWord(); await rail.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await unsent()).map(note => [note.kind, note.paper?.key])).toEqual([['delete', 'baseline']]);
  await expect(preview.locator('.note-mark[data-kind="delete"]').first()).toBeVisible();
  await rail.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await unsent()).length).toBe(0);
  await expect(preview.locator('.note-mark')).toHaveCount(0);
  manuscript.build.key = 'baseline';
  task.status = 'building'; task.review = { state: 'building', round: 1, counts: {} }; await sync();
  await expect(page.locator('.review-viewport')).toHaveClass(/review-pending/);
  await readable();
  // Comparison readiness replaces the preview; the retained reader loads that
  // successful round so a later frame error brings the task's own PDF back.
  task.status = 'reviewing'; task.review.state = 'reviewing'; await sync();
  const frame = page.frameLocator('.review-frame');
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'changes');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p class="comparison-waiting" data-state="pending">Comparing</p>'; });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
  await frame.locator('.comparison-waiting').evaluate(el => el.setAttribute('data-state', 'failed'));
  await expect(page.getByRole('button', { name: 'Reload review', exact: true })).toBeVisible();
  await readable();
  await frame.locator('#paper').evaluate(el => {
    document.documentElement.dataset.papilotRound = '1';
    document.documentElement.dataset.fullPaper = 'available';
    el.innerHTML = '<p>Changes are ready</p>';
  });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
  await expect.poll(() => requests.some(url => url.includes('/tasks/task/pdf?round=1&retained=1'))).toBe(true);
  await page.locator('.review-host-bar').getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'paper');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<div class="paper-status" role="status">Preparing the full PDF…</div>'; });
  await readable();
  const problems = preview.locator('.pdf-compilation-problems');
  await expect.poll(() => requests.some(url => url.endsWith('round=1&build=round-1'))).toBe(true);
  assert.ok(await original.evaluate(el => el.isConnected), 'Metadata must not replace the current pages');
  await expect(problems).toHaveCount(0);
  retained.get(1).download.release();
  await expect(problems).toBeVisible();
  await expect(problems.locator('pre')).toHaveText(firstProblems.join('\n\n'));
  await readable();
  // Native disclosure controls remain operable by keyboard, with a separate
  // focusable scroll area that leaves the PDF usable even for a long log.
  await problems.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(problems).toHaveAttribute('open', '');
  await page.keyboard.press('Tab'); await expect(problems.locator('pre')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => problems.locator('pre').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  fs.mkdirSync('test-results', { recursive: true });
  for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    // Writing a note opens Chat; explicitly return to the PDF on a phone.
    if (size === 'mobile') await views.getByRole('button', { name: 'Review', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await readable();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await problems.locator('pre').boundingBox()).height <= 160);
      await problems.locator('pre').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `test-results/persistent-pdf-problems-${size}-${theme}.png`, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
  await problems.locator('summary').focus(); await page.keyboard.press(' ');
  await expect(problems).not.toHaveAttribute('open');
  await expect(preview.locator('.pdf-toolbar').getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
  await preview.locator('.pdf-toolbar').getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'changes');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p>Changes are ready</p>'; });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
  await page.locator('.review-host-bar').getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'paper');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<div class="paper-status" role="alert">Full PDF unavailable</div>'; });
  await readable();
  await page.locator('.keeps-pdf > .review-loading').getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-view', 'changes');
  await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p>Changes are ready</p>'; });
  await expect(page.locator('.task-document')).toHaveClass(/has-review/);
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
  // The retained reader must keep both pages and their diagnostics until the
  // replacement metadata and immutable PDF have each loaded successfully.
  async function publish(round) {
    task.status = 'reviewing'; task.review = { state: 'reviewing', round, counts: { pending: 1 } }; await sync();
    await frame.locator('#paper').evaluate((el, round) => {
      document.documentElement.dataset.papilotRound = String(round);
      el.innerHTML = '<p>Changes are ready</p>';
    }, round);
    await expect.poll(() => requests.some(url => url.includes(`round=${round}&retained=1&metadata=1`))).toBe(true);
    await frame.locator('#paper').evaluate(el => { el.innerHTML = '<p class="comparison-waiting" data-state="failed">Comparison unavailable</p>'; });
    await readable();
  }
  const firstRetained = await pdfPage.elementHandle();
  await publish(3);
  await expect(problems.locator('pre')).toHaveText(firstProblems.join('\n\n'));
  assert.ok(await firstRetained.evaluate(el => el.isConnected));
  retained.get(3).metadata.release();
  await expect.poll(() => requests.some(url => url.endsWith('round=3&build=round-3'))).toBe(true);
  await expect(problems.locator('pre')).toHaveText(firstProblems.join('\n\n'));
  assert.ok(await firstRetained.evaluate(el => el.isConnected));
  retained.get(3).download.release();
  await expect(problems.locator('pre')).toHaveText(retained.get(3).errors[0]);
  await readable();
  assert.equal(await firstRetained.evaluate(el => el.isConnected), false);
  const replacement = await pdfPage.elementHandle();
  const failedPdf = page.waitForResponse(response => response.url().endsWith('round=4&build=round-4'));
  await publish(4); assert.equal((await failedPdf).status(), 404);
  await expect(problems.locator('pre')).toHaveText(retained.get(3).errors[0]);
  assert.ok(await replacement.evaluate(el => el.isConnected), 'A failed PDF download keeps the previous document and errors');
  const failedMetadata = page.waitForResponse(response => response.url().endsWith('round=5&retained=1&metadata=1'));
  await publish(5); assert.equal((await failedMetadata).status(), 503);
  await expect(problems.locator('pre')).toHaveText(retained.get(3).errors[0]);
  assert.ok(await replacement.evaluate(el => el.isConnected), 'A failed metadata request keeps the previous document and errors');
  assert.ok(!requests.some(url => url.endsWith('round=5&build=round-5')));
  await publish(6);
  await expect.poll(() => requests.some(url => url.endsWith('round=6&build=round-6'))).toBe(true);
  await expect(problems.locator('pre')).toHaveText(retained.get(3).errors[0]);
  assert.ok(await replacement.evaluate(el => el.isConnected), 'Clean metadata alone must not clear the displayed diagnostics');
  retained.get(6).download.release();
  await expect(problems).toHaveCount(0); await readable();
  assert.equal(await replacement.evaluate(el => el.isConnected), false, 'The repaired PDF replaces the pages and clears their old diagnostics together');
  task.status = 'failed'; task.review = { state: 'build_failed', round: 7, counts: {}, job: { status: 'failed' } }; await sync();
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
  await readable();
  const box = preview.locator('.pdf-container');
  await preview.locator('.page[data-page-number="2"]').waitFor();
  await expect.poll(() => box.evaluate(el => el.scrollHeight)).toBeGreaterThan(1800);
  await box.evaluate(el => { el.scrollTop = el.scrollHeight * 0.62; });
  await expect.poll(() => box.evaluate(el => Math.round(el.scrollTop))).toBeGreaterThan(500);
  await page.waitForTimeout(250);
  await views.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(preview).toBeHidden();
  await page.keyboard.press('Control+f');
  await page.keyboard.press('Meta+f');
  await expect(preview.getByRole('textbox', { name: 'Search the PDF', exact: true, includeHidden: true })).toHaveCount(0);
  brokenReview = false;
  task.status = 'running'; task.review = { state: 'editing', round: null, counts: {} };
  manuscript.build = { status: 'ready', key: 'rebuilt', current: true };
  await sync();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-conversation/);
  await expect.poll(() => requests.some(url => url.includes('key=rebuilt'))).toBe(true);
  await views.getByRole('button', { name: 'Split', exact: true }).click();
  await readable();
  await expect.poll(() => box.evaluate(el => Math.round(el.scrollTop))).toBeGreaterThan(500);
  // A chosen view lasts for the session; Papilot starts side by side again.
  await views.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-conversation/);
  await page.evaluate(() => localStorage.setItem('papilot:layout', 'conversation'));
  await page.reload();
  await expect(page.locator('.task-grid')).toHaveClass(/layout-split/);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:layout')), null, 'An earlier saved view is cleared');
  assert.deepEqual(errors, []);
  console.log('PASS: Persistent PDF across task states, marking before review, build-bound diagnostics, delayed/failed/repaired replacements, keyboard disclosure, desktop/mobile themes, PDF-mode escape, hidden Chat shortcuts/place retention, and reload');
} catch (error) {
  console.error(error);
  await page.screenshot({ path: 'test-results/persistent-pdf-failure.png' }).catch(() => {});
  throw error;
} finally {
  for (const source of retained.values()) { source.metadata?.release(); source.download?.release(); }
  await browser.close(); await server.close();
}
