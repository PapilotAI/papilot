import assert from 'node:assert/strict';
import { expect } from './playwright.mjs';

// Run from the real import dialog. The disposable server fixture models a
// coauthor saving between reads; the backend tests exercise the on-disk write.
export async function checkSshFolder(page) {
  const path = 'sections/introduction.tex';
  const initial = [
    '\\section{Introduction}', '\\label{sec:introduction}', '',
    'Scientific manuscripts often live alongside the code and data', 'used to produce their results.', '',
    '\\subsection{Study design}', 'We compare the observed distributions across three conditions.',
    'Each condition uses the same calibration procedure.', '',
    'Table~\\ref{tab:results} summarizes the measurements.', '',
  ].join('\n');
  let text = initial, revision = 1, failSave = false, folder = null, saved = false;
  const browsed = [];
  const entries = [{ name: 'sections', folder: true }, { name: 'main.tex', folder: false }, { name: 'references.bib', folder: false }];
  const match = '**/api/ssh{,/**}';
  await page.route(match, async route => {
    const url = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    const json = value => route.fulfill({ json: value });
    if (url === '/api/ssh') return json({ aliases: ['research-lab'], folders: saved ? [folder] : [] });
    if (url.endsWith('/browse')) {
      if (body.host === 'offline') return route.fulfill({ status: 400, json: { error: 'Connection timed out.' } });
      if (body.host === 'shared-server') {
        if (body.root === '/') return route.fulfill({ status: 403, json: { error: 'Permission denied' } });
        assert.equal(body.root, '/home/alex/thesis');
        assert.equal(body.canonical, false);
        return json({ root: body.root, page: 0, pages: 1, entries });
      }
      assert.equal(body.host, 'research-lab');
      browsed.push(body.root);
      const tree = { '/': ['data', 'home', 'restricted'], '/data': [], '/home': ['alex'], '/home/alex': ['thesis'], '/home/alex/thesis': entries };
      if (body.root === '/restricted') return route.fulfill({ status: 400, json: { error: 'Permission denied' } });
      if (body.root === '/') return json({ root: '/', page: body.page, pages: 2,
        entries: (body.page === 0 ? tree['/'] : ['work']).map(name => ({ name, folder: true })) });
      return json({ root: body.root, page: 0, pages: 1, entries: tree[body.root].map(item => typeof item === 'string' ? { name: item, folder: true } : item) });
    }
    if (url.endsWith('/connect')) {
      assert.equal(body.root, '/home/alex/thesis');
      assert.equal(body.port, undefined, 'reuse the SSH config port');
      folder = { ...body, id: 'sample', root: '/home/alex/thesis' }; saved = true;
      return json({ folder, entries });
    }
    if (url.endsWith('/list')) return json({ entries: body.path === 'sections' ? ['introduction.tex', 'methods.tex', 'results.tex'].map(name => ({ name, folder: false })) : entries });
    if (url.endsWith('/read')) { assert.equal(body.path, path); return json({ text, revision: String(revision) }); }
    if (url.endsWith('/save')) {
      if (failSave || body.revision !== String(revision)) return route.fulfill({ status: 409, json: { error: 'The remote file changed. Copy your edits before reloading.' } });
      assert.equal(body.path, path); text = body.text; return json({ revision: String(++revision) });
    }
    if (url.endsWith('/forget')) { saved = false; return json({ ok: true }); }
    throw new Error(url);
  });
  const entry = page.getByRole('button', { name: 'SSH remote folder', exact: true });
  const dialog = page.getByRole('dialog', { name: 'SSH remote folder', exact: true });
  try {
    await entry.click();
    await dialog.getByLabel('SSH host').fill('offline');
    await dialog.getByRole('button', { name: 'Preview remote folders', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('timed out');
    await expect(dialog.getByRole('button', { name: 'Use this folder' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByLabel('SSH host').fill('shared-server');
    await dialog.getByRole('button', { name: 'Preview remote folders' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Permission denied');
    const jump = dialog.getByText('Go to folder…', { exact: true });
    const confirm = dialog.getByRole('button', { name: 'Use this folder' });
    await expect(confirm).toBeDisabled();
    await jump.click();
    await dialog.getByRole('textbox', { name: 'Folder path' }).fill('/home/alex/thesis');
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(dialog.getByText('main.tex', { exact: true })).toBeVisible();
    await expect(confirm).toBeEnabled();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByLabel('SSH connection', { exact: true }).selectOption('config:research-lab');
    await dialog.getByRole('button', { name: 'Preview remote folders', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'home', exact: true })).toBeVisible();
    assert.equal(browsed.at(-1), '/');
    await dialog.getByRole('button', { name: 'Next page' }).click();
    await expect(dialog.getByRole('button', { name: 'work', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Previous page' }).click();
    await dialog.getByRole('button', { name: 'restricted', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Permission denied');
    await dialog.getByRole('button', { name: 'data', exact: true }).click();
    await expect(dialog.getByText('This folder is empty.')).toBeVisible();
    await dialog.getByRole('button', { name: '/', exact: true }).click();
    await dialog.getByRole('button', { name: 'home', exact: true }).click();
    await dialog.getByRole('button', { name: 'alex', exact: true }).click();
    await dialog.getByRole('button', { name: 'thesis', exact: true }).click();
    const preview = dialog.getByRole('list', { name: 'Folder contents' });
    await expect(preview.getByText('main.tex', { exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'main.tex', exact: true })).toHaveCount(0);
    await jump.click();
    await dialog.getByRole('textbox', { name: 'Folder path' }).fill('/unfinished');
    await expect(confirm).toBeDisabled();
    await jump.click();
    await expect(confirm).toBeEnabled();
    assert.equal(saved, false);
    await dialog.locator('section.modal').screenshot({ animations: 'disabled', path: 'test-results/ssh-folder-preview.png' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    await dialog.locator('section.modal').screenshot({ animations: 'disabled', path: 'test-results/ssh-folder-preview-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 850 }); await page.emulateMedia({ colorScheme: 'light' });
    await dialog.getByRole('button', { name: 'Use this folder' }).click();
    await dialog.getByRole('button', { name: 'sections', exact: true }).click();
    await dialog.getByRole('button', { name: 'introduction.tex', exact: true }).click();
    const editor = dialog.locator('.cm-content');
    await expect(editor).toContainText('Study design');
    await editor.press('Control+End');
    await editor.press('End');
    await editor.press('Enter');
    await page.keyboard.insertText('% Check the final measurements before submission.');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(dialog.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    assert.ok(text.includes('Check the final measurements'));
    await dialog.locator('section.modal').screenshot({ animations: 'disabled', path: 'test-results/ssh-remote-folder.png' });
    failSave = true;
    await page.keyboard.insertText(' Draft.');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Copy your edits');
    await expect(editor).toContainText('Draft.');
    page.once('dialog', prompt => prompt.dismiss());
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(editor).toContainText('Draft.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await dialog.locator('section.modal').screenshot({ animations: 'disabled', path: 'test-results/ssh-conflict-mobile.png' });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    page.once('dialog', prompt => prompt.accept());
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await entry.click();
    await dialog.getByLabel('SSH connection', { exact: true }).selectOption('sample');
    await dialog.getByRole('button', { name: 'Preview remote folders' }).click();
    await expect(dialog.getByRole('button', { name: 'home', exact: true })).toBeVisible();
    assert.equal(browsed.at(-1), '/', 'choosing another folder starts at root even for a saved connection');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Open saved folder' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Forget connection' }).click();
    await expect(dialog.getByLabel('SSH host')).toBeVisible();
    assert.equal(saved, false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  } finally {
    await page.unroute(match);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.emulateMedia({ colorScheme: 'light' });
  }
}
