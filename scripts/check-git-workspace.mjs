import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../engine/node_modules/@playwright/test/index.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const project = { id: 'git-paper', name: 'Example paper', path: '/tmp/git-paper', createdAt: 1 };
const task = { id: 'git-task', projectId: project.id, title: 'Clarify the introduction', name: 'git-task', instructions: '', status: 'idle', createdAt: 1, updatedAt: 1, review: null };
const runtime = { connected: true, authenticated: true, models: [{ id: 'model', name: 'Model', isDefault: true, efforts: [] }] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [project], tasks: [task], requests: [], runtime, runtimes: { codex: runtime } };
const initialFiles = [{ path: 'main.tex', status: 'M', staged: false, unstaged: true, lines: [2, 4] }, { path: 'references.bib', status: '?', staged: false, unstaged: true }];
const git = { branch: 'main', remote: true, upstream: 'origin/main', ahead: 1, behind: 0, head: { hash: 'abc1234', subject: 'Clarify the introduction', date: 1 }, files: structuredClone(initialFiles) };
const actions = [];
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/git/overview')) return json({ worktrees: [{ path: project.path, current: true, branch: git.branch, head: git.head.hash, status: git }], commits: [{ ...git.head, parents: [], author: 'Author', refs: ['main'] }], truncated: false });
  if (url.pathname.endsWith('/git/diff')) {
    const file = url.searchParams.get('path');
    return json({ path: file, diff: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-Old ${file}\n+New ${file}\n`, truncated: false });
  }
  if (url.pathname.endsWith('/git/stage')) {
    const body = route.request().postDataJSON(); actions.push(['stage', body]);
    git.files = git.files.map(file => body.paths.includes(file.path) ? { ...file, staged: body.stage, unstaged: !body.stage } : file);
    return json({ git });
  }
  if (url.pathname.endsWith('/git/commit')) {
    const body = route.request().postDataJSON(); actions.push(['commit', body]);
    git.files = git.files.filter(file => body.staged ? !file.staged : !body.paths.includes(file.path));
    git.head = { hash: 'def5678', subject: body.message, date: 2 }; git.ahead++;
    return json({ git, commit: 'def5678' });
  }
  if (url.pathname.endsWith('/git/push')) { actions.push(['push']); git.ahead = 0; return json({ git }); }
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'fixture', pages: [[612, 792], [612, 792]] }, annotations: [] });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  throw new Error(`Unexpected request: ${route.request().method()} ${url.pathname}`);
});
const workspace = page.getByRole('region', { name: 'Git status', exact: true });
const panel = workspace.locator('.git-panel');
const details = workspace.locator('.git-details');
const toolbar = workspace.locator('.git-toolbar');
const openGit = async () => { if (!await page.locator('.git-link').isVisible()) await page.getByRole('button', { name: 'Show task list', exact: true }).click(); await page.locator('.git-link').click(); };
try {
  await page.goto(origin);
  await page.locator('.manuscript-link').click();
  await page.locator('.textLayer span').first().waitFor();
  await expect(page.getByRole('tablist', { name: 'Manuscript panels' }).getByRole('tab', { name: /^Git/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse manuscript panel', exact: true }).click();
  await openGit();
  await expect(workspace).toBeVisible();
  await expect(page.locator('.manuscript')).toHaveCount(0);
  await expect(page.locator('.git-link')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.manuscript-link')).not.toHaveAttribute('aria-current', 'page');
  const left = await panel.boundingBox(), right = await details.boundingBox();
  assert.ok(left.x + left.width <= right.x + 1, 'Git operations are left of the detail area');
  assert.equal(Math.round(left.x), Math.round((await page.locator('.main').boundingBox()).x));
  await expect(details.getByRole('region', { name: 'Changes in main.tex', exact: true })).toContainText('New main.tex');
  const message = panel.getByRole('textbox', { name: 'Commit message' });
  await message.fill('Keep this commit draft');
  await panel.getByRole('button', { name: 'references.bib', exact: true }).click();
  await expect(details.getByRole('region', { name: 'Changes in references.bib', exact: true })).toContainText('New references.bib');
  await details.locator('.git-detail-switcher').getByRole('button', { name: 'Commit graph', exact: true }).click();
  await expect(details.locator('.git-graph-row')).toHaveCount(1);
  await page.reload();
  await expect(workspace).toBeVisible();
  await expect(message).toHaveValue('Keep this commit draft');
  await expect(details.locator('.git-detail-switcher').getByRole('button', { name: 'Commit graph', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await details.locator('.git-detail-switcher').getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(details.getByRole('region', { name: 'Changes in references.bib', exact: true })).toBeVisible();
  await page.locator('.task-link').click();
  const chat = page.locator('.activity-panel textarea').first();
  await chat.fill('Keep this task draft');
  await openGit();
  await expect(message).toHaveValue('Keep this commit draft');
  await page.locator('.task-link').click();
  await expect(chat).toHaveValue('Keep this task draft');
  await openGit();
  // Commit operations stay pinned while the changed files scroll independently.
  git.files.push(...Array.from({ length: 60 }, (_, i) => ({ path: `sections/section-${i}.tex`, status: 'M', staged: false, unstaged: true })));
  await panel.getByRole('button', { name: 'Refresh changes' }).click();
  await expect(panel.locator('.git-file')).toHaveCount(62);
  const toolbarY = (await toolbar.boundingBox()).y, messageY = (await message.boundingBox()).y;
  await panel.locator('.git-file-lists').evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await panel.locator('.git-file-lists').evaluate(el => el.scrollTop > 0));
  assert.equal((await toolbar.boundingBox()).y, toolbarY);
  assert.equal((await message.boundingBox()).y, messageY);
  git.files = structuredClone(initialFiles);
  await panel.getByRole('button', { name: 'Refresh changes' }).click();
  await expect(panel.locator('.git-file')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Stage references.bib', exact: true }).click();
  await message.fill('Add references');
  await panel.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Committed def5678.');
  await expect(details.getByRole('region', { name: 'Changes in main.tex', exact: true })).toBeVisible();
  await toolbar.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Push', exact: true })).toBeDisabled();
  assert.deepEqual(actions, [['stage', { paths: ['references.bib'], stage: true }], ['commit', { message: 'Add references', staged: true }], ['push']]);
  await page.screenshot({ path: 'test-results/git-workspace-desktop.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/git-workspace-dark.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('.sidebar')).toBeHidden();
    await openGit();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(message).toBeInViewport();
    await expect(details.getByRole('region', { name: 'Changes in main.tex', exact: true })).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: `test-results/git-workspace-${width}.png` });
  }
  // Git keeps the manuscript's collapsed preference and PDF view separate.
  await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  await page.locator('.manuscript-link').click();
  await expect(page.locator('.manuscript-side')).toBeHidden();
  await expect(page.locator('.git-workspace')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('Git workspace passed: left-side controls, separate diff/history, navigation and draft restoration, pinned commit controls, staging/commit/push, responsive layouts.');
} catch (error) {
  await page.screenshot({ path: 'test-results/git-workspace-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
