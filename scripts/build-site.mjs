// Builds the static landing page. Only Node is needed: its windows are
// drawn in HTML and CSS, not screenshots or video.
import crypto from 'node:crypto';
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { translatedSite } from './site-i18n.mjs';
import { siteAnalytics } from './site-analytics.mjs';
import { buildBlog, blogRoute } from './site-blog.mjs';
import { buildDocs, guideRoute } from './site-docs.mjs';

const root = path.resolve(import.meta.dirname, '..');
// The build empties this folder first, so it takes no folder argument that
// could name the source or the repository by mistake.
const out = path.join(root, '_site');
const site = 'https://papilot.ai/';
const analytics = siteAnalytics();
const copy = (from, names, to = '') => {
  fs.mkdirSync(path.join(out, to), { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(root, from, name), path.join(out, to, name));
};

fs.rmSync(out, { recursive: true, force: true });
copy('site', ['style.css', 'guide.css', 'guide.js', 'statistics-preferences.js', 'stars.js']);
if (analytics) copy('site', ['analytics.js']);
const source = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
// Browsers and caches may keep a stylesheet or script from the previous
// release, so their URLs carry a hash of their content.
const version = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex').slice(0, 10);
// Deployments use the published release, which can differ from main after a
// rollback or while the next release is still being prepared.
const release = process.env.PAPILOT_SITE_RELEASE ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(release)) throw new Error('PAPILOT_SITE_RELEASE must be a stable version.');
// The deploy passes the repository's star count, as GitHub abbreviates it
// (364, 1.2k); local builds stay offline and leave the header button without it.
const stars = process.env.PAPILOT_SITE_STARS;
if (stars !== undefined && !/^\d+$/.test(stars)) throw new Error('PAPILOT_SITE_STARS must be a whole number.');
const starCount = stars === undefined ? '' : `<span class="github-count">${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(stars)).toLowerCase()}</span>`;
const names = JSON.parse(fs.readFileSync(path.join(root, 'i18n/languages.json'), 'utf8'));
const locales = ['en', ...Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'i18n/config.json'), 'utf8')).locales)];
if (JSON.stringify(Object.keys(names)) !== JSON.stringify(locales)) throw new Error('Website languages must match the App configuration.');
const urlFor = locale => site + (locale === 'en' ? '' : `${locale}/`);
const ogLocales = { en: 'en_US', 'zh-CN': 'zh_CN', 'zh-Hant': 'zh_TW', ja: 'ja_JP', ko: 'ko_KR', de: 'de_DE', fr: 'fr_FR', es: 'es_ES', pt: 'pt_BR', it: 'it_IT', sv: 'sv_SE' };
const alternates = locales.map(locale => `<link rel="alternate" hreflang="${locale}" href="${urlFor(locale)}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${site}">`;
const blogLabels = { en: 'Blog', 'zh-CN': '博客', 'zh-Hant': '部落格', ja: 'ブログ', ko: '블로그', de: 'Blog', fr: 'Blog', es: 'Blog', pt: 'Blog', it: 'Blog', sv: 'Blogg' };
const guideLabels = { en: 'Docs', 'zh-CN': '文档', 'zh-Hant': '文件', ja: 'ドキュメント', ko: '문서', de: 'Doku', fr: 'Docs', es: 'Guía', pt: 'Guia', it: 'Guida', sv: 'Guide' };
const guideHrefFor = locale => guideRoute(locale === 'zh-CN' ? 'zh-CN' : 'en');
const wechatTopbar = '<a class="icon-button wechat-link" href="https://papilot.ai/wechat/" aria-label="微信群" title="微信群"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.69 4.5C4.44 4.5 1 7.42 1 11.02c0 2.04 1.12 3.86 2.87 5.05l-.72 2.17 2.53-1.27c.94.29 1.96.45 3.01.45.28 0 .56-.01.83-.04a6.45 6.45 0 0 1-.31-1.97c0-3.38 3.09-6.12 6.9-6.12.23 0 .45.01.68.03-.67-2.78-3.56-4.82-7.1-4.82ZM6.2 9.48a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm5.02 0a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Z"/><path d="M16.11 10.6c-3.25 0-5.89 2.22-5.89 4.96s2.64 4.96 5.89 4.96c.79 0 1.54-.13 2.22-.37l2 .99-.56-1.71c1.36-.92 2.23-2.32 2.23-3.87 0-2.74-2.64-4.96-5.89-4.96Zm-2.02 4.18a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56Zm4.04 0a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56Z"/></svg></a>';
const wechatFooter = '<a href="https://papilot.ai/wechat/">微信群</a>';
for (const locale of locales) {
  const translations = locale === 'en' ? {} : JSON.parse(fs.readFileSync(path.join(root, `site/locales/${locale}.json`), 'utf8'));
  const menu = locales.map(code => `<a href="${code === 'en' ? '/' : `/${code}/`}" role="menuitemradio" lang="${code}" aria-checked="${code === locale}" tabindex="-1">${names[code]}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></a>`).join('');
  const translated = translatedSite(source, translations, locale);
  const title = translated.match(/<title>([^<]*)<\/title>/)[1];
  let html = translated
    .replaceAll('<!-- guide-navigation -->', `<a href="${guideHrefFor(locale)}">${guideLabels[locale]}</a>`)
    .replaceAll('<!-- blog-navigation -->', `<a href="${blogRoute(locale)}">${blogLabels[locale]}</a>`)
    .replaceAll('href="https://github.com/PapilotAI/papilot/blob/main/docs/guide.md"', `href="${guideHrefFor(locale)}"`)
    .replace('<!-- wechat-topbar -->', locale === 'zh-CN' ? wechatTopbar : '')
    .replace('<!-- wechat-footer -->', locale === 'zh-CN' ? wechatFooter : '')
    .replace('<!-- analytics -->', analytics)
    .replaceAll('{{version}}', release)
    .replace('<!-- github-stars -->', starCount)
    .replace(/<link rel="alternate"[^>]*>/g, '')
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${urlFor(locale)}">\n${alternates}`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${urlFor(locale)}">\n<meta property="og:locale" content="${ogLocales[locale]}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title.replaceAll('"', '&quot;')}">`)
    .replace(/(<div class="lang-list"[^>]*>)(<\/div>)/, `$1${menu}$2`)
    .replace('<body>', `<body><noscript><nav class="no-js-languages">${locales.map(code => `<a lang="${code}" href="${code === 'en' ? '/' : `/${code}/`}">${names[code]}</a>`).join('')}</nav></noscript>`)
    .replace(/(\s(?:href|src)=")(style\.css|guide\.css|guide\.js|analytics\.js|statistics-preferences\.js|stars\.js)"/g, (_, attr, name) => `${attr}/${name}?v=${version(name)}"`)
    .replace(/(\s(?:href|src)=")((?:assets|fonts)\/[^" ]+|favicon.png|apple-touch-icon.png)"/g, '$1/$2"');
  if (locale !== 'en') {
    html = html
      .replace('https://github.com/PapilotAI/papilot#readme', `https://github.com/PapilotAI/papilot/blob/main/docs/readme/README.${locale}.md`)
      .replaceAll('href="/blog/', `href="/${locale}/blog/`);
  }
  // Explicit URLs always win. Only the root restores a saved choice; browser
  // language never redirects visitors or crawlers. Old ?lang links still work.
  html = html.replace('<!-- language-preference -->', `<script>
  (() => {
    const languages = ${JSON.stringify(locales)};
    let choice = new URLSearchParams(location.search).get('lang');
    if (!choice && location.pathname === '/') { try { choice = localStorage.getItem('papilot-lang'); } catch {} }
    if (choice === 'zh-Hans') choice = 'zh-CN';
    if (languages.includes(choice)) {
      const target = choice === 'en' ? '/' : '/' + choice + '/';
      if (location.pathname !== target) {
        document.documentElement.dataset.languageRedirect = 'true';
        const query = new URLSearchParams(location.search);
        query.delete('lang');
        location.replace(target + (query.size ? '?' + query : '') + location.hash);
      }
    }
  })();
  </script>`);
  const directory = path.join(out, locale === 'en' ? '' : locale);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), html);
}
// The bilingual privacy notice is independent of localization and analytics.
const privacy = fs.readFileSync(path.join(root, 'site/privacy.html'), 'utf8')
  .replace('<!-- statistics-preferences -->', `<script defer src="/statistics-preferences.js?v=${version('statistics-preferences.js')}" data-enabled="${!!analytics}"></script>`)
  .replace('href="style.css"', `href="/style.css?v=${version('style.css')}"`);
