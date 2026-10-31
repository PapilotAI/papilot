import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
fs.mkdirSync('test-results', { recursive: true });
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../vendor/latex-review/node_modules/playwright/index.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.clock.install();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const task = { id: 'fixture-task-0001', projectId: 'fixture-paper', name: 'p-fixture', title: 'Clarify the introduction', instructions: 'Keep the technical meaning.', worktree: '/tmp/fixture', threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: { state: 'reviewing', round: 1, counts: { pending: 3, commented: 1 } } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: task.projectId, name: 'Example paper', path: '/tmp/fixture', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'fast-model', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }, { id: 'deep-model', name: 'Deep model', isDefault: false, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', fastMode: { serviceTier: 'priority', description: '2x speed, increased usage' } }], usage: { plan: 'pro', windows: [{ usedPercent: 83, minutes: 10080, resetsAt: Date.now() + 3 * 86_400_000 }], credits: { unlimited: false, balance: 12418.76 }, reached: false } } };
// Claude is available with its own models; Antigravity is not installed.
snapshot.runtimes = { codex: snapshot.runtime, claude: { connected: true, authenticated: true, account: 'Claude Max', error: null, models: [{ id: 'opus', name: 'Opus 5.5', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: null }, { id: 'haiku', name: 'Haiku 5.5', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: null }] }, antigravity: { connected: false, authenticated: false, account: null, error: 'spawn agy ENOENT', models: [] } };
const messages = [];
const creates = [];
let failCreate = true;
let createResult = task;
let heldState;
let stateStarted;
let releaseState;
let holdMessage;
let releaseMessage;
let stateFailure = false;
let itemsFailure = false;
let history = null;
let reviewFailure = false;
let reviewStarting = false;
let deleteFailure = false;
let archiveFailure = false;
const archives = [];
const deletions = [];
const renames = [];
const titleRequests = [];
const paperRenames = [];
const gitState = { remote: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, head: { hash: 'abc1234', subject: 'Draft the introduction', date: 1 }, files: [{ path: 'main.tex', status: 'M', staged: false, unstaged: true, lines: [2, 4] }, { path: 'notes.md', status: '?', staged: false, unstaged: true }] };
const originalGit = structuredClone(gitState);
let overviewFailure = false;
const overview = () => ({
  worktrees: [
    { path: '/tmp/fixture', branch: gitState.branch, head: gitState.head.hash, current: true, bare: false, status: gitState },
    { taskId: task.id, path: '/tmp/paper-tasks/revise-introduction', branch: 'review/introduction', head: 'bbb2222', current: false, bare: false, locked: 'Proposal in progress', status: { branch: 'review/introduction', upstream: null, ahead: 0, behind: 0, head: { hash: 'bbb2222', subject: 'Explain the contribution', date: 2 }, files: [{ path: 'sections/introduction.tex', status: 'M', staged: true, unstaged: true }, { path: 'references.bib', status: '?', staged: false, unstaged: true }] } },
    { path: '/tmp/paper-tasks/experiment', branch: null, head: 'ccc3333', current: false, bare: false, status: { branch: null, upstream: null, ahead: 0, behind: 0, head: { hash: 'ccc3333', subject: 'Try another proof', date: 2 }, files: [] } },
    { path: '/tmp/paper-tasks/removed', branch: 'old-proposal', head: 'aaa0000', current: false, bare: false, status: null, prunable: 'gitdir file points to non-existent location', error: 'Could not read this worktree.' },
  ],
  commits: [
    { hash: gitState.head.hash, parents: ['aaa1110', 'bbb2222'], subject: gitState.head.subject, author: 'Cui Chen', date: 1720000000000, refs: ['main'] },
    { hash: 'bbb2222', parents: ['aaa0000'], subject: 'Explain the contribution', author: 'Cui Chen', date: 1719990000000, refs: ['review/introduction'] },
    { hash: 'aaa1110', parents: ['aaa0000'], subject: 'Refine the abstract', author: 'Cui Chen', date: 1719980000000, refs: ['origin/main'] },
    { hash: 'ccc3333', parents: ['aaa0000'], subject: 'Try another proof', author: 'Cui Chen', date: 1719970000000, refs: [] },
    { hash: 'aaa0000', parents: [], subject: 'Initial manuscript', author: 'Cui Chen', date: 1719960000000, refs: [] },
  ], truncated: false,
});
const gitCommits = [], gitActions = [], gitIgnores = [], gitMessages = [], gitStages = [];
const manuscriptBuild = { status: 'ready', key: 'fixture', pages: [[612, 792], [612, 792]], builtAt: 1, current: true };
let annotations = [];
const deletedNotes = new Map();
let failNoteEdit = false, failNoteDelete = false, failNoteRestore = false;
const noteSends = [];
const fixturePdf = fs.readFileSync('tests/fixtures/outline.pdf');
// The server's word places for the fixture PDF (tests/manuscript.test.ts keeps them current).
const fixtureWords = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const interruptions = [];
let reconnects = 0;
await context.addInitScript(() => localStorage.setItem('papilot:task', 'removed-task'));
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/note-results')) return route.fulfill({ json: { notes: [] } });
  const json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/state') {
    if (stateFailure) return route.fulfill({ status: 503, json: { error: 'Host unavailable.' } });
    const captured = structuredClone(snapshot);
    if (heldState) { const hold = heldState; heldState = null; stateStarted?.(); await hold; }
    return json(captured);
  }
  if (url.pathname === '/api/reconnect') { reconnects++; return json({ ok: true }); }
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/items') && itemsFailure) return route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable.' } });
  if (url.pathname.endsWith('/items') && history) return json({ items: history });
  if (url.pathname.endsWith('/items')) return json({ items: [{ id: 'hello', taskId: task.id, type: 'assistant', text: 'The introduction is ready for review.', createdAt: 1 }] });
  if (url.pathname.endsWith('/git')) return json(gitState);
  if (url.pathname.endsWith('/git/overview')) return overviewFailure ? route.fulfill({ status: 503, json: { error: 'Repository unavailable.' } }) : json(overview());
  // Skills and the feedback bar have their own check (check-skills.mjs).
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git/diff')) return json({ path: url.searchParams.get('path'), diff: 'diff --git a/main.tex b/main.tex\n--- a/main.tex\n+++ b/main.tex\n@@ -1,2 +1,2 @@\n-Old line.\n+New line.\n Context.\n', truncated: false });
  if (url.pathname.endsWith('/git/commit')) {
    const body = route.request().postDataJSON(); gitCommits.push(body);
    Object.assign(gitState, { files: gitState.files.filter(file => body.staged ? !file.staged : !body.paths.includes(file.path)), ahead: gitState.ahead + 1, head: { hash: 'def5678', subject: body.message, date: 2 } });
    return json({ commit: 'def5678', git: gitState });
  }
  if (url.pathname.endsWith('/git/stage')) {
    const body = route.request().postDataJSON(); gitStages.push(body);
    for (const file of gitState.files) if (body.paths.includes(file.path)) Object.assign(file, { staged: body.stage, unstaged: !body.stage });
    return json({ git: gitState });
  }
  if (url.pathname.endsWith('/git/ignore')) {
    const body = route.request().postDataJSON(); gitIgnores.push(body);
    gitState.files = [...gitState.files.filter(file => !body.paths.includes(file.path)), { path: '.gitignore', status: '?', staged: false, unstaged: true }];
    return json({ git: gitState });
  }
  if (url.pathname.endsWith('/git/message')) { gitMessages.push(route.request().postDataJSON()); return json({ message: 'Tighten the introduction', agent: 'codex' }); }
  // A merge stops at a conflict in main.tex; the agent resolves it; the merge commits.
  if (url.pathname.endsWith('/git/merge')) {
    gitActions.push('merge');
    Object.assign(gitState, { files: [{ path: 'main.tex', status: 'U', staged: false }], merging: { message: "Merge branch 'main' of origin", conflicts: ['main.tex'] } });
    return json({ git: gitState });
  }
  if (url.pathname.endsWith('/git/resolve')) {
    gitActions.push(route.request().postDataJSON());
    gitState.merging = { ...gitState.merging, conflicts: [] };
    return json({ summary: 'Kept **both** openings.', remaining: [], agent: 'codex', git: gitState });
  }
  if (url.pathname.endsWith('/git/finish')) {
    gitActions.push('finish');
    Object.assign(gitState, { files: [], merging: null, ahead: 2, behind: 0, head: { hash: 'aaa1111', subject: "Merge branch 'main' of origin", date: 3 } });
    return json({ commit: 'aaa1111', git: gitState });
  }
  if (/\/git\/(fetch|pull|push)$/.test(url.pathname)) { const action = url.pathname.split('/').pop(); gitActions.push(action); if (action === 'push') gitState.ahead = 0; return json({ git: gitState }); }
  if (url.pathname.endsWith('/manuscript')) return json({ git: gitState, build: manuscriptBuild, annotations });
  if (url.pathname.endsWith('/delete') && url.pathname.includes('/annotations/')) {
    if (failNoteDelete) return route.fulfill({ status: 503, json: { error: 'Could not delete. Try again.' } });
    const id = url.pathname.split('/')[5]; deletedNotes.set(id, { note: annotations.find(note => note.id === id), index: annotations.findIndex(note => note.id === id) });
    annotations = annotations.filter(note => note.id !== id); return json({ ok: true });
  }
  if (url.pathname.endsWith('/restore') && url.pathname.includes('/annotations/')) {
    if (failNoteRestore) return route.fulfill({ status: 503, json: { error: 'Could not restore. Try again.' } });
    const removed = deletedNotes.get(url.pathname.split('/')[5]); annotations.splice(removed.index, 0, removed.note);
    return json({ annotations });
  }
  if (/\/annotations\/[^/]+$/.test(url.pathname)) {
    if (failNoteEdit) return route.fulfill({ status: 503, json: { error: 'Could not save. Try again.' } });
    const note = annotations.find(note => note.id === url.pathname.split('/')[5]);
    note.comment = route.request().postDataJSON().comment; return json(note);
  }
  if (url.pathname.endsWith('/annotations')) {
    const body = route.request().postDataJSON();
    const note = { id: `note-${annotations.length + 1}`, projectId: task.projectId, quote: 'The marked fixture sentence.', ...body, source: { file: 'main.tex', lines: [10, 12], excerpt: 'The marked \\emph{fixture} sentence.' }, createdAt: 1 };
    annotations.push(note); return json(note);
  }
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fixturePdf });
  if (url.pathname.endsWith('/manuscript/words')) return json(fixtureWords[Number(url.searchParams.get('page'))]);
  if (url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/rename')) { const id = url.pathname.split('/')[3], body = route.request().postDataJSON(); paperRenames.push({ id, ...body }); const paper = snapshot.projects.find(p => p.id === id); paper.name = body.name; return json(paper); }
  if (url.pathname.endsWith('/title')) { const id = url.pathname.split('/')[3]; titleRequests.push(id); const target = snapshot.tasks.find(t => t.id === id); target.titleGeneration = 'pending'; return json(target); }
  if (url.pathname.endsWith('/rename')) { const id = url.pathname.split('/')[3], body = route.request().postDataJSON(); renames.push({ id, ...body }); snapshot.tasks.find(t => t.id === id).title = body.title; return json(snapshot.tasks.find(t => t.id === id)); }
  if (url.pathname.endsWith('/interrupt')) { const id = url.pathname.split('/')[3]; interruptions.push(id); snapshot.tasks.find(t => t.id === id).status = 'interrupted'; return json({ ok: true }); }
  if (url.pathname.endsWith('/archive')) {
    if (archiveFailure) return route.fulfill({ status: 503, json: { error: 'Could not archive. Try again.' } });
    const id = url.pathname.split('/')[3], body = route.request().postDataJSON(); archives.push({ id, ...body });
    const target = snapshot.tasks.find(t => t.id === id); target.archivedAt = body.archived ? Date.now() : null; return json(target);
  }
  if (url.pathname.endsWith('/delete')) {
    const id = url.pathname.split('/')[3];
    deletions.push({ id, body: route.request().postDataJSON() });
    if (deleteFailure) {
      snapshot.tasks.find(t => t.id === id).status = 'deleting';
      return route.fulfill({ status: 503, json: { error: 'The cleanup response was lost. Retry deletion to confirm it.' } });
    }
    snapshot.tasks = snapshot.tasks.filter(t => t.id !== id);
    return json({ deleted: true });
  }
  if (url.pathname.endsWith('/messages')) {
    messages.push(route.request().postDataJSON());
    if (holdMessage) await holdMessage;
    return json({ ok: true });
  }
  if (url.pathname === '/api/tasks' && route.request().method() === 'POST') {
    const body = route.request().postDataJSON();
    if (body.annotations?.length) {
      noteSends.push(body);
      const created = { ...task, id: body.id, name: 'p-notes', title: body.title, status: 'queued', review: null };
      snapshot.tasks.push(created); annotations = annotations.filter(note => !body.annotations.includes(note.id));
      return json(created);
    }
    creates.push(body);
    if (failCreate) return route.fulfill({ status: 503, json: { error: 'Connection lost. Try again.' } });
    if (!snapshot.tasks.some(t => t.id === createResult.id)) snapshot.tasks.push(createResult);
    return json(createResult);
  }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
});
await page.route('**/review/**', route => reviewFailure ? route.fulfill({ status: 503, json: { error: 'Review server unavailable.' } }) : reviewStarting ? route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><div id="root"></div></body></html>' }) : route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head></head><body><div class="bar">Review round 1</div><main id="paper"><h2>Introduction</h2><p>PDF review fixture</p></main></body></html>' }));

