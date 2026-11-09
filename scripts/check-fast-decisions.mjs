// Decisions move the review on at once and reach the server one at a time.
// Run after `npm --prefix engine run build`:
//   node --import tsx scripts/check-fast-decisions.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../engine/node_modules/@playwright/test/index.mjs';
import { annotateReviewState } from '../src/server/review.ts';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('engine/dist/web') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const ids = ['c1', 'c2', 'c3', 'c4'];
const detail = {
  task: 'flow', round: 1, before: 'before', after: 'after', warnings: [], files: '/files/flow/1/', sections: [],
  loose: ids.map(id => ({ kind: 'change', units: [id], identical: false, before: [], after: [] })),
  units: ids.map((id, i) => ({ id, file: 'main.tex', status: 'modified', kind: 'text', whole_file: false, ops: [], old_start: i + 1, old_end: i + 1, new_start: i + 1, new_end: i + 1, old_text: `Original paragraph ${i + 1}`, new_text: `Revised paragraph ${i + 1}`, truncated: false })),
};
const DECIDED = { accept: 'accepted', reject: 'rejected', comment: 'commented' };
// The review engine: decisions keyed by action ID, applied once each.
let task, decisions, actions, applied, posts, held, hold, refuse, unreachable, lose;
function reset(status = 'reviewing') {
  task = { id: 'flow-task', projectId: 'paper', name: 'flow', title: 'Flow', status, deferred: true, createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: { state: 'reviewing', round: 1, counts: {}, unsent: 0, comments: 0, files: [] } };
  decisions = Object.fromEntries(ids.map(id => [id, 'pending']));
  actions = []; applied = new Map(); posts = []; held = []; hold = false; refuse = null; unreachable = 0; lose = 0;
}
const last = () => actions.at(-1);
const view = (extra = {}) => annotateReviewState({ task: 'flow', title: 'Flow', csrf: 'fixture', closed: false, state: 'reviewing', latest: 1, round: 1, revision: 'after', decisions: { ...decisions }, comments: {}, undo: last() ? { id: last().id, kind: last().kind, changes: last().changes } : null, job: null, ...extra }, [task]);
function apply(route, body) {
  if (route.endsWith('/decide')) {
    if (applied.has(body.id)) return {};
    const before = { ...decisions };
    for (const id of body.changes) decisions[id] = DECIDED[body.action];
    actions.push({ id: body.id, kind: body.action, changes: body.changes, before });
    applied.set(body.id, body);
    return {};
  }
  const action = actions.pop();
  decisions = action.before;
  return { restored: action.changes };
}

async function open(page) {
  await page.route('**/api/tasks/flow/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rounds/1')) return route.fulfill({ json: detail });
    if (route.request().method() !== 'POST') return route.fulfill({ json: view() });
    const body = route.request().postDataJSON();
    posts.push({ route: url.pathname.split('/').at(-1), ...body });
    if (hold) await new Promise(resolve => held.push(resolve));
    if (unreachable > 0) { unreachable--; return route.fulfill({ status: 503, json: { error: 'Papilot is restarting after an update. Please wait a moment.' } }); }
    const refusal = refuse?.(body);
    if (refusal) return route.fulfill({ status: 400, json: { error: refusal } });
    const extra = apply(url.pathname, body);
    // Applied, but the reply is lost on the way back.
    if (lose > 0) { lose--; return route.abort('connectionreset'); }
    return route.fulfill({ json: view(extra) });
  });
  await page.goto(`${origin}/?task=flow`);
  await expect(page.locator('.change.current')).toHaveAttribute('data-stop', '0');
}
const decides = () => posts.filter(post => post.route === 'decide');
const current = page => page.locator('.change.current');
const stateOf = (page, index) => page.locator(`.change[data-stop="${index}"]`);
const settle = () => new Promise(resolve => setTimeout(resolve, 400));
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