fs.mkdirSync(path.join(out, 'privacy'), { recursive: true });
fs.writeFileSync(path.join(out, 'privacy/index.html'), privacy);
const blog = buildBlog({ root, out, site, analytics, version });
const docs = buildDocs({ root, out, site, analytics, version, release });
const sitemapAlternates = [...locales, 'x-default'].map(locale => `<xhtml:link rel="alternate" hreflang="${locale}" href="${urlFor(locale === 'x-default' ? 'en' : locale)}"/>`).join('');
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${locales.map(locale => `<url><loc>${urlFor(locale)}</loc>${sitemapAlternates}</url>`).join('')}<url><loc>${site}privacy/</loc></url>${blog.sitemap}${docs.sitemap}</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
copy('public', ['favicon.png', 'apple-touch-icon.png']);
copy('docs/assets', ['logo.svg', 'social-preview.png'], 'assets');
// The agents' marks are the app's own icons, with their license.
copy('src/web/brand-icons', fs.readdirSync(path.join(root, 'src/web/brand-icons')).filter(name => /^(?!git|latex)[a-z]+\.svg$|^LICENSE-LobeHub\.txt$/.test(name)), 'assets/agents');
copy('src/web/fonts', fs.readdirSync(path.join(root, 'src/web/fonts')).filter(name => /\.(otf|txt)$/.test(name)), 'fonts');

