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
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: task.projectId, name: 'Example paper', path: '/tmp/fixture', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, account: null, error: null, models: [] } };
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

try {
  await page.goto(origin);
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Example paper' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.doesNotMatch(await page.locator('body').innerText(), /\p{Script=Han}/u);

  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Codex task' });
  await dialog.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Task title' }).evaluate(el => el === document.activeElement), true);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press(i < 5 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'New task', exact: true }).evaluate(el => el === document.activeElement), true);
  console.log('PASS: English UI, stale selection recovery, modal focus containment, Escape, and focus restoration');

  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Shorten the introduction');
  await page.getByRole('textbox', { name: 'What should Codex do?' }).fill('Preserve the technical content.');
  await page.getByRole('button', { name: 'Create and start Codex' }).click();
  await dialog.getByRole('alert').waitFor();
  failCreate = false;
  await page.getByRole('button', { name: 'Create and start Codex' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(creates.length, 2);
  assert.equal(creates[0].id, creates[1].id);
  console.log('PASS: Retrying task creation retains the same task ID');

  const input = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await input.fill('Keep this unsent draft.');
  await page.getByRole('button', { name: /1 saved comment.*Send to Codex/ }).click();
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
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Feedback and in-flight submission preserve drafts, including after reload');
  const secondTask = { ...task, id: 'fixture-task-0002', name: 'p-second', title: 'Check the notation', review: null };
  snapshot.tasks.push(secondTask);
  await page.getByRole('button', { name: /Check the notation/ }).waitFor();
  await input.fill('Only send this once.');
  holdMessage = new Promise(resolve => { releaseMessage = resolve; });
  const beforeNavigationSend = messages.length;
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await page.getByText('Sending…', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Check the notation/ }).click();
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isDisabled(), true);
  await input.press('Control+Enter');
  await input.fill('New text typed during submission.');
  releaseMessage(); holdMessage = null;
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(messages.length, beforeNavigationSend + 1);
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Task navigation retains pending sends and cannot duplicate a message');

  heldState = new Promise(resolve => { releaseState = resolve; });
  const stateCaptured = new Promise(resolve => { stateStarted = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await stateCaptured;
  createResult = { ...secondTask, id: 'fixture-task-0003', title: 'A newly created task' };
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill(createResult.title);
  await page.getByRole('textbox', { name: 'What should Codex do?' }).fill('Keep this new task selected.');
  await page.getByRole('button', { name: 'Create and start Codex' }).click();
  await page.getByRole('heading', { name: createResult.title }).waitFor();
  releaseState();
  assert.equal(await page.locator('.task-link.active').innerText().then(text => text.includes(createResult.title)), true);
  createResult = task;
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  console.log('PASS: A stale pre-creation snapshot cannot erase the new task selection');

  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/english-desktop.png', fullPage: true });

  snapshot.requests = [{ id: 'question', taskId: task.id, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'scope', question: 'Which section should I revise?', options: [{ label: 'Introduction', description: 'Revise only the introduction.' }] }] }, createdAt: 1 }];
  task.status = 'waiting_input';
  await page.reload();
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  await page.getByRole('heading', { name: 'Codex needs your input' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isDisabled(), true);
  await page.getByRole('button', { name: /Introduction/ }).click({ timeout: 3000 });
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isEnabled(), true);
  console.log('PASS: Codex reply requires an answer and shows an accessible pending-input indicator');
  await page.getByRole('textbox', { name: 'Which section should I revise?' }).fill('Keep the theorem statement.');
  await page.getByRole('button', { name: /Check the notation/ }).click();
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Which section should I revise?' }).inputValue(), 'Keep the theorem statement.');
  console.log('PASS: Unsent answers survive switching tasks');


  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    if (width < 681) await page.getByRole('button', { name: 'Conversation (reply needed)', exact: true }).click();
    await input.waitFor();
    assert.equal(await input.inputValue(), 'New text typed during submission.');
    const overflow = await page.evaluate(() => {
      const containers = ['.app-shell', '.topbar', '.mobile-tabs', '.composer-wrap'];
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
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await drawerToggle.evaluate(el => el === document.activeElement), true);
    await drawerToggle.click();
    await page.getByRole('button', { name: 'Add paper', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add a paper project' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Paper name (optional)' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    if (width === 390) {
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await page.getByRole('textbox', { name: 'Task title' }).fill('A task from the drawer');
      await page.getByRole('textbox', { name: 'What should Codex do?' }).fill('Keep the mobile conversation visible.');
      await page.getByRole('button', { name: 'Create and start Codex' }).click();
      await page.getByRole('dialog', { name: 'New Codex task' }).waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.sidebar').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Conversation (reply needed)', exact: true }).getAttribute('aria-pressed'), 'true');
    } else await page.getByRole('button', { name: 'Hide task list', exact: true }).first().click();
  }
  console.log('PASS: 320px, 390px, and tablet layouts; draft persistence; zoom; drawer; project dialog');
  await page.setViewportSize({ width: 1440, height: 900 });
  snapshot.requests = []; task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Build review', exact: true }).waitFor();
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
  await page.getByRole('button', { name: /Check the notation/ }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor();
  itemsFailure = false;
  await page.getByRole('button', { name: 'Retry conversation' }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor({ state: 'hidden' });
  reviewFailure = true;
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  await page.getByText('The PDF review could not be loaded.', { exact: true }).waitFor();
  reviewFailure = false;
  await page.getByRole('button', { name: 'Reload review', exact: true }).click();
  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.review-viewport').getAttribute('aria-busy'), 'false');
  assert.equal(await input.inputValue(), 'Keep this draft through connection recovery.');
  console.log('PASS: Failed conversation and iframe loads recover in place without losing the draft');
  await page.getByRole('button', { name: /Check the notation/ }).click();
  reviewStarting = true;
  await page.getByRole('button', { name: /Clarify the introduction/ }).click();
  await page.frameLocator('.review-frame').locator('#root').waitFor({ state: 'attached' });
  await page.clock.fastForward(16000);
  await page.getByText('The PDF review is taking longer than expected.', { exact: true }).waitFor();
  await page.locator('.review-frame').evaluate(frame => { frame.contentDocument.querySelector('#root').innerHTML = '<main id="paper"><p>The delayed review is ready.</p></main>'; });
  await page.frameLocator('.review-frame').getByText('The delayed review is ready.', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Reload review', exact: true }).waitFor({ state: 'hidden' });
  reviewStarting = false;
  console.log('PASS: A slow review becomes visible when it finishes without requiring a reload');


  history = Array.from({ length: 120 }, (_, i) => ({ id: `history-${i}`, taskId: task.id, type: 'assistant', text: `Message ${i}: A detailed review of the argument.`, createdAt: i + 1 }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Message 119: A detailed review of the argument.', { exact: true }).waitFor();
  const scroller = page.locator('.messages');
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Latest messages ↓' }).waitFor();
  history.push({ ...history[0], id: 'history-new', text: 'A new message while reading history.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('A new message while reading history.', { exact: true }).waitFor();
  assert.equal(await scroller.evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: 'Latest messages ↓' }).click();
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  history = null;
  console.log('PASS: Long conversations follow new messages, preserve history reading position, and offer a jump back');

  task.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Pause task' }).waitFor();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete task?' });
  await deleteDialog.waitFor();
  assert.equal(await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await deleteDialog.getByRole('button', { name: 'Delete task', exact: true }).isDisabled(), true);
  await page.getByText('Pause this task before deleting it.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(deletions.length, 0);
  task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Build review', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(deletions.length, 0);
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
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
  await page.getByRole('button', { name: /Clarify the introduction/ }).waitFor({ state: 'hidden' });
  assert.deepEqual(deletions, [{ id: task.id, body: { confirm: true } }, { id: task.id, body: { confirm: true } }]);
  assert.equal(await page.getByRole('button', { name: /Check the notation/ }).count(), 1);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft:' + id), task.id), null);
  console.log('PASS: Task deletion defaults to Cancel, blocks active tasks, retries uncertain cleanup, and removes only the confirmed task');
  await page.getByRole('button', { name: /Check the notation/ }).click();
  await input.fill('A draft on a task removed elsewhere.');
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await deleteDialog.waitFor();
  snapshot.tasks = snapshot.tasks.filter(t => t.id !== secondTask.id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await deleteDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Check the notation/ }).waitFor({ state: 'hidden' });
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
