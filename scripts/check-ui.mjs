import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
fs.mkdirSync('test-results', { recursive: true });
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../vendor/latex-review/node_modules/playwright/index.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.clock.install();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const task = { id: 'fixture-task-0001', projectId: 'fixture-paper', name: 'p-fixture', title: 'Clarify the introduction', instructions: 'Keep the technical meaning.', worktree: '/tmp/fixture', threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: { state: 'reviewing', round: 1, counts: { pending: 3, commented: 1 } } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: task.projectId, name: 'Example paper', path: '/tmp/fixture', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'fast-model', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }, { id: 'deep-model', name: 'Deep model', isDefault: false, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' }], usage: { plan: 'pro', windows: [{ usedPercent: 83, minutes: 10080, resetsAt: Date.now() + 3 * 86_400_000 }], credits: { unlimited: false, balance: 12418.76 }, reached: false } } };
// Claude is available with its own models; Antigravity is not installed.
snapshot.runtimes = { codex: snapshot.runtime, claude: { connected: true, authenticated: true, account: 'Claude Max', error: null, models: [{ id: 'opus', name: 'Opus 5.5', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: null }, { id: 'haiku', name: 'Haiku 5.5', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: null }] }, antigravity: { connected: false, authenticated: false, account: null, error: 'spawn agy ENOENT', models: [] } };
const messages = [];
const creates = [];
let failCreate = true;
let createResult = task;
let heldState;
let stateStarted;
let releaseState;
let holdMessage;
let releaseMessage;
let stateFailure = false;
let itemsFailure = false;
let history = null;
let reviewFailure = false;
let reviewStarting = false;
let deleteFailure = false;
const deletions = [];
const renames = [];
const gitState = { remote: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, head: { hash: 'abc1234', subject: 'Draft the introduction', date: 1 }, files: [{ path: 'main.tex', status: 'M', staged: false, lines: [2, 4] }, { path: 'notes.md', status: '?', staged: false }] };
const originalGit = structuredClone(gitState);
const gitCommits = [], gitActions = [];
const manuscriptBuild = { status: 'ready', key: 'fixture', pages: [[612, 792], [612, 792]], builtAt: 1, current: true };
let annotations = [];
const noteSends = [];
const fixturePdf = fs.readFileSync('tests/fixtures/outline.pdf');
const interruptions = [];
await context.addInitScript(() => localStorage.setItem('papilot:task', 'removed-task'));
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/state') {
    if (stateFailure) return route.fulfill({ status: 503, json: { error: 'Host unavailable.' } });
    const captured = structuredClone(snapshot);
    if (heldState) { const hold = heldState; heldState = null; stateStarted?.(); await hold; }
    return json(captured);
  }
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/items') && itemsFailure) return route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable.' } });
  if (url.pathname.endsWith('/items') && history) return json({ items: history });
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'hello', taskId: task.id, type: 'assistant', text: 'The introduction is ready for review.', createdAt: 1 }] });
  if (url.pathname.endsWith('/git')) return json(gitState);
  if (url.pathname.endsWith('/git/diff')) return json({ path: url.searchParams.get('path'), diff: 'diff --git a/main.tex b/main.tex\n--- a/main.tex\n+++ b/main.tex\n@@ -1,2 +1,2 @@\n-Old line.\n+New line.\n Context.\n', truncated: false });
  if (url.pathname.endsWith('/git/commit')) {
    const body = route.request().postDataJSON(); gitCommits.push(body);
    Object.assign(gitState, { files: gitState.files.filter(file => !body.paths.includes(file.path)), ahead: gitState.ahead + 1, head: { hash: 'def5678', subject: body.message, date: 2 } });
    return json({ commit: 'def5678', git: gitState });
  }
  if (/\/git\/(fetch|pull|push)$/.test(url.pathname)) { const action = url.pathname.split('/').pop(); gitActions.push(action); if (action === 'push') gitState.ahead = 0; return json({ git: gitState }); }
  if (url.pathname.endsWith('/manuscript')) return json({ git: gitState, build: manuscriptBuild, annotations });
  if (url.pathname.endsWith('/annotations/send')) {
    const body = route.request().postDataJSON(); noteSends.push(body);
    const created = { ...task, id: body.id, name: 'p-notes', title: 'Address a PDF note', status: 'queued', review: null };
    snapshot.tasks.push(created); annotations = [];
    return json(created);
  }
  if (url.pathname.endsWith('/delete') && url.pathname.includes('/annotations/')) { const id = url.pathname.split('/')[5]; annotations = annotations.filter(note => note.id !== id); return json({ ok: true }); }
  if (url.pathname.endsWith('/annotations')) {
    const body = route.request().postDataJSON();
    const note = { id: `note-${annotations.length + 1}`, projectId: task.projectId, quote: 'The marked fixture sentence.', ...body, source: { file: 'main.tex', lines: [10, 12], excerpt: 'The marked \\emph{fixture} sentence.' }, createdAt: 1 };
    annotations.push(note); return json(note);
  }
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fixturePdf });
  if (url.pathname.endsWith('/rename')) { const id = url.pathname.split('/')[3], body = route.request().postDataJSON(); renames.push({ id, ...body }); snapshot.tasks.find(t => t.id === id).title = body.title; return json(snapshot.tasks.find(t => t.id === id)); }
  if (url.pathname.endsWith('/interrupt')) { const id = url.pathname.split('/')[3]; interruptions.push(id); snapshot.tasks.find(t => t.id === id).status = 'interrupted'; return json({ ok: true }); }
  if (url.pathname.endsWith('/delete')) {
    const id = url.pathname.split('/')[3];
    deletions.push({ id, body: route.request().postDataJSON() });
    if (deleteFailure) {
      snapshot.tasks.find(t => t.id === id).status = 'deleting';
      return route.fulfill({ status: 503, json: { error: 'The cleanup response was lost. Retry deletion to confirm it.' } });
    }
    snapshot.tasks = snapshot.tasks.filter(t => t.id !== id);
    return json({ deleted: true });
  }
  if (url.pathname.endsWith('/messages')) {
    messages.push(route.request().postDataJSON());
    if (holdMessage) await holdMessage;
    return json({ ok: true });
  }
  if (url.pathname === '/api/tasks' && route.request().method() === 'POST') {
    creates.push(route.request().postDataJSON());
    if (failCreate) return route.fulfill({ status: 503, json: { error: 'Connection lost. Try again.' } });
    if (!snapshot.tasks.some(t => t.id === createResult.id)) snapshot.tasks.push(createResult);
    return json(createResult);
  }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
});
await page.route('**/review/**', route => reviewFailure ? route.fulfill({ status: 503, json: { error: 'Review server unavailable.' } }) : reviewStarting ? route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><div id="root"></div></body></html>' }) : route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head></head><body><div class="bar">Review round 1</div><main id="paper"><h2>Introduction</h2><p>PDF review fixture</p></main></body></html>' }));

