import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { selectOption, selectedValue } from './select.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
fs.mkdirSync('test-results', { recursive: true });
const errors = [];
try {
  for (const [width, dark, language] of [[1360, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    const runtime = { connected: true, authenticated: true, installed: true, account: 'Fixture', error: null, models: [{ id: 'gpt-test', name: 'Test model', isDefault: true, efforts: ['medium', 'high'], defaultEffort: 'high', fastMode: { serviceTier: 'fast', description: 'Priority processing.' } }] };
    const gemini = { ...runtime, models: [{ id: 'gemini-test', name: 'Gemini Test', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }] };
    const opencode = { ...runtime, models: [{ id: 'provider/flash-test', name: 'Flash Test', isDefault: false, efforts: ['low', 'high', 'max'], defaultEffort: null }] };
    const collabRuntime = { connected: true, authenticated: true, installed: true, account: 'Papilot Collaboration Mode', error: null, hidden: true, models: [{ id: 'balanced', name: 'Balanced · Auto route & race', isDefault: true, efforts: [], defaultEffort: null }, { id: 'fast', name: 'Fast · Route only', isDefault: false, efforts: [], defaultEffort: null }, { id: 'thorough', name: 'Thorough · Race & verify', isDefault: false, efforts: [], defaultEffort: null }] };
    const state = { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime, runtimes: { codex: runtime, collaboration: collabRuntime, antigravity: gemini, opencode } };
    const codexRoute = { agent: 'codex', model: null, effort: null };
    let fail = false, saves = 0, hold = null;
    let config = { router: null, judge: null, routes: { quick: codexRoute, polish: codexRoute, rigorous: codexRoute }, racers: [] };
    const resolved = () => ({
      router: config.router || { agent: 'opencode', model: 'provider/flash-test', effort: null },
      judge: config.judge || { agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' },
      routes: {
        quick: config.routes.quick || { agent: 'opencode', model: 'provider/flash-test', effort: null },
        polish: config.routes.polish || { agent: 'antigravity', model: 'gemini-test', effort: 'medium' },
        rigorous: config.routes.rigorous || { agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' },
      },
      racers: config.racers.length ? config.racers : [{ agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' }, { agent: 'antigravity', model: 'gemini-test', effort: 'medium' }],
    });
    const settingsReply = () => ({ enabled: !state.runtimes.collaboration.hidden, ...config, resolved: resolved(), readOnlyAgents: { codex: true, antigravity: true, opencode: true } });
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/collaboration') {
        if (route.request().method() === 'GET') return route.fulfill({ json: settingsReply() });
        saves++;
        if (hold) await hold;
        if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture save failed' } });
        const change = route.request().postDataJSON();
        if (change.reset) config = { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [] };
        if (change.enabled !== undefined) state.runtimes.collaboration.hidden = !change.enabled;
        if (change.router !== undefined) config.router = change.router;
        if (change.judge !== undefined) config.judge = change.judge;
        if (change.routes) config.routes = change.routes;
        if (change.racers !== undefined) config.racers = change.racers;
        return route.fulfill({ json: settingsReply() });
      }
      if (url.pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], checkedAt: Date.now() } });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    if (width < 600) await page.locator('.sidebar-toggle').click();
    await page.locator('.settings-link').click();
    await page.locator('[data-settings-page="agents"]').click();
    await expect(page.locator('[data-agent="collaboration"]')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="experiments"]').click();
    const disclosure = page.locator('.collaboration-settings'), toggle = disclosure.getByRole('switch').first();
    await expect(toggle).toBeVisible(); await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleName(language === 'zh-CN' ? '启用协作模式' : 'Enable collaboration mode');
    if (language === 'en') {
      fail = true; await toggle.click(); await expect(disclosure.getByRole('alert')).toContainText('Fixture save failed'); await expect(toggle).not.toBeChecked(); fail = false;
    }
    await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).toBeChecked();
    await expect(disclosure.getByRole('alert')).toHaveCount(0);
    // Active team interactive board: Router, Race pool (+ / -), Judge, and Direct roles all live in the graph.
    await expect(disclosure.locator('.collab-board')).toBeVisible();
    await expect(disclosure.locator('[data-role="router"]')).toBeVisible();
    await expect(disclosure.locator('[data-role="judge"]')).toBeVisible();
    await expect(disclosure.locator('[data-role="quick"], [data-role="polish"], [data-role="rigorous"]')).toHaveCount(3);
    // Clicking Polish node opens the docked inspector with its model picker, Fast mode toggle, and effort slider.
    await disclosure.locator('[data-role="polish"]').click();
    const inspector = disclosure.locator('.collab-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('[role="combobox"]')).toContainText('Codex');
    await expect(inspector.locator('.collaboration-fast [role="switch"]')).toBeVisible();
    await selectOption(inspector.locator('[role="combobox"]'), JSON.stringify(['antigravity', 'gemini-test']));
    await expect.poll(() => config.routes.polish).toEqual({ agent: 'antigravity', model: 'gemini-test', effort: 'medium' });
    const effort = inspector.getByRole('slider');
    await effort.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => config.routes.polish.effort).toBe('high');
    // Saves go one at a time, so a slow answer for an earlier level cannot undo a later one.
    let release; hold = new Promise(resolve => { release = resolve; });
    const before = saves;
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect.poll(() => saves).toBe(before + 1);
    await page.waitForTimeout(300); assert.equal(saves, before + 1, 'the second save waits for the first');
    await expect(effort).toHaveValue('0');
    hold = null; release();
    await expect.poll(() => saves).toBe(before + 2);
    await expect.poll(() => config.routes.polish.effort).toBe('low');
    await page.waitForTimeout(300); await expect(effort).toHaveValue('0');
    // Switch to Quick node on the graph and configure effort.
    await disclosure.locator('[data-role="quick"]').click();
    await selectOption(inspector.locator('[role="combobox"]'), JSON.stringify(['opencode', 'provider/flash-test']));
    await inspector.getByRole('slider').focus(); await page.keyboard.press('End');
    await expect.poll(() => config.routes.quick).toEqual({ agent: 'opencode', model: 'provider/flash-test', effort: 'max' });
    assert.deepEqual(config.routes.rigorous, codexRoute);
    // Race pool: + button adds a 3rd model right on the graph, and - removes it cleanly.
    await expect(disclosure.locator('.collaboration-racer-row')).toHaveCount(2);
    await disclosure.locator('.collab-add-btn').click();
    await expect(disclosure.locator('.collaboration-racer-row')).toHaveCount(3);
    await expect(inspector).toHaveAttribute('data-inspecting', 'racer-2');
    await disclosure.locator('.collab-remove-btn').nth(2).click();
    await expect(disclosure.locator('.collaboration-racer-row')).toHaveCount(2);
    // Router and Judge nodes are directly clickable on the graph.
    await disclosure.locator('[data-role="router"]').click();
    await expect(inspector).toHaveAttribute('data-inspecting', 'router');
    await disclosure.locator('[data-role="judge"]').click();
    await expect(inspector).toHaveAttribute('data-inspecting', 'judge');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/collaboration-${width}-${language}.png`, animations: 'disabled' });
    await page.locator('.modal-close').click(); await page.reload(); if (width < 600) await page.locator('.sidebar-toggle').click(); await page.locator('.settings-link').click();
    if (width < 600) await page.locator('[data-settings-page="general"]').click();
    // General settings' second combobox is the default agent/model, after language.
    const model = page.locator('.settings-content-general [role="combobox"]').nth(1);
    await selectOption(model, JSON.stringify(['collaboration', 'balanced']));
    assert.equal(await selectedValue(model), JSON.stringify(['collaboration', 'balanced']));
    await expect(model).toContainText(language === 'zh-CN' ? '协作模式' : 'Collaboration mode');
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="experiments"]').click();
    await expect(toggle).toBeChecked();
    // Saved on the host: the routes come back after reloading.
    await expect(disclosure.locator('[data-role="polish"]')).toContainText('Gemini Test');
    await toggle.click(); await expect(toggle).not.toBeChecked(); await expect(disclosure.locator('.collab-board')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="general"]').click();
    await expect(model).toContainText('Codex');
    assert.equal(saves, language === 'en' ? 11 : 10);
    config = { router: null, judge: null, routes: { quick: codexRoute, polish: codexRoute, rigorous: codexRoute }, racers: [] };
    await context.close();
  }
  assert.deepEqual(errors, []); console.log('Collaboration mode: hidden settings, enable/disable, role workers and efforts, errors, persistence, keyboard and mobile layouts checked.');
} finally { await browser.close(); await server.close(); }
