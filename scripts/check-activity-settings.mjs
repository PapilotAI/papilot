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
// A year of older history outside the 30-day range gives the past-year heatmap
// texture: busier weekdays, quieter weekends, and a deterministic spread of runs.
let seed = 7;
const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
for (let dayOffset = 31; dayOffset <= 380; dayOffset++) {
  const at = anchorNow - dayOffset * 86_400_000;
  const weekend = [0, 6].includes(new Date(at).getUTCDay());
  if (random() < (weekend ? 0.75 : 0.3)) continue;
  const runs = 1 + Math.floor(random() * random() * 8);
  for (let run = 0; run < runs; run++) {
    store.recordActivity({ key: `history:turn:${dayOffset}:${run}`, at: at - run * 3_600_000, kind: 'agent_turn', projectId: p1.id, taskId: `history-${dayOffset}`, agent: 'codex', model: 'gpt-5.4', data: { role: 'edit', status: 'completed', projectName: p1.name } });
  }
  store.recordActivity({ key: `history:usage:${dayOffset}`, at, kind: 'token_usage', projectId: p1.id, taskId: `history-${dayOffset}`, agent: 'codex', model: 'gpt-5.4', data: { role: 'edit', tokens: { input: 9000 * runs, cached: 30000 * runs, cacheWrite: 0, output: 2000 * runs, reasoning: 500 * runs, total: 41500 * runs }, projectName: p1.name } });
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

  // Past-year heatmap: 53 week columns ending today, one tab stop on the latest active day.
  const heatmap = page.locator('.activity-heatmap');
  const cells = heatmap.locator('.activity-heat-cell');
  const cellCount = await cells.count();
  assert.ok(cellCount >= 365 && cellCount <= 371, `53 weeks of cells, got ${cellCount}`);
  assert.equal(await cells.evaluateAll(list => list.map(cell => cell.dataset.date).sort().at(-1)), '2026-11-22', 'The newest cell is today');
  await expect(heatmap.locator('.activity-heat-cell[tabindex="0"]')).toHaveCount(1);
  await expect(heatmap.locator('.activity-heat-cell[aria-selected="true"]')).toHaveAttribute('data-date', '2026-11-22');
  const shadedBeforeRange = await cells.evaluateAll(list => list.filter(cell => cell.dataset.date < '2026-10-24' && cell.dataset.level !== '0').length);
  assert.ok(shadedBeforeRange > 100, 'History older than the 30-day range is shaded');
  const levels = await cells.evaluateAll(list => new Set(list.map(cell => cell.dataset.level)).size);
  assert.equal(levels, 5, 'All five shades are used');
  await expect(page.locator('.activity-streaks dd').first()).toHaveText(/\d+ days?/);
  await expect(page.locator('.activity-heatmap tbody th:not(:has(.sr-only))')).toHaveCount(3);

  await page.locator('.activity-year').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-light.png' });

  // Hover shows a tooltip; clicking selects the day; arrows move by week and by day.
  const target = heatmap.locator('[data-date="2026-11-11"]');
  await target.hover();
  await expect(page.locator('.activity-heat-tip')).toContainText('tokens');
  await expect(page.locator('.activity-heat-tip')).toContainText('Nov 11');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-heatmap-tooltip.png', clip: await page.locator('.activity-year').boundingBox().then(box => ({ x: box.x - 8, y: box.y - 48, width: box.width + 16, height: box.height + 56 })) });
  await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.activity-selected-day strong')).toContainText('Nov 11');
  await target.press('ArrowLeft');
  await expect(heatmap.locator('[data-date="2026-11-04"]')).toHaveAttribute('aria-selected', 'true');
  await expect(heatmap.locator('[data-date="2026-11-04"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(heatmap.locator('[data-date="2026-11-03"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.activity-heat-tip')).toContainText('Nov 3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.activity-heat-tip')).toHaveCount(0);
  await expect(page.locator('.activity-settings')).toBeVisible();

  // Metrics reshade the same days.
  const tokenLevels = await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join(''));
  await page.locator('.activity-metric-tab[data-metric="reviews"]').click();
  await expect(page.locator('.activity-metric-tab[data-metric="reviews"]')).toHaveAttribute('aria-pressed', 'true');
  assert.notEqual(await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join('')), tokenLevels);
  await page.locator('.activity-metric-tab[data-metric="tokens"]').click();

  // Weekday-by-hour heatmap for the range: 7 × 24 cells with the evening peak shaded darkest.
  const hourCells = page.locator('.activity-hour-grid .activity-heat-cell');
  await expect(hourCells).toHaveCount(168);
  assert.ok(await page.locator('.activity-hour-grid .activity-heat-cell[data-level="4"]').count() > 0);
  await page.locator('.activity-hour-grid').scrollIntoViewIfNeeded();
  await page.locator('.activity-hour-grid .activity-heat-cell[data-level="4"]').first().hover();
  await expect(page.locator('.activity-hours .activity-heat-tip')).toContainText(/\d+ actions?.*\d+ runs?.+ tokens/);
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-hours.png' });
  // Scrolled away, the sticky weekday labels stay under the sticky page header.
  const header = await page.locator('.settings-content-header').boundingBox();
  const label = await page.locator('.activity-heatmap tbody th').first().boundingBox();
  if (label.y < header.y + header.height) {
    const topmost = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.settings-content-header, .activity-heatmap') ?.className, [label.x + 4, label.y + label.height / 2]);
    assert.equal(topmost, 'settings-content-header', 'The page header covers weekday labels scrolled beneath it');
  }
  await page.mouse.move(0, 0);

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

  // Range filter -> 7 days reduces agent runs from 22 to 7; the past-year heatmap stays the same.
  const yearShades = await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join(''));
  await page.locator('.activity-range-button[data-range="7d"]').click();
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('7');
  assert.equal(await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join('')), yearShades);
  await page.locator('.activity-range-button[data-range="30d"]').click();
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('22');

  // Paper filter -> select removed paper by value
  const paperSelect = page.locator('.activity-filter-controls .chip-select');
  await selectOption(paperSelect, p2.id);
  await expect(page.locator('.activity-kpi[data-kpi="agents"] .activity-kpi-value')).toHaveText('6');
  await expect.poll(() => cells.evaluateAll(list => list.filter(cell => cell.dataset.level !== '0').length)).toBe(6);
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
  await expect(page.locator('.activity-heat-cell[aria-selected="true"]')).toHaveCount(0);
  await expect(page.locator('.activity-heat-cell:not([data-level="0"])')).toHaveCount(0);
  await expect(page.locator('.activity-selected-day')).toHaveCount(0);
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

  // The heatmap scrolls sideways on phones and opens on the newest weeks.
  await zhPage.locator('.activity-year').scrollIntoViewIfNeeded();
  await expect.poll(() => zhPage.locator('.activity-heatmap-scroll').evaluate(scroller => {
    const view = scroller.getBoundingClientRect();
    const today = scroller.querySelector('[data-date="2026-11-22"]').getBoundingClientRect();
    return scroller.scrollWidth > scroller.clientWidth && today.left >= view.left && today.right <= view.right;
  })).toBe(true);
  await zhPage.emulateMedia({ colorScheme: 'light' });
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-heatmap.png' });

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
