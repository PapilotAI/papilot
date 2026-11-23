import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

// Settings → Agents: turning agents off, hiding models and resetting both
// change what the model pickers offer.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
fs.mkdirSync('test-results', { recursive: true });
const model = (id, name, isDefault = false) => ({ id, name, isDefault, efforts: [], defaultEffort: null });
const ready = models => ({ installed: true, connected: true, authenticated: true, account: 'author@example.com', error: null, models });
const missing = { installed: false, connected: false, authenticated: false, account: null, error: null, models: [] };

try {
  for (const [width, dark, language] of [[1280, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    const runtimes = {
      codex: ready([model('sol', 'GPT-6.1 Sol', true), model('luna', 'GPT-6 Luna'), model('nova', 'GPT-6 Nova')]),
      claude: ready([model('opus', 'Opus 5.5', true), model('haiku', 'Haiku 5.5')]),
      kimi: ready([model('k3', 'Kimi K3', true)]),
      opencode: ready([model('big-pickle', 'Big Pickle', true), ...['deepseek/v4-pro', 'deepseek/v4-flash', 'google/gemini-3', 'google/gemini-3-flash', 'openai/gpt-6', 'openai/gpt-6-mini', 'qwen/qwen-4'].map(id => model(id, id))]),
      papilot: missing,
    };
    const state = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [], requests: [], runtime: runtimes.codex, runtimes };
    const changes = [];
    await context.addInitScript(language => {
      localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); localStorage.setItem('papilot:project', 'paper');
      localStorage.setItem('papilot:agent', 'codex');
    }, language);
    await context.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/state') return route.fulfill({ json: state });
      if (pathname === '/api/agent-settings') {
        const change = route.request().postDataJSON(); changes.push(change);
        if (change.reset) for (const runtime of Object.values(runtimes)) { delete runtime.hidden; delete runtime.hiddenModels; }
        if (change.enabled !== undefined) { if (change.enabled) delete runtimes[change.agent].hidden; else runtimes[change.agent].hidden = true; }
        if (change.hiddenModels) { if (change.hiddenModels.length) runtimes[change.agent].hiddenModels = change.hiddenModels; else delete runtimes[change.agent].hiddenModels; }
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], ok: true } });
      if (pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: false, noteAlternativeRange: 'few' } });
      if (pathname === '/api/indirect-changes') return route.fulfill({ json: { indirectChanges: false } });
      if (pathname.startsWith('/api/updates')) return route.fulfill({ json: { currentVersion: 'test', phase: 'idle', canUpdate: false } });
      if (pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, annotations: [], build: { status: 'building', current: false } } });
      if (pathname.endsWith('/files')) return route.fulfill({ json: { document: null, files: [] } });
      if (pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
      if (pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main', ahead: 0, behind: 0 } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const desktop = width >= 600;
    const picker = page.locator('.new-task-panel').getByRole('button', { name: 'Agent settings', exact: true });
    const menu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
    const option = name => menu.getByRole('option', { name, exact: true });
    if (desktop) {
      await picker.click();
      for (const name of ['Haiku 5.5 · Claude', 'GPT-6 Luna · Codex', 'Kimi K3 · Kimi']) await expect(option(name)).toHaveCount(1);
      await menu.press('Escape');
    }
    const openAgents = async () => {
      if (!desktop) await page.locator('.sidebar-toggle').click();
      await page.locator('.settings-link').click();
      await page.locator('[data-settings-page="agents"]').click();
    };
    await openAgents();
    const card = id => page.locator(`[data-agent="${id}"]`);
    const toggle = id => card(id).getByRole('switch');
    const choices = page.locator('.runtime-agent-choices');
    await expect(choices).toHaveCount(0);
    await expect(toggle('claude')).toBeChecked();
    await expect(card('collaboration').getByRole('switch')).toHaveCount(0);
    await expect(card('papilot').getByRole('switch'), 'an agent that is not installed has no switch').toHaveCount(0);
    await toggle('claude').click();
    await expect(card('claude')).toHaveAttribute('data-availability', 'off');
    await expect(toggle('claude')).not.toBeChecked();
    assert.deepEqual(changes.at(-1), { agent: 'claude', enabled: false });
    // A switch turns an agent on with the keyboard, too.
    await toggle('kimi').focus(); await page.keyboard.press('Space');
    await expect(card('kimi')).toHaveAttribute('data-availability', 'off');
    await page.keyboard.press('Space');
    await expect(card('kimi')).toHaveAttribute('data-availability', 'ready');

    await card('codex').locator('.diagnostic-agent-button').click();
    const models = page.locator('.runtime-agent-detail').getByRole('group');
    await expect(models.getByRole('button')).toHaveCount(2);
    await expect(models.getByRole('button', { name: 'GPT-6.1 Sol' }), 'the default model cannot be hidden').toHaveCount(0);
    await models.getByRole('button', { name: 'GPT-6 Luna' }).click();
    await expect(models.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'false');
    assert.deepEqual(changes.at(-1), { agent: 'codex', hiddenModels: ['luna'] });
    if (language === 'en') {
      await expect(choices).toContainText('1 agent off and 1 model hidden');
      await expect(page.locator('.runtime-agent-detail')).toContainText('2 of 3');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/agent-choices-${width}-${dark ? 'dark' : 'light'}-${language}.png`, animations: 'disabled' });

    if (desktop) {
      await page.locator('.modal-close').click();
      await picker.click();
      await expect(menu.getByRole('group', { name: 'Claude', exact: true }), 'an agent that is off leaves the picker').toHaveCount(0);
      await expect(option('GPT-6 Luna · Codex'), 'a hidden model leaves the picker').toHaveCount(0);
      for (const name of ['GPT-6.1 Sol · Codex', 'GPT-6 Nova · Codex', 'Kimi K3 · Kimi']) await expect(option(name)).toHaveCount(1);
      await page.screenshot({ path: `test-results/agent-choices-picker-${width}.png`, animations: 'disabled' });
      await menu.press('Escape');
      await openAgents();
      await choices.getByRole('button', { name: 'Reset' }).click();
      assert.deepEqual(changes.at(-1), { reset: true });
      await expect(choices).toHaveCount(0);
      await expect(card('claude')).toHaveAttribute('data-availability', 'ready');
      await card('codex').locator('.diagnostic-agent-button').click();
      await expect(models.getByRole('button', { name: 'GPT-6 Luna' })).toHaveAttribute('aria-pressed', 'true');
      // Hide all, then show all, for one agent's models.
      await page.locator('.runtime-models-actions').getByRole('button', { name: 'Hide all' }).click();
      assert.deepEqual(changes.at(-1), { agent: 'codex', hiddenModels: ['luna', 'nova'] });
      await expect(models.getByRole('button', { pressed: true })).toHaveCount(0);
      await page.locator('.runtime-models-actions').getByRole('button', { name: 'Show all' }).click();
      assert.deepEqual(changes.at(-1), { agent: 'codex', hiddenModels: [] });
      await expect(models.getByRole('button', { pressed: true })).toHaveCount(2);
      // A long catalog is searched, and Hide all then hides only the matches.
      await card('opencode').locator('.diagnostic-agent-button').click();
      await expect(models.getByRole('button')).toHaveCount(5);
      await page.getByRole('searchbox', { name: 'Search models' }).fill('deepseek');
      await expect(models.getByRole('button')).toHaveCount(2);
      await page.locator('.runtime-models-actions').getByRole('button', { name: 'Hide all' }).click();
      assert.deepEqual(changes.at(-1), { agent: 'opencode', hiddenModels: ['deepseek/v4-pro', 'deepseek/v4-flash'] });
      await page.getByRole('searchbox', { name: 'Search models' }).fill('');
      await expect(page.locator('.runtime-agent-detail')).toContainText('6 of 8');
      await page.screenshot({ path: `test-results/agent-choices-search-${width}.png`, animations: 'disabled' });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Agent choices: switches, hidden models, picker filtering and reset passed on desktop/mobile, light/dark, English/Chinese.');
} finally { await browser.close(); await server.close(); }
