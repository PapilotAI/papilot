import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { readyRequirements } from './required-tools-fixture.mjs';
import { chromium, expect } from './playwright.mjs';

fs.mkdirSync('test-results', { recursive: true });
const server = Fastify();
let browser;

try {
  await server.register(staticFiles, { root: path.resolve('dist') });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const pdf = fs.readFileSync('tests/fixtures/outline.pdf');
  const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });

  // Fixture notes with deliberately distinct original, PDF-position, and newest orders:
  // Canonical PDF numbers are 1..7 in array order.
  const notes = [
    // #1: Yellow group, page 2 top, oldest yellow
    { id: 'y-p2', projectId: 'paper', key: 'pdf', page: 1, rect: [0.14, 0.14, 0.42, 0.16], rects: [[0.14, 0.14, 0.42, 0.16]], quote: 'Page 2 yellow passage', comment: 'Yellow on page 2.', group: 'yellow', source: null, createdAt: 100 },
    // #2: Individual, page 2 mid, oldest individual
    { id: 'i-p2', projectId: 'paper', key: 'pdf', page: 1, rect: [0.14, 0.40, 0.45, 0.42], rects: [[0.14, 0.40, 0.45, 0.42]], quote: 'Page 2 individual passage', comment: 'Individual on page 2.', source: null, createdAt: 200 },
    // #3: Yellow group, stale/unconfirmed position (key !== 'pdf'), newest yellow!
    { id: 'y-stale', projectId: 'paper', key: 'old', page: 0, rect: [0.10, 0.08, 0.30, 0.10], rects: [[0.10, 0.08, 0.30, 0.10]], quote: 'Unconfirmed yellow passage', comment: 'Needs confirmation.', group: 'yellow', source: null, createdAt: 600 },
    // #4: Individual, page 1 same line right (slightly smaller top to test same-line left-to-right!)
    { id: 'i-p1-right', projectId: 'paper', key: 'pdf', page: 0, rect: [0.58, 0.250, 0.80, 0.268], rects: [[0.58, 0.250, 0.80, 0.268]], quote: 'Right word on line', comment: 'Right side of line.', source: null, createdAt: 500 },
    // #5: Yellow group, page 1 bottom, middle timestamp among yellow
    { id: 'y-p1', projectId: 'paper', key: 'pdf', page: 0, rect: [0.14, 0.62, 0.44, 0.64], rects: [[0.14, 0.62, 0.44, 0.64]], quote: 'Page 1 yellow passage', comment: 'Yellow on page 1.', group: 'yellow', source: null, createdAt: 350 },
    // #6: Individual, stale/unconfirmed position, newest overall!
    { id: 'i-stale', projectId: 'paper', key: 'old', page: 0, rect: [0.10, 0.06, 0.32, 0.08], rects: [[0.10, 0.06, 0.32, 0.08]], quote: 'Unconfirmed individual passage', comment: 'Newest individual, unconfirmed.', source: null, createdAt: 700 },
    // #7: Individual, page 1 same line left (slightly larger top within line tolerance)
    { id: 'i-p1-left', projectId: 'paper', key: 'pdf', page: 0, rect: [0.14, 0.252, 0.38, 0.267], rects: [[0.14, 0.252, 0.38, 0.267]], quote: 'Left word on line', comment: 'Left side of line.', source: null, createdAt: 400 },
  ];

  const expectedNumbers = Object.fromEntries(notes.map((item, index) => [item.id, String(index + 1)]));

  async function mountRoutes(page) {
    const state = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
    const git = { branch: 'main', files: [] };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
      if (url.pathname === '/api/state') return json(state);
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/files')) return json({ document: 'main.tex', files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json(git);
      if (url.pathname.endsWith('/git/overview')) return json({ worktrees: [], commits: [], truncated: false });
      if (url.pathname.endsWith('/manuscript')) return json({
        git,
        document: 'main.tex',
        build: { status: 'ready', key: 'pdf', document: 'main.tex', pages: [[612, 792], [612, 792]] },
        annotations: notes,
        noteSections: [{ id: 'intro', title: 'Introduction', level: 1, notes: notes.filter(n => n.key === 'pdf').map(n => n.id) }],
      });
      if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
      if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
      throw Error(`Unexpected request ${url.pathname}`);
    });
  }

  async function readOrders(library) {
    return library.evaluate(root => {
      const readList = selector => Array.from(root.querySelectorAll(selector)).map(li => ({
        id: li.getAttribute('data-note'),
        number: li.querySelector('.note-number')?.textContent?.trim(),
      }));
      return {
        grouped: readList('.group-references > li[data-note]'),
        individual: readList('.note-list > li[data-note]'),
      };
    });
  }

  async function verifyPdfMarkersMatch(page, orders) {
    for (const item of [...orders.grouped, ...orders.individual]) {
      assert.equal(item.number, expectedNumbers[item.id], `note ${item.id} number must stay matched to canonical index`);
    }
    // Verify confirmed markers rendered on the PDF keep their exact canonical numbers.
    for (const note of notes.filter(item => item.key === 'pdf')) {
      const marker = page.locator(`.note-layer .note-tag[data-note="${note.id}"]`);
      if (await marker.count()) {
        await expect(marker.first()).toHaveText(expectedNumbers[note.id]);
      }
    }
  }

  for (const variant of [
    { name: 'desktop-light', viewport: { width: 1440, height: 900 }, mobile: false, theme: 'light' },
    { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, mobile: false, theme: 'dark' },
    { name: 'mobile-light', viewport: { width: 390, height: 844 }, mobile: true, theme: 'light' },
  ]) {
    const page = await browser.newPage({
      locale: 'en-US',
      reducedMotion: 'reduce',
      viewport: variant.viewport,
      hasTouch: variant.mobile,
      isMobile: variant.mobile,
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem('papilot:language', 'en');
      localStorage.setItem('papilot:theme', theme);
    }, variant.theme);
    await mountRoutes(page);

    try {
      await page.goto(origin);
      if (variant.mobile) {
        await page.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'PDF', exact: true }).click();
      }
      await page.locator('.note-layer .note-tag[data-note="y-p1"]').first().waitFor();
      await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();

      const library = page.getByRole('complementary', { name: 'PDF note library' });
      const header = library.locator('.pdf-reading-notes-head');
      await expect(library).toBeVisible();

      const sortTrigger = header.getByRole('button', { name: /^Sort notes:/ });
      await expect(sortTrigger).toBeVisible();
      await expect(sortTrigger).toHaveAttribute('data-sort', 'original');
      await expect(sortTrigger).toHaveAttribute('aria-label', 'Sort notes: Original order');
      await expect(sortTrigger).toHaveAttribute('title', 'Sort notes: Original order');
      await expect(sortTrigger).not.toHaveAttribute('aria-haspopup');
      await expect(sortTrigger).not.toHaveClass(/\bactive\b/);
      const iconMarkup = () => sortTrigger.locator('svg').innerHTML();
      const originalIcon = await iconMarkup();

      // All header actions stay cleanly inside the viewport without overlapping.
      const clearButton = header.getByRole('button', { name: 'Clear all annotations…', exact: true });
      const pickerButton = header.getByRole('button', { name: 'Add to task', exact: true });
      const closeButton = header.getByRole('button', { name: 'Close notes', exact: true });
      for (const button of [sortTrigger, clearButton, pickerButton, closeButton]) {
        await expect(button).toBeInViewport();
      }
      const [sortBox, clearBox, pickerBox, closeBox] = await Promise.all([
        sortTrigger.boundingBox(), clearButton.boundingBox(), pickerButton.boundingBox(), closeButton.boundingBox(),
      ]);
      assert.ok(sortBox.x + sortBox.width <= clearBox.x + 1);
      assert.ok(clearBox.x + clearBox.width <= pickerBox.x + 1);
      assert.ok(pickerBox.x + pickerBox.width <= closeBox.x + 1);
      if (variant.mobile) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), variant.viewport.width);
      }

      // 1. Default: Original order
      const originalOrders = await readOrders(library);
      assert.deepEqual(originalOrders.grouped.map(n => n.id), ['y-p2', 'y-stale', 'y-p1']);
      assert.deepEqual(originalOrders.individual.map(n => n.id), ['i-p2', 'i-p1-right', 'i-stale', 'i-p1-left']);
      await verifyPdfMarkersMatch(page, originalOrders);
      await page.screenshot({ path: `test-results/note-sort-original-${variant.name}.png`, animations: 'disabled' });

      // 2. Single click cycles directly to PDF position (no dropdown menu)
      await sortTrigger.click();
      await expect(page.getByRole('menu', { name: /^Sort notes:/ })).toHaveCount(0);
      await expect(sortTrigger).toBeFocused();
      await expect(sortTrigger).toHaveAttribute('data-sort', 'position');
      await expect(sortTrigger).toHaveAttribute('aria-label', 'Sort notes: PDF position');
      await expect(sortTrigger).toHaveAttribute('title', 'Sort notes: PDF position');
      await expect(sortTrigger).toHaveClass(/\bactive\b/);
      await expect(library.locator('p.sr-only[role="status"]')).toHaveText('Notes sorted by PDF position.');
      const positionIcon = await iconMarkup();
      assert.notEqual(positionIcon, originalIcon, 'PDF position mode should show a distinct icon');

      const positionOrders = await readOrders(library);
      assert.deepEqual(positionOrders.grouped.map(n => n.id), ['y-p1', 'y-p2', 'y-stale']);
      assert.deepEqual(positionOrders.individual.map(n => n.id), ['i-p1-left', 'i-p1-right', 'i-p2', 'i-stale']);
      await verifyPdfMarkersMatch(page, positionOrders);
      await page.screenshot({ path: `test-results/note-sort-position-${variant.name}.png`, animations: 'disabled' });

      // 3. Keyboard Enter (desktop) or tap (mobile) cycles directly to Newest first
      if (!variant.mobile) {
        await sortTrigger.focus();
        await page.keyboard.press('Enter');
      } else {
        await sortTrigger.click();
      }

      await expect(sortTrigger).toHaveAttribute('data-sort', 'newest');
      await expect(sortTrigger).toHaveAttribute('aria-label', 'Sort notes: Newest first');
      await expect(sortTrigger).toHaveAttribute('title', 'Sort notes: Newest first');
      await expect(sortTrigger).toHaveClass(/\bactive\b/);
      await expect(library.locator('p.sr-only[role="status"]')).toHaveText('Notes sorted by Newest first.');
      const newestIcon = await iconMarkup();
      assert.notEqual(newestIcon, originalIcon, 'Newest first mode should show a distinct icon');
      assert.notEqual(newestIcon, positionIcon, 'Newest first and PDF position icons should differ');

      const newestOrders = await readOrders(library);
      assert.deepEqual(newestOrders.grouped.map(n => n.id), ['y-stale', 'y-p1', 'y-p2']);
      assert.deepEqual(newestOrders.individual.map(n => n.id), ['i-stale', 'i-p1-right', 'i-p1-left', 'i-p2']);
      await verifyPdfMarkersMatch(page, newestOrders);
      await page.screenshot({ path: `test-results/note-sort-newest-${variant.name}.png`, animations: 'disabled' });

      // 4. Reload persists the chosen sort preference
      await page.reload();
      if (variant.mobile) {
        await page.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'PDF', exact: true }).click();
      }
      await page.getByRole('button', { name: /^My notes(?: · .+)?$/ }).click();
      const reloadedTrigger = header.getByRole('button', { name: 'Sort notes: Newest first', exact: true });
      await expect(reloadedTrigger).toBeVisible();
      await expect(reloadedTrigger).toHaveAttribute('data-sort', 'newest');
      const persistedOrders = await readOrders(library);
      assert.deepEqual(persistedOrders.grouped.map(n => n.id), ['y-stale', 'y-p1', 'y-p2']);
      assert.deepEqual(persistedOrders.individual.map(n => n.id), ['i-stale', 'i-p1-right', 'i-p1-left', 'i-p2']);

      // 5. One more click cycles back to Original order
      await reloadedTrigger.click();
      await expect(sortTrigger).toHaveAttribute('data-sort', 'original');
      await expect(sortTrigger).toHaveAttribute('aria-label', 'Sort notes: Original order');
      await expect(sortTrigger).not.toHaveClass(/\bactive\b/);
      assert.equal(await iconMarkup(), originalIcon);
      const restoredOrders = await readOrders(library);
      assert.deepEqual(restoredOrders.grouped.map(n => n.id), ['y-p2', 'y-stale', 'y-p1']);
      assert.deepEqual(restoredOrders.individual.map(n => n.id), ['i-p2', 'i-p1-right', 'i-stale', 'i-p1-left']);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log('PASS: My notes sorting (Original order, PDF position, Newest first) works across desktop light/dark and mobile, persists across reloads, and preserves PDF marker numbers.');
} finally {
  await browser?.close();
  await server.close();
}
