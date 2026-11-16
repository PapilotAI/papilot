import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'fixture-task', projectId: 'paper', agent: 'codex', name: 'p-task', title: 'Revise the introduction', instructions: 'Keep the meaning.', worktree: '/tmp/paper', threadId: 'thread', turnId: 'turn', model: null, effort: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [
  { id: 'fast-model', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'deep-model', name: 'Deep model', isDefault: false, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', fastMode: { serviceTier: 'priority', description: 'Faster responses' } },
] };
const snapshot = { version: 'test', csrf: 'test', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime, models: [{ id: 'opus', name: 'Opus', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' }] } } };
const modelChanges = [], messages = [], restarts = [];
let failRestart = true;
let modelFailure = false, holdModel, releaseModel;
await context.addInitScript(() => {
  localStorage.setItem('papilot:task', 'fixture-task');
  localStorage.setItem('papilot:draft:fixture-task', 'My unsent instructions.');
  localStorage.setItem('papilot:draft-skill:fixture-task', 'polish');
  localStorage.setItem('papilot:files:task:fixture-task', JSON.stringify([{ id: 'original-draft-file', projectId: 'paper', name: 'draft-reference.txt', size: 10, mime: 'text/plain' }]));
  localStorage.setItem('papilot:review-notes:fixture-task', JSON.stringify({ instructions: 'Keep the notation.', notes: [{ id: 'draft-note', where: 'Round 2 · main.tex:12', quote: 'A useful claim.', comment: 'Explain this.', round: 2, strip: 'old-strip', rects: [], region: false }] }));
  localStorage.setItem('papilot:recent-models', JSON.stringify([{ agent: 'claude', model: 'opus' }]));
});
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [{ id: 'polish', name: 'Polish', description: 'Polish writing', hint: '', source: 'builtin' }] });
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'first-message', taskId: url.pathname.includes('fixture-task') ? task.id : snapshot.tasks.at(-1).id, type: 'user', text: 'Original request.', createdAt: 1 }] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
  if (url.pathname.endsWith('/restart')) {
    const body = route.request().postDataJSON(); restarts.push(body);
    if (failRestart) return route.fulfill({ status: 409, json: { error: 'The original task is still stopping. Retry shortly.' } });
    const replacement = { ...task, ...body, status: 'reviewing', threadId: null, turnId: null, createdAt: Date.now(), updatedAt: Date.now(), restart: { taskId: task.id, draftAttachments: [{ id: 'copied-draft-file', projectId: 'paper', name: 'draft-reference.txt', size: 10, mime: 'text/plain' }] } };
    task.status = 'interrupted'; snapshot.tasks.push(replacement); return json(replacement);
  }
  if (url.pathname.endsWith('/model')) {
    const body = route.request().postDataJSON(); modelChanges.push(body);
    if (holdModel) await holdModel;
    if (modelFailure) return route.fulfill({ status: 503, json: { error: 'Model settings could not be saved.' } });
    Object.assign(task, body, { model: body.model || null, effort: body.effort || null });
    return json(task);
  }
  if (url.pathname.endsWith('/messages')) { messages.push(route.request().postDataJSON()); return json({ ok: true }); }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
});

try {
  await page.goto(origin);
  const originalDraft = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await expect(originalDraft).toHaveValue('My unsent instructions.');
  const activity = page.locator('.activity-panel');
  await activity.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restart with another agent…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restart with another agent', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Rerun the original request in a new task. This task stays as it is.');
  await page.screenshot({ path: 'test-results/task-restart-desktop.png', animations: 'disabled' });
  await expect(dialog.getByRole('button', { name: 'Restart task', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await dialog.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await dialog.getByRole('combobox').press('Escape');
  await dialog.getByRole('checkbox', { name: 'Stop this task first' }).check();
  await dialog.getByRole('button', { name: 'Restart task', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('still stopping');
  assert.equal(restarts.length, 1);
  assert.equal(restarts[0].agent, 'claude'); assert.equal(restarts[0].model, 'opus'); assert.equal(restarts[0].stop, true);
  assert.deepEqual(restarts[0].draftAttachments, ['original-draft-file']);
  assert.equal(messages.length, 0, 'Restart never auto-sends the draft');
  failRestart = false;
  await dialog.getByRole('button', { name: 'Restart task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(restarts[1].id, restarts[0].id, 'A failed or lost response retries the same replacement');
  const replacementDraft = page.getByRole('textbox', { name: 'Instructions for Claude' });
  await expect(replacementDraft).toHaveValue(/My unsent instructions\./);
  await expect(replacementDraft).toHaveValue(/Keep the notation\./);
  await expect(replacementDraft).toHaveValue(/Round 2 · main.tex:12/);
  await expect(replacementDraft).toHaveValue(/Explain this\./);
  await expect(activity).toContainText('Original request.');
  await expect(activity).toContainText('Restarted from');
  await expect(activity).toContainText('draft-reference.txt');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:draft:fixture-task')), 'My unsent instructions.');
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft-skill:' + id), restarts[1].id), 'polish');
  assert.equal(messages.length, 0);
  await activity.locator('.restart-link button').click();
  await expect(originalDraft).toHaveValue('My unsent instructions.');
  await expect(activity).toContainText('Replacement task');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await activity.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restart with another agent…', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/task-restart-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(restarts.length, 2, 'Cancel creates no task');
  assert.deepEqual(errors, []);
  console.log('Task restart checks passed: destination model, stop confirmation, retry, retained drafts, links and mobile dialog.');
} finally {
  await browser.close(); await server.close();
}
