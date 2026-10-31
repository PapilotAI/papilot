import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';
import { summarizeNotes } from '../src/notes.ts';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const origin = `http://127.0.0.1:${server.server.address().port}`;
const snapshot = { csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const git = { branch: 'main', files: [] };
let notes = [], deleted = [], serial = 0;
const requests = [], items = new Map();
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'))[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/annotations')) {
    const body = route.request().postDataJSON();
    const note = { ...body, comment: body.comment || '', id: `mark-${++serial}`, projectId: 'paper', source: null, createdAt: serial };
    notes.push(note); return json(note);
  }
  if (url.pathname.endsWith('/delete')) {
    const id = url.pathname.split('/').at(-2), note = notes.find(note => note.id === id);
    deleted.push(note); notes = notes.filter(note => note.id !== id); return json({ ok: true });
  }
  if (url.pathname.endsWith('/restore')) {
    const id = url.pathname.split('/').at(-2); notes.push(deleted.find(note => note.id === id)); notes.sort((a, b) => a.createdAt - b.createdAt); return json({ annotations: notes });
  }
  if (url.pathname === '/api/tasks') {
    const body = route.request().postDataJSON(); requests.push(body);
    const attached = notes.filter(note => body.annotations.includes(note.id));
    const task = { ...body, name: 'groups', status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), review: null };
    snapshot.tasks.push(task); items.set(task.id, [{ id: 'group-request', taskId: task.id, type: 'user', text: body.instructions, meta: { notes: summarizeNotes(attached) }, createdAt: Date.now() }]);
    notes = notes.filter(note => !body.annotations.includes(note.id)); return json(task);
  }
  if (url.pathname.endsWith('/items')) return json({ items: items.get(url.pathname.split('/')[3]) || [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  throw Error(`Unexpected fixture request ${url.pathname}`);
});
const picker = () => page.getByRole('button', { name: 'Annotation group color', exact: true });
async function chooseGroup(name) {
  await picker().click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}
async function selectText(index, automatic = true) {
  const word = page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: /\S/ }).nth(index);
  await word.evaluate((el, automatic) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    if (automatic) el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  }, automatic);
}
try {
  await page.goto(origin);
  await page.locator('.page[data-page-number="1"] .textLayer span').first().waitFor();
  await chooseGroup('Yellow');
  await selectText(0); await expect.poll(() => notes.length).toBe(1);
  await selectText(1); await expect.poll(() => notes.length).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Note for the agent' })).toHaveCount(0);
  await expect(page.locator('.annotation-group')).toHaveCount(1);
  await expect(page.locator('.annotation-group summary')).toContainText('2 locations');
  assert.deepEqual(notes.map(note => [note.group, note.comment]), [['yellow', ''], ['yellow', '']]);
  await page.locator('.pdf-container').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(() => notes.length).toBe(1);
  await selectText(2); await expect.poll(() => notes.length).toBe(2);
  await page.getByRole('button', { name: 'Region note', exact: true }).click();
  const regionBox = await page.locator('.region-capture').first().boundingBox();
  await page.mouse.move(regionBox.x + 60, regionBox.y + 90); await page.mouse.down();
  await page.mouse.move(regionBox.x + 180, regionBox.y + 150, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => notes.length).toBe(3);
  assert.equal(notes.at(-1).group, 'yellow');
  assert.equal(notes.at(-1).rects, undefined);
  await expect(page.getByRole('textbox', { name: 'Note for the agent' })).toHaveCount(0);
  await page.locator('.pdf-container').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(() => notes.length).toBe(2);
  await page.keyboard.press('Escape');
  await chooseGroup('Purple');
  await selectText(3); await expect.poll(() => notes.length).toBe(3);
  await expect(page.locator('.annotation-group')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Start task', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(picker()).not.toHaveAttribute('data-group');
  await page.reload();
  await expect(page.locator('.annotation-group')).toHaveCount(2);
  await expect(page.locator('.note-tag[data-group="yellow"]')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Describe the revision' }).fill('Explain yellow selections. Shorten purple selections.');
  await page.screenshot({ path: 'test-results/note-groups-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator('.annotation-group')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Describe the revision' })).toHaveValue('');
  await page.locator('.task-link').first().click();
  await expect(page.locator('.thread .annotation-group')).toHaveCount(2);
  await expect(page.locator('.notes-request')).toHaveText('Explain yellow selections. Shorten purple selections.');
  await page.locator('.manuscript-link').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page.getByLabel('Page number').fill('1');
  await page.getByLabel('Page number').press('Enter');
  await chooseGroup('Yellow');
  await selectText(0, false);
  await page.getByRole('button', { name: 'Add to Yellow', exact: true }).click();
  await expect.poll(() => notes.length).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Note for the agent' })).toHaveCount(0);
  await chooseGroup('Individual notes');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.locator('.annotation-group')).toBeVisible();
  await page.screenshot({ path: 'test-results/note-groups-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
  console.log('PASS: Continuous same-color marking, groups, undo, neutral colors, persistence, grouped messages, stay in manuscript, and mobile marking.');
} finally { await browser.close(); await server.close(); }
