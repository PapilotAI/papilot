import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

export const blogLocales = ['en', 'zh-CN'];
export const blogRoute = (locale, slug = '') => `${locale === 'en' ? '' : '/' + locale}/blog/${slug ? slug + '/' : ''}`;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const words = value => (value.match(/[\p{Script=Han}]/gu) || []).length / 450 + (value.match(/[a-zA-Z]+/g) || []).length / 220;
const text = node => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
const copy = {
  en: { blog: 'Blog', product: 'The product', demo: 'Try the demo', language: '简体中文', skip: 'Skip to content', theme: 'Dark mode', indexTitle: 'Notes on writing with AI.', indexDescription: 'Ideas and practical guides for working on the PDF, reviewing AI edits, and keeping authors in control.', category: 'Our approach', latest: 'From the Papilot team', read: 'Read the story', contents: 'In this article', back: 'All articles', minutes: 'min read', rss: 'Subscribe via RSS', privacy: 'Privacy notice', cta: 'Start with a page.', ctaText: 'Explore annotations and typeset changes in our prepared interactive demo. No installation needed.', credit: 'Illustrations use Papilot’s product examples.', author: 'Papilot team' },
  'zh-CN': { blog: '博客', product: '了解产品', demo: '体验演示', language: 'English', skip: '跳到正文', theme: '深色模式', indexTitle: '关于写作、AI 与作者的判断。', indexDescription: '记录我们的产品理念与写作方法：在 PDF 上工作，审阅 AI 的修改，让判断留在作者手中。', category: '产品理念', latest: '来自 Papilot 团队', read: '阅读全文', contents: '本文目录', back: '所有文章', minutes: '分钟阅读', rss: '通过 RSS 订阅', privacy: '隐私声明', cta: '从一页文稿开始。', ctaText: '在预置的交互演示中体验 PDF 批注与排版后的修改对比，无需安装。', credit: '配图来自 Papilot 产品示例。', author: 'Papilot 团队' },
};

function date(value, file) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`Invalid blog date in ${file}`);
  return value;
}

