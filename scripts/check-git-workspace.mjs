import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { afterRender, chromium, expect } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.clock.install();
await page.addInitScript(() => localStorage.setItem('papilot:advanced-git', 'on'));
const errors = []; page.on('pageerror', error => errors.push(error.message));
const diffFailures = [];
page.on('requestfailed', request => {
  if (new URL(request.url()).pathname.endsWith('/git/diff')) diffFailures.push(request.failure()?.errorText);
});
const project = { id: 'git-paper', name: 'Example paper', path: '/tmp/git-paper', createdAt: 1 };
const task = { id: 'git-task', projectId: project.id, title: 'Clarify the introduction', name: 'git-task', instructions: '', agent: 'claude', model: 'model', effort: 'high', status: 'idle', createdAt: 1, updatedAt: 1, review: null };
const runtime = { connected: true, authenticated: true, models: [{ id: 'model', name: 'Model', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'low', fastMode: { serviceTier: 'priority', description: '' } }, { id: 'other-model', name: 'Other model', isDefault: false, efforts: ['low', 'high'], defaultEffort: 'high' }] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [project], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime } }, gitAvailable: true };
const initialFiles = [{ path: 'main.tex', status: 'M', staged: false, unstaged: true, lines: [2, 4] }, { path: 'references.bib', status: '?', staged: false, unstaged: true }];
const git = { branch: 'main', remote: true, upstream: 'origin/main', ahead: 1, behind: 0, head: { hash: 'abc1234', subject: 'Clarify the introduction', date: 1 }, files: structuredClone(initialFiles) };
const actions = [], messageRequests = [], resolveRequests = [];
let resolveGate, releaseResolution, resolveError;
let messageError = null, messageGate = null;
const note = { id: 'note-1', projectId: project.id, key: 'fixture', page: 0, rect: [72, 72, 200, 90], rects: [[72, 72, 200, 90]], source: null, quote: 'Fixture', comment: 'Original note', createdAt: 1 };
let failNoteSave = false, gitRequests = 0;
let diffText = 'New', diffRequests = 0, diffGate = null, diffError = null;
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const handleApi = async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (/\/git(?:\/|$)/.test(url.pathname)) gitRequests++;
  if (url.pathname.endsWith('/git/message') || url.pathname.endsWith('/commit-message')) {
    const body = route.request().postDataJSON(); messageRequests.push(body);
    if (messageGate) await messageGate;
    if (url.pathname.endsWith('/commit-message') && !messageError && body.language === 'en' && body.agent === 'claude') return json({ message: body.fresh ? 'Rewrite the opening' : 'Clarify the introduction', agent: body.agent });
    return messageError ? route.fulfill({ status: 400, json: { error: messageError } }) : json({ message: body.language === 'auto' ? '改进引言' : `Written by ${body.agent}`, agent: body.agent });
  }
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/predict')) return json({});
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/annotations/note-1')) {
    if (failNoteSave) return route.fulfill({ status: 503, json: { error: 'Could not save note.' } });
    note.comment = route.request().postDataJSON().comment; return json(note);
  }
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/git/resolve')) {
    const choice = route.request().postDataJSON(); resolveRequests.push(choice);
    if (resolveGate) await resolveGate;
    if (resolveError) return route.fulfill({ status: 400, json: { error: resolveError } });
    git.merging = { ...git.merging, conflicts: [] };
    return json({ agent: choice.agent, summary: 'Merged the opening.', remaining: [], git });
  }
  if (url.pathname.endsWith('/git/fetch')) return json({ git });
  if (url.pathname.endsWith('/git/history')) return json({ versions: [], next: null });
  if (url.pathname.endsWith('/git/overview')) return json({ worktrees: [{ path: project.path, current: true, branch: git.branch, head: git.head.hash, status: git }], commits: [{ ...git.head, parents: [], author: 'Author', refs: ['main'] }], truncated: false });
  if (url.pathname.endsWith('/git/diff')) {
    const file = url.searchParams.get('path'), text = diffText;
    diffRequests++;
    if (diffGate) await diffGate;
    if (diffError) return route.fulfill({ status: 503, json: { error: diffError } });
    return json({ path: file, diff: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-Old ${file}\n+${text} ${file}\n`, truncated: false });
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
  if (url.pathname.endsWith('/apply')) { const body = route.request().postDataJSON(); actions.push(['apply', body]); return json({}); }
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'fixture', pages: [[612, 792], [612, 792]] }, annotations: [note] });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname === '/api/quick-model') return route.fulfill({ json: { choice: null } });
  throw new Error(`Unexpected request: ${route.request().method()} ${url.pathname}`);
};
await page.route('**/api/**', handleApi);
await page.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><header class="bar"></header><main id="paper"></main></body></html>' }));
const workspace = page.getByRole('region', { name: 'Version Management', exact: true });
const panel = workspace.locator('.git-panel');
const details = workspace.locator('.git-details');
const toolbar = workspace.locator('.git-toolbar');
const openGit = async () => { if (!await page.locator('.git-link').isVisible()) await page.getByRole('button', { name: 'Show task list', exact: true }).click(); await page.locator('.git-link').click(); };
try {
  await page.goto(origin);
  await page.locator('.manuscript-link').click();
  await page.locator('.textLayer span').first().waitFor();
  // Leaving the manuscript saves note edits, and a failed save keeps the editor open.
  await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();
  await page.locator('.pdf-reading-notes').getByRole('button', { name: 'Edit note 1', exact: true }).click();
  const noteEditor = page.locator('.pdf-reading-notes').getByRole('textbox', { name: 'Edit note 1', exact: true });
  await noteEditor.fill('Save before opening version management');
  failNoteSave = true;
  await openGit();
  await expect(page.locator('.pdf-reading-notes').getByRole('alert')).toContainText('Could not save note.');
  await expect(workspace).toHaveCount(0);
  await expect(noteEditor).toHaveValue('Save before opening version management');
  failNoteSave = false;
  await openGit();
  await expect(workspace).toBeVisible();
  assert.equal(note.comment, 'Save before opening version management');
  await page.locator('.manuscript-link').click();

  await expect(page.getByRole('tablist', { name: 'Manuscript panels' }).getByRole('tab', { name: /^Version Management/ })).toHaveCount(0);
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
  const generateLanguage = panel.getByRole('button', { name: 'Generate commit message', exact: true });
  const chooseLanguage = async value => {
    await page.locator('.settings-link').click();
    await page.locator('[data-settings-page="git"]').click();
    const choice = page.getByRole('combobox', { name: 'Commit message language', exact: true });
    await choice.click();
    await page.locator(`.select-list:popover-open [data-value="${value}"]`).click();
    await expect(choice).toHaveAttribute('data-value', value);
    await page.locator('.settings-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  };
  await generateLanguage.click();
  await expect(message).toHaveValue('改进引言');
  assert.equal(messageRequests.at(-1).language, 'auto');
  await message.fill('My handwritten message');
  await chooseLanguage('en');
  await expect(message).toHaveValue('My handwritten message');
  await generateLanguage.click();
  await expect(message).toHaveValue(/^Written by /);
  assert.equal(messageRequests.at(-1).language, 'en');
  await page.reload();
  await openGit();
  await generateLanguage.click();
  await expect(message).toHaveValue(/^Written by /);
  assert.equal(messageRequests.at(-1).language, 'en', 'language survives a reload');
  await chooseLanguage('auto');
  await expect(message).toHaveValue(/^Written by /);
  await generateLanguage.click();
  await expect(message).toHaveValue('改进引言');
  assert.equal(messageRequests.at(-1).language, 'auto', 'automatic language can be restored');
  await chooseLanguage('en');

  // The staged manuscript dialog reads the same saved preference.
  git.files[0].staged = true;
  await page.reload();
  await page.locator('.manuscript-link').click();
  await page.locator('.manuscript').getByRole('button', { name: 'Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Commit…', exact: true }).click();
  const dialog = page.locator('.commit-dialog');
  await expect(dialog.getByRole('textbox', { name: 'Commit message', exact: true })).toHaveValue(/^Written by /);
  assert.equal(messageRequests.at(-1).language, 'en');
  assert.equal(messageRequests.at(-1).staged, true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  git.files[0].staged = false;

  // A task's inline commit step also uses English, despite its Chinese title.
  Object.assign(task, { title: '改进引言', status: 'reviewing', deferred: true, review: { state: 'done', round: 1, counts: { accepted: 1 }, files: ['main.tex'] } });
  const taskLink = page.locator(`.task-row[data-task="${task.id}"] .task-link`);
  const taskView = name => page.getByRole('group', { name: 'Workspace view', exact: true }).getByRole('button', { name, exact: true });
  const reloadTaskChat = async () => { await page.reload(); await taskLink.click(); await taskView('Chat').click(); };
  await reloadTaskChat();
  const taskCommit = page.locator('.task-apply');
  const taskMessage = taskCommit.getByRole('textbox', { name: 'Commit message', exact: true });
  const generateTaskMessage = taskCommit.getByRole('button', { name: 'Generate commit message', exact: true });
  const commitTask = taskCommit.getByRole('button', { name: 'Commit to manuscript', exact: true });
  await expect(taskMessage).toHaveValue('Clarify the introduction');
  assert.equal(messageRequests.at(-1).language, 'en');
  assert.equal(messageRequests.at(-1).fresh, false);
  assert.equal(messageRequests.at(-1).agent, task.agent);
  await page.screenshot({ path: 'test-results/task-commit-initial-language.png', animations: 'disabled' });
  await commitTask.click();
  await expect.poll(() => actions.at(-1)).toEqual(['apply', { mode: 'commit', message: 'Clarify the introduction', keepCurrent: false }]);

  let releaseInitial;
  messageGate = new Promise(resolve => { releaseInitial = resolve; });
  const beforeManual = messageRequests.length;
  await reloadTaskChat();
  await expect.poll(() => messageRequests.length).toBe(beforeManual + 1);
  await expect(taskCommit.getByRole('progressbar', { name: /is writing a commit message/ })).toBeAttached();
  await expect(taskCommit.getByRole('button', { name: 'Apply to workspace' })).toBeEnabled();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(taskMessage).toBeVisible();
  await page.screenshot({ path: 'test-results/task-commit-loading-mobile-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await taskMessage.fill('My handwritten task draft');
  const initialResponse = page.waitForResponse(response => response.url().endsWith('/commit-message'));
  messageGate = null; releaseInitial(); await (await initialResponse).finished(); await afterRender(page);
  await expect(taskMessage).toHaveValue('My handwritten task draft');
  await generateTaskMessage.click();
  await expect(taskMessage).toHaveValue('Rewrite the opening');
  assert.equal(messageRequests.at(-1).fresh, true);
  const beforeCleared = messageRequests.length;
  await taskMessage.fill('');
  await taskView('Split').click();
  await taskView('Chat').click();
  await expect(taskMessage).toHaveValue('');
  assert.equal(messageRequests.length, beforeCleared);

  messageError = 'The commit-message agent is unavailable.';
  await reloadTaskChat();
  await expect(taskCommit.getByRole('alert')).toHaveText(messageError);
  await expect(commitTask).toBeDisabled();
  await taskMessage.fill('Commit the reviewed introduction');
  await expect(commitTask).toBeEnabled();
  await page.screenshot({ path: 'test-results/task-commit-error-recovery.png', animations: 'disabled' });
  messageError = null;

  task.delivery = { mode: 'commit', accepted: 'accepted', branch: 'main', commit: 'approved', pending: true };
  task.review.files = [];
  const beforeCommitRetry = messageRequests.length;
  await reloadTaskChat();
  await expect(taskMessage).toHaveCount(0);
  await commitTask.click();
  await expect.poll(() => actions.at(-1)).toEqual(['apply', { mode: 'commit', keepCurrent: false }]);
  assert.equal(messageRequests.length, beforeCommitRetry, 'Retrying a pending commit reuses its recorded message');
  task.delivery = null;
  task.review.files = ['main.tex'];

  task.reconciliation = { id: 'merge', round: 1, files: ['main.tex'], ready: true, intent: { mode: 'commit', message: '保留和解提交消息' } };
  const beforeMerge = messageRequests.length;
  await reloadTaskChat();
  await expect(taskMessage).toHaveValue('保留和解提交消息');
  assert.equal(messageRequests.length, beforeMerge, 'A preserved reconciliation message needs no generation');
  Object.assign(task, { title: 'Clarify the introduction', status: 'idle', deferred: false, review: null, reconciliation: null });
  await openGit();
  await message.fill('Keep this commit draft');
  // Same status and line counts must not leave an outdated working-tree diff.
  diffText = 'Updated on focus';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(details.locator('.git-diff-view')).toContainText('Updated on focus main.tex');
  await expect(message).toBeFocused();
  diffText = 'Updated by polling';
  await page.clock.fastForward(5100);
  await expect(details.locator('.git-diff-view')).toContainText('Updated by polling main.tex');
  await expect(message).toBeFocused();
  // Slow requests are allowed to finish, without overlapping or being aborted
  // by a polling interval or repeated focus/visibility events.
  let releaseDiff;
  diffGate = new Promise(resolve => { releaseDiff = resolve; });
  diffText = 'Slow update';
  const beforeSlow = diffRequests, failuresBeforeSlow = diffFailures.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => diffRequests).toBe(beforeSlow + 1);
  // Cross multiple polling intervals without replacing the pending request.
  for (let interval = 0; interval < 2; interval++) {
    await page.clock.runFor(5100);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(diffRequests, beforeSlow + 1, 'Only one live diff request may be in flight');
    assert.equal(diffFailures.length, failuresBeforeSlow, 'Polling and focus must not abort an in-flight diff');
  }
  diffGate = null; releaseDiff();
  await expect(details.locator('.git-diff-view')).toContainText('Slow update main.tex');
  // Operations longer than the former fixed deadline still finish normally.
  let releaseLong;
  diffGate = new Promise(resolve => { releaseLong = resolve; });
  diffText = 'Finished a long request';
  const beforeLong = diffRequests, failuresBeforeLong = diffFailures.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => diffRequests).toBe(beforeLong + 1);
  await page.clock.runFor(30100);
  await expect(details.getByRole('alert')).toHaveCount(0);
  assert.equal(diffFailures.length, failuresBeforeLong);
  assert.equal(diffRequests, beforeLong + 1, 'A long diff keeps its one pending request');
  diffGate = null; releaseLong();
  await expect(details.locator('.git-diff-view')).toContainText('Finished a long request main.tex');
  // A server failure still offers Retry and recovers with a fresh request.
  diffError = 'The diff could not be read.';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(details.getByRole('alert')).toHaveText(diffError);
  const beforeRetry = diffRequests;
  diffError = null; diffText = 'Recovered after failure';
  await details.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(details.locator('.git-diff-view')).toContainText('Recovered after failure main.tex');
  await expect(details.getByRole('alert')).toHaveCount(0);
  assert.equal(diffRequests, beforeRetry + 1, 'Retry must issue one replacement diff request');
  diffText = 'New';
  await panel.getByRole('button', { name: 'references.bib', exact: true }).click();
  await expect(details.getByRole('region', { name: 'Changes in references.bib', exact: true })).toContainText('New references.bib');
  await details.locator('.git-detail-switcher').getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(details.locator('.git-graph-row')).toHaveCount(1);
  await page.reload();
  await expect(workspace).toBeVisible();
  await expect(message).toHaveValue('Keep this commit draft');
  await expect(details.locator('.git-detail-switcher').getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  assert.deepEqual(actions, [['apply', { mode: 'commit', message: 'Clarify the introduction', keepCurrent: false }], ['apply', { mode: 'commit', keepCurrent: false }], ['stage', { paths: ['references.bib'], stage: true }], ['commit', { message: 'Add references', staged: true }], ['push']]);
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
  // In short windows a multiline draft must not clip the commit action or files.
  await message.fill('Explain this revision\n\nClarify the definitions.\nAdd the missing argument.\nDocument assumptions.\nUpdate the examples.\nExplain the edge cases.\nKeep the original notation.');
  const centerClickable = locator => locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  for (const size of [{ width: 390, height: 568 }, { width: 1440, height: 400 }]) {
    await page.setViewportSize(size);
    const commit = panel.getByRole('button', { name: 'Commit', exact: true });
    await commit.scrollIntoViewIfNeeded();
    await expect.poll(() => centerClickable(commit)).toBe(true);
    await page.screenshot({ path: `test-results/git-workspace-short-${size.width}.png` });
    const file = panel.getByRole('button', { name: 'main.tex', exact: true });
    await file.scrollIntoViewIfNeeded();
    await expect.poll(() => centerClickable(file)).toBe(true);
    await file.click();
    await expect(details.locator('.git-diff-view')).toContainText('New main.tex');
  }
  await page.setViewportSize({ width: 820, height: 800 });
  // Git keeps the manuscript's collapsed preference and PDF view separate.
  await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  await page.locator('.manuscript-link').click();
  await expect(page.locator('.manuscript-side')).toBeHidden();
  await expect(page.locator('.git-workspace')).toHaveCount(0);
  // The new-task default and current conversation deliberately disagree.
  await page.setViewportSize({ width: 1440, height: 900 });
  git.files = structuredClone(initialFiles);
  await page.evaluate(() => localStorage.setItem('papilot:agent', 'codex'));
  await page.reload();
  const openTask = async () => { await page.locator(`[data-task="${task.id}"] .task-link`).click(); };
  const generate = panel.getByRole('button', { name: 'Generate commit message', exact: true });
  const expectAgent = async agent => {
    const before = messageRequests.length;
    await generate.click();
    await expect(message).toHaveValue(`Written by ${agent}`);
    assert.equal(messageRequests.length, before + 1);
    assert.equal(messageRequests.at(-1).agent, agent);
  };
  const settings = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('[data-settings-page="git"]').click();
    return page.locator('.settings-dialog').getByRole('button', { name: 'Agent settings', exact: true });
  };
  const selectCommit = async (picker, agent, model = 'Model', effort = 'high', fast = false) => {
    if (agent === 'conversation') { await page.getByRole('switch', { name: 'Follow current conversation', exact: true }).check(); return; }
    await picker.click();
    const menu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
    await menu.getByRole('option', { name: `${model} · ${agent === 'codex' ? 'Codex' : 'Claude'}`, exact: true }).first().click();
    await menu.getByRole('slider', { name: 'Reasoning effort' }).fill(effort === 'high' ? '1' : '0');
    if (agent === 'codex' && model === 'Model') {
      const toggle = menu.getByRole('switch', { name: 'Fast mode' });
      const box = await toggle.boundingBox();
      assert.deepEqual([box.width, box.height], [28, 16], 'Settings must not stretch the Fast mode switch');
      await toggle.setChecked(fast);
    }
    await page.keyboard.press('Escape');
  };
  const closeSettings = () => page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await openTask(); await openGit();
  await expect(generate).toHaveAttribute('title', /Claude/);
  await expectAgent('claude');
  assert.equal(messageRequests.at(-1).model, 'model');
  assert.equal(messageRequests.at(-1).effort, 'high');
  await page.reload();
  await expectAgent('claude');

  // Following an editing-only conversation uses a connected read-only agent.
  const zcodeTask = { ...task, id: 'zcode-conversation', name: 'zcode-conversation', title: 'ZCode conversation', agent: 'zcode', model: null, effort: null };
  snapshot.runtimes.zcode = { ...runtime, models: [], supportsReadOnlyTasks: false, authenticationUnchecked: true };
  snapshot.tasks.push(zcodeTask);
  await page.reload();
  await page.locator(`[data-task="${zcodeTask.id}"] .task-link`).click();
  await openGit();
  await expectAgent('codex');
  const commitPicker = await settings();
  await commitPicker.click();
  const commitMenu = page.getByRole('dialog', { name: 'Agent settings', exact: true });
  await expect(commitMenu.getByRole('group', { name: 'Codex', exact: true })).toBeVisible();
  await expect(commitMenu.getByRole('group', { name: 'ZCode', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await closeSettings();
  const requestsBefore = messageRequests.length;
  snapshot.runtimes.codex = { ...runtime, hidden: true };
  snapshot.runtimes.claude = { ...runtime, hidden: true };
  await page.reload();
  await openGit();
  await generate.click();
  await expect(panel.getByText('Connect an agent that supports read-only tasks, such as Codex.', { exact: true })).toBeVisible();
  assert.equal(messageRequests.length, requestsBefore);
  snapshot.runtimes.codex = runtime;
  snapshot.runtimes.claude = { ...runtime };
  await page.reload();
  await openTask(); await openGit();
  snapshot.tasks.pop();
  delete snapshot.runtimes.zcode;

  const otherTask = { ...task, id: 'other-conversation', name: 'other-conversation', title: 'Another conversation', agent: 'codex' };
  snapshot.tasks.push(otherTask);
  const otherTab = await page.context().newPage();
  await otherTab.route('**/api/**', handleApi);
  await otherTab.goto(origin);
  await otherTab.locator(`[data-task="${otherTask.id}"] .task-link`).click();
  await expect.poll(() => otherTab.evaluate(() => sessionStorage.getItem('papilot:commit-context:git-paper:/tmp/git-paper'))).toBe(otherTask.id);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expectAgent('claude');
  await otherTab.close();
  await message.fill('Keep my manual message');
  let picker = await settings();
  await expect(page.getByRole('switch', { name: 'Follow current conversation', exact: true })).toBeChecked();
  await expect(picker).toContainText('Model');
  await expect(picker).toContainText('High');
  const field = await picker.boundingBox(), advancedSwitch = await page.getByRole('switch', { name: 'Show advanced Git features', exact: true }).boundingBox();
  assert.ok(Math.abs(field.x + field.width - advancedSwitch.x - advancedSwitch.width) <= 1, 'The model field aligns with the other settings controls');
  assert.equal(field.height, 28);
  await picker.click();
  const modelSearch = page.getByRole('dialog', { name: 'Agent settings', exact: true }).getByRole('combobox', { name: 'Search models' });
  assert.deepEqual(await modelSearch.evaluate(element => { const style = getComputedStyle(element); return [style.marginTop, style.borderTopWidth]; }), ['0px', '0px'], 'The model search keeps its own layout inside Settings');
  await page.screenshot({ path: 'test-results/commit-agent-menu-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await selectCommit(picker, 'codex', 'Other model', 'low');
  await expect(page.getByRole('switch', { name: 'Follow current conversation', exact: true })).not.toBeChecked();
  await page.screenshot({ path: 'test-results/commit-agent-settings-light.png' });
  await closeSettings();
  await expect(message).toHaveValue('Keep my manual message');
  await openTask(); await openGit();
  await expect(message).toHaveValue('Keep my manual message');
  await expect(generate).toHaveAttribute('title', /Codex/);
  await expectAgent('codex');
  assert.equal(messageRequests.at(-1).model, 'other-model');
  assert.equal(messageRequests.at(-1).effort, 'low');
  await page.reload(); await expectAgent('codex');
  assert.equal(messageRequests.at(-1).model, 'other-model');
  assert.equal(messageRequests.at(-1).effort, 'low');
  // Settings may change while the request is in flight; its label must keep
  // identifying the agent actually generating this message.
  let releaseMessage;
  messageGate = new Promise(resolve => { releaseMessage = resolve; });
  await generate.click();
  await expect(message).toHaveAttribute('placeholder', 'Codex is writing a commit message…');
  picker = await settings(); await selectCommit(picker, 'claude'); await closeSettings();
  await expect(generate).toHaveAttribute('title', /Codex/);
  await expect(message).toHaveAttribute('placeholder', 'Codex is writing a commit message…');
  messageGate = null; releaseMessage();
  await expect(generate).toBeEnabled();
  await expect(message).toHaveValue('Written by codex');
  await expect(generate).toHaveAttribute('title', /Claude/);
  picker = await settings(); await selectCommit(picker, 'codex', 'Model', 'high', true); await closeSettings();
  await page.reload();
  await expectAgent('codex');
  // A response from an old Git panel must not overwrite a draft entered
  // after returning from a conversation, including its persisted copy.
  messageGate = new Promise(resolve => { releaseMessage = resolve; });
  await generate.click();
  await expect(message).toHaveAttribute('placeholder', 'Codex is writing a commit message…');
  await openTask(); await openGit(); await message.fill('New manual draft');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/git/message'));
  messageGate = null; releaseMessage(); await (await oldResponse).finished();
  await afterRender(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:commit:git-paper')), 'New manual draft');
  await expect(message).toHaveValue('New manual draft');
  await page.reload(); await expect(message).toHaveValue('New manual draft');
  // The task's inline generation obeys the same override.
  task.status = 'interrupted'; task.deferred = true;
  task.review = { state: 'done', round: 0, counts: { pending: 0 }, files: ['main.tex'] };
  await page.reload(); await openTask();
  await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'Chat', exact: true }).click();
  const taskGenerate = page.locator('.task-apply:visible').getByRole('button', { name: 'Generate commit message' }).first();
  await expect(taskGenerate).toHaveAttribute('title', /Codex/);
  await taskGenerate.click();
  await expect(page.locator('.task-apply:visible').getByRole('textbox', { name: 'Commit message' }).first()).toHaveValue('Written by codex');
  assert.equal(messageRequests.at(-1).agent, 'codex');
  assert.equal(messageRequests.at(-1).model, 'model');
  assert.equal(messageRequests.at(-1).effort, 'high');
  assert.equal(messageRequests.at(-1).serviceTier, 'priority');
  await openGit();
  picker = await settings(); await selectCommit(picker, 'claude'); await closeSettings();
  // An explicit override survives a conversation using another agent.
  task.agent = 'codex'; await page.reload(); await openTask(); await openGit();
  await expectAgent('claude');
  picker = await settings(); await selectCommit(picker, 'conversation'); await closeSettings();
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:commit-message-agent')), null);
  await expectAgent('codex');
  // Another paper with no visited conversation uses the new-task default.
  task.agent = 'claude'; await page.reload(); await openTask(); await openGit();
  const other = { ...project, id: 'other-paper', name: 'Other paper', path: '/tmp/other-paper' };
  snapshot.projects.push(other);
  await page.evaluate(id => { localStorage.setItem('papilot:project', id); localStorage.setItem('papilot:task', ''); }, other.id);
  await page.reload(); await expectAgent('codex');
  // Returning to this paper restores only its own conversation context.
  await page.evaluate(id => localStorage.setItem('papilot:project', id), project.id);
  await page.reload(); await expectAgent('claude');
  picker = await settings(); await selectCommit(picker, 'claude'); await closeSettings();
  snapshot.runtimes.claude = { ...runtime, connected: false, authenticated: false, installed: false };
  messageError = 'The selected commit-message agent is unavailable. Connect it in Settings → Agents or choose another in Settings → Git.';
  await page.reload(); await message.fill('Keep this when generation fails'); await generate.click();
  await expect(panel.getByRole('alert')).toHaveText(messageError);
  assert.equal(messageRequests.at(-1).agent, 'claude');
  await expect(message).toHaveValue('Keep this when generation fails');
  picker = await settings(); await picker.click();
  await expect(page.getByRole('dialog', { name: 'Agent settings', exact: true }).getByRole('option', { name: /Claude/ }).first()).toContainText('Not found');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/commit-agent-settings-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileField = await picker.boundingBox(), mobileRow = await picker.locator('xpath=ancestor::*[contains(@class,"settings-row")]').boundingBox();
  assert.ok(Math.abs(mobileField.width - mobileRow.width) <= 1, 'The mobile model field fills its row');
  assert.equal(mobileField.height, 36);
  await page.screenshot({ path: 'test-results/commit-agent-settings-mobile.png' });
  await selectCommit(picker, 'conversation'); await closeSettings();
  snapshot.runtimes.claude = { ...runtime }; messageError = null;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload(); await expectAgent('claude');
  // Preferences saved by the agent-only version still select that agent.
  await page.evaluate(() => localStorage.setItem('papilot:commit-message-agent', 'claude'));
  await page.reload(); await expectAgent('claude');
  assert.equal(messageRequests.at(-1).model, ''); assert.equal(messageRequests.at(-1).effort, '');
  picker = await settings(); await selectCommit(picker, 'conversation'); await closeSettings();
  // A persisted Git page must not bypass the missing-Git gate. Background Git
  // requests also stop; installation is picked up by the normal state refresh.
  await page.setViewportSize({ width: 1440, height: 900 });
  snapshot.gitAvailable = false;
  await page.evaluate(() => { localStorage.setItem('papilot:page', 'git'); localStorage.setItem('papilot:task', ''); });
  const beforeMissing = gitRequests;
  await page.reload();
  await expect(page.locator('.git-link')).toBeDisabled();
  await expect(workspace).toHaveCount(0);
  await expect(page.locator('.manuscript-link')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Install Git in this environment to use version management.', exact: true })).toHaveAttribute('href', 'https://git-scm.com/install/');
  await page.clock.runFor(21000);
  assert.equal(gitRequests, beforeMissing, 'No Git reads or writes while Git is unavailable');
  await page.screenshot({ path: 'test-results/git-workspace-missing-git.png' });
  snapshot.gitAvailable = true;
  await page.clock.runFor(11000);
  await expect(page.locator('.git-link')).toBeEnabled();
  await expect(page.locator('.git-install-hint')).toHaveCount(0);
  await openGit();
  await expect(workspace).toBeVisible();
  // The independent resolver follows the active paper's conversation by default.
  git.merging = { conflicts: ['main.tex'], message: 'Merge origin/main' };
  await openTask(); await openGit();
  const merge = workspace.getByRole('group', { name: 'Merge in progress' });
  await expect(merge.getByRole('button', { name: 'Resolve with Claude' })).toBeVisible();
  await page.reload();
  await expect(merge.getByRole('button', { name: 'Resolve with Claude' })).toBeVisible();
  const changeResolver = merge.getByRole('button', { name: 'Change conflict agent', exact: true });
  const followResolver = page.getByRole('switch', { name: 'Follow current conversation for conflicts', exact: true });
  await changeResolver.click();
  await expect(page.getByRole('region', { name: 'Conflict-resolution agent', exact: true })).toBeFocused();
  await expect(followResolver).toBeChecked();
  const resolver = page.getByRole('button', { name: 'Conflict-resolution agent', exact: true });
  await resolver.click();
  const resolverMenu = page.getByRole('dialog', { name: 'Conflict-resolution agent', exact: true });
  await resolverMenu.getByRole('option', { name: 'Model · Codex', exact: true }).first().click();
  await resolverMenu.getByRole('slider', { name: 'Reasoning effort' }).fill('1');
  await resolverMenu.getByRole('switch', { name: 'Fast mode' }).setChecked(true);
  await page.keyboard.press('Escape');
  await expect(followResolver).not.toBeChecked();
  await page.screenshot({ path: 'test-results/git-conflict-agent-settings.png', animations: 'disabled' });
  await closeSettings();
  await page.reload();
  const resolveWithCodex = merge.getByRole('button', { name: 'Resolve with Codex', exact: true });
  await expect(resolveWithCodex).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(changeResolver).toBeVisible();
  await page.screenshot({ path: 'test-results/git-conflict-agent-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });

  resolveError = 'The selected conflict-resolution agent is unavailable. Connect it in Settings → Agents or choose another in Settings → Git.';
  await resolveWithCodex.click();
  await expect(workspace.getByRole('alert')).toContainText('conflict-resolution agent is unavailable');
  resolveError = null;
  resolveGate = new Promise(resolve => { releaseResolution = resolve; });
  await resolveWithCodex.click();
  await expect(merge.getByRole('button', { name: 'Codex is resolving…', exact: true })).toBeDisabled();
  await changeResolver.click();
  await followResolver.check();
  await closeSettings();
  await openTask(); await openGit();
  await expect(merge.getByRole('button', { name: 'Codex is resolving…', exact: true })).toBeDisabled();
  assert.equal(resolveRequests.length, 2, 'Returning to Git must not offer a second resolve action');
  git.merging = { ...git.merging, conflicts: [] };
  await page.clock.runFor(6000);
  await expect(merge.getByText('Merging: no conflicts left')).toBeVisible();
  await expect(merge.getByRole('button', { name: 'Codex is resolving…', exact: true })).toBeVisible();
  resolveGate = null; releaseResolution();
  await expect(merge.getByRole('button', { name: 'Commit merge', exact: true })).toBeVisible();
  await expect(merge.getByLabel('Codex on the merge')).toContainText('Merged the opening.');
  assert.deepEqual(resolveRequests, [
    { agent: 'codex', model: 'model', effort: 'high', serviceTier: 'priority' },
    { agent: 'codex', model: 'model', effort: 'high', serviceTier: 'priority' },
  ]);
  git.merging = null;
  await page.clock.runFor(6000);
  await expect(merge.getByRole('button', { name: 'Commit merge', exact: true })).toHaveCount(0);
  await expect(page.getByText('Conflicts resolved. Read the diffs, then commit the merge.')).toHaveCount(0);
  git.merging = { conflicts: ['main.tex'], head: 'next-merge', message: 'Merge origin/main' };
  await page.clock.runFor(6000);
  await expect(merge.getByLabel('Codex on the merge')).toHaveCount(0);
  await expect(merge.getByRole('button', { name: 'Resolve with Claude', exact: true })).toBeVisible();
  await page.reload();
  await expect(merge.getByRole('button', { name: 'Resolve with Claude', exact: true })).toBeVisible();
  snapshot.projects.push({ id: 'without-conversation', name: 'Another paper', path: '/tmp/another-paper', createdAt: 2 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Paper: Example paper' }).click();
  await page.getByRole('menuitemradio', { name: 'Another paper', exact: true }).click();
  await openGit();
  await expect(merge.getByRole('button', { name: 'Resolve with Codex', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Git workspace passed: left-side controls, separate diff/history, navigation and draft restoration, live and slow diff refresh, long request and server-error recovery, pinned commit controls, staging/commit/push, responsive and short-window layouts, missing-Git gate and installation recovery.');
} catch (error) {
  if (errors.length) console.error('Page errors:', errors);
  await page.screenshot({ path: 'test-results/git-workspace-failure.png' });
  throw error;
} finally { releaseResolution?.(); await browser.close(); await server.close(); }
