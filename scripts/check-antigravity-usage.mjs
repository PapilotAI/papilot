import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { antigravityLimits } from '../src/server/antigravity-usage.ts';
import { accountUsage } from '../src/server/workspace.ts';

const quota = accountUsage(antigravityLimits(JSON.parse(fs.readFileSync(new URL('../tests/fixtures/antigravity-usage.json', import.meta.url), 'utf8'))));
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const existing of [false, true]) for (const mobile of [false, true]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ locale: 'en-US', colorScheme, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const task = { id: 'quota-task', projectId: 'paper', agent: 'antigravity', name: 'p-quota', title: 'Revise the introduction', instructions: 'Keep the meaning.', worktree: '/tmp/paper', threadId: 'thread', turnId: null, model: 'gemini', effort: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
    const runtime = { connected: true, authenticated: true, account: 'Google account', error: null, models: [{ id: 'gemini', name: 'Gemini', isDefault: true, efforts: [], defaultEffort: null }], usage: quota };
    const snapshot = { version: 'test', csrf: 'test', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: existing ? [task] : [], requests: [], runtime: { ...runtime, connected: false, authenticated: false, installed: false, usage: null }, runtimes: { antigravity: runtime, codex: { connected: false, authenticated: false, installed: false, models: [] } } };
    let refreshes = 0, failure = false, nextUsage = quota;
    await context.addInitScript(existing => {
      localStorage.setItem('papilot:agent', 'antigravity');
      if (existing) localStorage.setItem('papilot:task', 'quota-task');
    }, existing);
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/state') return json(snapshot);
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
      if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/items')) return json({ items: [] });
      if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
      if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
      if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
      if (url.pathname === '/api/runtime/antigravity/usage') {
        refreshes++;
        return failure ? route.fulfill({ status: 503, json: { error: 'Fixture quota failure' } }) : json({ usage: nextUsage });
      }
      if (url.pathname === '/api/quick-model') return route.fulfill({ json: { choice: null } });
      throw new Error(`Unexpected quota request: ${url.pathname}`);
    });
    await page.goto(`http://127.0.0.1:${server.server.address().port}`);
    if (mobile && existing) await page.getByRole('button', { name: 'Chat', exact: true }).click();
    if (mobile && !existing) await page.getByRole('button', { name: 'New task', exact: true }).click();
    const host = page.locator(existing ? '.activity-panel' : '.new-task-panel');
    await host.getByRole('button', { name: 'Agent settings', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
    await expect.poll(() => refreshes).toBe(1);
    const usage = menu.getByRole('region', { name: 'Antigravity usage', exact: true });
    await usage.locator('summary').click();
    await expect(usage.getByRole('meter', { name: 'Gemini Models · 5-hour limit used' })).toHaveAttribute('aria-valuenow', '50');
    await expect(usage.getByRole('meter', { name: 'Gemini Models · Weekly limit used' })).toHaveAttribute('aria-valuenow', '25');
    await expect(usage.getByRole('meter', { name: 'Claude and GPT models · Weekly limit used' })).toHaveAttribute('aria-valuenow', '100');
    await expect(usage.getByText('Limit reached', { exact: true })).toHaveCount(1);
    await expect(usage.locator('.usage-reset')).toHaveCount(3);
    await expect(usage.getByText('0% used', { exact: true })).toHaveCount(1);
    const box = await menu.boundingBox(), viewport = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'menu fits viewport');
    assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth), false, 'quota causes no horizontal overflow');
    await page.screenshot({ path: `test-results/quota-${existing ? 'task' : 'new'}-${mobile ? 'mobile' : 'desktop'}-${colorScheme}.png` });
    failure = true;
    await menu.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(menu.getByText('Usage not reported', { exact: true })).toBeVisible();
    await expect(menu.getByRole('meter')).toHaveCount(0);
    await expect(page.getByText('Fixture quota failure', { exact: true })).toHaveCount(0);
    // A state refresh carrying an old quota object must not undo the failure.
    snapshot.projects[0].name = 'Renamed paper';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.project-switcher-name')).toHaveText('Renamed paper');
    await expect(menu.getByText('Usage not reported', { exact: true })).toBeVisible();
    await expect(menu.getByRole('meter')).toHaveCount(0);
    failure = false; nextUsage = { ...quota, windows: [quota.windows[0]] };
    await menu.getByRole('button', { name: 'Refresh', exact: true }).click();
    await usage.locator('summary').click();
    await expect(usage.getByRole('meter')).toHaveCount(1);
    await expect(usage.getByText('5-hour limit', { exact: true })).toHaveCount(0);
    await menu.getByRole('combobox').press('Escape');
    await page.getByRole('textbox', { name: existing ? 'Instructions for Antigravity' : 'Describe the revision' }).fill('Continue editing.');
    await expect(page.getByRole('button', { name: existing ? 'Send instructions' : 'Start task', exact: true })).toBeEnabled();
    if (!existing) {
      // Settings uses the same picker, including fresh quota data and retries.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('[data-settings-page="git"]').click();
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      nextUsage = quota;
      const beforeSettings = refreshes;
      await page.locator('.settings-dialog').getByRole('button', { name: 'Agent settings', exact: true }).click();
      await expect.poll(() => refreshes).toBe(beforeSettings + 1);
      const settingsUsage = menu.getByRole('region', { name: 'Antigravity usage', exact: true });
      await settingsUsage.locator('summary').click();
      await expect(settingsUsage.getByRole('meter')).toHaveCount(quota.windows.length);
      await page.screenshot({ path: `test-results/quota-commit-${mobile ? 'mobile' : 'desktop'}-${colorScheme}.png` });
      failure = true;
      await menu.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(menu.getByText('Usage not reported', { exact: true })).toBeVisible();
      failure = false;
      await menu.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(settingsUsage.locator('summary')).toBeVisible();
      await expect(menu.getByText('Usage not reported', { exact: true })).toHaveCount(0);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Antigravity quota scopes, windows, resets, failures and partial data in both composers and commit settings, desktop/mobile, light/dark');
} finally { await browser.close(); await server.close(); }
