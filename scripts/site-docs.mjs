import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const guideLocales = ['en', 'zh-CN'];
export const guideLanguageNames = { en: 'English', 'zh-CN': '简体中文' };
export const guideOgLocales = { en: 'en_US', 'zh-CN': 'zh_CN' };
export const guideRoute = (locale, slug = '') => `${locale === 'en' ? '' : '/' + locale}/guide/${slug ? slug + '/' : ''}`;

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const text = node => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
export const headingSlug = value => value.trim().toLowerCase().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';

const icons = {
  home: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
  rocket: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/></svg>',
  monitor: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  pen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  git: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 3v12M18 9a9 9 0 0 1-9 9"/></svg>',
  flask: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M10 2v7.31L4.72 18.5A2 2 0 0 0 6.45 21.5h11.1a2 2 0 0 0 1.73-3L14 9.31V2"/><path d="M8.5 2h7"/></svg>',
  sparkSm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 3c.5 4.2 2.3 6 6.5 6.5-4.2.5-6 2.3-6.5 6.5-.5-4.2-2.3-6-6.5-6.5 4.2-.5 6-2.3 6.5-6.5Z"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-4 5 5 5-5"/><path d="M4 20h16"/></svg>',
  annotate: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  spark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3c.5 4.2 2.3 6 6.5 6.5-4.2.5-6 2.3-6.5 6.5-.5-4.2-2.3-6-6.5-6.5 4.2-.5 6-2.3 6.5-6.5Z"/></svg>',
  review: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 14l2 2 4-4"/></svg>',
};

const groupIcons = {
  'getting-started': icons.rocket,
  'writing-review': icons.pen,
  agents: icons.sparkSm,
  collaborate: icons.git,
  reference: icons.flask,
};

function formatList(items, locale) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (locale === 'zh-CN') return `${items.slice(0, -1).join('、')}与${items.at(-1)}`;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// Derive fast-changing product facts directly from source files so guide prose
// and metadata stay accurate across releases without manual recounting.
export function loadGuideTokens(root, releaseOverride) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const release = releaseOverride || process.env.PAPILOT_SITE_RELEASE || pkg.version;
  const shared = fs.readFileSync(path.join(root, 'src/shared.ts'), 'utf8');
  const idsMatch = shared.match(/export const AGENT_IDS[^=]*=\s*\[([^\]]+)\]/);
  const namesMatch = shared.match(/export const AGENT_NAMES[^=]*=\s*\{([^}]+)\}/);
  if (!idsMatch || !namesMatch) throw new Error('Could not read AGENT_IDS / AGENT_NAMES from src/shared.ts');
  const agentIds = [...idsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const agentNames = Object.fromEntries([...namesMatch[1].matchAll(/([a-z0-9_]+)\s*:\s*'([^']+)'/gi)].map(m => [m[1], m[2]]));
  const codingAgentIds = agentIds.filter(id => id !== 'papilot' && id !== 'collaboration' && id !== 'chatgpt');
  const selectableAgentIds = agentIds.filter(id => id !== 'collaboration');
  const codingNames = codingAgentIds.map(id => {
    const name = agentNames[id];
    if (!name) throw new Error(`Missing AGENT_NAMES entry for ${id}`);
    return name === 'Copilot' ? 'GitHub Copilot' : name;
  });
  const languages = JSON.parse(fs.readFileSync(path.join(root, 'i18n/languages.json'), 'utf8'));
  const languageNames = Object.values(languages);
  return {
    release,
    codingAgentCount: String(codingAgentIds.length),
    totalAgentCount: String(selectableAgentIds.length),
    codingAgentList: formatList(codingNames, 'en'),
    codingAgentListZh: formatList(codingNames, 'zh-CN'),
    uiLanguageCount: String(languageNames.length),
    uiLanguageList: formatList(languageNames, 'en'),
    uiLanguageListZh: formatList(languageNames, 'zh-CN'),
  };
}

export function applyGuideTokens(input, tokens, label) {
  const parts = String(input).split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    return part.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
      if (!(key in tokens)) throw new Error(`Unknown guide token {{${key}}} in ${label}`);
      return tokens[key];
    });
  }).join('');
}

const stripFencedCode = markdown => markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gm, match => match.replace(/[^\n]/g, ''));