export function loadBlogPosts(root) {
  const directory = path.join(root, 'site/blog/posts');
  const posts = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name, file = path.join(directory, slug, 'post.json');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid blog slug: ${slug}`);
    const post = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (post.draft === true) continue;
    date(post.published, file);
    if (post.updated) { date(post.updated, file); if (post.updated < post.published) throw new Error(`Blog update predates publication: ${slug}`); }
    if (!post.locales || !Object.keys(post.locales).length) throw new Error(`Missing blog translations: ${slug}`);
    for (const [locale, content] of Object.entries(post.locales)) {
      if (!blogLocales.includes(locale)) throw new Error(`Unsupported blog locale: ${locale}`);
      for (const key of ['title', 'description', 'lead', 'hero', 'heroAlt', 'heroCaption']) if (typeof content[key] !== 'string' || !content[key].trim()) throw new Error(`Missing ${locale}.${key}: ${slug}`);
      content.body = fs.readFileSync(path.join(directory, slug, `${locale}.md`), 'utf8');
      if (!content.body.trim() || /^# /m.test(content.body)) throw new Error(`Blog body must be nonempty and start headings at h2: ${slug}/${locale}`);
      content.minutes = Math.max(1, Math.ceil(words(content.body)));
    }
    posts.push({ ...post, slug });
  }
  return posts.sort((a, b) => b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug));
}

export function buildBlog({ root, out, site, analytics, version }) {
  const posts = loadBlogPosts(root), pages = [], sitemap = [];
  const assetDir = path.join(out, 'assets/blog');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.cpSync(path.join(root, 'site/blog/assets'), assetDir, { recursive: true });
  for (const name of ['blog.css', 'blog.js']) fs.copyFileSync(path.join(root, 'site/blog', name), path.join(out, name));
  // Reuse the localized product illustrations, including their mobile and dark variants.
  for (const locale of blogLocales) for (const [name, source] of [['review', 'hero'], ['notes', 'notes-app']]) {
    for (const variant of ['', '-dark', '-compact', '-compact-dark']) {
      fs.copyFileSync(path.join(root, 'docs/assets/readme-showcase', `${source}${variant}${locale === 'en' ? '' : '.' + locale}.png`), path.join(assetDir, `${name}${variant}.${locale}.png`));
    }
  }
  const url = route => new URL(route, site).href;
  const write = (route, html) => {
    const directory = route.replace(/^\//, '');
    fs.mkdirSync(path.join(out, directory), { recursive: true });
    fs.writeFileSync(path.join(out, directory, 'index.html'), html);
    pages.push(directory.replace(/\/$/, ''));
  };
  const dimensions = src => {
    if (!/^\/assets\/blog\/[\w.-]+\.(png|svg)$/.test(src)) throw new Error(`Blog images must be local assets: ${src}`);
    const data = fs.readFileSync(path.join(out, src));
    if (src.endsWith('.png')) return [data.readUInt32BE(16), data.readUInt32BE(20)];
    const viewBox = data.toString().match(/viewBox="0 0 (\d+) (\d+)"/);
    if (!viewBox) throw new Error(`Blog SVG needs a viewBox: ${src}`);
    return viewBox.slice(1).map(Number);
  };
  const picture = (src, alt, eager = false) => {
    const [width, height] = dimensions(src);
    const product = /\/(review|notes)\.(en|zh-CN)\.png$/.exec(src);
    const image = (file, className, mobile) => {
      const compact = mobile && dimensions(mobile);
      return React.createElement('picture', { className }, mobile && React.createElement('source', { media: '(max-width: 600px)', srcSet: mobile, width: compact[0], height: compact[1] }), React.createElement('img', { src: file, alt, width, height, loading: eager ? 'eager' : 'lazy', decoding: 'async', ...(eager ? { fetchPriority: 'high' } : {}) }));
    };
    if (!product) {
      const compact = src.replace(/(\.(?:en|zh-CN))?\.svg$/, '-compact$1.svg');
      return image(src, 'blog-illustration', compact !== src && fs.existsSync(path.join(out, compact)) ? compact : undefined);
    }
    const [, name, locale] = product, variant = suffix => `/assets/blog/${name}${suffix}.${locale}.png`;
    return React.createElement(React.Fragment, null, image(src, 'blog-image-light', variant('-compact')), image(variant('-dark'), 'blog-image-dark', variant('-compact-dark')));
  };
  const illustration = (src, alt, caption, eager = false) => `<figure class="blog-figure">${renderToStaticMarkup(picture(src, alt, eager))}${caption ? `<figcaption>${escape(caption)}</figcaption>` : ''}</figure>`;
  const alternates = routes => Object.entries(routes).map(([locale, route]) => `<link rel="alternate" hreflang="${locale}" href="${url(route)}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${url(routes.en || Object.values(routes)[0])}">`;
  const sitemapEntry = (route, routes, modified) => `<url><loc>${url(route)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}${Object.entries(routes).map(([locale, alternate]) => `<xhtml:link rel="alternate" hreflang="${locale}" href="${url(alternate)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${url(routes.en || Object.values(routes)[0])}"/></url>`;
  const localizedDate = (value, locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
  function shell({ locale, title, description, route, routes, image, main, schema, article = false }) {
    const t = copy[locale], home = locale === 'en' ? '/' : '/zh-CN/';
    const other = Object.entries(routes).find(([code]) => code !== locale);
    const canonical = url(route), social = url(image || '/assets/social-preview.png');
    const tracking = analytics.replace(/src="(statistics-preferences|analytics)\.js"/g, (_, name) => `src="/${name}.js?v=${version(name + '.js')}"`);
    return `<!doctype html>
<html lang="${locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Papilot</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${canonical}">${alternates(routes)}
<meta property="og:type" content="${article ? 'article' : 'website'}"><meta property="og:site_name" content="Papilot"><meta property="og:locale" content="${locale === 'en' ? 'en_US' : 'zh_CN'}">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${social}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${social}">
<link rel="alternate" type="application/rss+xml" title="${escape(t.blog)} · Papilot" href="${blogRoute(locale)}feed.xml">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script>try{const theme=localStorage.getItem('papilot-theme');if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;}catch{}</script>
<link rel="stylesheet" href="/style.css?v=${version('style.css')}"><link rel="stylesheet" href="/blog.css?v=${version('blog.css')}">
<script defer src="/blog.js?v=${version('blog.js')}"></script><script type="application/ld+json">${json(schema)}</script>${tracking}
</head><body class="blog-page">
<a class="blog-skip" href="#content">${t.skip}</a>
<header class="topbar"><div class="wrap topbar-inner">
<a class="brand" href="${home}"><img class="brand-mark" src="/assets/logo.svg" alt="" width="26" height="26"><span>Papilot</span></a>
<nav class="blog-nav" aria-label="${locale === 'en' ? 'Main navigation' : '主导航'}"><a class="blog-product-link" href="${home}#why">${t.product}</a><a href="${blogRoute(locale)}" aria-current="${article ? 'location' : 'page'}">${t.blog}</a></nav>
<div class="topbar-actions">${other ? `<a class="blog-language" lang="${other[0]}" hreflang="${other[0]}" href="${other[1]}">${t.language}</a>` : ''}<button class="icon-button blog-theme" aria-label="${t.theme}" aria-pressed="false" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg></button><a class="button compact blog-demo" href="/demo/">${t.demo}</a></div>
</div></header>
<main id="content">${main}</main>
<footer class="footer blog-footer"><div class="wrap footer-inner"><a class="brand" href="${home}">Papilot</a><nav aria-label="${locale === 'en' ? 'Footer' : '页脚'}"><a href="${blogRoute(locale)}">${t.blog}</a><a href="${blogRoute(locale)}feed.xml">RSS</a><a href="https://github.com/PapilotAI/papilot">GitHub</a><a href="/privacy/">${t.privacy}</a></nav><p>MIT © 2026 PapilotAI</p></div></footer>
</body></html>`;
  }
  const cta = locale => `<section class="blog-cta"><div><h2>${copy[locale].cta}</h2><p>${copy[locale].ctaText}</p></div><a class="button" href="/demo/">${copy[locale].demo} <span aria-hidden="true">↗</span></a></section>`;
  for (const locale of blogLocales) {
    const t = copy[locale], localized = posts.filter(post => post.locales[locale]);
    const indexRoutes = Object.fromEntries(blogLocales.map(code => [code, blogRoute(code)]));
    const cards = localized.map(post => {
      const entry = post.locales[locale], route = blogRoute(locale, post.slug);
      return `<article class="blog-card"><a class="blog-card-image" href="${route}" aria-label="${escape(entry.title)}">${illustration(entry.hero, entry.heroAlt, '', true)}</a><div class="blog-card-copy"><p class="blog-kicker">${t.category} <span>·</span> <time datetime="${post.published}">${localizedDate(post.published, locale)}</time></p><h2><a href="${route}">${escape(entry.title)}</a></h2><p>${escape(entry.lead)}</p><a class="blog-read" href="${route}">${t.read} <span aria-hidden="true">→</span></a></div></article>`;
    }).join('');
    const main = `<div class="wrap"><header class="blog-index-head"><p class="blog-kicker">Papilot / ${t.blog}</p><h1>${t.indexTitle}</h1><p class="blog-deck">${t.indexDescription}</p></header><div class="blog-list-head"><h2>${t.latest}</h2><a href="${blogRoute(locale)}feed.xml">${t.rss} <span aria-hidden="true">↗</span></a></div><section class="blog-list" aria-label="${t.back}">${cards || `<p>${locale === 'en' ? 'New articles are on their way.' : '新文章正在准备中。'}</p>`}</section>${cta(locale)}</div>`;
    write(blogRoute(locale), shell({ locale, title: `${t.blog} — ${t.indexTitle}`, description: t.indexDescription, route: blogRoute(locale), routes: indexRoutes, main, schema: { '@context': 'https://schema.org', '@type': 'Blog', name: 'Papilot Blog', url: url(blogRoute(locale)), inLanguage: locale, description: t.indexDescription, blogPost: localized.map(post => ({ '@type': 'BlogPosting', headline: post.locales[locale].title, url: url(blogRoute(locale, post.slug)) })) } }));
    sitemap.push(sitemapEntry(blogRoute(locale), indexRoutes));
    const feed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Papilot ${t.blog}</title><link>${url(blogRoute(locale))}</link><description>${escape(t.indexDescription)}</description><language>${locale}</language><atom:link href="${url(blogRoute(locale) + 'feed.xml')}" rel="self" type="application/rss+xml"/>${localized.map(post => { const entry = post.locales[locale], link = url(blogRoute(locale, post.slug)); return `<item><title>${escape(entry.title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(post.published + 'T00:00:00+08:00').toUTCString()}</pubDate><description>${escape(entry.description)}</description></item>`; }).join('')}</channel></rss>`;
    fs.writeFileSync(path.join(out, blogRoute(locale), 'feed.xml'), feed);
    for (const post of localized) {
      const entry = post.locales[locale], route = blogRoute(locale, post.slug), toc = [], ids = new Set();
      const routes = Object.fromEntries(Object.keys(post.locales).map(code => [code, blogRoute(code, post.slug)]));
      const heading = level => ({ node, children }) => {
        const label = text(node), base = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
        let id = base, count = 1; while (ids.has(id)) id = base + '-' + ++count; ids.add(id);
        if (level === 'h2') toc.push({ id, label });
        return React.createElement(level, { id }, children);
      };
      const body = renderToStaticMarkup(React.createElement(Markdown, { skipHtml: true, components: {
        h2: heading('h2'), h3: heading('h3'),
        img: ({ src, alt }) => picture(src, alt),
        p: ({ node, children }) => {
          const images = node.children.filter(child => child.tagName === 'img');
          if (images.length && node.children.every(child => child.tagName === 'img' || child.type === 'text' && !child.value.trim())) return React.createElement('figure', { className: 'blog-figure' }, children, images[0].properties.title && React.createElement('figcaption', null, images[0].properties.title));
          return React.createElement('p', null, children);
        },
      } }, entry.body));
      const metadata = `<span>${t.author}</span><span aria-hidden="true">/</span><time datetime="${post.published}">${localizedDate(post.published, locale)}</time><span aria-hidden="true">/</span><span>${entry.minutes} ${t.minutes}</span>`;
      const main = `<article class="wrap blog-article"><header class="blog-article-head"><nav class="blog-breadcrumb" aria-label="${locale === 'en' ? 'Breadcrumb' : '面包屑导航'}"><a href="${blogRoute(locale)}">${t.blog}</a><span aria-hidden="true">/</span><span>${t.category}</span></nav><h1>${escape(entry.title)}</h1><p class="blog-deck">${escape(entry.lead)}</p><div class="blog-meta">${metadata}</div></header><div class="blog-hero">${illustration(entry.hero, entry.heroAlt, entry.heroCaption, true)}</div><div class="blog-reading-layout"><div class="blog-prose">${body}<p class="blog-image-credit">${t.credit}</p></div><aside class="blog-toc"><nav aria-label="${t.contents}"><p>${t.contents}</p><ol>${toc.map(item => `<li><a href="#${escape(item.id)}">${escape(item.label)}</a></li>`).join('')}</ol><a class="blog-toc-back" href="${blogRoute(locale)}">← ${t.back}</a></nav></aside></div>${cta(locale)}</article>`;
      const schema = { '@context': 'https://schema.org', '@graph': [
        { '@type': 'BlogPosting', '@id': url(route) + '#article', mainEntityOfPage: url(route), headline: entry.title, description: entry.description, inLanguage: locale, datePublished: post.published + 'T00:00:00+08:00', ...(post.updated ? { dateModified: post.updated + 'T00:00:00+08:00' } : {}), image: [url(entry.hero)], author: { '@type': 'Organization', name: 'Papilot', url: site }, publisher: { '@type': 'Organization', name: 'Papilot', url: site, logo: { '@type': 'ImageObject', url: url('/apple-touch-icon.png') } } },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: t.blog, item: url(blogRoute(locale)) }, { '@type': 'ListItem', position: 2, name: entry.title, item: url(route) }] },
      ] };
      write(route, shell({ locale, title: entry.title, description: entry.description, route, routes, image: entry.hero, main, schema, article: true }));
      sitemap.push(sitemapEntry(route, routes, post.updated || post.published));
    }
  }
  return { pages, sitemap: sitemap.join(''), posts };
}
