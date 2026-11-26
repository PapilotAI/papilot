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
// across desktop and phone widths, light and dark themes, English and Simplified
// Chinese: insights, calendar paging, cards, sharing, range and paper
// filters, empty state and error recovery.
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

const fixtureRoute = activeStore => async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/state') return route.fulfill({ json: state });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': ok\n\n' });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/activity') {
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Temporary database lock.' } });
    return route.fulfill({ json: report(mode === 'empty' ? emptyStore : activeStore, url.searchParams) });
  }
  if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, annotations: [], build: { status: 'ready', current: true } } });
  if (url.pathname.endsWith('/files')) return route.fulfill({ json: { document: null, files: [] } });
  if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
  if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main', ahead: 0, behind: 0 } });
  return route.fulfill({ json: {} });
};
const report = (activeStore, params) => buildActivityReport(activeStore, {
  tz: params.get('tz') || 'Asia/Shanghai',
  range: params.get('range') || 'all',
  projectId: params.get('projectId') || undefined,
  now: anchorNow,
});
const expected = (range, projectId) => report(store, new URLSearchParams({ tz: 'Asia/Shanghai', range, ...(projectId ? { projectId } : {}) }));
const number = value => value.toLocaleString('en-US');
const figure = label => `.activity-stat:has(dt:text-is("${label}")) strong`;

