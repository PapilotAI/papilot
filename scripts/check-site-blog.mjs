import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { blogLocales, blogRoute, loadBlogPosts } from './site-blog.mjs';

const posts = loadBlogPosts(process.cwd());
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-blog-check-'));
try {
  const folder = path.join(temp, 'site/blog/posts/example');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify({ draft: true }));
  assert.deepEqual(loadBlogPosts(temp), [], 'drafts are excluded from every generated listing');
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify({ published: '2026-02-30' }));
  assert.throws(() => loadBlogPosts(temp), /Invalid blog date/);
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify({ published: '2026-01-01', locales: { fr: {} } }));
  assert.throws(() => loadBlogPosts(temp), /Unsupported blog locale/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('_site') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [];
fs.mkdirSync('test-results/blog', { recursive: true });
const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const loadIllustrations = async target => {
  await target.locator('.blog-figure img').evaluateAll(images => images.forEach(image => { image.loading = 'eager'; }));
  // Timer polling remains active when no-JS screenshot contexts stop animation frames after a resize.
  await target.waitForFunction(() => [...document.querySelectorAll('.blog-figure img')].filter(image => getComputedStyle(image.closest('picture')).display !== 'none').every(image => {
    const source = [...image.parentElement.querySelectorAll('source')].find(source => matchMedia(source.media).matches);
    const expected = new URL(source?.srcset || image.getAttribute('src'), location.href).href;
    return image.complete && image.naturalWidth > 0 && image.currentSrc === expected;
  }), undefined, { polling: 50 }).catch(async error => {
    const state = await target.locator('.blog-figure img').evaluateAll(images => images.map(image => ({ src: image.src, currentSrc: image.currentSrc, complete: image.complete, width: image.naturalWidth, display: getComputedStyle(image.closest('picture')).display, sources: [...image.parentElement.querySelectorAll('source')].map(source => ({ src: source.srcset, matches: matchMedia(source.media).matches })) })));
    throw new Error(`Images not ready on ${target.url()}: ${JSON.stringify(state)}`, { cause: error });
  });
  await target.locator('.blog-figure img').evaluateAll(images => Promise.all(images.filter(image => getComputedStyle(image.closest('picture')).display !== 'none').map(image => image.decode())));
};
try {
  const sitemap = fs.readFileSync('_site/sitemap.xml', 'utf8');
  for (const locale of blogLocales) {
    await page.goto(origin + blogRoute(locale));
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.equal(await page.locator('.blog-card').count(), posts.filter(post => post.locales[locale]).length);
    assert.equal(await page.locator('.blog-theme').isVisible(), false, 'no dead theme button without JS');
    assert.ok(sitemap.includes(`<loc>https://papilot.ai${blogRoute(locale)}</loc>`));
    await page.screenshot({ path: `test-results/blog/index-${locale}.png`, fullPage: true });
    const feed = await (await fetch(origin + blogRoute(locale) + 'feed.xml')).text();
    const feedState = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      return { error: !!doc.querySelector('parsererror'), links: [...doc.querySelectorAll('item link')].map(node => node.textContent), dates: [...doc.querySelectorAll('pubDate')].map(node => node.textContent) };
    }, feed);
    assert.equal(feedState.error, false, 'RSS must be well-formed XML');
    for (const post of posts.filter(post => post.locales[locale])) {
      const route = blogRoute(locale, post.slug), canonical = 'https://papilot.ai' + route;
      assert.ok(feedState.links.includes(canonical));
      assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
      await page.goto(origin + route);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('h1').innerText(), post.locales[locale].title);
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), canonical);
      assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), canonical);
      assert.equal(await page.locator('meta[name=description]').getAttribute('content'), post.locales[locale].description);
      assert.ok(await page.locator('.blog-prose p').count() > 5, 'full article is rendered without JavaScript');
      for (const code of Object.keys(post.locales)) assert.equal(await page.locator(`link[hreflang="${code}"]`).getAttribute('href'), 'https://papilot.ai' + blogRoute(code, post.slug));
      const structured = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
      const article = structured['@graph'].find(item => item['@type'] === 'BlogPosting');
      assert.equal(article.mainEntityOfPage, canonical);
      assert.equal(article.headline, await page.locator('h1').innerText());
      assert.equal(article.inLanguage, locale);
      assert.ok(feedState.dates.includes(new Date(article.datePublished).toUTCString()));
      assert.deepEqual(await page.locator('.blog-toc a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(decodeURIComponent(link.hash.slice(1)))).map(link => link.hash)), []);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}px (${locale})`);
        assert.ok(await page.locator('.blog-hero .blog-image-light img').isVisible());
        if (width === 1440 || width === 390) {
          // Load responsive images and bring them into view before capture.
          await loadIllustrations(page);
          const workflow = page.locator('.blog-illustration img');
          if (await workflow.count()) assert.equal(await workflow.first().evaluate(image => image.currentSrc.includes('-compact.')), width === 390);
          for (const figure of await page.locator('.blog-figure').all()) await figure.scrollIntoViewIfNeeded();
          if (width === 390) await page.locator('.blog-prose .blog-figure').last().screenshot({ path: `test-results/blog/notes-${locale}-mobile.png` });
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `test-results/blog/article-${locale}-${width}.png`, fullPage: true });
          if (width === 390) await page.screenshot({ path: `test-results/blog/article-${locale}-mobile-viewport.png` });
        }
      }
      await page.locator('.blog-prose .blog-figure').last().scrollIntoViewIfNeeded();
      assert.deepEqual(await page.locator('.blog-figure img').evaluateAll(images => images.filter(image => getComputedStyle(image.closest('picture')).display !== 'none' && (!image.complete || !image.naturalWidth || !image.alt)).map(image => image.src)), []);
      const other = Object.keys(post.locales).find(code => code !== locale);
      if (other) {
        await page.locator('.blog-language').click();
        assert.equal(new URL(page.url()).pathname, blogRoute(other, post.slug));
        assert.equal(await page.locator('h1').innerText(), post.locales[other].title);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const interactive = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const theme = await interactive.newPage();
  theme.on('pageerror', error => errors.push(error.message));
  await theme.goto(origin + blogRoute('en', posts[0].slug));
  await theme.locator('.blog-theme').click();
  assert.equal(await theme.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await theme.locator('.blog-hero .blog-image-dark img').isVisible(), true);
  assert.equal(await theme.locator('.blog-hero .blog-image-light img').isVisible(), false);
  await theme.reload();
  assert.equal(await theme.locator('.blog-theme').getAttribute('aria-pressed'), 'true');
  await loadIllustrations(theme);
  await theme.screenshot({ path: 'test-results/blog/article-dark-mobile.png', fullPage: true });
  await theme.locator('.blog-language').click();
  assert.equal(await theme.locator('html').getAttribute('data-theme'), 'dark', 'theme persists across languages');
  await theme.locator('.blog-theme').click();
  assert.equal(await theme.locator('html').getAttribute('data-theme'), 'light');
  await interactive.close();
  assert.deepEqual(errors, []);
  console.log('PASS: static bilingual blog, full no-JS content, canonical/hreflang/structured data, valid RSS, sitemap entries, image loading, language switching, dark mode, and 320/390/768/1440px layouts.');
} finally { await browser.close(); await server.close(); }
