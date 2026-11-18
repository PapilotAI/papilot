// Regression for https://github.com/PapilotAI/papilot/issues/178.
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
  scope: 'Real frontend and PDF.js; fixture API simulates agent completion and a replacement PDF build. No live agent, compiler or Windows environment.',
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
  const taller = new mupdf.PDFDocument(pdf);
  for (let index = 0; index < taller.countPages(); index++) {
    taller.findPage(index).put('MediaBox', [0, 0, 612, 1200]);
    taller.findPage(index).put('CropBox', [0, 0, 612, 1200]);
  }
  const tallerBytes = taller.saveToBuffer(''), tallerPdf = Buffer.from(tallerBytes.asUint8Array());
  tallerBytes.destroy(); taller.destroy();
  const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
  const task = { id: 'issue-178', projectId: 'paper', agent: 'codex', name: 'issue-178', title: 'Revise the introduction', instructions: '', worktree: '/tmp/issue-178', deferred: true, status: 'running', createdAt: 1, updatedAt: 1, review: { state: 'editing', round: null, counts: {} } };
  const snapshot = { version: '0.10.4', csrf: 'fixture', projects: [{ id: 'paper', name: 'Issue 178 reproduction', path: '/tmp/issue-178', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
  const manuscript = { git: { branch: 'main', files: [] }, annotations: [], build: { status: 'ready', key: 'baseline', current: true, pages: [[612, 792], [612, 792]] } };
  const strip = name => ({ src: `${name}.svg`, clean: `${name}.svg`, width: 612, height: 35, page: 1, label: '1', top: 100, left: 0, text: [{ chars: [{ text: `${name} paragraph`, rect: [60, 12, 250, 26] }] }] });
  const detail = { task: task.name, round: 1, before: 'before', after: 'after', warnings: [], files: `${prefix}/files/`, pdf: `${prefix}/files/full.pdf`, loose: [],
    sections: [{ node: 'intro', title: 'Introduction', number: '1', blocks: [{ kind: 'change', units: ['edit'], identical: false, before: [strip('Original')], after: [strip('Revised')] }] }],
    units: [{ id: 'edit', file: 'main.tex', status: 'modified', kind: 'text', whole_file: false, ops: [], old_start: 1, old_end: 1, new_start: 1, new_end: 1, old_text: 'Original paragraph', new_text: 'Revised paragraph', truncated: false }] };
  let appliedKey = 'applied-v1';
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
      return route.fulfill({ contentType: 'application/pdf', body: pdf });
    }
    throw Error(`Unexpected app request: ${url.pathname}`);
  });
  await page.route('**/review/**', async route => {
    const url = new URL(route.request().url()), relative = url.pathname.slice(prefix.length);
    if (relative === '/') return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(fs.readFileSync('engine/dist/web/index.html', 'utf8'), prefix) });
    if (relative.startsWith('/assets/')) return route.fulfill({ path: path.resolve('engine/dist/web' + relative), contentType: /\.m?js$/.test(relative) ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    if (relative.endsWith('.pdf')) {
      report.pdfRequests.push(url.pathname + url.search);
      return route.fulfill({ contentType: 'application/pdf', body: relative.includes('applied-tall') ? tallerPdf : relative.includes('applied-v2') ? revisedPdf : pdf });
    }
    if (relative.startsWith('/files/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 35"><rect width="612" height="35" fill="white"/><text x="60" y="24" font-size="12">Revised paragraph.</text></svg>' });
    if (/\/rounds\/\d+$/.test(relative)) return route.fulfill({ json: detail });
    if (relative.endsWith('/applied')) return route.fulfill({ json: { accepted: 'accepted', building: false, shown: { accepted: 'accepted', key: appliedKey, targets: ['main'], round: 1, at: 1, current: true, pdf: `${prefix}/applied/${task.name}/${appliedKey}.pdf` } } });
    if (relative.endsWith('/look')) return route.fulfill({ json: { ok: true } });
    if (relative.endsWith('/state')) return route.fulfill({ json: annotateReviewState({ task: task.name, title: task.title, csrf: 'fixture', closed: false, state: 'reviewing', latest: 1, history: [{ number: 1, created: 1 }], round: 1, revision: 'after', deferred: task.deferred, decisions: { edit: 'pending' }, comments: {}, undo: null, job: null }, [task]) });
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

  task.status = 'reviewing'; task.review = { state: 'reviewing', round: 1, counts: { pending: 1 }, unsent: 0 }; task.updatedAt++;
  await sync();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  const frame = page.frameLocator('.review-frame');
  await expect(frame.locator('.change.current')).toBeVisible();
  await page.locator('.review-host-bar').getByRole('button', { name: 'PDF', exact: true }).click();
  const reviewBar = page.locator('.review-host-bar');
  const readable = async (pages = 2) => {
    await expect(frame.locator('.applied-paper')).toHaveAttribute('data-build', appliedKey);
    await expect(frame.locator('.applied-page')).toHaveCount(pages);
    await expect(frame.locator('.applied-page canvas').first()).toBeVisible();
    await expect(frame.locator('.applied-page .pdf-glyph').first()).toBeVisible();
  };
  const chooseZoom = async label => {
    await reviewBar.getByRole('combobox', { name: 'Zoom', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const pageNumber = reviewBar.getByRole('textbox', { name: 'Page number', exact: true });
  const jump = async number => { await pageNumber.fill(String(number)); await pageNumber.press('Enter'); await expect(pageNumber).toHaveValue(String(number)); };
  await readable();
  await healthy(reviewBar, 'AppliedPaper initial PDF');
  await chooseZoom('125%');
  await expect.poll(() => frame.locator('.applied-page').first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(1020);
  await expect.poll(() => frame.locator('.applied-page canvas').first().evaluate(el => el.width)).toBe(1020);
  await jump(1);
  await reviewBar.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(pageNumber).toHaveValue('2');
  await reviewBar.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(pageNumber).toHaveValue('1');
  await jump(2);
  await frame.locator('#paper').evaluate(root => {
    const sheet = root.querySelector('.applied-page[data-index="1"]');
    root.scrollTop += sheet.getBoundingClientRect().top - root.getBoundingClientRect().top + 180;
  });
  const offset = () => frame.locator('#paper').evaluate(root => Math.round(root.querySelector('.applied-page[data-index="1"]').getBoundingClientRect().top - root.getBoundingClientRect().top));
  await expect.poll(offset).toBe(-180);
  appliedKey = 'applied-v1b';
  await readable();
  await expect(pageNumber).toHaveValue('2');
  await expect.poll(offset).toBe(-180);
  await expect(reviewBar.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveText('125%');
  // Preserve the fractional place on page two when preceding pages also grow.
  // Reading the DOM during effect cleanup sees the new geometry too late.
  appliedKey = 'applied-tall';
  await readable();
  await expect(pageNumber).toHaveValue('2');
  await expect.poll(async () => Math.abs(await offset() + 180 * 1200 / 792)).toBeLessThan(2);
  appliedKey = 'applied-v1c';
  await readable();
  await expect(pageNumber).toHaveValue('2');
  await expect.poll(async () => Math.abs(await offset() + 180)).toBeLessThan(2);
  await reviewBar.getByRole('button', { name: 'Find in PDF', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search the PDF', exact: true });
  await search.fill('review');
  await expect(page.locator('.pdf-find-count')).toHaveText(/\d+ of [1-9]\d*/);
  await expect(frame.locator('.paper-find-mark.selected').first()).toBeVisible();
  // Replacing the PDF replays an open query into the new reader.
  appliedKey = 'applied-v2';
  await readable(3);
  await expect(search).toHaveValue('review');
  await expect(page.locator('.pdf-find-count')).toHaveText(/\d+ of [1-9]\d*/);
  await expect(frame.locator('.paper-find-mark.selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await healthy(reviewBar, 'AppliedPaper after replacement PDF', 3, 'Updated introduction');
  await expect(reviewBar.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveText('125%');
  assert.ok(report.pdfRequests.some(url => url.endsWith('/applied-v2.pdf')));
  await jump(3);
  await expect(reviewBar.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  // Returning to this task restores its place and reconnects navigation.
  await page.locator('.manuscript-link').click();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  await readable(3);
  await expect(pageNumber).toHaveValue('3');
  await healthy(reviewBar, 'AppliedPaper after reopening', 3, 'Updated introduction');
  await chooseZoom('Fit width');
  await reviewBar.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.screenshot({ path: path.join(output, '02-applied-pdf-working.png') });
  await page.keyboard.press('Escape');

  // The same PDF through FullPaper has its bookmarks and page count. This
  // isolates the failure to AppliedPaper, independently of PDF contents.
  task.deferred = false;
  await page.locator('.manuscript-link').click();
  await sync();
  await page.locator('.task-link').filter({ hasText: task.title }).click();
  await expect(frame.locator('.paper-page')).toHaveCount(2);
  await healthy(reviewBar, 'Non-deferred FullPaper control with the same PDF');
  await page.screenshot({ path: path.join(output, '04-full-paper-working.png') });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('PASS: Applied PDF contents, page count, navigation, zoom, search, replacement and reopening; manuscript and FullPaper controls.');
  console.log(`Evidence: ${output}`);
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await server.close();
}
