import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { messages as translations } from '../src/web/locales/index.ts';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'fixture-task', projectId: 'paper', agent: 'codex', name: 'p-task', title: 'Revise the introduction', instructions: 'Keep the meaning.', worktree: '/tmp/paper', threadId: 'thread', turnId: 'turn', model: null, effort: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [
  { id: 'fast-model', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'deep-model', name: 'Deep model', isDefault: false, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', fastMode: { serviceTier: 'priority', description: 'Faster responses' } },
] };
runtime.permissionOptions = [{ value: 'workspace', label: 'Workspace access', detail: 'Native approvals' }, { value: 'full', label: 'Full access', detail: 'Approve all tools' }];
const snapshot = { version: 'test', csrf: 'test', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime, models: [{ id: 'opus', name: 'Opus', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' }] }, zcode: { ...runtime, models: [], supportsReadOnlyTasks: false } } };
const modelChanges = [], messages = [], switches = [];
let failSwitch = true;
let holdSwitch, releaseSwitch;
let holdModel, releaseModel;
await context.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('papilot:task', 'fixture-task');
  localStorage.setItem('papilot:model-preferences:' + JSON.stringify(['claude', 'opus']), JSON.stringify({ effort: 'low', fast: false }));
  localStorage.setItem('papilot:permissions:claude', 'full');
  localStorage.setItem('papilot:draft:fixture-task', 'My unsent instructions.');
  localStorage.setItem('papilot:draft-skill:fixture-task', 'polish');
  localStorage.setItem('papilot:files:task:fixture-task', JSON.stringify([{ id: 'draft-file', projectId: 'paper', name: 'draft-reference.txt', size: 10, mime: 'text/plain' }]));
  localStorage.setItem('papilot:recent-models', JSON.stringify([{ agent: 'claude', model: 'opus' }]));
});
async function routeApi(route) {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [{ id: 'polish', name: 'Polish', description: 'Polish writing', hint: '', source: 'builtin' }] });
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'first-message', taskId: task.id, type: 'user', text: 'Original request.', createdAt: 1 }, { id: 'first-reply', taskId: task.id, type: 'assistant', text: 'Revised the opening paragraph.', createdAt: 2 }] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
  if (url.pathname.endsWith('/agent')) {
    const body = route.request().postDataJSON(); switches.push(body);
    if (snapshot.runtimes[body.agent]?.connected === false) return route.fulfill({ status: 503, json: { error: 'Connect and sign in to the destination agent before switching.' } });
    if (holdSwitch) await holdSwitch;
    if (failSwitch) return route.fulfill({ status: 409, json: { error: 'The current turn is still stopping. Wait for it to finish, then retry.' } });
    Object.assign(task, { agent: body.agent, model: body.model, effort: body.effort || null, permissions: body.permissions, status: 'interrupted', threadId: null, turnId: null, handoff: true, updatedAt: Date.now() });
    if (body.agent === 'codex') task.serviceTier = body.serviceTier; else delete task.serviceTier;
    return json(task);
  }
  if (url.pathname.endsWith('/model')) {
    const body = route.request().postDataJSON(); modelChanges.push(body);
    if (holdModel) await holdModel;
    Object.assign(task, body, { model: body.model || null, effort: body.effort || null });
    return json(task);
  }
  if (url.pathname.endsWith('/messages')) { messages.push(route.request().postDataJSON()); return json({ ok: true }); }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
}
await page.route('**/api/**', routeApi);

