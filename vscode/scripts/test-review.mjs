import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../../scripts/playwright.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-vscode-history-'));
const app = Fastify();
await app.register(staticFiles, { root: path.join(root, 'dist/web/review') });
const view = language => `<!doctype html><html lang="${language}"><head><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="/view.css"></head><body class="vscode-light"><div id="root"></div><script type="module" src="/view.js"></script></body></html>`;
app.get('/', async (_, reply) => reply.type('text/html').send(view('en')));
app.get('/german', async (_, reply) => reply.type('text/html').send(view('de')));
app.get('/strip.svg', async (_, reply) => reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="40"><rect width="500" height="40" fill="white"/><text x="10" y="25">A revised sentence in the paper.</text></svg>'));
await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1000, height: 800 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
let latest = 2;
let sourceUnit = {}, retryDecisions = false;
const decisions = {};
const strip = { src: 'strip.svg', clean: 'strip.svg', width: 500, height: 40, page: 1, label: '1', top: 100 };
const reviewUnit = (round, id = 'u1') => ({
  id, file: id === 'u1' ? 'main.tex' : 'appendix.tex', status: 'modified', kind: 'text', whole_file: false, truncated: false,
  old_start: 0, old_end: 1, new_start: 0, new_end: 1, old_text: 'Original sentence', new_text: 'Revised sentence ' + round,
  ops: [['replace', 0, 1, 0, 1]], text_ops: [['replace', 0, 17, 0, 18]], ...sourceUnit,
});
const detail = round => ({
  task: 'task', round, before: 'base', after: 'revision-' + round, files: '/', warnings: [],
  units: retryDecisions ? [reviewUnit(round), reviewUnit(round, 'u2')] : [reviewUnit(round)],
  sections: [{ node: 'intro', number: '1', title: 'Version ' + round, blocks: [{ kind: 'change', units: ['u1'], identical: false, before: [strip], after: [strip] }] }], loose: [],
});
const state = round => ({ task: 'task', title: 'Review the paper', state: 'reviewing', latest, round, revision: 'revision-' + round,
  closed: false, sourceEditing: true, decisions: { u1: round < 3 ? 'accepted' : 'pending', ...(retryDecisions ? { u2: 'pending' } : {}), ...decisions },
  comments: {}, csrf: 'test', undo: null, job: null,
  history: Array.from({ length: latest }, (_, i) => ({ number: i + 1, created: 1700000000 + i * 1000 })) });
await page.exposeFunction('hostRequest', message => {
  requests.push(message);
  if (message.type === 'ready') return { state: { type: 'state', view: { kind: 'review', project: { id: 'project' }, task: { id: 'task', name: 'task' } } }, value: {} };
  if (message.type === 'source') return { value: null };
  if (message.type !== 'api') throw new Error('Unexpected bridge request: ' + message.type);
  const url = new URL(message.route, 'http://test');
  if (url.pathname.endsWith('/state')) return { value: state(Number(url.searchParams.get('round')) || latest) };
  if (retryDecisions && url.pathname.endsWith('/decide')) {
    const attempts = requests.filter(request => request.route === message.route);
    if (attempts.length === 1) return { status: 400, error: 'A review action is already in progress. Wait for it to finish.' };
    for (const change of message.body.changes) decisions[change] = message.body.action === 'accept' ? 'accepted' : 'rejected';
    return { value: state(message.body.round) };
  }
  const match = url.pathname.match(/\/rounds\/(\d+)$/);
  if (match) return { value: detail(Number(match[1])) };
  throw new Error('Unexpected bridge route: ' + message.route);
});
await page.addInitScript(() => {
  window.acquireVsCodeApi = () => ({ postMessage: async message => {
    let response;
    try { response = await window.hostRequest(message); } catch (error) { response = { error: error.message }; }
    if (response.state) window.dispatchEvent(new MessageEvent('message', { data: response.state }));
    window.dispatchEvent(new MessageEvent('message', { data: { id: message.id, ...response } }));
  } });
});
try {
  const url = `http://127.0.0.1:${app.server.address().port}/`;
  await page.goto(url);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('combobox', { name: 'Review history' });
  await expect(history).toHaveValue('2');
  await history.selectOption('1');
  await expect(history).toHaveValue('1');
  await expect(page.getByRole('heading', { name: '1Version 1', exact: true })).toBeVisible();
  assert.equal(page.url(), url, 'history must keep the webview document and its host bridge');
  await page.getByRole('link', { name: 'Back to current changes →' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(history).toHaveValue('2');
  await history.selectOption('1');
  await expect(history).toHaveValue('1');
  latest = 3;
  await expect(history.locator('option')).toHaveCount(3);
  await expect(history).toHaveValue('1');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.body.className = 'vscode-' + theme;
      const dark = theme === 'dark';
      const colors = { 'font-family': 'sans-serif', 'editor-font-family': 'monospace', 'font-size': '13px', foreground: dark ? '#cccccc' : '#333333', descriptionForeground: dark ? '#aaaaaa' : '#616161',
        'editor-background': dark ? '#1e1e1e' : '#ffffff', 'sideBar-background': dark ? '#252526' : '#f3f3f3', 'input-background': dark ? '#313131' : '#ffffff',
        'editorWidget-background': dark ? '#252526' : '#f3f3f3', 'panel-border': dark ? '#454545' : '#cccccc', 'focusBorder': '#007fd4', 'button-background': '#0e639c', 'button-foreground': '#ffffff' };
      for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty('--vscode-' + key, value);
    }, theme);
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(history).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to review', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(artifacts, `history-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Back to review', exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '1Version 3', exact: true })).toBeVisible();
  // Source navigation must still cross the original host bridge after returning.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click({ timeout: 10000 });
  await expect.poll(() => requests.filter(request => request.type === 'source').length).toBe(1);
  assert.equal(requests.filter(request => request.type === 'ready').length, 1, 'round navigation must not reload the webview');

  // The webview language comes from its host even with English browser preferences.
  await page.goto(url + 'german');
  await expect(page.getByRole('button', { name: 'Annehmen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ablehnen', exact: true })).toBeVisible();
  latest = 2;
  await page.getByRole('button', { name: 'Verlauf', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Überprüfungsverlauf' })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Zurück zur Überprüfung', exact: true })).toBeVisible();

  latest = 3;
  retryDecisions = true;
  requests.length = 0;
  const key = 'papilot:review:queue:/:task';
  const queued = [
    { id: 'first-saved-decision', kind: 'accept', changes: ['u1'] },
    { id: 'second-saved-decision', kind: 'reject', changes: ['u2'] },
  ].map(entry => ({ ...entry, round: latest, body: '', stop: 0, done: '' }));
  await page.evaluate(({ key, queued }) => localStorage.setItem(key, JSON.stringify(queued)), { key, queued });
  await page.goto(url);
  await expect.poll(() => requests.filter(request => request.route?.endsWith('/decide')).map(request => request.body.id)).toEqual([
    queued[0].id, queued[0].id, queued[1].id,
  ]);
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  retryDecisions = false;
  delete decisions.u1;
  delete decisions.u2;

  const latex = page.getByRole('button', { name: 'LaTeX', exact: true });
  for (const [unit, lines] of [
    [{ file: 'new.tex', status: 'added', whole_file: true, new_start: 1, new_end: 3, ops: [], text_ops: undefined }, [0, 3]],
    [{ file: 'windows.tex', old_text: 'Original\r\n', new_text: 'Revised\r\n', ops: [['replace', 0, 1, 6, 7]] }, [6, 7]],
  ]) {
    sourceUnit = unit;
    requests.length = 0;
    await page.goto(url);
    await latex.click();
    await expect.poll(() => requests.find(request => request.type === 'source')?.lines).toEqual(lines);
    assert.equal(requests.find(request => request.type === 'source').file, unit.file);
    assert.ok(!requests.some(request => /\/source\?/.test(request.route || '')));
  }

  // Historical and deleted sources stay available as excerpts.
  sourceUnit = { file: 'deleted.tex', status: 'deleted', new_text: '', text_ops: undefined };
  requests.length = 0;
  await page.goto(url);
  await latex.click();
  await expect(page.locator('.source-unit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  assert.ok(!requests.some(request => request.type === 'source'));
  sourceUnit = {};
  latest = 2;
  await page.goto(url);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await history.selectOption('1');
  await expect(page.getByRole('heading', { name: '1Version 1', exact: true })).toBeVisible();
  await latex.click();
  await expect(page.locator('.source-unit')).toBeVisible();
  assert.ok(!requests.some(request => request.type === 'source'));
  assert.deepEqual(errors, []);
  console.log('Review history, decision recovery, native source bridge and host locale passed. Screenshots: ' + artifacts);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') });
  console.error('Review failure screenshot: ' + artifacts);
  throw error;
} finally { await browser.close(); await app.close(); }
