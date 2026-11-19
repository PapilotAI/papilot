import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

// Long translations and user-provided text must fit the content area, even
// when an outer dialog clips overflow instead of exposing a page scrollbar.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const languages = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'sv'];
const runtime = { connected: true, authenticated: true, account: 'researcher.with.a.long.account.name@example-university.edu', error: null,
  models: [{ id: 'model', name: 'Research model with extended context and high reasoning', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' }] };
const state = { version: '0.9.4-dev.' + 'a'.repeat(40), csrf: 'fixture', projects: [], tasks: [], requests: [], runtime };
const update = { currentVersion: state.version, latestVersion: '0.9.4-dev.' + 'b'.repeat(40), phase: 'failed', checkedAt: 1, canUpdate: true, channel: 'dev',
  error: 'Could not access C:\\Users\\Researcher\\AppData\\Local\\Papilot\\updates\\releases\\papilot-development-build-with-a-long-directory-name\\package.json' };
const errors = [];
let cases = 0;
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const language of languages) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
    await context.addInitScript(language => {
      localStorage.setItem('papilot:language', language);
      localStorage.setItem('papilot:setup-seen', '1');
    }, language);
    // A nightly PhiTeX's long version; choosing a compiler saves it here.
    const compiler = { compiler: 'phitex', phitex: '1.0.5-nightly.202611180235' }, chosen = [];
    await context.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/runtime/compiler') {
        const choice = route.request().postDataJSON()?.compiler;
        if (choice) { chosen.push(choice); compiler.compiler = choice; }
        return route.fulfill({ json: compiler });
      }
      if (pathname === '/api/state') return route.fulfill({ json: state });
      if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (pathname === '/api/runtime/requirements') return route.fulfill({ json: { platform: 'win32', checks: ['git', 'latexmk', 'synctex', 'tex-engine'].map(id => ({ id, ok: false })) } });
      if (pathname === '/api/runtime/latex') return route.fulfill({ json: { distribution: 'MiKTeX', version: '26.10', path: 'C:\\Users\\Researcher.with.a.very.long.university.username\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64' } });
      if (pathname === '/api/diagnostics') return route.fulfill({ json: { version: '0.9.4', checkedAt: 1, platform: 'win32', arch: 'x64', node: '24.22.2', ok: true, checks: [] } });
      if (pathname.startsWith('/api/updates')) return route.fulfill({ json: update });
      if (pathname === '/api/quick-notes') return route.fulfill({ json: { quickNotes: [
        { id: 'custom-reference', label: 'Literaturverzeichnis', instruction: 'Check the bibliography against the cited source.', icon: 'book' }, { id: 'polish' },
      ] } });
      if (pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('.settings-link').click();
    await page.locator('.settings-dialog').waitFor();
    const pages = await page.locator('[data-settings-page]').evaluateAll(elements => elements.map(element => element.dataset.settingsPage));
    for (const width of [320, 390, 768, 900, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 640 : 620 });
      for (const name of pages) {
        const category = page.locator(`[data-settings-page="${name}"]`);
        if (width <= 680 && name === 'shortcuts') {
          if (!await page.locator('.settings-sidebar').isVisible()) await page.locator('.settings-mobile-back').click();
          await expect(category).toBeHidden();
          continue;
        }
        if (!await category.isVisible()) await page.locator('.settings-mobile-back').click();
        if (language === 'en' && name === 'about' && width < 500) {
          await category.scrollIntoViewIfNeeded();
          const sidebar = await page.locator('.settings-sidebar').boundingBox();
          const title = await page.locator('.settings-sidebar-title').boundingBox();
          const footer = await page.locator('.settings-footer').boundingBox();
          assert.ok(Math.abs(title.y - sidebar.y) <= 1, `${width}px: the phone settings heading stays visible at the end of the category list`);
          assert.ok(footer.y + footer.height <= sidebar.y + sidebar.height, `${width}px: the settings footer stays in view`);
          await expect(category).toBeInViewport();
          await page.screenshot({ animations: 'disabled', path: `test-results/settings-navigation-${width}.png` });
        }
        await category.click();
        if (name === 'latex') await page.locator('.latex-installation-facts').waitFor();
        if (name === 'experiments') await expect(page.locator('.phitex-experiment').getByRole('switch')).toBeChecked();
        if (name === 'updates') await page.locator('.settings-content-updates [role=alert]').waitFor();
        if (name === 'skills') await expect(page.locator('.skill-library-new')).toBeEnabled();
        if (name === 'quickNotes') await page.locator('.quick-note-text strong').getByText('Literaturverzeichnis', { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (width > 760) {
          const sidebar = await page.locator('.settings-sidebar').boundingBox();
          const title = await page.locator('.settings-sidebar-title').boundingBox();
          assert.ok(Math.abs(title.y - sidebar.y) <= 1, `${language}/${width}/${name}: scrolling to a category keeps the sidebar heading in place`);
        }
        const content = page.locator('.settings-content');
        const overflow = await content.evaluate(root => {
          const issues = [root, ...root.querySelectorAll('*')].filter(element => {
            const box = element.getBoundingClientRect(), style = getComputedStyle(element);
            if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'inline' || style.overflowX !== 'visible' || element.scrollWidth <= element.clientWidth + 2) return false;
            // About-page hover backgrounds extend into the card's padding.
            if (element.matches('.settings-resource, .settings-project-license, .settings-project-license>summary') && element.scrollWidth <= element.clientWidth + 10) return false;
            return true;
          }).map(element => ({ element: element.className || element.tagName, text: element.textContent.slice(0, 100), width: element.clientWidth, scroll: element.scrollWidth }));
          if (root.scrollWidth > root.clientWidth + 2) issues.push({ element: 'settings-content', width: root.clientWidth, scroll: root.scrollWidth });
          return issues;
        });
        const label = `${language}/${width}/${name}`;
        if (overflow.length) await page.screenshot({ path: `test-results/settings-overflow-${language}-${width}-${name}.png` });
        assert.deepEqual(overflow, [], label);
        if (name === 'git' && ['en', 'zh-Hans'].includes(language) && [320, 390, 1280].includes(width)) {
          const choice = page.locator('.settings-content-git .chip-select[role="combobox"]');
          await expect(choice).toHaveAttribute('data-value', 'auto');
          // Keyboard selection keeps the interface language unchanged.
          await choice.focus(); await choice.press('Home'); await choice.press('ArrowDown'); await choice.press('Enter');
          await expect(choice).toHaveAttribute('data-value', 'en');
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          for (const colorScheme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
            await expect(choice).toHaveCSS('background-color', colorScheme === 'dark' ? 'rgb(56, 56, 56)' : 'rgb(245, 245, 245)');
            await page.screenshot({ animations: 'disabled', path: `test-results/settings-commit-language-${language}-${width}-${colorScheme}.png` });
          }
          await choice.click();
          await page.screenshot({ animations: 'disabled', path: `test-results/settings-commit-language-menu-${language}-${width}.png` });
          await choice.press('Home'); await choice.press('Enter');
          await expect(choice).toHaveAttribute('data-value', 'auto');
          await page.emulateMedia({ colorScheme: 'light' });
        }
        if (language === 'en' && name === 'general' && [320, 1280].includes(width)) {
          const slider = page.locator('.settings-effort input[type="range"]');
          for (const colorScheme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
            await slider.focus();
            // The native hit target sits above the drawn track and thumb;
            // a text-field focus fill would hide both while using the keyboard.
            await expect(slider).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await page.screenshot({ animations: 'disabled', path: `test-results/settings-slider-${width}-${colorScheme}.png` });
          }
          await page.emulateMedia({ colorScheme: 'light' });
        }
        if (name === 'review') {
          const alternatives = page.locator('.settings-note-options');
          await expect(alternatives.getByRole('slider', { name: await alternatives.locator('label').innerText(), exact: true })).toHaveCount(1);
          const labels = await alternatives.locator('.note-count-scale span').evaluateAll(elements => elements.map(element => {
            const bounds = element.getBoundingClientRect();
            return { text: element.textContent, left: bounds.left, right: bounds.right };
          }));
          for (let index = 1; index < labels.length; index++) {
            assert.ok(labels[index].left >= labels[index - 1].right + 1,
              `${label}: alternative labels ${labels[index - 1].text} and ${labels[index].text} stay separated`);
          }
        }
        if (language === 'en' && name === 'experiments' && [390, 1280].includes(width)) {
          for (const colorScheme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme });
            await page.locator('.settings-content').screenshot({ animations: 'disabled', path: `test-results/settings-experiments-${width}-${colorScheme}.png` });
          }
          await page.emulateMedia({ colorScheme: 'light' });
          if (width === 1280) {
            // Turning it off saves latexmk for this host. It cannot be turned
            // on while PhiTeX is not installed.
            const phitex = page.locator('.phitex-experiment').getByRole('switch', { name: 'Compile with PhiTeX' });
            await phitex.click();
            await expect(phitex).not.toBeChecked();
            assert.deepEqual(chosen, ['latexmk']);
            compiler.phitex = null;
            await page.locator('[data-settings-page="general"]').click();
            await category.click();
            await expect(phitex).toBeDisabled();
            await expect(page.getByRole('link', { name: 'phitex.org' })).toHaveAttribute('href', 'https://phitex.org');
            await page.locator('.settings-content').screenshot({ animations: 'disabled', path: 'test-results/settings-experiments-missing.png' });
            Object.assign(compiler, { compiler: 'phitex', phitex: '1.0.5-nightly.202611180235' });
            await page.locator('[data-settings-page="general"]').click();
            await category.click();
            await expect(phitex).toBeChecked();
          }
        }
        if (name === 'skills') {
          assert.ok((await page.locator('.skill-library-search input').boundingBox()).width >= 100, `${label}: search keeps enough room to type`);
          await expect(page.locator('.skill-library-new')).toBeInViewport();
        }
        if (width === 320 && ['de', 'fr', 'ja', 'pt'].includes(language)) {
          const detail = name === 'quickNotes' ? '.quick-note-row' : name === 'appearance' ? '.appearance-colors-card' : name === 'notifications' ? '.settings-notification-event' : null;
          if (detail) await page.locator(detail).first().scrollIntoViewIfNeeded();
          await page.screenshot({ animations: 'disabled', path: `test-results/settings-layout-${language}-${name}.png` });
        }
        cases++;
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Settings layout passed: ${cases} page/viewport/language combinations, long names, paths, statuses, and usable skill search.`);
} finally { await browser.close(); await server.close(); }
