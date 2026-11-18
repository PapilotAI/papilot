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
const missing = { installed: false, connected: false, authenticated: false, account: null, error: null, models: [] };
const ready = { ...missing, installed: true, connected: true, authenticated: true, account: 'Local Pi configuration', models: [{ id: 'custom/research', name: 'Research model', source: 'custom', isDefault: true, efforts: ['off', 'medium', 'high'], defaultEffort: 'medium' }] };
const errors = [];
fs.mkdirSync('test-results', { recursive: true });
async function fixture(width, dark, language = 'en') {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
  const state = { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: missing, runtimes: { codex: missing, pi: missing, papilot: { ...missing, installed: true, connected: true } } };
  let fail = false, reconnects = 0;
  await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
  await context.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/state') return route.fulfill({ json: state });
    if (pathname === '/api/reconnect') {
      reconnects++;
      if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture connection failed' } });
      state.runtimes.pi = ready; return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], ok: true } });
    if (pathname.startsWith('/api/updates')) return route.fulfill({ json: { currentVersion: 'test', phase: 'idle', canUpdate: false } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  if (width < 600) await page.locator('.sidebar-toggle').click();
  await page.locator('.settings-link').click(); await page.locator('[data-settings-page="agents"]').click();
  await page.locator('[data-agent="pi"] button').click();
  return { context, page, state, setFailure: value => { fail = value; }, reconnects: () => reconnects };
}
try {
  for (const [width, dark, language] of [[1280, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const f = await fixture(width, dark, language), { page } = f;
    const panel = page.locator('.runtime-agent-detail'), pi = page.locator('[data-agent="pi"]');
    await expect(pi).toHaveAttribute('data-availability', 'missing');
    await expect(page.locator('[data-agent="papilot"]')).toHaveCount(1);
    await expect(panel.locator('.runtime-agent-command')).toHaveText('pi → /login');
    await panel.locator('.runtime-agent-detection summary').click();
    await expect(panel).toContainText('PAPILOT_PI_BIN');
    await expect(panel.locator('.runtime-agent-installation')).toContainText(language === 'en' ? 'Tools run on the host' : '在主机上运行');
    await panel.locator('.runtime-agent-header').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/pi-setup-${width}-${language}.png`, animations: 'disabled' });
    await panel.locator('.runtime-agent-detection summary').click();
    if (language === 'en') {
      f.setFailure(true);
      await panel.getByRole('button', { name: 'Reconnect', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('Could not reconnect');
      f.setFailure(false);
      await panel.getByRole('button', { name: 'Reconnect', exact: true }).click();
    } else await panel.locator('.runtime-agent-help .runtime-setup-actions button').click();
    await expect(pi).toHaveAttribute('data-availability', 'ready');
    await expect(panel).toContainText('Research model');
    await expect(panel).toContainText('Local Pi configuration');
    assert.equal(f.reconnects(), language === 'en' ? 2 : 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/pi-ready-${width}-${language}.png`, animations: 'disabled' });
    await panel.locator('.runtime-agent-header button').click();
    await expect(pi.locator('button')).toBeFocused();
    if (language === 'en') {
      if (width < 600) await page.locator('.settings-mobile-back').click();
      await page.locator('[data-settings-page="general"]').click();
      const choice = page.getByRole('combobox', { name: 'Default model', exact: true });
      await selectOption(choice, JSON.stringify(['pi', 'custom/research']));
      assert.equal(await selectedValue(choice), JSON.stringify(['pi', 'custom/research']));
      await expect(choice).toContainText('Pi');
      await expect(page.getByRole('slider', { name: 'Default reasoning effort' })).toBeVisible();
    }
    await f.context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Pi settings: desktop/mobile, light/dark, English/Chinese, missing, recovery, models and Writer separation passed.');
} finally { await browser.close(); await server.close(); }
