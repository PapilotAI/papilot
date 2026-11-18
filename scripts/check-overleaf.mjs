import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

// Overleaf sync in the workspace: signing in with a session cookie or a
// browser already signed in, choosing a project, comparing and linking, the sidebar row, the details panel with
// a conflict, and an import that keeps syncing.
fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
context.setDefaultTimeout(15000);
const errors = [], posts = [];
page.on('pageerror', error => errors.push(error.message));
const project = { id: 'paper', name: 'Example paper', path: '/tmp/overleaf-fixture', createdAt: 1 };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'model', name: 'Model', isDefault: true, efforts: ['high'], defaultEffort: 'high' }] };
const OVERLEAF = 'https://www.overleaf.com', projectId = '0123456789abcdef01234567';
let overleaf = { accounts: [], syncs: [] };
const linked = () => ({ projectId: 'paper', origin: OVERLEAF, overleafId: projectId, name: 'Thesis draft', url: `${OVERLEAF}/project/${projectId}`, state: 'synced', readOnly: false, pending: 0, syncedAt: Date.now(),
  collaborators: [{ id: 'u1', name: 'Ada Lovelace', file: 'chapters/intro.tex' }, { id: 'u2', name: 'Grace Hopper' }, { id: 'me', name: 'Author', you: true, file: 'main.tex' }],
  cursors: [{ client: 'P.ada', id: 'u1', name: 'Ada Lovelace', file: 'chapters/intro.tex', line: 1, column: 4 }, { client: 'P.me', id: 'me', name: 'Author', you: true, file: 'chapters/intro.tex', line: 0, column: 0 }],
  conflicts: [{ id: 'c1', path: 'chapters/intro.tex', kind: 'text', at: Date.now(), ours: 'Our results improve accuracy by 4%.', theirs: 'Our results improve accuracy by 3.8%.' }], skipped: [] });
let importNeedsSignIn = true, browserSessions = [];
let projectSessionExpired = false, compareSessionExpired = false;
const poster = 'f'.repeat(24);
const intro = 'Intro line one.\nAda wrote this sentence.\nThird line.\n';
await context.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
  if (body !== undefined) posts.push({ path: url.pathname, body });
  if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json({ version: 'test', csrf: 'fixture', projects: [project], tasks: [], requests: [], runtime, gitAvailable: true, overleaf });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', checkedAt: 1, error: null, canUpdate: true });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'))[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/manuscript')) return json({ git: { branch: 'main', upstream: null, ahead: 0, behind: 0, files: [], head: null }, build: { status: 'ready', key: 'fixture', pages: [[612, 792], [612, 792]], builtAt: 1, current: true }, annotations: [] });
  // A file Ada changed on Overleaf since the last commit: her sentence is hers.
  if (url.pathname === '/api/projects/paper/manuscript/source') return json({ file: 'chapters/intro.tex', revision: 'r1', text: intro, base: 'Intro line one.\nThird line.\n', passage: [0, 0], focus: [0, 0], drifted: false,
    authors: [{ from: intro.indexOf('Ada wrote'), to: intro.indexOf('sentence.') + 9, id: 'u1', name: 'Ada Lovelace', at: Date.now() }, { from: 0, to: 5, id: 'u1', name: 'Ada Lovelace', at: Date.now() }] });
  if (url.pathname.endsWith('/git')) return json({ branch: 'main', upstream: null, ahead: 0, behind: 0, files: [], head: null });
  if (url.pathname === '/api/overleaf/browsers') return json({ sessions: browserSessions });
  if (url.pathname === '/api/overleaf/sign-in') {
    if (!/^overleaf_session2=s%3A/.test(body.cookies) && !browserSessions.some(session => session.id === body.browser)) return route.fulfill({ status: 400, json: { error: 'Overleaf did not accept this sign-in. Sign in again.' } });
    projectSessionExpired = compareSessionExpired = false;
    overleaf = { ...overleaf, accounts: [{ origin: OVERLEAF, email: 'author@example.com' }] };
    return json({ origin: OVERLEAF, email: 'author@example.com' });
  }
  if (url.pathname === '/api/overleaf/projects') {
    if (projectSessionExpired) return route.fulfill({ status: 401, json: { error: 'Sign in to Overleaf again.', signIn: OVERLEAF } });
    return json({ projects: [{ id: projectId, name: 'Thesis draft', updatedAt: Date.now() - 3600_000, owner: 'Ada Lovelace', access: 'readAndWrite' }, { id: 'f'.repeat(24), name: 'Workshop poster', updatedAt: Date.now() - 86400_000 * 40, owner: 'Author', access: 'owner' }] });
  }
  if (url.pathname === '/api/projects/paper/overleaf/compare') {
    if (compareSessionExpired) return route.fulfill({ status: 401, json: { error: 'Sign in to Overleaf again.', signIn: OVERLEAF } });
    return json({ name: body.url.includes(poster) ? 'Workshop poster' : 'Thesis draft', same: 12, overleaf: ['figures/new.pdf'], local: ['notes.md'], different: ['main.tex', 'chapters/intro.tex'], origin: OVERLEAF, overleafId: projectId });
  }
  if (url.pathname === '/api/projects/paper/overleaf/link') { overleaf = { ...overleaf, syncs: [body.replace ? { ...linked(), name: 'Workshop poster', overleafId: poster, url: `${OVERLEAF}/project/${poster}`, conflicts: [] } : linked()] }; return json(overleaf); }
  if (url.pathname === '/api/projects/paper/overleaf/conflicts/c1/use-mine') { overleaf = { ...overleaf, syncs: [{ ...linked(), conflicts: [] }] }; return json(overleaf); }
  if (url.pathname === '/api/projects/paper/overleaf/unlink') { overleaf = { ...overleaf, syncs: [] }; return json(overleaf); }
  const draft = { id: '00000000-0000-4000-8000-000000000001', path: '/tmp/papers/thesis', copied: true, name: 'Thesis draft', candidates: ['main.tex'], main: 'main.tex', engine: 'xelatex', phase: 'choose', overleaf: 'link' };
  if (url.pathname === '/api/imports') {
    if (importNeedsSignIn) { importNeedsSignIn = false; return route.fulfill({ status: 401, json: { error: 'Sign in to this Overleaf server first.', signIn: OVERLEAF } }); }
    return json(draft);
  }
  if (url.pathname.startsWith(`/api/imports/${draft.id}`)) return json({ ...draft, phase: 'ready', versioned: true });
  return json({});
});

