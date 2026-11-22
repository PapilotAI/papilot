import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { selectOption } from './select.mjs';
import { Store } from '../src/server/store.ts';
import { buildActivityReport } from '../src/server/activity.ts';

// Exercises Settings -> Statistics against a real SQLite Store + buildActivityReport
// across desktop & mobile widths, light & dark themes, English & Simplified Chinese,
// range/metric/paper filters, day selection, earlier-days disclosure, empty state, and error recovery.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-activity-ui-'));
const store = new Store(path.join(tempDir, 'papilot.sqlite'));
const emptyStore = new Store(path.join(tempDir, 'empty.sqlite'));

const anchorNow = Date.UTC(2026, 10, 22, 15, 0, 0);
const p1 = { id: 'paper-main', name: 'Adaptive Variational Inference for PDEs', path: '/tmp/paper-main', createdAt: anchorNow };
const p2 = { id: 'paper-removed', name: 'Earlier Workshop Draft', path: '/tmp/paper-removed', createdAt: anchorNow };
store.saveProject(p1);
store.saveProject(p2);

for (let dayOffset = 0; dayOffset < 22; dayOffset++) {
  const dayMs = anchorNow - dayOffset * 86_400_000;
  const hourOffset = ((dayOffset % 6) - 2) * 3_600_000;
  const at = dayMs + hourOffset;
  const target = dayOffset % 4 === 0 ? p2 : p1;
  const agent = dayOffset % 3 === 0 ? 'claude' : dayOffset % 5 === 0 ? 'papilot' : 'codex';
  const model = agent === 'claude' ? 'claude-sonnet-4-6' : agent === 'papilot' ? 'openai-codex/gpt-5.5' : 'gpt-5.4';
  store.recordActivity({
    key: `task:d${dayOffset}`,
    at,
    kind: 'task_started',
    projectId: target.id,
    taskId: `task-${dayOffset}`,
    agent,
    model,
    data: { mode: dayOffset % 6 === 0 ? 'review' : 'edit', projectName: target.name },
  });
  store.recordActivity({
    key: `turn:d${dayOffset}`,
    at,
    kind: 'agent_turn',
    projectId: target.id,
    taskId: `task-${dayOffset}`,
    agent,
    model,
    data: { role: dayOffset % 6 === 0 ? 'review' : 'edit', status: 'completed', finishedAt: at + 12000, projectName: target.name },
  });
  store.recordActivity({
    key: `usage:d${dayOffset}`,
    at,
    kind: 'token_usage',
    projectId: target.id,
    taskId: `task-${dayOffset}`,
    agent,
    model,
    data: {
      role: 'edit',
      tokens: {
        input: 14000 + dayOffset * 800,
        cached: 48000 + dayOffset * 2000,
        cacheWrite: agent === 'claude' ? 3000 : 0,
        output: 3200 + dayOffset * 150,
        reasoning: 900,
        total: 65200 + (agent === 'claude' ? 3000 : 0) + dayOffset * 2950,
      },
      ...(agent === 'claude' ? { costUsd: 0.14 + dayOffset * 0.01, costSource: 'reported' } : {}),
      projectName: target.name,
    },
  });
  store.recordActivity({
    key: `decision:d${dayOffset}:a`,
    at: at + 60000,
    kind: 'review_decision',
    projectId: target.id,
    taskId: `task-${dayOffset}`,
    agent,
    model,
    data: { action: 'accept', count: 3 + (dayOffset % 3), source: 'task', projectName: target.name },
  });
  if (dayOffset % 2 === 0) {
    store.recordActivity({
      key: `decision:d${dayOffset}:r`,
      at: at + 90000,
      kind: 'review_decision',
      projectId: target.id,
      taskId: `task-${dayOffset}`,
      agent,
      model,
      data: { action: 'reject', count: 1, source: 'task', projectName: target.name },
    });
  }
  store.recordActivity({
    key: `note:d${dayOffset}`,
    at: at - 120000,
    kind: 'annotation_created',
    projectId: target.id,
    data: { source: dayOffset % 6 === 0 ? 'ai-review' : 'author', projectName: target.name },
  });
  store.recordActivity({
    key: `sent:d${dayOffset}`,
    at,
    kind: 'annotations_sent',
    projectId: target.id,
    taskId: `task-${dayOffset}`,
    agent,
    data: { count: 2, projectName: target.name },
  });
}
// Remove p2 so the UI exercises historical preservation of removed papers.
store.removeProject(p2.id);

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
let mode = 'populated';
fs.mkdirSync('test-results', { recursive: true });

const runtime = {
  connected: true,
  authenticated: true,
  account: 'researcher@example.edu',
  error: null,
  models: [{ id: 'gpt-5.4', name: 'GPT-5.4', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }],
};
const state = {
  version: '0.13.0',
  csrf: 'fixture',
  projects: [{ id: p1.id, name: p1.name, path: p1.path, createdAt: anchorNow }],
  tasks: [],
  requests: [],
  runtime,
  runtimes: { codex: runtime },
};

