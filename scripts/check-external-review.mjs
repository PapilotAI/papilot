import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect, webkit } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const zh = JSON.parse(fs.readFileSync('src/web/locales/zh-CN.json', 'utf8'));
const failures = [];
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const { width, language, browserType, dark } of [
    { width: 1440, language: 'en', browserType: chromium, dark: false },
    { width: 390, language: 'zh-CN', browserType: process.env.PAPILOT_WEBKIT === '1' ? webkit : chromium, dark: true },
  ]) {
    const browser = await browserType.launch({ ...(browserType === chromium ? { channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome' } : {}), headless: true });
    try {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 950 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
      const page = await context.newPage(), text = label => language === 'zh-CN' ? zh[label] ?? label : label;
      const runtime = { connected: true, authenticated: true, installed: true, models: [{ id: 'fixture', isDefault: true, name: 'Fixture model', efforts: [] }] };
      const project = { id: 'paper', name: 'Research paper', path: '/tmp/example', createdAt: 1 };
      const state = { version: 'test', csrf: 'fixture', externalReviews: false, gitAvailable: true, projects: [project], tasks: [], requests: [], runtime, runtimes: { codex: runtime } };
      const base = 'a'.repeat(40), digest = 'b'.repeat(64), requestId = '3382c637-52b0-4014-b3cb-bf125facc656';
      const remote = { name: 'origin', revision: 'remote-v1', repository: 'Example/paper', url: 'https://github.com/Example/paper' };
      const proposal = { schema: 'papilot-handoff/v1', kind: 'proposal', requestId, baseCommit: base, changes: [
        { file: 'paper.tex', original: 'The effect is really small.', suggestion: 'The effect is small.', reason: 'Remove the intensifier.' },
      ] };
      const settings = { baseCommit: base, files: ['paper.tex', 'supplements/results with spaces.tex'], remotes: [remote], reviews: [] };
      let loadingError = true, fetched = false, decided = false, readReceipt = 0;
      await page.addInitScript(language => {
        localStorage.setItem('papilot:language', language);
        localStorage.setItem('papilot:setup-seen', '1');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: text => language === 'en' ? Promise.resolve(globalThis.copiedReviewText = text) : Promise.reject(new Error('Clipboard unavailable')),
        } });
      }, language);
      page.on('pageerror', error => failures.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), pathname = url.pathname, json = value => route.fulfill({ json: value });
        const post = route.request().method() === 'POST', body = post ? route.request().postDataJSON() : null;
        const error = message => route.fulfill({ status: 400, json: { error: message } });
        const review = settings.reviews[0];
        if (pathname === '/api/state') return json(state);
        if (pathname === '/api/external-reviews') { state.externalReviews = body.enabled; return json({ enabled: body.enabled }); }
        if (pathname.endsWith('/external-review')) {
          if (!post) {
            if (loadingError) { loadingError = false; return error('Temporary connection problem'); }
            return json(settings);
          }
          assert.deepEqual(body.files, ['paper.tex']); assert.equal(body.baseCommit, base);
          const created = { request: { schema: 'papilot-handoff/v1', kind: 'request', requestId, ...body } };
          settings.reviews.push(created); return json(created);
        }
        if (pathname.includes('/external-review/')) {
          if (pathname.endsWith('/github')) {
            assert.deepEqual(body, { remote: 'origin', revision: 'remote-v1' });
            review.git = { branch: `papilot-review/${requestId}`, proposalFile: 'proposal.json', remote }; return json(review);
          }
          if (pathname.endsWith('/page')) { review.page = body.url; return json(review); }
          if (pathname.endsWith('/prompt')) return json({ text: `${url.searchParams.get('via') === 'git' ? review.git.branch : review.page ?? 'Create a private Page'}\n${base}` });
          if (pathname.endsWith('/proposal')) {
            if (body.via === 'git') { fetched = true; return error('The reviewer has not posted a proposal yet.'); }
            try { assert.deepEqual(JSON.parse(body.text), proposal); } catch { return error('Copy the complete JSON block.'); }
            review.proposal = { digest, source: 'paste', changes: proposal.changes }; return json(review);
          }
          if (pathname.endsWith('/task')) {
            assert.equal(body.digest, digest); assert.equal(body.agent, 'codex');
            const task = { id: 'task-external-review', name: 'task-external-review', projectId: 'paper', title: 'External task fixture', instructions: '', status: 'reviewing', createdAt: 2, updatedAt: 2, agent: 'codex', error: null, review: null };
            state.tasks.push(task); review.taskId = task.id; return json({ review, task });
          }
          if (pathname.endsWith('/receipt') && !post) {
            assert.equal(url.searchParams.get('resultCommit'), base);
            readReceipt++; return json({ text: 'Ready to review the accepted wording. ' + base });
          }
          if (pathname.endsWith('/receipt')) {
            if (!decided) return error('Finish reviewing the local task before preparing a receipt.');
            review.result = { accepted: 'accepted', receipt: { resultCommit: base, status: 'ready_for_review' } }; return json(review);
          }
          if (pathname.endsWith('/result')) {
            assert.equal(body.resultCommit, base);
            review.result.published = { branch: 'review-result', url: `${remote.url}/blob/result/receipt.md` }; return json(review);
          }
        }
        if (pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
        if (pathname.endsWith('/requirements')) return json(readyRequirements);
        if (pathname.endsWith('/manuscript')) return json({ git: { branch: 'main', files: [] }, build: {}, annotations: [] });
        if (pathname.endsWith('/git')) return json({ branch: 'main', files: [], head: base });
        if (pathname.endsWith('/items')) return json({ items: [] });
        return json({});
      });
      await page.goto(origin);
      const entry = page.getByRole('button', { name: text('External review'), exact: true });
      assert.equal(await entry.count(), 0);
      if (width < 600) await page.locator('.sidebar-toggle').click();
      await page.locator('.settings-link').click();
      await page.locator('[data-settings-page="experiments"]').click();
      const toggle = page.getByRole('switch', { name: text('Enable external reviews') });
      await expect(toggle).not.toBeChecked(); await toggle.click(); await expect(toggle).toBeChecked();
      await page.locator('.settings-dialog .modal-close').click();
      const sidebar = page.locator('#task-sidebar');
      if (width < 600 && !await sidebar.evaluate(element => element.classList.contains('is-open'))) await page.locator('.sidebar-toggle').click();
      await entry.click();
      const dialog = page.getByRole('dialog', { name: text('External review') });
      const button = label => dialog.getByRole('button', { name: text(label), exact: true });
      const heading = label => dialog.getByRole('heading', { name: text(label), exact: true });
      const shot = name => page.screenshot({ path: `test-results/external-review-${width}-${name}.png`, animations: 'disabled' });
      await expect(dialog.getByRole('alert')).toContainText('Temporary connection problem');
      await button('Try again').click(); await expect(heading('Prepare')).toBeFocused();
      await dialog.getByLabel(text('What should the reviewer check?')).fill('Clarify the first result.');
      await button('Create review request').click(); await expect(heading('Send to reviewer')).toBeFocused();
      await button('Publish review branch').click(); await expect(button('Copy Git prompt')).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: text('Git prompt'), includeHidden: true })).toBeHidden();
      await button('Copy Git prompt').click();
      if (language === 'en') assert.match(await page.evaluate(() => globalThis.copiedReviewText), /papilot-review\//);
      else await expect(dialog.getByRole('textbox', { name: text('Git prompt') })).toBeFocused();
      await dialog.getByLabel(text('ChatGPT Space Page'), { exact: true }).check();
      await dialog.getByLabel(text('Space Page link (optional)')).fill('https://chatgpt.com/space/page_abc123');
      await button('Save Page link').click(); await expect(dialog.getByRole('link', { name: text('Open Space Page'), exact: true })).toBeVisible();
      await shot('share');
      await button('Go to proposal').click(); await expect(heading('Import proposal')).toBeFocused();
      await button('Fetch Git proposal').click(); await expect(dialog.getByRole('alert')).toContainText('has not posted'); assert.equal(fetched, true);
      const field = dialog.getByLabel(text('Proposal JSON or Page Markdown'));
      await field.fill('incomplete'); await button('Check pasted proposal').click(); await expect(dialog.getByRole('alert')).toContainText('complete JSON');
      await shot('recovery');
      await field.fill(JSON.stringify(proposal)); await button('Check pasted proposal').click(); await expect(dialog.getByText(text('Proposal checked'))).toBeVisible();
      await button('Continue to local agent').click(); await expect(heading('Implement locally')).toBeFocused();
      await button('Start local agent').click(); await expect(dialog).toHaveCount(0);
      if (width < 600) {
        await expect(sidebar).not.toHaveClass(/\bis-open\b/);
        await page.locator('.sidebar-toggle').click();
      }
      await entry.click(); await expect(button('Open local task')).toBeVisible();
      await button('Continue to result').click(); await button('Prepare receipt').click(); await expect(dialog.getByRole('alert')).toContainText(/Finish reviewing|审阅/);
      decided = true;
      await button('Prepare receipt').click(); await expect(dialog.getByText(text('Receipt ready'))).toBeVisible();
      await button('Show text').click(); await expect.poll(() => readReceipt).toBe(1);
      await button('Copy result for Space').click(); await expect.poll(() => readReceipt).toBe(2);
      await button('Publish result branch').click(); await expect(dialog.getByRole('link', { name: text('Open Git receipt') })).toBeVisible();
      await shot('result');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(entry).toBeFocused();
    } finally { await browser.close(); }
  }
  assert.deepEqual(failures, []);
  console.log('External review: complete wizard, Git and Space prompts, import recovery, receipt revalidation, and desktop and mobile layouts checked.');
} finally { await server.close(); }
