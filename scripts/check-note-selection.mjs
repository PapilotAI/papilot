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
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const origin = `http://127.0.0.1:${server.server.address().port}`;
const runtime = { connected: true, authenticated: true, models: [] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }, { id: 'other', name: 'Other paper', path: '/tmp/other' }], tasks: [], requests: [], runtime, runtimes: { codex: runtime, claude: runtime, antigravity: runtime } };
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
function note(id, index, group) {
  const [quote, x, y, height, width] = words[0].words[index];
  const rect = [x / 612, (y - height) / 792, (x + width) / 612, y / 792];
  return { id, projectId: 'paper', key: 'pdf', page: 0, rect, rects: [rect], quote, comment: group ? '' : `Revise ${id}.`, ...(group ? { group } : {}), source: null, createdAt: index };
}
let notes = [note('n1', 1), note('n2', 2, 'yellow'), note('n3', 3, 'yellow'), note('n4', 4, 'purple'), note('n5', 5)];
const otherNote = { ...note('other-note', 6), projectId: 'other' };
const original = structuredClone(notes), sent = [], attempts = [], items = new Map();
let fail = false, hold = false, release;
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json({ branch: 'main', files: [] });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: url.pathname.includes('/other/') ? [otherNote] : notes });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/items')) return json({ items: items.get(url.pathname.split('/')[3]) || [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname === '/api/tasks') {
    const body = route.request().postDataJSON(); attempts.push(body);
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: 'Try again.' } }); }
    if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
    sent.push(body);
    items.set(body.id, [{ id: `message-${body.id}`, taskId: body.id, type: 'user', text: body.instructions, createdAt: Date.now(), meta: { groupInstructions: body.groupInstructions, notes: notes.filter(note => body.annotations?.includes(note.id)).map(note => ({ id: note.id, group: note.group, where: 'Page 1', quote: note.quote, comment: note.comment })) } }]);
    const task = { ...body, name: body.id, title: body.title, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), review: null };
    snapshot.tasks.push(task); notes = notes.filter(note => !(body.annotations || []).includes(note.id));
    return json(task);
  }
  throw Error(`Unexpected request ${url.pathname}`);
});
const all = () => page.getByRole('button', { name: 'Select all notes for this task', exact: true });
const group = color => page.getByRole('button', { name: `Select all ${color} notes for this task`, exact: true });
const check = id => page.locator(`.notes-panel [data-note="${id}"]`).getByRole('button', { name: /^Include note/ });
const prompt = () => page.getByRole('textbox', { name: 'Describe the revision', exact: true });
const send = () => page.getByRole('button', { name: 'Start task', exact: true });
const instruction = color => page.getByRole('textbox', { name: `Instructions for ${color} notes`, exact: true });
async function setSelection(control, selected) {
  if (await control.getAttribute('aria-pressed') === String(selected)) return;
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', String(selected));
}
async function notesReady() {
  await expect(all()).toBeVisible();
}
async function switchPaper(name) {
  await page.locator('.project-switcher').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}
