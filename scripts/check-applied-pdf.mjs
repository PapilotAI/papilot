// Regression for unified full-PDF reviews (deferred and non-deferred tasks, plus manuscript Changes).
// Node >= 22.22; first build both frontends, then run:
// node --import tsx scripts/check-applied-pdf.mjs
// Uses the real app, review UI and PDF.js with fixture API responses. No agent
// or compiler is started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { annotateReviewState, rewriteReviewHtml } from '../src/server/review.ts';
import * as mupdf from 'mupdf';

fs.mkdirSync('test-results', { recursive: true });
const output = fs.mkdtempSync(path.resolve('test-results/issue-178-'));
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
let browser;
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  platform: process.platform, node: process.version,
  scope: 'Real frontend and PDF.js; fixture API simulates unified FullPaper review for deferred/non-deferred tasks and manuscript Changes. No live agent or compiler.',
  checks: [], errors: [], pdfRequests: [],
};
try {
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  report.browser = browser.version();
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const prefix = '/review/paper';
  const pdf = fs.readFileSync('tests/fixtures/outline.pdf');
  // A real replacement document: another page and a renamed bookmark, so
  // retaining the old reader cannot satisfy the update assertions.
  const replacement = new mupdf.PDFDocument(pdf);
  replacement.insertPage(-1, replacement.addPage([0, 0, 612, 792], 0, {}, ''));
  replacement.getTrailer().get('Root', 'Outlines', 'First').put('Title', replacement.newString('Updated introduction'));
  const bytes = replacement.saveToBuffer('');
  const revisedPdf = Buffer.from(bytes.asUint8Array());
  bytes.destroy(); replacement.destroy();
  const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
  const task = { id: 'issue-178', projectId: 'paper', agent: 'codex', name: 'issue-178', title: 'Revise the introduction', instructions: '', worktree: '/tmp/issue-178', deferred: true, status: 'running', createdAt: 1, updatedAt: 1, review: { state: 'editing', round: null, counts: {} } };
  const snapshot = { version: '0.10.4', csrf: 'fixture', projects: [{ id: 'paper', name: 'Issue 178 reproduction', path: '/tmp/issue-178', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
  const manuscript = { git: { branch: 'main', files: [] }, annotations: [], build: { status: 'ready', key: 'baseline', current: true, pages: [[612, 792], [612, 792]] } };
  const strip = (name, page = 1, top = 100) => ({ src: `${name}.svg`, clean: `${name}.svg`, width: 612, height: 35, page, label: String(page), top, left: 0, text: [{ chars: [{ text: `${name} paragraph`, rect: [60, 12, 250, 26] }] }] });
  const makeDetail = (round = 1, pdfUrl = `${prefix}/files/full-v1.pdf`) => ({
    task: task.name, round, before: 'before', after: 'after', warnings: [], files: `${prefix}/files/`, pdf: pdfUrl, loose: [],
    sections: [{
      node: 'intro', title: 'Introduction', number: '1', blocks: [
        { kind: 'change', units: ['edit'], identical: false, before: [strip('Original', 1, 100)], after: [strip('Revised', 1, 100)] },
        { kind: 'change', units: ['edit-2'], identical: false, before: [strip('Original-2', 1, 260)], after: [strip('Revised-2', 1, 260)] },
      ],
    }],
    units: [
      { id: 'edit', file: 'main.tex', status: 'modified', kind: 'text', whole_file: false, ops: [], old_start: 1, old_end: 1, new_start: 1, new_end: 1, old_text: 'Original paragraph', new_text: 'Revised paragraph', truncated: false },
      { id: 'edit-2', file: 'main.tex', status: 'modified', kind: 'text', whole_file: false, ops: [], old_start: 5, old_end: 5, new_start: 5, new_end: 5, old_text: 'Second paragraph', new_text: 'Updated second paragraph', truncated: false },
    ],
  });
  let detail = makeDetail(1, `${prefix}/files/full-v1.pdf`);
  let changesDetail = { ...makeDetail(1, `${prefix}/changes/pdf/1`), task: 'changes' };
  await page.addInitScript(() => {
    localStorage.setItem('papilot:task', '');
    localStorage.setItem('papilot:project', 'paper');
    localStorage.setItem('papilot:language', 'en');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
    if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (url.pathname === '/api/state') return json(snapshot);
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname.endsWith('/updates')) return json({ currentVersion: '0.10.4', phase: 'idle', canUpdate: false });
    if (url.pathname.endsWith('/indirect-changes')) return json({ indirectChanges: false });
    if (url.pathname.endsWith('/note-alternatives')) return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
    if (url.pathname.endsWith('/quick-notes')) return json({ quickNotes: null });
    if (url.pathname.endsWith('/predict')) return json({ ok: true });
    if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
    if (url.pathname.endsWith('/skills')) return json({ skills: [] });
    if (url.pathname.endsWith('/items')) return json({ items: [] });
    if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
    if (url.pathname.endsWith('/git')) return json(manuscript.git);
    if (url.pathname.endsWith('/manuscript')) return json(manuscript);
    if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
    if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.endsWith('/pdf')) {
      report.pdfRequests.push(url.pathname + url.search);
      if (url.searchParams.get('metadata') === '1') return json({ url: `${url.pathname}?round=${url.searchParams.get('round')}&build=fixture` });
      return route.fulfill({ contentType: 'application/pdf', body: pdf });
    }
    throw Error(`Unexpected app request: ${url.pathname}`);
  });
  await page.route('**/review/**', async route => {
    const url = new URL(route.request().url()), relative = url.pathname.slice(prefix.length);
    if (relative === '/') return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(fs.readFileSync('engine/dist/web/index.html', 'utf8'), prefix) });
    if (relative.startsWith('/assets/')) return route.fulfill({ path: path.resolve('engine/dist/web' + relative), contentType: /\.m?js$/.test(relative) ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    if (relative.endsWith('.pdf') || relative.startsWith('/changes/pdf/')) {
      report.pdfRequests.push(url.pathname + url.search);
      return route.fulfill({ contentType: 'application/pdf', body: relative.includes('full-v2') ? revisedPdf : pdf });
    }
    if (relative.startsWith('/files/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 35"><rect width="612" height="35" fill="white"/><text x="60" y="24" font-size="12">Revised paragraph.</text></svg>' });
    if (relative.startsWith('/api/changes/rounds/')) return route.fulfill({ json: changesDetail });
    if (relative.startsWith('/api/changes/state')) return route.fulfill({ json: { task: 'changes', title: 'Uncommitted changes', csrf: 'fixture', closed: false, state: 'reviewing', latest: 1, round: 1, revision: 'after', decisions: { edit: 'pending', 'edit-2': 'pending' }, comments: {}, undo: null, job: null } });
    if (/\/rounds\/\d+$/.test(relative)) return route.fulfill({ json: detail });
    if (relative.endsWith('/look')) return route.fulfill({ json: { ok: true } });
    if (relative.endsWith('/state')) return route.fulfill({ json: annotateReviewState({ task: task.name, title: task.title, csrf: 'fixture', closed: false, state: 'reviewing', latest: detail.round, history: [{ number: detail.round, created: 1 }], round: detail.round, revision: 'after', deferred: task.deferred, decisions: { edit: 'pending', 'edit-2': 'pending' }, comments: {}, undo: null, job: null }, [task]) });
    throw Error(`Unexpected review request: ${relative}`);
  });
  const sync = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const healthy = async (toolbar, label, pages = 2, first = 'Introduction') => {
    await expect(toolbar.locator('.pdf-pages')).toHaveText(`/ ${pages}`);
    await toolbar.getByRole('button', { name: 'Contents', exact: true }).click();
    const entries = toolbar.locator('.pdf-contents-menu [role="menuitemradio"]');
    await expect(entries).toHaveText([`${first}1`, 'Method2', 'Results2']);
    report.checks.push({ label, pageCount: await toolbar.locator('.pdf-pages').innerText(), bookmarks: await entries.allTextContents() });
    await entries.last().click();
    await expect(toolbar.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  };
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  const manuscriptBar = page.locator('.manuscript .pdf-toolbar');
  await healthy(manuscriptBar, 'Original manuscript');
  manuscript.build.key = 'updated';
  await sync();
  await expect.poll(() => report.pdfRequests.some(url => url.includes('key=updated'))).toBe(true);
  await healthy(manuscriptBar, 'Manuscript after replacement PDF load');
  await page.screenshot({ path: path.join(output, '01-manuscript-working.png') });

  // Manuscript keeps its PDF | Changes switch, and Changes displays uncommitted diffs directly on the full PDF.
  await manuscriptBar.locator('.pdf-modes').getByRole('button', { name: 'Changes', exact: true }).click();
  const manuscriptFrame = page.frameLocator('.manuscript .review-frame');
  await expect(manuscriptFrame.locator('.paper-page')).toHaveCount(2);
  await expect(manuscriptFrame.locator('.change.current')).toBeVisible();
  await expect(page.locator('.manuscript .review-host-bar .pdf-modes')).toBeVisible();
  await healthy(page.locator('.manuscript .review-host-bar'), 'Manuscript uncommitted Changes on FullPaper');
  await page.screenshot({ path: path.join(output, '02-manuscript-changes-full-pdf.png') });
  await page.locator('.manuscript .review-host-bar .pdf-modes').getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.manuscript .pdf-view')).toBeVisible();

  // Deferred task opens directly on FullPaper with changes in place and no PDF | Changes switch.
  task.status = 'reviewing'; task.review = { state: 'reviewing', round: 1, counts: { pending: 1 }, unsent: 0 }; task.updatedAt++;
  await sync();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  const frame = page.frameLocator('.review-frame');
  const reviewBar = page.locator('.review-host-bar');
  await expect(frame.locator('.paper-page')).toHaveCount(2);
  await expect(frame.locator('.change.current')).toBeVisible();
  await expect(reviewBar.locator('.pdf-modes')).toHaveCount(0);
  await expect(frame.locator('.view-switch')).toHaveCount(0);
  // Review decisions, change navigator and PDF controls share ONE top toolbar row,
  // and the change-map scrollbar remains visible in FullPaper.
  await expect(frame.locator('.change-map')).toBeVisible();
  await expect(frame.locator('.change-map-mark')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector('.review-host-bar').getBoundingClientRect();
    const frameEl = document.querySelector('.review-frame');
    const frameBox = frameEl.getBoundingClientRect();
    const bar = frameEl.contentDocument.querySelector('.bar').getBoundingClientRect();
    const barEnd = frameEl.contentDocument.querySelector('.bar .bar-end').getBoundingClientRect();
    const tools = document.querySelector('.review-tools').getBoundingClientRect();
    const nav = frameEl.contentDocument.querySelector('.bar .change-nav').getBoundingClientRect();
    const lead = document.querySelector('.review-lead').getBoundingClientRect();
    return Math.abs(host.height - 44) <= 2 &&
      Math.abs((frameBox.top + bar.bottom) - host.bottom) <= 2 &&
      frameBox.left + nav.left >= lead.right - 1 &&
      frameBox.left + barEnd.right <= tools.left + 1;
  })).toBe(true);
  await expect(frame.locator('.bar .change-nav-position')).toContainText('1 / 2');
  await expect(frame.getByRole('button', { name: 'Previous change', exact: true })).toBeDisabled();
  await frame.getByRole('button', { name: 'Next change', exact: true }).click();
  await expect(frame.locator('.change.current')).toHaveAttribute('data-stop', '1');
  await expect(frame.locator('.bar .change-nav-position')).toContainText('2 / 2');
  await expect(frame.getByRole('button', { name: 'Next change', exact: true })).toBeDisabled();
  await frame.getByRole('button', { name: 'Previous change', exact: true }).click();
  await expect(frame.locator('.change.current')).toHaveAttribute('data-stop', '0');
  await healthy(reviewBar, 'Deferred task opens directly in FullPaper');
  // Words outside the changes are selectable on the whole paper.
  const word = frame.locator('.paper-slice .textLayer span').filter({ hasText: /\w{3,}/ }).first();
  await word.scrollIntoViewIfNeeded();
  await word.dblclick();
  assert.match(await frame.locator('body').evaluate(() => getSelection()?.toString() ?? ''), /\w{3,}/, 'a word outside the changes can be selected');
  // A drag into the margin ends at the line's end instead of taking the rest of the page.
  const lineStart = frame.locator('.paper-slice .textLayer span').filter({ hasText: /Fixture/ }).first();
  const start = await lineStart.boundingBox(), sliceBox = await lineStart.locator('xpath=ancestor::div[contains(@class,"paper-slice")]').boundingBox();
  const y = Math.round(start.y + start.height / 2);
  await page.mouse.move(Math.round(start.x + 1), y);
  await page.mouse.down();
  await page.mouse.move(Math.round(sliceBox.x + sliceBox.width - 2), y, { steps: 8 });
  await page.mouse.up();
  const dragged = await frame.locator('body').evaluate(() => getSelection()?.toString() ?? '');
  assert.ok(dragged.includes('Fixture') && !dragged.includes('author reviews'), `a drag along the first line selects that line only: ${JSON.stringify(dragged)}`);
  await frame.locator('body').evaluate(() => getSelection()?.removeAllRanges());
  // While the complete PDF compiles, the toolbar says so beside the page count, not over the pages.
  const announce = preparing => page.evaluate(preparing => {
    const view = document.querySelector('.review-frame').contentWindow;
    view.dispatchEvent(new CustomEvent('papilot:review:pdf-reader-state', { detail: { pages: 2, page: 1, zoom: { value: 'page-width', scale: 1 }, outline: [], section: -1, ...(preparing ? { preparing: Date.now() - 26000 } : {}) } }));
  }, preparing);
  await announce(true);
  const compiling = reviewBar.getByRole('progressbar', { name: 'Preparing the full PDF…', exact: true });
  await expect(compiling).toBeVisible();
  await expect(compiling).toHaveAttribute('title', /Preparing the full PDF… 0:2\d/);
  await page.screenshot({ path: 'test-results/review-pdf-preparing.png' });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  // The phone layout opens the pages again, and their reader announces the complete PDF.
  await expect.poll(async () => { await announce(true); return compiling.isVisible(); }).toBe(true);
  await page.screenshot({ path: 'test-results/review-pdf-preparing-390.png' });
  await page.setViewportSize(size);
  await announce(false);
  await expect(compiling).toHaveCount(0);
  const chooseZoom = async label => {
    await reviewBar.getByRole('combobox', { name: 'Zoom', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const pageNumber = reviewBar.getByRole('textbox', { name: 'Page number', exact: true });
  const jump = async number => { await pageNumber.fill(String(number)); await pageNumber.press('Enter'); await expect(pageNumber).toHaveValue(String(number)); };
  await chooseZoom('125%');
  await expect.poll(() => frame.locator('.paper-page').first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(1020);
  await jump(1);
  await reviewBar.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(pageNumber).toHaveValue('2');
  await reviewBar.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(pageNumber).toHaveValue('1');
  await reviewBar.getByRole('button', { name: 'Find in PDF', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search the PDF', exact: true });
  await search.fill('Method');
  await expect(page.locator('.pdf-find-count')).toHaveText(/\d+ of [1-9]\d*/);
  await expect(frame.locator('.paper-find-mark.selected').first()).toBeVisible();
  // Find bar sits directly below the single-row toolbar without covering it.
  await expect.poll(() => page.evaluate(() => {
    const findBox = document.querySelector('.review-host-bar .pdf-find').getBoundingClientRect();
    const frameEl = document.querySelector('.review-frame');
    const bar = frameEl.contentDocument.querySelector('.bar').getBoundingClientRect();
    return findBox.top >= frameEl.getBoundingClientRect().top + bar.bottom - 1;
  })).toBe(true);
  // A newer round with a replacement PDF updates pages/bookmarks and replays the open search query.
  detail = makeDetail(2, `${prefix}/files/full-v2.pdf`);
  task.review = { state: 'reviewing', round: 2, counts: { pending: 1 }, unsent: 0 }; task.updatedAt++;
  await sync();
  await expect(frame.locator('.paper-page')).toHaveCount(3);
  await expect(search).toHaveValue('Method');
  await expect(page.locator('.pdf-find-count')).toHaveText(/\d+ of [1-9]\d*/);
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await healthy(reviewBar, 'Deferred FullPaper after replacement round PDF', 3, 'Updated introduction');
  await expect(reviewBar.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveText('125%');
  assert.ok(report.pdfRequests.some(url => url.endsWith('/full-v2.pdf')));
  await jump(3);
  await expect(reviewBar.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  // Returning to this task restores its place and reconnects navigation.
  await page.locator('.manuscript-link').click();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  await expect(frame.locator('.paper-page')).toHaveCount(3);
  await expect(pageNumber).toHaveValue('3');
  await healthy(reviewBar, 'Deferred FullPaper after reopening', 3, 'Updated introduction');
  await chooseZoom('Fit width');
  await page.screenshot({ path: path.join(output, '03-deferred-full-paper.png') });

  // Non-deferred FullPaper with diagnostics across desktop/mobile and light/dark themes.
  task.deferred = false;
  detail = { ...makeDetail(2, `${prefix}/files/full-v1.pdf`), revisedErrors: ['main.tex:12: Undefined control sequence.'] };
  await page.locator('.manuscript-link').click();
  await sync();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  await expect(frame.locator('.paper-page')).toHaveCount(2);
  await expect(reviewBar.locator('.pdf-modes')).toHaveCount(0);
  await healthy(reviewBar, 'Non-deferred FullPaper control with the same PDF');
  await page.screenshot({ path: path.join(output, '04-full-paper-working.png') });
  const summary = frame.locator('summary').filter({ hasText: 'This PDF has compilation errors.' });
  const diagnostics = frame.getByRole('region', { name: 'This PDF has compilation errors.' });
  await expect(summary).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(diagnostics).toHaveText(detail.revisedErrors[0]);
  for (const width of [1600, 390]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    if (width === 390) await page.getByRole('button', { name: /^Review(?:,|$)/ }).click();
    await expect(frame.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await diagnostics.scrollIntoViewIfNeeded();
    const bounds = await diagnostics.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: path.join(output, `05-full-reader-errors-${width}-${colorScheme}.png`) });
  }
  detail.revisedErrors = undefined;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  await expect(frame.locator('.paper-page')).toHaveCount(2);
  await expect(summary).toHaveCount(0);
  report.checks.push({ label: 'FullPaper static diagnostics support keyboard disclosure, desktop/mobile themes, and clear after repair' });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('PASS: Unified FullPaper review works for deferred/non-deferred tasks and manuscript Changes without PDF/Changes toggle.');
  console.log(`Evidence: ${output}`);
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await server.close();
}
