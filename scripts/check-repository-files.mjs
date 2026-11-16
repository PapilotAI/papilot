// The file menu of the sidebar's Manuscript row, through the browser, against a real Papilot
// server, review engine, Git and LaTeX: any file of the paper's repository
// opens in the source editor, and any root document can be the one the
// manuscript compiles, with its own notes. The agents are inert; the
// repository, state and browser profile are disposable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium, expect } from './playwright.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-repository-files-'));
process.env.PAPILOT_DATA = path.join(temp, 'data');
delete process.env.PAPILOT_DESKTOP;
const [{ App, createServer }, { Store }, { Workspace }, { Manuscripts }, { buildApp, gitQueue }, { Updates }, { AGENT_IDS }] = await Promise.all([
  import('../engine/src/server.ts'), import('../src/server/store.ts'), import('../src/server/workspace.ts'), import('../src/server/manuscript.ts'),
  import('../src/server/app.ts'), import('../src/server/updates.ts'), import('../src/shared.ts'),
]);
class InertAgent extends EventEmitter { ready = false; close() {} }
const root = path.join(temp, 'paper');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
// A thesis, its chapter, and a response letter beside it in one repository.
write('thesis/main.tex', '\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n');
write('thesis/sections/intro.tex', 'Pelicans glide over the water.\n');
write('letter/response.tex', '\\documentclass{article}\n\\begin{document}\nWe thank the reviewers.\n\\end{document}\n');
write('figures/plot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@localhost');
git('add', '.'); git('commit', '-qm', 'Paper');