try {
  // 1. Desktop light & dark + interactive filters + error/empty states (English)
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 820 } });
  await context.addInitScript(() => {
    localStorage.setItem('papilot:language', 'en');
    localStorage.setItem('papilot:setup-seen', '1');
  });
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': ok\n\n' });
    if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (url.pathname === '/api/activity') {
      if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Temporary database lock.' } });
      const activeStore = mode === 'empty' ? emptyStore : store;
      const report = buildActivityReport(activeStore, {
        tz: url.searchParams.get('tz') || 'Asia/Shanghai',
        range: url.searchParams.get('range') || '30d',
        projectId: url.searchParams.get('projectId') || undefined,
        now: anchorNow,
      });
      return route.fulfill({ json: report });
    }
    if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, annotations: [], build: { status: 'ready', current: true } } });
    if (url.pathname.endsWith('/files')) return route.fulfill({ json: { document: null, files: [] } });
    if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
    if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main', ahead: 0, behind: 0 } });
    return route.fulfill({ json: {} });
  });

  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-settings-page="statistics"]').click();
  await page.locator('.activity-settings').waitFor();
  await expect(page.locator('.activity-kpi')).toHaveCount(6);
  await expect(page.locator('.activity-kpi[data-kpi="tokens"] .activity-kpi-value')).toContainText('M');
  await expect(page.locator('.activity-kpi[data-kpi="tokens"] .activity-kpi-detail')).toContainText('cache write');
  await expect(page.locator('.activity-kpi[data-kpi="spend"] .activity-kpi-value')).toContainText('$');
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('22');
  await expect(page.locator('.activity-kpi[data-kpi="hours"] .activity-kpi-value')).toContainText(':00');
  await expect(page.getByText('Local time (Asia/Shanghai)')).toBeVisible();
  await expect(page.locator('.activity-day-bar[tabindex="0"]')).toHaveCount(1);

  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-light.png' });

  // Switch chart metrics, select a day bar, and scrub with ArrowLeft
  await page.locator('.activity-metric-tab[data-metric="spend"]').click();
  await expect(page.locator('.activity-metric-tab[data-metric="spend"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.activity-day-bar').nth(25).click();
  await expect(page.locator('.activity-day-bar').nth(25)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.activity-day-bar').nth(25).press('ArrowLeft');
  await expect(page.locator('.activity-day-bar').nth(24)).toHaveAttribute('aria-pressed', 'true');

  // Inspect lower sections (Active hours, Agents & models, Daily breakdown table) and expand earlier days
  await page.locator('.activity-breakdown-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-agents.png' });
  await page.locator('.activity-table-container').first().scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-detail.png' });
  const moreDays = page.locator('.activity-more-days');
  await expect(moreDays).toBeVisible();
  await moreDays.locator('summary').click();
  await moreDays.scrollIntoViewIfNeeded();

  // Dark theme inspection
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.settings-content').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  // Range filter -> 7 days reduces agent runs from 22 to 7
  await page.locator('.activity-range-button[data-range="7d"]').click();
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('7');
  await page.locator('.activity-range-button[data-range="30d"]').click();
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('22');

  // Paper filter -> select removed paper by value
  const paperSelect = page.locator('.activity-filter-controls .chip-select');
  await selectOption(paperSelect, p2.id);
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('6');
  await selectOption(paperSelect, 'all');
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('22');

  // Error + Retry recovery
  await page.locator('.settings-content').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.activity-refresh')).toBeEnabled();
  mode = 'error';
  await page.locator('.activity-refresh').click();
  await expect(page.locator('.activity-status-banner[role="alert"]')).toContainText('Temporary database lock.');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-error.png' });
  mode = 'empty';
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.locator('.activity-status-banner[role="alert"]').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(/No workspace activity recorded in this period yet/)).toBeVisible();
  // Reset any manually clicked bar selection via 7d range switch and confirm empty workspace shows no selected bar
  await page.locator('.activity-range-button[data-range="7d"]').click();
  // Wait for 7d empty report; note selectedDate stays only if clicked, so open fresh empty check below or verify selectedDate reset:
  await expect(page.locator('.activity-day-bar[aria-pressed="true"]')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-empty.png' });

  // Restore populated state & check 390px and 320px mobile in Simplified Chinese
  await context.close();
  mode = 'populated';
  const zhContext = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 820 } });
  await zhContext.addInitScript(() => {
    localStorage.setItem('papilot:language', 'zh-Hans');
    localStorage.setItem('papilot:setup-seen', '1');
  });
  await zhContext.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': ok\n\n' });
    if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (url.pathname === '/api/activity') {
      const report = buildActivityReport(store, {
        tz: url.searchParams.get('tz') || 'Asia/Shanghai',
        range: url.searchParams.get('range') || '30d',
        projectId: url.searchParams.get('projectId') || undefined,
        now: anchorNow,
      });
      return route.fulfill({ json: report });
    }
    if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, annotations: [], build: { status: 'ready', current: true } } });
    if (url.pathname.endsWith('/files')) return route.fulfill({ json: { document: null, files: [] } });
    if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
    if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main', ahead: 0, behind: 0 } });
    return route.fulfill({ json: {} });
  });
  const zhPage = await zhContext.newPage();
  zhPage.on('pageerror', err => errors.push(err.message));
  await zhPage.goto(origin);
  await zhPage.locator('.settings-link').click();
  await zhPage.locator('[data-settings-page="statistics"]').click();
  await zhPage.setViewportSize({ width: 390, height: 844 });
  await expect(zhPage.locator('#settings-title')).toHaveText('使用统计');
  await expect(zhPage.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('22');
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-light.png' });

  // Scroll down on mobile to inspect Active hours + stacked responsive Daily breakdown cards
  await zhPage.locator('.activity-table-container').first().scrollIntoViewIfNeeded();
  await zhPage.emulateMedia({ colorScheme: 'dark' });
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-dark-table.png' });

  // Check zero horizontal overflow at 320px width
  await zhPage.setViewportSize({ width: 320, height: 640 });
  const hasOverflow = await zhPage.locator('.settings-content').evaluate(el => el.scrollWidth > el.clientWidth + 2);
  assert.equal(hasOverflow, false, '320px statistics pane has no horizontal overflow');

  await zhContext.close();
  assert.deepEqual(errors, []);
  console.log('PASS: Settings -> Statistics verified across desktop/mobile, light/dark, en/zh-Hans, filters, empty and error states');
} finally {
  await browser.close();
  await server.close();
  store.close();
  emptyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
