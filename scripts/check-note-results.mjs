import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { expect } from './playwright.mjs';
import { taskNoteResults } from '../src/server/note-results.ts';
import { rewriteReviewHtml } from '../src/server/review.ts';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
// A browser decode that never settles must not keep a prepared choice spinning.
await page.addInitScript(() => { Image.prototype.decode = () => new Promise(() => {}); });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const task = { id: 'note-results-task', projectId: 'paper', name: 'p-note-results', title: 'Revise the introduction', status: 'reviewing', createdAt: 1, updatedAt: 1, review: { round: 2, state: 'reviewing', counts: { pending: 1 } } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Thesis', path: '/tmp/paper' }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const note = (comment, start, quote) => ({ where: `Page 1 · main.tex line ${start}`, quote, comment, anchor: { sources: [{ file: 'main.tex', lines: [start, start + 2] }] } });
const items = [
  { id: 'request-1', taskId: task.id, type: 'user', text: '', createdAt: 1, meta: { notes: [note('Shorten the opening.', 10, 'The original technical sentence.'), note('Clarify the contribution.', 20, 'A second original sentence.'), note('Define the symbol in the equation.', 90, '')] } },
  { id: 'response-1', taskId: task.id, type: 'assistant', text: 'Revised the opening and contribution.', createdAt: 2 },
  { id: 'request-2', taskId: task.id, type: 'user', text: '', createdAt: 3, meta: { notes: [{ ...note('Keep the technical term.', 10, 'A shorter technical sentence.'), where: 'Round 1 · Page 1 · main.tex line 10', anchor: { round: 1, sources: [{ file: 'main.tex', lines: [10, 12] }] } }] } },
];
const runs = [{ id: 'request-1', taskId: task.id, reviewRound: 1, status: 'completed' }, { id: 'request-2', taskId: task.id, reviewRound: 2, status: 'completed' }];
// Several annotations can legitimately share a PDF group. Its links stay
// compact and individually usable instead of wrapping into tall cards.
items[2].meta.notes.push(...['Keep the definition precise.', 'Avoid unnecessary repetition.'].map(comment => ({ ...items[2].meta.notes[0], comment })));
const unit = (id, line, old, revised) => ({ id, file: 'main.tex', kind: 'text', status: 'modified', old_start: line, old_end: line + 2, new_start: line, new_end: line + 2, old_text: old, new_text: revised });
const units = { 1: [unit('c1', 10, 'The original technical sentence.', 'A shorter technical sentence.'), unit('c2', 20, 'A second original sentence.', 'Our contribution is now explicit.'), unit('c3', 12, 'The original technical sentence.', 'A clearer technical sentence.')], 2: [unit('c1', 11, 'A shorter technical sentence.', 'A shorter sentence preserving the technical term.')] };
const rounds = Object.fromEntries([1, 2].map(round => [round, { round, units: units[round], sections: [], loose: units[round].map(u => ({ kind: 'change', units: [u.id], before: [{ text: [{ text: u.old_text }] }] })) }]));
const decisions = { 1: { c1: 'pending', c2: 'rejected', c3: 'accepted' }, 2: { c1: 'pending' } };
const client = { get: async route => route.includes('/rounds/') ? rounds[Number(new URL(route, origin).pathname.split('/').at(-1))] : { decisions: decisions[Number(new URL(route, origin).searchParams.get('round'))] } };
let documentName = 'main.tex';
let failResults = true, enableReturns = false, failReturn = false, failUndo = false;
const returned = new Map(), returnWrites = [], undoWrites = [], taskWrites = [];
let releaseMissed;
const missedGate = new Promise(resolve => { releaseMissed = resolve; });
const optionWrites = [], optionReads = [], previewReads = [];
let releaseBriefPreview;
const briefPreviewWait = new Promise(resolve => { releaseBriefPreview = resolve; });
let rejectFails = false;
let comparisonVersion = 'initial';
const alternateSource = '\\emph{A concise alternative preserving the technical term.}';
const strip = text => {
  const src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="30"><rect width="600" height="30" fill="white"/><text x="40" y="20" font-size="12">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`);
  return { src, clean: src, width: 600, height: 30, page: 1, label: '1', text: [{ text, chars: Array.from(text, (ch, index) => ({ text: ch, rect: [40 + index * 5, 8, 45 + index * 5, 22] })) }] };
};
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/review/')) return route.fallback();
  if (url.pathname === '/api/indirect-changes') return route.fulfill({ json: { indirectChanges: false } });
  if (url.pathname === '/api/updates') return route.fulfill({ json: { currentVersion: snapshot.version, latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: true } });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true } });
  if (url.pathname === '/api/projects/paper/document') { const body = route.request().postDataJSON(); documentName = [...returned.values()].find(item => item.id === body.annotation)?.document || body.main || documentName; return route.fulfill({ json: { document: documentName } }); }
  if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: {
    document: documentName, annotations: [...returned.values()].filter(item => !item.taskId && item.document === documentName), build: enableReturns ? { status: 'ready', key: 'current', pages: [[612, 792], [612, 792]] } : { status: 'idle' }, git: { files: [] },
  } });
  if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  if (url.pathname.endsWith('/manuscript/words')) return route.fulfill({ status: 404, json: { error: 'Use PDF text' } });
  if (url.pathname === '/api/quick-notes') return route.fulfill({ json: { quickNotes: null } });
  const returning = url.pathname.match(/\/tasks\/[^/]+\/notes\/([^/]+)\/(return|undo-return)$/);
  if (returning) {
    const [, id, operation] = returning;
    if (route.request().method() === 'GET') return route.fulfill({ json: returned.get(id) });
    if (operation === 'undo-return') {
      const { createdAt } = route.request().postDataJSON();
      undoWrites.push({ id, createdAt });
      if (failUndo) return route.fulfill({ status: 503, json: { error: 'Retry the undo.' } });
      const copy = returned.get(id);
      assert.equal(createdAt, copy?.createdAt);
      returned.delete(id);
      return route.fulfill({ json: { returned: false, removed: copy.id } });
    }
    returnWrites.push(id);
    if (failReturn) return route.fulfill({ status: 503, json: { error: 'Retry the return.' } });
    if (id === 'missed') await missedGate;
    const original = items[0].meta.notes.find(item => item.id === id);
    assert.ok(original);
    if (!returned.has(id)) {
      returned.set(id, { ...original, id: 'returned-' + id, projectId: 'paper', document: 'appendix.tex', key: id === 'missed' ? 'old' : 'current', page: id === 'rejected' ? 1 : 0, rect: [0.12, 0.2, 0.25, 0.22],
        source: null, createdAt: returnWrites.length, ...(original.group ? { groupInstruction: items[0].meta.groupInstructions[original.group] } : {}) });
    }
    return route.fulfill({ json: returned.get(id) });
  }
  if (url.pathname === '/api/tasks') {
    const body = route.request().postDataJSON();
    taskWrites.push(body);
    const created = { ...task, ...body, id: body.id, title: 'Follow up', review: null, status: 'queued' };
    for (const copy of returned.values()) if (body.annotations?.includes(copy.id)) copy.taskId = created.id;
    snapshot.tasks.push(created);
    return route.fulfill({ json: created });
  }
  if (/\/api\/tasks\/[^/]+\/pdf$/.test(url.pathname)) {
    if (url.searchParams.get('metadata') === '1') return route.fulfill({ json: { url: `${url.pathname}?round=${url.searchParams.get('round')}&build=fixture` } });
    return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  }
  if (url.pathname === '/api/state') return route.fulfill({ json: { ...snapshot, manuscriptNoteCounts: { paper: [...returned.values()].filter(item => !item.taskId).length } } });
  if (url.pathname.endsWith('/items')) return route.fulfill({ json: { items } });
  if (url.pathname.endsWith('/note-results')) {
    if (failResults) return route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
    const notes = await taskNoteResults(task, items, runs, client);
    if (enableReturns) for (const entry of notes) if (entry.note.id) {
      const copy = returned.get(entry.note.id);
      entry.returned = Boolean(copy);
      entry.undoReturnAt = copy?.taskId ? undefined : copy?.createdAt;
    }
    return route.fulfill({ json: { notes } });
  }
  if (url.pathname.endsWith('/note-options/preview')) {
    const requestedComparison = url.searchParams.get('comparison');
    if (url.searchParams.get('background') !== '1') assert.equal(requestedComparison, comparisonVersion);
    const round = Number(url.searchParams.get('round')), option = url.searchParams.get('option');
    if (round === 2 && option === 'brief' && requestedComparison === 'initial') await briefPreviewWait;
    previewReads.push({ key: url.searchParams.get('key'), round, option, background: url.searchParams.get('background') === '1' });
    const candidate = round === 2 ? [...units[round].map(u => ({ ...u, new_text: option === 'brief' ? alternateSource : u.new_text })), unit('other', 80, 'Three datasets.', 'Five datasets.')] : units[round];
    return route.fulfill({ json: { ...rounds[round], units: candidate, task: task.name, before: 'before', after: `candidate-${option}-${requestedComparison}`, files: '', warnings: [], loose: [{ kind: 'change', units: ['c1'], before: [strip(candidate[0].old_text)], after: [strip(candidate[0].new_text)] }] } });
  }
  if (url.pathname.endsWith('/note-options')) {
    const body = route.request().method() !== 'GET' ? route.request().postDataJSON() : null;
    if (body) {
      optionWrites.push(body);
      if (body.reject && rejectFails) return route.fulfill({ status: 400, json: { error: 'The source changed. Try again.' } });
      if (body.reject) decisions[2].c1 = 'rejected';
    } else optionReads.push(url.searchParams.get('key'));
    const round = (body?.key || url.searchParams.get('key'))?.startsWith('request-1:') ? 1 : 2;
    return route.fulfill({ json: { round, comparisonKey: comparisonVersion, key: url.searchParams.get('key'), ...(round === 1 ? { options: [], locked: 'Options are not available for this source range yet.' } : { options: [
      { id: 'current', label: 'Keep terminology', reason: 'Preserve the author’s technical term.', edits: [{ unit: 'c1', text: units[2][0].new_text }] },
      { id: 'brief', label: 'Concise', reason: 'Keep the technical term in a shorter sentence.', edits: [{ unit: 'c1', text: alternateSource }] },
    ] }) } });
  }
  if (url.pathname.endsWith('/files')) return route.fulfill({ json: { document: null, files: [] } });
  if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
  if (url.pathname.endsWith('/git')) return route.fulfill({ json: { files: [], branch: 'main' } });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  throw new Error('Unexpected request: ' + url.pathname);
});
const css = fs.readFileSync('engine/src/web/style.css', 'utf8');
await page.route('**/review/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.includes('/rounds/')) return route.fulfill({ json: rounds[Number(url.pathname.split('/').at(-1))] });
  const round = Number(url.searchParams.get('round')) || 2;
  const html = `<html><head><style>${css} .change{min-height:240px}.change:not(.current) .dock{display:none!important}.source-fixture{padding:24px;font-size:18px;line-height:1.6}</style></head><body><div id="root"><header class="bar"><div class="identity"><span>Round ${round}</span></div></header><div class="review-body"><main id="paper"><div class="document"><div class="sheet">${units[round].map((u, index) => `<article class="change inline${index === 0 ? ' current' : ''}" data-stop="${index}" data-units="${u.id}" data-state="${decisions[round][u.id]}" tabindex="-1"><header class="change-head"><span class="change-number" data-change="${index + 1}">Change ${index + 1}</span><span class="change-where" data-location="main.tex:${u.old_start}–${u.old_end}">main.tex:${u.old_start}–${u.old_end}</span><div class="dock"><nav class="actions"><button class="accept" type="button" data-action="accept">Accept</button><button class="reject" type="button" data-action="reject">Reject</button><button class="comment" type="button" data-action="comment">Comment</button></nav></div></header><div class="source-fixture"><p class="fixture-before">${u.old_text}</p><p class="fixture-after">${u.new_text}</p></div></article>`).join('')}</div></div></main></div></div><script>
    let preview = null;
    const setCurrent = stop => document.querySelectorAll('.change[data-stop]').forEach(el => el.classList.toggle('current', Number(el.dataset.stop) === stop));
    document.querySelectorAll('.change[data-stop]').forEach(article => {
      const stop = Number(article.dataset.stop);
      article.addEventListener('click', () => setCurrent(stop));
      article.querySelectorAll('.actions button').forEach(btn => {
        btn.addEventListener('click', event => {
          event.stopPropagation();
          if (preview && preview.key) window.dispatchEvent(new CustomEvent('papilot:option-action', { detail: { key: preview.key, action: btn.dataset.action } }));
        });
      });
    });
    window.addEventListener('papilot:select-unit', event => { if (Number.isInteger(event.detail?.stop)) setCurrent(event.detail.stop); });
    window.addEventListener('papilot:option-preview', event => {
      preview = event.detail || null;
      document.querySelectorAll('.change[data-stop]').forEach(article => {
        const list = (article.dataset.units || '').split(' ');
        const hit = preview && (!preview.units?.length || list.some(id => preview.units.includes(id)));
        if (hit && preview.detail) {
          article.dataset.previewRevision = preview.detail.after;
          const matched = preview.detail.units.find(x => list.includes(x.id));
          if (matched) article.querySelector('.fixture-after').textContent = matched.new_text;
        } else {
          delete article.dataset.previewRevision;
        }
      });
    });
    fetch('/api/tasks/p-note-results/rounds/${round}').then(response => response.json()).then(detail => {
      document.documentElement.dataset.papilotRound = String(detail.round);
      dispatchEvent(new Event('papilot:round'));
    });
  </script></body></html>`;
  return route.fulfill({ contentType: 'text/html', body: rewriteReviewHtml(html, '/review/paper') });
});
const frame = () => page.frameLocator('.review-frame');
const sent = index => page.locator(`[data-note-result="request-1:${index}"]`);
const linkError = () => page.locator('#review-panel .note-link-error');
const decided = () => expect.poll(() => page.evaluate(() => {
  const view = document.querySelector('.review-frame')?.contentWindow;
  if (!view || view.document.readyState !== 'complete') return false;
  view.dispatchEvent(new view.Event('papilot:review:decided'));
  return true;
})).toBe(true);
try {
  await page.goto(origin);
  // 1. Initial note-linking failure shows non-blocking retry bar without a drawer.
  await linkError().getByRole('button', { name: 'Retry linking changes', exact: true }).waitFor();
  assert.equal(await page.locator('.review-note-controls').count(), 0);
  assert.equal(await page.getByText('No linked change', { exact: true }).count(), 0, 'failure must not look like an ignored note');
  failResults = false;
  await linkError().getByRole('button', { name: 'Retry linking changes', exact: true }).click();
  await frame().getByRole('button', { name: 'Show note 1: Keep the technical term.', exact: true }).waitFor();
  assert.equal(await frame().getByRole('button', { name: 'Show note 1: Shorten the opening.', exact: true }).count(), 0, 'an older note must not label a newer round');
  await expect.poll(() => [...optionReads].sort()).toEqual(['request-2:0', 'request-2:1', 'request-2:2']);
  const original = await page.locator('[data-note-result]').allTextContents();
  assert.equal(await page.locator('#conversation-panel .note-result-links, #conversation-panel .note-options').count(), 0);

  // 2. Shared note chips stay on one compact row inside the card header.
  const noteLinks = frame().locator('.change[data-stop="0"] .papilot-note-links');
  await expect(noteLinks.locator('button')).toHaveCount(3);
  const linkBounds = await noteLinks.locator('button').evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(); return { top: box.top, bottom: box.bottom }; }));
  assert.ok(linkBounds.every(box => box.top === linkBounds[0].top && box.bottom === linkBounds[0].bottom), 'Shared note numbers stay on one compact row');

  // 3. Inline note bar renders options and previews Concise live on the card.
  const inline0 = frame().locator('.change[data-stop="0"] .papilot-inline-note[data-note-key="request-2:0"]');
  await expect(inline0).toBeVisible();
  await expect(inline0.getByRole('tab', { name: 'Keep terminology', exact: true })).toHaveAttribute('aria-selected', 'true');
  assert.equal(await inline0.locator('.papilot-inline-reason').textContent(), 'Preserve the author’s technical term.');
  await inline0.getByRole('tab', { name: 'Concise', exact: true }).click();
  await expect(inline0.getByRole('tablist')).toHaveAttribute('aria-busy', 'true');
  releaseBriefPreview();
  await expect(frame().locator('.change[data-stop="0"]')).toHaveAttribute('data-preview-revision', 'candidate-brief-initial');
  await expect(frame().locator('.change[data-stop="0"] .fixture-after')).toContainText(alternateSource);
  assert.deepEqual(optionWrites, [], 'switching options never writes a decision');

  // Comparison key change refreshes the live preview.
  comparisonVersion = 'rejected-neighbor'; task.updatedAt++;
  await decided();
  await expect(frame().locator('.change[data-stop="0"]')).toHaveAttribute('data-preview-revision', 'candidate-brief-rejected-neighbor');
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/note-results-desktop.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: 'test-results/note-results-desktop-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });

  // 4. Historical note click in Chat opens Round 1 without unavailable option tabs.
  await sent(1).click();
  await frame().locator('html[data-papilot-round="1"]').waitFor();
  assert.match(await page.locator('.review-frame').getAttribute('src'), /round=1&history=1/);
  await expect(frame().locator('.change[data-stop="1"].current .papilot-inline-note')).toBeVisible();
  await expect(frame().locator('.change[data-stop="1"] .papilot-inline-tab')).toHaveCount(0);

  // Clicking a current Round 2 note returns to the latest round.
  const currentNote = page.locator('[data-note-result="request-2:0"]');
  await currentNote.click();
  await frame().locator('html[data-papilot-round="2"]').waitFor();
  assert.doesNotMatch(await page.locator('.review-frame').getAttribute('src'), /[?&](history|round)=/);
  assert.deepEqual(await page.locator('[data-note-result]').allTextContents(), original, 'review operations never add content to original messages');

  // 5. Rejecting Concise via card header Reject keeps retry identity and creates no draft.
  const draftBefore = await page.evaluate(id => localStorage.getItem('papilot:review-notes:' + id), task.id);
  await inline0.getByRole('tab', { name: 'Concise', exact: true }).click();
  await expect(frame().locator('.change[data-stop="0"]')).toHaveAttribute('data-preview-revision', 'candidate-brief-rejected-neighbor');
  rejectFails = true;
  await frame().locator('.change[data-stop="0"] .actions button.reject').click();
  await expect(inline0.getByRole('alert')).toContainText('The source changed');
  assert.equal(decisions[2].c1, 'pending');
  rejectFails = false;
  await frame().locator('.change[data-stop="0"] .actions button.reject').click();
  await expect.poll(() => decisions[2].c1).toBe('rejected');
  assert.equal(optionWrites.length, 2);
  assert.ok(optionWrites.every(body => body.reject === true && body.accept === undefined && body.option === 'brief'));
  assert.equal(optionWrites[0].id, optionWrites[1].id, 'A retry keeps the same decision identity');
  assert.equal(await page.evaluate(id => localStorage.getItem('papilot:review-notes:' + id), task.id), draftBefore, 'Rejecting never creates a feedback draft');

  // 6. Return to manuscript, undo-return, flight animation, and resubmission on mobile & desktop.
  enableReturns = true;
  const originals = items[0].meta.notes;
  ['accepted', 'rejected', 'missed'].forEach((id, index) => { originals[index].id = id; });
  Object.assign(originals[1], { group: 'yellow', comment: '' });
  originals.push({ ...note('Expand the abbreviation.', 120, ''), id: 'abbreviation' });
  items[0].meta.groupInstructions = { yellow: 'Clarify the contribution.' };
  decisions[1].c1 = 'accepted';
  const preserved = structuredClone(decisions);
  await page.addInitScript(() => {
    window.submittedNoteFlights = [];
    new MutationObserver(records => {
      for (const record of records) for (const card of record.addedNodes) {
        if (card instanceof HTMLElement && card.matches('.submitted-note-flight')) {
          window.submittedNoteFlights.push([card.getAnimations()[0].effect.getTiming().direction, card.dataset.noteKey, card.querySelector('blockquote')?.textContent, card.querySelector('.sent-note-location')?.textContent, Boolean(card.querySelector('button'))]);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const flights = () => page.evaluate(() => window.submittedNoteFlights);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const originalRow = index => page.locator(`[data-note-result="request-1:${index}"]`);
  const toggle = container => container.locator('.note-return-toggle');
  const count = () => page.locator('[data-notes-home="manuscript"]:visible .manuscript-note-count').first();
  await expect(count()).toHaveText('0');
  const takeBack = container => container.getByRole('button', { name: / · Return to manuscript$/ }).click();
  const undoReturn = container => container.getByRole('button', { name: / · Undo return to manuscript$/ }).click();
  failReturn = true;
  await takeBack(originalRow(1));
  await expect(originalRow(1).getByRole('alert')).toHaveText('Retry the return.');
  await expect(originalRow(1)).not.toHaveAttribute('data-returned', 'true');
  failReturn = false;

  // Return from the inline note bar inside the card!
  await originalRow(1).click();
  const inlineRejected = frame().locator('.change[data-stop="1"].current .papilot-inline-note[data-note-key="request-1:1"]');
  await expect(toggle(inlineRejected)).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await takeBack(inlineRejected);
  const cardData = ['request-1:1', originals[1].quote, originals[1].where, false];
  const outward = ['normal', ...cardData];
  await expect.poll(flights).toEqual([outward]);
  await expect(count()).toHaveText('1');
  await expect(toggle(inlineRejected)).toHaveAccessibleName('Note 2 · Undo return to manuscript');
  await page.screenshot({ path: 'test-results/note-return-undo-mobile.png', animations: 'disabled' });

  // Undo return with retry & keyboard shortcut.
  failUndo = true;
  await undoReturn(inlineRejected);
  await expect(inlineRejected.getByRole('alert')).toHaveText('Retry the undo.');
  failUndo = false;
  await undoReturn(inlineRejected);
  await expect.poll(flights).toEqual([outward, ['reverse', ...cardData]]);
  await expect(count()).toHaveText('0');
  await expect(toggle(inlineRejected)).toHaveAccessibleName('Note 2 · Return to manuscript');

  // Re-return, inspect manuscript placement, and resubmit with another missed note.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await takeBack(originalRow(1));
  await expect(originalRow(1)).toHaveAttribute('data-returned', 'true');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.manuscript-link').click();
  const placed = page.locator('.page[data-page-number="2"] .note-tag[data-note="returned-rejected"]');
  await expect(placed).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: /^Revise the introduction/ }).click();
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('papilot:group-instructions', JSON.stringify({ paper: { yellow: 'An unrelated draft.' } })));
  await page.reload();
  await expect(originalRow(1)).toHaveAttribute('data-returned', 'true');
  await takeBack(originalRow(2));
  releaseMissed();
  await expect(originalRow(2)).toHaveAttribute('data-returned', 'true');
  assert.deepEqual(decisions, preserved);
  assert.equal(optionWrites.length, 2, 'Returning a note sends no review decision');

  await page.locator('.manuscript-link').click();
  await expect.poll(() => documentName).toBe('appendix.tex');
  await expect(count()).toHaveText('2');
  await page.getByRole('button', { name: /^My notes/ }).click();
  const library = page.getByRole('complementary', { name: 'PDF note library' });
  await library.locator('[data-note="returned-rejected"]').getByRole('button', { name: /^Include note/ }).click();
  await library.locator('[data-note="returned-missed"]').getByRole('button', { name: /^Include note/ }).click();
  await library.getByRole('button', { name: 'Close notes', exact: true }).click();
  await expect(page.locator('.task-notes-panel')).toContainText('Clarify the contribution.');
  await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect.poll(() => taskWrites.length).toBe(1);
  assert.deepEqual(taskWrites[0].annotations, ['returned-rejected', 'returned-missed']);
  assert.deepEqual(taskWrites[0].groupInstructions, { yellow: 'Clarify the contribution.' });
  assert.deepEqual(errors, []);
  console.log('PASS: Original messages preserved; inline note controls; load retry; live option preview; no writes on option switches; responsive mobile actions; return, undo and resubmit original notes');
} finally { releaseBriefPreview(); releaseMissed(); await browser.close(); await server.close(); }