const engine = new App(root);
const reviewServer = createServer(engine);
await reviewServer.listen({ host: '127.0.0.1', port: 0 });
engine.url = `http://127.0.0.1:${reviewServer.server.address().port}`;
const call = async (route, body) => {
  const response = await fetch(engine.url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': engine.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
};
const review = { url: engine.url, token: engine.csrf, get: route => call(route), post: (route, body = {}) => call(route, body) };
fs.mkdirSync(process.env.PAPILOT_DATA, { recursive: true });
const store = new Store(path.join(process.env.PAPILOT_DATA, 'state.sqlite3')), manuscripts = new Manuscripts();
const workspace = new Workspace(store, new InertAgent(), async () => review, Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, new InertAgent()])));
store.saveProject({ id: 'paper', name: 'Pelican paper', path: root, createdAt: Date.now() });
const listener = { kind: 'local', port: 0, publicOrigin: '', owner: '' };
const updates = new Updates({ root: process.cwd(), data: process.env.PAPILOT_DATA, version: '0.9.2', port: 0, supported: false, busy: () => false, shutdown() {}, latest: async () => '0.9.2' });
const csrf = 'repository-files-test';
const server = await buildApp({ store, workspace, manuscripts, listener, csrf, serialGit: gitQueue(), dist: path.resolve('dist'), version: '0.9.2', connectReview: async () => review, updates });
await server.listen({ host: '127.0.0.1', port: 0 }); listener.port = server.server.address().port;
const origin = `http://127.0.0.1:${listener.port}`;
const api = async (route, body) => {
  const response = await fetch(origin + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Papilot-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
};
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
fs.mkdirSync('test-results', { recursive: true });
const shot = name => page.screenshot({ path: `test-results/repository-files-${name}.png` });
const settle = async () => {
  let result;
  await expect.poll(async () => { result = await manuscripts.state('paper', root); return result.build.status; }, { timeout: 90000 }).not.toBe('building');
  assert.equal(result.build.status, 'ready', result.build.error);
  return result.build;
};

try {
  const thesis = await settle();
  // A task from before tasks kept their document, as Papilot recorded it.
  const older = engine.tasks.create('older-task', 'Older');
  store.saveTask({ id: 'older', projectId: 'paper', name: older.name, title: 'Older', instructions: '', worktree: older.worktree, threadId: null, turnId: null, model: null, status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });
  // Notes on the thesis, saved before the paper could compile anything
  // else: one shown, one deleted.
  for (const comment of ['Thesis note', 'Deleted note']) await api('/projects/paper/annotations', { key: thesis.key, page: 0, rect: [0.1, 0.1, 0.3, 0.12], comment, quote: 'Pelicans' });
  for (const note of store.annotations('paper')) store.saveAnnotation((({ document: _, ...rest }) => rest)(note));
  const deleted = store.annotations('paper').find(note => note.comment === 'Deleted note');
  await api(`/projects/paper/annotations/${deleted.id}/delete`, {});
  await page.addInitScript(() => {
    localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en');
    // A reading place saved before documents had their own, once.
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('papilot:places', JSON.stringify({ 'pdf:paper': { page: 1, left: 0, top: 0 } })); }
  });
  await page.goto(origin);
  const word = text => page.locator('.pdf-view .textLayer span', { hasText: text }).first();
  await expect(word('Pelicans')).toBeVisible({ timeout: 60000 });
  // The place saved before goes to the document compiled now.
  await page.locator('.manuscript-link').click();
  await expect(page.locator('.manuscript .pdf-view .textLayer span', { hasText: 'Pelicans' }).first()).toBeVisible({ timeout: 60000 });
  const places = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('papilot:places') || '{}')).filter(key => key.startsWith('pdf:')));
  await expect.poll(places).toEqual(['pdf:paper:thesis/main.tex']);
  // The Manuscript row names the compiled document and opens the file menu.
  const menu = page.locator('.manuscript-row').getByRole('button', { name: /^Files/ }), files = page.getByRole('list', { name: 'Repository files' });
  const row = name => files.locator('.repo-row.file', { has: page.getByRole('button', { name, exact: true }) });
  await expect(menu).toHaveText('main.tex');
  await expect(files).toBeHidden();
  await menu.click();
  // The thesis is compiled; its folders are open, the others closed.
  await expect(row('main.tex').getByRole('img', { name: 'Compiled document' })).toBeVisible();
  await expect(files.getByRole('button', { name: 'main.tex', exact: true })).toBeFocused();
  await expect(files.getByRole('button', { name: 'letter' })).toHaveAttribute('aria-expanded', 'false');
  await expect(files.getByRole('button', { name: 'plot.png' })).toHaveCount(0);
  await files.getByRole('button', { name: 'figures' }).click();
  // The source editor edits text; an image is listed but opens nowhere.
  await expect(files.getByRole('button', { name: 'plot.png' })).toBeDisabled();

  // Any file opens in the source tab, beside the PDF.
  await files.getByRole('button', { name: 'sections' }).click();
  await files.getByRole('button', { name: 'intro.tex' }).click();
  await expect(files).toBeHidden();
  const tabs = page.getByRole('tablist', { name: 'Manuscript panels' });
  await expect(tabs.getByRole('tab', { name: /intro\.tex/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.source-panel .cm-content')).toContainText('Pelicans glide over the water.');
  await menu.click();
  await expect(files.getByRole('button', { name: 'intro.tex' })).toHaveAttribute('aria-current', 'true');
  await expect(files.getByRole('button', { name: 'intro.tex' })).toBeFocused();
  await shot('open');

  // The letter compiles instead of the thesis, from its row.
  await files.getByRole('button', { name: 'letter' }).click();
  // Its play button shows without pointing at it, and stays inside its row.
  const play = files.getByRole('button', { name: 'Compile response.tex' });
  await expect(play).toBeVisible();
  expect(await play.evaluate(button => getComputedStyle(button).opacity)).toBe('1');
  const [rowBox, playBox] = await Promise.all([row('response.tex').boundingBox(), play.boundingBox()]);
  assert.ok(playBox.y >= rowBox.y && playBox.y + playBox.height <= rowBox.y + rowBox.height && playBox.x + playBox.width <= rowBox.x + rowBox.width, `the play button ${JSON.stringify(playBox)} fits its row ${JSON.stringify(rowBox)}`);
  await play.click();
  await expect(word('reviewers')).toBeVisible({ timeout: 60000 });
  await expect(word('Pelicans')).toHaveCount(0);
  await expect(files).toBeHidden();
  await expect(menu).toHaveText('response.tex');
  await menu.click();
  await expect(row('response.tex').getByRole('img', { name: 'Compiled document' })).toBeVisible();
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.git/papilot/settings.json'), 'utf8'));
  assert.equal(settings.main, 'letter/response.tex');
  // The manuscript names the document of its PDF, which keeps its own place.
  assert.equal((await api('/projects/paper/manuscript')).build.document, 'letter/response.tex');
  // The thesis notes stay with the thesis, also one restored meanwhile.
  assert.deepEqual((await api('/projects/paper/manuscript')).annotations, []);
  assert.deepEqual((await api(`/projects/paper/annotations/${deleted.id}/restore`, {})).annotations, []);
  assert.deepEqual(store.annotations('paper').map(note => note.document), ['thesis/main.tex', 'thesis/main.tex']);
  await api(`/projects/paper/annotations/${deleted.id}/delete`, {});
  // Also while the thesis takes \documentclass from another file.
  const thesisText = fs.readFileSync(path.join(root, 'thesis/main.tex'), 'utf8');
  write('thesis/preamble.tex', '\\documentclass{article}\n');
  write('thesis/main.tex', thesisText.replace('\\documentclass{article}', '\\input{preamble}'));
  assert.deepEqual((await api('/projects/paper/manuscript')).annotations, []);
  write('thesis/main.tex', thesisText); fs.rmSync(path.join(root, 'thesis/preamble.tex'));
  // The older task compiled the thesis, and its agent reads no letter PDF.
  assert.equal(store.task('older').document, 'thesis/main.tex');
  assert.equal(workspace.paperBuild(store.task('older')), null);
  await shot('letter');

  // A task started now compiles the letter; one started before, the thesis.
  const letterTask = engine.tasks.create('letter-task', 'Letter');
  assert.equal(engine.projectOf(letterTask).main, 'letter/response.tex');

  // Back to the thesis: its PDF, from the cache, and its note.
  await files.getByRole('button', { name: 'Compile main.tex' }).click();
  await expect(word('Pelicans')).toBeVisible({ timeout: 60000 });
  await expect(menu).toHaveText('main.tex');
  assert.deepEqual((await api('/projects/paper/manuscript')).annotations.map(note => note.comment), ['Thesis note']);
  assert.equal(engine.projectOf(letterTask).main, 'letter/response.tex');
  assert.ok(workspace.paperBuild(store.task('older')), 'the older task reads the thesis PDF again');
  // A renamed main file keeps its notes.
  git('mv', 'thesis/main.tex', 'thesis/thesis.tex');
  await api('/projects/paper/manuscript', {});
  await settle();
  await expect.poll(async () => (await api('/projects/paper/manuscript')).annotations.map(note => note.comment)).toEqual(['Thesis note']);
  await expect.poll(() => store.annotations('paper')[0].document).toBe('thesis/thesis.tex');
  git('mv', 'thesis/thesis.tex', 'thesis/main.tex');
  // Only root documents compile.
  await assert.rejects(api('/projects/paper/document', { main: 'thesis/sections/intro.tex' }), /documentclass/);
  await assert.rejects(api('/projects/paper/document', { main: '../outside.tex' }), /documentclass/);
  // Settings edited by hand to name the letter while the thesis PDF shows:
  // choosing the thesis puts it back in the settings.
  await api('/projects/paper/manuscript', {});
  await settle();
  assert.equal((await api('/projects/paper/manuscript')).build.document, 'thesis/main.tex');
  const settingsFile = path.join(root, '.git/papilot/settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), main: 'letter/response.tex' }));
  await api('/projects/paper/document', { main: 'thesis/main.tex' });
  assert.notEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).main, 'letter/response.tex');
  await settle();

  // A list that cannot be read says so, and Retry reads it again.
  let listings = 0;
  await page.route('**/api/projects/paper/files', route => { listings++; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Could not list the files of this repository.' }) }); });
  await page.reload();
  await menu.click();
  await expect(files.getByRole('alert')).toHaveText('Could not list the files of this repository.');
  const asked = listings;
  await files.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => listings).toBeGreaterThan(asked);
  await expect(files.getByRole('alert')).toBeVisible();
  // Once the files can be read, the next reading lists them.
  await page.unroute('**/api/projects/paper/files');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(files.getByRole('button', { name: 'thesis' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Closed, the menu reads no files, also when the paper changes; opened
  // after a change, it reads them again.
  await page.locator('.manuscript-link').click();
  let reads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/projects/paper/files') reads++; });
  write('notes.tex', 'Notes.\n');
  const manuscriptRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/projects/paper/manuscript' && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await manuscriptRead;
  await page.waitForTimeout(500);
  assert.equal(reads, 0, 'the closed menu read the files');
  await menu.click();
  await expect(files.getByRole('button', { name: 'notes.tex' })).toBeVisible();
  assert.ok(reads > 0);
  await page.keyboard.press('Escape');

  // Escape closes the menu and the browser returns focus to its button; the
  // folders opened stay open.
  await menu.click();
  await files.getByRole('button', { name: 'figures' }).click();
  await page.keyboard.press('Escape');
  await expect(files).toBeHidden();
  await expect(menu).toBeFocused();
  await page.reload();
  await menu.click();
  await expect(files.getByRole('button', { name: 'letter' })).toHaveAttribute('aria-expanded', 'true');
  await expect(files.getByRole('button', { name: 'figures' })).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');

  // Keyboard navigation does not trigger a note card's outside-pointer
  // save. Switching documents must wait for its pending edit itself.
  await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();
  const notes = page.getByRole('region', { name: 'My notes', exact: true });
  const edit = notes.getByRole('textbox', { name: 'Edit note 1', exact: true });
  const note = store.annotations('paper').find(note => note.comment === 'Thesis note');
  const noteRoute = `**/api/projects/paper/annotations/${note.id}`;
  const compileFromKeyboard = async name => {
    await menu.focus(); await menu.press('Enter');
    const button = files.getByRole('button', { name: `Compile ${name}`, exact: true });
    await button.focus(); await button.press('Enter');
  };
  await notes.getByRole('button', { name: 'Edit note 1: Thesis note', exact: true }).click();
  await edit.fill('Saved before switching documents');
  let saveStarted = false, releaseSave;
  const saving = new Promise(resolve => { releaseSave = resolve; });
  await page.route(noteRoute, async route => { saveStarted = true; await saving; await route.continue(); });
  try {
    await compileFromKeyboard('response.tex');
    await expect.poll(() => saveStarted).toBe(true);
    assert.equal((await api('/projects/paper/manuscript')).build.document, 'thesis/main.tex');
    await expect(edit).toHaveValue('Saved before switching documents');
  } finally { releaseSave(); }
  await expect(word('reviewers')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => store.annotations('paper').find(item => item.id === note.id)?.comment).toBe('Saved before switching documents');
  await page.unroute(noteRoute);
  await compileFromKeyboard('main.tex');
  await expect(word('Pelicans')).toBeVisible({ timeout: 60000 });

  // Failed saves keep the original document and the draft so the author
  // can retry the same switch without losing text.
  await notes.getByRole('button', { name: 'Edit note 1: Saved before switching documents', exact: true }).click();
  await edit.fill('Retained after a failed save');
  await page.route(noteRoute, route => route.fulfill({ status: 400, json: { error: 'The note could not be saved.' } }));
  await compileFromKeyboard('response.tex');
  await expect(notes.getByRole('alert')).toHaveText('The note could not be saved.');
  await expect(menu).toHaveText('main.tex');
  await expect(edit).toHaveValue('Retained after a failed save');
  assert.equal((await api('/projects/paper/manuscript')).build.document, 'thesis/main.tex');
  await shot('document-switch-save-failed');
  await page.unroute(noteRoute);
  await compileFromKeyboard('response.tex');
  await expect(word('reviewers')).toBeVisible({ timeout: 60000 });
  await compileFromKeyboard('main.tex');
  await expect(word('Pelicans')).toBeVisible({ timeout: 60000 });
  await expect(notes.getByRole('button', { name: 'Edit note 1: Retained after a failed save', exact: true })).toBeVisible();

  // A floating PDF card has its own editor. Wait for an outside-pointer
  // save already in flight before replacing the document's viewer.
  await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();
  await page.getByRole('button', { name: 'Note 1: Retained after a failed save', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'PDF note 1', exact: true });
  await card.getByRole('button', { name: 'Edit note 1', exact: true }).click();
  await card.getByRole('textbox').fill('Floating edit saved before switching');
  saveStarted = false;
  const floatingSave = new Promise(resolve => { releaseSave = resolve; });
  await page.route(noteRoute, async route => { saveStarted = true; await floatingSave; await route.continue(); });
  try {
    await menu.click();
    await expect.poll(() => saveStarted).toBe(true);
    await files.getByRole('button', { name: 'Compile response.tex', exact: true }).press('Enter');
    assert.equal((await api('/projects/paper/manuscript')).build.document, 'thesis/main.tex');
    await expect(card.getByRole('textbox')).toHaveValue('Floating edit saved before switching');
  } finally { releaseSave(); }
  await expect(word('reviewers')).toBeVisible({ timeout: 60000 });
  assert.equal(store.annotations('paper').find(item => item.id === note.id)?.comment, 'Floating edit saved before switching');
  await page.unroute(noteRoute);
  await compileFromKeyboard('main.tex');
  await expect(word('Pelicans')).toBeVisible({ timeout: 60000 });

  // A new floating note also survives a failed keyboard switch and saves
  // on the original document when the same switch is retried.
  await page.locator('.pdf-container').focus();
  await page.keyboard.press('p');
  const sheet = await page.locator('.pdf-view .page').first().boundingBox();
  await page.mouse.click(sheet.x + sheet.width * 0.5, sheet.y + sheet.height * 0.3);
  const compose = page.locator('.pdf-note-compose');
  await compose.getByRole('textbox').fill('New floating note retained on failure');
  const createRoute = '**/api/projects/paper/annotations';
  await page.route(createRoute, route => route.fulfill({ status: 400, json: { error: 'The note could not be saved.' } }));
  await compileFromKeyboard('response.tex');
  await expect(compose.getByRole('alert')).toHaveText('The note could not be saved.');
  await expect(compose.getByRole('textbox')).toHaveValue('New floating note retained on failure');
  await expect(menu).toHaveText('main.tex');
  await shot('floating-note-save-failed');
  await page.unroute(createRoute);
  await compileFromKeyboard('response.tex');
  await expect(word('reviewers')).toBeVisible({ timeout: 60000 });
  assert.equal(store.annotations('paper').find(item => item.comment === 'New floating note retained on failure')?.document, 'thesis/main.tex');
  assert.deepEqual(errors, []);
  console.log('Repository file menu check passed.');
} catch (error) {
  await shot('failure').catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await reviewServer?.close();
  await engine?.close();
  await manuscripts.stop();
  updates?.close();
  workspace?.close();
  store?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