export function extractHeadings(markdown) {
  const ids = new Set(), items = [];
  for (const [, hashes, raw] of stripFencedCode(markdown).matchAll(/^(#{2,3})\s+(.+)$/gm)) {
    const level = hashes.length === 2 ? 'h2' : 'h3';
    const label = raw.trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_~]/g, '');
    const base = headingSlug(label);
    let id = base, count = 1;
    while (ids.has(id)) id = `${base}-${++count}`;
    ids.add(id);
    items.push({ level, id, label });
  }
  return items;
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[|:\s-]+$/gm, ' ')
    .replace(/~~/g, ' ')
    .replace(/[|`*_>#]/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSectionsForSearch(markdown, headings) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = { heading: '', id: '', lines: [] };
  let cursor = 0, inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      current.lines.push(line);
      continue;
    }
    if (!inFence && /^#{2,3}\s+/.test(line) && cursor < headings.length) {
      if (current.lines.length || current.heading) sections.push(current);
      const h = headings[cursor++];
      current = { heading: h.label, id: h.id, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length || current.heading) sections.push(current);
  return sections.map(section => ({
    heading: section.heading,
    id: section.id,
    excerpt: stripMarkdown(section.lines.join('\n')).slice(0, 220),
  }));
}

export function loadGuideManifest(root, releaseOverride) {
  const dir = path.join(root, 'docs/guide');
  const tokens = loadGuideTokens(root, releaseOverride);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const groups = manifest.groups || [];
  const groupIds = new Set(groups.map(group => group.id));
  const resolveObj = (obj, label) => {
    if (typeof obj === 'string') return applyGuideTokens(obj, tokens, label);
    if (Array.isArray(obj)) return obj.map((item, i) => resolveObj(item, `${label}[${i}]`));
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveObj(v, `${label}.${k}`)]));
    return obj;
  };
  const locales = resolveObj(manifest.locales, 'manifest.locales');
  const pages = manifest.pages.map(rawPage => {
    const page = resolveObj(rawPage, `manifest.page.${rawPage.slug}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) throw new Error(`Invalid guide slug: ${page.slug}`);
    if (groups.length && !groupIds.has(page.group)) throw new Error(`Unknown guide group "${page.group}" on ${page.slug}`);
    const enPath = path.join(dir, `${page.slug}.md`);
    const zhPath = path.join(dir, 'zh-CN', `${page.slug}.md`);
    const enBody = applyGuideTokens(fs.readFileSync(enPath, 'utf8'), tokens, `guide/${page.slug}.md`);
    const hasZh = fs.existsSync(zhPath);
    if (!hasZh && page.fallbackLocale !== 'en') throw new Error(`Missing zh-CN translation for ${page.slug} (set fallbackLocale: "en" to allow fallback)`);
    const zhBody = hasZh ? applyGuideTokens(fs.readFileSync(zhPath, 'utf8'), tokens, `guide/zh-CN/${page.slug}.md`) : enBody;
    if (/^# /m.test(stripFencedCode(enBody)) || /^# /m.test(stripFencedCode(zhBody))) throw new Error(`Guide body must start headings at h2: ${page.slug}`);
    const enHeadings = extractHeadings(enBody);
    const zhHeadings = extractHeadings(zhBody);
    if (hasZh && (enHeadings.length !== zhHeadings.length || enHeadings.some((item, i) => item.level !== zhHeadings[i].level))) {
      throw new Error(`Guide heading structure mismatch between en and zh-CN in ${page.slug}: en=${enHeadings.map(h => `${h.level}:${h.id}`).join(',')} vs zh=${zhHeadings.map(h => `${h.level}:${h.label}`).join(',')}`);
    }
    return {
      ...page,
      fallbackActive: { en: false, 'zh-CN': !hasZh },
      bodies: { en: enBody, 'zh-CN': zhBody },
      headings: {
        en: enHeadings.map(item => ({ ...item, rawId: item.id })),
        'zh-CN': zhHeadings.map((item, i) => ({ ...item, rawId: item.id, id: enHeadings[i].id })),
      },
    };
  });
  return { locales, groups, pages, tokens };
}

export function validateMarkdownGuideHubs(root) {
  const hubAnchors = {};
  const mdFilesToCheck = [
    'docs/guide.md',
    'docs/guide.zh-CN.md',
    'docs/development.md',
    ...fs.readdirSync(path.join(root, 'docs/guide')).filter(name => name.endsWith('.md')).map(name => `docs/guide/${name}`),
    ...fs.readdirSync(path.join(root, 'docs/guide/zh-CN')).filter(name => name.endsWith('.md')).map(name => `docs/guide/zh-CN/${name}`),
  ];
  for (const file of mdFilesToCheck) {
    const full = path.join(root, file), content = fs.readFileSync(full, 'utf8');
    const anchors = new Set([
      ...extractHeadings(content).map(item => item.id),
      ...[...content.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]),
    ]);
    hubAnchors[file] = anchors;
    for (const [, rawHref] of stripFencedCode(content).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|mailto:)/i.test(rawHref)) continue;
      const [targetPath, hash = ''] = rawHref.split('#');
      if (!targetPath) {
        if (!anchors.has(hash)) throw new Error(`Missing anchor #${hash} in ${file}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(full), targetPath);
      if (!fs.existsSync(resolved)) throw new Error(`Broken relative link ${rawHref} in ${file}`);
      if (hash && resolved.endsWith('.md') && resolved.startsWith(path.join(root, 'docs/guide') + path.sep)) {
        const targetHeadings = new Set(extractHeadings(fs.readFileSync(resolved, 'utf8')).map(item => item.id));
        if (!targetHeadings.has(hash)) throw new Error(`Missing anchor #${hash} in ${targetPath} (from ${file})`);
      }
    }
  }
  const inboundFiles = [
    'README.md',
    'CHANGELOG.md',
    ...fs.readdirSync(path.join(root, 'docs')).filter(name => name.endsWith('.md') && !name.startsWith('guide')).map(name => `docs/${name}`),
    ...fs.readdirSync(path.join(root, 'src/web')).filter(name => name.endsWith('.tsx')).map(name => `src/web/${name}`),
  ].filter(file => fs.existsSync(path.join(root, file)));
  for (const file of inboundFiles) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, hash] of content.matchAll(/guide\.md#([a-z0-9-]+)/g)) {
      if (!hubAnchors['docs/guide.md'].has(hash)) throw new Error(`Missing anchor #${hash} in docs/guide.md (referenced by ${file})`);
      if (!hubAnchors['docs/guide.zh-CN.md'].has(hash)) throw new Error(`Missing anchor #${hash} in docs/guide.zh-CN.md (referenced by ${file})`);
    }
  }
}