try {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));

  // Fast successive decisions advance at once and go out one at a time.
  reset(); await open(page); hold = true;
  for (const next of ['1', '2', '3']) {
    await page.keyboard.press('a');
    await expect(current(page)).toHaveAttribute('data-stop', next);
  }
  await settle();
  assert.equal(decides().length, 1, 'Only the first decision is in flight');
  for (const index of [0, 1, 2]) await expect(stateOf(page, index)).toHaveAttribute('data-state', 'accepted');
  await expect(page.locator('.review-progress')).toHaveAttribute('aria-valuenow', '3');
  for (let sent = 2; sent <= 3; sent++) {
    held.shift()();
    await expect.poll(() => decides().length).toBe(sent);
  }
  held.shift()();
  await expect.poll(() => decisions.c3).toBe('accepted');
  assert.deepEqual(decides().map(post => post.changes[0]), ['c1', 'c2', 'c3'], 'Server confirmations follow the order of decisions');
  assert.equal(new Set(decides().map(post => post.id)).size, 3);
  await expect(current(page)).toHaveAttribute('data-stop', '3');
  await expect(stateOf(page, 3)).toHaveAttribute('data-state', 'pending');
  // A double click decides only the change it started on.
  hold = false;
  await reloadFresh(page);
  await current(page).locator('button.accept').dblclick();
  await expect(current(page)).toHaveAttribute('data-stop', '1');
  await settle();
  assert.equal(decides().length, 1);
  await expect(stateOf(page, 1)).toHaveAttribute('data-state', 'pending');
  console.log('PASS: fast successive decisions advance at once, reach the server in order, and a double click decides one change');

  // A failure mid-queue returns to that change and says what was not sent.
  await reloadFresh(page); hold = true;
  for (let i = 0; i < 3; i++) await page.keyboard.press('a');
  await expect(current(page)).toHaveAttribute('data-stop', '3');
  held.shift()();
  await expect.poll(() => decides().length).toBe(2);
  refuse = body => body.changes[0] === 'c2' ? "c2 can't be applied: main.tex changed in your manuscript since this round was published. Nothing was written. Comment on the change to have the agent redo it." : null;
  held.shift()();
  await expect(page.locator('.toast')).toContainText("c2 can't be applied");
  await expect(page.locator('.toast')).toContainText('1 later decision was not sent.');
  await expect(current(page)).toHaveAttribute('data-stop', '1');
  await expect(stateOf(page, 0)).toHaveAttribute('data-state', 'accepted');
  for (const index of [1, 2]) await expect(stateOf(page, index)).toHaveAttribute('data-state', 'pending');
  await settle();
  assert.equal(decides().length, 2, 'The decision after the failure was never sent');
  assert.deepEqual(decisions, { c1: 'accepted', c2: 'pending', c3: 'pending', c4: 'pending' });
  hold = false; refuse = null;
  await page.keyboard.press('r');
  await expect.poll(() => decisions.c2).toBe('rejected');
  await expect(current(page)).toHaveAttribute('data-stop', '2');
  console.log('PASS: a refused decision returns to its change with the error; later decisions are shown undecided and reported, not sent');

  // A request that may not have arrived is retried with the same ID.
  await reloadFresh(page);
  unreachable = 1; lose = 1;
  await page.keyboard.press('a');
  await expect(current(page)).toHaveAttribute('data-stop', '1');
  await expect.poll(() => decides().length, { timeout: 10000 }).toBe(3);
  assert.equal(new Set(decides().map(post => post.id)).size, 1, 'Every attempt carries the same action ID');
  assert.equal(actions.length, 1, 'The engine applied it once');
  await expect(stateOf(page, 0)).toHaveAttribute('data-state', 'accepted');
  await expect(page.locator('.toast')).toHaveCount(0);
  console.log('PASS: retries keep the action ID and apply the decision once');

  // Undo waits for the queue, then undoes the last decision.
  await reloadFresh(page); hold = true;
  await page.keyboard.press('a');
  await page.keyboard.press('a');
  await page.keyboard.press(undoKey);
  await settle();
  assert.equal(posts.filter(post => post.route === 'undo').length, 0, 'Undo waits for queued decisions');
  held.shift()(); await expect.poll(() => decides().length).toBe(2);
  held.shift()();
  await expect.poll(() => posts.filter(post => post.route === 'undo').length).toBe(1);
  assert.equal(posts.at(-1).id, decides()[1].id, 'It undoes the last decision');
  held.shift()();
  await expect(page.locator('.toast')).toContainText('Last decision undone');
  await expect(current(page)).toHaveAttribute('data-stop', '1');
  assert.deepEqual(decisions, { c1: 'accepted', c2: 'pending', c3: 'pending', c4: 'pending' });
  // If a queued decision fails, Undo has nothing of the author's to undo.
  await reloadFresh(page); hold = true;
  await page.keyboard.press('a');
  await page.keyboard.press('a');
  await page.keyboard.press(undoKey);
  refuse = body => body.changes?.[0] === 'c2' ? 'These changes were already decided. Reload the page.' : null;
  held.shift()(); await expect.poll(() => decides().length).toBe(2);
  held.shift()();
  await expect(page.locator('.toast')).toContainText('already decided');
  await settle();
  assert.equal(posts.filter(post => post.route === 'undo').length, 0);
  assert.deepEqual(decisions, { c1: 'accepted', c2: 'pending', c3: 'pending', c4: 'pending' });
  console.log('PASS: undo waits for the queue to drain and is dropped if a queued decision fails');

  // While the agent edits a deferred task, accepting goes on and rejecting waits.
  hold = false; refuse = null;
  await reloadFresh(page, 'running');
  await expect(page.locator('#review-lock')).toContainText("The agent is editing this task's files");
  await expect(current(page).locator('button.accept')).toBeEnabled();
  await expect(current(page).locator('button.comment')).toBeEnabled();
  await expect(current(page).locator('button.reject')).toBeDisabled();
  await expect(page.locator('.reject-all')).toBeDisabled();
  await expect(page.locator('.accept-all')).toBeEnabled();
  await page.keyboard.press('r');
  await expect(page.locator('.toast')).toContainText('Pause it before rejecting');
  assert.equal(posts.length, 0);
  await page.keyboard.press('a');
  await expect.poll(() => decisions.c1).toBe('accepted');
  await page.keyboard.press(undoKey);
  await expect.poll(() => decisions.c1).toBe('pending');
  task.status = 'reviewing';
  await page.waitForTimeout(1700);
  await page.keyboard.press('r');
  await expect.poll(() => decisions.c1).toBe('rejected');
  task.status = 'running';
  await expect(page.locator('#review-lock')).toBeVisible({ timeout: 4000 });
  await page.keyboard.press(undoKey);
  await expect(page.locator('.toast')).toContainText('Pause it before rejecting');
  await settle();
  assert.equal(posts.filter(post => post.route === 'undo').length, 1, 'Undoing a rejection waits for the agent');
  await page.screenshot({ path: 'test-results/fast-decisions-agent-running.png' });
  console.log('PASS: during the agent turn accept, comment and undoing an accept stay available; reject and undoing a rejection say why they wait');

  // The same flow by touch on a phone.
  const phone = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  phone.on('pageerror', error => errors.push(error.message));
  reset(); await open(phone); hold = true;
  for (const next of ['1', '2']) {
    await current(phone).locator('button.accept').tap();
    await expect(current(phone)).toHaveAttribute('data-stop', next);
  }
  await expect(current(phone).locator('button.accept')).toBeInViewport();
  await phone.screenshot({ path: 'test-results/fast-decisions-phone.png' });
  while (held.length || decides().length < 2) { if (held.length) held.shift()(); await new Promise(resolve => setTimeout(resolve, 50)); }
  await expect.poll(() => decisions.c2).toBe('accepted');
  const width = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(width[0] <= width[1], `No horizontal scroll at phone width (${width})`);
  console.log('PASS: on a 390×844 phone, taps advance at once and the next change\'s controls stay in view');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}

async function reloadFresh(page, status) {
  reset(status);
  await page.addInitScript(() => localStorage.clear());
  await page.reload();
  await expect(current(page)).toHaveAttribute('data-stop', '0');
}
