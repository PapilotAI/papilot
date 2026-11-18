import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { PdfReader } from '../src/server/pdf-reader.ts';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const reader = new PdfReader();
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const origin = `http://127.0.0.1:${server.server.address().port}`;
const model = { id: 'writer-test', name: 'Writer test', isDefault: true, efforts: [], defaultEffort: null };
const runtime = { connected: true, authenticated: true, models: [] }, writer = { ...runtime, models: [model] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [], requests: [], runtime, runtimes: { codex: runtime, claude: runtime, papilot: writer } };
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
function note(id, page, top, group) {
  return { id, projectId: 'paper', key: 'pdf', page, rect: [0.25, top, 0.45, top + 0.01], quote: 'Selected passage', comment: `Revise ${id}.`, ...(group ? { group } : {}), source: null, createdAt: 1 };
}
const notes = [note('outside', 0, 0.3), note('parent', 1, 0.17), note('child-a', 1, 0.3, 'yellow'), note('child-b', 1, 0.4, 'purple'), { ...note('stale', 1, 0.5), key: 'old' }];
const scope = await reader.sections({ pdf: path.resolve('tests/fixtures/outline.pdf'), root: path.resolve('tests/fixtures'), sourceDir: '' }, 'pdf', notes);
assert.deepEqual(scope.sections.map(section => section.notes), [['outside'], ['parent', 'child-a', 'child-b'], ['child-a', 'child-b']]);
const sent = [];
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json({ branch: 'main', files: [] });
  if (url.pathname.endsWith('/git/history')) return json({ versions: [], next: null });
  if (url.pathname.endsWith('/git/overview')) return json({ worktrees: [], commits: [], truncated: false });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes, noteSections: scope.sections, unplacedSectionNotes: scope.unplaced });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname === '/api/tasks') {
    const body = route.request().postDataJSON(); sent.push(body);
    const task = { ...body, name: body.id, title: body.title, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), review: null };
    snapshot.tasks.push(task); return json(task);
  }
  throw Error(`Unexpected request ${url.pathname}`);
});
const openNotes = async () => {
  if (!await page.getByRole('complementary', { name: 'PDF note library' }).isVisible()) await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();
};
const included = id => page.locator(`.new-task-panel [data-note="${id}"]`);
const pick = () => page.getByRole('button', { name: 'Add to task', exact: true });
const menu = () => page.getByRole('menu', { name: 'Add to task', exact: true });
const section = name => menu().getByRole('menuitem', { name, exact: true });
try {
  await page.addInitScript(() => {
    localStorage.setItem('papilot:selected-notes', JSON.stringify({ paper: ['outside', 'child-a'] }));
  });
  await page.goto(origin);
  await openNotes();
  await expect(menu()).not.toBeVisible();
  await pick().click();
  await expect(section('Method')).toHaveAttribute('title', 'Includes subsections · 1 of 3 selected');
  await section('Method').click();
  for (const id of ['outside', 'parent', 'child-a', 'child-b']) await expect(included(id)).toHaveCount(1);
  await expect(included('stale')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'PDF note library' })).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'New task', exact: true })).toBeFocused();
  await openNotes(); await pick().click();
  await expect(section('Method')).toHaveAttribute('title', 'Includes subsections · 3 of 3 selected');
  await expect(section('Method')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(pick()).toBeFocused();
  assert.equal(sent.length, 0, 'Selecting comments never submits a task');
  // Individual removals remain possible; selecting a child restores only
  // that subtree and leaves the independently selected outside note intact.
  await page.getByRole('button', { name: 'Close notes', exact: true }).click();
  for (const id of ['parent', 'child-b']) await included(id).getByRole('button', { name: /^Remove (?:note|suggestion) / }).click();
  await openNotes();
  await pick().focus(); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(included('outside')).toHaveCount(1);
  await expect(included('parent')).toHaveCount(0);
  await expect(included('child-a')).toHaveCount(1);
  await expect(included('child-b')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'PDF note library' })).not.toBeVisible();
  assert.equal(sent.length, 0);
  // The menu only occupies space when asked and fits a phone as a bottom sheet.
  fs.mkdirSync('test-results', { recursive: true });
  await openNotes(); await pick().click();
  await expect(section('Results')).toBeDisabled();
  await page.screenshot({ path: 'test-results/section-comments-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Manuscript view', exact: true }).getByRole('button', { name: 'PDF', exact: true }).click();
  await openNotes();
  await expect(pick()).toBeVisible();
  await pick().click();
  assert.ok(await menu().evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
  }));
  await page.screenshot({ path: 'test-results/section-comments-mobile.png', animations: 'disabled' });
  await section('Method').click();
  await expect(page.getByRole('complementary', { name: 'PDF note library' })).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Describe the revision', exact: true })).toBeVisible();
  await included('parent').getByRole('button', { name: /^Remove (?:note|suggestion) / }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('textbox', { name: 'Describe the revision', exact: true }).fill('Improve these comments together.');
  // Choose Papilot Writer using the normal composer model picker.
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('option', { name: /Writer test.*Papilot Writer/ }).last().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  assert.deepEqual([...sent[0].annotations].sort(), ['child-a', 'child-b', 'outside']);
  assert.equal(sent[0].agent, 'papilot');
  assert.equal(sent[0].instructions, 'Improve these comments together.');
  assert.deepEqual(errors, []);
  console.log('Section comment selection passed (hierarchy, groups, additive selection, mobile, Writer).');
} catch (error) { console.error(errors); console.error(await page.locator('body').innerText()); throw error; } finally { await browser.close(); await reader.stop(); await server.close(); }
