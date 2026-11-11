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
const BEFORE = '\\section{First}\nOriginal first paragraph.\n\\newpage\n\\section{Second}\nOriginal second paragraph.\n';
f.write(METHOD, BEFORE);
f.repo.run(['add', '-A']); f.repo.run(['commit', '-qm', 'Two pages']);
const app = f.app(); await app.ready;
const task = app.tasks.create('sources', 'Edit two pages', [], ['paper'], true);
f.edit(task, METHOD, 'Original first', 'Proposed first');
f.edit(task, METHOD, 'Original second', 'Proposed second');
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
class Agent extends EventEmitter { ready = false; close() {} }
const store = new Store(':memory:');
const workspace = new Workspace(store, new Agent(), async () => client, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new Agent()])));
store.saveProject({ id: 'paper', path: f.root, name: 'Paper', createdAt: 1 });
store.saveTask({ id: 'sources', projectId: 'paper', name: task.name, title: task.title, instructions: '', worktree: task.worktree, threadId: null, turnId: null, model: null, status: 'reviewing', deferred: true, createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });
await workspace.refresh('sources');
const manuscripts = new Manuscripts();
manuscripts.predict = async () => {};
const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
const server = await buildApp({ listener, store, workspace, manuscripts, csrf: 'fixture', serialGit: gitQueue(), dist: path.resolve('dist'), version: 'test', connectReview: async () => client });
await server.listen({ host: '127.0.0.1', port: 0 });
listener.port = server.server.address().port;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
const worktree = () => fs.readFileSync(path.join(task.worktree, METHOD), 'utf8');
try {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => { localStorage.setItem('papilot:task', 'sources'); localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await page.goto(`http://127.0.0.1:${listener.port}`);
  const viewer = page.frameLocator('.review-frame'), side = page.locator('#conversation-panel');
  await expect(viewer.locator('.change.current')).toBeVisible({ timeout: 60000 });

  // The change's pencil opens its file beside the chat, not a box in the card.
  await viewer.locator('.change.current .source-toggle').click();
  await expect(viewer.locator('.change.current .source-code')).toContainText('Proposed');
  await viewer.locator('.change.current .source-editor').getByRole('button', { name: 'Edit', exact: true }).click();
  const tab = side.getByRole('tab', { name: 'method.tex' }), chat = side.getByRole('tab', { name: 'Chat' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toHaveAttribute('title', METHOD);
  await expect(viewer.locator('.source-editor textarea'), 'the review leaves editing to the workspace').toHaveCount(0);
  const editor = side.locator('.cm-editor'), field = side.locator('.cm-content');
  await expect(editor).toBeVisible();
  await expect(side.locator('.composer-wrap'), 'the editor takes the chat\'s place').toBeHidden();
  const text = () => field.evaluate(content => [...content.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n'));
  await expect.poll(text).toBe(worktree());
  await expect(side.locator('.cm-source-focus')).toContainText('Proposed first');
  await expect(side.locator('.cm-change-bar'), 'bars mark what the task changed').toHaveCount(2);
  await expect(field).toBeFocused();

  // Typing marks the tab; the chat keeps its place, and so does the draft.
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed in Papilot.');
  const unsaved = side.locator('.side-tab-close[data-dirty]');
  await expect(unsaved).toHaveAttribute('title', /^Unsaved/);
  await chat.click();
  await expect(side.locator('.composer-wrap')).toBeVisible();
  await expect(editor).toBeHidden();
  await tab.click();
  await expect.poll(text).toContain('Proposed first paragraph. Typed in Papilot.');
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/task-source-edit.png' });

  // ⌘S writes the task's file, without an agent, and reviews it in a new round.
  const round = app.review.latestRound(task.name).number;
  await field.press('ControlOrMeta+s');
  await expect.poll(worktree).toContain('Proposed first paragraph. Typed in Papilot.');
  assert.equal(fs.readFileSync(path.join(f.root, METHOD), 'utf8'), BEFORE, 'the manuscript itself is untouched');
  await expect(unsaved, 'a saved file has no dot').toHaveCount(0);
  await expect.poll(() => app.review.latestRound(task.name)?.number, { timeout: 90000 }).toBe(round + 1);
  await expect.poll(() => app.review.latestRound(task.name)?.visuals, { timeout: 90000 }).toBe('ready');
  await expect(viewer.locator('.change').first()).toContainText('Typed in Papilot', { timeout: 60000 });

  // A second save continues the new round.
  await field.press('End');
  await page.keyboard.type(' Again.');
  await field.press('ControlOrMeta+s');
  // It waits for the engine to finish writing the round before.
  await expect.poll(worktree, { timeout: 60000 }).toContain('Typed in Papilot. Again.');
  await expect.poll(() => app.review.latestRound(task.name)?.number, { timeout: 90000 }).toBe(round + 2);
  await expect(side.locator('.source-panel-error')).toHaveCount(0);

  // Closing the tab returns to the chat.
  await side.locator('.side-tab-close').click();
  await expect(tab).toHaveCount(0);
  await expect(chat).toHaveCount(0);
  await expect(side.locator('.composer-wrap')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: a change\'s pencil opens its whole file in the editor beside the chat, marked with what the task changed; ⌘S saves it into the task, reviews it in a new round and continues from there; the chat stays as it was');
} finally {
  await browser.close();
  await server.close(); await engine.close(); workspace.close(); store.close();
  await f.close();
}
