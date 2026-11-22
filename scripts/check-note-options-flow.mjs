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
      return { src, clean: src, width: 600, height: 36, page: 1, label: '1', text: [{ text, chars: Array.from(text, (ch, index) => ({ text: ch, rect: [12 + index * 9, 8, 21 + index * 9, 28] })) }], marks: [{ unit, kind: 'added', rect: [12, 8, 220, 28] }] };
    };
    let version = 1, failPreview = false, latePreview = null, saveFails = false, pendingBuild = null;
    let releaseAlternative, releaseLate = () => {};
    const alternativeGate = new Promise(resolve => { releaseAlternative = resolve; });
    const changed = () => { task.updatedAt++; task.review.counts.pending = Object.values(decisions).filter(state => state === 'pending').length; };
    const returned = new Set();
    const notes = () => noteUnits.map((unit, index) => ({ key: `run:${index}`, itemId: 'run', index, note: annotations[index], round: task.review.round, state: 'matched', returned: returned.has(index), undoReturnAt: returned.has(index) ? 1 : undefined, changes: [{ round: task.review.round, stop: ['a', 'b', 'c'].indexOf(unit), units: [unit], state: decisions[unit], match: 'source' }] }));
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
      const key = url.searchParams.get('key'), unit = noteUnits[Number(key.split(':')[1])], option = url.searchParams.get('option');
      const result = detail(unit, option); previews.push({ key, unit, option, version, background: url.searchParams.get('background') === '1' });
      if (version === 1 && unit === 'a' && option === 'alternative') await alternativeGate;
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
      if (url.pathname.endsWith('/undo-return')) {
        const index = annotations.findIndex(note => url.pathname.endsWith('/' + note.id + '/undo-return'));
        assert.ok(returned.delete(index));
        return json({ returned: false, removed: 'returned-' + index });
      }
      if (url.pathname.endsWith('/items')) return json({ items });
      if (url.pathname.endsWith('/note-results')) return json({ notes: notes() });
      if (url.pathname.endsWith('/note-options/preview')) return route.continue();
      if (url.pathname.endsWith('/note-options')) {
        if (route.request().method() === 'GET') return json(options(url.searchParams.get('key')));
        const body = route.request().postDataJSON(), unit = noteUnits[Number(body.key.split(':')[1])]; writes.push(body);
        if (undone.has(body.id)) return route.fulfill({ status: 400, json: { error: 'That decision was undone or failed. Make it again.' } });
        if (saveFails) return route.fulfill({ status: 400, json: { error: 'The source changed. Try again.' } });
        if (body.accept && body.option !== selected[unit]) { pendingBuild = { unit, option: body.option }; task.status = 'building'; changed(); return json({ building: true }); }
        decisions[unit] = body.accept ? 'accepted' : 'rejected'; changed();
        if (body.reject) returned.add(Number(body.key.split(':')[1]));
        return json({ ...options(body.key), ...(body.reject ? { noteReturn: { returned: true, undoReturnAt: 1 } } : {}) });
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
      const html = `<html><head><style>${css}.change{min-height:180px}.change:not(.current) .dock{display:none!important}</style></head><body><header class="bar"></header><div class="review-body"><main id="paper"><div class="document"><div class="sheet">${['a', 'b', 'c'].map((unit, index) => `<article class="change${index === 0 ? ' current' : ''}" data-stop="${index}" data-units="${unit}" data-state="${decisions[unit]}" tabindex="-1"><header class="change-head"><span class="change-number">Change ${index + 1}</span><div class="dock"><nav class="actions"><button class="accept" type="button" data-action="accept">Accept</button><button class="reject" type="button" data-action="reject">Reject</button><button class="comment" type="button" data-action="comment">Comment</button></nav></div></header><p class="fixture-before">Old ${unit}</p><p class="fixture-after">${selected[unit]} ${unit}</p></article>`).join('')}</div></div></main></div><script>
        let preview = null;
        const setCurrent = stop => {
          document.querySelectorAll('.change[data-stop]').forEach(el => el.classList.toggle('current', Number(el.dataset.stop) === stop));
        };
        document.querySelectorAll('.change[data-stop]').forEach(article => {
          const stop = Number(article.dataset.stop);
          article.addEventListener('click', () => setCurrent(stop));
          article.querySelectorAll('.actions button').forEach(btn => {
            btn.addEventListener('click', event => {
              event.stopPropagation();
              if (preview && preview.key) {
                window.dispatchEvent(new CustomEvent('papilot:option-action', { detail: { key: preview.key, action: btn.dataset.action } }));
              }
            });
          });
        });
        window.addEventListener('papilot:select-unit', event => {
          const stop = event.detail && event.detail.stop;
          if (Number.isInteger(stop)) setCurrent(stop);
        });
        window.addEventListener('papilot:option-preview', event => {
          preview = event.detail || null;
          document.querySelectorAll('.change[data-stop]').forEach(article => {
            const units = (article.dataset.units || '').split(' ');
            const matches = preview && (!preview.units || !preview.units.length || units.some(u => preview.units.includes(u)));
            if (matches && preview.detail) {
              article.dataset.previewRevision = preview.detail.after;
              const u = preview.detail.units.find(x => units.includes(x.id));
              if (u) article.querySelector('.fixture-after').textContent = u.new_text;
            } else {
              delete article.dataset.previewRevision;
            }
            const acceptBtn = article.querySelector('button.accept');
            if (acceptBtn) acceptBtn.disabled = Boolean(matches && (preview.busy || !preview.detail));
          });
        });
        fetch('/api/tasks/flow/rounds/${task.review.round}').then(() => {
          document.documentElement.dataset.papilotRound = '${task.review.round}';
          window.dispatchEvent(new Event('papilot:round'));
        });
      </script></body></html>`;
      return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(html, '/review/paper') });
    });
    const frame = () => page.frameLocator('.review-frame');
    const card = stop => frame().locator(`.change[data-stop="${stop}"]`);
    const noteBar = (stop, key) => card(stop).locator(`.papilot-inline-note[data-note-key="${key}"]`);
    const tab = (stop, key, name) => noteBar(stop, key).getByRole('tab', { name, exact: true });
    const sync = () => expect.poll(() => page.evaluate((currentRound) => {
      const current = document.querySelector('.review-frame');
      const doc = current?.contentDocument, view = current?.contentWindow;
      if (!view || !doc?.querySelector('#paper') || !doc.querySelector('#papilot-embed-style')) return false;
      doc.documentElement.dataset.papilotRound = String(currentRound);
      view.dispatchEvent(new view.Event('papilot:round'));
      view.dispatchEvent(new view.Event('papilot:review:decided'));
      return true;
    }, task.review.round), { timeout: 15000 }).toBe(true);
    try {
      await page.goto(origin);
      // No bottom drawer or redundant scope switcher exists.
      await expect(page.locator('.review-note-controls')).toHaveCount(0);
      await expect(page.locator('.note-review-scope')).toHaveCount(0);

      // Card 0 shows its inline notes with underline option tabs right below the card header.
      await expect(noteBar(0, 'run:0')).toBeVisible();
      await expect(tab(0, 'run:0', 'Original a')).toHaveAttribute('aria-selected', 'true');
      await expect(noteBar(0, 'run:0').getByRole('button', { name: / · Return to manuscript$/ })).toBeVisible();
      // Background warmup starts for alternatives without starving writes.
      await expect.poll(() => previews.some(request => request.unit === 'a' && request.option === 'alternative' && request.background)).toBe(true);
      assert.deepEqual(await page.evaluate(() => fetch('/preview-connection-probe', { method: 'POST', signal: AbortSignal.timeout(10000) }).then(response => response.json())), { ok: true }, 'A write reaches the server while optional previews are pending');

      // Check underline tabs and flat header badges in both dark and light themes.
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        await expect(tab(0, 'run:0', 'Original a')).toHaveAttribute('aria-selected', 'true');
        await page.screenshot({ path: `test-results/note-options-selected-${colorScheme}-${width}.png` });
      }

      // Select Alternative a: spinner shows while pending, Accept stays gated until preview resolves.
      await tab(0, 'run:0', 'Alternative a').click();
      await expect.poll(() => previews.filter(request => request.unit === 'a' && request.option === 'alternative' && !request.background).length).toBeGreaterThanOrEqual(1);
      await expect(noteBar(0, 'run:0').locator('.papilot-inline-tab[aria-selected="true"] .papilot-inline-spinner')).toBeVisible();
      await expect(card(0).locator('button.accept')).toBeDisabled();
      releaseAlternative();
      await expect(card(0)).toHaveAttribute('data-preview-revision', 'a-alternative-v1');
      await expect(card(0).locator('.fixture-after')).toHaveText('alternative a');
      await expect(card(0).locator('button.accept')).toBeEnabled();

      // Cached tab switches happen without extra network requests.
      const preparedRequests = previews.filter(request => request.key === 'run:0' && request.option === 'alternative').length;
      await tab(0, 'run:0', 'Original a').click();
      await expect(card(0)).not.toHaveAttribute('data-preview-revision', 'a-alternative-v1');
      await tab(0, 'run:0', 'Alternative a').click();
      await expect(card(0)).toHaveAttribute('data-preview-revision', 'a-alternative-v1');
      assert.equal(previews.filter(request => request.key === 'run:0' && request.option === 'alternative').length, preparedRequests, 'Repeated selection uses cached preview without any request');

      // Card header Comment routes to inline comment editor for the previewed alternative.
      if (width <= 390) {
        await card(0).locator('button.comment').click();
        const comment = noteBar(0, 'run:0').getByRole('textbox', { name: 'Comment on Alternative a', exact: true });
        await expect(comment).toBeVisible();
        await comment.fill('Keep the alternative concise.');
        await page.screenshot({ path: `test-results/note-options-comment-${width}.png` });
        await noteBar(0, 'run:0').getByRole('button', { name: 'Close comment', exact: true }).click();
        await expect(comment).toBeHidden();
        await card(0).locator('button.comment').click();
        await expect(comment).toHaveValue('Keep the alternative concise.');
        await noteBar(0, 'run:0').getByRole('button', { name: 'Close comment', exact: true }).click();
      }

      // Preview failure surfaces inline alert + Retry and recovers cleanly.
      await tab(0, 'run:0', 'Original a').click();
      failPreview = true; version++; changed(); await sync();
      await tab(0, 'run:0', 'Alternative a').click();
      await expect(noteBar(0, 'run:0').getByRole('alert')).toBeVisible();
      await expect(card(0).locator('button.accept')).toBeDisabled();
      await noteBar(0, 'run:0').getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(card(0)).toHaveAttribute('data-preview-revision', 'a-alternative-v2');
      await expect(noteBar(0, 'run:0').getByRole('alert')).toHaveCount(0);
      assert.equal(writes.length, 0, 'switching and retrying previews never saves a choice');

      // Late preview failure after switching back to Original a is ignored.
      failPreview = false; await tab(0, 'run:0', 'Original a').click();
      latePreview = new Promise(resolve => { releaseLate = resolve; });
      version++; changed(); await sync();
      await tab(0, 'run:0', 'Alternative a').click();
      await tab(0, 'run:0', 'Original a').click();
      releaseLate();
      await page.waitForTimeout(150);
      await expect(noteBar(0, 'run:0').getByRole('alert')).toHaveCount(0);

      // Accepting Alternative b via card header Accept triggers async build and advances round.
      await card(1).locator('.change-number').click();
      await expect(noteBar(1, 'run:2')).toBeVisible();
      await tab(1, 'run:2', 'Alternative b').click();
      await expect(card(1)).toHaveAttribute('data-preview-revision', 'b-alternative-v3');
      await card(1).locator('button.accept').click();
      await expect.poll(() => pendingBuild?.unit).toBe('b');
      selected.b = pendingBuild.option; decisions.b = 'accepted'; pendingBuild = null;
      task.status = 'reviewing'; task.review.round++; version++; changed(); await sync();

      // Failed rejection on Alternative c keeps its retry ID; retry succeeds and returns note.
      await card(2).locator('.change-number').click();
      await expect(noteBar(2, 'run:3')).toBeVisible();
      await tab(2, 'run:3', 'Alternative c').click();
      await expect(card(2)).toHaveAttribute('data-preview-revision', 'c-alternative-v4');
      saveFails = true;
      await card(2).locator('button.reject').click();
      await expect(noteBar(2, 'run:3').getByRole('alert')).toContainText('The source changed');
      assert.equal(decisions.c, 'pending');
      saveFails = false;
      await card(2).locator('button.reject').click();
      await expect.poll(() => decisions.c).toBe('rejected');
      assert.equal(writes.at(-1).id, writes.at(-2).id, 'a failed decision keeps its retry identity');
      assert.deepEqual([...returned], [3]);
      await expect(noteBar(2, 'run:3').getByRole('button', { name: 'Note 4 · Undo return to manuscript' })).toBeEnabled();
      await noteBar(2, 'run:3').getByRole('button', { name: 'Note 4 · Undo return to manuscript' }).click();
      await expect.poll(() => returned.size).toBe(0);

      assert.deepEqual(errors, []);
      await page.screenshot({ path: `test-results/note-options-flow-${width}.png` });
      console.log(`PASS ${width}px: inline note option tabs, live card preview, failure/retry, stale isolation, unified card accept/reject/comment, and return toggle`);
    } catch (error) {
      releaseAlternative();
      await page.screenshot({ path: `test-results/note-options-flow-error-${width}.png` });
      throw error;
    } finally { releaseAlternative(); releaseLate(); await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