try {
  await page.goto(origin);
  await page.locator('.project-switcher').click();
  await page.getByRole('menuitem', { name: 'Sync with Overleaf…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sync with Overleaf' });
  await expect(dialog).toBeVisible();
  // Signed out in a browser: a session cookie signs in.
  await expect(dialog.getByLabel('Session cookie from overleaf.com')).toBeVisible();
  // Where to find the cookie opens in place instead of leaving the app.
  const steps = dialog.locator('.overleaf-help');
  await expect(steps.locator('ol')).toBeHidden();
  await steps.getByText('Where to find it').click();
  await expect(steps.getByText('overleaf_session2', { exact: true })).toBeVisible();
  await expect(steps.getByText('https://www.overleaf.com', { exact: true })).toBeVisible();
  expect(page.url().startsWith(origin)).toBe(true);
  await page.screenshot({ path: 'test-results/overleaf-sign-in.png', animations: 'disabled' });
  await dialog.getByLabel('Session cookie from overleaf.com').fill('overleaf_session2=s%3Afixture');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // The account's projects, then the comparison and the choice.
  await expect(dialog.getByRole('button', { name: /Thesis draft/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/overleaf-projects.png', animations: 'disabled' });
  // The account stays stored when its session expires. Opening the picker
  // must offer sign-in again and load projects afterwards without a state refresh.
  await page.keyboard.press('Escape');
  projectSessionExpired = true;
  await page.locator('.project-switcher').click();
  await page.getByRole('menuitem', { name: 'Sync with Overleaf…' }).click();
  await expect(dialog.getByLabel('Session cookie from overleaf.com')).toBeFocused();
  await expect(dialog.getByText('Loading projects…')).toBeHidden();
  await page.screenshot({ path: 'test-results/overleaf-reauth.png', animations: 'disabled' });
  await dialog.getByLabel('Session cookie from overleaf.com').fill('overleaf_session2=s%3Arenewed');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog.getByRole('button', { name: /Thesis draft/ })).toBeVisible();
  // Expiry during comparison keeps the selected project and resumes that
  // comparison after sign-in, rather than asking the author to choose it again.
  compareSessionExpired = true;
  await dialog.getByRole('button', { name: /Thesis draft/ }).click();
  await expect(dialog.getByLabel('Session cookie from overleaf.com')).toBeFocused();
  await dialog.getByLabel('Session cookie from overleaf.com').fill('overleaf_session2=s%3Arenewed-again');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog.getByText('2 files differ')).toBeVisible();
  assert.deepEqual(posts.filter(post => post.path.endsWith('/overleaf/compare')).map(post => post.body), [
    { url: `${OVERLEAF}/project/${projectId}` }, { url: `${OVERLEAF}/project/${projectId}` },
  ]);
  await expect(dialog.getByRole('button', { name: 'Keep Overleaf’s' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Keep this paper’s' }).click();
  await page.screenshot({ path: 'test-results/overleaf-compare.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Start syncing' }).click();
  await expect(dialog).toBeHidden();
  assert.deepEqual(posts.find(post => post.path.endsWith('/overleaf/link')).body, { url: `${OVERLEAF}/project/${projectId}`, choice: 'local' });
  // The sidebar row and the details panel.
  const row = page.getByRole('button', { name: /^Overleaf:/ });
  await expect(row).toBeVisible();
  await expect(row.locator('.count')).toHaveText('1');
  await row.click();
  const panel = page.getByRole('dialog', { name: 'Sync with Overleaf' });
  // The project is named beside the button that changes it.
  await expect(panel.locator('.overleaf-project')).toContainText('Thesis draft');
  await expect(panel.locator('.overleaf-project')).toContainText('overleaf.com');
  await expect(panel.locator('.overleaf-project').getByRole('button', { name: 'Change project…' })).toHaveText('Change…');
  // Who is on Overleaf, by name, with the file they are in; this account in a browser is the author.
  await expect(panel.getByText('Ada Lovelace')).toBeVisible();
  await expect(panel.getByText('Author (you)')).toBeVisible();
  await expect(panel.locator('.overleaf-people li').last()).toContainText('Author (you)');
  await expect(panel.getByRole('button', { name: 'chapters/intro.tex' })).toHaveAttribute('title', 'Open chapters/intro.tex where Ada Lovelace is');
  await expect(panel.getByText('Our results improve accuracy by 3.8%.')).toBeVisible();
  await page.screenshot({ path: 'test-results/overleaf-panel.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  // The screenshot waits for the dark theme to reach the panel's buttons.
  await expect(panel.getByRole('button', { name: 'Use mine' })).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/overleaf-panel-dark.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await panel.getByRole('button', { name: 'Use mine' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByText('Our results improve accuracy by 3.8%.')).toBeHidden();
  // Ada's file opens where she is: her words since the last commit carry her
  // colour and name, and her cursor shows with it; the author's own browser does not.
  await panel.getByRole('button', { name: 'chapters/intro.tex' }).click();
  await expect(panel).toBeHidden();
  const editor = page.locator('.source-panel .cm-content');
  await expect(editor).toContainText('Ada wrote this sentence.');
  // Her cursor sits inside her words, which the editor draws in two parts;
  // the committed line she also wrote is not marked.
  await expect(page.locator('.cm-author').first()).toBeVisible();
  expect((await page.locator('.cm-author').allTextContents()).join('')).toBe('Ada wrote this sentence.');
  for (const title of await page.locator('.cm-author').evaluateAll(marks => marks.map(mark => mark.title))) expect(title).toMatch(/^Ada Lovelace · /);
  await expect(page.locator('.cm-remote-cursor')).toHaveCount(1);
  await expect(page.locator('.cm-remote-flag')).toHaveAttribute('data-name', 'Ada Lovelace');
  await expect(editor).toHaveText('Intro line one.Ada wrote this sentence.Third line.');
  expect(await page.locator('.cm-remote-cursor').evaluate(caret => caret.parentElement.closest('.cm-line').textContent)).toBe('Ada wrote this sentence.');
  await page.locator('.cm-remote-cursor').hover();
  await expect(page.locator('.cm-remote-flag')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/overleaf-authors.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/overleaf-authors-dark.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  // Another project can take this one's place, compared first; changing
  // one's mind goes back to the panel.
  await row.click();
  await panel.getByRole('button', { name: 'Change project…' }).click();
  const change = page.getByRole('dialog', { name: 'Change Overleaf project' });
  await expect(change).toBeVisible();
  await expect(change.getByRole('button', { name: /Thesis draft/ })).toBeDisabled();
  await expect(change.getByRole('button', { name: /Thesis draft/ })).toContainText('Syncing now');
  await expect(change.getByRole('button', { name: /Workshop poster/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(change).toBeHidden();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Change project…' }).click();
  await change.getByRole('button', { name: /Workshop poster/ }).click();
  await expect(change.getByText('2 files differ')).toBeVisible();
  assert.equal(posts.filter(post => post.path.endsWith('/overleaf/compare')).at(-1).body.replace, true);
  await page.screenshot({ path: 'test-results/overleaf-change.png', animations: 'disabled' });
  await change.getByRole('button', { name: 'Switch project' }).click();
  await expect(change).toBeHidden();
  assert.deepEqual(posts.filter(post => post.path.endsWith('/overleaf/link')).at(-1).body, { url: `${OVERLEAF}/project/${poster}`, choice: 'overleaf', replace: true });
  await row.click();
  const moved = page.getByRole('dialog', { name: 'Sync with Overleaf' });
  await expect(moved.locator('.overleaf-project')).toContainText('Workshop poster');
  await moved.getByRole('button', { name: 'Stop syncing…' }).click();
  await moved.getByRole('button', { name: 'Stop syncing', exact: true }).click();
  await expect(moved).toBeHidden();
  await expect(row).toBeHidden();
  // Phone width.
  overleaf = { ...overleaf, syncs: [linked()] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /Show task list|Papers and tasks|menu/i }).first().click().catch(() => undefined);
  const phoneRow = page.getByRole('button', { name: /^Overleaf:/ });
  if (await phoneRow.isVisible()) {
    await phoneRow.click();
    await expect(page.getByRole('dialog', { name: 'Sync with Overleaf' })).toBeVisible();
    await page.screenshot({ path: 'test-results/overleaf-panel-phone.png', animations: 'disabled' });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  // An import of an Overleaf link keeps syncing and signs in on the way.
  overleaf = { accounts: [], syncs: [] };
  await page.reload();
  await page.locator('.project-switcher').click();
  await page.getByRole('menuitem', { name: 'Import or open' }).click();
  await page.getByPlaceholder('Paste a link…').fill(`${OVERLEAF}/project/${projectId}`);
  const keep = page.getByRole('switch', { name: 'Keep in sync with Overleaf' });
  await expect(keep).toBeChecked();
  // A browser on this computer already signed in comes first, one click.
  browserSessions = [{ id: 'chrome:Profile 1', browser: 'Chrome' }, { id: 'firefox:Profiles/ab12.default-release', browser: 'Firefox' }];
  await page.getByRole('button', { name: 'Import link' }).click();
  const useChrome = page.getByRole('button', { name: 'Use the sign-in from Chrome' });
  await expect(useChrome).toBeFocused();
  await expect(page.getByRole('button', { name: 'Use the sign-in from Firefox' })).toBeVisible();
  await expect(page.getByLabel('Session cookie from overleaf.com')).toBeHidden();
  await page.getByText('Paste a session cookie instead').click();
  await expect(page.getByLabel('Session cookie from overleaf.com')).toBeVisible();
  await page.screenshot({ path: 'test-results/overleaf-import-sign-in.png', animations: 'disabled' });
  await useChrome.click();
  await expect(page.getByLabel('Paper name')).toHaveValue('Thesis draft');
  assert.deepEqual(posts.filter(post => post.path === '/api/overleaf/sign-in').at(-1).body, { origin: OVERLEAF, browser: 'chrome:Profile 1' });
  await expect(page.getByRole('button', { name: 'Open paper' })).toBeVisible();
  assert.deepEqual(posts.filter(post => post.path === '/api/imports').at(-1).body, { url: `${OVERLEAF}/project/${projectId}`, sync: true });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('Overleaf sync UI checks passed.');
} finally {
  await browser.close();
  await server.close();
}
