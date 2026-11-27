import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { selectOption } from './select.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { zhCN } from '../src/web/zh-CN.ts';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const zh = { ...JSON.parse(fs.readFileSync('src/web/locales/zh-CN.json', 'utf8')), ...zhCN };
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
fs.mkdirSync('test-results', { recursive: true });
const failures = [];

try {
  for (const { width, dark, language } of [
    { width: 1440, dark: false, language: 'en' },
    { width: 390, dark: true, language: 'zh-CN' },
  ]) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 920 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    const text = label => language === 'zh-CN' ? zh[label] ?? label : label;

    const codexRuntime = { connected: true, authenticated: true, installed: true, account: 'Fixture', error: null, models: [{ id: 'gpt-5.4', name: 'GPT-5.4', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' }] };
    const claudeRuntime = { connected: true, authenticated: true, installed: true, account: 'Fixture', error: null, models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', isDefault: true, efforts: [], defaultEffort: null }] };
    const chatgptRuntime = { connected: true, authenticated: true, installed: true, hidden: true, supportsReadOnlyTasks: false, account: 'Manual', error: null, models: [{ id: 'chatgpt-pro', name: 'ChatGPT Pro (web)', isDefault: true, efforts: [], defaultEffort: null }] };
    const project = { id: 'paper-1', name: 'Research paper', path: '/tmp/example', createdAt: 1 };
    const note = {
      id: 'note-1', projectId: project.id, key: 'fixture-pdf', page: 0, rect: [0.1, 0.2, 0.5, 0.25], createdAt: 1,
      comment: 'Tighten the wording here.', quote: 'The effect is really small.', source: { file: 'paper.tex', lines: [3, 3] },
    };
    let annotations = [note];
    let inFlightMarks = [];
    let executor = null;
    let submittedReplyExecutor = null;
    let autoSyncGithub = false;
    let syncedGithub = null;
    const githubRemote = { name: 'origin', repository: 'acme/quantum-paper', url: 'https://github.com/acme/quantum-paper' };
    const itemsByTask = new Map();
    const state = {
      version: 'test', csrf: 'fixture', gitAvailable: true, projects: [project], tasks: [], requests: [],
      runtime: codexRuntime, runtimes: { codex: codexRuntime, claude: claudeRuntime, chatgpt: chatgptRuntime },
    };

    await context.addInitScript(language => {
      localStorage.setItem('papilot:language', language);
      localStorage.setItem('papilot:setup-seen', '1');
      localStorage.setItem('papilot:selected-notes', JSON.stringify({ 'paper-1': ['note-1'] }));
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: value => language === 'en'
            ? Promise.resolve(globalThis.copiedPromptText = value)
            : Promise.reject(new Error('Clipboard unavailable')),
        },
      });
      if (language === 'zh-CN') document.execCommand = () => false;
    }, language);

    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      const method = route.request().method();
      const body = method === 'POST' ? route.request().postDataJSON() : null;
      const json = value => route.fulfill({ json: value });

      if (pathname === '/api/state') return json(state);
      if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (pathname === '/api/diagnostics') return json({ checks: [], checkedAt: Date.now() });
      if (pathname === '/api/chatgpt-pro') {
        if (method === 'POST') {
          if (body.enabled !== undefined) state.runtimes.chatgpt.hidden = !body.enabled;
          if (body.executor !== undefined) executor = body.executor;
          if (body.autoSyncGithub !== undefined) autoSyncGithub = body.autoSyncGithub;
        }
        return json({ enabled: !state.runtimes.chatgpt.hidden, executor, autoSyncGithub });
      }
      if (pathname === '/api/projects/paper-1/manuscript') {
        return json({ git: { branch: 'main', files: [] }, build: {}, annotations, inFlightMarks });
      }
      if (pathname === '/api/tasks' && method === 'POST') {
        assert.equal(body.agent, 'chatgpt');
        assert.deepEqual(body.annotations, ['note-1']);
        const created = {
          id: body.id, projectId: project.id, name: 'p-manual', title: body.title, instructions: body.instructions || '',
          worktree: '/tmp/wt', threadId: null, turnId: null, agent: 'chatgpt', model: 'chatgpt-pro', effort: null,
          status: 'waiting_input', createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null,
          manualTurn: { runId: 'run-1', status: 'awaiting_reply' },
        };
        state.tasks.push(created);
        annotations = [];
        inFlightMarks = [{ note: { ...note, taskId: created.id }, taskId: created.id, title: created.title, status: created.status }];
        itemsByTask.set(created.id, [{
          id: 'run-1', taskId: created.id, type: 'user', text: body.instructions || '', createdAt: Date.now(),
          meta: { notes: [{ id: note.id, where: 'Page 1 · paper.tex line 3', quote: note.quote, comment: note.comment }] },
        }]);
        return json(created);
      }
      const promptMatch = /^\/api\/tasks\/([^/]+)\/manual-prompt$/.exec(pathname);
      if (promptMatch) {
        return json({
          runId: 'run-1',
          prompt: syncedGithub
            ? `Use your GitHub connector to inspect \`${syncedGithub.repository}\` on branch \`${syncedGithub.branch}\`.\n\n## Repository context\n\n- Repository: \`${syncedGithub.repository}\`\n- Branch: \`${syncedGithub.branch}\`\n\n## Request\n\nTighten the wording here.\n\nFocus files:\n- \`paper.tex\` (L3)`
            : '## Request\n\nTighten the wording here.\n\n## Current LaTeX source\n\n### `paper.tex`\n```latex\nThe effect is really small.\n```',
          executor: { agent: 'codex', name: 'Codex', model: 'gpt-5.4' },
          github: { remotes: [githubRemote], synced: syncedGithub, syncing: false, autoSync: autoSyncGithub, syncError: null },
        });
      }
      const syncMatch = /^\/api\/tasks\/([^/]+)\/manual-github-sync$/.exec(pathname);
      if (syncMatch && method === 'POST') {
        syncedGithub = {
          remote: githubRemote.name,
          repository: githubRemote.repository,
          branch: 'papilot-pro/p-manual',
          commit: 'a1b2c3d4e5f60123456789abcdef0123456789ab',
          url: `${githubRemote.url}/tree/papilot-pro/p-manual`,
          reusedRemote: false,
        };
        return json({
          runId: 'run-1',
          prompt: `Use your GitHub connector to inspect \`${syncedGithub.repository}\` on branch \`${syncedGithub.branch}\`.\n\n## Repository context\n\n- Repository: \`${syncedGithub.repository}\`\n- Branch: \`${syncedGithub.branch}\`\n\n## Request\n\nTighten the wording here.\n\nFocus files:\n- \`paper.tex\` (L3)`,
          executor: { agent: 'codex', name: 'Codex', model: 'gpt-5.4' },
          github: { remotes: [githubRemote], synced: syncedGithub, syncing: false, autoSync: autoSyncGithub, syncError: null },
        });
      }
      const replyMatch = /^\/api\/tasks\/([^/]+)\/manual-reply$/.exec(pathname);
      if (replyMatch && method === 'POST') {
        submittedReplyExecutor = body.executor ?? null;
        const taskId = replyMatch[1];
        const task = state.tasks.find(item => item.id === taskId);
        const list = itemsByTask.get(taskId) || [];
        list.push(
          { id: `manual-reply:${body.requestKey}`, taskId, type: 'assistant', text: body.reply, status: 'completed', createdAt: Date.now(), meta: { advisor: 'ChatGPT Pro' } },
          { id: `${taskId}:t1:m1`, taskId, type: 'assistant', text: 'Updated `paper.tex` according to ChatGPT Pro’s suggestion.', status: 'completed', createdAt: Date.now() + 1 },
        );
        itemsByTask.set(taskId, list);
        task.status = 'reviewing';
        task.manualTurn = null;
        task.manualExecutor = body.executor ? { agent: body.executor.agent, model: body.executor.model || null } : { agent: 'codex', model: 'gpt-5.4' };
        task.review = { state: 'reviewing', round: 1, counts: { pending: 1 } };
        return json(task);
      }
      const itemsMatch = /^\/api\/tasks\/([^/]+)\/items$/.exec(pathname);
      if (itemsMatch) return json({ items: itemsByTask.get(itemsMatch[1]) || [], revision: 'rev:1' });
      return json({});
    });

    await page.goto(origin);
    // No separate External review sidebar entry exists.
    await expect(page.getByRole('button', { name: text('External review'), exact: true })).toHaveCount(0);

    // Enable ChatGPT Pro (web) in Settings → Experiments.
    if (width < 600) await page.locator('.sidebar-toggle').click();
    await page.locator('.settings-link').click();
    // Hidden ChatGPT Pro must not appear in Settings → Agents or count as "1 agent off".
    await page.locator('[data-settings-page="agents"]').click();
    await expect(page.locator('[data-agent="chatgpt"]')).toHaveCount(0);
    await expect(page.locator('.runtime-agent-choices')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="experiments"]').click();
    const card = page.locator('.chatgpt-pro-settings');
    const toggle = card.getByRole('switch', { name: text('Enable ChatGPT Pro (web)') });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await selectOption(card.locator('[role="combobox"]'), JSON.stringify(['codex', 'gpt-5.4']));
    await expect.poll(() => executor).toEqual({ agent: 'codex', model: 'gpt-5.4' });
    const autoSyncToggle = card.getByRole('switch', { name: text('Sync snapshot to GitHub automatically') });
    await expect(autoSyncToggle).not.toBeChecked();
    await autoSyncToggle.click();
    await expect(autoSyncToggle).toBeChecked();
    await expect.poll(() => autoSyncGithub).toBe(true);
    await page.locator('.settings-dialog .modal-close').click();

    // Pick ChatGPT Pro (web) in the regular manuscript composer and send with the selected annotation.
    if (width < 600) {
      await page.locator('.sidebar .manuscript-link').click();
      await page.locator('[data-task-home]:visible').first().click();
    }
    const composer = page.locator('.new-task-panel:visible');
    await expect(composer).toBeVisible();
    await composer.getByRole('button', { name: text('Agent settings') }).click();
    const menu = page.getByRole('dialog', { name: text('Agent settings') });
    await menu.getByRole('combobox').fill('ChatGPT Pro');
    await expect(menu.getByRole('option', { name: text('ChatGPT Pro (web)'), exact: true })).toBeVisible();
    await menu.getByRole('combobox').press('Enter');
    await menu.getByRole('combobox').press('Escape');

    await composer.getByRole('button', { name: text('Start task') }).click();

    // Stays on the Manuscript without flipping away to a separate form page!
    await expect(page.locator('.new-task-panel')).toBeVisible();
    if (width < 600) await page.locator('.sidebar-toggle').click();
    const taskRow = page.locator('.task-row').filter({ hasText: 'Tighten the wording here' });
    await expect(taskRow).toHaveCount(1);
    await expect(taskRow).toContainText(text('Waiting for ChatGPT Pro'));

    // Open the task from the sidebar -> standard Task conversation (PDF placeholder + Activity chat).
    await taskRow.getByRole('button').first().click();
    if (width < 600) await page.getByRole('button', { name: text('Chat') }).click();
    const conversation = page.locator('#conversation-panel');
    await expect(conversation.locator('.notes-message')).toContainText('Tighten the wording here.');
    const manualCard = conversation.locator('.manual-turn-card');
    await expect(manualCard).toBeVisible();
    await expect(conversation.getByLabel(text('Paste ChatGPT Pro’s reply'))).toBeVisible();

    // One-click GitHub snapshot sync switches the prompt to full-repo GitHub context.
    await expect(manualCard.locator('.manual-github-row')).toContainText('acme/quantum-paper');
    await manualCard.getByRole('button', { name: text('Sync to GitHub'), exact: true }).click();
    await expect(manualCard.locator('.manual-github-row')).toContainText('papilot-pro/p-manual');
    await expect(manualCard.locator('.manual-github-row')).toContainText(text('GitHub context ready'));

    await page.screenshot({ path: `test-results/chatgpt-pro-${width}-${language}-awaiting.png`, animations: 'disabled' });

    // Copy prompt works (clipboard on EN, expandable fallback field on zh-CN mobile) and includes the synced GitHub repo.
    await manualCard.getByRole('button', { name: text('Copy prompt'), exact: true }).click();
    if (language === 'en') {
      const copied = await page.evaluate(() => globalThis.copiedPromptText);
      assert.match(copied, /acme\/quantum-paper/);
      assert.match(copied, /papilot-pro\/p-manual/);
      await expect(manualCard.getByRole('status')).toContainText('Copied');
    } else {
      await expect(manualCard.getByLabel(text('Prompt for ChatGPT Pro'))).toBeVisible();
      await expect(manualCard.getByLabel(text('Prompt for ChatGPT Pro'))).toBeFocused();
    }

    // Switch the local executor right inside the task composer before sending Pro's reply!
    await conversation.getByRole('button', { name: text('Local agent for edits') }).click();
    const execMenu = page.getByRole('dialog', { name: text('Local agent for edits') });
    await execMenu.getByRole('combobox').fill('Claude Sonnet');
    await execMenu.getByRole('combobox').press('Enter');
    await execMenu.getByRole('combobox').press('Escape');
    await expect(conversation.locator('.composer-hint')).toContainText('Claude');

    // Paste free-form Markdown reply in the normal bottom composer and send!
    const replyBox = conversation.getByLabel(text('Paste ChatGPT Pro’s reply'));
    await replyBox.fill('Replace "really small" with "modest" for clarity.');
    await conversation.getByRole('button', { name: text('Send reply to local agent') }).click();
    await expect.poll(() => submittedReplyExecutor).toEqual({ agent: 'claude', model: 'claude-sonnet' });

    // Pro's reply appears in the same chat thread labeled ChatGPT Pro, followed by Codex's summary.
    await expect(manualCard).toHaveCount(0);
    await expect(conversation).toContainText('ChatGPT Pro');
    await expect(conversation).toContainText('Replace "really small" with "modest" for clarity.');
    await expect(conversation).toContainText('Updated paper.tex according to ChatGPT Pro’s suggestion.');
    await page.screenshot({ path: `test-results/chatgpt-pro-${width}-${language}-applied.png`, animations: 'disabled' });

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log('ChatGPT Pro (web): Experiments toggle, native manuscript submit, in-thread prompt copy, free-form reply paste, and local agent handoff checked.');
} finally {
  await browser.close();
  await server.close();
}