async function openDelete(title = task.title) {
  const show = page.getByRole('button', { name: 'Show task list', exact: true });
  // The drawer slides closed; check its open state rather than its in-transition visibility.
  const narrow = await page.evaluate(() => matchMedia('(max-width: 900px)').matches);
  if (narrow ? !(await page.locator('.sidebar.is-open').count()) : await show.count()) await show.click();
  await page.getByRole('button', { name: `Task actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).click();
}

try {
  await page.goto(origin);
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'What are we revising next?' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.doesNotMatch(await page.locator('body').innerText(), /\p{Script=Han}/u);

  const switcher = page.getByRole('button', { name: 'Paper: Example paper', exact: true });
  await switcher.click();
  await page.getByRole('menuitemradio', { name: 'Example paper', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Example paper', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitem', { name: 'Add paper…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a paper' });
  await dialog.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Repository path' }).evaluate(el => el === document.activeElement), true);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press(i < 5 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await switcher.evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Describe the revision' });
  await prompt.waitFor();
  assert.equal(await prompt.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.getByRole('button', { name: 'Start task' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'New task', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.getByText(/Proofread|Each task edits its own Git worktree/).count(), 0);
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  console.log('PASS: English UI, stale selection recovery, paper menu, modal focus containment, Escape, focus restoration, and the new-task composer');
  const views = page.locator('.view-selector');
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('region', { name: 'Codex conversation', exact: true }).isVisible(), false);
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Review', exact: true }).getAttribute('aria-pressed'), 'true');
  await views.getByRole('button', { name: 'Chat', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), false);
  await page.getByText('Round 1 is ready · 3 changes to decide', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Split', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Open review', exact: true }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.topbar .full-pdf-link').count(), 0);
  assert.equal(await page.locator('.topbar').getByRole('button', { name: 'Delete task', exact: true }).count(), 0);
  const reviewOptions = page.getByRole('button', { name: 'Review options', exact: true });
  await reviewOptions.focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('menu', { name: 'Review options', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Build review', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('menuitem', { name: 'Open review in new tab', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await reviewOptions.evaluate(el => el === document.activeElement), true);
  console.log('PASS: Views select explicitly, PDF tools stay with the review, and menus support keyboard navigation');

  const pdfLink = page.getByRole('button', { name: /^PDF/ });
  await pdfLink.locator('.nav-meta').filter({ hasText: 'main · 2 changed · ↑1' }).waitFor();
  await pdfLink.click();
  await page.getByRole('heading', { name: 'PDF', exact: true }).waitFor();
  assert.equal(await pdfLink.getAttribute('aria-current'), 'page');
  const pdfPages = page.locator('.pdfViewer .page');
  await page.locator('.textLayer span').filter({ hasText: 'Fixture sentence' }).first().waitFor();
  assert.equal(await pdfPages.count(), 2);
  assert.equal(await page.getByLabel('Page number').inputValue(), '1');
  // Bookmarks fill the Contents panel and jump to their page.
  const contents = page.getByRole('region', { name: 'Contents', exact: true });
  assert.deepEqual((await contents.getByRole('button').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')), ['Introduction 1', 'Method 2', 'Results 2']);
  await contents.getByRole('button', { name: /^Results/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
  assert.equal(await page.locator('.pdf-section-title').innerText(), 'Results');
  assert.equal(await contents.getByRole('button', { name: /^Results/ }).getAttribute('aria-current'), 'location');
  await page.getByLabel('Page number').fill('1');
  await page.getByLabel('Page number').press('Enter');
  await page.waitForFunction(() => document.querySelector('.pdf-section-title').textContent === 'Introduction');
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /^Method/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '1');
  // Zoom steps away from fit width and returns to it; the choice is remembered.
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  assert.equal(await zoom.inputValue(), 'page-width');
  const width = (await pdfPages.first().boundingBox()).width;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(() => /^[\d.]+$/.test(document.querySelector('select[aria-label="Zoom"]').value));
  assert.ok((await pdfPages.first().boundingBox()).width > width);
  await zoom.selectOption('page-width');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Zoom"]').value === 'page-width');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:pdf-zoom')), 'page-width');
  // Find runs across every page.
  await page.locator('.pdf-container').focus();
  await page.keyboard.press('ControlOrMeta+f');
  const findBox = page.getByRole('textbox', { name: 'Search the PDF' });
  assert.equal(await findBox.evaluate(el => el === document.activeElement), true);
  await findBox.fill('operator');
  await page.locator('.pdf-find-count').filter({ hasText: '1 of 1' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
  await findBox.fill('nowhere in the fixture');
  await page.locator('.pdf-find-count').filter({ hasText: 'No matches' }).waitFor();
  await findBox.press('Escape');
  await findBox.waitFor({ state: 'hidden' });
  // Select text, write a note, cancel it, delete one, then send another.
  const notesPanel = page.getByRole('region', { name: 'PDF notes' });
  const selectText = async () => {
    await page.getByLabel('Page number').fill('1');
    await page.getByLabel('Page number').press('Enter');
    const span = page.locator('.textLayer span').filter({ hasText: 'Fixture sentence' }).first();
    await span.scrollIntoViewIfNeeded();
    const box = await span.boundingBox();
    // Start inside "Fixture"; the note still takes the whole word.
    await page.mouse.move(box.x + 14, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.doesNotMatch(await page.evaluate(() => document.getSelection().toString()), /^F/);
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    const note = page.getByRole('textbox', { name: 'Note for the agent' });
    assert.equal(await note.evaluate(el => el === document.activeElement), true);
    return note;
  };
  let noteBox = await selectText();
  await noteBox.press('Escape');
  await noteBox.waitFor({ state: 'hidden' });
  assert.equal(annotations.length, 0);
  noteBox = await selectText();
  await noteBox.fill('Shorten this sentence.');
  await noteBox.press('Enter');
  await notesPanel.getByText('The marked \\emph{fixture} sentence.', { exact: true }).waitFor();
  assert.equal(annotations[0].page, 0);
  assert.equal(annotations[0].key, 'fixture');
  assert.match(annotations[0].quote, /^Fixture sentence/);
  assert.ok(annotations[0].rects.length >= 1 && annotations[0].rects.every(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1 && y1 < 0.5));
  await page.getByRole('button', { name: 'Note 1: Shorten this sentence.' }).waitFor();
  assert.ok(await page.locator('.note-mark').count() >= 1);
  await notesPanel.getByRole('button', { name: 'Delete note 1' }).click();
  await page.getByRole('button', { name: 'Note 1: Shorten this sentence.' }).waitFor({ state: 'hidden' });
  assert.equal(annotations.length, 0);
  // A region marks a figure or equation that has no text to select.
  await page.getByRole('button', { name: 'Mark region', exact: true }).click();
  const firstPage = await pdfPages.first().boundingBox();
  await page.mouse.move(firstPage.x + firstPage.width * 0.2, firstPage.y + firstPage.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(firstPage.x + firstPage.width * 0.7, firstPage.y + firstPage.height * 0.36, { steps: 5 });
  await page.mouse.up();
  noteBox = page.getByRole('textbox', { name: 'Note for the agent' });
  assert.equal(await noteBox.evaluate(el => el === document.activeElement), true);
  await noteBox.fill('Define the operator here.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await notesPanel.getByText('Page 1 · main.tex:10–12', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mark region', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(annotations[0].rects, undefined);
  assert.ok(annotations[0].rect[0] > 0.15 && annotations[0].rect[2] < 0.75 && annotations[0].rect[1] < annotations[0].rect[3]);
  await notesPanel.getByRole('button', { name: 'Send 1 note to the agent' }).click();
  await page.getByRole('heading', { name: 'Address a PDF note' }).waitFor();
  assert.equal(noteSends.length, 1);
  assert.ok(noteSends[0].id.length >= 16);
  const notesTask = noteSends[0].id;
  snapshot.tasks = snapshot.tasks.filter(t => t.id !== notesTask);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await pdfLink.click();
  await page.getByRole('heading', { name: 'PDF', exact: true }).waitFor();
  await page.getByRole('tab', { name: /^Git/ }).click();
  const gitPanel = page.getByRole('region', { name: 'Git status' });
  await gitPanel.getByText('main.tex', { exact: true }).waitFor();
  await gitPanel.getByText('notes.md', { exact: true }).waitFor();
  const gitText = await gitPanel.innerText();
  assert.match(gitText, /^main\s+↑1/);
  assert.match(gitText, /Tracking origin\/main/);
  assert.match(gitText, /Draft the introduction\s+abc1234/);
  assert.equal(await gitPanel.getByLabel('Untracked').innerText(), 'U');
  // Changes can be read as diffs, chosen and committed, then pushed.
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Include main.tex' }).isChecked(), true);
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Include notes.md' }).isChecked(), true);
  await gitPanel.getByRole('button', { name: 'main.tex', exact: true }).click();
  await gitPanel.getByRole('region', { name: 'Changes in main.tex' }).getByText('+New line.', { exact: true }).waitFor();
  await gitPanel.getByRole('checkbox', { name: 'Include notes.md' }).uncheck();
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Include all changes' }).evaluate(box => box.indeterminate), true);
  assert.equal(await gitPanel.getByRole('button', { name: 'Commit 1 of 2 files' }).isDisabled(), true);
  const commitMessage = gitPanel.getByRole('textbox', { name: 'Commit message' });
  await commitMessage.fill('Tighten the introduction');
  await commitMessage.press('Enter');
  await gitPanel.getByRole('status').filter({ hasText: 'Committed def5678.' }).waitFor();
  assert.deepEqual(gitCommits, [{ message: 'Tighten the introduction', paths: ['main.tex'] }]);
  assert.equal(await commitMessage.inputValue(), '');
  assert.match(await gitPanel.innerText(), /Tighten the introduction\s+def5678/);
  await gitPanel.getByRole('button', { name: 'Push', exact: true }).click();
  await gitPanel.getByRole('status').filter({ hasText: 'Pushed to origin/main.' }).waitFor();
  assert.deepEqual(gitActions, ['push']);
  assert.equal(await gitPanel.getByRole('button', { name: 'Push', exact: true }).count(), 0);
  Object.assign(gitState, structuredClone(originalGit));
  assert.equal(await page.getByRole('link', { name: 'Open the PDF file' }).getAttribute('href'), '/api/projects/fixture-paper/manuscript.pdf?key=fixture');
  assert.equal(await page.title(), 'Example paper · Papilot');
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('heading', { name: task.title }).waitFor();
  console.log('PASS: Each paper has a PDF view with contents, paging, zoom and find; text and region notes are added, deleted and sent as one task; Git changes are diffed, committed and pushed');

  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  const chatPanel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  const defaultWidth = Math.round((await chatPanel.boundingBox()).width);
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(Math.round((await chatPanel.boundingBox()).width), defaultWidth + 24);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:chat-width')), String(defaultWidth + 24));
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 300);
  await page.mouse.down();
  await page.mouse.move(handle.x - 96, handle.y + 300, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs((await chatPanel.boundingBox()).width - (defaultWidth + 124)) <= 2);
  await divider.dblclick();
  assert.equal(Math.round((await chatPanel.boundingBox()).width), defaultWidth);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:chat-width')), null);
  const copy = page.getByRole('button', { name: 'Copy message' });
  await copy.click();
  await page.getByRole('button', { name: 'Copied' }).waitFor();
  await page.getByText('1 comment not sent yet', { exact: true }).waitFor();
  await page.getByText('1 review comment will be sent with this message', { exact: true }).waitFor();
  task.review.unsent = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Enter to send · Shift+Enter for a new line', { exact: true }).waitFor();
  delete task.review.unsent;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor();
  console.log('PASS: The chat divider drags, nudges, persists and resets; replies copy; only unsent comments offer Send feedback');


  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await prompt.fill('Shorten the introduction.');
  await prompt.press('Shift+Enter');
  await prompt.pressSequentially('Preserve the technical content.');
  await prompt.press('Enter');
  await page.locator('.home').getByRole('alert').waitFor();
  assert.equal(await prompt.inputValue(), 'Shorten the introduction.\nPreserve the technical content.');
  // The new-task page shows the Codex account's usage.
  const usage = page.getByRole('region', { name: 'Codex usage' });
  assert.equal(await usage.getByRole('meter', { name: 'Weekly limit used' }).getAttribute('aria-valuenow'), '83');
  assert.match(await usage.innerText(), /Pro[\s\S]*Weekly limit[\s\S]*83% used[\s\S]*resets [\s\S]*12,418 credits/);
  // Agent, model and reasoning effort are chosen beside the prompt and remembered.
  const agentChip = page.getByRole('combobox', { name: 'Agent', exact: true });
  const modelChip = page.getByRole('combobox', { name: 'Model', exact: true });
  assert.equal(await agentChip.inputValue(), 'codex');
  assert.deepEqual(await agentChip.locator('option').allInnerTexts(), ['Codex', 'Claude', 'Antigravity · unavailable']);
  const effortChip = page.getByRole('button', { name: /^Reasoning effort/ });
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Medium');
  await modelChip.selectOption('deep-model');
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: High');
  await effortChip.click();
  const effortSlider = page.getByRole('slider', { name: 'Reasoning effort' });
  assert.equal(await effortSlider.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await effortSlider.getAttribute('aria-valuetext'), 'Extra high');
  await page.keyboard.press('Escape');
  await effortSlider.waitFor({ state: 'hidden' });
  assert.equal(await effortChip.evaluate(el => el === document.activeElement), true);
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Extra high');
  // A model without that effort uses its own default; the choice returns with the model.
  await modelChip.selectOption('fast-model');
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Medium');
  await modelChip.selectOption('deep-model');
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Extra high');
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('papilot:model:codex'), localStorage.getItem('papilot:effort:codex')]), ['deep-model', 'xhigh']);
  // Each agent lists its own models and keeps its own choice.
  await agentChip.selectOption('claude');
  assert.deepEqual(await modelChip.locator('option').allInnerTexts(), ['Default model', 'Opus 5.5', 'Haiku 5.5']);
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Default');
  await modelChip.selectOption('haiku');
  await agentChip.selectOption('antigravity');
  await page.locator('.home').getByText('Antigravity is unavailable on this host: spawn agy ENOENT').waitFor();
  await agentChip.selectOption('codex');
  assert.equal(await modelChip.inputValue(), 'deep-model');
  assert.equal(await effortChip.getAttribute('aria-label'), 'Reasoning effort: Extra high');
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('papilot:agent'), localStorage.getItem('papilot:model:claude')]), ['codex', 'haiku']);
  failCreate = false;
  await page.getByRole('button', { name: 'Start task' }).click();
  await page.getByRole('heading', { name: task.title }).waitFor();
  assert.equal(creates.length, 2);
  assert.equal(creates[1].agent, 'codex');
  assert.equal(creates[1].model, 'deep-model');
  assert.equal(creates[1].effort, 'xhigh');
  assert.equal(creates[0].id, creates[1].id);
  assert.equal(creates[1].title, 'Shorten the introduction');
  assert.equal(creates[1].instructions, 'Shorten the introduction.\nPreserve the technical content.');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:new-task')), null);
  console.log('PASS: Enter starts a task, Shift+Enter adds a line, retrying creation retains the same task ID, and agent, model and effort are remembered per agent');

  const input = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await input.fill('Keep this unsent draft.');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Send instructions', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(await input.inputValue(), 'Keep this unsent draft.');
  assert.match(messages[0].text, /Address the comments/);
  holdMessage = new Promise(resolve => { releaseMessage = resolve; });
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await page.getByText('Sending…', { exact: true }).waitFor();
  await input.fill('New text typed during submission.');
  releaseMessage();
  holdMessage = null;
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  assert.notEqual(messages[0].requestKey, messages[1].requestKey);
  await page.reload();
  // The deliberate stale selection injected on every load returns to the welcome view.
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Feedback and in-flight submission preserve drafts, including after reload');
  const secondTask = { ...task, id: 'fixture-task-0002', name: 'p-second', title: 'Check the notation', review: null };
  snapshot.tasks.push(secondTask);
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor();
  const activeBeforeMenu = await page.locator('.task-link.active').innerText();
  const otherMenu = page.getByRole('button', { name: `Task actions for ${secondTask.title}`, exact: true });
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete task?' }).waitFor();
  assert.equal(await page.locator('.delete-task-name').innerText(), secondTask.title);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await otherMenu.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  console.log('PASS: Task menus preserve selection and bind confirmation to the originating task');
  secondTask.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Pause task', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: 'Pause task', exact: true }).click();
  assert.deepEqual(interruptions, [secondTask.id]);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  secondTask.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  let renameBox = page.getByRole('textbox', { name: `Rename ${secondTask.title}` });
  assert.equal(await renameBox.evaluate(el => el === document.activeElement), true);
  await renameBox.fill('Something else');
  await renameBox.press('Escape');
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor();
  assert.equal(renames.length, 0);
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  renameBox = page.getByRole('textbox', { name: `Rename ${secondTask.title}` });
  await renameBox.fill('Check the notation and symbols');
  await renameBox.press('Enter');
  await page.getByRole('button', { name: /^Check the notation and symbols/ }).waitFor();
  assert.deepEqual(renames, [{ id: secondTask.id, title: 'Check the notation and symbols' }]);
  assert.equal(await page.getByRole('button', { name: /^Check the notation and symbols/ }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  console.log('PASS: Tasks rename inline from their menu; Escape cancels and Enter saves without changing the selection');


  await input.fill('Only send this once.');
  holdMessage = new Promise(resolve => { releaseMessage = resolve; });
  const beforeNavigationSend = messages.length;
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await page.getByText('Sending…', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isDisabled(), true);
  await input.press('Control+Enter');
  await input.fill('New text typed during submission.');
  releaseMessage(); holdMessage = null;
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(messages.length, beforeNavigationSend + 1);
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Task navigation retains pending sends and cannot duplicate a message');
  const beforeEnterSend = messages.length;
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  assert.equal(messages.length, beforeEnterSend + 1);
  assert.equal(messages.at(-1).text, 'First line\nSecond line');
  await input.fill('New text typed during submission.');
  console.log('PASS: Enter sends follow-up instructions and Shift+Enter keeps a new line');

  heldState = new Promise(resolve => { releaseState = resolve; });
  const stateCaptured = new Promise(resolve => { stateStarted = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await stateCaptured;
  createResult = { ...secondTask, id: 'fixture-task-0003', title: 'A newly created task' };
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await prompt.fill(createResult.title + '\nKeep this new task selected.');
  await page.getByRole('button', { name: 'Start task' }).click();
  await page.getByRole('heading', { name: createResult.title }).waitFor();
  releaseState();
  assert.equal(await page.locator('.task-link.active').innerText().then(text => text.includes(createResult.title)), true);
  createResult = task;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  console.log('PASS: A stale pre-creation snapshot cannot erase the new task selection');

  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/english-desktop.png', fullPage: true });

  snapshot.requests = [{ id: 'question', taskId: task.id, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'scope', question: 'Which section should I revise?', options: [{ label: 'Introduction', description: 'Revise only the introduction.' }] }] }, createdAt: 1 }];
  task.status = 'waiting_input';
  await page.reload();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('heading', { name: 'Codex needs your input' }).waitFor();
  assert.equal(await page.title(), `(1) ${task.title} · Papilot`);
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isDisabled(), true);
  await page.getByRole('button', { name: /Introduction/ }).click({ timeout: 3000 });
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isEnabled(), true);
  console.log('PASS: Codex reply requires an answer and shows an accessible pending-input indicator');
  await page.getByRole('textbox', { name: 'Which section should I revise?' }).fill('Keep the theorem statement.');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Which section should I revise?' }).inputValue(), 'Keep the theorem statement.');
  console.log('PASS: Unsent answers survive switching tasks');


  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    if (width < 681) await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).click();
    await input.waitFor();
    assert.equal(await input.inputValue(), 'New text typed during submission.');
    const overflow = await page.evaluate(() => {
      const containers = ['.app-shell', '.topbar', '.view-selector', '.review-tools', '.composer-wrap'];
      return containers.filter(selector => { const el = document.querySelector(selector); return el && el.clientWidth && el.scrollWidth > el.clientWidth + 1; });
    });
    assert.deepEqual(overflow, [], `overflow at ${width}px`);
    const send = await page.getByRole('button', { name: 'Send instructions', exact: true }).boundingBox();
    assert.ok(send.x >= 0 && send.x + send.width <= width);
    if (width < 681) {
      await page.getByRole('button', { name: /Review/ }).first().click();
      await page.getByRole('combobox', { name: 'PDF reading zoom' }).selectOption('2');
      assert.equal(await page.locator('.review-frame').evaluate(el => el.contentDocument.documentElement.style.getPropertyValue('--pdf-reading-scale')), '2');
      await page.screenshot({ path: `test-results/english-mobile-${width}.png`, fullPage: true });
    }
    const drawerToggle = page.getByRole('button', { name: 'Show task list', exact: true });
    await drawerToggle.click();
    const drawer = page.getByRole('dialog', { name: 'Papers and tasks' });
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
    assert.equal(await page.locator('.main').evaluate(el => el.inert), true);
    const lastTaskMenu = drawer.getByRole('button', { name: /^Task actions for / }).last();
    await lastTaskMenu.click();
    await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement) && document.hasFocus()), true);
    await lastTaskMenu.click();
    await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement) && document.hasFocus()), true);

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await drawerToggle.evaluate(el => el === document.activeElement), true);
    await drawerToggle.click();
    await drawer.getByRole('button', { name: 'Paper: Example paper', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add paper…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add a paper' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Repository path' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    if (width === 390) {
      await page.getByRole('button', { name: /^PDF/ }).click();
      const pdfPage = page.locator('.pdfViewer .page').first();
      await page.locator('.textLayer span').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const toolbar = page.getByRole('toolbar', { name: 'PDF controls' });
      assert.equal(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await toolbar.getByRole('button', { name: 'Contents', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^Results/ }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
      await page.getByRole('button', { name: 'Git, 2 changed' }).click();
      await page.getByRole('region', { name: 'Git status' }).getByText('main.tex', { exact: true }).waitFor();
      assert.equal(await pdfPage.isVisible(), false);
      await page.getByRole('button', { name: 'PDF', exact: true }).click();
      await pdfPage.waitFor();
      await drawerToggle.click();
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await page.locator('.sidebar').waitFor({ state: 'hidden' });
      await prompt.fill('A task from the drawer\nKeep the mobile conversation visible.');
      await page.getByRole('button', { name: 'Start task' }).click();
      await input.waitFor();
      assert.equal(await page.locator('.sidebar').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).getAttribute('aria-pressed'), 'true');
    } else await page.getByRole('button', { name: 'Hide task list', exact: true }).first().click();
  }
  console.log('PASS: 320px, 390px, and tablet layouts; draft persistence; zoom; drawer; project dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Review/ }).first().click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await input.waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  await openDelete();
  await page.getByRole('dialog', { name: 'Delete task?' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: `Task actions for ${task.title}`, exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  console.log('PASS: Mobile review feedback opens the conversation without clearing drafts; task menu dialogs restore drawer focus');

  await page.setViewportSize({ width: 1440, height: 900 });
  snapshot.requests = []; task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('.task-identity .status').filter({ hasText: 'Ready for review' }).waitFor();
  await input.fill('Keep this draft through connection recovery.');
  await page.getByRole('button', { name: 'Hide task list', exact: true }).first().click();
  stateFailure = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Connection lost. Showing the last update; your draft is kept.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry connection' }).isVisible(), true);
  assert.equal(await input.inputValue(), 'Keep this draft through connection recovery.');
  stateFailure = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await page.locator('.connection-banner').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  console.log('PASS: Connection loss stays visible with the sidebar collapsed, and recovery preserves drafts');

  itemsFailure = true;
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor();
  itemsFailure = false;
  await page.getByRole('button', { name: 'Retry conversation' }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor({ state: 'hidden' });
  reviewFailure = true;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByText('The PDF review could not be loaded.', { exact: true }).waitFor();
  reviewFailure = false;
  await page.getByRole('button', { name: 'Reload review', exact: true }).click();
  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.review-viewport').getAttribute('aria-busy'), 'false');
  assert.equal(await input.inputValue(), 'Keep this draft through connection recovery.');
  console.log('PASS: Failed conversation and iframe loads recover in place without losing the draft');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  reviewStarting = true;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.frameLocator('.review-frame').locator('#root').waitFor({ state: 'attached' });
  await page.clock.fastForward(16000);
  await page.getByText('The PDF review is taking longer than expected.', { exact: true }).waitFor();
  await page.locator('.review-frame').evaluate(frame => { frame.contentDocument.querySelector('#root').innerHTML = '<main id="paper"><p>The delayed review is ready.</p></main>'; });
  await page.frameLocator('.review-frame').getByText('The delayed review is ready.', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Reload review', exact: true }).waitFor({ state: 'hidden' });
  reviewStarting = false;
  console.log('PASS: A slow review becomes visible when it finishes without requiring a reload');


  // A task made from PDF notes shows the notes, and the agent's work folds into one line.
  const notesPrompt = 'Revise the manuscript according to these notes the author marked on the compiled PDF. SyncTeX mapped each marked region to the LaTeX file and lines that produced it; the PDF text is what the author saw. Read the current source before editing, and change only what the notes ask for.\n\n1. Page 1 · main.tex line 10\n   LaTeX source of the marked region:\n   ```latex\n   \\title{Small Steps}\n   ```\n   PDF text: "Small Steps, Clearer Papers"\n   Note: Make the title plainer.';
  history = [
    { id: 'notes', taskId: task.id, type: 'user', text: notesPrompt, createdAt: 1 },
    { id: 'cmd-1', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'cat main.tex'", detail: '\\title{Small Steps}', status: 'completed', createdAt: 2 },
    { id: 'cmd-2', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'git status --short'", status: 'completed', createdAt: 3 },
    { id: 'edit', taskId: task.id, type: 'files', text: `${task.worktree}/main.tex`, status: 'completed', createdAt: 4 },
    { id: 'done', taskId: task.id, type: 'assistant', text: 'Changed the title.', createdAt: 5 },
    { id: 'cmd-3', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'latexmk -pdf main.tex'", status: 'inProgress', createdAt: 6 },
  ];
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const sentNotes = page.locator('.notes-message');
  await sentNotes.waitFor();
  assert.equal(await sentNotes.locator('.sent-notes-head').innerText(), 'Note on the PDF');
  assert.equal(await sentNotes.locator('.sent-note-where').innerText(), 'Page 1 · main.tex line 10');
  assert.equal(await sentNotes.locator('blockquote').innerText(), 'Small Steps, Clearer Papers');
  assert.equal(await sentNotes.locator('p').innerText(), 'Make the title plainer.');
  assert.doesNotMatch(await page.locator('.thread').innerText(), /SyncTeX|```/);
  const work = page.locator('.tool-group');
  assert.equal(await work.count(), 1);
  assert.equal(await page.locator('.tool-group > summary').innerText(), 'Ran 2 commands, edited main.tex');
  assert.equal(await work.locator('.tool-item').first().isVisible(), false);
  await page.locator('.tool-group > summary').click();
  assert.deepEqual(await work.locator('.tool-label').allInnerTexts(), ['cat main.tex', 'git status --short', 'Edited main.tex']);
  assert.equal(await page.locator('.thread > .tool-item .tool-label').innerText(), 'latexmk -pdf main.tex');
  console.log('PASS: Notes sent from the PDF read as notes, and consecutive commands fold into one line with task paths');

  history = Array.from({ length: 120 }, (_, i) => ({ id: `history-${i}`, taskId: task.id, type: 'assistant', text: `Message ${i}: A detailed review of the argument.`, createdAt: i + 1 }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Message 119: A detailed review of the argument.', { exact: true }).waitFor();
  const scroller = page.locator('.messages');
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Latest messages' }).waitFor();
  history.push({ ...history[0], id: 'history-new', text: 'A new message while reading history.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('A new message while reading history.', { exact: true }).waitFor();
  assert.equal(await scroller.evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: 'Latest messages' }).click();
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  history = null;
  task.status = 'failed'; task.error = 'A build failed in the test fixture.'; task.review.job = { status: 'failed' };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry build', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Chat', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByText(task.error, { exact: true }).waitFor();
  task.error = null; task.review.job = null;
  await views.getByRole('button', { name: 'Split', exact: true }).click();
  console.log('PASS: Long conversations follow new messages, preserve history reading position, and offer a jump back');

  task.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const pauseButton = page.locator('.composer').getByRole('button', { name: 'Pause task' });
  await pauseButton.waitFor();
  assert.equal(await page.locator('.topbar').getByRole('button', { name: 'Pause task' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isEnabled(), true);
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  await page.locator('.topbar').getByRole('button', { name: 'Pause task' }).waitFor();
  await views.getByRole('button', { name: 'Split', exact: true }).click();
  await pauseButton.click();
  assert.equal(interruptions.at(-1), task.id);
  task.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await pauseButton.waitFor();
  console.log('PASS: Pause sits in the composer while Codex works and moves to the header when the chat is hidden');
  await openDelete();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete task?' });
  await deleteDialog.waitFor();
  assert.equal(await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await deleteDialog.getByRole('button', { name: 'Delete task', exact: true }).isDisabled(), true);
  await page.getByText('Pause this task before deleting it.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(deletions.length, 0);
  task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('.task-identity .status').filter({ hasText: 'Ready for review' }).waitFor();
  await openDelete();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(deletions.length, 0);
  await openDelete();
  deleteFailure = true;
  await deleteDialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  await deleteDialog.getByRole('alert').waitFor();
  await deleteDialog.getByRole('button', { name: 'Retry deletion', exact: true }).waitFor();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  deleteFailure = false;
  await deleteDialog.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await deleteDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Clarify the introduction/ }).waitFor({ state: 'hidden' });
  assert.deepEqual(deletions, [{ id: task.id, body: { confirm: true } }, { id: task.id, body: { confirm: true } }]);
  assert.equal(await page.getByRole('button', { name: /^Check the notation/ }).count(), 1);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft:' + id), task.id), null);
  console.log('PASS: Task deletion defaults to Cancel, blocks active tasks, retries uncertain cleanup, and removes only the confirmed task');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await input.fill('A draft on a task removed elsewhere.');
  await openDelete(secondTask.title);
  await deleteDialog.waitFor();
  snapshot.tasks = snapshot.tasks.filter(t => t.id !== secondTask.id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await deleteDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor({ state: 'hidden' });
  assert.equal(deletions.length, 2);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft:' + id), secondTask.id), null);
  console.log('PASS: Deletion in another tab closes a stale confirmation and clears only that task’s local draft');

  const restricted = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } }));
  const restrictedPage = await restricted.newPage();
  const restrictedErrors = [];
  restrictedPage.on('pageerror', error => restrictedErrors.push(error.message));
  await restrictedPage.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/api/state') ? { ...snapshot, tasks: [secondTask], requests: [] } : { items: [] } }));
  await restrictedPage.goto(origin);
  const restrictedInput = restrictedPage.getByRole('textbox', { name: 'Instructions for Codex' });
  await restrictedInput.fill('A usable draft with storage disabled.');
  assert.equal(await restrictedInput.inputValue(), 'A usable draft with storage disabled.');
  assert.deepEqual(restrictedErrors, []);
  await restricted.close();
  console.log('PASS: Blocked browser storage does not prevent loading or editing');
  assert.deepEqual(pageErrors, []);
  console.log('PASS: No uncaught browser errors');
} finally {
  await browser.close();
  await server.close();
}
