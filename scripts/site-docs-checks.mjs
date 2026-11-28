import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guideLocales, guideRoute, loadGuideManifest, validateMarkdownGuideHubs } from './site-docs.mjs';

export async function checkSiteDocs(browser, origin) {
  validateMarkdownGuideHubs(process.cwd());
  const { locales: uiByLocale, groups, pages, tokens } = loadGuideManifest(process.cwd());
  const sitemap = fs.readFileSync('_site/sitemap.xml', 'utf8');
  fs.mkdirSync('test-results/site', { recursive: true });

  // Verify static search indexes exist and include every page.
  for (const locale of guideLocales) {
    const indexPath = `_site/guide/search-${locale}.json`;
    assert.ok(fs.existsSync(indexPath), `search index built for ${locale}`);
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.ok(entries.length > pages.length, `search index for ${locale} indexes sections as well as pages`);
    for (const entry of pages) {
      assert.ok(entries.some(item => item.id === entry.slug), `search index (${locale}) includes ${entry.slug}`);
    }
  }

  // Zero-JavaScript baseline: persistent sidebar on hub, two-tier section tabs, working mobile <details> nav, no dead JS-only controls.
  const noJs = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  const page = await noJs.newPage();
  const errors = [];
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    for (const locale of guideLocales) {
      const ui = uiByLocale[locale];
      const hubRoute = guideRoute(locale);
      assert.ok(sitemap.includes(`<loc>https://papilot.ai${hubRoute}</loc>`), `sitemap includes ${hubRoute}`);
      await page.goto(origin + hubRoute);
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator('h1').innerText(), ui.indexTitle);
      assert.equal(await page.locator('.guide-sidebar .guide-nav-group').count(), groups.length, `hub renders persistent sidebar with all ${groups.length} groups`);
      assert.equal(await page.locator('.guide-tabs a[aria-current="page"]').count(), 1, 'hub highlights Overview section tab');
      assert.equal(await page.locator('.guide-path-card').count(), 4, 'hub shows 4 core path cards');
      assert.equal(await page.locator('.guide-quickstart-card').count(), 1, 'hub shows featured Quickstart card');
      assert.equal(await page.locator('.blog-theme').isVisible(), false, 'no dead theme button without JS');
      assert.equal(await page.locator('[data-guide-search-open]').first().isVisible(), false, 'no dead search trigger without JS');
      assert.doesNotMatch(await page.locator('main').innerText(), /\{\{[a-zA-Z0-9_]+\}\}/, 'no unresolved tokens on hub');
      assert.ok((await page.locator('.guide-badge-version').innerText()).includes(tokens.release), 'hub shows current release badge');
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `guide hub fits at ${width}px (${locale})`);
        if (width === 1440 || width === 390) {
          await page.screenshot({ path: `test-results/site/guide-hub-${locale}-${width}.png`, fullPage: width === 1440, style: '.guide-header{position:static!important}' });
        }
      }

      for (const entry of pages) {
        const route = guideRoute(locale, entry.slug);
        assert.ok(sitemap.includes(`<loc>https://papilot.ai${route}</loc>`), `sitemap includes ${route}`);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(origin + route);
        assert.equal(await page.locator('h1').innerText(), entry.locales[locale].title);
        assert.equal(await page.locator('.guide-sidebar .guide-topics-nav a[aria-current="page"]').count(), 1);
        assert.equal(await page.locator('.guide-sidebar .guide-nav-group').count(), groups.length);
        assert.equal(await page.locator('.guide-tabs a[aria-current="page"]').count(), 1);
        assert.doesNotMatch(await page.locator('article').innerText(), /\{\{[a-zA-Z0-9_]+\}\}/, `no unresolved tokens on ${route}`);
        if (entry.status === 'experimental') {
          assert.equal(await page.locator('.guide-callout').count(), 1, `experimental callout rendered on ${route}`);
        }
        assert.deepEqual(
          await page.locator('.guide-toc a[href^="#"], .guide-mobile-toc a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(decodeURIComponent(link.hash.slice(1)))).map(link => link.hash)),
          [],
          `all TOC anchors resolve on ${route}`,
        );
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} fits at ${width}px`);
        }
        if (entry.slug === 'installation') {
          assert.equal(await page.locator('.guide-copy-button').first().isVisible(), false, 'no dead copy-code button without JS');
        }
        // Mobile native <details> navigation works with JS disabled.
        if (entry.slug === 'agents') {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator('.guide-mobile-nav summary').click();
          assert.equal(await page.locator('.guide-mobile-nav').evaluate(el => el.open), true, 'mobile grouped nav opens without JS');
        }
        if (entry.slug === 'agents' || entry.slug === 'review-and-save') {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.screenshot({ path: `test-results/site/guide-${entry.slug}-${locale}-1440.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({ path: `test-results/site/guide-${entry.slug}-${locale}-390.png` });
        }
      }
    }
  } finally {
    await noJs.close();
  }

  // Interactive checks: centered search bar, search modal, Escape close, copy-code button, TOC scrollspy, dark mode & zh-CN switch.
  const ctx = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(value) { window.__copied.push(value); } },
    });
  });
  const interactive = await ctx.newPage();
  interactive.on('pageerror', err => errors.push(err.message));
  interactive.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    // 1. Desktop hub with prominent search bar + dark screenshot.
    const waitVisibleImages = p => p.evaluate(async () => {
      const imgs = [...document.querySelectorAll('img')].filter(img => img.offsetParent !== null);
      await Promise.all(imgs.map(img => img.complete ? img.decode().catch(() => {}) : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })));
    });
    await interactive.goto(origin + '/zh-CN/guide/');
    const topSearch = interactive.locator('[data-guide-search-open]').first();
    assert.equal(await topSearch.isVisible(), true, 'search bar revealed with JS');
    await waitVisibleImages(interactive);
    await interactive.screenshot({ path: 'test-results/site/guide-hub-zh-js-1440.png' });

    await topSearch.click();
    const dialog = interactive.locator('#guide-search-dialog');
    assert.equal(await dialog.evaluate(el => el.open), true, 'search dialog opens as modal');
    assert.equal(await dialog.getAttribute('role'), null, 'native modal dialog omits redundant role="dialog"');
    await interactive.locator('#guide-search-input').fill('写作记忆');
    await interactive.waitForFunction(() => document.querySelectorAll('#guide-search-results li').length > 0);
    await interactive.screenshot({ path: 'test-results/site/guide-search-zh-1440.png' });
    await interactive.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(el => el.open), false, 'Escape closes search dialog');

    // 2. Copy-code button + TOC ScrollSpy on installation page.
    await interactive.goto(origin + '/guide/installation/');
    assert.equal(await interactive.locator('.guide-toc a[aria-current="location"]').count(), 1, 'TOC scrollspy marks active heading');
    const copyBtn = interactive.locator('.guide-copy-button').first();
    await copyBtn.focus();
    await copyBtn.click();
    await interactive.waitForFunction(() => document.querySelector('.guide-copy-button')?.hasAttribute('data-copied') && /Copied/.test(document.querySelector('.guide-copy-tip')?.textContent || ''));
    const copied = await interactive.evaluate(() => window.__copied);
    assert.equal(copied.length, 1);
    assert.match(copied[0], /brew tap PapilotAI\/tap/);

    // 3. Dark theme on desktop hub + mobile article + language persistence.
    await interactive.goto(origin + '/guide/');
    await interactive.locator('.blog-theme').click();
    assert.equal(await interactive.locator('html').getAttribute('data-theme'), 'dark');
    await waitVisibleImages(interactive);
    await interactive.screenshot({ path: 'test-results/site/guide-hub-en-dark-1440.png' });

    await interactive.setViewportSize({ width: 390, height: 844 });
    await interactive.goto(origin + '/guide/agents/');
    await interactive.screenshot({ path: 'test-results/site/guide-agents-dark-390.png' });
    await interactive.locator('.blog-languages summary').click();
    await interactive.locator('.blog-language[hreflang="zh-CN"]').click();
    await interactive.waitForURL(origin + '/zh-CN/guide/agents/');
    assert.equal(await interactive.locator('html').getAttribute('data-theme'), 'dark', 'theme persists across guide languages');
  } finally {
    await ctx.close();
  }
  assert.deepEqual(errors, []);
}
