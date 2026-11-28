import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

// Verifies single-paper mode, allowedAgents filtering, and host account chrome
// across desktop light, desktop dark, and mobile viewports.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
fs.mkdirSync('test-results', { recursive: true });

try {
  for (const [label, width, height, dark] of [
    ['desktop-light', 1280, 820, false],
    ['desktop-dark', 1280, 820, true],
    ['mobile-light', 390, 844, false],
  ]) {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width, height },
      colorScheme: dark ? 'dark' : 'light',
      hasTouch: width < 600,
    });
    const runtimes = {
      papilot: {
        installed: true,
        connected: true,
        authenticated: true,
        account: 'Managed gateway',
        error: null,
        models: [
          { id: 'writer-pro', name: 'Writer Pro', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
          { id: 'writer-fast', name: 'Writer Fast', isDefault: false, efforts: [], defaultEffort: null },
        ],
      },
    };
    const state = {
      version: '0.15.0',
      csrf: 'fixture',
      gitAvailable: true,
      singlePaper: true,
      allowedAgents: ['papilot'],
      host: {
        name: 'Lab Host',
        homeUrl: 'https://host.example/projects',
        accountUrl: 'https://host.example/account',
        billingUrl: 'https://host.example/usage',
        logoutUrl: 'https://host.example/logout',
        user: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          plan: 'Pro',
          usagePercent: 42,
        },
      },
      projects: [{ id: 'paper-1', name: 'Attention Mechanisms', path: '/data/papers/paper', createdAt: 1 }],
      tasks: [],
      requests: [],
      runtime: runtimes.papilot,
      runtimes,
    };
    await context.addInitScript(() => {
      localStorage.setItem('papilot:language', 'en');
      localStorage.setItem('papilot:setup-seen', '1');
      localStorage.setItem('papilot:project', 'paper-1');
    });
    await context.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/state') return route.fulfill({ json: state });
      if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], ok: true } });
      if (pathname === '/api/writer/auth') return route.fulfill({ json: { gatewayOnly: true, providers: [{ id: 'gateway', name: 'Managed Gateway', kind: 'gateway', env: 'PAPILOT_WRITER_GATEWAY_URL', configured: true, source: 'environment' }], logins: [] } });
      if (pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: false, noteAlternativeRange: 'few' } });
      if (pathname === '/api/indirect-changes') return route.fulfill({ json: { indirectChanges: false } });
      if (pathname === '/api/quick-model') return route.fulfill({ json: { choice: null } });
      if (pathname.startsWith('/api/updates')) return route.fulfill({ json: { currentVersion: '0.15.0', phase: 'idle', canUpdate: false, packageManager: 'managed' } });
      if (pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, annotations: [], build: { status: 'building', current: false } } });
      if (pathname.endsWith('/files')) return route.fulfill({ json: { document: 'main.tex', files: [{ path: 'main.tex', root: true }] } });
      if (pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
      if (pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main', ahead: 0, behind: 0 } });
      return route.fulfill({ json: {} });
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    await page.goto(origin);

    if (width < 600) {
      await page.locator('.sidebar-toggle').first().click();
    }

    // 1. Top-left host home back link and single-paper title (no multi-paper Import/New menu).
    const backLink = page.locator('a.host-home-link');
    await expect(backLink).toBeVisible();
    assert.equal(await backLink.getAttribute('href'), 'https://host.example/projects');
    await expect(page.locator('.single-paper-title')).toHaveText('Attention Mechanisms');
    await expect(page.getByRole('button', { name: 'Import or open' })).toHaveCount(0);

    // Single-paper rename dialog hides Repository path and Remove paper.
    await page.locator('.single-paper-title').click();
    const paperDialog = page.locator('dialog[open] .paper-dialog');
    await expect(paperDialog).toBeVisible();
    await expect(paperDialog.locator('input[name="name"]')).toBeVisible();
    await expect(paperDialog.locator('input[name="path"]')).toHaveCount(0);
    await expect(paperDialog.locator('[data-remove]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(paperDialog).toHaveCount(0);

    // 2. Bottom-left avatar button replaces plain settings gear and opens accessible menu.
    await expect(page.locator('.settings-link')).toHaveCount(0);
    const trigger = page.locator('.host-account-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Ada Lovelace');
    await expect(trigger).toContainText('42%');
    await trigger.click();
    const popover = page.locator('.host-account-popover:popover-open');
    await expect(popover).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector('.host-account-popover:popover-open');
      return el && parseFloat(getComputedStyle(el).opacity) >= 0.99;
    });
    await expect(popover.locator('progress')).toHaveAttribute('value', '42');
    await expect(popover.locator('a[href="https://host.example/projects"]')).toBeVisible();
    await expect(popover.locator('a[href="https://host.example/usage"]')).toBeVisible();
    await expect(popover.locator('a[href="https://host.example/account"]')).toBeVisible();
    await expect(popover.locator('a[href="https://host.example/logout"]')).toBeVisible();
    if (width < 600) {
      const itemHeight = await popover.locator('.host-account-menu > button').first().evaluate(el => el.getBoundingClientRect().height);
      assert.ok(itemHeight >= 44, `Expected mobile menu item height >= 44px, got ${itemHeight}`);
    }

    await page.screenshot({ path: `test-results/host-chrome-${label}.png` });

    // Clicking the trigger while open closes the popover on desktop; on mobile the bottom sheet covers it and dismisses via Escape.
    if (width >= 600) {
      await trigger.click();
      await expect(popover).toHaveCount(0);
    } else {
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
    }

    // ArrowUp on closed trigger opens and focuses the last menu item; Escape closes and restores focus.
    await trigger.focus();
    await page.keyboard.press('ArrowUp');
    await expect(popover).toBeVisible();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Sign out');
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('host-account-trigger')), true);

    // 3. Settings opened from the host account menu shows only allowed agent (Papilot Writer) and no Support more.
    await trigger.click();
    await page.locator('.host-account-popover:popover-open button', { hasText: 'Settings' }).click();
    const settingsDialog = page.locator('dialog[open] .settings-dialog');
    await expect(settingsDialog).toBeVisible();
    if (width >= 600) {
      await settingsDialog.locator('[data-settings-page="agents"]').click();
      await expect(settingsDialog.locator('[data-agent]')).toHaveCount(1);
      await expect(settingsDialog.locator('[data-agent="papilot"]')).toBeVisible();
      await expect(settingsDialog.locator('.runtime-agent-contribute')).toHaveCount(0);
      await expect(settingsDialog.locator('.diagnostic-agent-switch')).toHaveCount(0);
      if (label === 'desktop-light') {
        await page.screenshot({ path: `test-results/host-chrome-agents-${label}.png` });
      }
    }
    await page.keyboard.press('Escape');
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('HOST_CHROME_UI_OK');
} finally {
  await browser.close();
  await server.close();
}
