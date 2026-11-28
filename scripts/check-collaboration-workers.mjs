import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

// Collaboration workers show under their delegation, like subagents: the
// latest step on the line, the steps and the worker's changes inside it, and
// a stop control while it runs.
fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve(process.env.PAPILOT_WEB_DIST || 'dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
// On desktop the chat's position menu fills the window with it or docks it beside the review.
async function placeChat(page, position) {
  await page.locator('#conversation-panel .panel-heading').getByRole('button', { name: /^Panel position/ }).click();
  await page.getByRole('menuitemradio', { name: position, exact: true }).click();
  await expect(page.locator('.task-grid')).toHaveClass(position === 'Fill the window' ? /layout-conversation/ : /layout-split/);
}
const task = { id: 'collab-task', projectId: 'paper', agent: 'collaboration', model: 'gpt-test', name: 'collab', title: 'Revise the notes', instructions: '', worktree: '/tmp/paper', threadId: 'thread', turnId: 'turn', status: 'running', createdAt: 1, updatedAt: 1, review: null };
const runtime = { connected: true, authenticated: true, installed: true, models: [{ id: 'gpt-test', name: 'Test model', isDefault: true, efforts: [], defaultEffort: null }] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Example paper', path: '/tmp/paper' }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, collaboration: { ...runtime, hidden: false } } };
const at = 1793935580000;
const quick = { id: 'collab-task:turn:call-quick', taskId: task.id, type: 'tool', text: 'workflow_delegate · quick', detail: 'OpenCode (provider/flash-test, max reasoning effort)\nNotes: 1\nFix the typo.', status: 'inProgress', createdAt: at + 2 };
const polish = { id: 'collab-task:turn:call-polish', taskId: task.id, type: 'tool', text: 'workflow_delegate · polish', detail: 'Antigravity (gemini-test, high reasoning effort)\nNotes: 2\nPolish the paragraph.\nResult: applied (main.tex)', status: 'completed', createdAt: at + 3,
  changes: [{ path: 'main.tex', added: 1, removed: 1, diff: `--- main.tex\n+++ main.tex\n@@ -1,1 +1,1 @@\n-This sentence is long and also it is wordy, and it goes on for a while because LaTeX keeps a whole paragraph on one source line, so a diff has to scroll sideways.\n+This sentence is short.\n` }] };
const stopped = { id: 'collab-task:turn:call-stopped', taskId: task.id, type: 'tool', text: 'workflow_delegate · rigorous', detail: 'Codex (gpt-test, xhigh reasoning effort)\nNotes: 3\nCheck the sum.\nThe author stopped this worker before it finished.', status: 'interrupted', createdAt: at + 3.5 };
const long = 'A LaTeX paragraph is one long source line. '.repeat(8);
const items = [
  { id: 'user', taskId: task.id, type: 'user', text: 'Revise the marked notes.', createdAt: at },
  // The coordinator's own edit, as when it reconciles a conflict.
  { id: 'collab-task:turn:own-edit', taskId: task.id, type: 'files', text: 'main.tex', status: 'completed', createdAt: at + 1, changes: [{ path: 'main.tex', added: 1, removed: 1, diff: `--- main.tex\n+++ main.tex\n@@ -2,1 +2,1 @@\n-${long}\n+${long}Reconciled.\n` }] },
  { id: 'collab-task:turn:msg_own:0', taskId: task.id, type: 'assistant', text: 'Reconciled the overlapping edits.', status: 'completed', createdAt: at + 1.5 },
  quick, polish, stopped,
  { id: stopped.id + '/read', parent: stopped.id, taskId: task.id, type: 'tool', text: 'read main.tex', tool: { kind: 'read', target: 'main.tex' }, status: 'interrupted', createdAt: at + 7 },
  { id: quick.id + '/read', parent: quick.id, taskId: task.id, type: 'tool', text: 'read main.tex', tool: { kind: 'read', target: 'main.tex' }, status: 'completed', createdAt: at + 4 },
  { id: quick.id + '/edit', parent: quick.id, taskId: task.id, type: 'files', text: 'main.tex', status: 'inProgress', createdAt: at + 5 },
  { id: polish.id + '/reply', parent: polish.id, taskId: task.id, type: 'assistant', text: 'Polished note 2 without changing its claim.', status: 'completed', createdAt: at + 6 },
];
try {
  for (const [width, dark, language] of [[1200, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 820 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    const stops = [];
    let failStop = language === 'en';
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/state') return json(snapshot);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname === `/api/tasks/${task.id}/workers/stop`) {
        stops.push(route.request().postDataJSON());
        if (failStop) { failStop = false; return route.fulfill({ status: 409, json: { error: 'This worker has already finished.' } }); }
        return json({ ok: true });
      }
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/items')) return json({ items });
      if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
      if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
      if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
      throw Error(`Unexpected fixture request ${url.pathname}`);
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.server.address().port}`);
    const zh = language === 'zh-CN';
    if (width > 680) await placeChat(page, 'Fill the window');
    else await page.getByRole('button', { name: zh ? '对话' : 'Chat', exact: true }).click();
    const group = page.locator('.thread > .tool-group');
    await expect(group).toHaveCount(1);
    // Worker steps are not thread lines of their own.
    await expect(page.locator('.thread > .tool-group > .tool-group-items > .tool-item')).toHaveCount(3);
    const own = page.locator('.thread > .tool-item[data-kind="files"]');
    await own.locator(':scope > summary').click();
    const [ownRight, ownLine] = await own.evaluate(line => [line.querySelector('pre.file-diff').getBoundingClientRect().right, line.getBoundingClientRect().right]);
    assert.ok(ownRight <= ownLine + 1, `a long line in an edit's diff stays within its line (${ownRight} > ${ownLine})`);
    await own.locator(':scope > summary').click();
    await group.locator('summary').first().click();
    const running = group.locator(':scope > .tool-group-items > .tool-item').nth(0), done = group.locator(':scope > .tool-group-items > .tool-item').nth(1);
    await expect(running.locator(':scope > summary .tool-label')).toContainText('workflow_delegate · quick');
    await expect(running.locator(':scope > summary .tool-note')).toHaveText(zh ? '编辑了 main.tex' : 'Edited main.tex');
    await expect(running.locator(':scope > summary .spinner')).toBeVisible();
    await expect(running.locator('.worker-steps')).not.toBeVisible();
    await running.locator(':scope > summary').click();
    await expect(running.locator(':scope > pre')).toContainText('OpenCode (provider/flash-test, max reasoning effort)');
    await expect(running.locator('.worker-steps > .tool-item .tool-label')).toHaveText(zh ? ['读取了 main.tex', '编辑了 main.tex'] : ['Read main.tex', 'Edited main.tex']);
    const stop = running.getByRole('button', { name: zh ? '停止这次委派' : 'Stop worker' });
    await expect(stop).toBeVisible();
    // A finished worker: its report among its steps, then what it changed. No stop control.
    await done.locator(':scope > summary').click();
    await expect(done.locator(':scope > summary .tool-note')).toHaveCount(0);
    await expect(done.locator('.worker-message')).toHaveText('Polished note 2 without changing its claim.');
    await expect(done.locator('.file-diffs .file-diff-path')).toHaveText('main.tex');
    await expect(done.locator('.file-diffs')).toContainText('This sentence is short.');
    await expect(done.getByRole('button', { name: zh ? '停止这次委派' : 'Stop worker' })).toHaveCount(0);
    // A long source line scrolls inside its diff instead of widening the chat.
    const [diffRight, lineRight] = await done.evaluate(line => [line.querySelector('pre.file-diff').getBoundingClientRect().right, line.getBoundingClientRect().right]);
    assert.ok(diffRight <= lineRight + 1, `the diff stays within its line (${diffRight} > ${lineRight})`);
    // A stopped worker reads as stopped, as do its unfinished steps; nothing keeps spinning.
    const halted = group.locator(':scope > .tool-group-items > .tool-item').nth(2);
    await expect(halted.locator(':scope > summary .tool-status')).toHaveText(zh ? '已停止' : 'Stopped');
    await halted.locator(':scope > summary').click();
    await expect(halted.locator('.worker-steps .tool-status')).toHaveText(zh ? '已停止' : 'Stopped');
    await expect(halted.locator('.spinner')).toHaveCount(0);
    await expect(halted.getByRole('button', { name: zh ? '停止这次委派' : 'Stop worker' })).toHaveCount(0);
    await expect(group.locator(':scope > summary .tool-status')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no horizontal page scroll at ${width}px`);
    await group.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ animations: 'disabled', path: `test-results/collaboration-workers-${width}${dark ? '-dark' : ''}-${language}.png` });
    // Stopping: a failed request says why and can be retried; the keyboard works.
    if (!zh) {
      await stop.click();
      await expect(running.getByRole('alert')).toHaveText('This worker has already finished.');
      await expect(stop).toBeEnabled();
    }
    await stop.focus(); await page.keyboard.press('Enter');
    await expect(stop).toBeDisabled();
    assert.deepEqual(stops.at(-1), { item: quick.id });
    await running.screenshot({ path: `test-results/collaboration-worker-running-${width}${dark ? '-dark' : ''}-${language}.png` });
    await context.close();
  }

  // Collaboration v2 dispatch card: shows Router, per-annotation lane & assigned agent(s),
  // live race vs judge progress, winner badge, multi-turn isolation, and collapsible raw tool details.
  const dispatchItems = [
    { id: 'u0', taskId: task.id, type: 'user', text: 'Earlier turn', createdAt: at - 10 },
    {
      id: 'collab-task:turn1:route', taskId: task.id, type: 'tool', text: 'workflow_route', status: 'completed', createdAt: at - 9,
      detail: 'Antigravity · Gemini 4 Flash\n#1 (main.tex): Simple edits → Gemini 4 Flash',
      meta: {
        dispatch: {
          strategy: 'balanced',
          router: { agent: 'antigravity', model: 'Gemini 4 Flash' },
          entries: [
            { clusterId: 't1c1', notes: [1], file: 'main.tex', laneId: 'quick', laneName: 'Simple edits', mode: 'assign', itemId: 'collab-task:turn1:assign:t1c1', workers: [{ itemId: 'collab-task:turn1:assign:t1c1', agent: 'antigravity', model: 'Gemini 4 Flash' }] },
          ],
        },
      },
    },
    { id: 'collab-task:turn1:assign:t1c1', taskId: task.id, type: 'tool', text: 'workflow_delegate · quick', detail: 'Antigravity · Gemini 4 Flash\nNotes: 1\nDone.', status: 'completed', createdAt: at - 8 },
    { id: 'a0', taskId: task.id, type: 'assistant', text: 'Finished turn 1.', createdAt: at - 7 },
    { id: 'u1', taskId: task.id, type: 'user', text: 'Address 4 PDF notes', createdAt: at },
    {
      id: 'collab-task:turn2:route', taskId: task.id, type: 'tool', text: 'workflow_route', status: 'completed', createdAt: at + 1,
      detail: 'Antigravity · Gemini 4 Flash\n#1 (main.tex): Simple edits → Gemini 4 Flash\n#2 (main.tex): Prose & polish · race (Gemini 4 Neon vs GPT-6.2-Sol)\n#3 (main.tex): Math & rigorous → GPT-6.2-Sol\n#4 (main.tex): Layout & LaTeX → Gemini 4 Flash',
      meta: {
        dispatch: {
          strategy: 'balanced',
          router: { agent: 'antigravity', model: 'Gemini 4 Flash' },
          entries: [
            { clusterId: 'c1', notes: [1], file: 'main.tex', laneId: 'quick', laneName: 'Simple edits', mode: 'assign', itemId: 'collab-task:turn2:assign:c1', workers: [{ itemId: 'collab-task:turn2:assign:c1', agent: 'antigravity', model: 'Gemini 4 Flash' }] },
            { clusterId: 'c2', notes: [2], file: 'main.tex', laneId: 'polish', laneName: 'Prose & polish', mode: 'race', itemId: 'collab-task:turn2:race:c2', workers: [{ itemId: 'collab-task:turn2:race:c2:r0', agent: 'antigravity', model: 'Gemini 4 Neon' }, { itemId: 'collab-task:turn2:race:c2:r1', agent: 'codex', model: 'GPT-6.2-Sol' }], judge: { itemId: 'collab-task:turn2:race:c2:judge', agent: 'codex', model: 'GPT-6.2-Sol' } },
            { clusterId: 'c3', notes: [3], file: 'main.tex', laneId: 'rigorous', laneName: 'Math & rigorous', mode: 'assign', itemId: 'collab-task:turn2:assign:c3', workers: [{ itemId: 'collab-task:turn2:assign:c3', agent: 'codex', model: 'GPT-6.2-Sol' }] },
            { clusterId: 'c4', notes: [4], file: 'main.tex', laneId: 'layout', laneName: 'Layout & LaTeX', mode: 'assign', itemId: 'collab-task:turn2:assign:c4', workers: [{ itemId: 'collab-task:turn2:assign:c4', agent: 'antigravity', model: 'Gemini 4 Flash' }] },
          ],
        },
      },
    },
    { id: 'collab-task:turn2:assign:c1', taskId: task.id, type: 'tool', text: 'workflow_delegate · quick', detail: 'Antigravity · Gemini 4 Flash\nNotes: 1\nFixed typo.', status: 'completed', createdAt: at + 2 },
    { id: 'collab-task:turn2:race:c2', taskId: task.id, type: 'tool', text: 'workflow_race · Notes 2', detail: 'Selected: GPT-6.2-Sol\nCrisper phrasing with full fidelity.', status: 'completed', createdAt: at + 3, meta: { raceResult: { winnerModel: 'GPT-6.2-Sol', winnerItemIds: ['collab-task:turn2:race:c2:r1'] } } },
    { id: 'collab-task:turn2:race:c2:r0', parent: 'collab-task:turn2:race:c2', taskId: task.id, type: 'tool', text: 'workflow_racer · Gemini 4 Neon', detail: 'Antigravity · Gemini 4 Neon\nNotes: 2\nPolished.', status: 'completed', createdAt: at + 3.1 },
    { id: 'collab-task:turn2:race:c2:r1', parent: 'collab-task:turn2:race:c2', taskId: task.id, type: 'tool', text: 'workflow_racer · GPT-6.2-Sol', detail: 'Codex · GPT-6.2-Sol\nNotes: 2\nPolished concisely.', status: 'completed', createdAt: at + 3.2 },
    { id: 'collab-task:turn2:race:c2:judge', parent: 'collab-task:turn2:race:c2', taskId: task.id, type: 'tool', text: 'workflow_judge · GPT-6.2-Sol', detail: 'Recommended: GPT-6.2-Sol', status: 'completed', createdAt: at + 3.5 },
    { id: 'collab-task:turn2:assign:c3', taskId: task.id, type: 'tool', text: 'workflow_delegate · rigorous', detail: 'Codex · GPT-6.2-Sol\nNotes: 3\nChecking proof sketch.', status: 'inProgress', createdAt: at + 4 },
    { id: 'collab-task:turn2:assign:c4', taskId: task.id, type: 'tool', text: 'workflow_delegate · layout', detail: 'Antigravity · Gemini 4 Flash\nNotes: 4\nFormatted table.', status: 'completed', createdAt: at + 5 },
  ];
  for (const [width, dark, language] of [[1200, false, 'en'], [390, true, 'zh-CN']]) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 820 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/state') return json(snapshot);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/items')) return json({ items: dispatchItems });
      if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
      if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
      if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
      throw Error(`Unexpected fixture request ${url.pathname}`);
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.server.address().port}`);
    const zh = language === 'zh-CN';
    if (width > 680) await placeChat(page, 'Fill the window');
    else await page.getByRole('button', { name: zh ? '对话' : 'Chat', exact: true }).click();
    const cards = page.locator('.collab-dispatch-card');
    await expect(cards).toHaveCount(2);
    // Turn 1's finished card must remain Done even while Turn 2 is running.
    await expect(cards.nth(0).locator('.collab-dispatch-status')).toContainText(zh ? '完成' : 'Done');
    const card = cards.nth(1);
    await expect(card).toBeVisible();
    await expect(card.locator('.collab-dispatch-row')).toHaveCount(4);
    await expect(card.locator('.collab-dispatch-status')).toContainText(zh ? '1 个运行中' : '1 running');
    await expect(card.locator('.collab-agent-chip.is-winner')).toContainText('GPT-6.2-Sol');
    await expect(card.locator('.collab-agent-chip[data-state="running"]')).toContainText('GPT-6.2-Sol');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `dispatch card has no horizontal overflow at ${width}px`);
    await card.screenshot({ animations: 'disabled', path: `test-results/collaboration-dispatch-${width}${dark ? '-dark' : ''}-${language}.png` });
    // Expand Details & steps and verify raw tool rows remain accessible
    await card.locator('.collab-dispatch-details > summary').click();
    await expect(card.locator('.collab-dispatch-details > .tool-group-items > .tool-item')).toHaveCount(5);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: collaboration workers and dispatch card show live per-annotation routing, racing, judging, steps and stop controls on desktop and mobile.');
} finally { await browser.close(); await server.close(); }
