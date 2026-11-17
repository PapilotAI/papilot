import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const origin = `http://127.0.0.1:${server.server.address().port}`, errors = [];
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const mode of ['browser', 'windows', 'wsl']) {
    const desktop = mode !== 'browser', parent = mode === 'windows' ? 'C:\\Users\\Author' : '/home/author';
    const picked = mode === 'windows' ? 'D:\\Research' : '/home/author/papers';
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const requests = [], state = { version: '0.10.4', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: { connected: true, authenticated: false, account: null, error: null, models: [] } };
    if (desktop) await context.addInitScript(picked => { window.papilotDesktop = { platform: 'win32', minimize() {}, maximize() {}, close() {}, chooseDirectory: async () => picked }; }, picked);
    let fail = !desktop;
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/projects/create-defaults') return route.fulfill({ json: { parent } });
      if (url.pathname === '/api/projects/create') {
        const body = route.request().postDataJSON(); requests.push(body);
        if (fail) return route.fulfill({ status: 400, json: { error: 'Could not create the paper folder. Check the save location and its permissions.' } });
        const project = { id: 'created-' + mode, name: body.name, path: body.parent + (mode === 'windows' ? '\\' : '/') + body.name, createdAt: 1 };
        state.projects = [project]; return route.fulfill({ json: project });
      }
      if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/updates') return route.fulfill({ json: { currentVersion: state.version, latestVersion: state.version, phase: 'idle' } });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
      if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { branch: 'main', files: [], head: null, ahead: 0, behind: 0 }, build: { status: 'failed', error: 'latexmk not found: install TeX Live, then compile again.' }, annotations: [] } });
      if (url.pathname.endsWith('/git')) return route.fulfill({ json: { branch: 'main', files: [], head: null, ahead: 0, behind: 0 } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const create = page.getByRole('button', { name: 'New paper', exact: true });
    await create.click();
    let dialog = page.getByRole('dialog', { name: 'New paper', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Paper name', exact: true }), location = dialog.getByRole('textbox', { name: 'Save in', exact: true });
    await name.fill('研究论文');
    await page.waitForFunction(parent => document.querySelector('[name=parent]')?.value === parent || document.querySelector('.create-paper-location-copy span')?.textContent === parent, parent);
    // The dialog shows the folder it will create instead of explaining it.
    const target = dialog.locator('.create-paper-target'), separator = mode === 'windows' ? '\\' : '/';
    await page.waitForFunction(([selector, expected]) => document.querySelector(selector)?.textContent === expected, ['.create-paper-target', parent + separator + '研究论文']);
    if (desktop) {
      assert.equal(await location.count(), 0, 'Desktop uses a native picker without a path textbox');
      await dialog.locator('.create-paper-location').getByRole('button', { name: 'Change…', exact: true }).click(); assert.equal(await dialog.locator('.create-paper-location-copy span').textContent(), picked);
      assert.equal(await target.textContent(), picked + separator + '研究论文');
    } else {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: 'test-results/create-paper-mobile.png', animations: 'disabled' });
      assert.ok((await location.boundingBox()).height >= 36, 'Save location remains a usable input on mobile');
      const bounds = await dialog.locator('.modal').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321, 'Creation dialog fits a narrow phone');
      assert.ok(await target.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The target folder truncates instead of widening the dialog');
    }
    await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
    if (!desktop) {
      await dialog.getByRole('alert').filter({ hasText: 'permissions' }).waitFor();
      const first = requests.at(-1);
      assert.equal(await name.inputValue(), '研究论文'); assert.equal(await location.inputValue(), parent);
      await page.reload(); await create.click();
      dialog = page.getByRole('dialog', { name: 'New paper', exact: true });
      assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).inputValue(), '研究论文');
      fail = false;
      await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(requests.at(-1), first, 'Retry after reload retains the creation identity and inputs');
      await page.setViewportSize({ width: 1280, height: 800 }); await page.emulateMedia({ colorScheme: 'light' });
    } else await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.at(-1).parent, desktop ? picked : parent);
    await page.getByText('latexmk not found: install TeX Live, then compile again.', { exact: false }).first().waitFor();
    const switcher = page.getByRole('button', { name: 'Paper: 研究论文', exact: true });
    if (!(await switcher.isVisible())) await page.getByRole('button', { name: 'Show task list', exact: true }).click();
    await switcher.click();
    await page.getByRole('menuitem', { name: 'New paper…', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'New paper', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).inputValue(), '', 'Successful creation clears the saved draft');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await switcher.evaluate(element => element === document.activeElement), true, 'Closing returns focus before React removes the dialog');
    await context.close();
  }
  // Universe templates: a grid before the details, filters, search, and links from the website.
  const templates = [
    { id: 'thuthesis', version: '7.6.0', name: 'Tsinghua University Thesis', zh: { name: '清华大学学位论文' }, category: 'thesis', tags: ['tsinghua'], organization: 'Tsinghua University', engine: 'xelatex', thumbnail: origin + '/favicon.png' },
    { id: 'neurips', version: '2026', name: 'NeurIPS 2026', category: 'conference', tags: ['machine learning'], venue: { name: 'NeurIPS', year: 2026 }, engine: 'pdflatex', thumbnail: origin + '/favicon.png' },
    { id: 'acm-pacmpl', version: '2.21', name: 'PACMPL (POPL, PLDI, ICFP, OOPSLA)', category: 'conference', tags: ['acm'], organization: 'ACM', engine: 'pdflatex', thumbnail: origin + '/favicon.png' },
    { id: 'ieee', version: '1', name: 'IEEE Article', category: 'journal', tags: ['ieee'], engine: 'pdflatex' },
    { id: 'beamer', version: '1', name: 'Beamer Slides', category: 'slides', tags: ['slides'], engine: 'pdflatex' },
    { id: 'moderncv', version: '1', name: 'Modern CV', category: 'cv', tags: ['cv'], engine: 'pdflatex' },
    { id: 'book', version: '1', name: 'Book', category: 'book', tags: ['book'], engine: 'pdflatex' },
    // A conference that reuses a shared template is a row, not another first page.
    { id: 'pldi', version: '2.21', name: 'PLDI 2027', description: 'Programming Language Design and Implementation', category: 'conference', tags: ['PLDI'], venue: { name: 'PLDI', year: 2027, ccf: 'A', full: 'Programming Language Design and Implementation' }, template: 'acm-pacmpl', engine: 'pdflatex', thumbnail: origin + '/favicon.png' },
    { id: 'popl', version: '2.21', name: 'POPL 2027', description: 'Principles of Programming Languages', category: 'conference', tags: ['POPL'], venue: { name: 'POPL', year: 2027, ccf: 'A', full: 'Principles of Programming Languages' }, template: 'acm-pacmpl', engine: 'pdflatex', thumbnail: origin + '/favicon.png' },
  ];
  for (const link of [null, { id: 'neurips', version: '2026' }, { id: 'neurips', version: '2025' }]) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const requests = [], state = { version: '0.10.4', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: { connected: true, authenticated: false, account: null, error: null, models: [] } };
    // A saved blank-paper draft must not be created while a linked template is still loading.
    if (link) await context.addInitScript(() => localStorage.setItem('papilot:create-paper', JSON.stringify({ name: 'Old draft', parent: '/home/author', template: null })));
    if (link) await context.addInitScript(link => { let pending = link; window.papilotDesktop = { platform: 'darwin', minimize() {}, maximize() {}, close() {}, chooseDirectory: async () => '/home/author/local-paper', takeNewPaper: async () => { const value = pending; pending = null; return value; }, onNewPaper: () => () => {} }; }, link);
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/universe') { if (link) await new Promise(resolve => setTimeout(resolve, 1500)); return route.fulfill({ json: { templates } }); }
      if (url.pathname === '/api/projects/create-defaults') return route.fulfill({ json: { parent: '/home/author' } });
      if (url.pathname === '/api/projects/create') { const body = route.request().postDataJSON(); requests.push(body); return route.fulfill({ status: 400, json: { error: 'Stop here.' } }); }
      if (url.pathname === '/api/projects/open') { const project = { id: 'local-paper', name: 'Local paper', path: '/home/author/local-paper', createdAt: 1 }; state.projects = [project]; return route.fulfill({ json: { project } }); }
      if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, build: { status: 'failed', error: 'Fixture preview' }, annotations: [] } });
      if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [] } });
      if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const dialog = page.getByRole('dialog', { name: 'New paper', exact: true });
    const chosen = dialog.locator('.template-chosen');
    if (link) {
      await dialog.locator('.template-card.placeholder').first().waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Create paper', exact: true }).count(), 0, 'Create waits for the linked template');
    }
    if (link?.version === '2025') {
      // A version the index no longer has asks for a new choice instead of substituting one.
      await dialog.getByRole('list', { name: 'Templates' }).getByRole('listitem').nth(2).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Create paper', exact: true }).count(), 0);
      await dialog.getByRole('listitem').filter({ hasText: 'NeurIPS 2026' }).click();
    } else if (link) {
      await chosen.getByText('pdfLaTeX', { exact: true }).waitFor(); assert.equal(await chosen.locator('strong').innerText(), 'NeurIPS 2026');
      assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).isVisible(), true, 'A website link opens the details with its template');
    } else {
      await page.getByRole('button', { name: 'New paper', exact: true }).first().click();
      await dialog.getByRole('tab', { name: 'Templates', exact: true }).click();
      const grid = dialog.getByRole('list', { name: 'Templates' });
      await grid.getByRole('listitem').nth(7).waitFor();
      assert.equal(await dialog.getByRole('button', { name: /^(Featured|Browse all)$/ }).count(), 0);
      assert.equal(await dialog.getByRole('searchbox', { name: 'Search templates' }).isVisible(), true);
      assert.deepEqual(await grid.getByRole('listitem').allInnerTexts().then(items => items.map(item => item.split('\n')[0])), ['Example project', 'Tsinghua University Thesis', 'NeurIPS 2026', 'PACMPL (POPL, PLDI, ICFP, OOPSLA)', 'IEEE Article', 'Beamer Slides', 'Modern CV', 'Book']);
      await page.screenshot({ path: 'test-results/create-paper-all-templates.png', animations: 'disabled' });
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await dialog.locator('.modal').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The full catalog and filters fit a narrow phone');
      await page.screenshot({ path: 'test-results/create-paper-all-templates-mobile.png', animations: 'disabled' });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: 'light' });
      // A template beyond the former five-item preview is directly selectable.
      await grid.getByRole('listitem').filter({ hasText: /^Book$/ }).click();
      assert.equal(await chosen.locator('strong').innerText(), 'Book');
      await chosen.getByRole('button', { name: 'Change…', exact: true }).click();
      const venues = dialog.getByRole('group', { name: 'Conferences' }).locator('.template-venue-name');
      assert.equal(await venues.count(), 0, 'Conferences are listed only in their group or when a search matches them');
      await dialog.getByRole('button', { name: 'Conferences', exact: true }).click();
      assert.equal(await grid.getByRole('listitem').count(), 0);
      assert.deepEqual(await venues.allInnerTexts(), ['NeurIPS 2026', 'PLDI 2027', 'POPL 2027'], 'Conferences are alphabetical, not ordered by a ranking');
      await dialog.getByRole('button', { name: 'All', exact: true }).click();
      // A search matches a conference by its own name, not by the shared template's name.
      await dialog.getByRole('searchbox', { name: 'Search templates' }).fill('pldi');
      assert.deepEqual(await venues.allInnerTexts(), ['PLDI 2027']);
      await venues.first().click();
      await chosen.getByText('PACMPL (POPL, PLDI, ICFP, OOPSLA) · pdfLaTeX', { exact: true }).waitFor();
      await chosen.getByRole('button', { name: 'Change…', exact: true }).click();
      await dialog.getByRole('searchbox', { name: 'Search templates' }).fill('tsinghua');
      assert.deepEqual(await grid.getByRole('listitem').allInnerTexts().then(items => items.map(item => item.split('\n')[0])), ['Tsinghua University Thesis']);
      await page.setViewportSize({ width: 360, height: 740 });
      assert.ok(await dialog.locator('.modal').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The template grid fits a phone');
      await page.screenshot({ path: 'test-results/create-paper-templates-mobile.png', animations: 'disabled' });
      await page.setViewportSize({ width: 1280, height: 800 });
      await grid.getByRole('listitem').first().click();
      await chosen.getByText('XeLaTeX', { exact: true }).waitFor();
      await chosen.getByRole('button', { name: 'Change…', exact: true }).click();
      await dialog.getByRole('button', { name: 'Theses', exact: true }).waitFor();
      await dialog.getByRole('searchbox', { name: 'Search templates' }).fill('');
      await grid.getByRole('listitem').filter({ hasText: 'Tsinghua' }).click();
      await page.screenshot({ path: 'test-results/create-paper-templates.png', animations: 'disabled' });
    }
    await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).fill('Thesis');
    await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Stop here.' }).waitFor();
    assert.deepEqual(requests.at(-1).template, link ? { id: 'neurips', version: '2026' } : { id: 'thuthesis', version: '7.6.0' });
    if (link?.version === '2026') {
      // Tabs retain each draft, but a blank creation never inherits a template.
      await dialog.getByRole('tab', { name: 'Import', exact: true }).click();
      const url = dialog.getByRole('textbox', { name: 'Paper or repository link', exact: true });
      await url.fill('https://arxiv.org/abs/1706.03762');
      const blankTab = dialog.getByRole('tab', { name: 'Blank', exact: true });
      await blankTab.click();
      assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).inputValue(), 'Thesis');
      await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(requests.at(-1).template, undefined);
      await blankTab.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await dialog.getByRole('tab', { name: 'Import', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await url.inputValue(), 'https://arxiv.org/abs/1706.03762');
      await page.keyboard.press('End');
      assert.equal(await chosen.locator('strong').textContent(), 'NeurIPS 2026');
      await chosen.getByRole('button', { name: 'Change…', exact: true }).click();
      await dialog.getByRole('listitem').filter({ hasText: 'Example project' }).click();
      await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(requests.at(-1).example, true); assert.equal(requests.at(-1).template, undefined);
      await dialog.getByRole('tab', { name: 'Import', exact: true }).click();
      await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const switcher = page.getByRole('button', { name: 'Paper: Local paper', exact: true });
      for (const [entry, tab] of [['New paper…', 'Blank'], ['Import', 'Import']]) {
        await switcher.click(); await page.getByRole('menuitem', { name: entry, exact: true }).click();
        assert.equal(await dialog.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected'), 'true', 'Ordinary entries do not reuse a closed template link');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await switcher.evaluate(element => element === document.activeElement), true);
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Create paper from empty state and switcher, native Windows/WSL picker paths, browser host location, mobile layout, retry across reload, workspace compilation errors, Universe templates and website links');
} finally { await browser.close(); await server.close(); }
