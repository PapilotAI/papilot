import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const missing = { installed: false, connected: false, authenticated: false, account: null, error: null, models: [] };
const errors = [];
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const [width, dark, language] of [[1280, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    const state = { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: missing,
      runtimes: { codex: missing, papilot: { ...missing, installed: true, connected: true }, qoder: missing, codebuddy: missing, workbuddy: missing } };
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    await context.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/state') return route.fulfill({ json: state });
      if (pathname === '/api/reconnect') {
        state.runtimes.codebuddy = { ...missing, installed: true, connected: true, authenticated: true, account: 'CodeBuddy CLI',
          models: [{ id: 'research', name: 'Research model', isDefault: true, efforts: [], defaultEffort: null }] };
        for (const id of ['qoder', 'workbuddy']) state.runtimes[id] = { ...missing, installed: true, error: 'Authentication required' };
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], ok: true } });
      if (pathname.startsWith('/api/updates')) return route.fulfill({ json: { currentVersion: 'test', phase: 'idle', canUpdate: false } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    if (width < 600) await page.locator('.sidebar-toggle').click();
    await page.locator('.settings-link').click();
    await page.locator('[data-settings-page="agents"]').click();
    for (const id of ['qoder', 'codebuddy', 'workbuddy']) {
      const card = page.locator(`[data-agent="${id}"]`);
      await expect(card).toHaveAttribute('data-availability', 'missing');
      await card.locator('button').click();
      const panel = page.locator('.runtime-agent-detail');
      await panel.locator('.runtime-agent-detection summary').click();
      await expect(panel).toContainText(`PAPILOT_${id.toUpperCase()}_BIN`);
      await expect(card.locator('.brand-icon')).toHaveAttribute('data-brand', id);
      await panel.locator('.runtime-agent-header').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/${id}-setup-${width}-${language}.png`, animations: 'disabled' });
      await panel.locator('.runtime-agent-header button').click();
      await expect(card.locator('button')).toBeFocused();
    }
    await page.locator('[data-agent="codebuddy"] button').click();
    await page.locator('.runtime-agent-help .runtime-setup-actions button').click();
    await expect(page.locator('[data-agent="codebuddy"]')).toHaveAttribute('data-availability', 'ready');
    await expect(page.locator('.runtime-agent-detail')).toContainText('Research model');
    for (const id of ['qoder', 'workbuddy']) await expect(page.locator(`[data-agent="${id}"]`)).toHaveAttribute('data-availability', 'unavailable');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/local-agents-ready-${width}-${language}.png`, animations: 'disabled' });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Local agents: desktop/mobile, light/dark, English/Chinese, setup, reconnect and authentication failures passed.');
} finally { await browser.close(); await server.close(); }
