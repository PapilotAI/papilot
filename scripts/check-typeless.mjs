import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { dragPdfText } from './pdf-selection-fixture.mjs';

// Exercise the built UI with a deterministic desktop bridge; no microphone is used.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const origin = `http://127.0.0.1:${server.server.address().port}`;
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const git = { branch: 'main', files: [] };
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const notes = [], created = [];
let serial = 0;
fs.mkdirSync('test-results', { recursive: true });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/updates') return json({ currentVersion: snapshot.version, latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: true });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes });
  if (url.pathname.endsWith('/manuscript.pdf')) {
    return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  }
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/annotations')) {
    const body = route.request().postDataJSON();
    created.push(body);
    const note = { ...body, quote: body.quote || '', comment: body.comment || '', id: `note-${++serial}`, projectId: 'paper', source: null, createdAt: serial };
    notes.push(note); return json(note);
  }
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  return json({});
});
const rail = () => page.getByRole('toolbar', { name: 'Marking tools' });
const textOnPage = () => page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: /\S/ });
async function selectText(index) {
  await dragPdfText(page, textOnPage().nth(index));
}
await page.addInitScript(() => {
  localStorage.setItem('papilot:language', 'en');
  localStorage.setItem('papilot:setup-seen', '1');
  window.typelessFixture = { calls: [], status: 'ready', shortcut: 'Fn', delayed: false };
  window.papilotDesktop = {
    platform: 'darwin',
    typelessStatus: async () => ({ status: window.typelessFixture.status, shortcut: window.typelessFixture.shortcut }),
    typelessShortcut: async inputId => {
      const fixture = window.typelessFixture;
      fixture.calls.push({ inputId, focused: document.activeElement?.id === inputId, shortcut: fixture.shortcut });
      if (fixture.delayed) await new Promise(resolve => { fixture.release = resolve; });
      return { status: fixture.status === 'ready' ? 'sent' : fixture.status, shortcut: fixture.shortcut };
    },
  };
});
const card = page.getByRole('dialog', { name: /^PDF note/ }), input = card.getByRole('textbox');
const microphone = card.getByRole('button', { name: 'Toggle dictation' });
const calls = () => page.evaluate(() => window.typelessFixture.calls);
const openSettings = async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.settings-link').click();
  await page.locator('[data-settings-page="experiments"]').click();
};
try {
  await page.goto(origin);
  await textOnPage().first().waitFor();
  await rail().getByRole('button', { name: 'Note', exact: true }).click();
  await selectText(0);
  await expect(input).toBeFocused();
  await expect(microphone).toHaveCount(0);
  assert.equal((await calls()).length, 0, 'Off by default');
  await input.press('Escape');
  await openSettings();
  const toggle = page.getByRole('switch', { name: 'Typeless voice notes' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.screenshot({ path: 'test-results/typeless-settings-light.png', animations: 'disabled' });
  await page.locator('.settings-dialog .modal-close').click();
  await selectText(1);
  await expect.poll(async () => (await calls()).length).toBe(1);
  await expect(input).toBeFocused();
  await input.fill('Existing draft. ');
  assert.equal((await calls()).length, 1, 'Typing does not repeat auto-start');

  // Slow delivery: double clicks and leaked Enter/Escape cannot submit or
  // dismiss the editor; the eventual paste remains an ordinary draft edit.
  await page.evaluate(() => { window.typelessFixture.shortcut = 'LeftCtrl+F8'; window.typelessFixture.delayed = true; });
  await microphone.dblclick();
  await expect.poll(async () => (await calls()).length).toBe(2);
  await expect(microphone).toHaveAttribute('aria-busy', 'true');
  await expect(microphone.locator('.spinner')).toBeVisible();
  await expect(card.locator('.typeless-note-status:not(.sr-only)')).toHaveCount(0);
  await input.press('Enter');
  await input.press('Escape');
  await page.locator('.settings-link').dispatchEvent('click');
  await expect(card).toBeVisible();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  assert.equal(created.length, 0, 'Sending a shortcut never submits the draft');
  // Freeze the brief feedback while capturing it, even on a busy test host.
  await page.clock.install({ time: new Date('2026-11-19T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-19T01:00:00Z'));
  await card.screenshot({ path: 'test-results/typeless-note-sending.png', animations: 'disabled' });
  await page.evaluate(() => { window.typelessFixture.release(); window.typelessFixture.delayed = false; });
  await expect(microphone).toBeEnabled();
  await expect(microphone).toHaveAttribute('data-state', 'sent');
  await expect(microphone).not.toHaveAttribute('aria-pressed');
  await expect(card.getByRole('status')).toHaveClass(/sr-only/);
  await card.screenshot({ path: 'test-results/typeless-note-success.png', animations: 'disabled' });
  await page.clock.resume();
  await expect(input).toBeFocused();
  await input.press('End');
  await page.keyboard.insertText('Dictated text.');
  await expect(input).toHaveValue('Existing draft. Dictated text.');
  assert.equal(created.length, 0, 'A delayed transcript does not submit');
  assert.ok((await calls()).every(call => call.focused));
  assert.equal((await calls())[1].shortcut, 'LeftCtrl+F8');
  await expect(microphone).toHaveAttribute('data-state', 'idle');
  await expect(card.getByRole('status')).toBeEmpty();
  await page.screenshot({ path: 'test-results/typeless-note-light.png', animations: 'disabled' });

  await page.evaluate(() => { window.typelessFixture.status = 'permission'; });
  await microphone.click();
  await expect(card.getByRole('status')).toContainText('Accessibility');
  await expect(input).toHaveValue('Existing draft. Dictated text.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: 'test-results/typeless-note-error-dark.png', animations: 'disabled' });
  await page.evaluate(() => { window.typelessFixture.status = 'ready'; });
  await microphone.click();
  await expect(card.getByRole('status')).toContainText('LeftCtrl+F8 sent');
  await expect(card.getByRole('status')).toHaveClass(/sr-only/);
  await expect(card.locator('.typeless-note-status:not(.sr-only)')).toHaveCount(0);
  await expect(microphone).toHaveAttribute('data-state', 'idle');
  await page.screenshot({ path: 'test-results/typeless-note-recovered-dark.png', animations: 'disabled' });
  const beforeClose = (await calls()).length;
  await input.press('Escape');
  await expect(card).toHaveCount(0);
  assert.equal((await calls()).length, beforeClose, 'Dismissal never guesses a stop toggle');
  await openSettings();
  await page.evaluate(() => { window.typelessFixture.status = 'shortcut-unavailable'; });
  await page.locator('.typeless-experiment').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(toggle).toBeEnabled();
  await toggle.uncheck();
  await expect(toggle).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: 'test-results/typeless-settings-narrow-dark.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('Typeless opt-in, focused shortcut delivery, repeated clicks, paste, failure/recovery and no auto-submit verified.');
} finally {
  await browser.close();
  await server.close();
}