// The try-it app uses the same React entrypoint and components as the desktop.
await build({ root, mode: 'playground' });

// Resolve each reference against its actual page URL, including nested pages.
const missing = [];
for (const page of [...locales.map(locale => locale === 'en' ? '' : locale), 'privacy', ...blog.pages, ...docs.pages]) {
  const html = fs.readFileSync(path.join(out, page, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href|poster)="([^"]*)"/g)].map(match => match[1]);
  refs.push(...[...html.matchAll(/\ssrcSet="([^"]*)"/g)].map(match => match[1]));
  refs.push(...[...html.matchAll(/\scontent="([^"]*)"/g)].map(match => match[1]).filter(value => value.startsWith(site)));
  for (const ref of refs) {
    const url = new URL(ref, site + (page ? page + '/' : ''));
    if (url.origin !== new URL(site).origin) continue;
    // Universe and WeChat are served by their own Workers, not this static build (site/wrangler.toml).
    if (url.href === 'https://papilot.ai/universe/' || url.href === 'https://papilot.ai/wechat/') continue;
    const file = path.join(out, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
    if (!fs.existsSync(file)) missing.push(`${page || 'en'}: ${ref}`);
  }
}
for (const name of ['style.css', 'blog.css', 'guide.css']) {
  const css = fs.readFileSync(path.join(out, name), 'utf8');
  for (const [, ref] of css.matchAll(/url\("?([^"\)]*)"?\)/g)) {
    const url = new URL(ref, site + name);
    if (url.origin === new URL(site).origin && !fs.existsSync(path.join(out, url.pathname))) missing.push(ref);
  }
}
if (missing.length) throw new Error(`The page points to files the build does not have: ${[...new Set(missing)].join(', ')}`);
console.log(`Site built in ${path.relative(process.cwd(), out) || '.'}: ${locales.length} languages, ${blog.posts.length} blog articles (${blog.pages.length} blog pages), ${docs.count} guide topics (${docs.pages.length} guide pages)`);
