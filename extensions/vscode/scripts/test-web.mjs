import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../../../scripts/playwright.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-vscode-chat-'));
const app = Fastify();
await app.register(staticFiles, { root: path.join(root, 'dist/web/chat') });
app.get('/', async (_, reply) => reply.type('text/html').send('<!doctype html><html><head><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="/view.css"></head><body class="vscode-dark"><div id="root"></div><script type="module" src="/view.js"></script></body></html>'));
await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 850 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'first', projectId: 'project', document: 'paper/main.tex', name: 'first', title: 'Clarify the paper', instructions: '', worktree: '/tmp/test', threadId: null, turnId: null, model: null, agent: 'codex', status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
const second = { ...task, id: 'second', name: 'second', title: 'Revise the slides', document: 'slides/main.tex' };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'test-model', name: 'Test model', isDefault: true, efforts: ['low', 'medium'], defaultEffort: 'medium' }] };
const snapshot = { version: 'test', projects: [{ id: 'project', name: 'Project', path: '/tmp/test', createdAt: 1 }], tasks: [task, second], requests: [], runtime, runtimes: { codex: runtime } };
let selected = task, failItems = false;
const state = () => ({ type: 'state', view: { kind: 'chat' }, task: selected, snapshot, skills: [] });
await page.exposeFunction('hostRequest', message => {
  requests.push(message);
  if (message.type === 'ready') return { state: state(), value: {} };
  if (message.type === 'command') return { value: null };
  if (message.type !== 'api') throw new Error('Unexpected bridge request: ' + message.type);
  if (/\/items$/.test(message.route)) return failItems ? { error: 'Conversation unavailable' } : { value: { items: [{ id: selected.id + '-reply', taskId: selected.id, type: 'assistant', text: 'Ready to revise ' + selected.document, createdAt: 1 }] } };
  if (/\/messages$/.test(message.route)) return { value: selected };
  if (/\/model$/.test(message.route)) return { value: selected };
  if (/\/(?:prepare|reconcile)$/.test(message.route)) return { value: selected };
  if (message.route === '/api/reconnect') return { value: {} };
  if (/\/usage$/.test(message.route)) return { value: { usage: null } };
  if (message.route === '/api/quick-notes') return { value: { notes: [] } };
  if (message.route === '/api/settings/effects') return { value: { enabled: true } };
  if (message.route === '/api/settings/note-alternatives') return { value: { enabled: true, range: 'few' } };
  throw new Error('Unexpected bridge route: ' + message.route);
});
await page.addInitScript(() => {
  window.acquireVsCodeApi = () => ({ postMessage: async message => {
    let response;
    try { response = await window.hostRequest(message); }
    catch (error) { response = { error: error.message }; }
    if (response.state) window.dispatchEvent(new MessageEvent('message', { data: response.state }));
    window.dispatchEvent(new MessageEvent('message', { data: { id: message.id, ...response } }));
  } });
});
const select = async value => { selected = value; await page.evaluate(value => window.dispatchEvent(new MessageEvent('message', { data: value })), state()); };
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  // VS Code supplies these variables; exercise the same CSS in a narrow sidebar.
  const colors = {
    'font-family': 'sans-serif', 'editor-font-family': 'monospace', 'font-size': '13px',
    'editor-background': '#1e1e1e', 'sideBar-background': '#252526', 'input-background': '#313131',
    'list-hoverBackground': '#2a2d2e', 'list-activeSelectionBackground': '#094771', 'editorWidget-background': '#252526',
    foreground: '#cccccc', descriptionForeground: '#aaaaaa', 'panel-border': '#454545', 'focusBorder': '#007fd4',
    'button-background': '#0e639c', 'button-foreground': '#ffffff', errorForeground: '#f48771',
  };
  await page.evaluate(colors => { for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty('--vscode-' + key, value); }, colors);
  await expect(page.getByText('Ready to revise paper/main.tex')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await input.fill('Keep this draft for the paper.');
  await select(second);
  await expect(input).toHaveValue('');
  await input.fill('Shorten the slides.');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  assert.equal(requests.find(request => request.route === '/api/tasks/second/messages')?.body.text, 'Shorten the slides.');
  await select(task);
  await expect(input).toHaveValue('Keep this draft for the paper.');
  await select({ ...second, status: 'uncertain', error: 'The last review request could not be confirmed.' });
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  assert.ok(requests.some(request => request.route === '/api/tasks/second/reconcile'));
  await select({ ...second, status: 'failed', error: 'Could not prepare the task.', preparation: { stage: 'failed' } });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  assert.ok(requests.some(request => request.route === '/api/tasks/second/prepare'));
  await select(task);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  assert.equal(requests.find(request => request.command === 'papilot.review')?.taskId, task.id);
  await page.screenshot({ path: path.join(artifacts, 'chat-dark.png') });
  failItems = true;
  await expect(page.getByText('Conversation unavailable', { exact: true })).toBeVisible();
  failItems = false;
  await expect(page.getByText('Conversation unavailable', { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('Keep this draft for the paper.');
  await page.evaluate(() => { document.body.className = 'vscode-light'; for (const [key, value] of Object.entries({ 'editor-background': '#ffffff', 'sideBar-background': '#f3f3f3', 'input-background': '#ffffff', 'editorWidget-background': '#f3f3f3', foreground: '#333333', descriptionForeground: '#616161' })) document.documentElement.style.setProperty('--vscode-' + key, value); });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 700, height: 850 });
  await page.screenshot({ path: path.join(artifacts, 'chat-light.png') });
  assert.deepEqual(errors, []);
  console.log('Conversation passed: shared composer, independent document drafts, task-bound review, send, loading recovery and live themes. Screenshots: ' + artifacts);
} finally { await browser.close(); await app.close(); }
