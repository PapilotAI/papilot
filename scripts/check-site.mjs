// Verify the landing page's windows and layout, using an isolated static server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, webkit } from '../engine/node_modules/playwright/index.mjs';
import { checkAnnotations } from './site-annotation-checks.mjs';
import { checkSiteTheme } from './site-theme-checks.mjs';
import { checkSiteDocs } from './site-docs-checks.mjs';
import { loadBlogPosts, blogLocales } from './site-blog.mjs';
import { loadGuideManifest, guideLocales } from './site-docs.mjs';
import { AGENT_IDS } from '../src/shared.ts';

const languages = JSON.parse(fs.readFileSync('i18n/languages.json', 'utf8'));
// Built-in writing, orchestration, and manual web relay modes are not external coding agents.
const codingAgents = AGENT_IDS.filter(id => id !== 'papilot' && id !== 'collaboration' && id !== 'chatgpt');
const checkAgentRoster = async page => {
  const grid = page.getByRole('list').filter({ has: page.locator('.agent') });
  assert.deepEqual(await grid.getByRole('listitem').evaluateAll(items => items.map(item => [...item.classList].find(name => name !== 'agent'))), codingAgents, 'the homepage lists every supported coding agent');
  assert.equal(await grid.locator('i[aria-hidden="true"]').count(), codingAgents.length, 'brand marks do not duplicate the visible names');
};
const route = locale => locale === 'en' ? '/' : `/${locale}/`;
const universe = 'https://papilot.ai/universe/';
const server = Fastify();
server.get('/api/github-stars', async () => ({ stars: Number(process.env.PAPILOT_SITE_STARS || 0) }));
await server.register(staticFiles, { root: path.resolve('_site') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = process.env.PAPILOT_BROWSER_ENGINE === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [], requests = [];
fs.mkdirSync('test-results/site', { recursive: true });
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  page.setDefaultTimeout(20000);
};
const hero = '.hero .app-window', change = `${hero} .review-change`;
const stateOf = page => page.locator(change).getAttribute('data-state');
try {
  await checkSiteTheme(browser, origin, watch);
  await checkAnnotations(browser, origin);
  await checkSiteDocs(browser, origin);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.bringToFront();
  await page.mouse.move(0, 0);
  watch(page);
  await page.goto(`${origin}/?lang=en`);
  await page.evaluate(() => document.fonts.ready);

  // The first screen is the headline, the window and the downloads; the
  // arrow sits on it and leads to the features just below.
  const fold = await page.evaluate(() => ({
    cue: document.querySelector('.scroll-cue').getBoundingClientRect().bottom,
    features: document.querySelector('#features').getBoundingClientRect().top,
    inner: innerHeight,
  }));
  assert.ok(fold.cue <= fold.inner && fold.features >= fold.inner - 1, 'the first screen holds the hero');
  assert.equal(await page.locator('.scroll-cue').getAttribute('href'), '#features');
  assert.equal(await page.locator('video').count(), 0);

  // The left navigation is Universe, Docs and Blog; the demo stays on the right.
  const anchors = await page.locator('.nav a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  assert.deepEqual(anchors, [universe, '/guide/', '/blog/']);
  assert.equal(await page.locator('.topbar-actions > .topbar-demo').getAttribute('href'), '/demo');
  assert.equal(await page.locator('.brand + .nav > .topbar-universe').getAttribute('href'), universe);
  assert.equal(await page.getByRole('link', { name: 'Universe', exact: true }).count(), 2, 'the decorative icon does not change the link name');
  assert.equal(await page.locator('.topbar-demo + #theme-button').count(), 1);
  assert.equal(await page.locator('.topbar-demo').innerText(), 'Try online demo');
  assert.equal(await page.locator('.hero .actions a[href="/demo"]').count(), 0);

  // A round plays by itself: the plain sentence, a boxed note, the diff, and
  // the accepted sentence, without the headline or the window moving.
  assert.equal(await stateOf(page), 'idle');
  const still = async () => page.evaluate(sel => [document.querySelector('h1').getBoundingClientRect().top, document.querySelector(sel).getBoundingClientRect().height], hero);
  const start = await still();
  await page.waitForFunction(sel => document.querySelector(sel).dataset.state === 'pending', change);
  assert.deepEqual(await still(), start);
  assert.equal(await page.locator(`${hero} .chat-bubble`).isVisible(), true);
  await page.locator(hero).screenshot({ path: 'test-results/site/hero-diff.png' });
  await page.waitForFunction(sel => document.querySelector(sel).dataset.state === 'accepted', change);
  await page.waitForTimeout(700);
  assert.deepEqual(await still(), start);
  assert.equal(await page.locator(`${change} .review-head`).isVisible(), false, 'a decided change has no header');
  await page.locator(hero).screenshot({ path: 'test-results/site/hero-accepted.png' });

  // Touching the window stops the round on the diff; decisions leave plain
  // text that reopens on a click, and LaTeX shows the source.
  await page.reload();
  await page.locator(change).click();
  assert.equal(await page.locator(hero).evaluate(el => el.classList.contains('playing')), false);
  assert.equal(await stateOf(page), 'pending');
  await page.locator(`${change} .review-accept`).click();
  await page.locator(`${change} .before`).waitFor({ state: 'hidden' });
  await page.locator(`${change} .review-head`).waitFor({ state: 'hidden' });
  await page.locator(change).click();
  await page.locator(`${change} .review-reject`).click();
  await page.locator(`${change} .after`).waitFor({ state: 'hidden' });
  await page.locator(change).click();
  assert.equal(await stateOf(page), 'pending');
  await page.locator(`${change} .review-latex`).click();
  assert.equal(await page.locator(`${change} .review-source`).isVisible(), true);

  // Every agent is listed under Any Agent, Any Model and shows at once; on
  // screen they arrive, then one at a time lights up.
  const grid = page.locator('.agent-grid');
  await checkAgentRoster(page);
  assert.equal(await page.locator('.feature:has([data-scene=models]) .feature-text > .agent-grid').count(), 1, 'the agents are listed with any agent, any model');
  await grid.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.agent-grid.arrived'));
  const view = await page.evaluate(() => innerHeight);
  for (const box of await grid.locator('li').evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()))) assert.ok(box.top > 0 && box.bottom < view, 'every agent is in view at once');

  // The feature windows are pictures: named, with nothing to focus inside,
  // and each plays its round once on screen, at a fixed height.
  const scenes = page.locator('.scene');
  assert.equal(await scenes.count(), 6);
  assert.equal(await page.locator('.scene-art :is(a, button, input, textarea, [tabindex])').evaluateAll(nodes => nodes.filter(node => !node.closest('[inert]')).length), 0);
  for (const name of ['notes', 'revise', 'models', 'record', 'phone', 'template']) {
    const scene = page.locator(`[data-scene=${name}]`);
    assert.equal(await scene.getAttribute('role'), 'img');
    assert.ok(await scene.getAttribute('aria-label'));
    await scene.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    const height = (await scene.boundingBox()).height;
    await page.waitForFunction(sel => document.querySelector(sel).classList.contains('playing'), `[data-scene=${name}]`);
    await page.waitForTimeout(5000);
    assert.equal((await scene.boundingBox()).height, height, `${name} keeps its height`);
    assert.equal(await scene.locator('.app-cursor').isVisible(), true, `${name} plays`);
    await scene.screenshot({ path: `test-results/site/${name}-desktop.png` });
  }

  // Live sync with Overleaf plays both ways: the change committed in Papilot
  // reaches the coauthor's editor, then the sentence typed there reaches the
  // PDF, without the stage changing height.
  const sync = page.locator('[data-scene=overleaf]'), syncStep = step => page.waitForFunction(value => document.querySelector('[data-scene=overleaf]').dataset.step === value, step);
  assert.equal(await sync.getAttribute('role'), 'img');
  assert.ok(await sync.getAttribute('aria-label'));
  await sync.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const syncHeight = (await sync.boundingBox()).height;
  await syncStep('review');
  assert.equal(await sync.locator('.ol-new').isVisible(), false, 'Overleaf has the old sentence while the change waits');
  assert.equal(await sync.locator('.theirs').isVisible(), false);
  await syncStep('sent');
  assert.equal(await sync.locator('.ol-new').isVisible(), true, 'the committed change reaches Overleaf');
  assert.equal(await sync.locator('.sync-committed').isVisible(), true, 'the change was committed before it was sent');
  await syncStep('synced');
  assert.equal(await sync.locator('.theirs').isVisible(), true, "the coauthor's sentence reaches the PDF");
  assert.equal((await sync.boundingBox()).height, syncHeight, 'the sync stage keeps its height');
  await sync.screenshot({ path: 'test-results/site/overleaf-desktop.png' });

  // The README's reasons follow the hero in its order, then the downloads.
  const order = await page.evaluate(() => ['#features', '#overleaf', '#record', '#anywhere', '#download'].map(id => document.querySelector(id).getBoundingClientRect().top));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the reasons, in order, then the downloads');
  assert.deepEqual(await page.locator('.scene').evaluateAll(apps => apps.map(app => app.dataset.scene)), ['notes', 'revise', 'models', 'record', 'phone', 'template'], 'each reason is a feature, in order');

  // Picking another agent's model in the menu keeps the task's conversation,
  // and the next request goes to the new agent.
  const models = page.locator('[data-scene=models]'), modelsStep = step => page.waitForFunction(value => document.querySelector('[data-scene=models]').dataset.step === value, step);
  await models.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await modelsStep('menu');
  assert.equal(await models.locator('.model-menu').isVisible(), true, 'the model menu opens below the chat');
  await modelsStep('switched');
  assert.equal(await models.locator('.models-chip b').innerText(), 'Claude');
  assert.equal(await models.locator('.chat-bubble').first().isVisible(), true, 'the conversation stays in the task');
  assert.equal(await models.locator('.chat-reply.chat-old').isVisible(), true, "the first agent's reply stays too");
  await modelsStep('done');
  assert.deepEqual(await models.locator('.chat-thread > *').evaluateAll(items => items.filter(item => item.checkVisibility()).map(item => item.className)), ['chat-bubble', 'chat-reply chat-old', 'chat-bubble models-follow', 'chat-reply models-answer'], 'the next request and its answer follow the same conversation');
  assert.equal(await models.getByText(/Restarted/).count(), 0, 'switching agents does not restart the task');

  // On the phone a tap accepts each change in turn, and the capsule then
  // gives way to the annotation tools.
  const handset = page.locator('[data-scene=phone]');
  await handset.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.querySelectorAll('[data-scene=phone] .review-change[data-state=accepted]').length === 1);
  assert.equal(await handset.locator('.phone-count').innerText(), '2 / 2', 'the next change is current');
  await page.waitForFunction(() => document.querySelectorAll('[data-scene=phone] .review-change[data-state=accepted]').length === 2);
  assert.equal(await handset.locator('.phone-tools').isVisible(), true, 'the tools return once nothing is left to decide');
  assert.equal(await handset.locator('.phone-decide').isVisible(), false);

  // Searching a conference in the New paper dialog finds the template its
  // call for papers asks for; Create paper opens the new paper.
  const template = page.locator('[data-scene=template]'), templateStep = step => page.waitForFunction(value => document.querySelector('[data-scene=template]').dataset.step === value, step);
  await template.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await templateStep('found');
  assert.equal(await template.locator('.np-found').isVisible(), true, 'the search shows its results');
  assert.equal(await template.locator('.np-all').isVisible(), false);
  assert.deepEqual(await template.locator('.np-found .np-name').allInnerTexts(), ['POPL 2027', 'PACMPL (POPL, PLDI, ICFP, OOPSLA)']);
  await templateStep('details');
  assert.equal(await template.locator('.np-details').isVisible(), true, 'picking the template asks for a name and a folder');
  assert.equal(await template.locator('.np-pick').isVisible(), false);
  assert.equal(await template.locator('.np-chosen .np-chosen-text b').innerText(), 'POPL 2027');
  await templateStep('creating');
  assert.equal(await template.locator('.np-target b').innerText(), 'soundness', 'the paper is named before it is created');
  await templateStep('created');
  assert.equal(await template.locator('.np-new').isVisible(), true, 'the new paper is in the PDF');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-scene=template] .np-dialog')).visibility === 'hidden');

  // Every reason to use Papilot leads somewhere: the agents' setup, a next
  // step for each feature, Overleaf sync, templates and remote access, and
  // each guide link names a section the guide has.
  const guide = 'https://github.com/PapilotAI/papilot/blob/main/docs/guide.md';
  for (const [selector, href] of [['.feature:has([data-scene=models]) .feature-link a', `${guide}#agents`], ['.hero-overleaf', '#overleaf'], ['#overleaf .section-links a', `${guide}#sync-with-overleaf`], ['.get-links a:first-child', '/guide/']]) {
    assert.equal(await page.locator(selector).getAttribute('href'), href, selector);
  }
  assert.equal(await page.locator('.feature-link a').count(), 6, 'each feature has a next step');
  assert.deepEqual(await page.locator('#anywhere .feature-link a').evaluateAll(links => links.map(link => link.getAttribute('href'))), [`${guide}#remote-access-with-tailscale`, universe]);
  const slug = heading => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
  const guideSource = fs.readFileSync('docs/guide.md', 'utf8');
  const sections = new Set([
    ...guideSource.split('\n').filter(line => /^#{1,6} /.test(line)).map(line => slug(line.replace(/^#+ /, ''))),
    ...[...guideSource.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]),
  ]);
  for (const href of await page.locator(`a[href^="${guide}#"]`).evaluateAll(links => links.map(link => link.getAttribute('href')))) {
    assert.ok(sections.has(href.split('#')[1]), `the guide has a section for ${href}`);
  }

  // Reduced motion: nothing plays; the hero shows the sent note and the
  // diff, and the ticker stands still.
  const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const calmPage = await calm.newPage();
  watch(calmPage);
  await calmPage.goto(origin + '/');
  await calmPage.waitForTimeout(3000);
  assert.equal(await calmPage.locator('.playing').count(), 0);
  assert.equal(await stateOf(calmPage), 'pending');
  assert.equal(await calmPage.locator('.agent-grid.waiting').count(), 0, 'the agents stand in colour');
  assert.equal(await calmPage.locator('[data-scene=overleaf]').getAttribute('data-step'), 'synced', 'the sync shows where its round ends');
  for (const selector of ['.ol-new', '.theirs', '.sync-committed']) assert.equal(await calmPage.locator(`[data-scene=overleaf] ${selector}`).isVisible(), true, selector);
  assert.equal(await calmPage.locator('[data-scene=phone] .review-change[data-state=pending]').count(), 2, 'the phone shows the changes to decide');
  assert.equal(await calmPage.locator('[data-scene=template]').getAttribute('data-step'), 'found', 'the dialog shows the search');
  assert.equal(await calmPage.locator('[data-scene=template] .np-query').innerText(), 'POPL');
  await calmPage.locator(`${change} .review-accept`).click();
  assert.equal(await calmPage.locator(`${change} .before`).isVisible(), false, 'decisions are immediate');
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark']) for (const locale of ['en', 'zh-CN']) {
    await calmPage.setViewportSize({ width, height: 900 });
    await calmPage.emulateMedia({ colorScheme });
    await calmPage.goto(origin + route(locale));
    await checkAgentRoster(calmPage);
    // CSS masks load separately from the DOM; wait for the actual artwork
    // before capturing the entire support grid in both themes and layouts.
    await calmPage.locator('.agent i').evaluateAll(async icons => {
      await document.fonts.ready;
      await Promise.all(icons.map(async icon => {
        const mask = getComputedStyle(icon, '::before').maskImage;
        const url = mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        if (!url) throw new Error(`Missing agent icon: ${icon.parentElement.textContent}`);
        const image = new Image();
        image.src = url;
        await image.decode();
      }));
    });
    await calmPage.locator('#agents').screenshot({ path: `test-results/site/agents-${locale}-${width}-${colorScheme}.png` });
  }
  await calm.close();

  // Without JavaScript every window shows where its round ends.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin);
  for (const selector of [`${change} .before`, `${change} .after`, `${hero} .chat-bubble`, '[data-scene=record] .git-pushed', '[data-scene=overleaf] .ol-new', '[data-scene=overleaf] .theirs', '[data-scene=models] .models-follow', '[data-scene=phone] .review-change:last-of-type .before', '[data-scene=phone] .phone-decide', '[data-scene=template] .np-popl']) assert.equal(await staticPage.locator(selector).isVisible(), true, selector);
  await staticPage.locator(hero).screenshot({ path: 'test-results/site/no-js.png' });
  await noJs.close();

  // Every URL is already localized without JavaScript, with reciprocal SEO links.
  const sitemap = fs.readFileSync('_site/sitemap.xml', 'utf8');
  assert.match(fs.readFileSync('_site/robots.txt', 'utf8'), /Sitemap: https:\/\/papilot.ai\/sitemap.xml/);
  const blogPages = blogLocales.length + loadBlogPosts(process.cwd()).reduce((count, post) => count + Object.keys(post.locales).length, 0);
  const guidePages = guideLocales.length * (1 + loadGuideManifest(process.cwd()).pages.length);
  assert.equal((sitemap.match(/<url>/g) || []).length, Object.keys(languages).length + 1 + blogPages + guidePages);
  const homeSitemap = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]).filter(entry => Object.keys(languages).some(locale => entry.startsWith(`<loc>https://papilot.ai${route(locale)}</loc>`))).join('');
  assert.ok(sitemap.includes('<loc>https://papilot.ai/privacy/</loc>'));
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticVisitor = await staticContext.newPage();
  for (const [locale] of Object.entries(languages)) {
    await staticVisitor.goto(origin + route(locale));
    await checkAgentRoster(staticVisitor);
    const canonical = 'https://papilot.ai' + route(locale);
    assert.equal(await staticVisitor.locator('html').getAttribute('lang'), locale);
    assert.equal(await staticVisitor.locator('link[rel=canonical]').getAttribute('href'), canonical);
    assert.equal(await staticVisitor.locator('meta[property="og:url"]').getAttribute('content'), canonical);
    assert.equal(await staticVisitor.locator('meta[property="og:title"]').getAttribute('content'), await staticVisitor.title());
    for (const selector of ['meta[name=description]', 'meta[property="og:description"]', 'meta[property="og:locale"]']) assert.ok(await staticVisitor.locator(selector).getAttribute('content'));
    for (const alt of [...Object.keys(languages), 'x-default']) {
      const href = 'https://papilot.ai' + route(alt === 'x-default' ? 'en' : alt);
      assert.equal(await staticVisitor.locator(`link[hreflang="${alt}"]`).getAttribute('href'), href);
      assert.equal((homeSitemap.match(new RegExp(`hreflang="${alt}"`, 'g')) || []).length, Object.keys(languages).length);
      assert.ok(sitemap.includes(`hreflang="${alt}" href="${href}"`));
    }
    assert.deepEqual(await staticVisitor.locator('main [lang]').evaluateAll(nodes => [...new Set(nodes.map(node => node.lang))]), [locale]);
    assert.equal(await staticVisitor.locator('.no-js-languages a').count(), Object.keys(languages).length);
    // The shared template library is outside this static build. Every locale
    // links to it directly, including on phones and without JavaScript.
    for (const selector of ['.nav', '.hero-note', '.footer nav']) {
      assert.equal(await staticVisitor.locator(`${selector} a[href="${universe}"]`).count(), 1, `${locale}: ${selector} links to Universe`);
    }
    const wechat = 'https://papilot.ai/wechat/';
    assert.equal(await staticVisitor.locator(`.topbar a.wechat-link[href="${wechat}"]`).count(), locale === 'zh-CN' ? 1 : 0, `${locale}: WeChat header link only on zh-CN`);
    assert.equal(await staticVisitor.locator(`.footer nav a[href="${wechat}"]`).count(), locale === 'zh-CN' ? 1 : 0, `${locale}: WeChat footer link only on zh-CN`);
    assert.equal(await staticVisitor.locator('.hero-universe').isVisible(), true, `${locale}: templates remain discoverable on phones`);
    assert.equal(await staticVisitor.locator('.hero-star').isVisible(), true, `${locale}: GitHub star CTA remains discoverable on phones`);
    assert.equal(await staticVisitor.locator('.hero-star').getAttribute('href'), 'https://github.com/PapilotAI/papilot');
    // CI builds with PAPILOT_SITE_STARS=12345; local builds have no count.
    const stars = staticVisitor.locator('.topbar .github-link .github-count');
    assert.equal(await stars.count(), process.env.PAPILOT_SITE_STARS ? 1 : 0, `${locale}: the header shows the star count only when the build has one`);
    if (process.env.PAPILOT_SITE_STARS === '12345') assert.equal(await stars.innerText(), '12.3k', `${locale}: phones see the abbreviated star count`);
    assert.equal(await staticVisitor.locator('.topbar-universe').isVisible(), true, `${locale}: Universe stays in the phone header without JavaScript`);
  }
  // Exercise native keyboard navigation without depending on the live service.
  await staticVisitor.route(universe, request => request.fulfill({ contentType: 'text/html', body: '<h1>Universe templates</h1>' }));
  for (const width of [1440, 390]) {
    await staticVisitor.setViewportSize({ width, height: 900 });
    await staticVisitor.goto(origin);
    const link = staticVisitor.locator('.topbar-universe');
    await link.focus();
    await Promise.all([staticVisitor.waitForURL(universe), link.press('Enter')]);
    assert.equal(await staticVisitor.getByRole('heading', { name: 'Universe templates' }).isVisible(), true);
  }
  await staticContext.close();

  // The language menu switches pages; browser language never redirects, a
  // saved choice does at the root, and an explicit URL wins.
  const preferenceContext = await browser.newContext({ locale: 'ja-JP' });
  const visitor = await preferenceContext.newPage();
  await visitor.goto(origin);
  assert.equal(await visitor.locator('html').getAttribute('lang'), 'en', 'browser language does not redirect');
  await visitor.locator('#lang-button').click();
  await Promise.all([visitor.waitForURL(origin + '/ja/'), visitor.getByRole('menuitemradio', { name: languages.ja, exact: true }).click()]);
  await visitor.goto(origin);
  await visitor.waitForURL(origin + '/ja/');
  await visitor.goto(origin + '/de/');
  assert.equal(await visitor.locator('html').getAttribute('lang'), 'de', 'explicit URL wins over saved choice');
  await visitor.locator('#lang-button').click();
  await visitor.keyboard.press('Escape');
  assert.equal(await visitor.locator('#lang-list').isHidden(), true);
  await preferenceContext.close();

  // Both download menus open on their own, end with All downloads, stay
  // inside the window (opening upward without room below) and close with Escape.
  for (const [width, height] of [[1440, 900], [1280, 760], [390, 664]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/');
    for (const [button, list] of [['#download-button', '#download-list'], ['#get-button', '#get-list']]) {
      await page.locator(button).scrollIntoViewIfNeeded();
      await page.locator(button).click();
      assert.equal(await page.locator('.download-list:visible').count(), 1, `${list} opens alone`);
      const box = await page.locator(list).boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height, `${list} inside the window at ${width}×${height}`);
      assert.equal(await page.locator(`${list} [role=menuitem]`).last().getAttribute('href'), 'https://github.com/PapilotAI/papilot/releases/latest');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator(list).isHidden(), true, `${list} closes`);
    }
  }

  // Windows visitors get both native downloads first, in either menu and
  // every language, with a usable button and menu on small screens too.
  const windowsContext = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', reducedMotion: 'reduce' });
  const windowsPage = await windowsContext.newPage();
  watch(windowsPage);
  const version = process.env.PAPILOT_SITE_RELEASE ?? JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  for (const width of [1440, 320]) {
    await windowsPage.setViewportSize({ width, height: 900 });
    for (const locale of Object.keys(languages)) {
      await windowsPage.goto(origin + route(locale));
      await windowsPage.evaluate(() => document.fonts.ready);
      assert.equal(await windowsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Windows ${locale}/${width}: no sideways scroll`);
      for (const [button, list] of [['#download-button', '#download-list'], ['#get-button', '#get-list']]) {
        assert.match(await windowsPage.locator(button).innerText(), /Windows/);
        await windowsPage.locator(button).click();
        assert.equal(await windowsPage.locator(`${list} .download-group`).first().getAttribute('data-os'), 'windows');
        const downloads = await windowsPage.locator(`${list} [data-download-platform=windows]`).evaluateAll(links => links.map(link => link.href));
        assert.deepEqual(downloads, ['', '-portable'].map(suffix => `https://github.com/PapilotAI/papilot/releases/download/v${version}/Papilot-${version}-win-x64${suffix}.exe`));
        const box = await windowsPage.locator(list).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900, `Windows ${locale}/${width}: ${list} fits`);
        if (button === '#download-button' && ['en', 'zh-CN'].includes(locale)) await windowsPage.screenshot({ path: `test-results/site/windows-${locale}-${width}.png` });
        await windowsPage.keyboard.press('Escape');
      }
    }
  }
  await windowsContext.close();

  // Every language fits at every width: no sideways scroll, the first screen
  // still holds the hero, and buttons, menus, cards and windows fit.
  for (const width of [1440, 1200, 1121, 1081, 961, 768, 601, 600, 561, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const locale of Object.keys(languages)) {
      await page.goto(origin + route(locale));
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}/${width}: no sideways scroll`);
      await page.locator('#download-button').click();
      for (const selector of ['.topbar-inner', '.topbar .brand', '.nav', '.topbar-universe', '.topbar-demo', '.topbar .github-link', '.hero-overleaf', '.hero-universe', '.hero-star', '#download-button', '#download-list', '.agent-grid', '.agent-grid li', '.app-window', '.sync-stage', '.sync-points li', '.phone', '.np-dialog']) {
        const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
        for (const box of boxes) {
          assert.ok(box.scroll <= box.width + 1, `${locale}/${width}: ${selector} contents fit`);
          assert.ok(box.left >= 0 && box.right <= width + 1, `${locale}/${width}: ${selector} within viewport`);
        }
      }
      await page.keyboard.press('Escape');
      // The hero note's links wrap inside it rather than spilling over its
      // sides, which fonts wider than this machine's would push off screen.
      assert.ok(await page.locator('.hero-note').evaluate(note => { const box = note.getBoundingClientRect(); return [...note.children].every(link => { const r = link.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; }); }), `${locale}/${width}: the hero note's links fit inside it`);
      // The New paper dialog's later steps fit as well as its gallery.
      for (const step of ['found', 'details', 'created']) {
        const fit = await page.locator('[data-scene=template]').evaluate((app, step) => {
          const before = app.dataset.step;
          app.classList.add('instant'); app.dataset.step = step;
          const dialog = app.querySelector('.np-dialog'), page = app.querySelector('.np-new'), last = step === 'details' ? app.querySelector('.np-foot') : null;
          const result = { across: dialog.scrollWidth <= dialog.clientWidth, down: !last || last.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1, page: step !== 'created' || page.scrollWidth <= page.clientWidth };
          app.dataset.step = before; app.classList.remove('instant');
          return result;
        }, step);
        assert.deepEqual(fit, { across: true, down: true, page: true }, `${locale}/${width}: the template's ${step} step fits`);
      }
      const panels = await page.locator('.scene').evaluateAll(apps => apps.map(app => {
        const [paneSelector, targetSelector] = { notes: ['.app-pdf', '.scene-figure'], revise: ['.app-pdf', '.review-change'], models: ['.app-chat', '.chat-composer'], record: ['.app-history', '.git-new'], phone: ['.phone-pdf', '.review-change:last-of-type'], template: ['.np-dialog', '.np-all .np-name'] }[app.dataset.scene];
        const pane = app.querySelector(paneSelector).getBoundingClientRect(), target = app.querySelector(targetSelector).getBoundingClientRect();
        return { scene: app.dataset.scene, bottom: target.bottom - pane.top, height: pane.height };
      }));
      for (const panel of panels) assert.ok(panel.bottom <= panel.height - 6, `${locale}/${width}: ${panel.scene} content stays inside its pane`);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: `test-results/site/${locale}-${width}-hero.png` });
        for (const section of ['features', 'overleaf', 'anywhere']) await page.locator(`#${section}`).screenshot({ style: '.topbar{visibility:hidden!important}', path: `test-results/site/${locale}-${width}-${section}.png` });
      }
    }
  }
  // The decoration responds once to intent, and becomes still with reduced motion.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  const orbit = page.locator('.universe-orbit');
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.locator('.topbar-universe').hover();
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationName), 'universe-orbit');
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationIterationCount), '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  assert.equal(requests.some(url => /\.(mp4|gif|jpe?g)|feature-.*\.png/.test(url)), false);
  console.log('Site checks passed: annotations during scroll and resize, first screen, the hero round and takeover, feature windows, Overleaf sync both ways, switching agents from the model menu, changes accepted on the phone, a paper from a template, next steps and guide anchors, reduced motion, no-JS, Universe links and keyboard navigation, all language URLs and SEO, saved language, both download menus, and layouts from 320px to 1440px including header breakpoints.');
} finally {
  await browser.close();
  await server.close();
}
