// Browser -> Papilot -> real review server -> real Git and LaTeX.
// Only the agent is inert. All repositories, state and browser profiles are disposable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium, expect } from '../engine/node_modules/@playwright/test/index.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-batching-'));
process.env.PAPILOT_DATA = path.join(temp, 'data');
delete process.env.PAPILOT_DESKTOP;
const latexmk = execFileSync('which', ['latexmk'], { encoding: 'utf8' }).trim();
const calls = path.join(temp, 'compiles.jsonl'), fail = path.join(temp, 'fail'), hold = path.join(temp, 'hold');
const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'latexmk'), `#!${process.execPath}
const fs = require('node:fs');
const build = process.argv.includes('-outdir=build');
if (build) fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
if (build && fs.existsSync(${JSON.stringify(fail)})) { console.error('Intentional compilation failure'); process.exit(1); }
const deadline = Date.now() + 30000;
while (build && fs.existsSync(${JSON.stringify(hold)}) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
const result = require('node:child_process').spawnSync(${JSON.stringify(latexmk)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
const [{ Fixture }, { createServer }, { Store }, { Workspace }, { Manuscripts }, { buildApp, gitQueue }, { Updates }, { AGENT_IDS }] = await Promise.all([
  import('../engine/tests/ts/helpers.ts'), import('../engine/src/server.ts'), import('../src/server/store.ts'),
  import('../src/server/workspace.ts'), import('../src/server/manuscript.ts'), import('../src/server/app.ts'),
  import('../src/server/updates.ts'), import('../src/shared.ts'),
]);
class InertAgent extends EventEmitter { ready = false; close() {} }
const f = new Fixture(), store = new Store(path.join(temp, 'data/state.sqlite3')), manuscripts = new Manuscripts();
let server, reviewServer, browser, page, workspace, updates;
const count = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0;
fs.mkdirSync('test-results', { recursive: true });
const report = { decisions: 0, decisionCompiles: 0, applicationCompiles: 0, refreshes: 0, errors: [] };
try {
  f.write('paper/main.tex', '\\documentclass{article}\n\\begin{document}\n\\input{first}\n\\input{second}\n\\input{third}\n\\end{document}\n');
  for (const name of ['first', 'second', 'third']) f.write(`paper/${name}.tex`, `\\section{${name}}\nOriginal ${name} sentence.\n`);
  f.repo.run(['add', '.']); f.repo.run(['commit', '-qm', 'Browser batching fixture']);
  const engine = f.app(); await engine.ready;
  const proposal = engine.tasks.create('batching', 'Review batching', [], ['paper'], true);
  for (const name of ['first', 'second', 'third']) f.edit(proposal, `paper/${name}.tex`, `Original ${name}`, `Revised ${name}`);
  engine.publisher.submit(proposal.name); await engine.publisher.join();
  assert.equal(engine.publisher.current(proposal.name)?.status, 'done', JSON.stringify(engine.publisher.current(proposal.name)));
  reviewServer = createServer(engine); await reviewServer.listen({ host: '127.0.0.1', port: 0 });
  engine.url = `http://127.0.0.1:${reviewServer.server.address().port}`;
  const call = async (route, body) => {
    const response = await fetch(engine.url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Review-Token': engine.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || response.statusText);
    return result;
  };
  const client = { url: engine.url, token: engine.csrf, get: route => call(route), post: (route, body = {}) => call(route, body) };
  workspace = new Workspace(store, new InertAgent(), async () => client, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new InertAgent()])));
  store.saveProject({ id: 'paper', name: 'Batching test paper', path: f.root, createdAt: Date.now() });
  store.saveTask({ id: 'batching', projectId: 'paper', name: proposal.name, title: 'Review batching', instructions: '', worktree: proposal.worktree,
    deferred: true, threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null });
  await workspace.refresh('batching');
  const settle = async () => {
    let result;
    await expect.poll(async () => { result = await manuscripts.state('paper', f.root); return result.build.status; }, { timeout: 60000 }).not.toBe('building');
    return result.build;
  };
  assert.equal((await settle()).status, 'ready');
  const refresh = manuscripts.refresh.bind(manuscripts);
  manuscripts.refresh = (...args) => { report.refreshes++; return refresh(...args); };
  const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
  updates = new Updates({ root: process.cwd(), data: process.env.PAPILOT_DATA, version: '0.9.2', port: 0, supported: false, busy: () => false, shutdown() {}, latest: async () => '0.9.2' });
  server = await buildApp({ store, workspace, manuscripts, listener, csrf: 'batching-test', serialGit: gitQueue(), dist: path.resolve('dist'), version: '0.9.2', connectReview: async () => client, updates });
  await server.listen({ host: '127.0.0.1', port: 0 }); listener.port = server.server.address().port;
  const origin = `http://127.0.0.1:${listener.port}`;
  console.log(`Isolated web test: ${origin}, real review service: ${engine.url}`);
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ locale: 'en-US', viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => { localStorage.setItem('papilot:task', 'batching'); localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await page.goto(origin);
  const viewer = () => page.frameLocator('.review-frame');
  await expect(viewer().locator('.change.current')).toBeVisible();
  assert.equal(engine.review.summary(proposal.name).counts.pending, 3);
  const start = count(), refreshStart = report.refreshes, round = engine.review.latestRound(proposal.name).number;
  const choose = async (action, pending) => {
    await viewer().locator('.change.current').getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => engine.review.summary(proposal.name).counts.pending).toBe(pending);
    await expect(viewer().locator('.change.current').getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    report.decisions++;
  };
  await choose('Accept', 2);
  await choose('Reject', 1);
  // Undo through the real embedded viewer, then reload with persisted choices.
  await viewer().locator('.change.current .change-number').click(); await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => engine.review.summary(proposal.name).counts.pending).toBe(2);
  await page.reload();
  await expect(viewer().locator('.bar .reject-all')).toBeEnabled();
  await choose('Accept', 1);
  await viewer().locator('.change.current').getByRole('button', { name: 'Accept', exact: true }).click(); report.decisions++;
  await expect.poll(() => engine.review.summary(proposal.name).counts.pending).toBe(0);
  await expect(viewer().getByRole('button', { name: 'Apply to workspace', exact: true })).toBeEnabled();
  await page.reload();
  await expect(viewer().getByRole('button', { name: 'Apply to workspace', exact: true })).toBeEnabled();
  // Wait through the actual periodic review refresh; it must not enqueue a build.
  await page.waitForResponse(response => response.url().includes('/api/tasks/batching/state') && response.ok());
  assert.equal(engine.review.latestRound(proposal.name).number, round);
  report.decisionCompiles = count() - start;
  assert.equal(report.decisionCompiles, 0);
  assert.equal(report.refreshes, refreshStart);
  for (const name of ['first', 'second', 'third']) assert.match(f.read(`paper/${name}.tex`), /Original/);
  await page.screenshot({ path: 'test-results/review-batching-before-apply.png' });

  await viewer().getByRole('button', { name: 'Apply to workspace', exact: true }).click();
  await expect.poll(() => store.task('batching').delivery?.mode).toBe('workspace');
  assert.equal((await settle()).status, 'ready');
  assert.equal(report.refreshes - refreshStart, 1);
  report.applicationCompiles = count() - start;
  assert.equal(report.applicationCompiles, 1, 'the final selected version runs one latexmk build');
  assert.match(f.read('paper/first.tex'), /Revised first/);
  assert.match(f.read('paper/second.tex'), /Revised second/);
  assert.match(f.read('paper/third.tex'), /Revised third/);
  console.log('PASS: browser decisions, rejection, undo and reload compile zero times; final application compiles once with the correct text');

  // A new task exercises a real in-flight comparison, compiler failure and retry.
  f.repo.run(['add', '.']); f.repo.run(['commit', '-qm', 'Applied selection']);
  const retry = engine.tasks.create('retry', 'Compilation recovery', [], ['paper'], true);
  f.edit(retry, 'paper/first.tex', 'Revised first', 'Recovery first');
  f.edit(retry, 'paper/third.tex', 'Revised third', 'Recovery third');
  store.saveTask({ ...store.task('batching'), id: 'retry', name: retry.name, title: 'Compilation recovery', worktree: retry.worktree, delivery: null, review: null });
  await workspace.publish('retry');
  await page.getByRole('button', { name: /^Compilation recovery/ }).click();
  await expect(viewer().locator('.bar .accept-all')).toBeEnabled();
  f.edit(retry, 'paper/first.tex', 'Recovery first', 'Updated first');
  fs.writeFileSync(hold, '');
  await page.locator('.review-rebuild').click();
  await expect(page.locator('.review-rebuild')).toHaveAttribute('aria-busy', 'true');
  await expect(viewer().locator('.bar .status[data-state="building"]')).toHaveCSS('clip-path', 'inset(50%)');
  assert.equal(await viewer().locator('.bar').evaluate(el => el.offsetHeight), 44);
  await page.screenshot({ path: 'test-results/review-batching-real-build.png' });
  fs.rmSync(hold);
  await expect(page.locator('.review-rebuild')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
  await expect(viewer().locator('.bar .accept-all')).toBeEnabled();
  const goodRound = engine.review.latestRound(retry.name).number;

  f.edit(retry, 'paper/first.tex', 'Updated first', 'Broken first'); fs.writeFileSync(fail, '');
  await page.locator('.review-rebuild').click();
  await expect(page.locator('.review-rebuild')).toHaveAttribute('data-state', 'failed', { timeout: 60000 });
  await expect(viewer().locator('.bar .status[data-state="build_failed"]')).toBeVisible();
  await expect(viewer().locator('.bar .accept-all')).toBeEnabled();
  assert.equal(engine.review.latestRound(retry.name).number, goodRound, 'a failed build preserves the last review');
  await expect(viewer().locator('.change.current')).toBeVisible();
  await page.screenshot({ path: 'test-results/review-batching-failed.png' });
  fs.rmSync(fail); await page.locator('.review-rebuild').click();
  await expect(page.locator('.review-rebuild')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(viewer().locator('.bar .accept-all')).toBeEnabled();
  await expect(viewer().locator('.bar .status')).toHaveCount(0);
  assert.deepEqual(report.errors, []);
  console.log('PASS: real comparison progress, old preview retention, failed compilation and retry recover without stuck controls');
  fs.writeFileSync('test-results/review-batching.json', JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  console.error('Task at failure:', JSON.stringify(store.tasks()));
  if (page) { await page.screenshot({ path: 'test-results/review-batching-error.png' }); fs.writeFileSync('test-results/review-batching-error.txt', await page.locator('body').innerText()); }
  throw error;
} finally {
  fs.rmSync(hold, { force: true });
  if (browser) await browser.close();
  if (server) await server.close();
  workspace?.close(); updates?.close();
  await manuscripts.stop();
  if (reviewServer) await reviewServer.close();
  await f.close(); store.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
