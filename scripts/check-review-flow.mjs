import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';
import { annotateReviewState, rewriteReviewHtml } from '../src/server/review.ts';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const prefix = '/review/paper';
const task = { id: 'review-flow-fixture', projectId: 'paper', name: 'flow', title: 'Review the new wording', status: 'reviewing', createdAt: 1, updatedAt: 1, review: { state: 'reviewing', round: 1, counts: {}, unsent: 0 } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
let latest = 1, serial = 0, undo = null;
const rounds = { 1: { first: 'pending', second: 'pending', third: 'pending', fourth: 'pending' } };
const actions = [], writes = [], messageRequests = [], commitRequests = [], applyRequests = [];
let gitFiles = [];
const state = round => ({ task: 'flow', title: task.title, csrf: 'fixture', closed: false, state: task.review.state, latest, history: Object.keys(rounds).map(number => ({ number: Number(number), created: 1793322000 + Number(number) * 120 })), round, revision: `after-${round}`, decisions: rounds[round], comments: {}, undo, job: null });
function update() {
  const values = Object.values(rounds[latest]);
  task.review.counts = Object.fromEntries(['pending', 'accepted', 'rejected', 'commented'].map(value => [value, values.filter(v => v === value).length]));
  task.review.state = values.includes('pending') ? 'reviewing' : values.includes('commented') ? 'revise' : 'done';
}
update();
const image = (name, label) => ({ src: `${name}.svg`, clean: `${name}-clean.svg`, width: 600, height: 130, page: 0, label: '1', text: [{ chars: [{ text: label, rect: [60, 40, 500, 62] }] }] });
function detail(round) {
  const ids = Object.keys(rounds[round]);
  const groups = round === 1 ? [['first'], ['second'], ['third', 'fourth']] : [['new']];
  return { task: 'flow', round, before: `before-${round}`, after: `after-${round}`, warnings: [], files: `${prefix}/files/flow/${round}/`,
    sections: [{ node: 'intro', title: 'Introduction', number: '1', blocks: groups.map((units, i) => ({ kind: 'change', units, identical: false, before: [image(`before-${i}`, `Original paragraph ${i + 1}.`)], after: [image(`after-${i}`, `Revised paragraph ${i + 1}.`)] })) }], loose: [],
    units: ids.map((id, i) => ({ id, file: 'main.tex', status: 'modified', kind: 'text', whole_file: false, ops: [], old_start: i + 1, old_end: i + 1, new_start: i + 1, new_end: i + 1, old_text: `Original paragraph ${i + 1}`, new_text: `Revised paragraph ${i + 1}`, truncated: false })) };
}
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/updates') return route.fulfill({ json: { currentVersion: snapshot.version, latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: true } });
  if (url.pathname === '/api/state') return route.fulfill({ json: snapshot });
  if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
  if (url.pathname === '/api/tasks/question-fixture/items') return route.fulfill({ json: { items: [{ id: 'answer', taskId: 'question-fixture', type: 'assistant', text: 'This equation expresses conservation of mass.', createdAt: 1 }] } });
  if (url.pathname.endsWith('/items')) return route.fulfill({ json: { items: [] } });
  if (url.pathname.endsWith('/git')) return route.fulfill({ json: { branch: 'main', upstream: 'origin/main', remote: true, ahead: 0, behind: 0, head: null, files: gitFiles } });
  if (url.pathname.endsWith('/git/message') || url.pathname.endsWith('/commit-message')) { messageRequests.push(route.request().postDataJSON()); return route.fulfill({ json: { message: 'Explain the method', agent: 'codex' } }); }
  if (url.pathname.endsWith('/apply')) {
    applyRequests.push(route.request().postDataJSON()); task.review.files = [];
    task.delivery = { mode: 'workspace', accepted: 'accepted' };
    return route.fulfill({ json: task.delivery });
  }
  if (url.pathname.endsWith('/commit')) {
    commitRequests.push(route.request().postDataJSON()); gitFiles = []; task.review.files = [];
    if (task.deferred) task.delivery = { mode: 'branch', branch: 'papilot/flow', commit: 'abc1234', accepted: 'accepted' };
    return route.fulfill({ json: { commit: 'abc1234', git: { branch: 'main', upstream: 'origin/main', remote: true, ahead: 0, behind: 0, head: { hash: 'abc1234', subject: 'Explain the method', date: 2 }, files: [] } } });
  }
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/messages')) { task.status = 'running'; task.review.unsent = 0; return route.fulfill({ json: { ok: true } }); }
  throw Error(`Unexpected app request ${url.pathname}`);
});
await page.route('**/review/**', async route => {
  const url = new URL(route.request().url()), relative = url.pathname.slice(prefix.length);
  if (relative === '/') return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(fs.readFileSync('vendor/latex-review/dist/web/index.html', 'utf8'), prefix) });
  if (relative.startsWith('/assets/')) return route.fulfill({ path: path.resolve('vendor/latex-review/dist/web' + relative), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'font/otf' });
  if (relative.startsWith('/files/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 130"><rect width="600" height="130" fill="white"/><text x="60" y="60" font-size="20">A paragraph in the review PDF.</text></svg>' });
  const round = Number(url.searchParams.get('round') || latest);
  if (/\/rounds\/\d+$/.test(relative)) return route.fulfill({ json: detail(Number(relative.split('/').at(-1))) });
  let restored;
  if (route.request().method() === 'POST') {
    const body = route.request().postDataJSON(); writes.push(body);
    if (relative.endsWith('/decide')) {
      actions.push({ decisions: structuredClone(rounds[latest]), undo });
      for (const id of body.changes) rounds[latest][id] = { accept: 'accepted', reject: 'rejected', comment: 'commented' }[body.action];
      undo = { id: `action-${++serial}`, kind: body.action, changes: body.changes };
      task.review.unsent++;
    } else if (relative.endsWith('/undo')) {
      restored = undo.changes;
      const previous = actions.pop(); rounds[latest] = previous.decisions; undo = previous.undo;
    }
    update();
  }
  return route.fulfill({ json: { ...annotateReviewState(state(round), [task]), ...(restored ? { restored } : {}) } });
});
const viewer = () => page.frameLocator('.review-frame');
const sync = async () => page.evaluate(() => window.dispatchEvent(new Event('online')));
try {
  await page.goto(origin);
  await viewer().locator('.change.current').waitFor();
  await expect(viewer().getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeHidden();
  assert.equal(await page.locator('.review-notes-toggle').count(), 0);
  // Shortcut settings update the running review, survive reload, and retain
  // the browser's editing keys. The old key must stop making decisions.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  const acceptKey = shortcuts.getByRole('button', { name: 'Change shortcut: Accept change', exact: true });
  await acceptKey.click(); await acceptKey.press('r');
  await expect(shortcuts.getByRole('alert')).toContainText('Already used for Reject change');
  await acceptKey.press('Meta+w');
  await expect(shortcuts.getByRole('alert')).toContainText('reserved');
  await acceptKey.press('b');
  await expect(acceptKey).toHaveText('B');
  await shortcuts.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viewer().locator('.change.current button.accept')).toHaveAttribute('aria-keyshortcuts', 'b');
  await page.reload();
  await expect(viewer().locator('.change.current button.accept')).toHaveAttribute('aria-keyshortcuts', 'b');
  await viewer().locator('.change.current .change-number').click();
  const beforeKeys = writes.length;
  await page.keyboard.press('a');
  assert.equal(writes.length, beforeKeys);
  await viewer().locator('.pdf-glyph').first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('b');
  assert.equal(writes.length, beforeKeys, 'selected text pauses decision shortcuts');
  await viewer().locator('body').evaluate(() => document.getSelection().removeAllRanges());
  await page.keyboard.press('c');
  const commentBox = viewer().getByRole('textbox', { name: /^Comment on change/ });
  await commentBox.press('b');
  await expect(commentBox).toHaveValue('b');
  assert.equal(writes.length, beforeKeys, 'typing does not accept a change');
  await commentBox.press('Escape');
  await viewer().locator('.change.current .change-number').click();
  await page.keyboard.press('b');
  await expect.poll(() => rounds[1].first).toBe('accepted');
  await expect(viewer().locator('[data-stop="0"] .change-head')).toBeHidden();
  await expect(viewer().locator('.change.current button.accept')).toBeEnabled();
  await viewer().locator('.change.current .change-number').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => rounds[1].first).toBe('pending');
  await page.keyboard.press('?');
  await shortcuts.waitFor();
  await acceptKey.click(); await acceptKey.press('Backspace');
  await expect(acceptKey).toHaveText('Not assigned');
  await shortcuts.getByRole('button', { name: 'Restore default shortcuts' }).click();
  await expect(acceptKey).toHaveText('A');
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/shortcut-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await shortcuts.locator('.modal').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: 'test-results/shortcut-settings-mobile.png', fullPage: true });
  await shortcuts.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(viewer().locator('.change.current button.accept')).toHaveAttribute('aria-keyshortcuts', 'a');
  console.log('PASS: Shortcut settings, conflicts, reassignment, persistence, typing and selection guards, help navigation, reset, and mobile layout');
  // Accept all and Reject all stay on one line and clear of Papilot's PDF
  // tools; a narrow split pane shows each icon with its count.
  const batch = () => viewer().locator('.bar').evaluate(bar => {
    const room = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
    return [...bar.querySelectorAll('.accept-all,.reject-all,.history')].map(button => {
      const box = button.getBoundingClientRect(), label = button.querySelector('.batch-label');
      return `${button.getAttribute('aria-label') || button.textContent}${box.height <= 36 ? '' : ' wraps'}${box.right <= room + 0.5 ? '' : ' under the tools'}${label && getComputedStyle(label).display === 'none' ? ' icon' : ''}`;
    }).join(' · ');
  });
  for (const width of [1440, 1100, 1000, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(batch).toMatch(/^Accept all \(4\)(?: icon)? · Reject all \(4\)(?: icon)? · History$/);
    await expect(viewer().getByRole('progressbar')).toBeInViewport();
    await expect.poll(() => viewer().locator('.change.current .dock').evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
  }
  // A narrow desktop pane keeps its actions in the card. On a phone the
  // toolbar can take a second row, preserving progress, navigation and tools.
  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: /^Review(?:,|$)/ }).click();
    await expect(viewer().getByRole('progressbar')).toBeInViewport();
    await expect(viewer().getByRole('button', { name: 'Previous change', exact: true })).toBeInViewport();
    await expect(viewer().getByRole('button', { name: 'Next change', exact: true })).toBeInViewport();
    await expect(viewer().getByRole('button', { name: 'History', exact: true })).toBeInViewport();
    await expect(page.locator('.review-tools .review-open')).toBeInViewport();
    await expect(page.locator('.review-tools .review-rebuild')).toBeInViewport();
    const position = await viewer().locator('.change.current .dock').evaluate(el => getComputedStyle(el).position);
    if (width > 520) assert.notEqual(position, 'fixed');
    else assert.equal(position, 'fixed');
    assert.equal(await viewer().locator('#paper').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await viewer().locator('.change.current').getByRole('button', { name: 'Accept', exact: true }).click();
  const accepted = viewer().locator('[data-stop="0"]');
  await expect(accepted.locator('.change-head')).toBeHidden();
  await expect(accepted.locator('.side.after')).toBeVisible();
  await expect(accepted.locator('.side.before')).toBeHidden();
  await expect(viewer().locator('.change-map-mark')).toHaveCount(2);
  await expect(viewer().locator('.change.current')).toHaveAttribute('data-stop', '1');
  // The accepted paragraph remains selectable for another note.
  await accepted.locator('.after .pdf-glyph').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await viewer().getByRole('button', { name: 'Add note', exact: true }).click();
  await viewer().getByRole('textbox', { name: 'Note for the agent' }).fill('A note on accepted text.');
  await viewer().getByRole('button', { name: 'Add note', exact: true }).click();
  await viewer().getByRole('button', { name: 'Close review notes' }).click();
  await viewer().locator('.change.current').getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(viewer().locator('[data-stop="1"] .change-head')).toBeHidden();
  await expect(viewer().locator('[data-stop="1"] .side.before')).toBeVisible();
  await viewer().locator('.change.current').getByRole('button', { name: 'Comment', exact: true }).click();
  await viewer().getByRole('textbox', { name: /^Comment on change/ }).fill('Try a clearer explanation.');
  await viewer().getByRole('button', { name: 'Send', exact: true }).click();
  await expect(viewer().locator('.change-head:visible')).toHaveCount(0);
  await expect(viewer().locator('.change-map-mark')).toHaveCount(0);
  await expect(viewer().locator('.review-complete')).toBeVisible();
  // Only History mode adds a row under the toolbar.
  await expect(viewer().locator('.review-mode')).toHaveCount(0);
  await sync();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await expect(viewer().getByText('Feedback sent · Agent is working', { exact: true })).toBeVisible();
  await viewer().getByRole('button', { name: 'History', exact: true }).click();
  await expect(viewer().locator('.change-head:visible')).toHaveCount(3);
  await expect(viewer().getByRole('button', { name: 'Undo last decision', exact: true })).toBeDisabled();
  task.status = 'reviewing';
  await sync();
  await expect(viewer().getByRole('button', { name: 'Undo last decision', exact: true })).toBeEnabled();
  await viewer().getByRole('button', { name: 'Back to review', exact: true }).click();
  await expect(viewer().getByText('All changes reviewed', { exact: true })).toBeVisible();
  await expect(viewer().getByText('There are no new changes to review. Previous decisions are available in History.', { exact: true })).toBeVisible();
  await expect(viewer().locator('.change-head:visible')).toHaveCount(0);
  await viewer().getByRole('button', { name: 'History', exact: true }).click();
  await viewer().getByRole('button', { name: 'Undo last decision', exact: true }).click();
  await expect(viewer().getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(viewer().locator('.change-head:visible')).toHaveCount(1);
  await expect(viewer().locator('.change.current')).toHaveAttribute('data-stop', '2');
  // Mixed decisions cannot be shown as an entirely accepted or rejected PDF strip.
  await viewer().locator('.change.current').getByRole('button', { name: /LaTeX$/ }).click();
  await viewer().locator('.source-unit').filter({ hasText: 'main.tex · lines 3–3' }).getByRole('button', { name: 'Accept', exact: true }).click();
  await viewer().locator('.source-unit').filter({ hasText: 'main.tex · lines 4–4' }).getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(viewer().locator('.mixed-reviewed .side:visible')).toHaveCount(0);
  await expect(viewer().getByText('Reviewed changes · View in History', { exact: true })).toBeVisible();
  // A finished review offers to commit what the task accepted; the agent writes the message.
  task.review.files = ['main.tex']; gitFiles = [{ path: 'main.tex', status: 'M', staged: false }];
  await sync();
  const card = viewer().locator('.review-complete');
  const message = () => card.getByRole('textbox', { name: 'Commit message', exact: true });
  await expect(message()).toHaveValue('Explain the method');
  await expect(card.getByTitle('Commit to main', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(messageRequests, [{ paths: ['main.tex'], agent: 'codex', fresh: false }]);
  // Typed text survives moving the form between the iframe and chat.
  await message().fill('My reviewed method');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Commit message', exact: true })).toHaveValue('My reviewed method');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(message()).toHaveValue('My reviewed method');
  assert.equal(messageRequests.length, 1, 'switching views reuses the agent message and user draft');
  await message().fill('');
  await expect(card.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
  await message().fill('Explain the method');
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/review-completed.png', fullPage: true, animations: 'disabled' });
  await card.getByRole('button', { name: 'Commit and push', exact: true }).click();
  assert.deepEqual(commitRequests, [{ message: 'Explain the method', push: true }]);
  await expect(card.getByText('Committed abc1234 and pushed.', { exact: true })).toBeVisible();
  await expect(message()).toHaveCount(0);
  // New tasks offer both destinations and an automatic message inline.
  task.deferred = true; task.review.files = ['main.tex']; gitFiles = [];
  await sync();
  await expect(card.getByRole('button', { name: 'Apply to working directory', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Commit to task branch', exact: true })).toBeVisible();
  await expect(card.getByText('Accepted changes are saved in this task. Choose where to save them below.', { exact: true })).toBeVisible();
  await expect(message()).toHaveValue('Explain the method');
  await expect(card.getByTitle('Commit to papilot/flow', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Commit and push', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(commitRequests.length, 1, 'generating a message does not commit automatically');
  await page.screenshot({ path: 'test-results/task-destinations-desktop.png', fullPage: true, animations: 'disabled' });
  await message().fill('My accepted revision');
  await card.getByRole('button', { name: 'Commit to task branch', exact: true }).click();
  assert.deepEqual(commitRequests.at(-1), { message: 'My accepted revision', push: false });
  await expect(card.getByText('Committed abc1234 to papilot/flow', { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText('Committed abc1234 to papilot/flow', { exact: true })).toBeVisible();
  task.delivery = null; task.review.files = ['main.tex']; await sync();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(card.getByText('Accepted changes are saved in this task. Choose where to save them below.', { exact: true })).toBeVisible();
  await expect(message()).toHaveValue('Explain the method');
  await expect(card.getByRole('button', { name: 'Apply to working directory', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/task-destinations-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await card.getByRole('button', { name: 'Apply to working directory', exact: true }).click();
  await expect(card.getByText('Applied to working directory', { exact: true })).toBeVisible();
  assert.equal(applyRequests.length, 1);
  assert.equal(commitRequests.length, 2, 'apply never commits');
  task.deferred = false; task.delivery = null;
  await page.setViewportSize({ width: 1440, height: 1000 }); await sync();
  console.log('PASS: Automatic inline commit messages for legacy and isolated tasks; editable drafts survive view switches; no dialog; desktop and mobile; persistent result and apply without commit');
  // A note link reveals even an accepted change without opening history.
  await viewer().locator('body').evaluate(() => { location.href = '?task=flow&round=1&change=0'; });
  await expect(viewer().locator('.change[data-stop="0"] .change-head')).toBeVisible();
  await expect(viewer().getByLabel('Review history')).toHaveCount(0);
  await expect(viewer().locator('.change[data-stop="0"]')).toHaveAttribute('data-state', 'accepted');
  await viewer().locator('body').evaluate(() => { location.href = '?task=flow'; });
  await expect(viewer().locator('.change-head:visible')).toHaveCount(0);
  // A new result replaces the current review. Earlier results are inspection only.
  latest = 2; rounds[2] = { new: 'pending' }; task.review.round = 2; task.review.unsent = 0; update();
  await sync();
  await expect(viewer().locator('html')).toHaveAttribute('data-papilot-round', '2');
  assert.doesNotMatch(await viewer().locator('body').innerText(), /Round \d+/);
  await expect(viewer().locator('.change-head:visible')).toHaveCount(1);
  await viewer().getByRole('button', { name: 'History', exact: true }).click();
  assert.doesNotMatch(await viewer().getByLabel('Review history').innerText(), /Round \d+/);
  await expect(viewer().getByLabel('Review history').locator('option[value="1"]')).toContainText('2026');
  await viewer().getByLabel('Review history').selectOption('1');
  await expect(viewer().locator('.banner').filter({ hasText: 'Viewing earlier changes.' })).toBeVisible();
  await expect(viewer().locator('html')).toHaveAttribute('data-papilot-round', '1');
  await expect(viewer().getByRole('button', { name: 'Undo last decision', exact: true })).toBeDisabled();
  const writeCount = writes.length;
  await viewer().locator('#paper').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  assert.equal(writes.length, writeCount);
  await viewer().getByRole('button', { name: 'Back to review', exact: true }).click();
  await expect(viewer().locator('html')).toHaveAttribute('data-papilot-round', '2');
  assert.doesNotMatch(await viewer().locator('body').innerText(), /Round \d+/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Review(?:,|$)/ }).click();
  await viewer().locator('.change.current').getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(viewer().locator('.change-head:visible')).toHaveCount(0);
  await viewer().getByRole('button', { name: 'History', exact: true }).click();
  await expect(viewer().getByRole('button', { name: 'Undo last decision', exact: true })).toBeInViewport();
  await expect(viewer().getByRole('button', { name: 'Back to review', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/review-history-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  // A completed question with no file changes is a normal answer, not a
  // missing review. It uses chat without overwriting the author's PDF layout.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const question = { ...task, id: 'question-fixture', name: 'question', title: 'What does this equation mean?', status: 'reviewing', review: { state: 'editing', round: null, counts: {}, job: { status: 'done', outcome: 'empty' } } };
  snapshot.tasks.push(question); await sync();
  await page.locator('[data-task="question-fixture"] .task-link').click();
  await expect(page.locator('[data-task="question-fixture"] .status')).toHaveText('Completed');
  await expect(page.getByText('This equation expresses conservation of mass.', { exact: true })).toBeVisible();
  await expect(page.locator('.review-panel')).toBeHidden();
  const questionViews = page.getByRole('group', { name: 'Workspace view' });
  await expect(questionViews.getByRole('button')).toHaveCount(1);
  const questionChat = questionViews.getByRole('button', { name: 'Chat', exact: true });
  await expect(questionChat).toHaveAttribute('aria-pressed', 'true');
  await expect(questionChat).toHaveAttribute('title', 'This conversation has no manuscript changes.');
  await expect(questionChat.locator('span')).toBeVisible();
  await questionChat.click();
  await expect(page.getByRole('button', { name: 'Generate PDF comparison', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:layout')), 'review');
  await page.reload();
  await expect(page.getByText('This equation expresses conservation of mass.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/answer-only-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('This equation expresses conservation of mass.', { exact: true })).toBeVisible();
  await expect(page.locator('.review-panel')).toBeHidden();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show task list', exact: true })).toBeVisible();
  await expect(questionViews.getByRole('button')).toHaveCount(1);
  await expect(questionChat).toBeVisible();
  await expect(questionChat.locator('span')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: 'test-results/answer-only-mobile.png', fullPage: true });
  for (const status of ['running', 'queued', 'waiting_input']) {
    question.status = status; await sync();
    await expect(page.locator('.task-grid')).toHaveClass(/show-conversation/);
    await expect(questionViews.getByRole('button')).toHaveCount(1);
    await expect(page.getByText('This equation expresses conservation of mass.', { exact: true })).toBeVisible();
  }
  question.status = 'reviewing';
  question.review = { ...task.review, job: { status: 'done', outcome: 'published' } };
  await page.setViewportSize({ width: 1440, height: 1000 }); await sync();
  await expect(page.locator('.review-frame')).toBeVisible();
  await expect(questionViews.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute('aria-pressed', 'true');
  question.review.job.outcome = 'unchanged'; await sync();
  await expect(page.locator('.review-frame')).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:layout')), 'review');
  console.log('PASS: Answer-only tasks complete in chat without a generate prompt; reload, mobile, follow-up questions, and later manuscript changes preserve the review preference');
  assert.deepEqual(errors, []);
  console.log('PASS: Current changes resolve to clean PDF; history and explicit undo; sent/working states; notes on accepted text; mixed decisions; new rounds; older rounds read-only; mobile');
} finally { await browser.close(); await server.close(); }
