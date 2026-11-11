// The README's screenshots of Papilot: the real web UI (dist/), review
// engine and TeX renderer, on a disposable one-page example paper. No
// account, agent or user manuscript is involved: /api/** is answered here
// (the task, its conversation and the Git state are made up), while
// /review/** goes to an in-process review server holding a real round.
//
//   npm run build && npm --prefix engine run build
//   node --import tsx scripts/capture-readme-review.mjs    (Node 22)
//
// It uses Chrome (PAPILOT_BROWSER_CHANNEL picks another channel) or else
// Playwright's Chromium, and writes, in English and Simplified Chinese,
// light and dark:
// - docs/assets/readme-showcase/notes-app{,-dark,-compact,-compact-dark}{,.zh-CN}.png:
//   a box and a highlight on the PDF, both added to the next task, framed as
//   a window on a transparent background like the README's other
//   illustrations. Desktop is the 1280 x 580 macOS app, whose window
//   controls share the toolbar row: the page runs as the desktop shell and
//   the controls are drawn where the shell places them. Compact is a
//   430 x 600 phone, wide enough for its whole marking capsule.
// - test-results/readme-review/review-app{,-dark}-raw{,.zh-CN}.png: the
//   task's review in the desktop app, unframed and without the window
//   controls, whose left 890 px scripts/capture-readme-showcase.mjs puts in
//   the homepage's Papilot card.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { Fixture, METHOD } from '../engine/tests/ts/helpers.ts';
import { Builder } from '../engine/src/core/build.ts';
import { createServer } from '../engine/src/server.ts';
import { pdfWords } from '../src/server/manuscript.ts';
import { annotateReviewState, rewriteReviewHtml, rewriteReviewJson } from '../src/server/review.ts';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const out = path.resolve('docs/assets/readme-showcase');
const rawDir = path.resolve('test-results/readme-review');
fs.mkdirSync(out, { recursive: true });
const before = String.raw`For $c = 2$ this simplifies to $C(2, A) = A^2/(2 + A)$.`;
const after = String.raw`For $c = 2$, the sum in~\eqref{eq:erlang} is $1 + A$. Substituting, then multiplying the numerator and the denominator by $2 - A$, gives
\begin{equation*}
  C(2, A) = \frac{\dfrac{A^2}{2}\,\dfrac{2}{2 - A}}{1 + A + \dfrac{A^2}{2}\,\dfrac{2}{2 - A}}
          = \frac{A^2}{(1 + A)(2 - A) + A^2}
          = \frac{A^2}{2 + A}.
\end{equation*}`;
const f = new Fixture();
let server, reviewServer, browser;
try {
  f.write('paper/main.tex', String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\begin{document}
\input{sections/method}
\section{Discussion}
At this load, a second agent cuts the waiting probability from $0.6$ to $0.14$.
\end{document}
`);
  // The changed sentence opens a subsection: the review shows the changed
  // section from its start, so the change card sits at the top of the review.
  f.write(METHOD, String.raw`\section{Waiting for an agent}
Tasks arrive at rate $\lambda$ and each takes $1/\mu$ minutes on average, so the offered load is $A = \lambda/\mu$. With $c$ agents working in parallel, the probability that a new task has to wait is given by the Erlang C formula
\begin{equation}\label{eq:erlang}
  C(c, A) = \frac{\dfrac{A^c}{c!}\,\dfrac{c}{c - A}}{\displaystyle\sum_{k=0}^{c-1} \frac{A^k}{k!} + \frac{A^c}{c!}\,\frac{c}{c - A}}.
\end{equation}
where the sum runs over the states in which at least one agent is idle.

The formula holds for any number of agents, but its nested fractions hide how quickly the waiting probability falls as agents are added. The smallest interesting case makes this concrete.

\subsection{Two agents}
${before}

Starting a task every ten minutes, each taking six, gives $A = 0.6$ and $C(2, A) \approx 0.14$.
`);
  f.repo.run(['add', '.']); f.repo.run(['commit', '-qm', 'Add README example']);
  const app = f.app(); await app.ready;
  const proposal = app.tasks.create('readme-demo', 'Show the derivation for two agents', [], ['paper'], true);
  f.edit(proposal, METHOD, before, after);
  app.publisher.submit(proposal.name); await app.publisher.join();
  assert.equal(app.publisher.current(proposal.name)?.status, 'done');
  const builder = new Builder(app.project, app.repo);
  const built = await builder.build(proposal.base);
  // The round compiled the whole new version: the task's PDF, which the
  // review keeps beside its changes.
  const round = app.review.latestRound(proposal.name);
  const revised = await builder.completed(round.summary.builds.at(-1));
  assert.ok(revised?.pdf, 'The review round has a PDF of the new version');
  const words = await pdfWords(built.pdf, 0);
  reviewServer = createServer(app); await reviewServer.ready();
  server = Fastify(); await server.register(staticFiles, { root: path.resolve('dist') });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  const channel = process.env.PAPILOT_BROWSER_CHANNEL || 'chrome';
  browser = await chromium.launch({ channel, headless: true }).catch(() => chromium.launch({ headless: true }));
  const now = Date.UTC(2026, 10, 5, 12);
  const runtime = { connected: true, authenticated: true, account: null, error: null, installed: true, models: [] };
  const task = { id: 'readme-task', projectId: 'paper', name: proposal.name, title: proposal.title, instructions: '', agent: 'codex', model: null,
    worktree: proposal.worktree, threadId: 'thread', turnId: null, status: 'reviewing', createdAt: now, updatedAt: now, feedbackCursor: 0, error: null,
    review: app.review.summary(proposal.name) };
  const git = { branch: 'main', upstream: 'origin/main', remote: true, ahead: 0, behind: 0, head: { hash: 'a'.repeat(40), subject: 'Add the waiting-time model', date: now }, files: [] };
  const [W, H] = [words.width, words.height], list = words.words;
  const lineOf = index => list.filter(word => Math.abs(word[2] - list[index][2]) < 1 && word[1] >= list[index][1]);
  const box = items => [Math.min(...items.map(w => w[1])) / W, Math.min(...items.map(w => w[2] - w[3])) / H, Math.max(...items.map(w => w[1] + w[4])) / W, Math.max(...items.map(w => w[2])) / H];
  const sentence = lineOf(list.findIndex((word, i) => word[0] === 'For' && list.slice(i, i + 6).some(w => w[0] === 'this')));
  const formula = list.findIndex(word => word[0].startsWith('formula')), where = list.findIndex(word => word[0] === 'where');
  const display = list.slice(formula + 1, where).filter(word => !/^\(\d+\)$/.test(word[0]));
  const region = box(display), pad = [0.012, 0.006];
  // English and Simplified Chinese get their own captures; the example paper
  // stays in English, as many papers are.
  const copy = {
    en: { language: 'en', locale: 'en-US', suffix: '',
      request: 'This step skips the algebra. Show how the formula reduces for two agents.',
      response: 'Added the derivation for C(2, A): substitute c = 2, clear the fractions, and cancel terms to reach A²/(2 + A). Only the marked sentence changed. Review the typeset comparison, then accept it or leave a comment.',
      notes: ['Say what A and c stand for right under the formula.', 'This step skips the algebra. Show how it reduces for two agents.'] },
    'zh-CN': { language: 'zh-Hans', locale: 'zh-CN', suffix: '.zh-CN',
      request: '这一步跳过了推导。写出两个智能体时公式是怎么化简的。',
      response: '已补上 C(2, A) 的推导：代入 c = 2，消去分式，约分得到 A²/(2 + A)。只改了标出的这句话。请查看排版后的修改对比，然后接受或留下评论。',
      notes: ['在公式下面说明 A 和 c 分别代表什么。', '这一步跳过了推导，写出两个智能体时是怎么化简的。'] },
  };
  const notesFor = text => [
    { id: 'note-1', projectId: 'paper', key: 'readme-example', page: 0, rect: [region[0] - pad[0], region[1] - pad[1], region[2] + pad[0], region[3] + pad[1]], rects: [], quote: '', comment: text.notes[0], source: null, createdAt: now },
    { id: 'note-2', projectId: 'paper', key: 'readme-example', page: 0, rect: box(sentence), rects: [box(sentence)], quote: 'For c = 2 this simplifies to C(2, A) = A²/(2 + A).', comment: text.notes[1], source: null, createdAt: now + 1 },
  ];
  const snapshot = { version, csrf: 'fixture', gitAvailable: true, projects: [{ id: 'paper', name: 'Queueing notes', path: '/example/paper', createdAt: now }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime } };

  async function capture(text, scheme, file, phone = false, view = 'review') {
    const notes = notesFor(text);
    const viewport = phone ? { width: 430, height: 600 } : { width: 1280, height: 580 };
    const page = await browser.newPage({ locale: text.locale, colorScheme: scheme, viewport, deviceScaleFactor: phone ? 3 : 2, isMobile: phone, hasTouch: phone });
    page.setDefaultTimeout(15000);
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      const json = value => route.fulfill({ json: value });
      if (p === '/api/state') return json(snapshot);
      if (p === '/api/runtime/requirements') return json(readyRequirements);
      if (p === '/api/quick-notes') return json({ quickNotes: null });
      if (p === '/api/indirect-changes') return json({ indirectChanges: false });
      if (p === '/api/note-alternatives') return json({ noteAlternatives: false, noteAlternativeRange: 'few' });
      if (p === '/api/updates') return json({ currentVersion: version, latestVersion: null, phase: 'idle', checkedAt: now, error: null, canUpdate: false });
      if (p.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': preview\n\n' });
      if (p.endsWith('/skills')) return json({ skills: [] });
      if (p.endsWith('/items')) return json({ items: [
        { id: 'request', taskId: task.id, type: 'user', text: text.request, createdAt: now },
        { id: 'response', taskId: task.id, type: 'assistant', text: text.response, createdAt: now + 1000 },
      ] });
      if (p.endsWith('/note-results')) return json({ notes: [] });
      if (p.endsWith('/predict')) return json({ ok: true });
      if (p.endsWith('/git')) return json(git);
      if (p.endsWith('/manuscript')) return json({ git, build: { status: 'ready', current: true, key: 'readme-example', pages: [[words.width, words.height]], builtAt: now, problems: { errors: 0, warnings: 0, minor: 0 } }, annotations: view === 'notes' ? notes : [] });
      if (p.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync(built.pdf) });
      if (p.endsWith('/manuscript/words')) return json(words);
      if (p === `/api/tasks/${task.id}/pdf`) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync(revised.pdf) });
      // Fails the capture below, after the page has had its say.
      unexpected.push(p);
      return route.fulfill({ status: 404, json: { error: 'Not in the screenshot fixture.' } });
    });
    await page.route('**/review/paper/**', async route => {
      const url = new URL(route.request().url()), relative = url.pathname.slice('/review/paper'.length);
      // Papilot itself serves the round's complete PDF, for the review's full paper.
      if (/^\/pdf\/[^/]+\/\d+$/.test(relative)) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync(revised.pdf) });
      if (/^\/pdf\/[^/]+\/\d+\/passes$/.test(relative)) return route.fulfill({ json: { pass: null } });
      const response = await reviewServer.inject({ method: route.request().method(), url: relative + url.search, headers: { host: '127.0.0.1:9', 'x-review-token': app.csrf }, payload: route.request().postData() || undefined });
      let body = response.rawPayload;
      if (relative === '/') body = rewriteReviewHtml(response.body, '/review/paper');
      if (String(response.headers['content-type']).includes('application/json')) {
        const value = response.json(), rounds = /^\/api\/tasks\/([a-z0-9-]+)\/rounds\/(\d+)$/.exec(relative);
        if (rounds) Object.assign(value, { pdf: `/review/paper/pdf/${rounds[1]}/${rounds[2]}`, passes: `/review/paper/pdf/${rounds[1]}/${rounds[2]}/passes` });
        body = JSON.stringify(annotateReviewState(rewriteReviewJson(value, '/review/paper'), [task]));
      }
      await route.fulfill({ status: response.statusCode, contentType: String(response.headers['content-type'] || 'application/octet-stream'), body });
    });
    await page.addInitScript(([language, selected, notes, desktop]) => {
      // The macOS desktop shell (desktop/preload.cts): its toolbar row keeps
      // room for the window controls.
      if (desktop) window.papilotDesktop = { platform: 'darwin', minimize() {}, maximize() {}, close() {} };
      localStorage.setItem('papilot:language', language);
      localStorage.setItem('papilot:project', 'paper');
      localStorage.setItem('papilot:setup-seen', '1');
      // An empty task opens the manuscript.
      localStorage.setItem('papilot:task', selected);
      // The page is the subject: the task list is hidden.
      localStorage.setItem('papilot:sidebar', 'hidden');
      // Both notes are added to the next task, as after "Add to task".
      if (notes) localStorage.setItem('papilot:selected-notes', JSON.stringify({ paper: ['note-1', 'note-2'] }));
    }, [text.language, view === 'notes' ? '' : task.id, view === 'notes', !phone]);
    await page.goto(origin);
    if (view === 'notes') {
      await page.locator('.textLayer span').first().waitFor();
      await expect(page.locator('.note-box, .note-mark').first()).toBeVisible();
      // Scroll past most of the top margin, so the whole text fits the window.
      if (!phone) await page.locator('.pdf-container').evaluate(box => {
        const top = Math.min(...[...box.querySelectorAll('.textLayer span')].map(span => span.getBoundingClientRect().top));
        box.scrollTop += top - box.getBoundingClientRect().top - 52;
      });
    } else {
      const viewer = page.frameLocator('.review-frame');
      await expect(viewer.locator('.change').first()).toBeVisible({ timeout: 30000 });
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.fonts.ready);
    for (const frame of page.frames()) {
      await expect.poll(() => frame.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    }
    const raw = await page.screenshot({ animations: 'disabled' });
    // The homepage card in the README's first section reuses the unframed capture.
    if (!phone && view === 'review') { fs.mkdirSync(rawDir, { recursive: true }); fs.writeFileSync(path.join(rawDir, `review-app${scheme === 'dark' ? '-dark' : ''}-raw${text.suffix}.png`), raw); }
    assert.deepEqual(errors, []);
    assert.deepEqual([...new Set(unexpected)], [], 'Requests this script does not answer');
    await page.close();
    if (!file) return;

    // Frame the capture as a window, as the homepage draws Papilot. On a Mac
    // the window controls sit in the toolbar row, where desktop/main.ts puts
    // them (trafficLightPosition 18, 16).
    const frame = await browser.newPage({ colorScheme: scheme, viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const dark = scheme === 'dark';
    await frame.setContent(`<style>
      html,body{margin:0;background:transparent}
      .window{position:absolute;left:48px;top:40px;width:${viewport.width}px;border-radius:${phone ? 28 : 12}px;overflow:hidden;
        border:1px solid ${dark ? '#3a3a3c' : '#d9d9de'};background:${dark ? '#1c1c1e' : '#fff'};
        box-shadow:0 1px 2px rgb(0 0 0/${dark ? '.3' : '.06'}),0 28px 56px -18px ${dark ? 'rgb(0 0 0/.6)' : 'rgb(15 23 42/.22)'}}
      .lights{position:absolute;left:18px;top:16px;display:flex;gap:8px}
      .lights i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgb(0 0 0/.16)}
      .phone .lights{display:none}
      img{display:block;width:${viewport.width}px}
    </style><div class="window${phone ? ' phone' : ''}"><img src="data:image/png;base64,${raw.toString('base64')}"><span class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span></div>`);
    await frame.evaluate(() => document.querySelector('img').decode());
    const box = await frame.locator('.window').boundingBox();
    await frame.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: box.x - 40, y: box.y - 32, width: box.width + 80, height: box.height + 80 } });
    await frame.close();
    console.log('Captured', file);
  }
  // The review appears inside the README's homepage card, so it is kept unframed.
  for (const text of Object.values(copy)) {
    await capture(text, 'light', null);
    await capture(text, 'dark', null);
    await capture(text, 'light', `notes-app${text.suffix}.png`, false, 'notes');
    await capture(text, 'dark', `notes-app-dark${text.suffix}.png`, false, 'notes');
    await capture(text, 'light', `notes-app-compact${text.suffix}.png`, true, 'notes');
    await capture(text, 'dark', `notes-app-compact-dark${text.suffix}.png`, true, 'notes');
  }
} finally {
  await browser?.close(); await server?.close(); await reviewServer?.close(); await f.close();
}
