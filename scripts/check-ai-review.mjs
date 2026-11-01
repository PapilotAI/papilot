import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const runtime = { connected: true, authenticated: true, models: [] };
const state = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Review example', path: '/tmp/paper' }], tasks: [], requests: [], runtime };
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const text = words[0].words[1], rect = [text[1] / 612, (text[2] - text[3]) / 792, (text[1] + text[4]) / 612, text[2] / 792];
const note = { id: 'ai-finding-1', projectId: 'paper', key: 'pdf', page: 0, rect, rects: [rect], quote: text[0], comment: 'State the assumptions under which this claim holds.', source: null, createdAt: Date.now(), aiReview: { taskId: 'review', agent: 'codex' } };
let notes = [], attempts = [], edits = [], fail = true;
await page.route('**/api/**', route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/state') return json(state);
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/skills')) return json({ skills: [{ id: 'ai-review', name: 'AI review', description: 'Read the paper and leave PDF comments without editing the manuscript', hint: 'Review focus', source: 'builtin', output: 'annotations' }] });
  if (url.pathname.endsWith('/git')) return json({ branch: 'main', files: [] });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { branch: 'main', files: [] }, build: { current: true, status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'answer', taskId: state.tasks[0]?.id, type: 'assistant', text: 'Clarify the assumptions behind the main claim.', createdAt: 1 }] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/archive')) return json(state.tasks[0]);
  if (url.pathname === '/api/tasks' && route.request().postDataJSON().skill === 'ai-review') {
    const body = route.request().postDataJSON(); attempts.push(body);
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: 'Temporary failure. Try again.' } }); }
    const task = { ...body, name: body.id, mode: 'review', status: 'reviewing', aiReview: { key: 'pdf', notes: 1 }, createdAt: 1, updatedAt: 1, review: { state: 'done', round: null, counts: {}, files: [], unsent: 0, comments: 0 } };
    state.tasks.push(task); notes = [note];
    return json(task);
  }
  if (url.pathname === '/api/tasks') {
    const body = route.request().postDataJSON(); edits.push(body);
    const task = { ...body, name: body.id, status: 'queued', createdAt: 2, updatedAt: 2, review: null };
    state.tasks.push(task); notes = []; return json(task);
  }
  throw Error(`Unexpected request ${url.pathname}`);
});
try {
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  const chooseReview = async () => {
    await page.getByRole('button', { name: 'Add files or skills', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'AI review', exact: true }).click();
    await expect(page.locator('.composer-skill')).toHaveText('AI review');
  };
  await expect(page.getByRole('group', { name: 'Task type' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revise', exact: true })).toHaveCount(0);
  await chooseReview();
  await page.getByRole('textbox', { name: 'Describe the revision' }).fill('Check assumptions and clarity.');
  await page.screenshot({ path: 'test-results/ai-review-start.png', fullPage: true });
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect(page.getByText('Temporary failure. Try again.', { exact: true })).toBeVisible();
  await page.reload();
  await chooseReview();
  await expect(page.getByRole('textbox', { name: 'Describe the revision' })).toHaveValue('Check assumptions and clarity.');
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await page.locator('.task-link').first().click();
  await page.getByRole('button', { name: 'View PDF notes', exact: true }).click();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].id, attempts[1].id);
  assert.equal(attempts[0].instructions, 'Check assumptions and clarity.');
  assert.equal(attempts[0].skill, 'ai-review');
  assert.equal(attempts[0].mode, undefined);
  assert.equal(edits.length, 0);
  const selected = page.getByRole('button', { name: 'Include note 1 in this task', exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('AI · Codex', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start task', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Show note 1 on the page', exact: true }).click();
  await expect(page.locator('.note-mark[data-note="ai-finding-1"]')).toBeVisible();
  await expect(page.locator('.pdfViewer canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/ai-review-notes.png', fullPage: true });
  await selected.focus(); await page.keyboard.press('Space');
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect.poll(() => edits.length).toBe(1);
  assert.deepEqual(edits[0].annotations, [note.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Describe the revision' }).fill('/ai-review');
  await page.getByRole('option', { name: 'AI review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start task', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/ai-review-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('AI review skill UI: single composer, menu and slash command, retry, PDF notes, explicit selection, edit handoff and mobile layout passed.');
} finally { await browser.close(); await server.close(); }
