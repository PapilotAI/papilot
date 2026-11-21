import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { rewriteReviewHtml } from '../src/server/review.ts';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
let previewHandler;
// Use real HTTP/1.1 for previews: route.fulfill cannot expose connection starvation.
server.get('/api/tasks/:id/note-options/preview', (request, reply) => previewHandler(new URL(request.url, 'http://fixture'), reply));
server.post('/preview-connection-probe', async () => ({ ok: true }));
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 }, hasTouch: width <= 390, isMobile: width <= 390 });
    page.setDefaultTimeout(15000);
    const errors = [], writes = [], previews = [], undone = new Set();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('papilot:language', 'en'); localStorage.setItem('papilot:task', 'task'); });
    const task = { id: 'task', projectId: 'paper', name: 'flow', title: 'Review note choices', status: 'reviewing', createdAt: 1, updatedAt: 1, review: { round: 1, state: 'reviewing', counts: { pending: 3 } } };
    const noteUnits = ['a', 'a', 'b', 'c'];
    const annotations = noteUnits.map((unit, index) => ({ id: `note-${index}`, where: `main.tex line ${index + 1}`, quote: `Old ${unit}`, comment: `Improve note ${index + 1}.` }));
    const items = [{ id: 'run', taskId: 'task', type: 'user', text: '', createdAt: 1, meta: { notes: annotations } }];
    const decisions = { a: 'pending', b: 'pending', c: 'pending' }, selected = { a: 'current', b: 'current', c: 'current' };
    const strip = (unit, text) => {
      const src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="36"><rect width="600" height="36" fill="white"/><text x="12" y="24" font-size="18">${text}</text></svg>`);
      return { src, clean: src, width: 600, height: 36, page: 1, label: '1', text: [{ text, chars: Array.from(text, (text, index) => ({ text, rect: [12 + index * 9, 8, 21 + index * 9, 28] })) }], marks: [{ unit, kind: 'added', rect: [12, 8, 220, 28] }] };
    };
    let version = 1, failPreview = false, latePreview = null, saveFails = false, pendingBuild = null;
    let releaseBaseline, releaseAlternative, releaseLate = () => {};
    const baselineGate = new Promise(resolve => { releaseBaseline = resolve; });
    const alternativeGate = new Promise(resolve => { releaseAlternative = resolve; });
    const changed = () => { task.updatedAt++; task.review.counts.pending = Object.values(decisions).filter(state => state === 'pending').length; };
    const notes = () => noteUnits.map((unit, index) => ({ key: `run:${index}`, itemId: 'run', index, note: annotations[index], round: task.review.round, state: 'matched', returned: false, changes: [{ round: task.review.round, stop: ['a', 'b', 'c'].indexOf(unit), units: [unit], state: decisions[unit], match: 'source' }] }));
    const detail = (unit, option) => ({ task: 'flow', round: task.review.round, before: 'before', after: `${unit}-${option}-v${version}`, files: '', warnings: [], sections: [],
      units: ['a', 'b', 'c'].map((id, index) => ({ id, file: 'main.tex', kind: 'text', old_start: index + 1, old_end: index + 1, new_start: index + 1, new_end: index + 1, old_text: `Old ${id}`, new_text: `${id === unit ? option : selected[id]} ${id}` })),
      loose: ['a', 'b', 'c'].map(id => ({ kind: 'change', units: [id], before: [strip(id, `Old ${id}`)], after: [strip(id, `${id === unit ? option : selected[id]} ${id}`)] })) });
    const options = key => {
      const unit = noteUnits[Number(key.split(':')[1])];
      return { key, round: task.review.round, comparisonKey: `v${version}`, selected: selected[unit],
        ...(decisions[unit] !== 'pending' ? { locked: 'This note includes a reviewed change. Undo that decision before replacing it.' } : {}),
        options: [{ id: 'current', label: `Original ${unit}`, reason: 'Keep the original proposal.', edits: [{ unit, text: `current ${unit}` }] },
          { id: 'alternative', label: `Alternative ${unit}`, reason: 'Use the alternative wording.', edits: [{ unit, text: `alternative ${unit}` }] },
          ...(unit === 'a' ? Array.from({ length: 5 }, (_, i) => ({ id: `extra-${i}`, label: `Extra ${i}`, reason: 'Another wording.', edits: [{ unit, text: `extra ${i}` }] })) : [])] };
    };
    previewHandler = async (url, reply) => {
      const unit = noteUnits[Number(url.searchParams.get('key').split(':')[1])], option = url.searchParams.get('option');
      const result = detail(unit, option); previews.push({ unit, option, version, background: url.searchParams.get('background') === '1' });
      if (version === 1 && unit === 'a') await (option === 'current' ? baselineGate : alternativeGate);
      if (unit === 'a' && option === 'alternative') {
        if (latePreview) { const wait = latePreview; latePreview = null; await wait; return reply.code(503).send({ error: 'Late preview failure' }); }
        if (failPreview && url.searchParams.get('retry') !== '1') return reply.code(503).send({ error: 'fetch failed' });
      }
      return reply.send(result);
    };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
      if (url.pathname.startsWith('/review/')) return route.fallback();
      if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { annotations: [], build: { status: 'idle' }, git: { files: [] } } });
      if (/\/api\/tasks\/[^/]+\/pdf$/.test(url.pathname)) {
        if (url.searchParams.get('metadata') === '1') return route.fulfill({ json: { url: `${url.pathname}?round=${url.searchParams.get('round')}&build=fixture` } });
        return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
      }
      if (url.pathname === '/api/state') return json({ version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/fixture/paper' }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true });
      if (url.pathname.endsWith('/items')) return json({ items });
      if (url.pathname.endsWith('/note-results')) return json({ notes: notes() });
      if (url.pathname.endsWith('/note-options/preview')) return route.continue();
      if (url.pathname.endsWith('/note-options')) {
        if (route.request().method() === 'GET') return json(options(url.searchParams.get('key')));
        const body = route.request().postDataJSON(), unit = noteUnits[Number(body.key.split(':')[1])]; writes.push(body);
        if (undone.has(body.id)) return route.fulfill({ status: 400, json: { error: 'That decision was undone or failed. Make it again.' } });
        if (saveFails) return route.fulfill({ status: 400, json: { error: 'The source changed. Try again.' } });
        if (body.accept && body.option !== selected[unit]) { pendingBuild = { unit, option: body.option }; task.status = 'building'; changed(); return json({ building: true }); }
        decisions[unit] = body.accept ? 'accepted' : 'rejected'; changed(); return json(options(body.key));
      }
      if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const css = fs.readFileSync('engine/src/web/style.css', 'utf8');
    await page.route('**/review/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/rounds/')) return route.fulfill({ json: detail('a', selected.a) });
      const html = `<html><head><style>${css}.change{min-height:220px}</style></head><body><header class="bar"></header><div class="review-body"><main id="paper"><div class="document"><div class="sheet">${['a', 'b', 'c'].map((unit, index) => `<article class="change" data-stop="${index}" data-units="${unit}" data-state="${decisions[unit]}" tabindex="-1"><header class="change-head"><span class="change-number">Change ${index + 1}</span></header><p>Old ${unit}</p><p>${selected[unit]} ${unit}</p></article>`).join('')}</div></div></main></div><script>fetch('/api/tasks/flow/rounds/${task.review.round}');</script></body></html>`;
      return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(html, '/review/paper') });
    });
    const frame = () => page.frameLocator('.review-frame'), drawer = page.locator('.review-note-controls[data-open="true"]');
    const sync = () => expect.poll(() => page.evaluate(() => {
      // The review round can replace the iframe. Resolve its current window
      // in the parent context and wait until the host has attached listeners.
      const current = document.querySelector('.review-frame');
      const doc = current?.contentDocument, view = current?.contentWindow;
      if (!view || !doc?.querySelector('#paper') || !doc.querySelector('#papilot-embed-style')) return false;
      view.dispatchEvent(new view.Event('papilot:review:decided'));
      return true;
    }), { timeout: 15000 }).toBe(true);
    const tab = name => drawer.getByRole('tab', { name, exact: true });
    const comparison = revision => drawer.locator(`.note-option-comparison[data-revision="${revision}"]`);
    try {
      await page.goto(origin);
      await frame().getByRole('button', { name: 'Show note 1: Improve note 1.', exact: true }).click();
      await expect.poll(() => previews.some(request => request.unit === 'a' && request.option === 'alternative' && request.background)).toBe(true);
      assert.equal(await comparison('a-current-v1').count(), 0, 'Alternatives start before the baseline response is available');
      assert.deepEqual(await page.evaluate(() => fetch('/preview-connection-probe', { method: 'POST', signal: AbortSignal.timeout(10000) }).then(response => response.json())), { ok: true }, 'A write reaches the server while optional previews are pending');
      assert.equal(previews.filter(request => request.background).length, 1, 'Only one of six alternatives occupies a connection');
      releaseBaseline();
      await expect(comparison('a-current-v1')).toBeVisible();
      const toolbar = drawer.locator('.note-option-navigation');
      const returnNote = toolbar.getByRole('button', { name: 'Return to My notes', exact: true });
      await expect(returnNote).toBeVisible();
      const targetSize = width <= 390 ? 36 : 24;
      const [action, tabs, pager, choices, header] = await Promise.all([
        returnNote.boundingBox(), toolbar.getByRole('tablist').boundingBox(),
        toolbar.locator('.review-note-pager').boundingBox(), toolbar.locator('.note-option-actions').boundingBox(), toolbar.boundingBox(),
      ]);
      const center = rect => rect.y + rect.height / 2;
      assert.ok(action.width >= targetSize && action.height >= targetSize, 'the inline action keeps its input target size');
      assert.ok(Math.abs(center(tabs) - center(action)) < 1, 'the return icon shares an existing toolbar row');
      assert.ok(Math.abs(center(pager) - center(choices)) < 1, 'the pager and review actions share a row');
      assert.ok(choices.x + choices.width <= header.x + header.width, 'review actions stay inside the toolbar');
      // Selected segments must rise above their groove in both themes, including
      // the host's scope switch beside the embedded viewer's controls.
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        for (const segment of [tab('Original a'), page.locator('.note-review-scope button[aria-pressed="true"]')]) {
          await expect.poll(() => segment.evaluate(element => {
            const lightness = color => color.match(/[\d.]+/g).slice(0, 3).reduce((sum, value, index) => sum + Number(value) * [0.2126, 0.7152, 0.0722][index], 0);
            return lightness(getComputedStyle(element).backgroundColor) > lightness(getComputedStyle(element.parentElement).backgroundColor);
          })).toBe(true);
        }
        await page.screenshot({ path: `test-results/note-options-selected-${colorScheme}-${width}.png` });
      }
      if (width <= 390) {
        await drawer.getByRole('button', { name: 'Comment on Original a', exact: true }).click();
        const comment = drawer.getByRole('textbox', { name: 'Comment on Original a', exact: true });
        await expect(comment).toBeVisible();
        assert.ok(await comment.evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16), 'touch comments must not trigger focus zoom');
        const close = drawer.getByRole('button', { name: 'Close comment', exact: true });
        const target = await close.boundingBox();
        assert.ok(target.width >= 44 && target.height >= 44, 'comment dismissal needs a finger-sized target');
        assert.ok(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth), 'comment controls must fit narrow drawers');
        await comment.fill('Keep the original wording.');
        await page.screenshot({ path: `test-results/note-options-comment-${width}.png` });
        await close.click();
        await expect(comment).toBeHidden();
        await drawer.getByRole('button', { name: 'Comment on Original a', exact: true }).click();
        await expect(comment).toHaveValue('Keep the original wording.');
        await close.click();
      }
      // A detailed strip lays each line's glyphs out in a row over its image.
      await expect.poll(() => comparison('a-current-v1').locator('.pdf-line-run').first().evaluate(run => {
        const [first, second] = [...run.children].map(glyph => glyph.getBoundingClientRect());
        return getComputedStyle(run).position === 'absolute' && second.left > first.left;
      })).toBe(true);
      await tab('Alternative a').click();
      await expect.poll(() => previews.filter(request => request.unit === 'a' && request.option === 'alternative' && !request.background).length).toBe(1);
      await expect(drawer.locator('.note-option-tab[aria-selected="true"] .spinner')).toBeVisible();
      releaseAlternative();
      await expect(comparison('a-alternative-v1')).toBeVisible();
      const selectedReads = () => previews.filter(request => request.unit === 'a' && ['current', 'alternative'].includes(request.option)).length;
      const preparedRequests = selectedReads();
      const switchStart = performance.now();
      await tab('Original a').click(); await expect(comparison('a-current-v1')).toBeVisible();
      await tab('Alternative a').click(); await expect(comparison('a-alternative-v1')).toBeVisible();
      assert.equal(selectedReads(), preparedRequests, 'Repeated selection uses decoded comparisons without any request');
      console.log(`${width}px: two cached tab switches displayed in ${Math.round(performance.now() - switchStart)} ms (including browser automation)`);
      await tab('Original a').click();
      failPreview = true; version++; changed(); await sync();
      await expect(comparison('a-current-v2')).toBeVisible();
      await tab('Alternative a').click();
      await expect(drawer.getByRole('alert')).toBeVisible();
      await expect(drawer.locator('.note-option-comparison')).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: 'Accept Alternative a', exact: true })).toBeDisabled();
      await drawer.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(comparison('a-alternative-v2')).toBeVisible();
      await expect(comparison('a-alternative-v2').locator('.note-comparison-side.after')).toContainText('alternative a');
      await expect(drawer.getByRole('alert')).toHaveCount(0);
      assert.equal(writes.length, 0, 'switching and retrying previews never saves a choice');

      failPreview = false; await tab('Original a').click();
      latePreview = new Promise(resolve => { releaseLate = resolve; });
      version++; changed(); await sync();
      await expect(comparison('a-current-v3')).toBeVisible();
      await expect.poll(() => previews.some(request => request.unit === 'a' && request.option === 'alternative' && request.version === 3)).toBe(true);
      await tab('Alternative a').click();
      // While it loads, only the previous comparison keeps its place: dimmed,
      // inert and hidden from assistive technology, never as this option's.
      await expect(drawer.locator('.note-option-comparison:not([data-stale])')).toHaveCount(0);
      await expect(drawer.locator('.note-option-comparison[data-stale][inert][aria-hidden="true"]')).toHaveCount(1);
      await expect(drawer.getByRole('button', { name: 'Accept Alternative a', exact: true })).toBeDisabled();
      await tab('Original a').click(); releaseLate();
      await expect(comparison('a-current-v3')).toBeVisible();
      await expect(drawer.getByRole('alert')).toHaveCount(0);
      await drawer.getByRole('button', { name: 'Accept Original a', exact: true }).click();
      await expect(drawer.locator('.review-note-position')).toHaveText('Note 3 / 4');
      await expect(comparison('b-current-v3')).toBeVisible();
      assert.equal(decisions.a, 'accepted', 'shared notes are skipped only after confirmed acceptance');

      await tab('Alternative b').click();
      await expect(comparison('b-alternative-v3')).toBeVisible();
      await drawer.getByRole('button', { name: 'Accept Alternative b', exact: true }).click();
      await expect.poll(() => pendingBuild?.unit).toBe('b');
      await sync();
      await expect(drawer.locator('.review-note-position')).toHaveText('Note 3 / 4');
      selected.b = pendingBuild.option; decisions.b = 'accepted'; pendingBuild = null;
      task.status = 'reviewing'; task.review.round++; version++; changed(); await sync();
      await expect(drawer.locator('.review-note-position')).toHaveText('Note 4 / 4');
      await expect(comparison('c-current-v4')).toBeVisible();

      saveFails = true;
      await drawer.getByRole('button', { name: 'Reject Original c', exact: true }).click();
      await expect(drawer.getByRole('alert')).toContainText('The source changed');
      await expect(drawer.locator('.review-note-position')).toHaveText('Note 4 / 4');
      assert.equal(decisions.c, 'pending');
      saveFails = false;
      await drawer.getByRole('button', { name: 'Reject Original c', exact: true }).click();
      await expect.poll(() => decisions.c).toBe('rejected');
      await expect(drawer.locator('.review-note-position')).toHaveText('Note 4 / 4');
      await expect(drawer.getByRole('button', { name: 'Accept Original c', exact: true })).toBeDisabled();
      assert.equal(writes.at(-1).id, writes.at(-2).id, 'a failed decision keeps its retry identity');
      // The final drawer stays mounted. An undo elsewhere must permit a new
      // decision, while an unconfirmed retry above keeps the original ID.
      for (const action of ['reject', 'accept', 'accept']) {
        const previous = writes.at(-1).id;
        undone.add(previous); decisions.c = 'pending'; version++; changed(); await sync();
        const button = drawer.getByRole('button', { name: `${action === 'accept' ? 'Accept' : 'Reject'} Original c`, exact: true });
        await expect(button).toBeEnabled(); await button.click();
        await expect.poll(() => decisions.c).toBe(action === 'accept' ? 'accepted' : 'rejected');
        assert.notEqual(writes.at(-1).id, previous, 'a confirmed decision retires its request identity before undo');
        await expect(drawer.locator('.review-note-position')).toHaveText('Note 4 / 4');
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `test-results/note-options-flow-${width}.png` });
      console.log(`PASS ${width}px: preview failure/retry, stale response isolation, confirmed acceptance, shared-note skipping, asynchronous alternative save, final drawer retention and decisions after undo`);
    } catch (error) {
      releaseBaseline(); releaseAlternative();
      await page.screenshot({ path: `test-results/note-options-flow-error-${width}.png` });
      throw error;
    } finally { releaseBaseline(); releaseAlternative(); releaseLate(); await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