try {
  await page.goto(origin);
  await expect(all()).toHaveAttribute('aria-pressed', 'false');
  await notesReady();
  await expect(page.locator('.notes-panel input[type="checkbox"]')).toHaveCount(0);
  for (const item of notes) await expect(check(item.id)).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.notes-panel [data-note="n1"] .note-quote-text').click();
  await expect(check('n1')).toHaveAttribute('aria-pressed', 'false');
  await expect(send()).toBeDisabled();
  await setSelection(all(), true);
  await expect(send()).toBeDisabled();
  await instruction('Yellow').fill('Explain the reasoning step by step.');
  await expect(send()).toBeDisabled();
  await instruction('Purple').fill('Shorten this wording.');
  await expect(send()).toBeEnabled();
  // Cards are keyboard operable; editing and locating a note do not change
  // whether that note will be sent.
  await check('n1').focus(); await page.keyboard.press('Space');
  await expect(check('n1')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(check('n1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit note 1: Revise n1.', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit note 1', exact: true })).toBeVisible();
  await expect(check('n1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await setSelection(check('n2'), false);
  await page.getByRole('button', { name: 'Show note 2 on the page', exact: true }).click();
  await expect(check('n2')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.notes-panel [data-note="n2"]')).toHaveAttribute('data-selected', 'false');
  const backgrounds = await page.locator('.notes-panel .group-location').evaluateAll(rows => rows.slice(0, 2).map(row => getComputedStyle(row).backgroundColor));
  assert.notEqual(backgrounds[0], backgrounds[1], 'Selected cards must have a distinct highlight');
  await expect(all()).toHaveAttribute('aria-pressed', 'mixed');
  await expect(group('Yellow')).toHaveAttribute('aria-pressed', 'mixed');
  await expect(page.getByText('Added to task: 4', { exact: true })).toBeVisible();
  await page.reload(); await notesReady();
  await expect(instruction('Yellow')).toHaveValue('Explain the reasoning step by step.');
  await expect(instruction('Purple')).toHaveValue('Shorten this wording.');
  await expect(check('n2')).toHaveAttribute('aria-pressed', 'false');
  await switchPaper('Other paper'); await expect(all()).toHaveAttribute('aria-pressed', 'false');
  await setSelection(check('other-note'), true);
  await switchPaper('Paper'); await notesReady();
  await expect(check('n2')).toHaveAttribute('aria-pressed', 'false');
  await setSelection(group('Yellow'), true);
  await expect(check('n2')).toHaveAttribute('aria-pressed', 'true');
  await setSelection(group('Yellow'), false);
  await expect(check('n3')).toHaveAttribute('aria-pressed', 'false');
  await setSelection(all(), true); await setSelection(all(), false);
  await expect(send()).toBeDisabled();
  await prompt().press('Enter'); assert.equal(attempts.length, 0);
  await setSelection(check('n1'), true);
  await expect(send()).toBeEnabled();
  await setSelection(check('n3'), true);
  await expect(send()).toBeEnabled();
  await expect(prompt()).toHaveValue('');
  fail = true; await send().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Try again.' })).toBeVisible();
  assert.deepEqual(notes, original);
  await expect(check('n1')).toHaveAttribute('aria-pressed', 'true'); await expect(check('n3')).toHaveAttribute('aria-pressed', 'true'); await expect(check('n2')).toHaveAttribute('aria-pressed', 'false');
  await expect(instruction('Yellow')).toHaveValue('Explain the reasoning step by step.');
  await page.screenshot({ path: 'test-results/note-selection-desktop.png', fullPage: true, animations: 'disabled' });
  hold = true; await send().click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(all()).toBeDisabled(); await expect(check('n2')).toBeDisabled();
  assert.deepEqual(attempts[1].annotations, ['n1', 'n3']);
  assert.deepEqual(attempts[1].groupInstructions, { yellow: 'Explain the reasoning step by step.' });
  assert.equal(attempts[1].instructions, '');
  assert.equal(attempts[0].id, attempts[1].id, 'Retry the same task after a failure');
  const concurrent = note('n6', 6); notes.push(concurrent); release();
  await expect(page.getByText('Added to task: 0', { exact: true })).toBeVisible();
  assert.deepEqual(notes, [original[1], original[3], original[4], concurrent]);
  assert.equal(sent[0].agent, 'codex');
  await page.locator(`.task-row[data-task="${sent[0].id}"] .task-link`).click();
  await expect(page.locator('.thread .group-instruction-sent')).toHaveText('Explain the reasoning step by step.');
  await page.locator('.manuscript-link').click();
  await page.reload(); await notesReady();
  await expect(instruction('Yellow')).toHaveValue('Explain the reasoning step by step.');
  await expect(instruction('Purple')).toHaveValue('Shorten this wording.');
  await expect(all()).toHaveAttribute('aria-pressed', 'false');
  await expect(check('n6')).toHaveAttribute('aria-pressed', 'false');
  await switchPaper('Other paper'); await expect(check('other-note')).toHaveAttribute('aria-pressed', 'true');
  await switchPaper('Paper'); await notesReady();
  await setSelection(check('n2'), true); await setSelection(check('n4'), true);
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('option', { name: / · Claude$/ }).first().click();
  await page.keyboard.press('Escape');
  await expect(prompt()).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'New task', exact: true }).click();
  await page.screenshot({ path: 'test-results/group-instructions-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.setViewportSize({ width: 1440, height: 900 });
  await send().click();
  await expect(page.getByText('Added to task: 0', { exact: true })).toBeVisible();
  assert.deepEqual(sent[1].annotations, ['n2', 'n4']); assert.equal(sent[1].agent, 'claude');
  assert.deepEqual(sent[1].groupInstructions, { yellow: 'Explain the reasoning step by step.', purple: 'Shorten this wording.' });
  assert.equal(sent[1].instructions, '');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:group-instructions')), null);
  assert.deepEqual(notes, [original[4], concurrent]);
  await expect(all()).toHaveAttribute('aria-pressed', 'false'); await prompt().fill('A question without any annotations.'); await send().click();
  await expect.poll(() => sent.length).toBe(3);
  assert.equal(sent[2].annotations, undefined); assert.deepEqual(notes, [original[4], concurrent]);
  await expect(all()).toHaveAttribute('aria-pressed', 'false');
  // The same controls remain usable without horizontal overflow on phones.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'New task', exact: true }).click();
  await setSelection(check('n6'), true);
  await expect(page.getByText('Added to task: 1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/note-selection-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await expect(prompt()).toHaveValue('');
  await send().click();
  await expect.poll(() => sent.length).toBe(4);
  assert.deepEqual(sent[3].annotations, ['n6']);
  assert.equal(sent[3].instructions, ''); assert.equal(sent[3].groupInstructions, undefined);
  assert.deepEqual(notes, [original[4]]);
  assert.deepEqual(errors, []);
  console.log('PASS: notes default to saved only, explicit selection, direct note sends, inline color-group instructions, persistence, failure/retry, partial sends to different agents, retained group drafts, grouped history, plain questions, and mobile controls.');
} finally { release?.(); await browser.close(); await server.close(); }
