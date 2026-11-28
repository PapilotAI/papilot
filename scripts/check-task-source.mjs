// A change's source, edited in the workspace's editor beside a task's review:
// the real review engine and Papilot routes with a real LaTeX paper; only the
// agent is replaced. All files and servers belong to this disposable fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium, expect } from '../engine/node_modules/@playwright/test/index.mjs';
import { Fixture, METHOD } from '../engine/tests/ts/helpers.ts';
import { createServer } from '../engine/src/server.ts';

const f = new Fixture();
process.env.PAPILOT_DATA = path.join(f.base, 'data');
const [{ Store }, { Workspace }, { Manuscripts }, { buildApp, gitQueue }, { AGENT_IDS }] = await Promise.all([
  import('../src/server/store.ts'), import('../src/server/workspace.ts'), import('../src/server/manuscript.ts'),
  import('../src/server/app.ts'), import('../src/shared.ts'),
]);
f.write('paper/main.tex', '\\documentclass{article}\n\\begin{document}\n\\input{sections/method}\n\\end{document}\n');
const BEFORE = '\\section{First}\nOriginal first paragraph.\n\\newpage\n\\section{Second}\nOriginal second paragraph.\n\\newpage\n\\section{Third}\nOriginal third paragraph.\n';
f.write(METHOD, BEFORE);
f.repo.run(['add', '-A']); f.repo.run(['commit', '-qm', 'Three pages']);
const app = f.app(); await app.ready;
const task = app.tasks.create('sources', 'Edit three pages', [], ['paper'], true);
f.edit(task, METHOD, 'Original first', 'Proposed first');
f.edit(task, METHOD, 'Original second', 'Proposed second');
f.edit(task, METHOD, 'Original third', 'Proposed third');
app.publisher.submit(task.name); await app.publisher.join();
assert.equal(app.review.latestRound(task.name)?.visuals, 'ready');
const engine = createServer(app);
await engine.listen({ host: '127.0.0.1', port: 0 });
app.url = `http://127.0.0.1:${engine.server.address().port}`;
const call = async (route, body) => {
  const response = await fetch(app.url + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': app.csrf }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
};
const client = { url: app.url, token: app.csrf, get: route => call(route), post: (route, body = {}) => call(route, body) };
const clients = new Map([[f.root, client]]);
const connectReview = async root => clients.get(root) ?? client;
class Agent extends EventEmitter { ready = false; close() {} }
const store = new Store(':memory:');
const workspace = new Workspace(store, new Agent(), connectReview, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new Agent()])));
store.saveProject({ id: 'paper', path: f.root, name: 'Paper', createdAt: 1 });
store.saveTask({ id: 'sources', projectId: 'paper', name: task.name, title: task.title, instructions: '', worktree: task.worktree, threadId: null, turnId: null, model: null, status: 'reviewing', deferred: true, createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });
await workspace.refresh('sources');
const manuscripts = new Manuscripts();
manuscripts.predict = async () => {};
const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
const server = await buildApp({ listener, store, workspace, manuscripts, csrf: 'fixture', serialGit: gitQueue(), dist: path.resolve('dist'), version: 'test', connectReview });
await server.listen({ host: '127.0.0.1', port: 0 });
listener.port = server.server.address().port;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
const worktree = () => fs.readFileSync(path.join(task.worktree, METHOD), 'utf8');
try {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('papilot:task')) localStorage.setItem('papilot:task', 'sources');
    if (!localStorage.getItem('papilot:project')) localStorage.setItem('papilot:project', 'paper');
    localStorage.setItem('papilot:language', 'en');
  });
  await page.goto(`http://127.0.0.1:${listener.port}`);
  const viewer = page.frameLocator('.review-frame'), side = page.locator('#conversation-panel');
  await expect(viewer.locator('.change.current')).toBeVisible({ timeout: 60000 });

  // The chat docks like the manuscript's panel (check-panel-docking.mjs):
  // on the left, beside the review, or floating over it with the review
  // still usable around it.
  const grid = page.locator('.task-grid'), review = page.locator('#review-panel');
  const position = side.getByRole('button', { name: 'Panel position' });
  const rect = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON());
  await position.click(); await page.getByRole('menuitemradio', { name: 'Dock on the left' }).click();
  await expect(grid).toHaveAttribute('data-dock', 'left');
  assert.ok((await rect(side)).right <= (await rect(review)).left + 1, 'the chat is left of the review');
  await page.screenshot({ path: 'test-results/task-dock-left.png' });
  await position.click(); await page.getByRole('menuitemradio', { name: 'Float over the page' }).click();
  await expect(grid).toHaveAttribute('data-dock', 'float');
  assert.equal(Math.round((await rect(review)).width), Math.round((await rect(grid)).width), 'the review takes the whole width');
  await expect(viewer.locator('.change.current')).toBeVisible();
  await page.screenshot({ path: 'test-results/task-dock-float.png' });
  // Its header's empty space moves it.
  const heading = await rect(side.locator('.panel-heading')), before = await rect(side), button = await rect(position);
  await page.mouse.move(button.x - 40, heading.y + heading.height / 2); await page.mouse.down();
  await page.mouse.move(button.x - 240, heading.y + heading.height / 2 + 100, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => { const after = await rect(side); return [Math.round(after.x - before.x), Math.round(after.y - before.y)]; }).toEqual([-200, 100]);
  // Its own window: the review takes the whole width and its toolbar brings
  // the chat forward; closing the window docks the chat where it was.
  const [chatWindow] = await Promise.all([page.waitForEvent('popup'), position.click().then(() => page.getByRole('menuitemradio', { name: 'Open in a new window' }).click())]);
  await expect(grid).toHaveAttribute('data-dock', 'window');
  await expect(chatWindow.locator('#conversation-panel .composer textarea')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show chat window' })).toBeVisible();
  await chatWindow.screenshot({ path: 'test-results/task-dock-window.png' });
  await chatWindow.close();
  await expect(grid).toHaveAttribute('data-dock', 'float');
  // Filling the window brings the chat back from its own.
  const [again] = await Promise.all([page.waitForEvent('popup'), position.click().then(() => page.getByRole('menuitemradio', { name: 'Open in a new window' }).click())]);
  await again.locator('#conversation-panel .panel-heading').getByRole('button', { name: /^Panel position/ }).click();
  await again.getByRole('menuitemradio', { name: 'Fill the window' }).click();
  await expect.poll(() => again.isClosed()).toBe(true);
  await expect(grid).toHaveClass(/layout-conversation/);
  await expect(side.locator('.composer textarea')).toBeVisible();
  await position.click(); await page.getByRole('menuitemradio', { name: 'Float over the page' }).click();
  await expect(grid).toHaveClass(/layout-split/);
  await position.click(); await page.getByRole('menuitem', { name: 'Reset panel layout' }).click();
  await expect(grid).toHaveAttribute('data-dock', 'right');

  // The chat hides and comes back from its own toggle, and fills the window
  // from its menu.
  await side.getByRole('button', { name: 'Hide chat' }).click();
  await expect(grid).toHaveClass(/layout-review/);
  await expect(side).toBeHidden();
  const showChat = page.getByRole('button', { name: 'Show chat', exact: true });
  await expect(showChat).toBeFocused();
  await page.waitForFunction(() => !document.documentElement.classList.contains('switching-workspace'));
  await page.screenshot({ path: 'test-results/task-chat-hidden.png' });
  await showChat.click();
  await expect(grid).toHaveClass(/layout-split/);
  await expect(side.getByRole('button', { name: 'Hide chat' })).toBeFocused();
  await position.click(); await page.getByRole('menuitemradio', { name: 'Fill the window' }).click();
  await expect(grid).toHaveClass(/layout-conversation/);
  await expect(position).toHaveAccessibleName(/Filling the window/);
  await position.click(); await page.getByRole('menuitemradio', { name: 'Dock on the right' }).click();
  await expect(grid).toHaveClass(/layout-split/);

  // LaTeX on a change opens its file beside the chat, at the change, not in the card.
  await viewer.locator('.change.current .source-toggle').click();
  const tab = side.getByRole('tab', { name: 'method.tex' }), chat = side.getByRole('tab', { name: 'Chat' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toHaveAttribute('title', METHOD);
  await expect(viewer.locator('.change.current .source'), 'the card shows no source of its own').toHaveCount(0);
  const editor = side.locator('.cm-editor'), field = side.locator('.cm-content');
  await expect(editor).toBeVisible();
  await expect(side.locator('.composer-wrap'), 'the editor takes the chat\'s place').toBeHidden();
  const text = () => field.evaluate(content => [...content.querySelectorAll('.cm-line')].map(line => line.textContent.replace(/\u200b/g, '')).join('\n'));
  await expect(field).toBeFocused();

  // The round's changes show in the text as the review's cards: a header
  // with the card's title and actions, the line as it was, the line now.
  const cards = side.locator('.cm-review-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.cm-review-title')).toHaveText(['Change 1', 'Change 2', 'Change 3']);
  await expect(cards.first().locator('.cm-review-before')).toHaveText('Original first paragraph.');
  await expect(cards.first().locator('.cm-review-before')).toHaveAttribute('data-label', 'Before');
  await expect(side.locator('.cm-review-removed')).toHaveText(['Original', 'Original', 'Original']);
  await expect(side.locator('.cm-line.cm-review-after')).toHaveCount(3);
  await expect(side.locator('.cm-line.cm-review-after').first()).toHaveAttribute('data-label', 'After');
  await expect(side.locator('.cm-review-added')).toHaveText(['Proposed', 'Proposed', 'Proposed']);
  await expect(cards.first().locator('.cm-review-buttons button')).toHaveCount(3);
  await expect(side.locator('.cm-change-bar'), 'bars mark what the task changed').toHaveCount(3);
  await page.screenshot({ path: 'test-results/task-source-review.png' });

  // The caret on a change makes it the review's current change.
  await side.locator('.cm-line', { hasText: 'third paragraph' }).click();
  await expect(viewer.locator('.change.current')).toHaveAttribute('data-stop', '2');

  // Accepting in the editor decides the change in the review; its marks go.
  // The editor does so in a window of its own too, where its caret still
  // picks the review's current change; closing the window brings it back.
  const [popup] = await Promise.all([page.waitForEvent('popup'), side.getByRole('button', { name: 'Open in a new window' }).click()]);
  const outCards = popup.locator('.cm-review-card');
  await expect(outCards).toHaveCount(3);
  await outCards.nth(0).locator('.cm-review-accept').click();
  await expect.poll(() => app.review.pageState(task.name).decisions.c001).toBe('accepted');
  await expect(outCards).toHaveCount(2);
  await popup.locator('.cm-line', { hasText: 'first paragraph' }).click();
  await expect(viewer.locator('.change.current')).toHaveAttribute('data-stop', '0');
  await popup.locator('.cm-line', { hasText: 'third paragraph' }).click();
  await expect(viewer.locator('.change.current')).toHaveAttribute('data-stop', '2');
  await popup.screenshot({ path: 'test-results/task-source-popout.png' });
  await popup.close();
  await expect(cards).toHaveCount(2);
  await expect(side.locator('.cm-review-removed')).toHaveCount(2);

  // Rejecting returns the task's text, which the editor then shows.
  await cards.nth(0).locator('.cm-review-reject').click();
  await expect.poll(() => app.review.pageState(task.name).decisions.c002).toBe('rejected');
  await expect.poll(worktree, { timeout: 60000 }).toContain('Original second paragraph.');
  await expect.poll(text, { timeout: 30000 }).toContain('Original second paragraph.');
  await expect(cards, 'the change after it keeps its place and its card').toHaveCount(1);
  await expect(cards.locator('.cm-review-title')).toHaveText('Change 3');
  await expect(side.locator('.cm-review-added')).toHaveText(['Proposed']);
  await expect(side.locator('.cm-line', { hasText: 'third paragraph' }).locator('.cm-review-added')).toHaveText('Proposed');

  // Comment starts a comment on the card, which is written in the chat.
  await cards.locator('.cm-review-comment').click();
  await expect(viewer.locator('.change.current')).toHaveAttribute('data-stop', '2');
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await expect(side.locator('.review-draft')).toBeVisible();
  await expect(side.locator('.review-draft-location'), 'the comment is on the card\'s change').toContainText('Page 3');
  await tab.click();
  await expect.poll(() => app.review.latestRound(task.name)?.visuals, { timeout: 90000 }).toBe('ready');

  // Typing marks the tab; the chat keeps its place, and so does the draft.
  await side.locator('.cm-line', { hasText: 'third paragraph' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed in Papilot.');
  const unsaved = side.locator('.side-tab-close[data-dirty]');
  await expect(unsaved).toHaveAttribute('title', /^Unsaved/);
  await chat.click();
  await expect(side.locator('.composer-wrap')).toBeVisible();
  await expect(editor).toBeHidden();
  await tab.click();
  await expect.poll(text).toContain('Proposed third paragraph. Typed in Papilot.');
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/task-source-edit.png' });

  // ⌘S writes the task's file, without an agent, and reviews it in a new round.
  const round = app.review.latestRound(task.name).number;
  await field.press('ControlOrMeta+s');
  await expect.poll(worktree, { timeout: 60000 }).toContain('Proposed third paragraph. Typed in Papilot.');
  assert.equal(fs.readFileSync(path.join(f.root, METHOD), 'utf8'), BEFORE, 'the manuscript itself is untouched');
  await expect(unsaved, 'a saved file has no dot').toHaveCount(0);
  await expect.poll(() => app.review.latestRound(task.name)?.number, { timeout: 90000 }).toBeGreaterThan(round);
  await expect.poll(() => app.review.latestRound(task.name)?.visuals, { timeout: 90000 }).toBe('ready');
  await expect(viewer.locator('.change').last()).toContainText('Typed in Papilot', { timeout: 60000 });
  await expect(viewer.locator('.change .source'), 'saving in the workspace editor never auto-opens an inline source card').toHaveCount(0);
  await expect(side.locator('.cm-review-added').last(), 'the new round\'s changes show in the text').toContainText('Typed in Papilot', { timeout: 30000 });
  await page.screenshot({ path: 'test-results/task-source-saved.png' });
  await expect(side.locator('.source-panel-error')).toHaveCount(0);

  // Closing the tab returns to the chat.
  await side.locator('.side-tab-close').click();
  await expect(tab).toHaveCount(0);
  await expect(chat).toHaveCount(0);
  await expect(side.locator('.composer-wrap')).toBeVisible();

  // An earlier round keeps its inline LaTeX: the editor shows the files as
  // they are now, with the latest round's changes.
  await viewer.locator('body').evaluate((_el, round) => {
    const url = new URL(location.href);
    url.searchParams.set('round', String(round));
    url.searchParams.set('history', '1');
    location.href = url.toString();
  }, round);
  await expect(viewer.locator('.banner').filter({ hasText: 'Viewing earlier changes.' })).toBeVisible({ timeout: 60000 });
  await expect(viewer.locator('.change.current')).toBeVisible({ timeout: 60000 });
  await viewer.locator('.change.current .source-toggle').click();
  await expect(viewer.locator('.change.current .source'), 'an earlier round shows its LaTeX in the card').toBeVisible();
  await expect(side.getByRole('tab', { name: 'method.tex' }), 'the editor does not open for an earlier round').toHaveCount(0);

  // Identical rendered output and strip-free unmapped changes never auto-open
  // inline source cards; explicit inspection uses the workspace editor, and
  // every pending change remains discoverable and reviewable.
  const quiet = app.tasks.create('quiet', 'Quiet source edits', [], ['paper'], true);
  f.edit(quiet, 'paper/main.tex', '\\documentclass{article}\n', '\\documentclass{article}\n\\newcommand{\\unusedhelper}{helper}\n');
  f.edit(quiet, METHOD, 'Original first paragraph.', 'Original first paragraph.% comment only');
  app.publisher.submit(quiet.name); await app.publisher.join();
  const quietDetail = app.review.roundDetail(quiet.name, 1);
  assert.equal(app.review.latestRound(quiet.name)?.visuals, 'ready');
  assert.ok(quietDetail.units.some(unit => unit.visual === 'identical'), 'real compile produces an identical unit');
  assert.ok(quietDetail.units.some(unit => unit.visual === 'unmapped'), 'real compile produces an unmapped unit');
  store.saveTask({ id: 'quiet', projectId: 'paper', name: quiet.name, title: quiet.title, instructions: '', worktree: quiet.worktree, threadId: null, turnId: null, model: null, status: 'reviewing', deferred: true, createdAt: 2, updatedAt: 2, feedbackCursor: 0, error: null, review: null });
  await workspace.refresh('quiet');

  // Broken-baseline sourceOnly recovery task: baseline cannot compile while
  // the task's fix compiles cleanly.
  const fBroken = new Fixture();
  let engineBroken;
  try {
    fBroken.write('paper/main.tex', '\\documentclass{article}\n\\input{missing-task-source-input}\n\\begin{document}\n\\input{sections/method}\n\\end{document}\n');
    fBroken.write(METHOD, '\\section{Method}\nBaseline text.\n');
    fBroken.repo.run(['add', '-A']); fBroken.repo.run(['commit', '-qm', 'Broken baseline']);
    const appBroken = fBroken.app(); await appBroken.ready;
    const fixTask = appBroken.tasks.create('fix-baseline', 'Repair broken baseline', [], ['paper'], true);
    fBroken.edit(fixTask, 'paper/main.tex', '\\input{missing-task-source-input}\n', '');
    appBroken.publisher.submit(fixTask.name); await appBroken.publisher.join();
    assert.equal(appBroken.review.roundDetail(fixTask.name, 1).sourceOnly, true);
    engineBroken = createServer(appBroken);
    await engineBroken.listen({ host: '127.0.0.1', port: 0 });
    appBroken.url = `http://127.0.0.1:${engineBroken.server.address().port}`;
    const callBroken = async (route, body) => {
      const response = await fetch(appBroken.url + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': appBroken.csrf }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || response.statusText);
      return result;
    };
    const clientBroken = { url: appBroken.url, token: appBroken.csrf, get: route => callBroken(route), post: (route, body = {}) => callBroken(route, body) };
    clients.set(fBroken.root, clientBroken);
    store.saveProject({ id: 'broken-paper', path: fBroken.root, name: 'Broken Paper', createdAt: 2 });
    store.saveTask({ id: 'fix-baseline', projectId: 'broken-paper', name: fixTask.name, title: fixTask.title, instructions: '', worktree: fixTask.worktree, threadId: null, turnId: null, model: null, status: 'reviewing', deferred: true, createdAt: 3, updatedAt: 3, feedbackCursor: 0, error: null, review: null });
    await workspace.refresh('fix-baseline');

    // Open the quiet task in Papilot and verify zero auto inline source cards.
    await page.evaluate(() => { localStorage.setItem('papilot:task', 'quiet'); localStorage.setItem('papilot:project', 'paper'); });
    await page.reload();
    await expect(viewer.locator('.change').first()).toBeVisible({ timeout: 60000 });
    await expect(viewer.locator('.change .source'), 'identical/unmapped edits never auto-open inline source').toHaveCount(0);
    await expect(viewer.locator('.comparison-notice[data-reason="identical"]')).toContainText('No visible change in the PDF.');
    await expect(viewer.locator('.comparison-notice[data-reason="unmapped"]')).toContainText('No PDF preview for this source change.');
    await page.screenshot({ path: 'test-results/task-source-quiet-light.png' });
    // Explicit Show LaTeX source routes to Papilot's workspace editor, not inline source.
    await viewer.locator('.comparison-notice[data-reason="identical"]').getByRole('button', { name: 'Show LaTeX source', exact: true }).click();
    await expect(side.locator('.cm-editor')).toBeVisible();
    await expect(viewer.locator('.change .source'), 'explicit source inspection opens the workspace editor, not an inline card').toHaveCount(0);
    // Dark theme visual check.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(viewer.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/task-source-quiet-dark.png' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(viewer.locator('html')).toHaveAttribute('data-theme', 'light');
    await side.locator('.side-tab-close').click();
    // All pending quiet changes remain reviewable and accept cleanly.
    const quietTotal = Object.keys(app.review.pageState(quiet.name).decisions).length;
    assert.ok(quietTotal >= 2, `expected at least 2 quiet units, got ${quietTotal}`);
    await expect(viewer.getByRole('progressbar', { name: `0 of ${quietTotal} decided`, exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: `Accept all (${quietTotal})`, exact: true }).click();
    await expect.poll(() => Object.values(app.review.pageState(quiet.name).decisions).every(d => d === 'accepted')).toBe(true);

    // Open the broken-baseline sourceOnly task inside Papilot: no auto inline
    // source, clear banner + notice, and Show LaTeX source opens workspace editor.
    await page.evaluate(() => { localStorage.setItem('papilot:task', 'fix-baseline'); localStorage.setItem('papilot:project', 'broken-paper'); });
    await page.reload();
    await expect(viewer.locator('.change').first()).toBeVisible({ timeout: 60000 });
    await expect(viewer.locator('.change .source'), 'sourceOnly round never auto-opens inline source in Papilot').toHaveCount(0);
    await expect(viewer.locator('summary').filter({ hasText: 'No PDF comparison: the text before these changes could not be compiled.' })).toBeVisible();
    await expect(viewer.locator('.banner-with-action').getByRole('button', { name: 'Retry comparison', exact: true })).toBeVisible();
    await expect(viewer.locator('.comparison-notice[data-reason="baseline-failed"]')).toContainText('No PDF comparison because the previous version could not be compiled.');
    await page.screenshot({ path: 'test-results/source-only-papilot-light.png' });
    await viewer.locator('.comparison-notice').getByRole('button', { name: 'Show LaTeX source', exact: true }).click();
    await expect(side.getByRole('tab', { name: 'main.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(viewer.locator('.change .source'), 'sourceOnly explicit source routes to workspace editor').toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(viewer.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/source-only-papilot-dark.png' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(viewer.locator('html')).toHaveAttribute('data-theme', 'light');
    await side.locator('.side-tab-close').click();
    // Hosted Retry comparison on the sourceOnly banner triggers a clean rebuild without error toasts.
    const retryResponse = page.waitForResponse(response => response.url().endsWith('/api/tasks/fix-baseline/publish') && response.request().method() === 'POST');
    await viewer.locator('.banner-with-action').getByRole('button', { name: 'Retry comparison', exact: true }).click();
    assert.equal((await retryResponse).status(), 200);
    await appBroken.publisher.join();
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(viewer.locator('.change .source')).toHaveCount(0);

    // Verify mobile layout in both themes and explicit inline fallback on phone.
    const mobilePage = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobilePage.on('pageerror', error => errors.push(error.message));
    mobilePage.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
    try {
      await mobilePage.addInitScript(() => { localStorage.setItem('papilot:task', 'fix-baseline'); localStorage.setItem('papilot:project', 'broken-paper'); localStorage.setItem('papilot:language', 'en'); });
      await mobilePage.goto(`http://127.0.0.1:${listener.port}`);
      const mobileViewer = mobilePage.frameLocator('.review-frame');
      await expect(mobileViewer.locator('.change').first()).toBeVisible({ timeout: 60000 });
      await expect(mobileViewer.locator('.change .source')).toHaveCount(0);
      assert.ok(await mobileViewer.locator('#paper').evaluate(el => el.scrollWidth - el.clientWidth <= 1), 'no horizontal overflow on mobile light');
      await mobilePage.screenshot({ path: 'test-results/source-only-mobile-light.png' });
      await mobilePage.emulateMedia({ colorScheme: 'dark' });
      await expect(mobilePage.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(mobileViewer.locator('html')).toHaveAttribute('data-theme', 'dark');
      assert.ok(await mobileViewer.locator('#paper').evaluate(el => el.scrollWidth - el.clientWidth <= 1), 'no horizontal overflow on mobile dark');
      await mobilePage.screenshot({ path: 'test-results/source-only-mobile-dark.png' });
      await mobileViewer.locator('.comparison-notice').getByRole('button', { name: 'Show LaTeX source', exact: true }).click();
      await expect(mobileViewer.locator('.change .source'), 'mobile falls back to inline source on explicit request').toBeVisible();
      await mobileViewer.locator('.change.current .dock button.accept').click();
      await expect.poll(() => appBroken.review.pageState(fixTask.name).decisions.c001).toBe('accepted');
    } finally {
      await mobilePage.close();
    }
  } finally {
    // Stop the desktop review's polling before disposing its fixture server.
    await page.close();
    await engineBroken?.close();
    await fBroken.close();
  }

  assert.deepEqual(errors, []);
  console.log('PASS: LaTeX on a change opens its whole file in the editor beside the chat, which shows the round\'s changes as the review\'s cards (title, Accept, Reject and Comment over the lines before and after) acting through the review; rejected text comes back and the rest stay placed; the caret and the review follow each other; ⌘S saves into the task and reviews it in a new round; identical, unmapped and baseline-failed changes never auto-open inline source cards; the chat stays as it was');
} finally {
  await browser.close();
  await server.close(); await engine.close(); workspace.close(); store.close();
  await f.close();
}