try {
  // 1. Desktop light & dark, filters, details, sharing, error and empty states (English)
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 820 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.addInitScript(() => {
    localStorage.setItem('papilot:language', 'en');
    localStorage.setItem('papilot:setup-seen', '1');
  });
  await context.route('**/api/**', fixtureRoute(store));

  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-settings-page="statistics"]').click();
  await page.locator('.activity-settings').waitFor();

  // Insights open on all time: accepted and rejected changes, agent time, tasks started.
  const all = expected('all');
  await expect(page.locator('.activity-range-button[data-range="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.activity-insight')).toHaveCount(4);
  await expect(page.locator(figure('Accepted changes'))).toHaveText(number(all.totals.accepted));
  await expect(page.locator(figure('Rejected changes'))).toHaveText(number(all.totals.rejected));
  await expect(page.locator(figure('Tasks started'))).toHaveText(number(all.totals.tasksStarted));
  await expect(page.locator('.activity-insight:has(dt:text-is("Tasks started")) .activity-figure-unit')).toHaveText('tasks');
  await expect(page.locator(figure('Agent time'))).not.toHaveText('0');
  await expect(page.getByText('Time saved')).toHaveCount(0);
  await expect(page.locator(figure('Active days'))).toHaveText(number(all.totals.activeDays));
  await expect(page.locator(figure('Longest streak'))).toHaveText(/^\d+$/);
  // Cards show the rest directly: no collapsed rows, no daily table.
  await expect(page.locator('.activity-card')).toHaveCount(4);
  await expect(page.locator('details, .activity-table')).toHaveCount(0);
  const rate = Math.round((all.totals.accepted / (all.totals.accepted + all.totals.rejected)) * 100);
  await expect(page.locator('.activity-ring-chart strong')).toHaveText(`${rate}%`);
  await expect(page.locator('.activity-legend-row:has(dt:text-is("Annotations")) dd')).toHaveText(number(all.totals.annotationsCreated));
  await expect(page.locator('.activity-token-total')).toHaveText(/M$/);
  await expect(page.locator('.activity-token-bar > span')).toHaveCount(4);
  await expect(page.locator('.activity-hour-grid .activity-heat-cell')).toHaveCount(168);
  await expect(page.locator('.activity-ranking-row')).toHaveCount(all.agents.length + all.models.length);

  // Calendar: as many weeks as fit, the latest week last, one tab stop.
  const heatmap = page.locator('.activity-heatmap');
  const cells = heatmap.locator('.activity-heat-cell');
  const weeks = await heatmap.evaluate(table => Number(getComputedStyle(table).getPropertyValue('--weeks')));
  assert.ok(weeks >= 20 && weeks <= 30, `Settings shows about half a year, got ${weeks} weeks`);
  assert.equal(await cells.evaluateAll(list => list.map(cell => cell.dataset.date).sort().at(-1)), '2026-11-22', 'The newest cell is today');
  await expect(heatmap.locator('.activity-heat-cell[tabindex="0"]')).toHaveAttribute('data-date', '2026-11-22');
  await expect(heatmap.locator('tbody th abbr')).toHaveCount(7);
  const box = await cells.first().boundingBox();
  assert.ok(Math.abs(box.width - box.height) < 1.5 && box.width >= 17, `Cells are large squares, got ${box.width}×${box.height}`);
  assert.equal(await cells.evaluateAll(list => new Set(list.map(cell => cell.dataset.level)).size), 5, 'All five shades are used');
  await expect(heatmap.locator('[data-outside]')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-light.png' });

  // Hover shows the day; arrows move by week and by day; Escape hides the tip, not Settings.
  const target = heatmap.locator('[data-date="2026-11-11"]');
  await target.hover();
  await expect(page.locator('.activity-heat-tip')).toContainText(/\d+ actions?/);
  await expect(page.locator('.activity-heat-tip')).toContainText('Nov 11');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-heatmap-tooltip.png', clip: await page.locator('.activity-calendar').boundingBox().then(rect => ({ x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16 })) });
  await target.click();
  await target.press('ArrowLeft');
  await expect(heatmap.locator('[data-date="2026-11-04"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(heatmap.locator('[data-date="2026-11-03"]')).toBeFocused();
  await expect(page.locator('.activity-heat-tip')).toContainText('Nov 3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.activity-heat-tip')).toHaveCount(0);
  await expect(page.locator('.activity-settings')).toBeVisible();

  // The pager walks back through earlier weeks and returns.
  const period = page.locator('.activity-pager > span');
  const latestPeriod = await period.textContent();
  const latestFirst = await cells.evaluateAll(list => list.map(cell => cell.dataset.date).sort()[0]);
  await expect(page.getByRole('button', { name: 'Later weeks' })).toBeDisabled();
  await page.getByRole('button', { name: 'Earlier weeks' }).click();
  await expect(period).not.toHaveText(latestPeriod);
  assert.ok(await cells.evaluateAll((list, before) => list.every(cell => cell.dataset.date < before), latestFirst), 'The previous page shows the weeks before');
  await page.getByRole('button', { name: 'Later weeks' }).click();
  await expect(period).toHaveText(latestPeriod);

  // The cards below the calendar: review ring, tokens, hours and rankings.
  await page.locator('.activity-cards').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-details.png' });
  const hours = page.locator('.activity-card').filter({ hasText: 'Active hours' });
  await expect(hours.locator('.activity-card-headline')).toHaveText(/^Peak \d{2}:00–\d{2}:00$/);
  await hours.locator('.activity-hour-grid .activity-heat-cell[data-level="4"]').first().hover();
  await expect(hours.locator('.activity-heat-tip')).toContainText(/\d+ actions?.*\d+ runs?.+ tokens/);
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-hours.png' });
  await page.mouse.move(0, 0);
  await page.locator('.activity-rankings').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-detail.png' });

  // Sharing draws the figures and the latest weeks into a PNG to copy or save.
  await page.locator('.settings-content').evaluate(el => { el.scrollTop = 0; });
  await page.locator('.activity-share-button').click();
  const share = page.locator('.activity-share-dialog');
  await expect(share).toBeVisible();
  const preview = share.locator('.activity-share-preview img');
  await expect(preview).toHaveAttribute('alt', new RegExp(`Accepted changes ${number(all.totals.accepted)} changes`));
  assert.equal(await preview.evaluate(image => image.decode().then(() => image.naturalWidth)), 1080);
  await expect(share.getByRole('link', { name: 'Save image' })).toHaveAttribute('download', 'papilot-2026-11-22.png');
  await share.getByRole('button', { name: 'Copy image' }).click();
  await expect(share.locator('[role="status"]')).toHaveText('Copied');
  assert.ok(await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png'))), 'The clipboard holds the PNG');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-share.png' });
  const card = await preview.evaluate(image => fetch(image.src).then(response => response.arrayBuffer()).then(buffer => Array.from(new Uint8Array(buffer))));
  fs.writeFileSync('test-results/activity-share-card-light.png', Buffer.from(card));
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await expect(page.locator('.activity-settings')).toBeVisible();

  // Dark theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-desktop-dark.png' });
  await page.locator('.activity-share-button').click();
  await expect(preview).toBeVisible();
  const darkCard = await preview.evaluate(image => fetch(image.src).then(response => response.arrayBuffer()).then(buffer => Array.from(new Uint8Array(buffer))));
  fs.writeFileSync('test-results/activity-share-card-dark.png', Buffer.from(darkCard));
  await share.getByRole('button', { name: 'Close' }).click();
  await expect(share).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });

  // Ranges recount the figures and step back the days before them; the calendar keeps every day.
  const shades = await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join(''));
  await page.locator('.activity-range-button[data-range="7d"]').click();
  await expect(page.locator(figure('Accepted changes'))).toHaveText(number(expected('7d').totals.accepted));
  assert.equal(await cells.evaluateAll(list => list.map(cell => cell.dataset.level).join('')), shades);
  await expect(heatmap.locator('.activity-heat-cell:not([data-outside])')).toHaveCount(7);
  await page.locator('.activity-range-button[data-range="30d"]').click();
  await expect(page.locator(figure('Accepted changes'))).toHaveText(number(expected('30d').totals.accepted));
  await expect(page.locator(figure('Active days'))).toHaveText(number(expected('30d').totals.activeDays));

  // Paper filter -> the removed paper's six days.
  const paperSelect = page.locator('.activity-filter-controls .chip-select');
  await selectOption(paperSelect, p2.id);
  await expect(page.locator(figure('Accepted changes'))).toHaveText(number(expected('30d', p2.id).totals.accepted));
  await expect.poll(() => cells.evaluateAll(list => list.filter(cell => cell.dataset.level !== '0').length)).toBe(6);
  await selectOption(paperSelect, 'all');
  await page.locator('.activity-range-button[data-range="all"]').click();
  await expect(page.locator(figure('Accepted changes'))).toHaveText(number(all.totals.accepted));

  // Error + Retry recovery, then the empty state.
  await expect(page.locator('.activity-refresh')).toBeEnabled();
  mode = 'error';
  await page.locator('.activity-refresh').click();
  await expect(page.locator('.activity-status-banner[role="alert"]')).toContainText('Temporary database lock.');
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-error.png' });
  mode = 'empty';
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.locator('.activity-status-banner[role="alert"]').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(/No workspace activity recorded in this period yet/)).toBeVisible();
  await expect(page.locator('.activity-heat-cell:not([data-level="0"])')).toHaveCount(0);
  await expect(page.locator('.activity-share-button')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Earlier weeks' })).toBeDisabled();
  await page.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-empty.png' });
  await context.close();

  // 2. Phones in Simplified Chinese: fewer, still large weeks and no sideways scrolling.
  mode = 'populated';
  const zhContext = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 820 }, hasTouch: true });
  await zhContext.addInitScript(() => {
    localStorage.setItem('papilot:language', 'zh-Hans');
    localStorage.setItem('papilot:setup-seen', '1');
  });
  await zhContext.route('**/api/**', fixtureRoute(store));
  const zhPage = await zhContext.newPage();
  zhPage.on('pageerror', err => errors.push(err.message));
  await zhPage.goto(origin);
  await zhPage.locator('.settings-link').click();
  await zhPage.locator('[data-settings-page="statistics"]').click();
  await zhPage.setViewportSize({ width: 390, height: 844 });
  await expect(zhPage.locator('#settings-title')).toHaveText('使用统计');
  await expect(zhPage.locator('.activity-insight:has(dt:text-is("采纳的修改")) .activity-figure-unit')).toHaveText('处');
  await expect(zhPage.locator('.activity-stat:has(dt:text-is("活跃天数")) .activity-figure-unit')).toHaveText('天');
  const phoneWeeks = await zhPage.locator('.activity-heatmap').evaluate(table => Number(getComputedStyle(table).getPropertyValue('--weeks')));
  assert.ok(phoneWeeks >= 8 && phoneWeeks <= 16, `A phone shows about a quarter, got ${phoneWeeks} weeks`);
  await zhPage.locator('.activity-heatmap [data-date="2026-11-20"]').tap();
  await expect(zhPage.locator('.activity-heat-tip')).toContainText('次操作');
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-light.png' });
  await zhPage.locator('.activity-calendar').scrollIntoViewIfNeeded();
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-heatmap.png' });
  await zhPage.emulateMedia({ colorScheme: 'dark' });
  await expect(zhPage.locator('.activity-ring figcaption')).toHaveText('采纳率');
  await zhPage.locator('.activity-cards').scrollIntoViewIfNeeded();
  await zhPage.screenshot({ animations: 'disabled', path: 'test-results/activity-settings-mobile-zh-dark-cards.png' });
  await zhPage.setViewportSize({ width: 320, height: 640 });
  const overflow = await zhPage.locator('.settings-content').evaluate(root => {
    const edge = root.getBoundingClientRect().right + 1;
    return root.scrollWidth > root.clientWidth + 2 ? [...root.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > edge).map(element => `${element.className || element.tagName}: ${element.textContent.slice(0, 40)}`).slice(0, 5) : [];
  });
  assert.deepEqual(overflow, [], '320px statistics pane has no horizontal overflow');
  await zhContext.close();

  assert.deepEqual(errors, []);
  console.log('PASS: Statistics insights, calendar paging, cards, sharing, filters, empty and error states across desktop/phone, light/dark, en/zh-Hans');
} finally {
  await browser.close();
  await server.close();
  store.close();
  emptyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
