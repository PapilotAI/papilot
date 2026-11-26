import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { Memory, memoryRules, ruleKey } from '../src/server/memory.ts';
import { registerMemoryRoutes } from '../src/server/memory-routes.ts';
import { Store } from '../src/server/store.ts';

// Real memory routes and files in a disposable Git repository and home; the
// rest of the workspace is a fixture.
fs.mkdirSync('test-results', { recursive: true });
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-memory-ui-')));
const paper = path.join(root, 'paper'), home = path.join(root, 'home');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', args, { cwd: paper, env, stdio: 'pipe' }).toString();
fs.mkdirSync(paper); git('init', '-q'); fs.writeFileSync(path.join(paper, 'main.tex'), '\\section{Introduction}\n'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Base');
const store = new Store(':memory:'), memory = new Memory({ user: home });
const project = { id: 'paper', name: 'Example paper', path: paper, createdAt: 1 };
const now = Date.now();
// The author turned down stronger claims in two tasks without ever stating a
// rule; the second task's review is finished and ready to save.
const review = { state: 'done', round: 1, counts: { accepted: 2, rejected: 1, pending: 0 }, unsent: 0, comments: 0, files: ['main.tex'] };
const base = { projectId: 'paper', agent: 'codex', threadId: 'thread', turnId: null, model: null, status: 'reviewing', feedbackCursor: 0, error: null, deferred: true, review };
const earlier = { ...base, id: 'intro', name: 'p-intro', title: 'Polish the introduction', instructions: 'Polish the introduction.', worktree: path.join(root, 'intro'), createdAt: now - 7200000, updatedAt: now - 7200000, deferred: false, delivery: { mode: 'commit', commit: 'abc1234', branch: 'main' }, review: { ...review, files: [] } };
const rule = 'Don\'t strengthen claims: write "show", not "prove", and use "significantly" only for statistical significance.';
const examples = [
  { task: 'abstract', rejected: 'significantly outperforms all baselines', kept: 'outperforms the baselines' },
  { task: earlier.id, title: earlier.title, rejected: 'We prove that', kept: 'We show that' },
  { task: earlier.id, title: earlier.title, said: 'Too strong, we only have experiments.' },
];
const task = { ...base, id: 'abstract', name: 'p-abstract', title: 'Tighten the abstract', instructions: 'Tighten the abstract to 150 words.', worktree: path.join(root, 'task'), createdAt: now - 60000, updatedAt: now - 60000,
  memory: [{ id: 'noticed-0', text: rule, scope: 'personal', examples, status: 'pending' }] };
store.saveProject(project); store.saveTask(earlier); store.saveTask(task);
store.saveItem({ id: 'first', taskId: task.id, type: 'user', text: 'Tighten the abstract to 150 words.', createdAt: now - 60000 });
store.saveItem({ id: 'abstract:turn:reply', taskId: task.id, type: 'assistant', text: 'I cut the abstract to 148 words and made the contribution statement more direct.', createdAt: now - 50000 });

const server = Fastify();
server.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 400).send({ error: error.message }));
registerMemoryRoutes(server, store, () => memory);
await server.register(staticFiles, { root: path.resolve(process.env.PAPILOT_WEB_DIST || 'dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [] };
const snapshot = () => ({ version: 'test', csrf: 'fixture', projects: [project], tasks: [store.task(task.id), store.task(earlier.id)], requests: [], runtime, runtimes: { codex: runtime } });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
// The task is selected at desktop size and shown with its chat only, where
// the save step is the last card; a phone shows the same in its Chat tab.
async function open(viewport, colorScheme = 'light') {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 820 }, colorScheme });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
    if (url.pathname.startsWith('/api/memory') || /^\/api\/tasks\/[^/]+\/memory\//.test(url.pathname)) return route.continue();
    if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (url.pathname === '/api/state') return json(snapshot());
    if (url.pathname.endsWith('/commit-message')) return json({ message: 'Tighten the abstract', agent: 'codex' });
    if (url.pathname.endsWith('/predict')) return json({});
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
    if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
    if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
    if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
    if (url.pathname.endsWith('/items')) return json({ items: store.items(task.id) });
    if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
    if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
    if (url.pathname.endsWith('/skills')) return json({ skills: [] });
    if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main' });
    if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
    if (url.pathname === '/api/quick-model') return route.fulfill({ json: { choice: null } });
    throw Error(`Unexpected fixture request ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:${server.server.address().port}/?task=${task.id}`);
  await page.locator('.task-list .task-title', { hasText: task.title }).first().click();
  await page.setViewportSize(viewport);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  return page;
}
const localFile = path.join(paper, '.papilot', 'memory.local.md'), sharedFile = path.join(paper, '.papilot', 'memory.md'), personalFile = path.join(home, 'memory.md');
const rules = file => fs.existsSync(file) ? memoryRules(fs.readFileSync(file, 'utf8')) : [];
try {
  const page = await open({ width: 1280, height: 820 });
  // Below the save step, which stays usable: the rule, where it would go, and why on request.
  const save = page.locator('.task-delivery');
  await expect(save.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Tighten the abstract');
  const card = save.getByRole('region', { name: 'Writing memory' });
  await expect(card).toContainText('Remember this writing habit?');
  await expect(card).toContainText(rule);
  await expect(card).toContainText('All papers');
  await expect(save.getByRole('button', { name: 'Commit to manuscript', exact: true })).toBeEnabled();
  const prompted = card.locator('.memory-examples > li');
  await expect(prompted.first()).toBeHidden();
  await card.getByText('What prompted it', { exact: true }).click();
  await expect(prompted).toHaveText([/^This task.*significantly outperforms all baselines.*outperforms the baselines$/, /^Polish the introduction.*We prove that.*We show that.*Too strong, we only have experiments\.$/]);
  await expect(prompted.nth(1).getByRole('listitem')).toHaveCount(2);
  await expect(prompted.first().locator('del')).toHaveText('Rejected: significantly outperforms all baselines');
  const chat = page.locator('#conversation-panel');
  await chat.screenshot({ animations: 'disabled', path: 'test-results/memory-card-desktop.png' });

  // Remembered for all papers, undone, and remembered again.
  await card.getByRole('button', { name: 'Remember', exact: true }).click();
  await expect(card).toContainText('Remembered');
  await expect(card.getByRole('button', { name: 'Undo' })).toBeFocused();
  assert.deepEqual(rules(personalFile), [rule]);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('button', { name: 'Remember', exact: true })).toBeFocused();
  assert.deepEqual(rules(personalFile), []);
  await card.getByRole('button', { name: 'Remember', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible();
  assert.deepEqual(rules(personalFile), [rule]);
  assert.equal(store.task(task.id).memory[0].status, 'saved');
  await chat.screenshot({ animations: 'disabled', path: 'test-results/memory-card-saved-desktop.png' });

  // Manage opens Settings → Memory.
  await card.getByRole('button', { name: 'Manage' }).click();
  const settings = page.getByRole('dialog', { name: 'Memory', exact: true });
  await expect(settings).toBeVisible();
  const list = settings.locator('.memory-list li[data-memory-rule]');
  const group = name => settings.getByRole('region', { name, exact: true });
  await expect(settings.getByRole('switch', { name: 'Learn from reviews' })).toBeChecked();
  await settings.getByRole('radio', { name: 'All papers' }).check();
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText(rule);
  await page.screenshot({ animations: 'disabled', path: 'test-results/memory-settings-personal-desktop.png' });
  // Kept for this paper instead: in the checkout only, invisible to Git.
  await list.first().getByRole('button', { name: 'More actions for this preference' }).click();
  await page.getByRole('menuitem', { name: 'Move to this paper' }).click();
  await expect(group('All papers').locator('.memory-empty')).toHaveText('No preferences yet');
  assert.deepEqual([rules(personalFile), rules(localFile)], [[], [rule]]);
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
  await settings.getByRole('radio', { name: 'This paper' }).check();
  await expect(list).toHaveCount(1);
  await expect(group('Only on this computer').locator('[data-memory-rule] > p')).toHaveText([rule]);
  await expect(group('Shared with coauthors')).toContainText('.papilot/memory.md');
  await page.screenshot({ animations: 'disabled', path: 'test-results/memory-settings-desktop.png' });

  // A change made elsewhere since the page loaded is reported, and the list shows the file as it is now.
  fs.appendFileSync(localFile, '- Number every displayed equation.\n');
  await list.first().getByRole('button', { name: 'Edit preference' }).click();
  await settings.getByRole('textbox', { name: 'Preference', exact: true }).fill('A stale edit');
  await settings.getByRole('textbox', { name: 'Preference', exact: true }).press('Enter');
  await expect(settings.getByRole('alert')).toHaveText('Memory changed on disk. Reload it before saving.');
  await expect(list).toHaveCount(2);
  await page.screenshot({ animations: 'disabled', path: 'test-results/memory-settings-conflict-desktop.png' });
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await list.nth(1).getByRole('button', { name: 'More actions for this preference' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(list).toHaveCount(1);
  await expect(settings.getByRole('alert')).toHaveCount(0);

  // Inline edit: Enter submits through the form; Escape cancels.
  await list.first().getByRole('button', { name: 'Edit preference' }).click();
  const edit = settings.getByRole('textbox', { name: 'Preference', exact: true });
  await edit.fill('Discarded wording');
  await edit.press('Escape');
  await expect(settings).toBeVisible();
  await expect(list.first()).toContainText(rule);
  await list.first().getByRole('button', { name: 'Edit preference' }).click();
  await settings.getByRole('textbox', { name: 'Preference', exact: true }).fill('Don\'t strengthen claims beyond what the results show.');
  await settings.getByRole('textbox', { name: 'Preference', exact: true }).press('Enter');
  await expect(list.first()).toContainText('Don\'t strengthen claims beyond what the results show.');
  assert.deepEqual(rules(localFile), ['Don\'t strengthen claims beyond what the results show.']);

  // Sharing moves the rule into the repository file coauthors receive.
  await list.first().getByRole('button', { name: 'More actions for this preference' }).click();
  await page.getByRole('menuitem', { name: 'Share with coauthors' }).click();
  await expect(group('Shared with coauthors').locator('[data-memory-rule] > p')).toHaveText(['Don\'t strengthen claims beyond what the results show.']);
  await expect(group('Only on this computer').locator('.memory-empty')).toHaveText('No preferences yet');
  assert.deepEqual(rules(sharedFile), ['Don\'t strengthen claims beyond what the results show.']);
  assert.deepEqual(rules(localFile), []);
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '?? .papilot/memory.md\n');

  // A rule for all papers, added from Settings.
  await settings.getByRole('radio', { name: 'All papers' }).check();
  await expect(group('All papers').locator('.memory-empty')).toHaveText('No preferences yet');
  await group('All papers').getByRole('button', { name: 'Add preference' }).click();
  await settings.getByRole('textbox', { name: 'New preference' }).fill('Prefer British spelling.');
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(list).toHaveCount(1);
  await expect(group('All papers').getByRole('button', { name: 'Add preference' })).toBeFocused();
  assert.deepEqual(rules(personalFile), ['Prefer British spelling.']);
  // Suggested preferences can be written in a chosen language.
  const language = settings.getByRole('combobox', { name: 'Memory language', exact: true });
  await expect(language).toHaveAttribute('data-value', 'auto');
  await language.click();
  await page.locator('.select-list:popover-open [data-value="zh-Hans"]').click();
  await expect(language).toHaveAttribute('data-value', 'zh-Hans');
  assert.equal(store.preference('memory-language'), 'zh-Hans');

  // Learning can be turned off; deleting a rule removes it from the file.
  await settings.getByRole('switch', { name: 'Learn from reviews' }).click();
  await expect(settings.getByRole('switch', { name: 'Learn from reviews' })).not.toBeChecked();
  assert.equal(store.preference('memory-learning'), false);
  await list.first().getByRole('button', { name: 'More actions for this preference' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(list).toHaveCount(0);
  assert.deepEqual(rules(personalFile), []);
  await page.close();

  // On a phone: the author's outright request, offered in the Chat tab's save card.
  const voice = 'Write in the first-person plural ("we show"); don\'t switch to the passive voice.';
  store.updateTask(task.id, { memory: [{ id: 'noticed-1', text: voice, scope: 'personal', examples: [{ task: task.id, said: 'From now on, keep "we" instead of the passive voice.' }, { task: task.id, rejected: 'it is shown that', kept: 'we show that' }], status: 'pending' }] });
  const phone = await open({ width: 390, height: 844 }, 'dark');
  const phoneCard = phone.locator('.task-delivery').getByRole('region', { name: 'Writing memory' });
  await phoneCard.scrollIntoViewIfNeeded();
  await expect(phoneCard).toContainText(voice);
  await phoneCard.getByText('What prompted it', { exact: true }).click();
  await expect(phoneCard.locator('.memory-examples')).toContainText('From now on, keep "we" instead of the passive voice.');
  const box = await phoneCard.getByRole('button', { name: 'Remember', exact: true }).boundingBox();
  assert.ok(box && box.height >= 36, 'touch-sized buttons on a phone');
  await phone.screenshot({ animations: 'disabled', path: 'test-results/memory-card-phone-dark.png' });
  await phone.evaluate(event => window.dispatchEvent(new Event(event)), 'papilot:open-memory');
  const phoneSettings = phone.getByRole('dialog', { name: 'Memory', exact: true });
  await expect(phoneSettings.locator('.memory-list li[data-memory-rule]')).toHaveCount(1);
  await expect(phoneSettings).toContainText('.papilot/memory.md');
  await phone.screenshot({ animations: 'disabled', path: 'test-results/memory-settings-phone-dark.png' });
  await phoneSettings.getByRole('button', { name: 'Close' }).click();
  await phoneCard.getByRole('button', { name: 'Dismiss' }).click();
  await expect(phoneCard).toHaveCount(0);
  await expect(phone.locator('.task-delivery').getByRole('button', { name: 'Commit to manuscript', exact: true })).toBeVisible();
  assert.deepEqual(store.preference('memory-dismissed:paper'), [ruleKey(voice)]);
  assert.deepEqual(store.preference('memory-dismissed'), [ruleKey(voice)], 'a rule for all papers is dismissed in every paper');
  await phone.close();
  assert.deepEqual(errors, []);
  console.log('Writing memory card and settings checks passed.');
} finally {
  await browser.close(); await server.close(); store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
