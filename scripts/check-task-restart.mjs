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
const snapshot = { version: 'test', csrf: 'test', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime, models: [{ id: 'opus', name: 'Opus', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' }] } } };
const modelChanges = [], messages = [], restarts = [];
let failRestart = true, loseRestartResponse = false;
let holdRestart, releaseRestart;
let holdModel, releaseModel;
await context.addInitScript(() => {
  localStorage.setItem('papilot:task', 'fixture-task');
  localStorage.setItem('papilot:draft:fixture-task', 'My unsent instructions.');
  localStorage.setItem('papilot:draft-skill:fixture-task', 'polish');
  localStorage.setItem('papilot:files:task:fixture-task', JSON.stringify([{ id: 'original-draft-file', projectId: 'paper', name: 'draft-reference.txt', size: 10, mime: 'text/plain' }]));
  localStorage.setItem('papilot:review-notes:fixture-task', JSON.stringify({ instructions: 'Keep the notation.', notes: [{ id: 'draft-note', where: 'Round 2 · main.tex:12', quote: 'A useful claim.', comment: 'Explain this.', round: 2, strip: 'old-strip', rects: [], region: false }] }));
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
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'first-message', taskId: url.pathname.includes('fixture-task') ? task.id : snapshot.tasks.at(-1).id, type: 'user', text: 'Original request.', createdAt: 1 }] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
  if (url.pathname.endsWith('/restart')) {
    const body = route.request().postDataJSON(); restarts.push(body);
    if (snapshot.runtimes[body.agent]?.connected === false) return route.fulfill({ status: 503, json: { error: 'Connect and sign in to the destination agent before restarting.' } });
    if (holdRestart) await holdRestart;
    if (failRestart) return route.fulfill({ status: 409, json: { error: 'The original task is still stopping. Retry shortly.' } });
    const existing = snapshot.tasks.find(task => task.id === body.id);
    if (existing) return json(existing);
    const replacement = { ...task, ...body, status: 'reviewing', threadId: null, turnId: null, createdAt: Date.now(), updatedAt: Date.now(), restart: { taskId: task.id, draftAttachments: [{ id: 'copied-draft-file', projectId: 'paper', name: 'draft-reference.txt', size: 10, mime: 'text/plain' }] } };
    task.status = 'interrupted'; snapshot.tasks.push(replacement);
    if (loseRestartResponse) return route.fulfill({ status: 503, json: { error: 'The restart response was lost.' } });
    return json(replacement);
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
  const originalDraft = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await expect(originalDraft).toHaveValue('My unsent instructions.');
  const activity = page.locator('.activity-panel');
  const opener = activity.getByRole('button', { name: 'Agent settings', exact: true });
  const menu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
  const search = menu.getByRole('combobox', { name: 'Search models', exact: true });
  await opener.click();
  await expect(search).toBeFocused();
  await expect(menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Deep model · Codex', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Restart with another agent…', exact: true })).toHaveCount(0);
  // The action is visible before selecting, including in recent choices.
  for (const option of await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).all()) {
    await expect(option.locator('.model-option-restart')).toBeVisible();
    await expect(option).toHaveAccessibleDescription('Restart task');
    await expect(option).toHaveAttribute('title', 'Restart task');
    assert.ok(!(await option.innerText()).includes('Restart task'), 'The row uses an icon, not another text label');
  }
  await expect(menu.getByRole('group', { name: 'Codex', exact: true }).locator('.model-option-restart')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/task-restart-desktop.png', animations: 'disabled' });

  // Same-agent changes stay in this conversation. A cross-agent choice waits for them.
  holdModel = new Promise(resolve => { releaseModel = resolve; });
  await search.fill('deep'); await search.press('Enter');
  await expect.poll(() => modelChanges.length).toBe(1);
  assert.equal(restarts.length, 0);
  assert.equal(task.threadId, 'thread');
  holdRestart = new Promise(resolve => { releaseRestart = resolve; });
  await search.fill('opus');
  await expect(menu.getByRole('option').locator('.model-option-restart')).toBeVisible();
  await search.press('Enter');
  await expect(opener).toBeDisabled();
  await expect(menu).not.toBeVisible();
  await expect(activity.getByRole('status', { name: 'Stopping and restarting…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instructions', exact: true })).toBeDisabled();
  assert.equal(restarts.length, 0, 'Restart waits for the pending model save');
  releaseModel(); holdModel = null;
  await expect.poll(() => restarts.length).toBe(1);
  await expect(opener).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send instructions', exact: true })).toBeDisabled();
  await expect(activity.getByRole('button', { name: 'Remove the Polish skill', exact: true })).toHaveCount(0);
  await expect(activity.getByRole('button', { name: 'Remove attachment draft-reference.txt', exact: true })).toBeDisabled();
  // Text remains editable while waiting; the replacement gets the latest draft.
  await originalDraft.fill('My updated unsent instructions.');
  await page.screenshot({ path: 'test-results/task-restart-busy.png', animations: 'disabled' });
  releaseRestart(); holdRestart = null;
  await page.getByText('The original task is still stopping. Retry shortly.', { exact: true }).waitFor();
  await expect(opener).toBeEnabled();
  await expect(opener).toContainText('Deep model');
  await page.screenshot({ path: 'test-results/task-restart-error.png', animations: 'disabled' });
  assert.equal(restarts.length, 1);
  assert.equal(restarts[0].agent, 'claude'); assert.equal(restarts[0].model, 'opus'); assert.equal(restarts[0].stop, true);
  assert.equal(restarts[0].effort, '', 'The destination uses its own default effort');
  assert.deepEqual(restarts[0].draftAttachments, ['original-draft-file']);
  assert.equal(messages.length, 0, 'Restart never auto-sends the draft');
  failRestart = false; loseRestartResponse = true;
  await opener.click();
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await page.getByText('The restart response was lost.', { exact: true }).waitFor();
  await expect(opener).toBeEnabled();
  // Opening the replacement and returning remounts the model picker. The retry
  // identity survives, and an early-opened draft receives the eventual handoff.
  const replacementDraft = page.getByRole('textbox', { name: 'Instructions for Claude' });
  await activity.locator('.restart-link button').click();
  await expect(replacementDraft).toHaveValue('');
  await replacementDraft.fill('A new replacement draft.');
  await activity.locator('.restart-link button').click();
  await expect(originalDraft).toHaveValue('My updated unsent instructions.');
  loseRestartResponse = false;
  holdRestart = new Promise(resolve => { releaseRestart = resolve; });
  await opener.click();
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await expect.poll(() => restarts.length).toBe(3);
  await activity.locator('.restart-link button').click();
  await expect(replacementDraft).toHaveValue('A new replacement draft.');
  await activity.locator('.restart-link button').click();
  await opener.click();
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await expect.poll(() => restarts.length).toBe(4);
  await activity.locator('.restart-link button').click();
  releaseRestart(); holdRestart = null;
  await expect(replacementDraft).toHaveValue(/My updated unsent instructions\./);
  await expect(replacementDraft).toHaveValue(/A new replacement draft\./);
  await expect(activity.getByRole('button', { name: 'Remove the Polish skill', exact: true })).toBeVisible();
  assert.equal(restarts.length, 4);
  assert.ok(restarts.every(restart => restart.id === restarts[0].id), 'Failed and lost responses retry the same replacement');
  assert.equal(snapshot.tasks.length, 2, 'A lost response cannot create another task');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('papilot:restart:fixture-task'))).toBe(null);
  assert.equal((await replacementDraft.inputValue()).match(/My updated unsent instructions\./g).length, 1, 'Concurrent responses cannot append the copied draft twice');
  await expect(activity.locator('.composer-attachments .attachment')).toHaveCount(1);
  await expect(replacementDraft).toHaveValue(/Keep the notation\./);
  await expect(replacementDraft).toHaveValue(/Round 2 · main.tex:12/);
  await expect(replacementDraft).toHaveValue(/Explain this\./);
  await expect(activity).toContainText('Original request.');
  await expect(activity).toContainText('Restarted from');
  await expect(activity).toContainText('draft-reference.txt');
  await opener.click();
  await expect(menu.getByRole('group', { name: 'Claude', exact: true }).locator('.model-option-restart')).toHaveCount(0);
  await expect(menu.getByRole('option', { name: 'Fast model · Codex', exact: true }).last().locator('.model-option-restart')).toBeVisible();
  await search.press('Escape');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:draft:fixture-task')), 'My updated unsent instructions.');
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft-skill:' + id), restarts[0].id), 'polish');
  assert.equal(messages.length, 0);
  await activity.locator('.restart-link button').click();
  await expect(originalDraft).toHaveValue('My updated unsent instructions.');
  await expect(activity).toContainText('Replacement task');

  // A newly mounted source panel can edit skills while an earlier request waits.
  // Completion reads that latest draft instead of the old component's closure.
  holdRestart = new Promise(resolve => { releaseRestart = resolve; });
  await opener.click();
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await expect.poll(() => restarts.length).toBe(5);
  assert.notEqual(restarts[4].id, restarts[0].id, 'A confirmed restart leaves later intentional restarts independent');
  await activity.locator('.restart-link button').click();
  await activity.locator('.restart-link button').click();
  await activity.getByRole('button', { name: 'Remove the Polish skill', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('papilot:draft-skill:fixture-task'))).toBe(null);
  releaseRestart(); holdRestart = null;
  await expect.poll(() => page.evaluate(() => localStorage.getItem('papilot:task'))).toBe(restarts[4].id);
  await expect(replacementDraft).toHaveValue(/My updated unsent instructions\./);
  await expect(activity.locator('.composer-skill')).toHaveCount(0);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft-skill:' + id), restarts[4].id), null);
  await activity.locator('.restart-link button').click();
  await expect(originalDraft).toHaveValue('My updated unsent instructions.');

  // Fresh touch contexts exercise the existing menu across locales, sizes and themes.
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
    await expect(picker.getByRole('option', { name: 'Opus · Claude', exact: true }).last()).toBeInViewport();
    const crossAgent = picker.getByRole('option', { name: 'Opus · Claude', exact: true }).last();
    await expect(crossAgent.locator('.model-option-restart')).toBeInViewport();
    await expect(crossAgent).toHaveAccessibleDescription(label('Restart task'));
    await expect(picker.getByRole('group', { name: 'Codex', exact: true }).locator('.model-option-restart')).toHaveCount(0);
    const box = await picker.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `${language} picker overflows at ${width}px`);
    await previewPage.screenshot({ path: `test-results/task-restart-${language}-${width}-${colorScheme}.png`, animations: 'disabled' });
    await selector.fill('no matching model');
    await expect(picker.getByRole('option')).toHaveCount(0);
    await expect(picker.locator('.model-empty')).toBeVisible();
    await selector.press('Escape');
    await expect(picker).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await preview.close();
  }

  // Unknown defaults in another agent do not offer a synthetic, unresolvable destination.
  snapshot.runtimes.claude.models[0].isDefault = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await opener.click();
  await expect(menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last()).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Default model · Claude', exact: true })).toHaveCount(0);
  await search.press('Escape');
  // An unavailable destination is still shown, and a failure leaves the source selected.
  snapshot.runtimes.claude.connected = false;
  snapshot.runtimes.claude.error = 'Connection refused';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await opener.click();
  await expect(menu.getByRole('group', { name: 'Claude', exact: true })).toContainText('Unavailable');
  await menu.getByRole('option', { name: 'Opus · Claude', exact: true }).last().click();
  await page.getByText('Connect and sign in to the destination agent before restarting.', { exact: true }).waitFor();
  await expect(opener).toBeEnabled();
  await expect(opener).toContainText('Deep model');
  assert.equal(task.agent, 'codex');
  assert.equal(snapshot.tasks.length, 3, 'Unavailable agents cannot create a replacement');
  snapshot.runtimes = { codex: { ...runtime, connected: false, models: [] } };
  await page.reload();
  await opener.click();
  await expect(menu.getByRole('option')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/task-restart-empty.png', animations: 'disabled' });
  await search.press('Escape');
  assert.equal(restarts.length, 6, 'Only explicit cross-agent choices submit restarts');
  assert.deepEqual(errors, []);
  console.log('Task model restart checks passed: all agent models, same-agent saves, queued cross-agent restart, busy/error/idempotent retry, preserved drafts, links and localized mobile/light/dark layouts.');
} finally {
  releaseModel?.(); releaseRestart?.();
  await browser.close(); await server.close();
}
