import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';

// The Library against a fixture server. Its header counts the works with a
// PDF and the citations checked against them; a work without a PDF gets one
// from its Add PDF button, and a dropped file that names no entry is
// reported. A selected work shows the sentences citing it with their
// verdicts; an evidence quote opens the PDF at its lines and Back returns to
// the quote; Dismiss forgets a finding and Not this work takes a PDF away.
// The search finds works by author. Settings shows the Zotero library PDFs
// come from, connects a Zotero account and turns Zotero off on the server.
// The works still without a PDF, and the citations, go to an agent as task
// drafts. In a narrow window the list and the work take turns.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const state = { version: '0.13.0', csrf: 'fixture', projects: [{ id: 'paper', name: 'Fixture paper', path: '/papers/fixture', createdAt: 1 }], tasks: [], requests: [], runtime: { connected: true, authenticated: false, account: null, error: null, models: [] } };
const git = { branch: 'main', upstream: null, ahead: 0, behind: 0, files: [], head: null };
const hash = 'a'.repeat(64), added = 'b'.repeat(64);
const entry = (key, title, author, extra = []) => ({ id: `refs.bib#${key}`, file: 'refs.bib', key, type: 'article', fields: [{ name: 'title', value: title }, { name: 'author', value: author }, { name: 'year', value: '1990' }, ...extra], lines: [1, 5], cited: [{ file: 'main.tex', line: 3, section: '1 Introduction' }] });
const supported = { verdict: 'supported', note: 'The book gives the line-breaking algorithm.', evidence: [{ quote: 'TeX breaks paragraphs into lines with a total-fit algorithm.', page: 1, marks: [{ page: 1, rect: [0.1, 0.1, 0.9, 0.16] }] }], pdf: hash, checkedAt: 1 };
const report = {
  bibs: ['refs.bib'], absent: [], missing: [], duplicates: [], similar: [], all_cited: false, checks: {}, pending: 0, confirmed: {}, uncited: 1, suggestions: [],
  entries: [entry('knuth', 'The TeXbook', "Donald E. Knuth and Andr{\\'a}s Kov{\\'a}cs"), entry('wadler', 'Linear types can change the world!', 'Philip Wadler', [{ name: 'doi', value: '10.1000/open' }])],
  library: { pending: 0, entries: {
    'refs.bib#knuth': { pdf: { hash, source: 'author', pages: 1, text: 'ready' }, find: null, landing: null },
    'refs.bib#wadler': { pdf: null, find: 'paywalled', landing: 'https://doi.org/10.1000/open' },
  } },
  citations: [
    { id: 's1', keys: ['knuth'], file: 'main.tex', line: 3, section: '1 Introduction', sentence: 'TeX breaks paragraphs into lines optimally [knuth].', findings: { knuth: supported } },
    { id: 's2', keys: ['wadler', 'knuth'], file: 'main.tex', line: 4, section: '1 Introduction', sentence: 'Linear values can be updated in place [wadler, knuth].', findings: {} },
  ],
};
let zotero = { local: { chosen: null, state: 'ready', dataDir: '/Users/researcher/Zotero', items: 1204, withPdf: 873, citationKeys: 1204 }, account: null, use: true };
const account = { username: 'researcher', libraries: [{ name: null, items: 310, withPdf: 288, citationKeys: 12 }, { name: 'Lab', items: 40, withPdf: 31, citationKeys: 0 }], syncing: false, synced: Date.UTC(2026, 10, 23, 9, 30), problem: null };
const checks = [], shows = [], searches = [], uploads = [], removals = [], forgotten = [], errors = [], keys = [], switched = [], looks = [], located = [];
let quickModel = { agent: 'deepseek', model: 'deepseek/deepseek-v4.1-flash-ultrafast', effort: null };
fs.mkdirSync('test-results', { recursive: true });
try {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/projects/paper/library') { looks.push(url.search); return route.fulfill({ json: report }); }
    if (url.pathname === '/api/projects/paper/library/pdf' && request.method() === 'POST') {
      const target = url.searchParams.get('entry');
      uploads.push({ target, name: decodeURIComponent(request.headers()['x-papilot-filename'] || ''), bytes: request.postDataBuffer()?.length ?? 0 });
      if (!target) return route.fulfill({ json: { entry: null } });
      report.library.entries[target] = { pdf: { hash: added, source: 'author', pages: 1, text: 'ready' }, find: null, landing: null };
      return route.fulfill({ json: { entry: target, hash: added } });
    }
    if (url.pathname === '/api/projects/paper/library/remove' && request.method() === 'POST') {
      const { entry: target } = request.postDataJSON();
      removals.push(target);
      report.library.entries[target] = { pdf: null, find: 'paywalled', landing: 'https://doi.org/10.1000/open' };
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/projects/paper/citations/forget' && request.method() === 'POST') {
      const { id, key } = request.postDataJSON();
      forgotten.push([id, key]);
      delete report.citations.find(sentence => sentence.id === id).findings[key];
      return route.fulfill({ json: report });
    }
    if (url.pathname === '/api/projects/paper/library/search') {
      searches.push(url.searchParams.get('q'));
      return route.fulfill({ json: { matches: url.searchParams.get('q') === 'total-fit' ? [{ entry: 'refs.bib#knuth', key: 'knuth', hash, page: 1, text: 'TeX breaks paragraphs into lines with a total-fit algorithm.', marks: [{ page: 1, rect: [0.1, 0.1, 0.9, 0.16] }] }] : [], nextCursor: null } });
    }
    if (url.pathname === '/api/quick-model') return route.fulfill({ json: { choice: quickModel } });
    if (url.pathname === '/api/citation-checks' && request.method() === 'POST') {
      const body = request.postDataJSON();
      checks.push(body);
      const task = { id: body.id, projectId: 'paper', name: 'c-' + body.id, title: body.title, titleSource: 'prompt', instructions: '', mode: 'citations', worktree: '', threadId: null, turnId: null, model: null, status: 'idle', createdAt: 5, updatedAt: 5, feedbackCursor: 0, error: null, review: null,
        citationCheck: { show: false, state: { running: false, stopping: false, done: 1, total: 1, failed: 0, model: 'DeepSeek V4.1 Flash UltraFast', error: null, finishedAt: 6 } } };
      state.tasks = [task];
      report.citations[1].findings.knuth = { verdict: 'partial', note: 'The book breaks lines optimally but says nothing of linear values.', evidence: supported.evidence, pdf: hash, checkedAt: 7, by: 'DeepSeek V4.1 Flash UltraFast', task: body.id };
      return route.fulfill({ json: task });
    }
    if (/^\/api\/tasks\/[^/]+\/citations\/show$/.test(url.pathname) && request.method() === 'POST') {
      shows.push(request.postDataJSON().show);
      state.tasks = state.tasks.map(task => ({ ...task, citationCheck: { ...task.citationCheck, show: request.postDataJSON().show } }));
      return route.fulfill({ json: state.tasks[0] });
    }
    if (url.pathname.startsWith('/api/projects/paper/library/pdfs/')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
    if (url.pathname === '/api/library/zotero') return route.fulfill({ json: zotero });
    if (url.pathname === '/api/library/zotero/account' && request.method() === 'POST') {
      const { key } = request.postDataJSON();
      keys.push(key);
      if (key !== 'GOODKEY123') return route.fulfill({ status: 400, json: { error: 'Zotero does not accept this key. Check it and try again.' } });
      zotero = { ...zotero, account };
      return route.fulfill({ json: zotero });
    }
    if (url.pathname === '/api/library/zotero/account/remove' && request.method() === 'POST') { zotero = { ...zotero, account: null }; return route.fulfill({ json: zotero }); }
    if (url.pathname === '/api/library/zotero/location' && request.method() === 'POST') {
      const { dataDir } = request.postDataJSON();
      located.push(dataDir);
      if (dataDir && !dataDir.endsWith('Zotero')) return route.fulfill({ status: 400, json: { error: 'This folder has no zotero.sqlite. Choose Zotero\'s data directory, the folder with zotero.sqlite and storage.' } });
      zotero = { ...zotero, local: { ...zotero.local, chosen: dataDir, dataDir: dataDir ?? '/Users/researcher/Zotero' } };
      return route.fulfill({ json: zotero });
    }
    if (url.pathname === '/api/library/zotero/use' && request.method() === 'POST') { switched.push(request.postDataJSON().use); zotero = { ...zotero, use: request.postDataJSON().use }; return route.fulfill({ json: zotero }); }
    if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/updates') return route.fulfill({ json: { currentVersion: state.version, latestVersion: state.version, phase: 'idle' } });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
    if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git, build: { status: 'failed', error: 'Fixture preview' }, annotations: [] } });
    if (url.pathname.endsWith('/git')) return route.fulfill({ json: git });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  // The Library has its own place in the sidebar, below the manuscript.
  const openLibrary = async () => { await page.locator('.sidebar .library-link').click(); };
  await openLibrary();
  const panel = page.locator('.library-panel');
  const more = () => page.getByRole('button', { name: 'More library actions', exact: true }).click();
  const verdicts = () => page.locator('.library-claim summary > :first-child').allTextContents();
  // The header: how many works, the one without a PDF as a way into it, one action and a menu.
  await panel.getByRole('heading', { name: '2 cited works', exact: true }).waitFor();
  await panel.getByRole('button', { name: '1 without a PDF', exact: true }).waitFor();
  // The list opens on what needs the author: here the work without a PDF, with why it has none.
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'To do1');
  await panel.getByText('Not open access', { exact: true }).first().waitFor();
  await page.screenshot({ path: 'test-results/library-missing.png', animations: 'disabled' });

  // A work's Add PDF gives the chosen file to that work.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.library-list').getByRole('button', { name: 'Add a PDF for wadler', exact: true }).click();
  await (await chooser).setFiles({ name: 'wadler.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 wadler') });
  await panel.getByText('Nothing needs you here.', { exact: true }).waitFor();
  await panel.getByText('Every work has a PDF', { exact: true }).waitFor();
  assert.deepEqual(uploads, [{ target: 'refs.bib#wadler', name: 'wadler.pdf', bytes: 15 }]);

  // A file dropped on the library that names no entry is reported by name.
  const files = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['%PDF-1.4 notes'], 'notes.pdf', { type: 'application/pdf' })); return data; });
  await panel.dispatchEvent('dragover', { dataTransfer: files });
  assert.equal(await panel.getAttribute('data-drop'), 'true');
  await panel.dispatchEvent('drop', { dataTransfer: files });
  await panel.getByText('notes.pdf matches no entry. Drop it on its entry.', { exact: true }).waitFor();
  assert.deepEqual(uploads.at(-1), { target: null, name: 'notes.pdf', bytes: 14 });

  // A selected work: its names as they read, and the sentences citing it,
  // each one row with its verdict, what needs a look first.
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByRole('button', { name: /^Knuth & Kovács 1990/ }).click();
  const work = page.locator('.library-work');
  await work.getByRole('heading', { name: 'The TeXbook', exact: true }).waitFor();
  await work.getByText('Donald E. Knuth, András Kovács', { exact: true }).waitFor();
  const claims = work.locator('.library-claim');
  assert.equal(await claims.count(), 2);
  assert.deepEqual(await verdicts(), ['Not checked', 'Supported']);
  assert.equal(await claims.nth(0).locator('mark').textContent(), 'knuth');
  await work.locator('.library-cover canvas').waitFor();
  await page.screenshot({ path: 'test-results/library-work.png', animations: 'disabled' });

  // A supported citation stays one row until opened; its quote opens the PDF at its lines, and Back returns to it.
  const supportedRow = claims.nth(1);
  assert.equal(await supportedRow.locator('details').getAttribute('open'), null);
  await supportedRow.locator('summary').click();
  const quote = supportedRow.getByRole('button', { name: /TeX breaks paragraphs into lines with a total-fit algorithm/ });
  await quote.click();
  const back = page.getByRole('button', { name: 'Back to the library', exact: true });
  await back.waitFor();
  await page.locator('.library-reader .source-mark').first().waitFor();
  assert.ok(await back.evaluate(button => button === document.activeElement), 'The reader focuses its Back button');
  await page.screenshot({ path: 'test-results/library-evidence.png', animations: 'disabled' });
  await back.click();
  await quote.waitFor();
  assert.ok(await quote.evaluate(button => button === document.activeElement), 'Back returns focus to the quote');

  // The search also finds words in the works' PDFs, as passages with their
  // page; a passage opens its PDF there.
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('total-fit');
  const snippet = page.locator('.library-snippet');
  await snippet.getByText('p. 1', { exact: true }).waitFor();
  assert.equal(await snippet.locator('mark').textContent(), 'total-fit');
  assert.equal(searches.at(-1), 'total-fit');
  await page.screenshot({ path: 'test-results/library-search-pdfs.png', animations: 'disabled' });
  await snippet.click();
  await page.locator('.library-reader .source-mark').first().waitFor();
  await page.getByRole('button', { name: 'Back to the library', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('');
  await page.locator('.library-found').waitFor({ state: 'detached' });

  // Check starts a check task at once, with the quick model, and opens its page.
  await page.getByRole('button', { name: 'Check citations', exact: true }).click();
  const view = page.locator('.citation-check-view');
  await view.getByRole('heading', { name: 'Check citations', exact: true }).waitFor();
  assert.deepEqual([checks.at(-1).projectId, checks.at(-1).agent, checks.at(-1).model], ['paper', 'deepseek', 'deepseek/deepseek-v4.1-flash-ultrafast']);
  await view.getByText('1 to look at', { exact: true }).waitFor();
  await view.locator('.citation-check-group li').first().getByText('The book breaks lines optimally but says nothing of linear values.', { exact: true }).waitFor();
  const show = view.getByRole('switch', { name: 'Show in the paper' });
  assert.equal(await show.isChecked(), false, 'the paper shows a check only when asked');
  await show.click();
  await page.waitForFunction(() => document.querySelector('.citation-check-show input')?.checked === true);
  assert.deepEqual(shows, [true]);
  await page.screenshot({ path: 'test-results/library-check-task.png', animations: 'disabled' });
  delete report.citations[1].findings.knuth;
  state.tasks = [];
  await openLibrary();
  await panel.getByRole('heading', { name: '2 cited works', exact: true }).waitFor();
  // The Library's menu holds only what manages PDFs; checking is the one button.
  await more();
  assert.deepEqual(await page.locator('.action-menu:popover-open [role^="menuitem"]').allTextContents(), ['Add PDFs…']);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByRole('button', { name: /^Knuth & Kovács 1990/ }).click();

  // The author dismisses a finding they judge otherwise.
  const held = claims.filter({ hasText: 'TeX breaks paragraphs into lines optimally' });
  if (await held.locator('details').getAttribute('open') === null) await held.locator('summary').click();
  await held.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.library-claim summary > :first-child')].every(item => item.textContent === 'Not checked'));
  assert.deepEqual(forgotten, [['s1', 'knuth']]);

  // The search finds works by author.
  const search = page.getByRole('searchbox', { name: 'Search the library' });
  await search.fill('wadler');
  assert.deepEqual(await page.locator('.library-byline').allTextContents(), ['Wadler 1990']);
  await search.fill('');

  // Not this work, in the work's menu, takes the PDF away; the work needs the author again.
  await page.getByRole('button', { name: /^Wadler 1990/ }).click();
  await page.getByRole('button', { name: 'More actions for wadler', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Not this work', exact: true }).click();
  await panel.getByRole('button', { name: '1 without a PDF', exact: true }).waitFor();
  await page.getByRole('tab', { name: /^To do\s*1$/ }).waitFor();
  assert.deepEqual(removals, ['refs.bib#wadler']);

  // In a narrow window the list and the selected work take turns, with a way back.
  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole('tab', { name: /^All/ }).click();
  assert.equal(await page.locator('.library-detail-pane').isVisible(), false);
  await page.getByRole('button', { name: /^Knuth & Kovács 1990/ }).click();
  await work.getByRole('heading', { name: 'The TeXbook', exact: true }).waitFor();
  assert.equal(await page.locator('.library-list-pane').isVisible(), false);
  await page.screenshot({ path: 'test-results/library-narrow-work.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'All works', exact: true }).click();
  const row = page.getByRole('button', { name: /^Knuth & Kovács 1990/ });
  await row.waitFor();
  assert.ok(await row.evaluate(button => button === document.activeElement), 'Back to the list returns focus to the work');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Settings names the Zotero library PDFs come from.
  await page.locator('.settings-link').click();
  await page.locator('[data-settings-page="zotero"]').click();
  const facts = page.locator('.settings-content-zotero .settings-facts');
  await facts.getByText('/Users/researcher/Zotero', { exact: true }).waitFor();
  assert.equal(await facts.locator('div', { hasText: 'Items with a PDF' }).locator('dd').textContent(), '873');
  await page.screenshot({ path: 'test-results/library-zotero-settings.png', animations: 'disabled' });
  // Another data directory can be chosen: one without Zotero's database is
  // refused, and the choice can be undone.
  await page.getByRole('button', { name: 'Change…', exact: true }).click();
  const place = page.getByRole('textbox', { name: 'Zotero data directory', exact: true });
  assert.equal(await place.inputValue(), '/Users/researcher/Zotero');
  await place.fill('/Volumes/Archive/Papers');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByText('This folder has no zotero.sqlite. Choose Zotero\'s data directory, the folder with zotero.sqlite and storage.', { exact: true }).waitFor();
  await place.fill('/Volumes/Archive/Zotero');
  await place.press('Enter');
  await facts.getByText('/Volumes/Archive/Zotero', { exact: true }).waitFor();
  await facts.getByText('Chosen by you', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/library-zotero-chosen.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Use the detected location', exact: true }).click();
  await facts.getByText('/Users/researcher/Zotero', { exact: true }).waitFor();
  assert.deepEqual(located, ['/Volumes/Archive/Papers', '/Volumes/Archive/Zotero', null]);
  // A key Zotero refuses is reported at the field, which keeps focus; one it
  // accepts shows the account's libraries. The key itself is never shown.
  const field = page.getByLabel('API key', { exact: true });
  await field.fill('WRONGKEY');
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByText('Zotero does not accept this key. Check it and try again.', { exact: true }).waitFor();
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.ok(await field.evaluate(input => input === document.activeElement), 'A refused key keeps focus in its field');
  await page.screenshot({ path: 'test-results/library-zotero-key-refused.png', animations: 'disabled' });
  await field.fill('GOODKEY123');
  await field.press('Enter');
  const accountFacts = page.locator('.settings-content-zotero section', { has: page.getByRole('heading', { name: 'Zotero account' }) }).locator('.settings-facts');
  await accountFacts.getByText('researcher', { exact: true }).waitFor();
  assert.equal(await accountFacts.locator('div', { hasText: 'Libraries' }).locator('dd').textContent(), 'My Library and Lab');
  assert.equal(await accountFacts.locator('div', { hasText: 'Items with a PDF' }).locator('dd').textContent(), '319');
  assert.deepEqual(keys, ['WRONGKEY', 'GOODKEY123']);
  assert.ok(!(await page.locator('.settings-content-zotero').innerText()).includes('GOODKEY123'));
  await page.screenshot({ path: 'test-results/library-zotero-account.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await field.waitFor();
  // An empty key is asked for at its field.
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByText('Paste the API key you created on zotero.org.', { exact: true }).waitFor();
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(keys, ['WRONGKEY', 'GOODKEY123']);
  await page.getByRole('switch', { name: 'Use PDFs from Zotero', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#settings-zotero').checked && !document.querySelector('#settings-zotero').disabled);
  assert.deepEqual(switched, [false]);
  // The library leaves Zotero to the server's setting.
  assert.ok(looks.length && looks.every(query => !query.includes('zotero')), looks.join(' '));
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The works without a PDF go to an agent as a task draft the author can edit.
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ask an agent to find 1 PDF…', exact: true }).click();
  await page.waitForFunction(() => (localStorage.getItem('papilot:new-task') || '').includes('library_add'));
  const draft = await page.evaluate(() => localStorage.getItem('papilot:new-task'));
  assert.match(draft, /^- wadler: Linear types can change the world! \(Philip Wadler, 1990\) https:\/\/doi\.org\/10\.1000\/open$/m);
  assert.match(draft, /never shadow libraries/);

  // Automatic citation checks use a read-only agent when the editing default is ZCode.
  quickModel = null;
  state.runtimes = {
    codex: { ...state.runtime, authenticated: true },
    zcode: { ...state.runtime, authenticated: true, authenticationUnchecked: true, supportsReadOnlyTasks: false },
  };
  await page.evaluate(() => localStorage.setItem('papilot:agent', 'zcode'));
  await page.reload();
  await openLibrary();
  await page.getByRole('button', { name: 'Check citations', exact: true }).click();
  await view.getByRole('heading', { name: 'Check citations', exact: true }).waitFor();
  assert.deepEqual([checks.at(-1).projectId, checks.at(-1).agent, checks.at(-1).model], ['paper', 'codex', null]);

  // An author-disabled runtime cannot be used as a fallback.
  state.runtimes.codex = { ...state.runtimes.codex, hidden: true };
  await page.reload();
  await openLibrary();
  const checksBefore = checks.length;
  await page.getByRole('button', { name: 'Check citations', exact: true }).click();
  await page.getByRole('alert').getByText('Connect an agent that supports read-only tasks, such as Codex.', { exact: true }).waitFor();
  assert.equal(checks.length, checksBefore);
  // Explicit quick models stay pinned when an alternate provider is ready.
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  quickModel = { agent: 'codex', model: null, effort: null };
  state.runtimes.deepseek = { ...state.runtime, authenticated: true };
  await page.reload();
  await openLibrary();
  await page.getByRole('button', { name: 'Check citations', exact: true }).click();
  await page.getByRole('alert').getByText('Connect an agent that supports read-only tasks, such as Codex.', { exact: true }).waitFor();
  assert.equal(checks.length, checksBefore);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