try {
  await page.goto(origin);
  const codexDraft = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await expect(codexDraft).toHaveValue('My unsent instructions.');
  const activity = page.locator('.activity-panel');
  const opener = activity.getByRole('button', { name: 'Agent settings', exact: true });
  const menu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
  const search = menu.getByRole('combobox', { name: 'Search models', exact: true });
  await opener.click();
  await expect(search).toBeFocused();
  await expect(menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Deep model · Codex', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Default model · ZCode', exact: true })).toBeVisible();
  // Another agent's model continues this task, so it is not marked as starting over.
  for (const option of await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).all()) {
    await expect(option).not.toHaveAttribute('aria-description');
    await expect(option).not.toHaveAttribute('title');
    await expect(option.locator('svg')).toHaveCount(0);
  }
  await page.screenshot({ path: 'test-results/task-agent-switch-desktop.png', animations: 'disabled' });

  // Same-agent changes save for the next turn. A cross-agent choice waits for them.
  holdModel = new Promise(resolve => { releaseModel = resolve; });
  await search.fill('deep'); await search.press('Enter');
  await expect.poll(() => modelChanges.length).toBe(1);
  assert.equal(switches.length, 0);
  holdSwitch = new Promise(resolve => { releaseSwitch = resolve; });
  await search.fill('opus'); await search.press('Enter');
  await expect(opener).toBeDisabled();
  await expect(menu).not.toBeVisible();
  await expect(activity.locator('.composer-options').getByRole('status', { name: 'Saving…', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instructions', exact: true })).toBeDisabled();
  assert.equal(switches.length, 0, 'The switch waits for the pending model save');
  releaseModel(); holdModel = null;
  await expect.poll(() => switches.length).toBe(1);
  await expect(opener).toBeDisabled();
  // Text stays editable while the turn stops.
  await codexDraft.fill('My updated unsent instructions.');
  await page.screenshot({ path: 'test-results/task-agent-switch-busy.png', animations: 'disabled' });
  releaseSwitch(); holdSwitch = null;
  await page.getByText('The current turn is still stopping. Wait for it to finish, then retry.', { exact: true }).waitFor();
  await expect(opener).toBeEnabled();
  await expect(opener).toContainText('Deep model');
  await page.screenshot({ path: 'test-results/task-agent-switch-error.png', animations: 'disabled' });
  assert.deepEqual(switches[0], { agent: 'claude', model: 'opus', effort: 'low', permissions: 'full', stop: true }, 'The destination restores its remembered effort and permissions');

  // A successful switch keeps the task, its conversation and every unsent draft.
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  failSwitch = false;
  await opener.click();
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  const claudeDraft = page.getByRole('textbox', { name: 'Instructions for Claude' });
  await expect(claudeDraft).toHaveValue('My updated unsent instructions.');
  await expect(opener).toBeEnabled();
  await expect(opener).toContainText('Opus');
  await expect(activity).toContainText('Original request.');
  await expect(activity).toContainText('Revised the opening paragraph.');
  await expect(activity.getByRole('button', { name: 'Remove the Polish skill', exact: true })).toBeVisible();
  await expect(activity.locator('.composer-attachments .attachment')).toHaveCount(1);
  await expect(activity.locator('.restart-link')).toHaveCount(0);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:task')), 'fixture-task');
  assert.equal(messages.length, 0, 'Switching never sends the draft');
  await page.screenshot({ path: 'test-results/task-agent-switch-done.png', animations: 'disabled' });
  await opener.click();
  await expect(menu.getByRole('group', { name: 'Claude', exact: true }).getByRole('option', { name: 'Opus · Claude', exact: true })).toHaveAttribute('aria-selected', 'true');
  await search.press('Escape');

  // Fresh touch contexts exercise the menu across locales, sizes and themes.
  for (const [language, width, colorScheme] of [['en', 1440, 'light'], ['en', 1440, 'dark'], ['zh-Hans', 390, 'light'], ['de', 320, 'dark']]) {
    const mobile = width < 600;
    const preview = await browser.newContext({ locale: 'en-US', colorScheme, hasTouch: mobile, viewport: { width, height: mobile ? 740 : 900 } });
    const previewPage = await preview.newPage();
    previewPage.on('pageerror', error => errors.push(error.message));
    await preview.addInitScript(language => {
      localStorage.setItem('papilot:language', language);
      localStorage.setItem('papilot:task', 'fixture-task');
    }, language);
    await previewPage.route('**/api/**', routeApi);
    await previewPage.goto(origin);
    const label = source => translations[language][source] || source;
    if (mobile) await previewPage.getByRole('button', { name: label('Chat'), exact: true }).click();
    await previewPage.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
    const trigger = previewPage.locator('.activity-panel').getByRole('button', { name: label('Agent settings'), exact: true });
    await trigger.click();
    const picker = previewPage.getByRole('dialog', { name: label('Agent settings'), exact: true });
    const selector = picker.getByRole('combobox', { name: label('Search models'), exact: true });
    await expect(picker).toBeVisible();
    if (mobile) await expect(selector).not.toBeFocused();
    await expect(selector).toBeInViewport();
    await expect(picker.getByRole('option', { name: 'Fast model · Codex', exact: true }).last()).toBeInViewport();
    const box = await picker.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `${language} picker overflows at ${width}px`);
    await previewPage.screenshot({ path: `test-results/task-agent-switch-${language}-${width}-${colorScheme}.png`, animations: 'disabled' });
    await selector.fill('no matching model');
    await expect(picker.getByRole('option')).toHaveCount(0);
    await expect(picker.locator('.model-empty')).toBeVisible();
    await selector.press('Escape');
    await expect(picker).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await preview.close();
  }

  // Unknown defaults in another agent do not offer a synthetic, unresolvable destination.
  snapshot.runtimes.codex.models[0].isDefault = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await opener.click();
  await expect(menu.getByRole('option', { name: 'Fast model · Codex', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Default model · Codex', exact: true })).toHaveCount(0);
  await search.press('Escape');
  // An unavailable destination is still shown, and a failure leaves the task on its agent.
  snapshot.runtimes.codex.connected = false;
  snapshot.runtimes.codex.error = 'Connection refused';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await opener.click();
  await expect(menu.getByRole('group', { name: 'Codex', exact: true })).toContainText('Unavailable');
  await menu.getByRole('option', { name: 'Fast model · Codex', exact: true }).last().click();
  await page.getByText('Connect and sign in to the destination agent before switching.', { exact: true }).waitFor();
  await expect(opener).toBeEnabled();
  await expect(opener).toContainText('Opus');
  assert.equal(task.agent, 'claude');
  snapshot.runtimes = { claude: { ...runtime, connected: false, models: [] } };
  await page.reload();
  await opener.click();
  await expect(menu.getByRole('option')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/task-agent-switch-empty.png', animations: 'disabled' });
  await search.press('Escape');
  assert.equal(switches.length, 3, 'Only explicit cross-agent choices switch agents');
  assert.deepEqual(errors, []);
  console.log('Task agent switch checks passed: all agent models, same-agent saves, queued cross-agent switch, busy/error/retry, one task with its conversation and drafts kept, and localized mobile/light/dark layouts.');
} finally {
  releaseModel?.(); releaseSwitch?.();
  await browser.close(); await server.close();
}
