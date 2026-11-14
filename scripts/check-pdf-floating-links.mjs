import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

// Floating selection controls must keep the hit area the author aims at,
// including while appearing over a real PDF link to another page.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-floating-links-'));
const server = Fastify();
let browser;
try {
  fs.writeFileSync(path.join(fixture, 'main.tex'), String.raw`\documentclass{article}
\usepackage[hidelinks]{hyperref}
\begin{document}
\section{Introduction}
Fixture sentence about review tasks. A writing assistant proposes changes that the author reviews.

\hyperref[method]{Go to Method}
\clearpage
\section{Method}\label{method}
The second page must only open when its link is deliberately clicked.
\end{document}
`);
  for (let pass = 0; pass < 2; pass++) execFileSync('pdflatex', ['-interaction=batchmode', '-halt-on-error', 'main.tex'], { cwd: fixture });
  const pdf = fs.readFileSync(path.join(fixture, 'main.pdf'));
  fs.mkdirSync('test-results', { recursive: true });
  await server.register(staticFiles, { root: path.resolve('dist') });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const errors = [];
  async function open() {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    const state = { version: 'test', projects: [{ id: 'paper', name: 'Paper', path: fixture }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
    const git = { branch: 'main', files: [] }, notes = [], sourceRequests = [];
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
      if (url.pathname === '/api/state') return json(state);
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json(git);
      if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes });
      if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
      if (url.pathname.endsWith('/manuscript/words')) return route.fulfill({ status: 404, json: { error: 'Use PDF text' } });
      if (url.pathname.endsWith('/manuscript/source/locate')) { sourceRequests.push(route.request().postDataJSON()); return json({ source: null }); }
      if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname.endsWith('/annotations')) {
        const note = { ...route.request().postDataJSON(), id: `note-${notes.length + 1}`, projectId: 'paper', source: null, createdAt: 1 };
        notes.push(note); return json(note);
      }
      throw Error(`Unexpected fixture request ${url.pathname}`);
    });
    await page.goto(origin);
    const text = page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: 'Fixture sentence' }).first();
    const link = page.locator('.page[data-page-number="1"] .linkAnnotation a').first();
    await text.waitFor(); await link.waitFor();
    const select = () => text.evaluate(element => {
      const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 7);
      const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const rect = range.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, clientX: rect.right, clientY: rect.bottom }));
    });
    // Keep the PDF.js link and its real destination/handler; move only its
    // annotation rectangle to exercise an overlapping page layout exactly.
    const overlap = box => link.evaluate((anchor, box) => {
      const section = anchor.parentElement, frame = section.parentElement.getBoundingClientRect();
      Object.assign(section.style, { left: `${box.x - frame.left}px`, top: `${box.y - frame.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    }, box);
    const pageNumber = page.getByRole('textbox', { name: 'Page number', exact: true });
    return { page, text, link, select, overlap, notes, sourceRequests, pageNumber };
  }

  for (const control of ['add-note', 'add-source']) for (const aim of ['icon', 'edge']) {
    const f = await open(), { page } = f;
    try {
      // Pause the actual entrance animation while the author aims, then
      // finish it before the click. Native mouse coordinates catch a miss;
      // locator.click() would follow a moving button and conceal this bug.
      await page.evaluate(() => {
        window.controlObserver = new MutationObserver(() => {
          for (const button of document.querySelectorAll('.add-note,.add-source')) for (const animation of button.getAnimations()) {
            if (animation.playState !== 'paused') { animation.pause(); animation.currentTime = 35; }
          }
        });
        window.controlObserver.observe(document.querySelector('.pdfViewer'), { childList: true, subtree: true });
      });
      await f.select();
      const button = page.locator(`.${control}`); await button.waitFor();
      // PDF.js disables link hit areas during a text drag, and restores them
      // on release. End the gesture after the selection menu is present.
      await f.text.dispatchEvent('pointerup', { bubbles: true, pointerType: 'mouse' });
      await page.evaluate(() => window.controlObserver.disconnect());
      const box = await button.boundingBox(), icon = await button.locator('svg').first().boundingBox();
      const point = aim === 'icon' ? { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 } : { x: box.x + box.width / 2, y: box.y + 1 };
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.className, point), control);
      await f.overlap(box);
      assert.ok(await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).some(element => element.matches('.linkAnnotation a')), point), 'the fixture has a live PDF link beneath the control');
      await page.mouse.move(point.x, point.y);
      await button.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await page.mouse.click(point.x, point.y);
      if (control === 'add-note') {
        const card = page.locator('.pdf-note-card');
        await expect(card).toBeInViewport();
        await expect(card).toHaveCSS('opacity', '1');
        await expect(card.locator('textarea')).toBeFocused();
      }
      else await expect.poll(() => f.sourceRequests.length).toBe(1);
      await expect(f.pageNumber).toHaveValue('1');
      assert.equal(f.sourceRequests.length, control === 'add-source' ? 1 : 0, 'the other selection action must not be activated');
      await page.screenshot({ path: `test-results/pdf-floating-${control}-${aim}.png` });
    } finally { await page.close(); }
  }

  const f = await open();
  try {
    await f.page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('button', { name: 'Magic pen', exact: true }).click();
    await f.select();
    const menu = f.page.getByRole('menu', { name: 'Quick notes', exact: true });
    await expect(menu).toBeVisible();
    const button = menu.locator('.stamp-slot').first();
    await button.hover();
    await expect.poll(async () => (await button.boundingBox())?.width).toBe(40);
    await f.text.dispatchEvent('pointerup', { bubbles: true, pointerType: 'mouse' });
    const box = await button.boundingBox(); await f.overlap(box);
    const icon = await button.locator('svg').boundingBox();
    assert.ok(await f.page.evaluate(({ x, y, width, height }) => document.elementsFromPoint(x + width / 2, y + height / 2).some(element => element.matches('.linkAnnotation a')), icon), 'the magic pen also covers a live PDF link');
    await f.page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
    await expect.poll(() => f.notes.length).toBe(1);
    await expect(menu).toHaveCount(0);
    await expect(f.pageNumber).toHaveValue('1');
    await f.page.screenshot({ path: 'test-results/pdf-floating-magic-link.png' });
  } finally { await f.page.close(); }

  const ordinary = await open();
  try { await ordinary.link.click(); await expect(ordinary.pageNumber).toHaveValue('2'); }
  finally { await ordinary.page.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: floating note/source buttons keep their aimed-at hit area over PDF links, magic pen clicks stay in the menu, and ordinary links still navigate.');
} finally {
  await browser?.close(); await server.close();
  fs.rmSync(fixture, { recursive: true, force: true });
}