export function buildDocs({ root, out, site, analytics, version, release }) {
  validateMarkdownGuideHubs(root);
  const { locales: uiByLocale, groups, pages, tokens } = loadGuideManifest(root, release);
  const bySlug = new Map(pages.map(page => [page.slug, page]));
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const orderedPages = groups.length
    ? groups.flatMap(group => pages.filter(page => page.group === group.id))
    : pages;
  const builtPages = [], sitemap = [];
  const assetDir = path.join(out, 'assets/guide');
  fs.mkdirSync(assetDir, { recursive: true });
  for (const name of ['blog.css', 'blog.js']) {
    if (!fs.existsSync(path.join(out, name))) fs.copyFileSync(path.join(root, 'site/blog', name), path.join(out, name));
  }

  const copiedAssets = new Map();
  const readPngDims = file => {
    const bytes = fs.readFileSync(file);
    return file.endsWith('.png') ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [1200, 720];
  };
  const copyGuideAsset = (relSource, locale) => {
    const baseDir = locale === 'en' ? path.join(root, 'docs/guide') : path.join(root, 'docs/guide/zh-CN');
    let sourceFile = path.resolve(baseDir, relSource);
    if (!fs.existsSync(sourceFile) && locale !== 'en') sourceFile = path.resolve(path.join(root, 'docs/guide'), relSource);
    if (!sourceFile.startsWith(path.join(root, 'docs/assets/readme-showcase') + path.sep) || !fs.existsSync(sourceFile)) {
      throw new Error(`Guide images must use localized assets from docs/assets/readme-showcase/: ${relSource} (${locale})`);
    }
    const isZhAsset = /\.zh-CN\.png$/i.test(sourceFile);
    if (locale === 'en' && isZhAsset) throw new Error(`English guide cannot embed Chinese screenshot ${relSource}`);
    if (locale === 'zh-CN' && !isZhAsset) throw new Error(`Chinese guide must embed a .zh-CN.png showcase asset: ${relSource}`);
    const relFromAssets = path.relative(path.join(root, 'docs/assets'), sourceFile).replaceAll(path.sep, '-');
    if (!copiedAssets.has(sourceFile)) {
      const dest = path.join(assetDir, relFromAssets);
      fs.copyFileSync(sourceFile, dest);
      const dims = readPngDims(sourceFile);
      // Pair both `foo.png` -> `foo-dark.png` and `foo-light.png` -> `foo-dark.png`.
      const darkCandidates = [
        sourceFile.replace(/-light(\.[a-z]{2}(?:-[A-Za-z]+)?)?(\.png)$/i, '-dark$1$2'),
        sourceFile.replace(/(\.[a-z]{2}(?:-[A-Za-z]+)?)?(\.png)$/i, '-dark$1$2'),
      ];
      let darkPublic = null;
      for (const candidate of darkCandidates) {
        if (candidate !== sourceFile && fs.existsSync(candidate)) {
          const darkName = path.relative(path.join(root, 'docs/assets'), candidate).replaceAll(path.sep, '-');
          fs.copyFileSync(candidate, path.join(assetDir, darkName));
          darkPublic = `/assets/guide/${darkName}`;
          break;
        }
      }
      copiedAssets.set(sourceFile, { src: `/assets/guide/${relFromAssets}`, darkSrc: darkPublic, width: dims[0], height: dims[1] });
    }
    return copiedAssets.get(sourceFile);
  };

  const renderAssetPictureHtml = (relSource, locale, alt, eager = false) => {
    const asset = copyGuideAsset(relSource, locale);
    const attrs = `alt="${escape(alt)}" width="${asset.width}" height="${asset.height}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"`;
    const light = `<picture${asset.darkSrc ? ' class="blog-image-light"' : ''}><img src="${asset.src}" ${attrs}></picture>`;
    if (!asset.darkSrc) return light;
    return `${light}<picture class="blog-image-dark"><img src="${asset.darkSrc}" ${attrs}></picture>`;
  };

  const resolveHeadingId = (targetPage, hash, locale) => {
    let decoded = hash;
    try { decoded = decodeURIComponent(hash); } catch {}
    const list = targetPage.headings[locale] || targetPage.headings.en;
    const found = list.find(h => h.id === decoded || h.rawId === decoded) || targetPage.headings.en.find(h => h.id === decoded);
    return found ? found.id : null;
  };

  const resolveHref = (href, currentSlug, locale) => {
    if (/^(?:https?:|mailto:)/i.test(href)) return href;
    const [rawPath, hash = ''] = href.split('#');
    const current = bySlug.get(currentSlug);
    if (!rawPath) {
      if (!hash) return '#';
      const resolvedId = resolveHeadingId(current, hash, locale);
      if (!resolvedId) throw new Error(`Missing same-page anchor #${hash} in ${currentSlug} (${locale})`);
      return `#${resolvedId}`;
    }
    const clean = rawPath.replace(/^\.\//, '');
    if (/^[a-z0-9-]+\.md$/.test(clean)) {
      const targetSlug = clean.slice(0, -3);
      const target = bySlug.get(targetSlug);
      if (!target) throw new Error(`Unknown guide link ${href} in ${currentSlug} (${locale})`);
      if (hash) {
        const resolvedId = resolveHeadingId(target, hash, locale);
        if (!resolvedId) throw new Error(`Missing target anchor #${hash} in ${targetSlug} (linked from ${currentSlug}, ${locale})`);
        return `${guideRoute(locale, targetSlug)}#${resolvedId}`;
      }
      return guideRoute(locale, targetSlug);
    }
    const sourceLocale = current?.fallbackActive?.[locale] ? 'en' : locale;
    const baseDir = sourceLocale === 'en' ? path.join(root, 'docs/guide') : path.join(root, 'docs/guide', sourceLocale);
    const resolved = path.resolve(baseDir, rawPath);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      throw new Error(`Broken repository link ${href} in guide/${currentSlug} (${locale})`);
    }
    const repoRel = path.relative(root, resolved).split(path.sep).join('/');
    return `https://github.com/PapilotAI/papilot/blob/main/${repoRel}${hash ? `#${hash}` : ''}`;
  };

  const url = route => new URL(route, site).href;
  const alternates = routes => Object.entries(routes).map(([code, route]) => `<link rel="alternate" hreflang="${code}" href="${url(route)}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${url(routes.en)}">`;
  const sitemapEntry = (route, routes) => `<url><loc>${url(route)}</loc>${Object.entries(routes).map(([code, alt]) => `<xhtml:link rel="alternate" hreflang="${code}" href="${url(alt)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${url(routes.en)}"/></url>`;
  const write = (route, html) => {
    const dir = route.replace(/^\//, '');
    fs.mkdirSync(path.join(out, dir), { recursive: true });
    fs.writeFileSync(path.join(out, dir, 'index.html'), html);
    builtPages.push(dir.replace(/\/$/, ''));
  };

  const renderGroupedNav = (locale, currentSlug) => {
    const t = uiByLocale[locale];
    const homeActive = !currentSlug;
    const homeLink = `<a class="guide-sidebar-home" href="${guideRoute(locale)}"${homeActive ? ' aria-current="page"' : ''}>${icons.home}<span>${escape(t.allTopics)}</span></a>`;
    const sections = groups.map(group => {
      const items = orderedPages.filter(page => page.group === group.id).map(entry => {
        const active = entry.slug === currentSlug;
        const badge = entry.status === 'experimental' ? `<span class="guide-badge">${escape(t.experimentalBadge)}</span>` : '';
        return `<li><a href="${guideRoute(locale, entry.slug)}"${active ? ' aria-current="page"' : ''}><span>${escape(entry.locales[locale].shortTitle)}</span>${badge}</a></li>`;
      }).join('');
      const icon = groupIcons[group.id] || '';
      return `<section class="guide-nav-group"><p class="guide-group-title">${icon}<span>${escape(group.locales[locale])}</span></p><ul>${items}</ul></section>`;
    }).join('');
    return homeLink + sections;
  };

  const activeTabFor = currentSlug => {
    if (!currentSlug) return 'overview';
    const group = bySlug.get(currentSlug)?.group;
    if (group === 'getting-started' || group === 'writing-review') return 'guides';
    if (group === 'agents') return 'agents';
    if (group === 'collaborate') return 'collaborate';
    return 'reference';
  };

  function shell({ locale, title, seoTitle, description, route, routes, main, currentSlug = '' }) {
    const t = uiByLocale[locale], home = locale === 'en' ? '/' : `/${locale}/`;
    const blogHref = `${locale === 'en' ? '' : '/' + locale}/blog/`;
    const languages = Object.entries(routes).map(([code, href]) => `<a class="blog-language" lang="${code}" hreflang="${code}" href="${href}"${code === locale ? ' aria-current="true"' : ''}>${guideLanguageNames[code]}</a>`).join('');
    const canonical = url(route), social = url('/assets/social-preview.png');
    const socialBytes = fs.readFileSync(path.join(root, 'docs/assets/social-preview.png'));
    const [socialWidth, socialHeight] = [socialBytes.readUInt32BE(16), socialBytes.readUInt32BE(20)];
    const tracking = analytics.replace(/src="(statistics-preferences|analytics)\.js"/g, (_, name) => `src="/${name}.js?v=${version(name + '.js')}"`);
    const searchIndexUrl = `/guide/search-${locale}.json`;
    const activeTab = activeTabFor(currentSlug);
    const topTabs = [
      { id: 'overview', label: t.tabOverview, href: guideRoute(locale) },
      { id: 'guides', label: t.tabGuides, href: guideRoute(locale, 'quickstart') },
      { id: 'agents', label: t.tabAgents, href: guideRoute(locale, 'agents') },
      { id: 'collaborate', label: t.tabCollaborate, href: guideRoute(locale, 'overleaf') },
      { id: 'reference', label: t.tabReference, href: guideRoute(locale, 'troubleshooting') },
    ].map(tab => `<a href="${tab.href}"${tab.id === activeTab ? ' aria-current="page"' : ''}>${escape(tab.label)}</a>`).join('');
    const schema = {
      '@context': 'https://schema.org',
      '@type': currentSlug ? 'TechArticle' : 'CollectionPage',
      headline: title,
      description,
      inLanguage: locale,
      url: canonical,
      publisher: { '@type': 'Organization', name: 'Papilot', url: site },
    };
    const searchDialog = `<dialog id="guide-search-dialog" class="guide-search-dialog" closedby="any" aria-labelledby="guide-search-title" data-index="${searchIndexUrl}" data-empty="${escape(t.searchEmpty)}" data-no-results="${escape(t.searchNoResults)}" data-count="${escape(t.searchCount)}" data-experimental="${escape(t.experimentalBadge)}" data-load-error="${escape(t.searchLoadError)}">
      <div class="guide-search-head">
        <h2 id="guide-search-title" class="visually-hidden">${escape(t.searchLabel)}</h2>
        <search class="guide-search-form">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <label for="guide-search-input" class="visually-hidden">${escape(t.searchLabel)}</label>
          <input id="guide-search-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="guide-search-results" inputmode="search" enterkeyhint="search" autocomplete="off" spellcheck="false" autofocus placeholder="${escape(t.searchPlaceholder)}">
        </search>
        <form method="dialog" class="guide-search-close-form"><button type="submit" class="guide-search-close" aria-label="${escape(t.searchClose)}">Esc</button></form>
      </div>
      <p id="guide-search-status" class="guide-search-status" role="status" aria-live="polite">${escape(t.searchEmpty)}</p>
      <ul id="guide-search-results" class="guide-search-results" role="listbox" aria-label="${escape(t.searchLabel)}"></ul>
      <div class="guide-search-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> ${escape(t.searchHintMove)}</span><span><kbd>↵</kbd> ${escape(t.searchHintOpen)}</span><span><kbd>Esc</kbd> ${escape(t.searchClose)}</span></div>
    </dialog>`;
    return `<!doctype html>
<html lang="${locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(seoTitle)}</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${canonical}">${alternates(routes)}
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="${currentSlug ? 'article' : 'website'}"><meta property="og:site_name" content="Papilot"><meta property="og:locale" content="${guideOgLocales[locale]}">
${Object.keys(routes).filter(code => code !== locale).map(code => `<meta property="og:locale:alternate" content="${guideOgLocales[code]}">`).join('')}
<meta property="og:title" content="${escape(seoTitle)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${social}">
<meta property="og:image:width" content="${socialWidth}"><meta property="og:image:height" content="${socialHeight}"><meta property="og:image:alt" content="${escape(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(seoTitle)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${social}">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/TeXGyrePagellaX-Regular.otf" as="font" type="font/otf" crossorigin>
<script>try{const theme=localStorage.getItem('papilot-theme');if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;}catch{}</script>
<link rel="stylesheet" href="/style.css?v=${version('style.css')}"><link rel="stylesheet" href="/blog.css?v=${version('blog.css')}"><link rel="stylesheet" href="/guide.css?v=${version('guide.css')}">
<script defer src="/blog.js?v=${version('blog.js')}"></script><script defer src="/guide.js?v=${version('guide.js')}"></script><script type="application/ld+json">${json(schema)}</script>${tracking}
</head><body class="blog-page guide-page">
<a class="blog-skip" href="#content">${escape(t.skip)}</a>
<header class="guide-header">
  <div class="wrap guide-topbar-inner">
    <div class="guide-brand-wrap">
      <a class="brand" href="${home}"><img class="brand-mark" src="/assets/logo.svg" alt="" width="26" height="26"><span>Papilot</span></a>
      <a class="guide-brand-tag" href="${guideRoute(locale)}">${escape(t.label)}</a>
    </div>
    <button type="button" class="guide-search-bar" data-guide-search-open aria-haspopup="dialog" aria-controls="guide-search-dialog" aria-label="${escape(t.searchLabel)}" hidden>
      <span class="guide-search-bar-left"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>${escape(t.searchPlaceholder)}</span></span>
      <kbd>⌘K</kbd>
    </button>
    <div class="guide-header-actions">
      <a class="guide-header-link" href="${blogHref}">${escape(t.blog)}</a>
      <details class="blog-languages"><summary aria-label="${escape(t.languageLabel)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg><span>${guideLanguageNames[locale]}</span><svg class="blog-language-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></summary><nav aria-label="${escape(t.languageLabel)}">${languages}</nav></details>
      <button class="icon-button blog-theme" type="button" aria-label="${escape(t.theme)}" aria-pressed="false" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg></button>
      <a class="button compact blog-demo" href="/demo">${escape(t.demo)}</a>
    </div>
  </div>
  <div class="guide-tabsbar">
    <nav class="wrap guide-tabs" aria-label="${escape(t.mainNavigation)}">${topTabs}</nav>
  </div>
</header>
<main id="content">${main}</main>
${searchDialog}
<footer class="footer blog-footer"><div class="wrap footer-inner"><a class="brand" href="${home}">Papilot</a><nav aria-label="${escape(t.footerNavigation)}"><a href="${guideRoute(locale)}">${escape(t.label)}</a><a href="${blogHref}">${escape(t.blog)}</a><a href="https://github.com/PapilotAI/papilot">GitHub</a><a href="/privacy/">${escape(t.privacy)}</a></nav><p>MIT © 2026 PapilotAI</p></div></footer>
</body></html>`;
  }

  for (const locale of guideLocales) {
    const t = uiByLocale[locale];
    const searchIndex = [];
    const indexRoutes = Object.fromEntries(guideLocales.map(code => [code, guideRoute(code)]));
    const hubNavMarkup = renderGroupedNav(locale, '');
    const heroImgRel = locale === 'zh-CN' ? '../../assets/readme-showcase/hero.zh-CN.png' : '../assets/readme-showcase/hero.png';
    const flowImgRel = locale === 'zh-CN' ? '../../assets/readme-showcase/flow.zh-CN.png' : '../assets/readme-showcase/flow.png';

    const corePaths = [
      { slug: 'installation', icon: icons.download, blurb: t.cardInstall },
      { slug: 'annotate-and-read', icon: icons.annotate, blurb: t.cardAnnotate },
      { slug: 'review-and-save', icon: icons.review, blurb: t.cardReview },
      { slug: 'agents', icon: icons.spark, blurb: t.cardAgents },
    ].map(item => {
      const meta = bySlug.get(item.slug).locales[locale];
      return `<li class="guide-path-card"><a href="${guideRoute(locale, item.slug)}"><span class="guide-path-icon">${item.icon}</span><span class="guide-path-body"><strong>${escape(meta.shortTitle)}</strong><span>${escape(item.blurb)}</span></span></a></li>`;
    }).join('');

    const quickLinks = [
      { slug: 'papers-and-templates', label: bySlug.get('papers-and-templates').locales[locale].title },
      { slug: 'skills-and-memory', label: bySlug.get('skills-and-memory').locales[locale].title },
      { slug: 'overleaf', label: bySlug.get('overleaf').locales[locale].title },
      { slug: 'git-and-history', label: bySlug.get('git-and-history').locales[locale].title },
      { slug: 'remote-access', label: bySlug.get('remote-access').locales[locale].title },
      { slug: 'troubleshooting', label: bySlug.get('troubleshooting').locales[locale].title },
      { slug: 'reference', label: bySlug.get('reference').locales[locale].title },
      { slug: 'experiments', label: bySlug.get('experiments').locales[locale].title, badge: t.experimentalBadge },
    ].map(item => {
      const href = guideRoute(locale, item.slug) + (item.hash ? `#${item.hash}` : '');
      const badge = item.badge ? `<span class="guide-badge">${escape(item.badge)}</span>` : '';
      return `<li><a href="${href}"><span class="guide-quick-title"><span>${escape(item.label)}</span>${badge}</span><span class="guide-quick-arrow" aria-hidden="true">→</span></a></li>`;
    }).join('');

    const mdHub = locale === 'en' ? 'https://github.com/PapilotAI/papilot/blob/main/docs/guide.md' : 'https://github.com/PapilotAI/papilot/blob/main/docs/guide.zh-CN.md';
    const indexMain = `<div class="wrap guide-shell guide-shell-hub">
      <aside class="guide-sidebar">
        <nav class="guide-topics-nav" aria-label="${escape(t.guideNavigation)}">${hubNavMarkup}</nav>
      </aside>
      <div class="guide-hub-main">
        <details class="guide-mobile-nav">
          <summary>
            <span class="guide-mobile-nav-label"><span>${escape(t.label)}</span><strong>${escape(t.allTopics)}</strong></span>
            <svg class="guide-mobile-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="guide-mobile-nav-body">
            <nav class="guide-topics-nav" aria-label="${escape(t.mobileNavigation)}">${hubNavMarkup}</nav>
          </div>
        </details>
        <header class="guide-hub-head">
          <p class="guide-hub-kicker"><span class="guide-badge guide-badge-version">v${escape(tokens.release)}</span><span>${escape(t.indexKicker)}</span></p>
          <h1>${escape(t.indexTitle)}</h1>
          <p class="guide-hub-lead">${escape(t.indexLead)}</p>
        </header>
        <section class="guide-quickstart-card" aria-labelledby="guide-quickstart-heading">
          <div class="guide-quickstart-copy">
            <span class="guide-quickstart-kicker">${escape(t.quickstartKicker)}</span>
            <h2 id="guide-quickstart-heading">${escape(t.quickstartTitle)}</h2>
            <p>${escape(t.quickstartBody)}</p>
            <div class="guide-quickstart-actions">
              <a class="guide-primary-cta" href="${guideRoute(locale, 'quickstart')}">${escape(t.quickstartCta)} →</a>
              <a class="guide-secondary-cta" href="/demo">${escape(t.demo)}</a>
            </div>
          </div>
          <div class="guide-quickstart-visual">${renderAssetPictureHtml(heroImgRel, locale, t.quickstartVisualAlt, true)}</div>
        </section>
        <section class="guide-section" aria-labelledby="guide-paths-heading">
          <div class="guide-section-head">
            <h2 id="guide-paths-heading">${escape(t.corePathsTitle)}</h2>
          </div>
          <ul class="guide-path-grid">${corePaths}</ul>
        </section>
        <section class="guide-section" aria-labelledby="guide-workflow-heading">
          <div class="guide-section-head">
            <h2 id="guide-workflow-heading">${escape(t.workflowTitle)}</h2>
            <p class="guide-section-sub">${escape(t.workflowSub)}</p>
          </div>
          <div class="guide-workflow-frame">${renderAssetPictureHtml(flowImgRel, locale, t.workflowVisualAlt, true)}</div>
        </section>
        <section class="guide-section" aria-labelledby="guide-quick-heading">
          <h2 id="guide-quick-heading">${escape(t.quickLinksTitle)}</h2>
          <ul class="guide-quick-grid">${quickLinks}</ul>
        </section>
        <footer class="guide-hub-meta">
          <a href="${mdHub}">${escape(t.githubMarkdown)}</a>
          <a href="https://github.com/PapilotAI/papilot/blob/main/docs/development.md">${escape(t.developerLink)}</a>
        </footer>
      </div>
    </div>`;
    write(guideRoute(locale), shell({ locale, title: t.indexTitle, seoTitle: t.indexSeoTitle, description: t.indexDescription, route: guideRoute(locale), routes: indexRoutes, main: indexMain }));
    sitemap.push(sitemapEntry(guideRoute(locale), indexRoutes));

    orderedPages.forEach((page, index) => {
      const meta = page.locales[locale], route = guideRoute(locale, page.slug);
      const groupTitle = groupMap.get(page.group)?.locales[locale] || '';
      const routes = Object.fromEntries(guideLocales.map(code => [code, guideRoute(code, page.slug)]));
      const headings = page.headings[locale];
      searchIndex.push({
        id: page.slug,
        title: meta.title,
        heading: '',
        group: groupTitle,
        status: page.status || '',
        url: route,
        excerpt: meta.summary,
      });
      for (const section of extractSectionsForSearch(page.bodies[locale], headings)) {
        if (!section.heading) continue;
        searchIndex.push({
          id: `${page.slug}#${section.id}`,
          title: meta.title,
          heading: section.heading,
          group: groupTitle,
          status: page.status || '',
          url: `${route}#${section.id}`,
          excerpt: section.excerpt,
        });
      }

      let headingCursor = 0, tableCount = 0, codeCount = 0;
      const accessibleTables = () => tree => {
        const visit = node => {
          if (node.tagName === 'table') {
            const elements = parent => (parent?.children || []).filter(child => child.type === 'element');
            const head = elements(node).find(child => child.tagName === 'thead');
            const bodyNode = elements(node).find(child => child.tagName === 'tbody');
            const labels = elements(elements(head)[0]).map(cell => { cell.properties = { ...cell.properties, scope: 'col' }; return text(cell).trim(); });
            for (const row of elements(bodyNode)) elements(row).forEach((cell, cellIndex) => {
              if (cellIndex === 0) { cell.tagName = 'th'; cell.properties = { ...cell.properties, scope: 'row' }; }
              else if (labels[cellIndex]) cell.properties = { ...cell.properties, 'data-label': labels[cellIndex] };
            });
          }
          for (const child of node.children || []) visit(child);
        };
        visit(tree);
      };
      const renderHeading = level => ({ children }) => {
        const current = headings[headingCursor++];
        return React.createElement(
          level,
          { id: current.id },
          children,
          React.createElement('a', { className: 'guide-heading-anchor', href: `#${current.id}`, 'aria-label': `${t.sectionLinkPrefix} ${current.label}` }, '#'),
        );
      };
      const renderImage = ({ src, alt }) => {
        const asset = copyGuideAsset(src, page.fallbackActive[locale] ? 'en' : locale);
        const light = React.createElement('picture', { className: asset.darkSrc ? 'blog-image-light' : undefined }, React.createElement('img', { src: asset.src, alt: alt || '', width: asset.width, height: asset.height, loading: 'lazy', decoding: 'async' }));
        if (!asset.darkSrc) return light;
        const dark = React.createElement('picture', { className: 'blog-image-dark' }, React.createElement('img', { src: asset.darkSrc, alt: alt || '', width: asset.width, height: asset.height, loading: 'lazy', decoding: 'async' }));
        return React.createElement(React.Fragment, null, light, dark);
      };
      const renderPre = ({ children }) => {
        const codeId = `guide-code-${++codeCount}`;
        const child = React.Children.only(children);
        const clonedCode = React.isValidElement(child) ? React.cloneElement(child, { id: codeId }) : React.createElement('code', { id: codeId }, children);
        return React.createElement(
          'div',
          { className: 'guide-code' },
          React.createElement('pre', { role: 'region', 'aria-label': `${t.codeBlockLabel} ${codeCount}`, tabIndex: 0 }, clonedCode),
          React.createElement(
            'span',
            { className: 'guide-copy' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'guide-copy-button',
                hidden: true,
                command: '--copy',
                commandfor: codeId,
                'aria-label': `${t.copyCode} (${codeCount})`,
                'data-copied-label': t.copied,
                'data-failed-label': t.copyFailed,
              },
              React.createElement(
                'svg',
                { className: 'guide-icon-copy', width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true' },
                React.createElement('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }),
                React.createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
              ),
              React.createElement(
                'svg',
                { className: 'guide-icon-check', width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
                React.createElement('path', { d: 'M20 6 9 17l-5-5' }),
              ),
            ),
            React.createElement('span', { className: 'guide-copy-tip', role: 'status' }),
          ),
        );
      };
      const body = renderToStaticMarkup(React.createElement(Markdown, {
        skipHtml: true,
        remarkPlugins: [remarkGfm],
        rehypePlugins: [accessibleTables],
        components: {
          h2: renderHeading('h2'),
          h3: renderHeading('h3'),
          a: ({ href = '', children }) => React.createElement('a', { href: resolveHref(href, page.slug, locale) }, children),
          img: renderImage,
          pre: renderPre,
          table: ({ children }) => React.createElement('div', { className: 'blog-table-wrap', role: 'region', tabIndex: 0, 'aria-label': `${meta.title} (${++tableCount})` }, React.createElement('table', null, children)),
          p: ({ node, children }) => {
            const images = node.children.filter(child => child.tagName === 'img');
            if (images.length && node.children.every(child => child.tagName === 'img' || child.type === 'text' && !child.value.trim())) {
              return React.createElement('figure', { className: 'blog-figure guide-figure' }, children, images[0].properties.alt && React.createElement('figcaption', null, images[0].properties.alt));
            }
            return React.createElement('p', null, children);
          },
        },
      }, page.bodies[locale]));

      const navMarkup = renderGroupedNav(locale, page.slug);
      const tocLinks = headings.map(item => `<li${item.level === 'h3' ? ' class="guide-toc-sub"' : ''}><a href="#${escape(item.id)}">${escape(item.label)}</a></li>`).join('');
      const prev = orderedPages[index - 1], next = orderedPages[index + 1];
      const pager = `<nav class="guide-pager" aria-label="${escape(t.pagerNavigation)}">${
        prev ? `<a class="guide-pager-prev" href="${guideRoute(locale, prev.slug)}"><span>← ${escape(t.previous)}</span><strong>${escape(prev.locales[locale].title)}</strong></a>` : '<span></span>'
      }${
        next ? `<a class="guide-pager-next" href="${guideRoute(locale, next.slug)}"><span>${escape(t.next)} →</span><strong>${escape(next.locales[locale].title)}</strong></a>` : ''
      }</nav>`;
      const githubFile = page.fallbackActive[locale] || locale === 'en' ? `docs/guide/${page.slug}.md` : `docs/guide/zh-CN/${page.slug}.md`;
      const statusBadge = page.status === 'experimental' ? `<span class="guide-badge">${escape(t.experimentalBadge)}</span>` : '';
      const experimentalNotice = page.status === 'experimental'
        ? `<div class="guide-callout"><strong>${escape(t.experimentalBadge)}</strong> — ${escape(t.experimentalNotice)}</div>`
        : '';
      const fallbackNotice = page.fallbackActive[locale]
        ? `<div class="guide-callout">${escape(t.fallbackNotice)}</div>`
        : '';
      const proseAttr = page.fallbackActive[locale] ? ' lang="en"' : '';
      const main = `<div class="wrap guide-shell">
        <aside class="guide-sidebar">
          <nav class="guide-topics-nav" aria-label="${escape(t.guideNavigation)}">${navMarkup}</nav>
        </aside>
        <article class="guide-article">
          <details class="guide-mobile-nav">
            <summary>
              <span class="guide-mobile-nav-label"><span>${escape(groupTitle)}</span><strong>${escape(meta.shortTitle)}</strong></span>
              <svg class="guide-mobile-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <div class="guide-mobile-nav-body">
              <nav class="guide-topics-nav" aria-label="${escape(t.mobileNavigation)}">${navMarkup}</nav>
            </div>
          </details>
          <header class="guide-article-head">
            <p class="guide-step-kicker"><span>${escape(groupTitle)}</span>${statusBadge}</p>
            <h1>${escape(meta.title)}</h1>
            <p class="guide-article-lead">${escape(meta.summary)}</p>
            <nav class="guide-mobile-toc" aria-label="${escape(t.mobileContents)}"><p>${escape(t.contents)}</p><ol>${tocLinks}</ol></nav>
          </header>
          ${experimentalNotice}
          ${fallbackNotice}
          <div class="blog-prose guide-prose"${proseAttr}>${body}</div>
          <p class="guide-source-link"><a href="https://github.com/PapilotAI/papilot/blob/main/${githubFile}">${escape(t.githubMarkdown)}</a> · <a href="https://github.com/PapilotAI/papilot/edit/main/${githubFile}">${escape(t.editOnGithub)}</a> · <a href="https://github.com/PapilotAI/papilot/blob/main/docs/development.md">${escape(t.developerLink)}</a></p>
          ${pager}
        </article>
        <aside class="blog-toc guide-toc"><nav aria-label="${escape(t.contents)}"><p>${escape(t.contents)}</p><ol>${tocLinks}</ol></nav></aside>
      </div>`;
      write(route, shell({ locale, title: meta.title, seoTitle: `${meta.title} · ${t.indexTitle}`, description: meta.description, route, routes, main, currentSlug: page.slug }));
      sitemap.push(sitemapEntry(route, routes));
    });

    fs.mkdirSync(path.join(out, 'guide'), { recursive: true });
    fs.writeFileSync(path.join(out, 'guide', `search-${locale}.json`), JSON.stringify(searchIndex));
  }
  return { pages: builtPages, sitemap: sitemap.join(''), count: orderedPages.length };
}
