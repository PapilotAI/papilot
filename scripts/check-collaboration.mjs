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
    const runtime = { connected: true, authenticated: true, installed: true, account: 'Fixture', error: null, models: [{ id: 'gpt-test', name: 'Test model', isDefault: true, efforts: [], defaultEffort: null }] };
    const gemini = { ...runtime, models: [{ id: 'gemini-test', name: 'Gemini Test', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }] };
    const opencode = { ...runtime, models: [{ id: 'provider/flash-test', name: 'Flash Test', isDefault: false, efforts: ['low', 'high', 'max'], defaultEffort: null }] };
    const state = { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime, runtimes: { codex: runtime, collaboration: { ...runtime, hidden: true }, antigravity: gemini, opencode } };
    const codexRoute = { agent: 'codex', model: null, effort: null };
    let fail = false, saves = 0, hold = null, routes = { quick: codexRoute, polish: codexRoute, rigorous: codexRoute };
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/collaboration') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: !state.runtimes.collaboration.hidden, routes } });
        saves++;
        if (hold) await hold;
        if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture save failed' } });
        const change = route.request().postDataJSON();
        if (change.enabled !== undefined) state.runtimes.collaboration.hidden = !change.enabled;
        if (change.routes) routes = change.routes;
        return route.fulfill({ json: { enabled: !state.runtimes.collaboration.hidden, routes } });
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
    await page.locator('[data-settings-page="about"]').click();
    const disclosure = page.locator('.workflow-experiments'), toggle = disclosure.getByRole('switch');
    await expect(toggle).not.toBeVisible();
    await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(toggle).toBeVisible(); await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleName(language === 'zh-CN' ? '启用协作模式' : 'Enable collaboration mode');
    if (language === 'en') {
      fail = true; await toggle.click(); await expect(disclosure.getByRole('alert')).toContainText('Fixture save failed'); await expect(toggle).not.toBeChecked(); fail = false;
    }
    await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).toBeChecked();
    await expect(disclosure.getByRole('alert')).toHaveCount(0);
    // Each role picks a worker from the host's catalogs, then its reasoning effort.
    const roles = disclosure.locator('.collaboration-route');
    await expect(roles).toHaveCount(3);
    const polish = disclosure.locator('[data-role="polish"]'), quick = disclosure.locator('[data-role="quick"]');
    await expect(polish.locator('[role="combobox"]')).toContainText('Codex');
    await expect(polish.getByRole('slider')).toHaveCount(0);
    await selectOption(polish.locator('[role="combobox"]'), JSON.stringify(['antigravity', 'gemini-test']));
    await expect.poll(() => routes.polish).toEqual({ agent: 'antigravity', model: 'gemini-test', effort: null });
    const effort = polish.getByRole('slider');
    await effort.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => routes.polish.effort).toBe('high');
    // Saves go one at a time, so a slow answer for an earlier level cannot undo a later one.
    let release; hold = new Promise(resolve => { release = resolve; });
    const before = saves;
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect.poll(() => saves).toBe(before + 1);
    await page.waitForTimeout(300); assert.equal(saves, before + 1, 'the second save waits for the first');
    await expect(effort).toHaveValue('0');
    hold = null; release();
    await expect.poll(() => saves).toBe(before + 2);
    await expect.poll(() => routes.polish.effort).toBe('low');
    await page.waitForTimeout(300); await expect(effort).toHaveValue('0');
    await selectOption(quick.locator('[role="combobox"]'), JSON.stringify(['opencode', 'provider/flash-test']));
    await quick.getByRole('slider').focus(); await page.keyboard.press('End');
    await expect.poll(() => routes.quick).toEqual({ agent: 'opencode', model: 'provider/flash-test', effort: 'max' });
    assert.deepEqual(routes.rigorous, codexRoute);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: `test-results/collaboration-${width}-${language}.png`, animations: 'disabled' });
    await page.locator('.modal-close').click(); await page.reload(); if (width < 600) await page.locator('.sidebar-toggle').click(); await page.locator('.settings-link').click();
    if (width < 600) await page.locator('[data-settings-page="general"]').click();
    // General settings' second combobox is the default agent/model, after language.
    const model = page.locator('.settings-content-general [role="combobox"]').nth(1);
    await selectOption(model, JSON.stringify(['collaboration', 'gpt-test']));
    assert.equal(await selectedValue(model), JSON.stringify(['collaboration', 'gpt-test']));
    await expect(model).toContainText(language === 'zh-CN' ? '协作模式' : 'Collaboration mode');
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="about"]').click(); await disclosure.locator('summary').click();
    await expect(toggle).toBeChecked();
    // Saved on the host: the routes come back after reloading.
    await expect(disclosure.locator('[data-role="polish"] [role="combobox"]')).toContainText('Gemini Test');
    await toggle.click(); await expect(toggle).not.toBeChecked(); await expect(disclosure.locator('.collaboration-route')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="general"]').click();
    await expect(model).toContainText('Codex');
    assert.equal(saves, language === 'en' ? 9 : 8);
    routes = { quick: codexRoute, polish: codexRoute, rigorous: codexRoute };
    await context.close();
  }
  assert.deepEqual(errors, []); console.log('Collaboration mode: hidden settings, enable/disable, role workers and efforts, errors, persistence, keyboard and mobile layouts checked.');
} finally { await browser.close(); await server.close(); }
