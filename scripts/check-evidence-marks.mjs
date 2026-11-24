// Built UI and PDF.js, deterministic fixtures, no model calls. Checked
// citations show in the paper's PDF as one bar per paragraph, a segment per
// citation in reading order; a sentence citing nothing that a library work
// supports shows a dashed segment. The card gives verdicts and quotes, closes
// with Escape or a click outside, and a quote opens the cited work's PDF at
// its lines in the Library. There, the other way round, the passage the
// paper relies on has its own bar, whose card goes back to the paper's
// sentence. A suggestion becomes a task draft, or is dismissed. Desktop and
// phone widths.
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
const hash = 'a'.repeat(64);
const quote = { quote: 'TeX breaks paragraphs into lines with a total-fit algorithm.', page: 1, marks: [{ page: 1, rect: [0.1, 0.1, 0.9, 0.16] }] };
const finding = (key, verdict, extra = {}) => ({ key, entry: `refs.bib#${key}`, title: key === 'knuth' ? 'The TeXbook' : 'Linear types can change the world!', hash, verdict, note: `Why ${verdict}.`, evidence: verdict === 'unclear' ? [] : [quote], pdf: hash, checkedAt: 1, ...extra });
const suggestion = { id: 'u1', file: 'main.tex', line: 9, section: null, sentence: 'Paragraphs are broken into lines optimally.', key: 'knuth', verdict: 'supported', note: 'The book gives the algorithm.', evidence: [quote], pdf: hash, checkedAt: 1, by: 'DeepSeek V4.1 Flash UltraFast' };
let marks;
const reset = () => { marks = [
  // Two sentences on touching lines: one paragraph, one bar.
  { id: 's1', page: 0, rects: [line(2)], sentence: 'TeX breaks paragraphs optimally [knuth].', file: 'main.tex', line: 3, findings: [finding('knuth', 'supported', { by: 'DeepSeek V4.1 Flash UltraFast' })] },
  { id: 's2', page: 0, rects: [line(13)], sentence: 'Linear values can be updated in place [wadler, knuth].', file: 'main.tex', line: 4, findings: [finding('wadler', 'unsupported', { by: 'DeepSeek V4.1 Flash UltraFast' }), finding('knuth', 'supported')] },
  // A sentence citing nothing, far from them.
  { id: 'suggest:u1', page: 0, rects: [line(0)], sentence: suggestion.sentence, file: 'main.tex', line: 9, findings: [], suggestion: { ...suggestion, entry: 'refs.bib#knuth', title: 'The TeXbook' } },
]; };
const entry = key => ({ id: `refs.bib#${key}`, file: 'refs.bib', key, type: 'article', fields: [{ name: 'title', value: key === 'knuth' ? 'The TeXbook' : 'Linear types can change the world!' }, { name: 'author', value: key === 'knuth' ? 'Donald E. Knuth' : 'Philip Wadler' }, { name: 'year', value: '1990' }], lines: [1, 5], cited: [{ file: 'main.tex', line: 3, section: null }] });
const report = () => ({
  bibs: ['refs.bib'], absent: [], missing: [], duplicates: [], similar: [], all_cited: false, checks: {}, pending: 0, confirmed: {}, quickCheck: null, autoCheck: false,
  entries: [entry('knuth'), entry('wadler')],
  library: { pending: 0, entries: { 'refs.bib#knuth': { pdf: { hash, source: 'author', pages: 1, text: 'ready' }, find: null, landing: null }, 'refs.bib#wadler': { pdf: { hash, source: 'author', pages: 1, text: 'ready' }, find: null, landing: null } } },
  citations: marks.filter(mark => !mark.suggestion).map(mark => ({ id: mark.id, keys: mark.findings.map(item => item.key), file: mark.file, line: mark.line, section: null, sentence: mark.sentence, findings: Object.fromEntries(mark.findings.map(item => [item.key, item])) })),
  suggestions: marks.some(mark => mark.suggestion) ? [suggestion] : [],
});
const errors = [], dismissed = [], evidenceKeys = [];
async function run(viewport, name) {
  reset();
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
    if (url.pathname.endsWith('/manuscript/evidence')) { evidenceKeys.push(url.searchParams.get('key')); return json({ key: url.searchParams.get('key'), marks, running: false }); }
    if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
    if (url.pathname.endsWith('/citations/suggestions/dismiss')) { dismissed.push(route.request().postDataJSON().id); marks = marks.filter(mark => !mark.suggestion); return json(report()); }
    if (url.pathname.endsWith('/library')) return json(report());
    if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.includes('/library/pdfs/')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
    return json({});
  });
  const press = locator => phone ? locator.tap() : locator.click();
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  const tags = page.locator('.manuscript .evidence-tag');
  await expect(tags).toHaveCount(2);
  assert.equal(evidenceKeys.at(-1), 'pdf', 'marks belong to the build on screen');
  const paragraph = tags.nth(1), suggested = tags.nth(0);
  // The paragraph's bar: a segment per citation, in reading order.
  assert.deepEqual(await paragraph.locator('span').evaluateAll(spans => spans.map(span => span.dataset.verdict)), ['supported', 'unsupported', 'supported']);
  await expect(paragraph).toHaveAttribute('aria-label', 'Citation check: knuth Supported, wadler Not supported, knuth Supported');
  assert.deepEqual(await suggested.locator('span').evaluateAll(spans => spans.map(span => span.dataset.verdict)), ['suggested']);
  const box = await paragraph.boundingBox();
  assert.ok(box.width >= (phone ? 24 : 13) && box.height >= 8, 'the bar can be clicked or tapped');
  await press(paragraph);
  const card = page.locator('.manuscript .evidence-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.evidence-tally')).toHaveText(/1 Not supported\s*2 Supported/);
  await expect(card.locator('.evidence-list > li')).toHaveCount(2);
  await expect(card.locator('li').nth(1).locator('.evidence-verdict')).toHaveText(['Not supported', 'Supported'], { useInnerText: true });
  await expect(card.locator('li').nth(1).locator('.evidence-verdict').nth(1)).toHaveAttribute('title', 'Checked by an agent');
  await expect(page.locator('.evidence-sentence')).toHaveCount(2);
  const inside = await card.boundingBox(), pageBox = await page.locator('.manuscript .page').first().boundingBox();
  assert.ok(inside.x >= pageBox.x - 1 && inside.x + inside.width <= pageBox.x + pageBox.width + 1, 'the card stays on the page');
  await page.screenshot({ path: `test-results/evidence-card-${name}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  assert.ok(await paragraph.evaluate(element => element === document.activeElement), 'focus returns to the bar');
  // A click or tap outside closes it too.
  await press(paragraph);
  await expect(card).toBeVisible();
  if (phone) await page.touchscreen.tap(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 20); else await page.mouse.click(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 20);
  await expect(card).toHaveCount(0);
  // A suggestion: its card offers a task draft, and Dismiss removes it.
  await press(suggested);
  await expect(card.locator('.evidence-verdict')).toHaveText('Could cite', { useInnerText: true });
  await page.screenshot({ path: `test-results/evidence-suggestion-${name}.png`, animations: 'disabled' });
  await press(card.getByRole('button', { name: 'Ask an agent to cite it' }));
  await page.waitForFunction(() => (localStorage.getItem('papilot:new-task') || '').includes('Cite knuth'));
  assert.match(await page.evaluate(() => localStorage.getItem('papilot:new-task')), /main\.tex:9[\s\S]*Paragraphs are broken into lines optimally\.[\s\S]*page 1: “TeX breaks paragraphs/);
  await page.evaluate(() => localStorage.removeItem('papilot:new-task'));
  // The draft opens beside the paper; on a phone it takes the screen, and PDF goes back.
  if (phone) await press(page.getByRole('radio', { name: 'PDF' }).or(page.getByRole('tab', { name: 'PDF' })).or(page.getByRole('button', { name: 'PDF', exact: true })).first());
  await press(page.locator('.manuscript .evidence-tag').nth(0));
  await press(card.getByRole('button', { name: 'Dismiss' }));
  await expect(page.locator('.manuscript .evidence-tag')).toHaveCount(1);
  assert.deepEqual(dismissed.splice(0), ['u1']);
  // A quote opens the cited work at its lines; there the passage has its own bar.
  await press(page.locator('.manuscript .evidence-tag').first());
  await press(card.locator('.evidence-quote').first());
  await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
  await expect(page.locator('.library-reader .source-mark').first()).toBeVisible();
  const source = page.locator('.library-reader .evidence-tag');
  await expect(source).toHaveCount(1);
  await press(source);
  const sourceCard = page.locator('.library-reader .evidence-card');
  await expect(sourceCard.locator('.evidence-list > li')).toHaveCount(2, { timeout: 5000 });
  await expect(sourceCard.locator('.evidence-where').first()).toHaveText('main.tex:3');
  await page.screenshot({ path: `test-results/evidence-source-${name}.png`, animations: 'disabled' });
  // And goes back to the sentence in the paper, its card open and the sentence singled out.
  await press(sourceCard.getByRole('button', { name: 'Show in paper' }).nth(1));
  await expect(page.locator('.manuscript .evidence-card li[data-focused]')).toHaveCount(1);
  await expect(page.locator('.manuscript .evidence-card li[data-focused] .evidence-sentence-text')).toContainText('Linear values can be updated in place');
  // Shown once: closed, it stays closed when the marks are read again.
  await page.keyboard.press('Escape');
  await expect(page.locator('.manuscript .evidence-card')).toHaveCount(0);
  const reads = evidenceKeys.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => evidenceKeys.length).toBeGreaterThan(reads);
  await page.waitForTimeout(300);
  await expect(page.locator('.manuscript .evidence-card')).toHaveCount(0);
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