async function openDelete(title = task.title) {
  const show = page.getByRole('button', { name: 'Show task list', exact: true });
  // The drawer slides closed; check its open state rather than its in-transition visibility.
  const narrow = await page.evaluate(() => matchMedia('(max-width: 900px)').matches);
  if (narrow ? !(await page.locator('.sidebar.is-open').count()) : await show.count()) await show.click();
  await page.getByRole('button', { name: `Task actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).click();
}

try {
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Describe the revision' }).waitFor();
  assert.equal(await page.locator('.host-status').count(), 0, 'A connected, idle host shows no status line');
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.doesNotMatch(await page.locator('body').innerText(), /\p{Script=Han}/u);

  // Appearance changes live in both documents without losing a chat draft.
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const closeSettings = async () => { await page.keyboard.press('Escape'); await settingsDialog.waitFor({ state: 'hidden' }); };
  const chooseTheme = async name => { await settingsButton.click(); await settingsDialog.getByRole('radio', { name, exact: true }).check(); await closeSettings(); };
  const themeIs = async value => {
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, value);
    await page.frameLocator('.review-frame').locator(`html[data-theme="${value}"]`).waitFor();
  };
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).fill('Preserve this draft while changing appearance.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await themeIs('dark');
  await chooseTheme('Light');
  await themeIs('light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await themeIs('light');
  await chooseTheme('Dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await themeIs('dark');
  assert.equal(await page.getByRole('textbox', { name: 'Instructions for Codex' }).inputValue(), 'Preserve this draft while changing appearance.');
  assert.equal(await page.locator('.main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(38, 39, 43)');
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
  await page.reload();
  await settingsButton.click();
  assert.equal(await settingsDialog.getByRole('radio', { name: 'Dark', exact: true }).isChecked(), true);
  await closeSettings();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Settings', 'Closing Settings returns focus to its button');
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await themeIs('dark');
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).fill('');
  await chooseTheme('System');
  await themeIs('light');
  console.log('PASS: System appearance, explicit overrides, saved preference, live review theme and draft preservation');

  // The interface language switches live, reloads the review in it, and keeps the draft.
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).fill('Keep this draft across languages.');
  await settingsButton.click();
  await settingsDialog.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
  await page.getByRole('dialog', { name: '设置' }).getByText('外观', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.getByRole('button', { name: '设置', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '给 Codex 的指令' }).inputValue(), 'Keep this draft across languages.');
  await page.waitForFunction(() => document.querySelector('.review-frame')?.getAttribute('src')?.endsWith('&lang=zh-CN'));
  assert.match(await page.getByRole('link', { name: '在新标签页中打开审阅' }).getAttribute('href'), /&lang=zh-CN$/);
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置' }).getByRole('combobox', { name: '语言' }).selectOption('system');
  await settingsDialog.waitFor();
  await closeSettings();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).fill('');
  console.log('PASS: Live interface language, saved choice, translated review address and draft preservation');

  // Notifications: off until turned on, then a background tab announces a ready review.
  await context.grantPermissions(['notifications'], { origin });
  await page.evaluate(() => {
    window.shown = [];
    window.Notification = class { static permission = 'granted'; static requestPermission = async () => 'granted'; constructor(title, options) { window.shown.push({ title, body: options.body, tag: options.tag }); } close() {} };
  });
  await settingsButton.click();
  const notifySwitch = settingsDialog.getByRole('switch', { name: 'Notifications' });
  assert.equal(await notifySwitch.isChecked(), false);
  await notifySwitch.check();
  await settingsDialog.getByRole('button', { name: 'Send a test notification' }).click();
  await settingsDialog.getByText(/^Sent\./).waitFor();
  await closeSettings();
  await page.evaluate(() => { document.hasFocus = () => false; });
  const fixtureTask = snapshot.tasks.find(t => t.id === task.id);
  fixtureTask.status = 'building';
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: /^Clarify the introduction/ }).getByText('Preparing task results').waitFor();
  fixtureTask.status = 'reviewing';
  await page.clock.runFor(3000);
  await page.waitForFunction(() => window.shown.length === 2);
  assert.deepEqual((await page.evaluate(() => window.shown))[1], { title: 'Review ready · 3 changes to decide', body: 'Clarify the introduction', tag: 'papilot:fixture-task-0001' });
  await page.evaluate(() => { delete document.hasFocus; localStorage.removeItem('papilot:notifications'); });
  await page.reload();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  console.log('PASS: Notifications switch, test notification and background review alert');

  const switcher = page.getByRole('button', { name: 'Paper: Example paper', exact: true });
  await switcher.click();
  await page.getByRole('menuitemradio', { name: 'Example paper', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Example paper', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitem', { name: 'Add paper…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a paper' });
  await dialog.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Repository path' }).evaluate(el => el === document.activeElement), true);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press(i < 5 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await switcher.evaluate(el => el === document.activeElement), true);

  const paperName = page.getByRole('button', { name: 'Paper: Example paper', exact: true });
  await paperName.click();
  await page.getByRole('menuitem', { name: 'Rename paper…', exact: true }).click();
  let paperBox = page.getByRole('textbox', { name: 'Rename Example paper' });
  assert.equal(await paperBox.evaluate(el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), true);
  await paperBox.fill('Something else');
  await paperBox.press('Escape');
  await paperName.waitFor();
  assert.equal(paperRenames.length, 0);
  assert.equal(await paperName.evaluate(el => el === document.activeElement), true);
  await paperName.click();
  await page.getByRole('menuitem', { name: 'Rename paper…', exact: true }).click();
  paperBox = page.getByRole('textbox', { name: 'Rename Example paper' });
  await paperBox.fill('  Small   Steps ');
  await paperBox.press('Enter');
  const renamedPaper = page.getByRole('button', { name: 'Paper: Small Steps', exact: true });
  await renamedPaper.waitFor();
  assert.deepEqual(paperRenames, [{ id: task.projectId, name: 'Small Steps' }]);
  assert.equal(await renamedPaper.evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: 'Paper: Small Steps', exact: true }).waitFor();
  await renamedPaper.click();
  await page.getByRole('menuitem', { name: 'Rename paper…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename Small Steps' }).fill('Example paper');
  await page.getByRole('textbox', { name: 'Rename Small Steps' }).press('Enter');
  await paperName.waitFor();
  assert.equal(paperRenames.length, 2);
  console.log('PASS: Papers rename from the paper menu; Escape cancels and Enter saves the trimmed name');
  await page.locator('.manuscript-link').click();
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Describe the revision' });
  await prompt.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start task' }).isDisabled(), true);
  assert.equal(await page.getByRole('tab', { name: 'New task', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('region', { name: 'PDF preview', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.home').count(), 0);
  assert.equal(await page.getByText(/Proofread|Each task edits its own Git worktree/).count(), 0);
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  console.log('PASS: English UI, stale selection recovery, paper menu, modal focus containment, Escape, focus restoration, and the new-task composer');
  const views = page.locator('.view-selector');
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('region', { name: 'Codex conversation', exact: true }).isVisible(), false);
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Review', exact: true }).getAttribute('aria-pressed'), 'true');
  await views.getByRole('button', { name: 'Chat', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), false);
  await page.getByText('3 changes to review', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Split', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Open review', exact: true }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'PDF review', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.topbar').count(), 0);
  assert.equal((await page.locator('.task-grid').boundingBox()).y, 0, 'The task fills the space freed by the header');
  assert.equal(await page.locator('.panel-heading').getByRole('button', { name: 'Delete task', exact: true }).count(), 0);
  // The review's own tools are direct buttons beside the review toolbar, with no zoom box or menu.
  const reviewTools = page.locator('.review-tools');
  assert.equal(await reviewTools.getByRole('link', { name: 'Full PDF', exact: true }).getAttribute('href'), '/api/tasks/fixture-task-0001/pdf?round=1');
  assert.equal(await reviewTools.getByRole('link', { name: 'Open review in new tab', exact: true }).getAttribute('href'), '/review/fixture-paper/?task=p-fixture');
  assert.equal(await reviewTools.getByRole('button', { name: 'Regenerate PDF comparison', exact: true }).isDisabled(), false);
  assert.equal(await reviewTools.getByRole('button', { name: 'Annotation group color', exact: true }).count(), 1);
  assert.equal(await reviewTools.getByRole('button', { name: 'Review options' }).count(), 0);
  // Menus open from the keyboard on the first item and return focus on Escape.
  const taskMenu = page.getByRole('button', { name: `Task actions for ${task.title}`, exact: true });
  await taskMenu.focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('menu', { name: `Task actions for ${task.title}`, exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Rename…', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await taskMenu.evaluate(el => el === document.activeElement), true);
  console.log('PASS: Views select explicitly, PDF tools stay with the review, and menus support keyboard navigation');
  for (const name of ['Review', 'Chat', 'Split']) {
    await views.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.task-grid .view-selector [aria-pressed="true"]') === document.activeElement);
    await page.getByRole('button', { name: 'Hide task list', exact: true }).click();
    const showTasks = page.getByRole('button', { name: 'Show task list', exact: true });
    await page.waitForFunction(() => document.querySelector('.main .sidebar-toggle') === document.activeElement);
    await showTasks.click();
    assert.equal((await page.locator('.task-grid').boundingBox()).y, 0);
  }
  await page.waitForFunction(() => document.querySelector('.review-frame').contentDocument.documentElement.style.getPropertyValue('--papilot-lead') === '0px');
  console.log('PASS: Content toolbars retain view-switch focus and reopen the sidebar in every desktop layout');

  const pdfLink = page.locator('.manuscript-link');
  await pdfLink.locator('.nav-meta').filter({ hasText: 'main · 2 changed · ↑1' }).waitFor();
  await pdfLink.click();
  await page.getByRole('heading', { name: 'Manuscript', exact: true }).waitFor();
  assert.equal(await pdfLink.getAttribute('aria-current'), 'page');
  const pdfPages = page.locator('.pdfViewer .page');
  await page.locator('.textLayer span').filter({ hasText: /^Fixture ?$/ }).first().waitFor();
  assert.equal(await pdfPages.count(), 2);
  assert.equal(await page.getByLabel('Page number').inputValue(), '1');
  const manuscriptDivider = page.getByRole('separator', { name: 'Resize manuscript panel' });
  const manuscriptSide = page.locator('.manuscript-side');
  const originalSideWidth = Math.round((await manuscriptSide.boundingBox()).width);
  await manuscriptDivider.focus(); await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(width => Math.round(document.querySelector('.manuscript-side').getBoundingClientRect().width) === width, originalSideWidth + 24);
  const manuscriptHandle = await manuscriptDivider.boundingBox();
  await page.mouse.move(manuscriptHandle.x + 4, manuscriptHandle.y + 300); await page.mouse.down();
  await page.mouse.move(manuscriptHandle.x - 116, manuscriptHandle.y + 300, { steps: 5 }); await page.mouse.up();
  const widenedSide = Math.round((await manuscriptSide.boundingBox()).width);
  assert.equal(widenedSide, originalSideWidth + 144);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:manuscript-width')), String(widenedSide));
  await page.reload(); await manuscriptDivider.waitFor();
  assert.equal(Math.round((await manuscriptSide.boundingBox()).width), widenedSide, 'manuscript width survives a reload');
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.ok(Math.round((await manuscriptSide.boundingBox()).width) <= 368, 'a narrow desktop clamps the saved width');
  await page.setViewportSize({ width: 800, height: 900 });
  await manuscriptDivider.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('resizing')), false);
  await page.setViewportSize({ width: 1440, height: 900 }); await manuscriptDivider.waitFor();
  assert.equal(Math.round((await manuscriptSide.boundingBox()).width), widenedSide);
  await manuscriptDivider.focus(); await page.keyboard.press('End');
  await page.waitForFunction(() => Math.round(document.querySelector('.manuscript-side').getBoundingClientRect().width) === 300);
  await manuscriptDivider.dblclick();
  assert.equal(Math.round((await manuscriptSide.boundingBox()).width), originalSideWidth);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:manuscript-width')), null);
  await page.locator('.textLayer span').filter({ hasText: /^Fixture ?$/ }).first().waitFor();
  console.log('PASS: Manuscript panel resizes with pointer and keyboard, persists, clamps on narrow screens and resets');
  // Notes belong to New task; Contents keeps the bookmarks beside the PDF.
  assert.deepEqual((await page.getByRole('tablist', { name: 'Manuscript panels' }).getByRole('tab').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')), ['New task', 'Contents', 'Git 2']);
  await page.getByRole('tab', { name: 'Contents', exact: true }).click();
  const contents = page.getByRole('navigation', { name: 'PDF contents' });
  assert.deepEqual((await contents.getByRole('button').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')), ['Introduction 1', 'Method 2', 'Results 2']);
  await contents.getByRole('button', { name: /^Results/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2' && document.querySelector('.pdf-section-title')?.textContent === 'Results');
  assert.equal(await page.locator('.pdf-section-title').innerText(), 'Results');
  assert.equal(await contents.getByRole('button', { name: /^Results/ }).getAttribute('aria-current'), 'location');
  const mountedPdf = await pdfPages.first().elementHandle();
  await page.locator('.manuscript-link').click();
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  await prompt.fill('Keep this draft beside the PDF.');
  assert.equal(await mountedPdf.evaluate(el => el.isConnected), true, 'Opening New task keeps the PDF mounted');
  assert.equal(await page.getByLabel('Page number').inputValue(), '2');
  await page.getByRole('tab', { name: 'Contents', exact: true }).click();
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  assert.equal(await prompt.inputValue(), 'Keep this draft beside the PDF.');
  await page.screenshot({ path: 'test-results/new-task-beside-pdf.png', fullPage: true });
  await prompt.fill('');
  await page.getByRole('tab', { name: 'Contents', exact: true }).click();
  await page.getByLabel('Page number').fill('1');
  await page.getByLabel('Page number').press('Enter');
  await page.waitForFunction(() => document.querySelector('.pdf-section-title').textContent === 'Introduction');
  assert.equal(await contents.isVisible(), true);
  assert.equal(await contents.getByRole('button', { name: /^Introduction/ }).getAttribute('aria-current'), 'location');
  await page.clock.runFor(200);
  await page.screenshot({ path: 'test-results/contents-desktop.png', fullPage: true });
  await contents.getByRole('button', { name: /^Method/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '1');
  // Zoom steps away from fit width and returns to it; the choice is remembered.
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  assert.equal(await zoom.inputValue(), 'page-width');
  const width = (await pdfPages.first().boundingBox()).width;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(() => /^[\d.]+$/.test(document.querySelector('select[aria-label="Zoom"]').value));
  assert.ok((await pdfPages.first().boundingBox()).width > width);
  await zoom.selectOption('page-width');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Zoom"]').value === 'page-width');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:pdf-zoom')), 'page-width');
  // Find runs across every page.
  await page.locator('.pdf-container').focus();
  await page.keyboard.press('ControlOrMeta+f');
  const findBox = page.getByRole('textbox', { name: 'Search the PDF' });
  assert.equal(await findBox.evaluate(el => el === document.activeElement), true);
  await findBox.fill('operator');
  await page.locator('.pdf-find-count').filter({ hasText: '1 of 1' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
  await findBox.fill('nowhere in the fixture');
  await page.locator('.pdf-find-count').filter({ hasText: 'No matches' }).waitFor();
  await findBox.press('Escape');
  await findBox.waitFor({ state: 'hidden' });
  // Select text, write a note, cancel it, delete one, then send another.
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  const notesPanel = page.getByRole('region', { name: 'PDF notes' });
  // Where a word is printed, in page pixels, from the server's word places.
  const printed = async text => {
    const words = fixtureWords[0], word = words.words.find(w => w[0] === text), box = await pdfPages.first().boundingBox();
    const sx = box.width / words.width, sy = box.height / words.height;
    return { left: box.x + word[1] * sx, right: box.x + (word[1] + word[4]) * sx, middle: box.y + (word[2] - word[3] * 0.3) * sy };
  };
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const selectText = async () => {
    await page.getByLabel('Page number').fill('1');
    await page.getByLabel('Page number').press('Enter');
    await page.locator('.textLayer span').filter({ hasText: /^Fixture ?$/ }).first().scrollIntoViewIfNeeded();
    // The selection layer sits on the printed words: one run per word, from
    // where the word is printed to where the next one begins.
    const fixture = await printed('Fixture'), sentence = await printed('sentence'), about = await printed('about');
    const span = await page.locator('.textLayer span').filter({ hasText: /^Fixture ?$/ }).first().boundingBox();
    assert.ok(Math.abs(span.x - fixture.left) < 1.5 && Math.abs(span.x + span.width - sentence.left) < 2, `Fixture is printed from ${fixture.left} and sentence from ${sentence.left}; the run spans ${span.x}–${span.x + span.width}`);
    // Start inside "Fixture" and end inside "about"; the note takes both whole words.
    await drag({ x: fixture.left + (fixture.right - fixture.left) * 0.4, y: fixture.middle }, { x: about.right - 3, y: about.middle });
    assert.doesNotMatch(await page.evaluate(() => document.getSelection().toString()), /^F/);
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    const note = page.getByRole('textbox', { name: 'Note for the agent' });
    assert.equal(await note.evaluate(el => el === document.activeElement), true);
    return note;
  };
  let noteBox = await selectText();
  await noteBox.press('Escape');
  await noteBox.waitFor({ state: 'hidden' });
  assert.equal(annotations.length, 0);
  // A drag from the gap before a word to the gap after another takes just those words.
  const sentence = await printed('sentence'), about = await printed('about');
  await drag({ x: sentence.left - 2, y: sentence.middle }, { x: about.right + 1, y: about.middle });
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  noteBox = page.getByRole('textbox', { name: 'Note for the agent' });
  await noteBox.fill('Only these words.');
  await noteBox.press('Enter');
  await page.getByRole('button', { name: 'Note 1: Only these words.', exact: true }).waitFor();
  assert.equal(annotations[0].quote, 'sentence about');
  // Clicking the comment edits it; failed saves keep the text, and Cancel changes nothing.
  const anchor = structuredClone(annotations[0]);
  await notesPanel.getByRole('button', { name: 'Edit note 1: Only these words.' }).click();
  const editingNote = notesPanel.getByRole('textbox', { name: 'Edit note 1', exact: true });
  await editingNote.fill('');
  assert.equal(await notesPanel.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Start task', exact: true }).isDisabled(), true);
  await editingNote.fill('Discarded edit.'); await editingNote.press('Escape');
  assert.equal(annotations[0].comment, 'Only these words.');
  await notesPanel.getByRole('button', { name: 'Edit note 1: Only these words.' }).click();
  await editingNote.fill('Only these words, please.');
  failNoteEdit = true;
  await notesPanel.getByRole('button', { name: 'Save', exact: true }).click();
  await notesPanel.getByRole('alert').waitFor();
  assert.equal(await editingNote.inputValue(), 'Only these words, please.');
  failNoteEdit = false;
  await editingNote.press('Enter');
  await page.getByRole('button', { name: 'Note 1: Only these words, please.', exact: true }).waitFor();
  assert.deepEqual(annotations[0], { ...anchor, comment: 'Only these words, please.' });
  await page.reload();
  await page.getByRole('button', { name: 'Note 1: Only these words, please.', exact: true }).waitFor();
  failNoteDelete = true;
  await notesPanel.getByRole('button', { name: 'Delete note 1' }).click();
  await notesPanel.getByRole('alert').waitFor(); assert.equal(annotations.length, 1);
  failNoteDelete = false;
  await notesPanel.getByRole('button', { name: 'Delete note 1' }).click();
  await page.getByRole('button', { name: 'Note 1: Only these words, please.', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await notesPanel.locator('.note-undo').count(), 0, 'no dedicated undo UI');
  // Text fields keep native undo even when a deleted annotation can be restored.
  await prompt.fill(''); await prompt.pressSequentially('Undo this text');
  await prompt.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  assert.ok((await prompt.inputValue()).length < 'Undo this text'.length, 'native undo edits the text');
  assert.equal(annotations.length, 0); await prompt.fill('');
  await notesPanel.getByRole('button', { name: 'Region note', exact: true }).focus();
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(annotations.length, 0, 'redo is not interpreted as undo');
  failNoteRestore = true;
  await page.keyboard.press('Meta+z');
  await page.getByRole('alert').filter({ hasText: 'Could not restore. Try again.' }).waitFor(); assert.equal(annotations.length, 0);
  failNoteRestore = false;
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Note 1: Only these words, please.', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').filter({ hasText: 'Could not restore. Try again.' }).count(), 0);
  assert.deepEqual(annotations[0], { ...anchor, comment: 'Only these words, please.' });
  await notesPanel.getByRole('button', { name: 'Delete note 1' }).click();
  await page.getByRole('button', { name: 'Note 1: Only these words, please.', exact: true }).waitFor({ state: 'hidden' });
  noteBox = await selectText();
  await noteBox.fill('Shorten this sentence.');
  await noteBox.press('Enter');
  await notesPanel.getByText('The marked \\emph{fixture} sentence.', { exact: true }).waitFor();
  assert.equal(annotations[0].page, 0);
  assert.equal(annotations[0].key, 'fixture');
  assert.equal(annotations[0].quote, 'Fixture sentence about');
  assert.ok(annotations[0].rects.length >= 1 && annotations[0].rects.every(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1 && y1 < 0.5));
  await page.getByRole('button', { name: 'Note 1: Shorten this sentence.', exact: true }).waitFor();
  assert.ok(await page.locator('.note-mark').count() >= 1);
  await notesPanel.getByRole('button', { name: 'Delete note 1' }).click();
  await page.getByRole('button', { name: 'Note 1: Shorten this sentence.', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(annotations.length, 0);
  // A region marks a figure or equation that has no text to select.
  await notesPanel.getByRole('button', { name: 'Region note', exact: true }).click();
  const firstPage = await pdfPages.first().boundingBox();
  await page.mouse.move(firstPage.x + firstPage.width * 0.2, firstPage.y + firstPage.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(firstPage.x + firstPage.width * 0.7, firstPage.y + firstPage.height * 0.36, { steps: 5 });
  await page.mouse.up();
  noteBox = page.getByRole('textbox', { name: 'Note for the agent' });
  assert.equal(await noteBox.evaluate(el => el === document.activeElement), true);
  await noteBox.fill('Define the operator here.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await notesPanel.getByText('Page 1 · main.tex:10–12', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mark region', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(annotations[0].rects, undefined);
  assert.ok(annotations[0].rect[0] > 0.15 && annotations[0].rect[2] < 0.75 && annotations[0].rect[1] < annotations[0].rect[3]);
  await notesPanel.getByText('1 note attached', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Notes', exact: true }).count(), 0);
  assert.equal(await prompt.inputValue(), '');
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await page.locator('.task-list').getByRole('button', { name: /^Define the operator here/ }).waitFor();
  assert.equal(await prompt.isVisible(), true);
  assert.equal(await page.locator('.task-link.active').count(), 0);
  assert.equal(noteSends.length, 1);
  assert.ok(noteSends[0].id.length >= 16);
  assert.deepEqual(noteSends[0].annotations, ['note-1']);
  assert.equal(noteSends[0].instructions, '');
  assert.equal(annotations.length, 0);
  const notesTask = noteSends[0].id;
  snapshot.tasks = snapshot.tasks.filter(t => t.id !== notesTask);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  gitState.files.push({ path: 'main.aux', status: '?', staged: false, unstaged: true }, { path: 'main.log', status: '?', staged: false, unstaged: true });
  await pdfLink.click();
  await page.getByRole('heading', { name: 'Manuscript', exact: true }).waitFor();
  await page.getByRole('tab', { name: /^Git/ }).click();
  const gitPanel = page.getByRole('region', { name: 'Git status' });
  await gitPanel.getByText('main.tex', { exact: true }).waitFor();
  await gitPanel.getByText('notes.md', { exact: true }).waitFor();
  const gitText = await gitPanel.innerText();
  assert.match(gitText, /^main\s/);
  assert.match(await gitPanel.locator('.git-branch').innerText(), /↑1/);
  assert.equal(await gitPanel.locator('.git-sync').getAttribute('title'), 'Tracking origin/main');
  assert.match(gitText, /Draft the introduction\s+abc1234/);
  const worktrees = gitPanel.getByRole('region', { name: 'Worktrees', exact: true });
  const proposalTree = worktrees.locator(`[data-task-id="${task.id}"]`);
  await proposalTree.getByText(task.title, { exact: true }).waitFor();
  await proposalTree.locator('.status').filter({ hasText: 'Ready for review' }).waitFor();
  assert.ok((await proposalTree.boundingBox()).height <= 56, 'Worktrees use compact rows');
  assert.equal(await worktrees.locator('.git-worktree').count(), 4);
  await worktrees.getByText('Status unavailable', { exact: true }).waitFor();
  const graph = gitPanel.getByRole('region', { name: 'Commit graph', exact: true });
  assert.equal(await graph.locator('.git-graph-row').count(), 5);
  await graph.getByRole('button', { name: task.title, exact: true }).waitFor();
  assert.ok((await graph.locator('.git-graph-row').first().boundingBox()).height <= 48, 'Graph rows no longer reserve three lines');
  // Generated captions update the sidebar, worktree and graph without navigation.
  const originalTitle = task.title;
  const captionMenu = () => page.getByRole('button', { name: `Task actions for ${task.title}`, exact: true });
  await captionMenu().click();
  await page.getByRole('menuitem', { name: 'Generate task title', exact: true }).click();
  await captionMenu().click();
  const generatingTitle = page.getByRole('menuitem', { name: 'Generating task title…', exact: true });
  await generatingTitle.waitFor();
  assert.equal(await generatingTitle.isDisabled(), true);
  await page.keyboard.press('Escape');
  task.titleGeneration = 'failed';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await captionMenu().click();
  await page.getByRole('menuitem', { name: 'Retry title generation', exact: true }).click();
  assert.deepEqual(titleRequests, [task.id, task.id]);
  task.title = '明确引言中的研究贡献'; task.titleSource = 'generated'; task.titleGeneration = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await captionMenu().waitFor();
  await proposalTree.getByText(task.title, { exact: true }).waitFor();
  await graph.getByRole('button', { name: task.title, exact: true }).waitFor();
  task.title = originalTitle;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await proposalTree.getByText(originalTitle, { exact: true }).waitFor();
  console.log('PASS: Task captions show pending and retry states and update task, worktree and graph labels');
  await proposalTree.locator('.git-worktree-button').click();
  await worktrees.getByText('sections/introduction.tex', { exact: true }).waitFor();
  assert.equal(await graph.locator('.highlighted').getAttribute('data-commit'), 'bbb2222');
  await proposalTree.locator('.git-worktree-button').click();
  await graph.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/git-overview-desktop.png' });
  overviewFailure = true;
  await worktrees.getByRole('button', { name: 'Refresh worktrees and history' }).click();
  await worktrees.getByRole('alert').filter({ hasText: 'Showing the last update.' }).waitFor();
  assert.equal(await worktrees.locator('.git-worktree').count(), 4, 'A failed refresh keeps the last known worktrees');
  overviewFailure = false;
  await worktrees.getByRole('button', { name: 'Retry', exact: true }).click();
  await worktrees.getByRole('alert').waitFor({ state: 'detached' });
  // Build output goes into .gitignore, one pattern per kind.
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Stage main.aux' }).isChecked(), false);
  await gitPanel.getByText('2 build files', { exact: true }).waitFor();
  await gitPanel.getByRole('button', { name: 'Add to .gitignore', exact: true }).click();
  await gitPanel.getByRole('status').filter({ hasText: 'Added 2 patterns to .gitignore.' }).waitFor();
  assert.deepEqual(gitIgnores, [{ paths: ['main.aux', 'main.log'] }]);
  assert.equal(await gitPanel.getByText('main.aux', { exact: true }).count(), 0);
  assert.equal(await gitPanel.getByLabel('Untracked').first().innerText(), 'U');
  // With nothing staged, Commit takes every file as it is on disk.
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Stage main.tex' }).isChecked(), false);
  assert.equal(await gitPanel.getByRole('button', { name: 'Commit all 3 files' }).isDisabled(), true);
  await gitPanel.getByRole('button', { name: 'main.tex', exact: true }).click();
  await gitPanel.getByRole('region', { name: 'Changes in main.tex' }).getByText('+New line.', { exact: true }).waitFor();
  // A ticked file is staged, and Commit then takes only what is staged.
  await gitPanel.getByRole('checkbox', { name: 'Stage main.tex' }).click();
  await gitPanel.getByRole('button', { name: 'Commit staged changes in 1 file' }).waitFor();
  assert.deepEqual(gitStages, [{ paths: ['main.tex'], stage: true }]);
  assert.equal(await gitPanel.getByRole('checkbox', { name: 'Stage all changes' }).evaluate(box => box.indeterminate), true);
  // The chosen agent writes the message for what is staged.
  const commitMessage = gitPanel.getByRole('textbox', { name: 'Commit message' });
  await gitPanel.getByRole('button', { name: 'Generate commit message', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Commit message"]')?.value === 'Tighten the introduction');
  assert.deepEqual(gitMessages.map(body => [body.paths, body.staged]), [[['main.tex'], true]]);
  assert.ok(['codex', 'claude', 'antigravity'].includes(gitMessages[0].agent));
  await commitMessage.press('Enter');
  await gitPanel.getByRole('status').filter({ hasText: 'Committed def5678.' }).waitFor();
  assert.deepEqual(gitCommits, [{ message: 'Tighten the introduction', staged: true }]);
  assert.deepEqual(gitState.files.map(file => file.path), ['notes.md', '.gitignore'], 'Unstaged files stay for the next commit');
  assert.equal(await commitMessage.inputValue(), '');
  assert.match(await gitPanel.innerText(), /Tighten the introduction\s+def5678/);
  await gitPanel.getByRole('button', { name: 'Push', exact: true }).click();
  await gitPanel.getByRole('status').filter({ hasText: 'Pushed to origin/main.' }).waitFor();
  assert.deepEqual(gitActions, ['push']);
  assert.equal(await gitPanel.getByRole('button', { name: 'Push', exact: true }).count(), 0);
  // A branch and upstream that both moved on merge instead of pulling.
  Object.assign(gitState, { ahead: 1, behind: 2 });
  await gitPanel.getByRole('button', { name: 'Fetch from the remote', exact: true }).click();
  await gitPanel.getByRole('button', { name: 'Merge', exact: true }).click();
  const merge = gitPanel.getByRole('group', { name: 'Merge in progress' });
  await merge.getByText('Merging: 1 file has conflicts', { exact: true }).waitFor();
  assert.equal(await gitPanel.getByLabel('Conflict').innerText(), '!');
  assert.equal(await gitPanel.getByRole('textbox', { name: 'Commit message' }).count(), 0);
  assert.equal(await gitPanel.getByRole('button', { name: 'Push', exact: true }).count(), 0);
  await merge.getByRole('button', { name: /^Resolve with / }).click();
  await gitPanel.getByRole('status').filter({ hasText: 'Conflicts resolved. Read the diffs, then commit the merge.' }).waitFor();
  assert.equal(await merge.locator('.git-merge-summary strong').innerText(), 'both');
  assert.ok(['codex', 'claude', 'antigravity'].includes(gitActions.at(-1).agent));
  await merge.getByRole('button', { name: 'Commit merge', exact: true }).click();
  await gitPanel.getByRole('status').filter({ hasText: 'Committed aaa1111.' }).waitFor();
  assert.equal(await merge.count(), 0);
  assert.deepEqual(gitActions.filter(action => typeof action === 'string'), ['push', 'fetch', 'merge', 'finish']);
  Object.assign(gitState, structuredClone(originalGit));
  const pdfToolbar = page.getByRole('toolbar', { name: 'PDF controls' });
  assert.equal(await page.locator('.manuscript-side-header').getByRole('link', { name: 'Open PDF', exact: true }).getAttribute('href'), '/api/projects/fixture-paper/manuscript.pdf?key=fixture');
  await pdfToolbar.getByRole('button', { name: 'Recompile', exact: true }).waitFor();
  assert.equal(await page.title(), 'Example paper · Papilot');
  await worktrees.getByRole('button', { name: `Open task: ${task.title}`, exact: true }).click();
  await page.getByRole('heading', { name: task.title }).waitFor();
  console.log('PASS: Each paper has a PDF view with contents, paging, zoom and find; text and region notes are added, deleted and sent as one task; Git changes are diffed, committed and pushed');

  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  const chatPanel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  const defaultWidth = Math.round((await chatPanel.boundingBox()).width);
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(Math.round((await chatPanel.boundingBox()).width), defaultWidth + 24);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:chat-width')), String(defaultWidth + 24));
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 300);
  await page.mouse.down();
  await page.mouse.move(handle.x - 96, handle.y + 300, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs((await chatPanel.boundingBox()).width - (defaultWidth + 124)) <= 2);
  await divider.dblclick();
  assert.equal(Math.round((await chatPanel.boundingBox()).width), defaultWidth);
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:chat-width')), null);
  const copy = page.getByRole('button', { name: 'Copy message' });
  await copy.click();
  await page.getByRole('button', { name: 'Copied' }).waitFor();
  await page.getByText('1 review update not sent yet', { exact: true }).waitFor();
  await page.getByText('1 review update will be sent with this message', { exact: true }).waitFor();
  task.review.unsent = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.composer-hint').count(), 0);
  delete task.review.unsent;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor();
  console.log('PASS: The chat divider drags, nudges, persists and resets; replies copy; only unsent review updates offer Send feedback');


  await page.locator('.manuscript-link').click();
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  await prompt.fill('Shorten the introduction.');
  await prompt.press('Shift+Enter');
  await prompt.pressSequentially('Preserve the technical content.');
  await prompt.press('Enter');
  await page.locator('.new-task-panel').getByRole('alert').waitFor();
  assert.equal(await prompt.inputValue(), 'Shorten the introduction.\nPreserve the technical content.');
  // The new-task panel shows the Codex account's usage.
  const usage = page.getByRole('region', { name: 'Codex usage' });
  await usage.locator('summary').click();
  assert.equal(await usage.getByRole('meter', { name: 'Weekly limit used' }).getAttribute('aria-valuenow'), '83');
  assert.match(await usage.innerText(), /Pro[\s\S]*Weekly limit[\s\S]*83% used[\s\S]*resets [\s\S]*12,418 credits/);
  await usage.locator('summary').click();
  // All settings share one compact trigger, and fast mode follows model support.
  const settingsTrigger = page.getByRole('button', { name: 'Agent settings', exact: true });
  const agentSettings = page.getByRole('dialog', { name: 'Agent settings', exact: true });
  await settingsTrigger.click();
  const agentChoices = agentSettings.getByRole('radiogroup', { name: 'Agent', exact: true });
  const chooseAgent = name => agentChoices.getByRole('radio', { name, exact: true }).click();
  const modelChip = agentSettings.getByRole('combobox', { name: 'Model', exact: true });
  const effortChoice = agentSettings.getByRole('slider', { name: 'Reasoning effort', exact: true });
  const fastMode = agentSettings.getByRole('switch', { name: 'Fast mode' });
  assert.equal(await agentChoices.getByRole('radio', { name: 'Codex', exact: true }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(await agentChoices.getByRole('radio').allInnerTexts(), ['Codex', 'Claude', 'Antigravity']);
  assert.match(await settingsTrigger.innerText(), /Medium/);
  assert.equal(await fastMode.count(), 0);
  await modelChip.selectOption('deep-model');
  assert.match(await settingsTrigger.innerText(), /High/);
  await effortChoice.press('End');
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Xhigh');
  await fastMode.check();
  await page.keyboard.press('Escape');
  await agentSettings.waitFor({ state: 'hidden' });
  assert.equal(await settingsTrigger.evaluate(el => el === document.activeElement), true);
  assert.match(await settingsTrigger.getAttribute('title'), /Xhigh.*Fast/);
  await settingsTrigger.click();
  await modelChip.selectOption('fast-model');
  assert.match(await settingsTrigger.innerText(), /Medium/);
  assert.equal(await fastMode.count(), 0);
  await modelChip.selectOption('deep-model');
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Xhigh');
  assert.equal(await fastMode.isChecked(), true);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('papilot:model:codex'), localStorage.getItem('papilot:effort:codex'), localStorage.getItem('papilot:fast:codex')]), ['deep-model', 'xhigh', 'true']);
  await chooseAgent('Claude');
  assert.deepEqual(await modelChip.locator('option').allInnerTexts(), ['Default model', 'Opus 5.5', 'Haiku 5.5']);
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Model default');
  await effortChoice.press('Home');
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Low');
  await agentSettings.getByRole('button', { name: 'Model default', exact: true }).click();
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Model default');
  assert.equal(await fastMode.count(), 0);
  await modelChip.selectOption('haiku');
  await agentChoices.getByRole('radio', { name: 'Claude', exact: true }).press('ArrowRight');
  await agentSettings.getByRole('status').getByText('spawn agy ENOENT', { exact: true }).waitFor();
  assert.equal(await page.locator('.runtime-banner').count(), 0);
  assert.equal(await page.locator('.new-task-panel > .inline-error[role=status]').count(), 0);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/state')), agentSettings.getByRole('button', { name: 'Reconnect', exact: true }).click()]);
  assert.equal(reconnects, 1);
  assert.equal(await agentSettings.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await settingsTrigger.locator('.agent-status-mark').count(), 1);
  await settingsTrigger.click();
  await agentSettings.getByRole('status').getByText('spawn agy ENOENT', { exact: true }).waitFor();
  // Long diagnostics expand within the same menu; choosing another agent clears them.
  const claudeRuntime = structuredClone(snapshot.runtimes.claude);
  Object.assign(snapshot.runtimes.claude, { connected: false, authenticated: false, error: 'Claude needs an Anthropic API key: Start Papilot with ANTHROPIC_API_KEY set to use Claude.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await chooseAgent('Claude');
  await agentSettings.getByRole('status').getByText('Claude needs an Anthropic API key', { exact: true }).waitFor();
  await agentSettings.getByText('Connection details', { exact: true }).click();
  await agentSettings.getByText(snapshot.runtimes.claude.error, { exact: true }).waitFor();
  await chooseAgent('Codex');
  assert.equal(await agentSettings.locator('.agent-connection').count(), 0);
  assert.equal(await settingsTrigger.locator('.agent-status-mark').count(), 0);
  snapshot.runtimes.claude = claudeRuntime;
  assert.equal(await modelChip.inputValue(), 'deep-model');
  assert.equal(await effortChoice.getAttribute('aria-valuetext'), 'Xhigh');
  assert.equal(await fastMode.isChecked(), true);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('papilot:agent'), localStorage.getItem('papilot:model:claude')]), ['codex', 'haiku']);
  await page.screenshot({ path: 'test-results/agent-settings.png', fullPage: true });
  await page.keyboard.press('Escape');
  failCreate = false;
  await page.getByRole('button', { name: 'Start task' }).click();
  await page.waitForFunction(() => document.querySelector('.new-task-panel textarea')?.value === '');
  assert.equal(await prompt.isVisible(), true);
  assert.equal(await page.locator('.task-link.active').count(), 0);
  assert.equal(creates.length, 2);
  assert.equal(creates[1].agent, 'codex');
  assert.equal(creates[1].model, 'deep-model');
  assert.equal(creates[1].effort, 'xhigh');
  assert.equal(creates[1].serviceTier, 'priority');
  assert.equal(creates[0].id, creates[1].id);
  assert.equal(creates[1].title, 'Shorten the introduction');
  assert.equal(creates[1].instructions, 'Shorten the introduction.\nPreserve the technical content.');
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:new-task')), null);
  console.log('PASS: Enter starts a task, Shift+Enter adds a line, retrying creation retains the same task ID, and agent, model and effort are remembered per agent');

  await page.locator(`[data-task="${task.id}"] .task-link`).click();
  const input = page.getByRole('textbox', { name: 'Instructions for Codex' });
  const previousReview = structuredClone(task.review);
  task.review = { state: 'done', round: 1, counts: { pending: 0, accepted: 1, rejected: 1, commented: 0 }, unsent: 2 };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('2 review updates not sent yet', { exact: true }).waitFor();
  await input.fill('Keep this unsent draft.');
  await page.screenshot({ path: 'test-results/send-review-decisions.png', fullPage: true });
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Send instructions', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(await input.inputValue(), 'Keep this unsent draft.');
  assert.equal(messages[0].feedback, true);
  assert.equal(messages[0].text, '');
  task.review.unsent = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor({ state: 'hidden' });
  task.review = previousReview;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Send feedback', exact: true }).waitFor();
  holdMessage = new Promise(resolve => { releaseMessage = resolve; });
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await page.getByText('Sending…', { exact: true }).waitFor();
  await input.fill('New text typed during submission.');
  releaseMessage();
  holdMessage = null;
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  assert.notEqual(messages[0].requestKey, messages[1].requestKey);
  await page.reload();
  // The deliberate stale selection injected on every load returns to the welcome view.
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Feedback and in-flight submission preserve drafts, including after reload');
  const secondTask = { ...task, id: 'fixture-task-0002', name: 'p-second', title: 'Check the notation', review: null };
  snapshot.tasks.push(secondTask);
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor();
  const activeBeforeMenu = await page.locator('.task-link.active').innerText();
  const otherMenu = page.getByRole('button', { name: `Task actions for ${secondTask.title}`, exact: true });
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete task?' }).waitFor();
  assert.equal(await page.locator('.delete-task-name').innerText(), secondTask.title);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await otherMenu.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  console.log('PASS: Task menus preserve selection and bind confirmation to the originating task');
  secondTask.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Pause task', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: 'Pause task', exact: true }).click();
  assert.deepEqual(interruptions, [secondTask.id]);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  secondTask.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  let renameBox = page.getByRole('textbox', { name: `Rename ${secondTask.title}` });
  assert.equal(await renameBox.evaluate(el => el === document.activeElement), true);
  await renameBox.fill('Something else');
  await renameBox.press('Escape');
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor();
  assert.equal(renames.length, 0);
  await otherMenu.click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  renameBox = page.getByRole('textbox', { name: `Rename ${secondTask.title}` });
  await renameBox.fill('Check the notation and symbols');
  await renameBox.press('Enter');
  await page.getByRole('button', { name: /^Check the notation and symbols/ }).waitFor();
  assert.deepEqual(renames, [{ id: secondTask.id, title: 'Check the notation and symbols' }]);
  assert.equal(await page.getByRole('button', { name: /^Check the notation and symbols/ }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu);
  console.log('PASS: Tasks rename inline from their menu; Escape cancels and Enter saves without changing the selection');

  const taskSearch = page.getByRole('searchbox', { name: 'Search tasks', exact: true });
  await taskSearch.fill('  SYMBOLS notation  ');
  assert.equal(await page.locator('.task-link').count(), 1);
  assert.match(await page.locator('.task-link').innerText(), /Check the notation/);
  await taskSearch.fill('technical meaning');
  assert.equal(await page.locator('.task-link').count(), 2, 'search includes initial instructions');
  await taskSearch.fill('不存在的任务');
  await page.getByText('No matching tasks', { exact: true }).waitFor();
  await taskSearch.press('Escape');
  assert.equal(await page.locator('.task-link').count(), 2);
  const renamedMenu = page.getByRole('button', { name: `Task actions for ${secondTask.title}`, exact: true });
  archiveFailure = true;
  await renamedMenu.click(); await page.getByRole('menuitem', { name: 'Archive task', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not archive' }).waitFor();
  assert.equal(await page.locator('.task-link').count(), 2, 'failed archive keeps the task visible');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click(); archiveFailure = false;
  await renamedMenu.click(); await page.getByRole('menuitem', { name: 'Archive task', exact: true }).click();
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.task-link.active').innerText(), activeBeforeMenu, 'archiving another task preserves selection');
  await page.getByRole('button', { name: 'Show archived tasks', exact: true }).click();
  assert.equal(await page.locator('.task-link').count(), 1);
  await taskSearch.fill('symbols'); assert.equal(await page.locator('.task-link').count(), 1);
  await page.getByRole('button', { name: 'Clear task search', exact: true }).click();
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await input.waitFor();
  await renamedMenu.click(); await page.getByRole('menuitem', { name: 'Restore task', exact: true }).click();
  await page.getByRole('button', { name: 'Show archived tasks', exact: true }).waitFor();
  assert.equal(await page.locator('.task-link').count(), 2);
  assert.match(await page.locator('.task-link.active').innerText(), /Check the notation/);
  await renamedMenu.click(); await page.getByRole('menuitem', { name: 'Archive task', exact: true }).click();
  await page.getByRole('heading', { name: 'Manuscript', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Show archived tasks', exact: true }).waitFor();
  assert.equal(await page.locator('.task-link').count(), 1, 'archived tasks stay hidden after reload');
  await page.getByRole('button', { name: 'Show archived tasks', exact: true }).click();
  await renamedMenu.click(); await page.getByRole('menuitem', { name: 'Restore task', exact: true }).click();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click(); await input.waitFor();
  assert.deepEqual(archives.map(item => item.archived), [true, false, true, false]);
  console.log('PASS: Tasks search by title and instructions, archive without losing history, and restore from the archive');


  await input.fill('Only send this once.');
  holdMessage = new Promise(resolve => { releaseMessage = resolve; });
  const beforeNavigationSend = messages.length;
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await page.getByText('Sending…', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isDisabled(), true);
  await input.press('Control+Enter');
  await input.fill('New text typed during submission.');
  releaseMessage(); holdMessage = null;
  await page.waitForFunction(() => !document.querySelector('.send-button').disabled);
  assert.equal(messages.length, beforeNavigationSend + 1);
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  console.log('PASS: Task navigation retains pending sends and cannot duplicate a message');
  const beforeEnterSend = messages.length;
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  assert.equal(messages.length, beforeEnterSend + 1);
  assert.equal(messages.at(-1).text, 'First line\nSecond line');
  await input.fill('New text typed during submission.');
  console.log('PASS: Enter sends follow-up instructions and Shift+Enter keeps a new line');

  heldState = new Promise(resolve => { releaseState = resolve; });
  const stateCaptured = new Promise(resolve => { stateStarted = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await stateCaptured;
  createResult = { ...secondTask, id: 'fixture-task-0003', title: 'A newly created task' };
  await page.locator('.manuscript-link').click();
  await page.getByRole('tab', { name: 'New task', exact: true }).click();
  await prompt.fill(createResult.title + '\nKeep the manuscript open.');
  await page.getByRole('button', { name: 'Start task' }).click();
  await page.locator(`[data-task="${createResult.id}"] .task-link`).waitFor();
  releaseState();
  assert.equal(await page.locator('.task-link.active').count(), 0);
  assert.equal(await prompt.isVisible(), true);
  createResult = task;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  console.log('PASS: A stale pre-creation snapshot cannot erase the new task or navigate away from the manuscript');

  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/english-desktop.png', fullPage: true });

  snapshot.requests = [{ id: 'question', taskId: task.id, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'scope', question: 'Which section should I revise?', options: [{ label: 'Introduction', description: 'Revise only the introduction.' }] }] }, createdAt: 1 }];
  task.status = 'waiting_input';
  await page.reload();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByRole('heading', { name: 'Codex needs your input' }).waitFor();
  assert.equal(await page.title(), `(1) ${task.title} · Papilot`);
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isDisabled(), true);
  await page.getByRole('button', { name: /Introduction/ }).click({ timeout: 3000 });
  assert.equal(await page.getByRole('button', { name: 'Reply to Codex' }).isEnabled(), true);
  console.log('PASS: Codex reply requires an answer and shows an accessible pending-input indicator');
  await page.getByRole('textbox', { name: 'Which section should I revise?' }).fill('Keep the theorem statement.');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Which section should I revise?' }).inputValue(), 'Keep the theorem statement.');
  console.log('PASS: Unsent answers survive switching tasks');


  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    if (width < 681) await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).click();
    await input.waitFor();
    assert.equal(await input.inputValue(), 'New text typed during submission.');
    const overflow = await page.evaluate(() => {
      const containers = ['.app-shell', '.workspace-navigation', '.panel-tools', '.view-selector', '.review-tools', '.composer-wrap'];
      return containers.filter(selector => { const el = document.querySelector(selector); return el && el.clientWidth && el.scrollWidth > el.clientWidth + 1; });
    });
    assert.deepEqual(overflow, [], `overflow at ${width}px`);
    const send = await page.getByRole('button', { name: 'Send instructions', exact: true }).boundingBox();
    assert.ok(send.x >= 0 && send.x + send.width <= width);
    if (width < 681) {
      await page.getByRole('button', { name: /Review/ }).first().click();
      // A phone keeps Full PDF; Regenerate PDF comparison and the new-tab link make room for the review's own bar.
      await page.locator('.review-tools').getByRole('link', { name: 'Full PDF', exact: true }).waitFor();
      assert.equal(await page.locator('.review-tools').getByRole('link', { name: 'Open review in new tab', exact: true }).isVisible(), false);
      await page.screenshot({ path: `test-results/english-mobile-${width}.png`, fullPage: true });
    }
    const drawerToggle = page.getByRole('button', { name: 'Show task list', exact: true });
    await drawerToggle.click();
    const drawer = page.getByRole('dialog', { name: 'Papers and tasks' });
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
    assert.equal(await page.locator('.main').evaluate(el => el.inert), true);
    const lastTaskMenu = drawer.getByRole('button', { name: /^Task actions for / }).last();
    await lastTaskMenu.click();
    await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement) && document.hasFocus()), true);
    await lastTaskMenu.click();
    await page.getByRole('menuitem', { name: 'Delete task…', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await drawer.evaluate(el => el.contains(document.activeElement) && document.hasFocus()), true);

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await drawerToggle.evaluate(el => el === document.activeElement), true);
    await drawerToggle.click();
    await drawer.getByRole('button', { name: 'Paper: Example paper', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add paper…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add a paper' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Repository path' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    if (width === 390) {
      await page.locator('.manuscript-link').click();
      const pdfPage = page.locator('.pdfViewer .page').first();
      await page.locator('.textLayer span').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const toolbar = page.getByRole('toolbar', { name: 'PDF controls' });
      assert.equal(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.getByRole('button', { name: 'Contents', exact: true }).click();
      await page.getByRole('navigation', { name: 'PDF contents' }).waitFor();
      assert.equal(await pdfPage.isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Contents', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.clock.runFor(200);
      await page.screenshot({ path: 'test-results/contents-mobile.png', fullPage: true });
      await page.getByRole('navigation', { name: 'PDF contents' }).getByRole('button', { name: /^Results/ }).click();
      await pdfPage.waitFor();
      await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === '2');
      await page.getByRole('button', { name: 'Git, 2 changed' }).click();
      await page.getByRole('region', { name: 'Git status' }).getByText('main.tex', { exact: true }).waitFor();
      await page.getByRole('region', { name: 'Worktrees', exact: true }).locator(`[data-task-id="${task.id}"]`).waitFor();
      await page.getByRole('region', { name: 'Commit graph', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({ path: `test-results/git-overview-mobile-${width}.png` });
      assert.equal(await pdfPage.isVisible(), false);
      await page.getByRole('button', { name: 'PDF', exact: true }).click();
      await pdfPage.waitFor();
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await prompt.fill('A task beside the PDF\nKeep the manuscript composer visible.');
      await page.getByRole('button', { name: 'Start task' }).click();
      await page.waitForFunction(() => document.querySelector('.new-task-panel textarea')?.value === '');
      assert.equal(await prompt.isVisible(), true);
      assert.equal(await page.locator('.sidebar').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'New task', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Show task list', exact: true }).click();
      await page.locator(`[data-task="${task.id}"] .task-link`).click();
      await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).click();
      await input.waitFor();
    } else await page.getByRole('button', { name: 'Hide task list', exact: true }).first().click();
  }
  console.log('PASS: 320px, 390px, and tablet layouts; draft persistence; zoom; drawer; project dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Review/ }).first().click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await input.waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Chat (reply needed)', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await input.inputValue(), 'New text typed during submission.');
  await openDelete();
  await page.getByRole('dialog', { name: 'Delete task?' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: `Task actions for ${task.title}`, exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  console.log('PASS: Mobile review feedback opens the conversation without clearing drafts; task menu dialogs restore drawer focus');

  await page.setViewportSize({ width: 1440, height: 900 });
  snapshot.requests = []; task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator(`.task-row[data-task="${task.id}"] .status`).filter({ hasText: 'Ready for review' }).waitFor();
  await input.fill('Keep this draft through connection recovery.');
  await page.getByRole('button', { name: 'Hide task list', exact: true }).first().click();
  stateFailure = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Connection lost. Showing the last update; your draft is kept.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry connection' }).isVisible(), true);
  assert.equal(await input.inputValue(), 'Keep this draft through connection recovery.');
  stateFailure = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await page.locator('.connection-banner').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  console.log('PASS: Connection loss stays visible with the sidebar collapsed, and recovery preserves drafts');

  itemsFailure = true;
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor();
  itemsFailure = false;
  await page.getByRole('button', { name: 'Retry conversation' }).click();
  await page.getByRole('button', { name: 'Retry conversation' }).waitFor({ state: 'hidden' });
  reviewFailure = true;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.getByText('The PDF review could not be loaded.', { exact: true }).waitFor();
  reviewFailure = false;
  await page.getByRole('button', { name: 'Reload review', exact: true }).click();
  await page.frameLocator('.review-frame').locator('#paper').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.review-viewport').getAttribute('aria-busy'), 'false');
  assert.equal(await input.inputValue(), 'Keep this draft through connection recovery.');
  console.log('PASS: Failed conversation and iframe loads recover in place without losing the draft');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  reviewStarting = true;
  await page.getByRole('button', { name: /^Clarify the introduction/ }).click();
  await page.frameLocator('.review-frame').locator('#root').waitFor({ state: 'attached' });
  await page.clock.fastForward(16000);
  await page.getByText('The PDF review is taking longer than expected.', { exact: true }).waitFor();
  await page.locator('.review-frame').evaluate(frame => { frame.contentDocument.querySelector('#root').innerHTML = '<main id="paper"><p>The delayed review is ready.</p></main>'; });
  await page.frameLocator('.review-frame').getByText('The delayed review is ready.', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Reload review', exact: true }).waitFor({ state: 'hidden' });
  reviewStarting = false;
  console.log('PASS: A slow review becomes visible when it finishes without requiring a reload');


  // A task made from PDF notes shows the notes, and the agent's work folds into one line.
  const notesPrompt = 'Revise the manuscript according to these notes the author marked on the compiled PDF. SyncTeX mapped each marked region to the LaTeX file and lines that produced it; the PDF text is what the author saw. Read the current source before editing, and change only what the notes ask for.\n\n1. Page 1 · main.tex line 10\n   LaTeX source of the marked region:\n   ```latex\n   \\title{Small Steps}\n   ```\n   PDF text: "Small Steps, Clearer Papers"\n   Note: Make the title plainer.';
  history = [
    { id: 'notes', taskId: task.id, type: 'user', text: notesPrompt, createdAt: 1 },
    { id: 'cmd-1', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'cat main.tex'", detail: '\\title{Small Steps}', status: 'completed', createdAt: 2 },
    { id: 'cmd-2', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'git status --short'", status: 'completed', createdAt: 3 },
    { id: 'edit', taskId: task.id, type: 'files', text: `${task.worktree}/main.tex`, status: 'completed', createdAt: 4 },
    { id: 'done', taskId: task.id, type: 'assistant', text: 'Changed the title.', createdAt: 5 },
    { id: 'cmd-3', taskId: task.id, type: 'command', text: "/bin/zsh -lc 'latexmk -pdf main.tex'", status: 'inProgress', createdAt: 6 },
  ];
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const sentNotes = page.locator('.notes-message');
  await sentNotes.waitFor();
  assert.equal(await sentNotes.locator('.sent-notes-head').innerText(), 'Note on the PDF');
  assert.equal(await sentNotes.locator('.sent-note-number').innerText(), '1');
  assert.equal(await sentNotes.locator('.sent-note-location').innerText(), 'Page 1 · main.tex line 10');
  assert.equal(await sentNotes.locator('blockquote').innerText(), 'Small Steps, Clearer Papers');
  assert.equal(await sentNotes.locator('p').innerText(), 'Make the title plainer.');
  assert.doesNotMatch(await page.locator('.thread').innerText(), /SyncTeX|```/);
  const work = page.locator('.tool-group');
  assert.equal(await work.count(), 1);
  assert.equal(await page.locator('.tool-group > summary').innerText(), 'Ran 2 commands, edited main.tex');
  assert.equal(await work.locator('.tool-item').first().isVisible(), false);
  await page.locator('.tool-group > summary').click();
  assert.deepEqual(await work.locator('.tool-label').allInnerTexts(), ['cat main.tex', 'git status --short', 'Edited main.tex']);
  assert.equal(await page.locator('.thread > .tool-item .tool-label').innerText(), 'latexmk -pdf main.tex');
  // A task on the host's default model names that model.
  assert.equal(await page.locator('.composer-model .agent-model-name').innerText(), 'Fast model');
  assert.equal(await page.locator('.composer-model .agent-model-label small').innerText(), 'Medium');
  console.log('PASS: Notes sent from the PDF read as notes, and consecutive commands fold into one line with task paths');

  history = Array.from({ length: 120 }, (_, i) => ({ id: `history-${i}`, taskId: task.id, type: 'assistant', text: `Message ${i}: A detailed review of the argument.`, createdAt: i + 1 }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Message 119: A detailed review of the argument.', { exact: true }).waitFor();
  const scroller = page.locator('.messages');
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Latest messages' }).waitFor();
  history.push({ ...history[0], id: 'history-new', text: 'A new message while reading history.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('A new message while reading history.', { exact: true }).waitFor();
  assert.equal(await scroller.evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: 'Latest messages' }).click();
  assert.ok(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 5));
  history = null;
  task.status = 'failed'; task.error = 'A build failed in the test fixture.'; task.review.job = { status: 'failed' };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry build', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  assert.equal(await views.getByRole('button', { name: 'Chat', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByText(task.error, { exact: true }).waitFor();
  task.error = null; task.review.job = null;
  await views.getByRole('button', { name: 'Split', exact: true }).click();
  console.log('PASS: Long conversations follow new messages, preserve history reading position, and offer a jump back');

  task.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const pauseButton = page.locator('.composer').getByRole('button', { name: 'Pause task' });
  await pauseButton.waitFor();
  assert.equal(await page.locator('.panel-heading').getByRole('button', { name: 'Pause task' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isEnabled(), true);
  await views.getByRole('button', { name: 'Review', exact: true }).click();
  await page.locator('.review-tools').getByRole('button', { name: 'Pause task' }).waitFor();
  await views.getByRole('button', { name: 'Split', exact: true }).click();
  await pauseButton.click();
  assert.equal(interruptions.at(-1), task.id);
  task.status = 'running';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await pauseButton.waitFor();
  console.log('PASS: Pause sits in the composer while Codex works and moves to the review toolbar when the chat is hidden');
  await openDelete();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete task?' });
  await deleteDialog.waitFor();
  assert.equal(await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await deleteDialog.getByRole('button', { name: 'Delete task', exact: true }).isDisabled(), true);
  await page.getByText('Pause this task before deleting it.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(deletions.length, 0);
  task.status = 'reviewing';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator(`.task-row[data-task="${task.id}"] .status`).filter({ hasText: 'Ready for review' }).waitFor();
  await openDelete();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(deletions.length, 0);
  await openDelete();
  deleteFailure = true;
  await deleteDialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  await deleteDialog.getByRole('alert').waitFor();
  await deleteDialog.getByRole('button', { name: 'Retry deletion', exact: true }).waitFor();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Send instructions', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  deleteFailure = false;
  await deleteDialog.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await deleteDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Clarify the introduction/ }).waitFor({ state: 'hidden' });
  assert.deepEqual(deletions, [{ id: task.id, body: { confirm: true } }, { id: task.id, body: { confirm: true } }]);
  assert.equal(await page.getByRole('button', { name: /^Check the notation/ }).count(), 1);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft:' + id), task.id), null);
  console.log('PASS: Task deletion defaults to Cancel, blocks active tasks, retries uncertain cleanup, and removes only the confirmed task');
  await page.getByRole('button', { name: /^Check the notation/ }).click();
  await input.fill('A draft on a task removed elsewhere.');
  await openDelete(secondTask.title);
  await deleteDialog.waitFor();
  snapshot.tasks = snapshot.tasks.filter(t => t.id !== secondTask.id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await deleteDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Check the notation/ }).waitFor({ state: 'hidden' });
  assert.equal(deletions.length, 2);
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:draft:' + id), secondTask.id), null);
  console.log('PASS: Deletion in another tab closes a stale confirmation and clears only that task’s local draft');

  // Opening on a task from a paper other than the first keeps New task on that paper.
  const otherPaper = { id: 'second-paper', name: 'Second paper', path: '/tmp/second', createdAt: 2 };
  const otherTask = { ...task, id: 'other-task-0001', projectId: otherPaper.id, name: 'p-other', title: 'Polish the second paper', status: 'reviewing', review: null };
  const papers = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
  const papersPage = await papers.newPage();
  const paperState = { ...snapshot, projects: [...snapshot.projects, otherPaper], tasks: [otherTask], requests: [] };
  await papersPage.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/api/state') ? paperState : { items: [], build: { status: 'building' }, git: { files: [] } } }));
  await papersPage.goto(origin);
  await papersPage.getByRole('heading', { name: otherTask.title }).waitFor();
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), 'Paper: Second paper');
  await papersPage.locator('.manuscript-link').click();
  await papersPage.getByRole('tab', { name: 'New task', exact: true }).click();
  await papersPage.getByRole('textbox', { name: 'Describe the revision' }).waitFor();
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), 'Paper: Second paper');
  // A saved empty task means the manuscript. A newer task in another paper
  // must not steal the page on reload, nor change the selected paper.
  const unrelatedTask = { ...otherTask, id: 'unrelated-task', projectId: snapshot.projects[0].id, title: 'A newer task in the first paper' };
  paperState.tasks.push(unrelatedTask);
  const manuscriptDraft = papersPage.getByRole('textbox', { name: 'Describe the revision' });
  await manuscriptDraft.fill('Continue editing this paper after reload.');
  await papersPage.reload();
  await manuscriptDraft.waitFor();
  assert.equal(await manuscriptDraft.inputValue(), 'Continue editing this paper after reload.');
  assert.equal(await papersPage.locator('.task-grid').count(), 0);
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), 'Paper: Second paper');
  assert.deepEqual(await papersPage.evaluate(() => [localStorage.getItem('papilot:task'), localStorage.getItem('papilot:project')]), ['', otherPaper.id]);
  await papersPage.getByRole('button', { name: new RegExp('^' + otherTask.title) }).click();
  await papersPage.getByRole('heading', { name: otherTask.title, exact: true }).waitFor();
  await papersPage.reload();
  await papersPage.getByRole('heading', { name: otherTask.title, exact: true }).waitFor();
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), 'Paper: Second paper');
  // A task removed while the page was closed falls back to its manuscript,
  // and the next reload must keep that explicit manuscript selection.
  paperState.tasks = [unrelatedTask];
  await papersPage.reload(); await manuscriptDraft.waitFor();
  await papersPage.reload(); await manuscriptDraft.waitFor();
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), 'Paper: Second paper');
  paperState.projects = snapshot.projects;
  await papersPage.reload(); await manuscriptDraft.waitFor();
  assert.equal(await papersPage.getByRole('button', { name: /^Paper:/ }).getAttribute('aria-label'), `Paper: ${snapshot.projects[0].name}`);
  assert.equal(await papersPage.evaluate(() => localStorage.getItem('papilot:project')), snapshot.projects[0].id);
  await papers.close();
  console.log('PASS: Reload restores the manuscript or selected task and its paper, preserves drafts, and recovers from removed tasks and papers');

  const restricted = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });
  await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } }));
  const restrictedPage = await restricted.newPage();
  const restrictedErrors = [];
  restrictedPage.on('pageerror', error => restrictedErrors.push(error.message));
  await restrictedPage.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/api/state') ? { ...snapshot, tasks: [secondTask], requests: [] } : { items: [] } }));
  await restrictedPage.goto(origin);
  const restrictedInput = restrictedPage.getByRole('textbox', { name: 'Instructions for Codex' });
  await restrictedInput.fill('A usable draft with storage disabled.');
  assert.equal(await restrictedInput.inputValue(), 'A usable draft with storage disabled.');
  assert.deepEqual(restrictedErrors, []);
  await restricted.close();
  console.log('PASS: Blocked browser storage does not prevent loading or editing');
  assert.deepEqual(pageErrors, []);
  console.log('PASS: No uncaught browser errors');
} finally {
  await browser.close();
  await server.close();
}
