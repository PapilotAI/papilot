import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { readyRequirements } from './required-tools-fixture.mjs';
import { chromium, expect, webkit } from './playwright.mjs';

const server = Fastify();
let browser;
try {
  await server.register(staticFiles, { root: path.resolve('dist') });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const pdf = fs.readFileSync('tests/fixtures/outline.pdf');
  const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
  browser = process.env.PAPILOT_ANNOTATIONS_BROWSER === 'webkit' ? await webkit.launch()
    : await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  fs.mkdirSync('test-results', { recursive: true });

  for (const mobile of [false, true]) {
    const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce', viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
    await page.addInitScript(dark => {
      localStorage.setItem('papilot:language', 'en');
      localStorage.setItem('papilot:theme', dark ? 'dark' : 'light');
    }, mobile);
    const errors = [], calls = [], notes = [], batchRestorations = new Set();
    const project = { id: 'paper', name: 'Paper', path: '/fixture/paper' };
    const state = { version: 'test', projects: [project], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
    const git = { branch: 'main', files: [] };
    const document = 'chapters/manuscript.tex';
    const build = { status: 'ready', key: 'pdf', document, pages: [[612, 792], [612, 792]] };
    const add = (id, fields = {}) => notes.push({ id, projectId: project.id, document, key: 'pdf', page: 0, rect: [0.25, 0.22, 0.35, 0.24], quote: 'Owning passage', source: null, createdAt: notes.length + 1, comment: 'Check the source.', ...fields });
    add('first'); add('yellow', { group: 'yellow', page: 1 }); add('retained', { group: 'purple', key: 'old', agentAnnotation: { taskId: 'agent', request: 'note' } });
    add('copied', { aiReview: { taskId: 'review', agent: 'codex', sourceId: 'suggestion' } });
    const confirmed = notes.map(note => note.id);
    const visible = () => notes.filter(note => !note.deletedBatch);
    let failRetained = !mobile, saving = false, running = false;
    let finishSave, finishClear;
    const saveGate = new Promise(resolve => { finishSave = resolve; });
    const clearGate = new Promise(resolve => { finishClear = resolve; });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
      if (url.pathname === '/api/state') return json(state);
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/files')) return json({ document, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json(git);
      if (url.pathname.endsWith('/manuscript')) return json({ git, build, document, annotations: visible(), noteSections: [
        { id: 'intro', title: 'Introduction', level: 1, notes: visible().map(note => note.id) },
      ] });
      if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
      if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
      if (url.pathname.endsWith('/annotations/first')) {
        saving = true; await saveGate;
        notes[0].comment = route.request().postDataJSON().comment;
        return json(notes[0]);
      }
      if (url.pathname.endsWith('/annotations/clear') || url.pathname.endsWith('/annotations/undo-clear')) {
        const undo = url.pathname.endsWith('/undo-clear'), input = route.request().postDataJSON();
        calls.push({ undo, ...input });
        assert.equal(input.document, document);
        if (!undo) { running = true; await clearGate; }
        const changed = [], failed = [];
        for (const id of input.ids) {
          const note = notes.find(item => item.id === id);
          assert.ok(note, `Unknown annotation ${id}`);
          if (!undo && failRetained && id === 'retained') {
            failed.push({ id, error: 'This note is being sent. Wait for the task to finish creating.' });
            continue;
          }
          if (undo && note.deletedBatch !== undefined) {
            assert.equal(note.deletedBatch, input.batch);
            delete note.deletedBatch;
            batchRestorations.add(id);
          } else if (!undo) note.deletedBatch = input.batch;
          changed.push(id);
        }
        if ((mobile && calls.length === 1) || (!mobile && undo && calls.filter(call => call.undo).length === 1)) return route.abort();
        return json({ changed, ...(undo ? { restoredIds: changed.filter(id => batchRestorations.has(id)) } : {}), failed, annotations: visible() });
      }
      throw Error(`Unexpected fixture request ${url.pathname}`);
    });

    page.on('pageerror', error => errors.push(error.message));
    const library = page.getByRole('complementary', { name: 'PDF note library' });
    const header = library.locator('.pdf-reading-notes-head');
    const trigger = header.getByRole('button', { name: 'Clear all annotations…', exact: true });
    const undo = library.locator('.notes-clear-status').getByRole('button', { name: 'Undo', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Clear all annotations?', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Clear all annotations', exact: true });
    const libraryButton = page.getByRole('button', { name: /^My notes(?: · .+)?$/ });
    const firstMark = page.locator('.note-layer .note-tag[data-note="first"]');
    const reload = () => page.evaluate(() => window.dispatchEvent(new Event('papilot:manuscript')));
    try {
      await page.goto(origin);
      await expect(firstMark).toHaveCount(1);
      await libraryButton.click();
      await expect(library.getByText('Some note positions need confirmation.', { exact: false })).toBeVisible();
      await expect(trigger).toHaveText('');
      await expect(trigger).toHaveAttribute('title', 'Clear all annotations…');
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      if (mobile) await page.setViewportSize({ width: 320, height: 740 });
      const picker = header.getByRole('button', { name: 'Add to task', exact: true });
      const close = header.getByRole('button', { name: 'Close notes', exact: true });
      await expect(picker).toHaveText('Add to task');
      await expect(picker).toHaveAttribute('title', 'Add to task');
      await expect(picker).toHaveAttribute('aria-haspopup', 'menu');
      for (const button of [trigger, picker, close]) await expect(button).toBeInViewport();
      const clearAction = await trigger.boundingBox(), addToTask = await picker.boundingBox(), closeNotes = await close.boundingBox();
      assert.ok(clearAction.width >= (mobile ? 36 : 28) && clearAction.height >= (mobile ? 36 : 28));
      assert.ok(addToTask.width > clearAction.width);
      assert.equal(addToTask.height, clearAction.height);
      assert.ok(clearAction.x + clearAction.width <= addToTask.x && addToTask.x + addToTask.width <= closeNotes.x);
      await page.screenshot({ animations: 'disabled', path: `test-results/clear-annotations-action-${mobile ? 'mobile-dark' : 'desktop-light'}.png` });
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await trigger.focus(); await page.keyboard.press('Enter');
      await expect(dialog).toContainText(document);
      await expect(dialog).toContainText('4 annotations');
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.screenshot({ animations: 'disabled', path: `test-results/clear-annotations-${mobile ? 'mobile-dark' : 'desktop-light'}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
      await trigger.click(); await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      assert.deepEqual(calls, []);

      if (!mobile) {
        await library.getByRole('button', { name: 'Include note 1 in this task' }).click();
        await library.getByRole('button', { name: 'Edit note 1', exact: true }).click();
        const editor = library.getByRole('textbox', { name: 'Edit note 1' });
        await editor.fill('Saved before clear.');
        await expect(trigger).toBeDisabled();
        await editor.press('Enter');
        await expect.poll(() => saving).toBe(true);
        await expect(trigger).toBeDisabled();
        finishSave();
        await expect(trigger).toBeEnabled();
      }

      await trigger.click();
      if (mobile) {
        finishClear();
        await confirm.click();
        await expect(dialog.getByRole('alert')).toContainText('Could not confirm which annotations were cleared.');
        await expect.poll(() => visible().length).toBe(0);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await reload();
        await library.getByRole('button', { name: 'Retry clearing annotations…' }).click();
        await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(dialog).toBeHidden();
        assert.deepEqual(calls[1], calls[0], 'Recover the original batch even after every annotation disappeared');
        await expect(trigger).toBeDisabled();
        await expect(firstMark).toHaveCount(0);
      } else {
        add('newer', { page: 1, comment: 'Added while the confirmation was open.' });
        await reload();
        await expect(page.locator('.pdf-reading-notes [data-note="newer"]')).toHaveCount(1);
        await expect(dialog).toContainText('4 annotations');
        await confirm.click();
        await expect.poll(() => running).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog.getByRole('progressbar', { name: 'Clearing annotations…' })).toBeVisible();
        assert.equal(calls.length, 1);
        finishClear();
        await expect(dialog.getByRole('alert')).toContainText('1 annotation could not be cleared.');
        await expect(firstMark).toHaveCount(0);
        assert.deepEqual(calls[0].ids, confirmed);
        assert.deepEqual(visible().map(note => note.id), ['retained', 'newer']);
        failRetained = false;
        await dialog.getByRole('button', { name: 'Retry' }).click();
        await expect(dialog).toBeHidden();
        assert.deepEqual(calls[1].ids, ['retained']);
        assert.equal(calls[1].batch, calls[0].batch);
        await expect(library.getByText('Added while the confirmation was open.')).toBeVisible();
      }
      await expect(library.getByRole('status').filter({ hasText: '4 annotations cleared.' })).toBeVisible();
      await expect(undo).toBeVisible();
      await page.screenshot({ animations: 'disabled', path: `test-results/clear-annotations-undo-${mobile ? 'mobile-dark' : 'desktop-light'}.png` });
      if (mobile) await undo.tap(); else await undo.press('Enter');
      if (!mobile) {
        await expect.poll(() => calls.filter(call => call.undo).length).toBe(1);
        await expect(undo).toBeEnabled();
        await reload();
        await expect(firstMark).toHaveCount(1);
        await undo.click();
        await expect.poll(() => calls.filter(call => call.undo).length).toBe(2);
        assert.deepEqual(calls.at(-1), calls.at(-2));
      }
      await expect(firstMark).toHaveCount(1);
      await expect(undo).toHaveCount(0);
      await expect(library.locator('[data-note="retained"]')).toHaveCount(1);
      assert.equal(calls.at(-1).batch, calls[0].batch);
      assert.deepEqual([...calls.at(-1).ids].sort(), [...confirmed].sort());
      if (!mobile) {
        await expect(library.getByRole('button', { name: 'Include note 1 in this task' })).toHaveAttribute('aria-pressed', 'true');
        await expect(library.getByText('Saved before clear.')).toBeVisible();
      }
      await page.reload();
      await expect(firstMark).toHaveCount(1);
      await libraryButton.click();
      await expect(library.locator('[data-note="retained"]')).toHaveCount(1);
      assert.deepEqual(errors, []);
    } finally {
      finishSave(); finishClear();
      await page.close();
    }
  }
  console.log('PASS: clearing annotations requires confirmation and keeps the confirmed scope, pending saves, retries and batch undo consistent on desktop and mobile.');
} finally {
  await browser?.close(); await server.close();
}
