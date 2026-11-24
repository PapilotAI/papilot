// Built UI and PDF.js, deterministic fixtures, no model calls. Checked
// citations show in the paper's PDF as a bar beside each sentence, one
// segment per cited work, worst first; its card gives the verdicts and
// quotes, closes with Escape or a click outside, and a quote opens the cited
// work's PDF at its lines in the Library. Desktop and phone widths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const pdf = fs.readFileSync('tests/fixtures/outline.pdf');
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const manuscript = { annotations: [], git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'pdf', current: true } };
const line = index => { const [, x, y, height, width] = words[0].words[index]; return [x / 612, (y - height) / 792, Math.min(1, (x + width * 6) / 612), y / 792]; };
const quote = { quote: 'TeX breaks paragraphs into lines with a total-fit algorithm.', page: 1, marks: [{ page: 1, rect: [0.1, 0.1, 0.9, 0.16] }] };
const finding = (key, verdict, extra = {}) => ({ key, entry: `refs.bib#${key}`, title: key === 'knuth' ? 'The TeXbook' : 'Linear types can change the world!', hash: 'a'.repeat(64), verdict, note: `Why ${verdict}.`, evidence: verdict === 'unclear' ? [] : [quote], pdf: 'a'.repeat(64), checkedAt: 1, ...extra });
const marks = [
  { id: 's1', page: 0, rects: [line(2)], sentence: 'TeX breaks paragraphs optimally [knuth].', file: 'main.tex', line: 3, findings: [finding('knuth', 'supported', { by: 'DeepSeek V4.1 Flash UltraFast' })] },
  { id: 's2', page: 0, rects: [line(13)], sentence: 'Linear values can be updated in place [wadler, knuth].', file: 'main.tex', line: 4, findings: [finding('knuth', 'supported'), finding('wadler', 'unsupported', { by: 'DeepSeek V4.1 Flash UltraFast' })] },
];
const report = {
  bibs: ['refs.bib'], absent: [], missing: [], duplicates: [], similar: [], all_cited: false, checks: {}, pending: 0, confirmed: {}, quickCheck: null, autoCheck: false,
  entries: ['knuth', 'wadler'].map(key => ({ id: `refs.bib#${key}`, file: 'refs.bib', key, type: 'article', fields: [{ name: 'title', value: key === 'knuth' ? 'The TeXbook' : 'Linear types can change the world!' }, { name: 'author', value: key === 'knuth' ? 'Donald E. Knuth' : 'Philip Wadler' }, { name: 'year', value: '1990' }], lines: [1, 5], cited: [{ file: 'main.tex', line: 3, section: null }] })),
  library: { pending: 0, entries: { 'refs.bib#knuth': { pdf: { hash: 'a'.repeat(64), source: 'author', pages: 1, text: 'ready' }, find: null, landing: null }, 'refs.bib#wadler': { pdf: { hash: 'a'.repeat(64), source: 'author', pages: 1, text: 'ready' }, find: null, landing: null } } },
  citations: [],
};
const evidenceRequests = [];
const errors = [];
async function run(viewport, name) {
  const phone = viewport.width < 600, page = await browser.newPage({ locale: 'en-US', viewport, hasTouch: phone, isMobile: phone });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('papilot:task', ''); localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
    if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (url.pathname === '/api/state') return json(snapshot);
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname.endsWith('/updates')) return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
    if (url.pathname.endsWith('/indirect-changes')) return json({ indirectChanges: false });
    if (url.pathname.endsWith('/note-alternatives')) return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
    if (url.pathname.endsWith('/quick-notes')) return json({ quickNotes: null });
    if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
    if (url.pathname.endsWith('/skills')) return json({ skills: [] });
    if (url.pathname.endsWith('/git')) return json(manuscript.git);
    if (url.pathname.endsWith('/manuscript')) return json(manuscript);
    if (url.pathname.endsWith('/manuscript/evidence')) { evidenceRequests.push(url.searchParams.get('key')); return json({ key: url.searchParams.get('key'), marks, running: false }); }
    if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
    if (url.pathname.endsWith('/library')) return json(report);
    if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.includes('/library/pdfs/')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
    return json({});
  });
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  const tags = page.locator('.manuscript .evidence-tag');
  await expect(tags).toHaveCount(2);
  assert.equal(evidenceRequests.at(-1), 'pdf', 'marks belong to the build on screen');
  // The second sentence cites two works: its bar has a segment for each, worst first.
  assert.deepEqual(await tags.nth(1).locator('span').evaluateAll(spans => spans.map(span => span.dataset.verdict)), ['unsupported', 'supported']);
  await expect(tags.nth(1)).toHaveAttribute('aria-label', 'Citation check: wadler Not supported, knuth Supported');
  const box = await tags.nth(1).boundingBox();
  assert.ok(box.width >= (phone ? 24 : 14) && box.height >= 6, 'the bar can be clicked or tapped');
  const press = locator => phone ? locator.tap() : locator.click();
  await press(tags.nth(1));
  const card = page.getByRole('dialog', { name: 'Citation check' });
  await expect(card).toBeVisible();
  await expect(card.locator('.evidence-card-verdict strong')).toHaveText(['Not supported', 'Supported']);
  await expect(card.getByText('Quick check by DeepSeek V4.1 Flash UltraFast')).toBeVisible();
  await expect(card.getByText('Checked by an agent')).toBeVisible();
  await expect(page.locator('.evidence-sentence')).toHaveCount(1);
  const inside = await card.boundingBox(), pageBox = await page.locator('.manuscript .page').first().boundingBox();
  assert.ok(inside.x >= pageBox.x - 1 && inside.x + inside.width <= pageBox.x + pageBox.width + 1, 'the card stays on the page');
  await page.screenshot({ path: `test-results/evidence-card-${name}.png`, animations: 'disabled' });
  // Escape closes it and focus returns to the bar; so does a click outside.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  assert.ok(await tags.nth(1).evaluate(element => element === document.activeElement), 'focus returns to the bar');
  await press(tags.nth(0));
  await expect(card).toBeVisible();
  if (phone) await page.touchscreen.tap(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 20); else await page.mouse.click(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 20);
  await expect(card).toHaveCount(0);
  // A quote opens the cited work's PDF at its lines in the Library.
  await press(tags.nth(1));
  await press(card.locator('.evidence-card-quote').first());
  await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
  await expect(page.locator('.library-reader .source-mark').first()).toBeVisible();
  await page.screenshot({ path: `test-results/evidence-quote-${name}.png`, animations: 'disabled' });
  await page.close();
}
try {
  await run({ width: 1280, height: 860 }, 'desktop');
  await run({ width: 390, height: 844 }, 'phone');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
