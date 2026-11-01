import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';
import { SkillLibrary } from '../src/server/skill-library.ts';
import { registerSkillRoutes } from '../src/server/skill-routes.ts';
import { listedSkill, loadSkills } from '../src/server/skills.ts';
import { Store } from '../src/server/store.ts';

// Real skill HTTP handlers and files, with an otherwise idle simulated paper.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-skills-ui-'));
const roots = { builtin: path.resolve('skills'), user: path.join(root, '.papilot', 'skills') };
const project = { id: 'paper', name: 'Example paper', path: path.join(root, 'paper'), createdAt: 1 };
fs.mkdirSync(project.path);
const store = new Store(':memory:'); store.saveProject(project);
const library = new SkillLibrary(roots), server = Fastify();
server.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 400).send({ error: error.message }));
registerSkillRoutes(server, store, library);
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const snapshot = { version: 'test', csrf: 'fixture', projects: [project], tasks: [], requests: [], runtime: { connected: true, authenticated: true, account: null, error: null, models: [] } };
const git = { branch: 'main', upstream: null, ahead: 0, behind: 0, head: null, files: [] };
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname.startsWith('/api/skills')) return route.continue();
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/skills')) return json({ skills: loadSkills(project.path, roots).map(listedSkill) });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'fixture', pages: [[612, 792]], builtAt: 1 }, annotations: [] });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return json(JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'))[Number(url.searchParams.get('page'))]);
  throw new Error(`Unexpected app request ${url.pathname}`);
});
const open = async () => {
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (!await settings.isVisible()) await page.locator('.settings-link').click();
  await settings.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Skills', exact: true })).toBeVisible();
};
const dialog = page.getByRole('dialog', { name: 'Skills', exact: true });
const content = dialog.getByRole('textbox', { name: 'Skill content (Markdown)', exact: true });
const close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click();
const globalFile = path.join(roots.user, 'house-style', 'SKILL.md');
try {
  await page.goto(origin); await open();
  await expect(page.locator('.sidebar .skills-link')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(dialog.locator('.skill-library-storage, .skill-library-file')).toHaveCount(0);
  await expect(dialog).not.toContainText(roots.user);
  await expect(dialog.locator('.skill-library-item')).toHaveCount(7);
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('heading', { name: 'General', exact: true })).toBeFocused();
  await open();
  await dialog.locator('.skill-library-item').filter({ hasText: 'Polish' }).click();
  await expect(dialog.locator('.skill-library-preview')).toContainText('prose');
  await expect(content).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Copy and edit' }).click();
  await expect(dialog.getByLabel('Save to')).toHaveValue('user');
  await dialog.getByLabel('Skill ID').fill('house-style');
  const globalText = '---\nname: House style\ndescription: Keep terminology consistent\ncustom-field: preserve me\n---\n\nUse short sentences.\n';
  await content.fill(globalText);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
  assert.equal(fs.readFileSync(globalFile, 'utf8'), globalText);
  await expect(dialog.locator('.skill-library-item')).toHaveCount(8);
  await close();
  const composer = page.getByRole('textbox', { name: 'Describe the revision', exact: true });
  await composer.fill('/house');
  await page.getByRole('option').filter({ hasText: 'House style' }).click();
  await expect(page.locator('.new-task-panel .skill-chip')).toContainText('House style');

  // A paper-specific copy takes priority without losing the global one.
  await open();
  await dialog.getByRole('button', { name: 'New skill', exact: true }).click();
  await dialog.getByLabel('Skill ID').fill('house-style');
  await dialog.getByLabel('Save to').selectOption('paper');
  await content.fill('---\nname: Paper style\n---\nKeep this paper concise.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
  assert.ok(fs.existsSync(path.join(project.path, '.papilot/skills/house-style/SKILL.md')));
  await expect(dialog.locator('.skill-library-item').filter({ hasText: 'House style' })).toContainText('Overridden');
  await page.screenshot({ path: '/tmp/papilot-skills-desktop.png' });
  await close();
  await expect(page.locator('.new-task-panel .skill-chip')).toContainText('Paper style');

  // External edits are protected, and leaving a dirty editor requires a choice.
  await open(); await dialog.locator('.skill-library-item').filter({ hasText: 'House style' }).click();
  await expect(content).toHaveValue(globalText);
  await content.fill(globalText + 'My unsaved edit.');
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.getByText('Discard unsaved skill changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  fs.writeFileSync(globalFile, globalText + 'External edit.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed on disk');
  assert.ok(fs.readFileSync(globalFile, 'utf8').endsWith('External edit.'));
  await close();
  await expect(dialog.getByText('Discard unsaved skill changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(content).toHaveValue(globalText + 'My unsaved edit.');
  await close(); await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog).toHaveCount(0);

  // Removing the paper override immediately restores the global skill.
  await open(); await dialog.locator('.skill-library-item').filter({ hasText: 'Paper style' }).click();
  await dialog.getByRole('button', { name: 'Delete skill', exact: true }).click();
  await dialog.locator('.skill-library-confirm').getByRole('button', { name: 'Delete skill', exact: true }).click();
  await expect(dialog.locator('.skill-library-item').filter({ hasText: 'Paper style' })).toHaveCount(0);
  await close(); await expect(page.locator('.new-task-panel .skill-chip')).toContainText('House style');

  // Mobile starts with a compact list; details and back navigation fit the viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show task list', exact: true }).click();
  await open(); await expect(dialog.locator('.skill-library-sidebar')).toBeVisible();
  await dialog.locator('.skill-library-item').filter({ hasText: 'House style' }).click();
  await expect(content).toBeVisible();
  await page.screenshot({ path: '/tmp/papilot-skills-mobile.png' });
  const bounds = await dialog.locator('.skill-library').boundingBox(); assert.ok(bounds.width <= 390);
  await expect(dialog.locator('.skill-library-editor-actions')).toBeInViewport();
  await dialog.getByRole('button', { name: 'All skills', exact: true }).click();
  await expect(dialog.locator('.skill-library-sidebar')).toBeVisible();
  await dialog.getByRole('button', { name: 'New skill', exact: true }).click();
  await dialog.getByLabel('Skill ID').fill('unsaved');
  await content.fill('Keep this draft.');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(content).toHaveValue('Keep this draft.');
  await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: 'Discard changes' }).click();

  // Chinese labels and the empty-workspace global library work without a paper.
  snapshot.projects = []; await page.evaluate(() => localStorage.setItem('papilot:language', 'zh-CN'));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await page.locator('.settings-link').click();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '技能', exact: true }).click();
  const chinese = page.getByRole('dialog', { name: '技能', exact: true });
  await expect(chinese).toBeVisible();
  await chinese.getByRole('button', { name: '新建技能', exact: true }).click();
  await expect(chinese.getByLabel('保存到')).toHaveValue('user');
  await expect(chinese.getByLabel('保存到').locator('option')).toHaveCount(1);
  await chinese.getByRole('button', { name: '关闭', exact: true }).click();
  await chinese.getByRole('button', { name: '放弃修改', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Skill settings: single-dialog navigation, no main-sidebar entry or storage paths, real file creation, overrides, composer refresh, conflict protection, deletion, mobile and Chinese UI passed.');
} finally { await browser.close(); await server.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
