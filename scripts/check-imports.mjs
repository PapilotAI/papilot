import { checkSshFolder } from './check-ssh-folder.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { selectOption } from './select.mjs';
const server = Fastify(); await server.register(staticFiles, { root: path.resolve('dist') });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const state = { version: '0.6.0', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: { connected: true, authenticated: true, account: 'Owner', error: null, models: [] } };
const imported = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'My paper', path: '/papers/copied-paper', copied: true, candidates: ['main.tex', 'Thesis/src/chapters/appendices/supplement.tex', ...Array.from({ length: 14 }, (_, index) => `Thesis/src/chapters/chapter-${index + 1}.tex`)], main: 'main.tex', engine: 'pdflatex', phase: 'choose' };
const requests = [], errors = []; let draft = structuredClone(imported), result = 'failed', failure = 'fontspec needs XeLaTeX';
let linkResult = 'error', releaseLink, uploadCandidates = null;
fs.mkdirSync('test-results', { recursive: true });
await server.register(multipart, { limits: { fileSize: Infinity, files: Infinity, parts: Infinity } });
server.post('/api/imports/upload', async request => {
  const files = [];
  for await (const file of request.files()) files.push({ path: decodeURIComponent(file.filename), data: (await file.toBuffer()).toString('base64') });
  const body = request.query.archive === 'true' ? { zip: files[0].data } : { files };
  requests.push({ route: '/api/imports/upload', body });
  draft = structuredClone(imported); if (uploadCandidates) draft.candidates = uploadCandidates; return draft;
});
await server.listen({ host: '127.0.0.1', port: 0 });
try {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 850 } });
  // A browser on this computer gets the system picker; other devices browse in the page.
  let picker = { unavailable: true }, releasePicker = () => undefined, holdListing = false, releaseListing = () => undefined;
  const mockApi = async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname.startsWith('/api/imports')) {
      if (url.pathname === '/api/imports/upload') return route.continue();
      const body = method === 'POST' ? route.request().postDataJSON() : null;
      requests.push({ route: url.pathname, body });
      if (['/api/imports', '/api/imports/upload'].includes(url.pathname)) {
        if (body.url && linkResult === 'error') return route.fulfill({ status: 400, json: { error: 'No source was found at this link. Check the paper link and version.' } });
        if (body.url && linkResult === 'wait') await new Promise(resolve => { releaseLink = resolve; });
        draft = { ...structuredClone(imported), ...(body.path ? { path: body.path, copied: false } : {}) }; return route.fulfill({ json: draft });
      }
      if (url.pathname.endsWith('/build') || url.pathname.endsWith('/repair')) { Object.assign(draft, body, { phase: 'building', error: undefined }); if (url.pathname.endsWith('/repair')) { result = 'ready'; draft.summary = 'Fixed a missing package reference.'; } return route.fulfill({ json: draft }); }
      if (url.pathname.endsWith('/finish')) { const project = { id: 'paper', name: draft.name, path: draft.path, createdAt: 1 }; state.projects = [project]; return route.fulfill({ json: project }); }
      if (draft.phase === 'building') Object.assign(draft, { phase: result, versioned: true, error: result === 'failed' ? failure : undefined });
      return route.fulfill({ json: draft });
    }
    if (url.pathname === '/api/folders/choose') {
      requests.push({ route: url.pathname, body: route.request().postDataJSON() });
      // A picker nobody answers, such as one on another screen, keeps the request open.
      if (picker === 'wait') { await new Promise(resolve => { releasePicker = resolve; }); return route.fulfill({ json: { path: null } }).catch(() => undefined); }
      return route.fulfill({ json: picker });
    }
    if (url.pathname === '/api/folders') {
      // Folders on the computer running Papilot; unknown paths open the nearest listed folder.
      const tree = { '/': ['papers', 'Users'], '/Users': ['you'], '/Users/you': ['Downloads', 'papers'], '/Users/you/papers': ['large-local-paper', 'thesis'], '/Users/you/papers/large-local-paper': [], '/Users/you/papers/thesis': [], '/Users/you/Downloads': [], '/papers': ['large-local-paper'], '/papers/large-local-paper': [] };
      const body = route.request().postDataJSON(); requests.push({ route: url.pathname, body });
      if (holdListing) await new Promise(resolve => { releaseListing = resolve; });
      let current = body.path?.trim().replace(/(.)\/$/, '$1') || '/Users/you';
      while (!tree[current]) current = current.slice(0, current.lastIndexOf('/')) || '/';
      return route.fulfill({ json: { path: current, parent: current === '/' ? null : current.slice(0, current.lastIndexOf('/')) || '/', folders: tree[current].map(name => ({ name, path: (current === '/' ? '' : current) + '/' + name })) } });
    }
    if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname === '/api/updates') return route.fulfill({ json: { phase: 'idle', currentVersion: '0.6.0' } });
    if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
    if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { files: [] }, build: { status: 'failed', error: 'Fixture preview' }, annotations: [] } });
    if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [] } });
    return route.fulfill({ json: {} });
  };
  await context.route('**/api/**', mockApi);
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  await page.getByRole('button', { name: 'Import or open', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'New paper' }); await dialog.waitFor();
  await checkSshFolder(page);
  assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Import or open', exact: true }).first().click();
  assert.equal(await dialog.getByRole('heading', { name: 'Open existing folder' }).isVisible(), true);
  assert.deepEqual(await dialog.locator('.import-copy h3, .import-original h3').allTextContents(), ['Import a copy', 'Open existing folder']);
  // A browser can type the folder path or browse for it.
  assert.equal(await dialog.getByRole('textbox', { name: 'Folder path', exact: true }).isVisible(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Browse…', exact: true }).isVisible(), true);
  const [folderButton, zipButton] = await dialog.locator('.import-options button').evaluateAll(buttons => buttons.map(button => { const rect = button.getBoundingClientRect(); return { y: rect.y, height: rect.height }; }));
  assert.ok(Math.abs(folderButton.y - zipButton.y) < 1); assert.ok(folderButton.height <= 32 && zipButton.height <= 32);
  await dialog.screenshot({ animations: 'disabled', path: 'test-results/import-start.png' });
  // Link errors preserve the entered URL; retry uses the usual compile flow.
  const urlInput = dialog.getByRole('textbox', { name: 'Paper or repository link', exact: true });
  await urlInput.fill('https://arxiv.org/abs/1706.03762v7');
  await urlInput.press('Enter');
  await dialog.getByRole('alert').filter({ hasText: 'No source was found' }).waitFor();
  assert.equal(await urlInput.inputValue(), 'https://arxiv.org/abs/1706.03762v7');
  assert.equal(await urlInput.getAttribute('aria-invalid'), 'true');
  assert.equal(requests.filter(item => item.route.endsWith('/build')).length, 0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  const row = await dialog.locator('.import-link .import-path-row').evaluate(element => [...element.children].map(child => { const r = child.getBoundingClientRect(); return r.y + r.height / 2; }));
  assert.ok(Math.abs(row[0] - row[1]) < 1, 'Import stays beside the URL on a phone');
  assert.equal(await dialog.locator('.import-link-hint .brand-icon').count(), 3);
  await dialog.screenshot({ animations: 'disabled', path: 'test-results/import-link-error-mobile.png' });
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  linkResult = 'wait'; result = 'ready';
  await dialog.getByRole('button', { name: 'Import link', exact: true }).click();
  await dialog.getByText('Downloading paper source…', { exact: true }).waitFor();
  assert.equal(await urlInput.isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Import link', exact: true }).isDisabled(), true);
  await dialog.screenshot({ animations: 'disabled', path: 'test-results/import-link-loading-mobile.png' });
  releaseLink(); linkResult = 'ready';
  await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  // A browser-tab URL drag reaches the same importer, including the share hash.
  const uri = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.setData('text/uri-list', '# shared paper\r\nhttps://www.overleaf.com/read/abcdefgh#prefix'); return transfer; });
  await page.locator('.import-drop').dispatchEvent('drop', { dataTransfer: uri });
  await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
  assert.deepEqual(requests.filter(item => item.route === '/api/imports').at(-1).body, { url: 'https://www.overleaf.com/read/abcdefgh#prefix' });
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  await urlInput.fill('https://papers.example/source.tar.gz?download=1'); await urlInput.press('Enter');
  await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
  assert.deepEqual(requests.filter(item => item.route === '/api/imports').at(-1).body, { url: 'https://papers.example/source.tar.gz?download=1' });
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 850 }); await page.emulateMedia({ colorScheme: 'light' }); result = 'failed';
  const transfer = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['fixture zip bytes'], 'paper.zip', { type: 'application/zip' })); return transfer; });
  await page.locator('.import-drop').dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('combobox', { name: 'Main TeX file', exact: true }).waitFor().catch(async error => { console.log(requests, errors, await dialog.innerText()); throw error; });
  assert.equal(requests.filter(item => item.body?.zip).at(-1).body.zip, Buffer.from('fixture zip bytes').toString('base64'));
  await page.getByText('The paper needs a little help').waitFor(); await page.getByText('This paper may need XeLaTeX. Change the engine below and retry.').waitFor();
  await page.getByRole('button', { name: 'Continue later' }).click();
  await page.getByRole('button', { name: 'Import or open', exact: true }).first().click();
  await page.getByText('The paper needs a little help').waitFor();
  await selectOption(page.getByRole('combobox', { name: 'LaTeX engine', exact: true }), 'xelatex');
  await page.setViewportSize({ width: 360, height: 740 }); await page.emulateMedia({ colorScheme: 'dark' });
  await dialog.screenshot({ animations: 'disabled', path: 'test-results/import-failure-mobile.png' });
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.getByRole('button', { name: 'Help fix compilation' }).click();
  await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
  await page.getByText('Fixed a missing package reference.').waitFor();
  await dialog.getByRole('button', { name: 'Open paper', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(state.projects.length, 1);
  await page.setViewportSize({ width: 1280, height: 850 }); await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Paper: My paper', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: /^(Open paper…|Import from link…)$/ }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Import or open', exact: true }).count(), 1);
  await page.getByRole('menuitem', { name: 'Import or open', exact: true }).click();
  // Dismissing a native file picker fires a bubbling `cancel` at its input; only the dialog's own cancel (Escape) closes it.
  for (const input of ['input[webkitdirectory]', 'input[accept^=".zip"]']) {
    await page.locator(input).dispatchEvent('cancel');
    assert.equal(await page.getByRole('dialog', { name: 'New paper', exact: true }).isVisible(), true, `${input} cancel closed the dialog`);
  }
  // Browser folder input preserves relative file names, including binary assets.
  const temp = fs.mkdtempSync('/tmp/papilot-ui-import-');
  try {
    for (const name of ['a"b.tex', 'a%22b.tex', '论文.tex']) fs.writeFileSync(path.join(temp, name), 'asset');
    fs.writeFileSync(path.join(temp, 'main.tex'), 'source'); fs.writeFileSync(path.join(temp, 'figure.png'), Buffer.from([0, 255, 32]));
    // A detected main file is the only candidate the server sends, so it stays editable.
    uploadCandidates = ['main.tex'];
    await page.locator('input[webkitdirectory]').setInputFiles(temp);
    const detectedMain = page.getByRole('textbox', { name: 'Main TeX file', exact: true }); await detectedMain.waitFor();
    assert.equal(await detectedMain.inputValue(), 'main.tex');
    assert.equal(await page.getByRole('combobox', { name: 'Main TeX file', exact: true }).count(), 0);
    uploadCandidates = null;
    const uploaded = requests.filter(request => request.route === '/api/imports/upload').at(-1).body.files;
    for (const name of ['a"b.tex', 'a%22b.tex', '论文.tex']) assert.ok(uploaded.some(file => file.path.endsWith('/' + name)), name);
    assert.ok(uploaded.some(file => file.path.endsWith('/main.tex'))); assert.ok(uploaded.some(file => file.data === Buffer.from([0, 255, 32]).toString('base64')));
    await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
    await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
    fs.mkdirSync(path.join(temp, 'nested'));
    for (let index = 0; index < 120; index++) fs.writeFileSync(path.join(temp, 'nested', `${index}.txt`), 'asset');
    const dropBox = await page.locator('.import-drop').boundingBox(), cdp = await context.newCDPSession(page);
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: dropBox.x + 20, y: dropBox.y + 20, data: { items: [], files: [temp], dragOperationsMask: 1 } });
    await page.getByRole('combobox', { name: 'Main TeX file', exact: true }).waitFor();
    const dropped = requests.filter(request => request.route === '/api/imports/upload').at(-1).body.files;
    assert.equal(dropped.length, 125, 'Folder drops read all directory batches');
    assert.ok(dropped.some(file => file.path.endsWith('/nested/119.txt')));
    assert.ok(dropped.some(file => file.data === Buffer.from([0, 255, 32]).toString('base64')));
    await cdp.detach();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  await page.getByText('Your paper compiled successfully. It is ready for editing.').waitFor();
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  const builds = requests.filter(request => request.route.endsWith('/build')).length;
  const browse = page.getByRole('button', { name: 'Browse…', exact: true }), field = page.getByRole('textbox', { name: 'Folder path', exact: true });
  const opened = () => requests.filter(request => request.route === '/api/imports').length;
  // A typed path opens directly.
  await field.fill('/papers/typed-paper'); await page.getByRole('button', { name: 'Open', exact: true }).click();
  const main = page.getByRole('combobox', { name: 'Main TeX file', exact: true }); await main.waitFor();
  assert.deepEqual(requests.filter(request => request.route === '/api/imports').at(-1).body, { path: '/papers/typed-paper' });
  // Main files use the app's themed list, showing nested paths as file name and folder.
  await main.click(); await page.getByRole('option', { name: /supplement\.tex/ }).waitFor();
  // A long list scrolls without squeezing two-line options together.
  assert.deepEqual(await page.locator('.select-option').evaluateAll(options => options.filter(option => option.scrollHeight > option.clientHeight + 1).map(option => option.textContent)), []);
  await page.getByRole('dialog', { name: 'New paper' }).screenshot({ animations: 'disabled', path: 'test-results/import-main-file.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'New paper' }).isVisible(), true, 'Escape closes only the file list');
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  // Other devices browse folders on the Papilot computer below the field, which follows along.
  await field.fill('');
  await browse.click();
  await page.waitForFunction(() => document.querySelector('.folder-field-browse')?.getAttribute('aria-expanded') === 'true');
  await page.getByRole('list', { name: '/Users/you' }).getByRole('button', { name: 'papers', exact: true }).click();
  await page.getByRole('list', { name: '/Users/you/papers' }).getByRole('button', { name: 'large-local-paper', exact: true }).click();
  await page.getByText('No folders inside.', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), '/Users/you/papers/large-local-paper');
  await page.waitForFunction(() => document.activeElement?.classList.contains('folder-browser-current'), undefined, { timeout: 2000 });
  await page.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await page.getByRole('button', { name: 'thesis', exact: true }).waitFor();
  assert.equal(await field.inputValue(), '/Users/you/papers');
  await page.getByRole('dialog', { name: 'New paper' }).screenshot({ animations: 'disabled', path: 'test-results/import-browse-folders.png' });
  // Escape closes only the folder list and returns to the field.
  await page.keyboard.press('Escape');
  await page.getByText('Folders on the computer running Papilot', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('dialog', { name: 'New paper' }).isVisible(), true);
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'path');
  // A path typed while the list loads is kept, and the field keeps focus.
  holdListing = true; await field.fill(''); await browse.click();
  await page.getByText('Loading folders…', { exact: true }).waitFor();
  await field.fill('/papers/typed-during-listing');
  holdListing = false; releaseListing();
  await page.getByRole('list', { name: '/Users/you' }).waitFor();
  assert.equal(await field.inputValue(), '/papers/typed-during-listing');
  assert.equal(await field.evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Folders on the computer running Papilot', { exact: true }).waitFor({ state: 'detached' });
  await browse.click();
  await page.getByRole('button', { name: 'large-local-paper', exact: true }).click();
  await page.getByText('No folders inside.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open this folder', exact: true }).click();
  await page.getByRole('combobox', { name: 'Main TeX file', exact: true }).waitFor();
  assert.deepEqual(requests.filter(request => request.route === '/api/imports').at(-1).body, { path: '/papers/large-local-paper' });
  await page.getByRole('button', { name: 'Choose different files', exact: true }).click();
  // A browser on this computer uses the system picker; cancelling it changes nothing.
  picker = { path: null }; let before = opened();
  await browse.click();
  await page.waitForFunction(() => !document.querySelector('.folder-field-browse[aria-busy]'));
  assert.equal(opened(), before); assert.equal(await page.getByText('Folders on the computer running Papilot').count(), 0);
  // Typing while the picker is open stops waiting for it, so a late choice is ignored.
  picker = 'wait'; before = opened();
  await browse.click();
  await page.waitForFunction(() => document.querySelector('.folder-field-browse')?.getAttribute('aria-busy') === 'true');
  assert.equal(await page.getByRole('dialog', { name: 'New paper' }).locator('.spinner').count(), 0, 'Waiting for the picker shows no spinner');
  await page.getByRole('dialog', { name: 'New paper' }).screenshot({ animations: 'disabled', path: 'test-results/import-picker-wait.png' });
  await field.fill('/papers/typed');
  await page.waitForFunction(() => !document.querySelector('.folder-field-browse[aria-busy]'));
  releasePicker(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(opened(), before);
  // A folder chosen in the system picker opens directly.
  picker = { path: '/papers/large-local-paper' };
  await browse.click();
  assert.deepEqual(requests.filter(request => request.route === '/api/folders/choose').at(-1).body, { title: 'Open existing folder', path: '/papers/typed' });
  await page.getByRole('combobox', { name: 'Main TeX file', exact: true }).waitFor();
  assert.deepEqual(requests.filter(request => request.route === '/api/imports').at(-1).body, { path: '/papers/large-local-paper' });
  assert.equal(requests.filter(request => request.route.endsWith('/build')).length, builds, 'Local folder selection only inspects the paper');
  result = 'failed'; failure = 'spawnSync /usr/bin/git ENOBUFS';
  await page.getByRole('button', { name: 'Prepare and compile', exact: true }).click();
  await page.getByText('Could not prepare the paper', { exact: true }).waitFor();
  assert.equal(await page.getByText('The paper needs a little help', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Help fix compilation', exact: true }).count(), 0);
  // Electron's unified Import entry opens the same link/ZIP/folder dialog.
  await context.addInitScript(() => { window.fixturePickerCalls = 0; window.papilotDesktop = { platform: 'darwin', chooseDirectory: () => new Promise((resolve, reject) => { window.fixturePickerCalls++; window.fixtureResolvePicker = resolve; window.fixtureRejectPicker = () => reject(new Error('Folder picker unavailable.')); }), minimize() {}, maximize() {}, close() {} }; });
  await page.getByRole('button', { name: 'Continue later' }).click();
  await page.evaluate(() => localStorage.removeItem('papilot:paper-import'));
  await page.reload();
  await page.getByRole('button', { name: 'Paper: My paper', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import or open', exact: true }).click();
  await page.getByRole('dialog', { name: 'New paper' }).getByRole('textbox', { name: 'Paper or repository link', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixturePickerCalls), 0, 'Import opens without invoking the native picker');
  await dialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Choose folder…', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.fixtureRejectPicker());
  await dialog.getByRole('alert').filter({ hasText: 'Folder picker unavailable.' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('[data-choose-folder]'));
  const beforeCancel = requests.length;
  await dialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  await page.evaluate(() => window.fixtureResolvePicker(null));
  await dialog.getByRole('status').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-choose-folder]'));
  assert.equal(await dialog.isVisible(), true, 'Canceling the picker keeps Import open');
  assert.equal(await dialog.getByRole('alert').count(), 0, 'Retry clears the picker error');
  assert.equal(requests.length, beforeCancel, 'Canceling the picker sends no import request');
  const touchContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' });
  await touchContext.route('**/api/**', mockApi);
  try {
    const phone = await touchContext.newPage(); await phone.goto(`http://127.0.0.1:${server.server.address().port}`);
    await phone.getByRole('button', { name: '显示任务列表', exact: true }).click();
    await phone.getByRole('button', { name: '论文：My paper', exact: true }).click();
    await phone.getByRole('menuitem', { name: '导入或打开', exact: true }).click();
    const phoneDialog = phone.getByRole('dialog', { name: '新建论文', exact: true }), input = phoneDialog.getByRole('textbox', { name: '论文或仓库链接', exact: true });
    await input.waitFor();
    await phoneDialog.screenshot({ animations: 'disabled', path: 'test-results/import-link-touch-zh.png' });
    const dimensions = await input.evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height, coarse: matchMedia('(pointer: coarse)').matches }));
    assert.equal(dimensions.coarse, true); assert.ok(dimensions.size >= 16); assert.ok(dimensions.height >= 48, JSON.stringify(dimensions));
    assert.ok((await phoneDialog.getByRole('button', { name: '导入链接', exact: true }).boundingBox()).height >= 48);
    // Every source choice is a touch-sized target; later import phases keep their compact layout.
    const choices = await phoneDialog.locator(':is(.import-copy, .import-original) .button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    assert.ok(choices.length >= 4 && choices.every(height => height >= 44), JSON.stringify(choices));
    const field = await phoneDialog.locator('.folder-field').boundingBox(); assert.ok(field.height >= 44, JSON.stringify(field));
    picker = { unavailable: true };
    await phoneDialog.getByRole('button', { name: '浏览…', exact: true }).click();
    await phoneDialog.getByRole('button', { name: 'papers', exact: true }).click();
    await phoneDialog.getByRole('button', { name: 'thesis', exact: true }).waitFor();
    await phoneDialog.getByRole('button', { name: '打开此文件夹', exact: true }).scrollIntoViewIfNeeded();
    await phone.screenshot({ animations: 'disabled', path: 'test-results/import-browse-touch-zh.png' });
    const rows = await phoneDialog.locator('.folder-browser button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    assert.ok(rows.length >= 3 && rows.every(height => height >= 44), JSON.stringify(rows));
    assert.equal(await phoneDialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  } finally { await touchContext.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: link paste/drop, loading, error/retry, Electron entry, local folder path, ZIP drop, folder upload, main selection, failed compile, resume, assistant repair, mobile layout and opening paper');
} finally { await browser.close(); await server.close(); }
