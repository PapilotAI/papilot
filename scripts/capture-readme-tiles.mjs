// The README's "Why Papilot" tiles, captured from the homepage (Node 22):
//
//   npm run site && node scripts/capture-readme-tiles.mjs
//
// Six panels of one size, each on the homepage's backdrop: its three feature
// windows (annotate, review, record), the phone layout in front of the
// desktop window, and two scenes drawn here with the homepage's styles: the
// composer's model menu, and Overleaf sync with the app's own sidebar rows,
// coauthor faces, colours and cursor flags. A seventh, twice as wide, frames the live
// papilot.ai/universe gallery with one template of each kind first, so it
// needs the network. Each is written in light and dark, in English and
// Simplified Chinese, as docs/assets/readme-showcase/why-<name>[-dark][.zh-CN].png;
// other README languages use the English images. Tiles are 1.5x: the README
// shows them at most about 440 px wide (the Universe one about 900 px).
//
// "Get started" shows a card per system (macOS, Windows, Linux) and one for
// the terminal, as docs/assets/readme-downloads/<name>[-compact][-dark][.zh-CN].png. The agent
// section shows a grid of the agents' logo chips, at desktop and phone width,
// as docs/assets/readme-agents/grid[-compact][-dark].png, and "Community" a
// card per way to take part, as docs/assets/readme-community/<name>[-compact][-dark][.zh-CN].png.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from './playwright.mjs';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, '_site');
const output = path.join(root, 'docs/assets/readme-showcase');
if (!fs.existsSync(path.join(site, 'index.html'))) throw new Error('Run npm run site first.');

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.otf': 'font/otf' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let file = path.join(site, decodeURIComponent(url.pathname));
  if (!file.startsWith(site)) { response.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// A window with room for its shadow, as a data URL for the tile.
const pad = 28;
async function capture(page, selector) {
  const element = page.locator(selector);
  await element.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await element.boundingBox();
  const scroll = await page.evaluate(() => window.scrollY);
  const image = await page.screenshot({ clip: { x: Math.max(0, box.x - pad), y: box.y + scroll - pad, width: box.width + pad * 2, height: box.height + pad * 2 }, fullPage: true, omitBackground: true, animations: 'disabled' });
  return { src: `data:image/png;base64,${image.toString('base64')}`, width: box.width + pad * 2, height: box.height + pad * 2 };
}

const copy = {
  en: { live: 'Live', heading: '1 Introduction', stop: '.', lead: 'Reviewing an AI edit', mine: 'should take one look', ada: 'Ada Lovelace', grace: 'Grace Hopper', theirs: 'at the page' },
  'zh-CN': { live: '实时', heading: '1 引言', stop: '。', lead: '审阅 AI 的修改', mine: '只需看一眼', ada: 'Ada Lovelace', grace: 'Grace Hopper', theirs: '排版后的页面' },
};

// Live sync with Overleaf: Papilot's PDF on the left with your accepted
// edit marked, Overleaf's editor on the right with the same edit and a
// coauthor's words in their colour beside their cursor, the two joined by
// arrows both ways. The marks are
// Papilot's and Overleaf's own (src/web/brand-icons), as the app shows them.
function drawOverleaf(text) {
  const leaf = size => `<i style="flex:none;width:${size}px;height:${size}px;background:var(--leaf);-webkit-mask:url(/assets/agents/overleaf.svg) center/contain no-repeat;mask:url(/assets/agents/overleaf.svg) center/contain no-repeat"></i>`;
  const face = (hue, initials) => `<i style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:hsl(${hue} 62% 48%);color:#fff;font:600 9px/1 var(--sans);font-style:normal;box-shadow:0 0 0 2px var(--bg)">${initials}</i>`;
  const bar = width => `<i style="display:block;width:${width}%;height:5px;border-radius:3px;background:var(--line)"></i>`;
  const author = (hue, html) => `<span style="background:hsl(${hue} 80% 55%/.16);box-shadow:inset 0 -1.5px 0 hsl(${hue} 65% 50%/.75);border-radius:1px">${html}</span>`;
  const cursor = (hue, name) => `<span style="position:relative;display:inline-block;width:0;height:1.2em;vertical-align:text-top;border-left:2px solid hsl(${hue} 70% 48%);margin:0 -1px"><span style="position:absolute;top:50%;left:3px;transform:translateY(-50%);padding:1px 6px;border-radius:4px;background:hsl(${hue} 70% 42%);color:#fff;font:500 10px/1.45 var(--sans);white-space:nowrap">${name}</span></span>`;
  const code = (n, html) => `<p style="display:flex;gap:10px;margin:0;font:11px/2.05 var(--mono);color:var(--text);white-space:nowrap"><span style="width:14px;text-align:right;color:var(--text-3)">${n}</span><span>${html}</span></p>`;
  const panel = (title, mark, body, extra = '') => `<div style="position:relative;width:236px;height:268px;overflow:hidden;border-radius:14px;background:var(--bg);box-shadow:0 0 0 1px var(--line),var(--float)"><p style="display:flex;align-items:center;gap:9px;height:46px;margin:0;padding:0 14px;border-bottom:1px solid var(--line);font-size:14px;font-weight:600;color:var(--text)">${mark}<span style="flex:1">${title}</span>${extra}</p>${body}</div>`;
  const arrow = direction => `<svg width="44" height="14" viewBox="0 0 44 14" style="display:block;color:var(--accent);${direction === 'left' ? 'transform:scaleX(-1)' : ''}"><path d="M2 7h38m-6-5 6 5-6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const figure = document.createElement('div');
  figure.id = 'readme-overleaf';
  figure.style.cssText = 'display:flex;align-items:center;gap:14px;width:max-content;margin:48px auto;padding:20px;--leaf:light-dark(#138a07,#4cc34a)';
  figure.innerHTML = `
    ${panel('Papilot', '<img src="/assets/logo.svg" alt="" style="width:20px;height:20px">', `<div style="padding:16px 18px;display:grid;gap:8px"><p style="margin:0 0 2px;font:700 13px var(--serif);color:var(--text)">${text.heading}</p>${bar(100)}${bar(86)}<p style="margin:2px 0;font:12.5px/1.5 var(--serif);color:var(--text)">${text.lead} <span style="background:var(--mark);border-radius:2px;padding:0 2px">${text.mine}</span> ${text.theirs}${text.stop}</p>${bar(100)}${bar(64)}${bar(92)}${bar(48)}</div>`)}
    <div style="display:grid;justify-items:center;gap:8px">${arrow('right')}<span style="display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);font-size:11.5px;font-weight:600;color:var(--accent)"><i style="width:6px;height:6px;border-radius:50%;background:var(--accent)"></i>${text.live}</span>${arrow('left')}</div>
    ${panel('Overleaf', leaf(22), `<div style="padding:18px 14px 0">
        ${code(12, '\\section{Introduction}')}
        ${code(13, text.lead)}
        ${code(14, `<span style="background:var(--mark);border-radius:2px">${text.mine}</span>`)}
        ${code(15, `${author(265, text.theirs)}${text.stop}${cursor(265, text.ada)}`)}
        ${code(16, '')}
        ${code(17, '\\begin{equation}')}
        ${code(18, `&nbsp;&nbsp;T(n) = ${author(28, '2T(n/2)')}${cursor(28, text.grace)}`)}
        ${code(19, '\\end{equation}')}</div>`, `<span style="display:flex">${face(265, 'AL')}<span style="margin-left:-5px">${face(28, 'GH')}</span></span>`)}`;
  document.body.append(figure);
}

// Bring your own agent: the composer's model menu, open, as the app draws it
// (search, then each agent's models under its mark, the current one checked
// and another agent's marked as restarting the task).
const pickerCopy = {
  en: { search: 'Search models', standard: 'Default model', tag: 'Default', task: 'New task', notes: '2 notes on the PDF' },
  'zh-CN': { search: '搜索模型', standard: '默认模型', tag: '默认', task: '新任务', notes: 'PDF 上的 2 条批注' },
};
function drawPicker(text) {
  const mark = (id, color = 'var(--text)') => `<i style="flex:none;width:15px;height:15px;background:${color};-webkit-mask:url(/assets/agents/${id}.svg) center/contain no-repeat;mask:url(/assets/agents/${id}.svg) center/contain no-repeat"></i>`;
  const icon = (name, color, size = 14) => `<svg class="ic" style="width:${size}px;height:${size}px;color:${color}"><use href="#i-${name}"/></svg>`;
  const head = (id, name, color) => `<p style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding:0 10px;font-size:11.5px;font-weight:500;color:var(--text-3)">${mark(id, color)}${name}</p>`;
  const option = (name, { tag = false, chosen = false, restart = false } = {}) => `<p style="display:flex;align-items:center;gap:8px;margin:0;padding:6px 10px 6px 33px;border-radius:7px;font-size:12.5px;color:var(--text);${chosen ? 'background:var(--bg-hover);' : ''}"><span style="flex:1">${name}</span>${tag ? `<small style="font-size:10.5px;color:var(--text-3)">${text.tag}</small>` : ''}${restart ? icon('refresh', 'var(--text-3)', 13) : ''}${chosen ? icon('check', 'var(--accent)', 14) : ''}</p>`;
  const bar = width => `<i style="display:block;width:${width}%;height:6px;border-radius:3px;background:var(--line)"></i>`;
  const figure = document.createElement('figure');
  figure.id = 'readme-picker';
  figure.className = 'app-window';
  figure.style.cssText = 'width:612px;height:436px;margin:48px auto';
  figure.innerHTML = `
    <div class="app-bar"><span class="lights"><i></i><i></i><i></i></span></div>
    <p style="display:flex;align-items:center;gap:8px;height:46px;margin:0;padding:0 18px 0 96px;border-bottom:1px solid var(--line);font-size:13px;font-weight:500;color:var(--text)">${icon('compose', 'var(--text-2)', 15)}${text.task}</p>
    <div style="position:relative;height:390px;background:var(--bg-subtle)">
      <div style="position:absolute;left:344px;right:24px;top:20px;padding:12px 14px;border-radius:12px;background:var(--bg-muted)"><p style="display:flex;align-items:center;gap:7px;margin:0 0 10px;font-size:12px;color:var(--text-2)">${icon('notes', 'var(--text-2)', 14)}${text.notes}</p><span style="display:grid;gap:8px">${bar(84)}${bar(58)}</span></div>
      <div style="position:absolute;left:24px;bottom:84px;width:300px;padding:8px;border-radius:12px;background:var(--bg);box-shadow:0 0 0 1px var(--line),0 16px 36px -12px rgb(15 23 42/.32)">
        <p style="display:flex;align-items:center;gap:8px;margin:0 0 2px;padding:7px 10px;border-radius:8px;background:var(--bg-muted);font-size:12.5px;color:var(--text-3)">${icon('search', 'var(--text-3)', 14)}${text.search}</p>
        ${head('codex', 'Codex')}${option(text.standard, { tag: true, chosen: true })}
        ${head('claude', 'Claude', '#d97757')}${option('Opus 5.5', { restart: true })}${option('Sonnet 5.5', { restart: true })}
        ${head('glm', 'GLM', '#5d78e5')}${option('GLM-5.3', { restart: true })}
      </div>
      <div style="position:absolute;left:24px;right:24px;bottom:18px;display:flex;align-items:center;gap:10px;height:52px;padding:0 12px;border-radius:12px;background:var(--bg);box-shadow:0 0 0 1px var(--line)">${icon('plus', 'var(--text-2)', 15)}<span style="display:flex;align-items:center;gap:7px;padding:4px 8px;border-radius:7px;background:var(--bg-hover);font-size:12.5px;color:var(--text)">${mark('codex')}Codex<small style="color:var(--text-3)">${text.standard}</small>${icon('chevron-down', 'var(--text-3)', 13)}</span><span style="flex:1"></span><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bg-hover)">${icon('arrow-up', 'var(--text-3)', 14)}</span></div>
    </div>`;
  document.body.append(figure);
}

// The README's cards: a plain raised surface, as the app's floating panels.
const cardSurface = 'box-sizing:border-box;border-radius:16px;background:light-dark(#fff,#1b1c1f);box-shadow:0 0 0 1px light-dark(rgb(15 23 42/.07),rgb(255 255 255/.07)),0 1px 2px rgb(15 23 42/.05),0 10px 24px -12px rgb(15 23 42/.2)';

// "Get started": a card per system with its installers and one for the
// terminal, each linked on its own in the README, two to a row, in the
// community cards' style. Phones get the compact card.
const systemsCopy = {
  en: { download: 'Download', mac: 'Apple silicon and Intel', windows: 'x64 PCs', linux: 'Ubuntu, Fedora, Arch, NixOS', installer: 'Installer', portable: 'Portable', terminal: 'Terminal', node: 'Node.js 22.22+', pmTitle: 'Package managers', pmAction: 'Install commands' },
  'zh-CN': { download: '下载', mac: 'Apple 芯片和 Intel', windows: 'x64 电脑', linux: 'Ubuntu、Fedora、Arch、NixOS', installer: '安装版', portable: '便携版', terminal: '终端', node: 'Node.js 22.22+', pmTitle: '包管理器安装', pmAction: '展开命令' },
};
function drawSystems({ text, icons, surface }) {
  const card = surface;
  const chip = label => `<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line);font:500 11px/1.35 var(--mono);color:var(--text-2)">${label}</span>`;
  const mark = d => `<span style="display:grid;place-items:center;flex:none;width:52px;height:52px;border-radius:15px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.05),0 8px 20px -10px rgb(15 23 42/.22)"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text)"><path d="${d}"/></svg></span>`;
  const download = `<span style="display:flex;align-items:center;gap:6px;flex:none;font-size:14px;font-weight:500;color:var(--accent)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></svg>${text.download}</span>`;
  const cards = {
    mac: [icons.mac, 'macOS', text.mac, ['DMG', 'ZIP', 'Homebrew']],
    windows: [icons.windows, 'Windows', text.windows, [text.installer, text.portable, 'Scoop']],
    linux: [icons.linux, 'Linux', text.linux, ['AppImage', 'APT', 'AUR', 'Nix']],
  };
  const row = document.createElement('div');
  row.id = 'readme-systems';
  row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;width:960px;margin:140px auto 48px';
  const prompt = '<span style="color:var(--text-3)">$</span>';
  row.innerHTML = Object.entries(cards).map(([name, [icon, title, sub, chips]]) =>
    `<div data-card="${name}" style="display:flex;align-items:center;gap:18px;width:440px;height:140px;padding:0 24px;${card}">${mark(icon)}<div style="flex:1"><p style="margin:0 0 3px;font:400 22px/1.2 var(--serif);color:var(--text)">${title}</p><p style="margin:0 0 9px;font-size:13px;color:var(--text-2)">${sub}</p><span style="display:flex;gap:6px">${chips.map(chip).join('')}</span></div>${download}</div>`
    + `<div data-card="${name}-compact" style="display:flex;flex-direction:column;justify-content:center;gap:12px;width:220px;height:170px;padding:0 20px;${card}">${mark(icon)}<p style="margin:0;font:400 21px/1.2 var(--serif);color:var(--text)">${title}</p>${download}</div>`).join('')
    + `<div data-card="terminal" style="display:flex;flex-direction:column;justify-content:center;width:440px;height:140px;padding:0 24px;${card}"><p style="display:flex;align-items:center;gap:7px;margin:0 0 8px;font-size:12px;color:var(--text-3)"><span class="lights"><i></i><i></i><i></i></span>&nbsp;${text.terminal}</p><p style="margin:0;font:13.5px/1.9 var(--mono);color:var(--text)">${prompt} npm install -g papilot<br>${prompt} papilot demo</p><p style="margin:4px 0 0;font:12px var(--mono);color:var(--text-3)">${text.node}</p></div>`
    + `<div data-card="terminal-compact" style="display:flex;flex-direction:column;justify-content:center;gap:12px;width:220px;height:170px;padding:0 18px;${card}"><span class="lights"><i></i><i></i><i></i></span><p style="margin:0;font:12px/1.8 var(--mono);color:var(--text);white-space:nowrap">${prompt} npm install -g papilot<br>${prompt} papilot demo</p><p style="margin:0;font:11px var(--mono);color:var(--text-3)">${text.node}</p></div>`;
  const pmIcon = (d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text-2);flex:none"><path d="${d}"/></svg>`;
  const pmChip = (svg, label) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line);font:500 12px/1.2 var(--sans);color:var(--text);white-space:nowrap">${svg}${label}</span>`;
  const pmChips = [
    pmChip(pmIcon(icons.homebrew, 14), 'Homebrew'),
    pmChip(pmIcon(icons.scoop, 14), 'Scoop'),
    pmChip(pmIcon(icons.debian, 13) + pmIcon(icons.ubuntu, 13), 'APT'),
    pmChip(pmIcon(icons.archlinux, 13), 'AUR'),
    pmChip(pmIcon(icons.nixos, 14), 'Nix'),
  ].join('');
  const chevron = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  row.innerHTML +=
    `<div data-card="pm-bar" style="display:flex;align-items:center;gap:14px;width:868px;height:56px;padding:0 22px;border-radius:16px;background:linear-gradient(180deg,light-dark(#fbfbfc,#191a1e),light-dark(#f3f4f7,#15161a));box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.04),0 10px 24px -18px rgb(15 23 42/.22);box-sizing:border-box"><span style="font:600 14px/1 var(--sans);color:var(--text);white-space:nowrap">${text.pmTitle}</span><span style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">${pmChips}</span><span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px;font:500 13.5px/1 var(--sans);color:var(--accent);white-space:nowrap">${text.pmAction}${chevron}</span></div>`
    + `<div data-card="pm-bar-compact" style="display:flex;flex-direction:column;gap:10px;width:420px;padding:14px 18px;border-radius:16px;background:linear-gradient(180deg,light-dark(#fbfbfc,#191a1e),light-dark(#f3f4f7,#15161a));box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.04),0 10px 24px -18px rgb(15 23 42/.22);box-sizing:border-box"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font:600 14px/1 var(--sans);color:var(--text)">${text.pmTitle}</span><span style="display:inline-flex;align-items:center;gap:4px;font:500 13px/1 var(--sans);color:var(--accent)">${text.pmAction}${chevron}</span></div><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${pmChips}</span></div>`;
  document.body.append(row);
  // Room around each card for its shadow; the README shows the padded image.
  for (const card of row.querySelectorAll('[data-card]')) {
    const pad = card.dataset.card.startsWith('pm-bar') ? '4px 10px 14px' : '4px 12px 20px';
    const wrap = Object.assign(document.createElement('div'), { style: `padding:${pad}` });
    wrap.dataset.shot = card.dataset.card;
    card.replaceWith(wrap);
    wrap.append(card);
  }
}

// "Community": a card per way to take part, each linked on its own in the
// README, two to a row. Phones get the compact card: the chip and the title.
const communityCopy = {
  en: { issue: ['Report a bug', 'Something broken or missing? Open an issue, even a rough one.'], discussion: ['Ask a question', 'Share an idea or ask how to do something.'], discord: ['Chat on Discord', 'Talk with the people who build and use Papilot.'], contribute: ['Contribute', 'Pull requests are welcome, including ones written with AI agents.'] },
  'zh-CN': { issue: ['报告问题', '哪里坏了或缺了什么？开个 issue，随便写写也行。'], discussion: ['提问交流', '分享想法，或问问某件事怎么做。'], discord: ['加入 Discord', '和开发、使用 Papilot 的人聊聊。'], contribute: ['参与贡献', '欢迎提交 PR，用 AI 智能体写的也欢迎。'] },
};
function drawCommunity({ icons, text, surface }) {
  const row = document.createElement('div');
  row.id = 'readme-community';
  row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;width:960px;margin:140px auto 48px';
  const chip = svg => `<span style="display:grid;place-items:center;flex:none;width:52px;height:52px;border-radius:15px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.05),0 8px 20px -10px rgb(15 23 42/.22)">${svg}</span>`;
  const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;color:var(--accent)"><path d="M7 17 17 7M8 7h9v9"/></svg>';
  row.innerHTML = Object.entries(icons).map(([name, svg]) => {
    const [title, body] = text[name];
    const card = surface;
    return `<div data-card="${name}" style="display:flex;align-items:center;gap:18px;width:440px;height:128px;padding:0 24px;${card}">${chip(svg)}<div style="flex:1"><p style="margin:0 0 5px;font:400 21px/1.2 var(--serif);color:var(--text)">${title}</p><p style="margin:0;font-size:13.5px;line-height:1.45;color:var(--text-2);text-wrap:balance">${body}</p></div>${arrow}</div>`
      + `<div data-card="${name}-compact" style="display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:14px;width:220px;height:150px;padding:0 20px;${card}">${chip(svg)}<p style="display:flex;align-items:center;gap:6px;width:100%;margin:0;font:400 20px/1.2 var(--serif);color:var(--text)"><span style="flex:1">${title}</span>${arrow}</p></div>`;
  }).join('');
  const pmIcon = (d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text-2);flex:none"><path d="${d}"/></svg>`;
  const pmChip = (svg, label) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line);font:500 12px/1.2 var(--sans);color:var(--text);white-space:nowrap">${svg}${label}</span>`;
  const pmChips = [
    pmChip(pmIcon(icons.homebrew, 14), 'Homebrew'),
    pmChip(pmIcon(icons.scoop, 14), 'Scoop'),
    pmChip(pmIcon(icons.debian, 13) + pmIcon(icons.ubuntu, 13), 'APT'),
    pmChip(pmIcon(icons.archlinux, 13), 'AUR'),
    pmChip(pmIcon(icons.nixos, 14), 'Nix'),
  ].join('');
  const chevron = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  row.innerHTML +=
    `<div data-card="pm-bar" style="display:flex;align-items:center;gap:14px;width:868px;height:56px;padding:0 22px;border-radius:16px;background:linear-gradient(180deg,light-dark(#fbfbfc,#191a1e),light-dark(#f3f4f7,#15161a));box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.04),0 10px 24px -18px rgb(15 23 42/.22);box-sizing:border-box"><span style="font:600 14px/1 var(--sans);color:var(--text);white-space:nowrap">${text.pmTitle}</span><span style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">${pmChips}</span><span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px;font:500 13.5px/1 var(--sans);color:var(--accent);white-space:nowrap">${text.pmAction}${chevron}</span></div>`
    + `<div data-card="pm-bar-compact" style="display:flex;flex-direction:column;gap:10px;width:420px;padding:14px 18px;border-radius:16px;background:linear-gradient(180deg,light-dark(#fbfbfc,#191a1e),light-dark(#f3f4f7,#15161a));box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.04),0 10px 24px -18px rgb(15 23 42/.22);box-sizing:border-box"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font:600 14px/1 var(--sans);color:var(--text)">${text.pmTitle}</span><span style="display:inline-flex;align-items:center;gap:4px;font:500 13px/1 var(--sans);color:var(--accent)">${text.pmAction}${chevron}</span></div><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${pmChips}</span></div>`;
  document.body.append(row);
  // Room around each card for its shadow; the README shows the padded image.
  for (const card of row.querySelectorAll('[data-card]')) {
    const pad = card.dataset.card.startsWith('pm-bar') ? '4px 10px 14px' : '4px 12px 20px';
    const wrap = Object.assign(document.createElement('div'), { style: `padding:${pad}` });
    wrap.dataset.shot = card.dataset.card;
    card.replaceWith(wrap);
    wrap.append(card);
  }
}

// "Works with your agent": every agent the homepage lists, Papilot Writer
// first and Pi last, as a uniform grid of the homepage's logo chips with
// names beneath, nine to a row (four for phones).
function drawAgentGrid(columns) {
  const items = [...document.querySelectorAll('#agents .agent')].map(item => ({ className: item.className, name: item.textContent.trim() }));
  items.push(...items.splice(items.findIndex(item => item.className === 'agent pi'), 1));
  items.unshift({ className: 'agent writer', name: 'Papilot Writer' });
  const grid = document.createElement('div');
  grid.id = `readme-agent-grid-${columns}`;
  grid.style.cssText = `display:flex;flex-wrap:wrap;justify-content:center;row-gap:22px;width:${columns === 9 ? 848 : 432}px;box-sizing:border-box;margin:48px auto;padding:8px`;
  grid.innerHTML = items.map(({ className, name }) => `<span class="${className}" style="flex:0 0 calc(100% / ${columns});flex-direction:column;gap:9px;font-size:13px;font-weight:500;line-height:1.2;text-align:center;color:var(--text-2)"><i style="width:56px;height:56px;border:0;border-radius:16px;background:light-dark(#fff,#1f2024);box-shadow:0 0 0 1px var(--line),0 1px 2px rgb(15 23 42/.05),0 8px 20px -10px rgb(15 23 42/.22)">${className.includes('writer') ? '<img src="/assets/logo.svg" alt="" style="width:28px;height:28px">' : ''}</i>${name}</span>`).join('');
  document.body.append(grid);
  if (!document.querySelector('#readme-agent-grid-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'readme-agent-grid-style', textContent: '[id^=readme-agent-grid] .agent i{display:grid;place-items:center}[id^=readme-agent-grid] .writer i::before{display:none}[id^=readme-agent-grid] .agent i::before{width:28px;height:28px}' }));
}

// "How it works": the six steps of a task as small drawings in the homepage's
// styles, in two rows of three (or, for phones, a column), on its backdrop.
// A caption's \n is where a Chinese line should break.
const flowCopy = {
  en: {
    steps: [
      ['Open your paper', 'A folder, an Overleaf project or a template. Papilot builds the PDF.'],
      ['Mark the PDF', 'Select a sentence or box a figure, and say what should change.'],
      ['The agent edits a copy', 'Your notes arrive as exact source lines, in the task\'s own Git worktree.'],
      ['See it typeset', 'Papilot compiles the copy and draws each change on the page.'],
      ['You decide', 'Accept or reject each change, or comment for another round.'],
      ['Commit and sync', 'Accepted changes land in your files and Git history, and sync to Overleaf if linked.'],
    ],
    folder: 'typed-lambda-paper', overleaf: 'Overleaf project', template: 'Template',
    sentence: 'The type of <i>λx. e</i> follows from <i>x</i> and <i>e</i>.', note: 'Write it as an inference rule', worktree: 'task worktree',
    old: 'The type of $\\lambda x.\\,e$ follows from $x$ and $e$.', fresh: ['\\inferrule{\\Gamma, x:\\tau_1 \\vdash e:\\tau_2}', '&nbsp;&nbsp;{\\Gamma \\vdash \\lambda x.\\,e : \\tau_1 \\to \\tau_2}'],
    before: 'The type of <i>λx. e</i> follows from <i>x</i> and <i>e</i>.', heading: '3.2 Typing',
    round: 'Another round', commit: 'Write T-Abs as a rule', pushed: 'Pushed', synced: 'Synced',
  },
  'zh-CN': {
    steps: [
      ['打开论文', '文件夹、Overleaf 项目或模板，\nPapilot 编译出 PDF。'],
      ['在 PDF 上标注', '选中一句话或框出一张图，\n写下要怎么改。'],
      ['智能体修改副本', '批注以准确的源码行交给智能体，\n在任务自己的 Git 工作树里修改。'],
      ['看排版效果', 'Papilot 编译副本，\n把每处修改画在页面上。'],
      ['由你决定', '逐条接受或拒绝，\n或写下评论让它再改一轮。'],
      ['提交并同步', '修改写入文件和 Git 历史，\n并同步到已关联的 Overleaf。'],
    ],
    folder: 'typed-lambda-paper', overleaf: 'Overleaf 项目', template: '模板',
    sentence: '<i>λx. e</i> 的类型由 <i>x</i> 和 <i>e</i> 决定。', note: '这里写成推导规则', worktree: '任务工作树',
    old: '$\\lambda x.\\,e$ 的类型由 $x$ 和 $e$ 决定。', fresh: ['\\inferrule{\\Gamma, x:\\tau_1 \\vdash e:\\tau_2}', '&nbsp;&nbsp;{\\Gamma \\vdash \\lambda x.\\,e : \\tau_1 \\to \\tau_2}'],
    before: '<i>λx. e</i> 的类型由 <i>x</i> 和 <i>e</i> 决定。', heading: '3.2 类型',
    round: '再改一轮', commit: 'T-Abs 写成推导规则', pushed: '已推送', synced: '已同步',
  },
};
function drawFlow({ text, compact }) {
  const bar = width => `<i style="display:block;width:${width}%;height:5px;border-radius:3px;background:var(--line)"></i>`;
  const icon = (name, color, size = 15) => `<svg class="ic" style="width:${size}px;height:${size}px;color:${color}"><use href="#i-${name}"/></svg>`;
  const mark = (src, color) => `<i style="flex:none;width:16px;height:16px;background:${color};-webkit-mask:url(${src}) center/contain no-repeat;mask:url(${src}) center/contain no-repeat"></i>`;
  const card = inner => `<div style="position:relative;flex:none;width:240px;height:160px;overflow:hidden;border-radius:14px;background:var(--bg);box-shadow:0 0 0 1px var(--line),var(--float)">${inner}</div>`;
  const code = (number, html, background = 'transparent', sign = '') => `<p style="display:flex;gap:8px;margin:0;padding:0 14px;font:11px/22px var(--mono);color:var(--text);background:${background}"><span style="width:14px;color:var(--text-3)">${number}</span><span style="width:8px;color:var(--text-3)">${sign}</span><span style="flex:1;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(to right,#000 80%,transparent);mask-image:linear-gradient(to right,#000 80%,transparent)">${html}</span></p>`;
  const source = (glyph, label, chosen) => `<p style="display:flex;align-items:center;gap:9px;margin:0;padding:8px 11px;border-radius:9px;font-size:12px;color:var(--text);${chosen ? 'background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent);' : 'box-shadow:inset 0 0 0 1px var(--line);'}">${glyph}<span style="flex:1">${label}</span>${chosen ? icon('check', 'var(--accent)', 14) : ''}</p>`;
  const folder = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:none;color:var(--text-2)"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  const universe = document.querySelector('.topbar .universe-icon').outerHTML.replace('<svg class="universe-icon"', '<svg style="flex:none;width:17px;height:17px"');
  const drawings = [
    card(`<div style="position:absolute;inset:18px 18px auto;display:grid;gap:8px">${source(folder, `<code style="padding:0;background:none;font:11.5px var(--mono)">~/${text.folder}</code>`, true)}${source(mark('/assets/agents/overleaf.svg', '#47a141'), text.overleaf)}${source(universe, text.template)}</div>`),
    card(`<div style="position:absolute;left:24px;right:24px;top:20px;display:grid;gap:8px">${bar(100)}${bar(72)}<p style="position:relative;margin:2px 0;padding:4px 7px 4px 13px;border:1.5px solid var(--accent);border-radius:4px;background:var(--accent-soft);font:13px/1.4 var(--serif);color:var(--text)"><b style="position:absolute;left:-11px;top:50%;display:grid;place-items:center;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:var(--accent);color:#fff;font:600 10px var(--sans)">1</b>${text.sentence}</p>${bar(100)}${bar(58)}</div>
      <div style="position:absolute;right:12px;bottom:12px;padding:6px 10px;border-radius:9px;background:var(--bg);box-shadow:0 0 0 1px var(--line),0 8px 20px -8px rgb(15 23 42/.3);font-size:11.5px;line-height:1.35;color:var(--text)"><span style="font:10px var(--mono);color:var(--text-3)">main.tex:24</span><br>${text.note}</div>`),
    card(`<p style="display:flex;align-items:center;gap:7px;margin:0;padding:14px 14px 10px;font:11px var(--mono);color:var(--text-2)">${icon('branch', 'var(--text-2)', 14)}${text.worktree}<span style="flex:1"></span><span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent-soft)">${icon('spark', 'var(--accent)', 14)}</span></p>
      ${code(23, '\\subsection{Typing}')}${code(24, text.old, 'var(--before)', '−')}${code(24, text.fresh[0], 'var(--after)', '+')}${code(25, text.fresh[1], 'var(--after)', '+')}${code(26, '')}`),
    card(`<div style="position:absolute;left:16px;right:16px;top:14px"><p style="margin:4px 0 10px;font:700 13px var(--serif);color:var(--text)">${text.heading}</p><div style="overflow:hidden;border:1px solid var(--accent);border-radius:6px"><p style="margin:0;padding:7px 9px;border-left:2px solid var(--before-edge);background:var(--before);font:11.5px/1.35 var(--serif);color:var(--text);text-wrap:balance"><del style="background:var(--deleted);text-decoration-color:var(--reject)">${text.before}</del></p><div style="display:grid;place-items:center;padding:10px 9px;border-left:2px solid var(--after-edge);background:var(--after);font:13px var(--serif);color:var(--text)"><span class="rule" style="background:var(--inserted);padding:2px 6px"><span class="rule-premises"><span>Γ, <i>x</i> : <i>τ</i>₁ ⊢ <i>e</i> : <i>τ</i>₂</span></span><span class="rule-name">T-Abs</span><span class="rule-conclusion">Γ ⊢ λ<i>x</i>. <i>e</i> : <i>τ</i>₁ → <i>τ</i>₂</span></span></div></div></div>`),
    card(`<div style="position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:14px"><div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:var(--bg);box-shadow:0 0 0 1px var(--line),0 8px 20px -8px rgb(15 23 42/.3);font-size:12px;color:var(--text-2)">${icon('chevron-left', 'var(--text-3)', 13)}<span>1 / 1</span>${[['check', 'var(--after)', 'var(--accept)'], ['close', 'var(--before)', 'var(--reject)'], ['chat', 'var(--accent-soft)', 'var(--accent)']].map(([name, background, color]) => `<span style="display:grid;place-items:center;width:34px;height:28px;border-radius:999px;background:${background}">${icon(name, color, 15)}</span>`).join('')}${icon('chevron-right', 'var(--text-3)', 13)}</div>
      <p style="display:flex;align-items:center;gap:6px;margin:0;padding:4px 10px;border-radius:999px;background:var(--accent-soft);font-size:11.5px;color:var(--accent)">${icon('refresh', 'var(--accent)', 13)}${text.round}</p></div>`),
    card(`<div style="position:absolute;inset:18px 18px auto;display:grid;gap:10px"><p style="display:flex;align-items:center;gap:8px;margin:0;padding:9px 11px;border-radius:9px;box-shadow:inset 0 0 0 1px var(--line);font-size:12px;color:var(--text)">${icon('check', 'var(--green)', 14)}<span style="flex:1;white-space:nowrap">${text.commit}</span><code style="padding:0;background:none;font:10.5px var(--mono);color:var(--text-3)">3f9c2a1</code></p>
      <p style="display:flex;align-items:center;gap:8px;margin:0;padding:0 4px;font-size:12px;color:var(--text-2)">${icon('branch', 'var(--text-2)', 14)}<code style="padding:0;background:none;font:11px var(--mono)">main</code><span style="flex:1"></span>${icon('push', 'var(--green)', 14)}${text.pushed}</p>
      <p style="display:flex;align-items:center;gap:8px;margin:0;padding:0 4px;font-size:12px;color:var(--text-2)">${mark('/assets/agents/overleaf.svg', '#47a141')}Overleaf<span style="flex:1"></span><i style="width:7px;height:7px;border-radius:50%;background:var(--green)"></i>${text.synced}</p></div>`),
  ];
  const right = '<svg width="30" height="14" viewBox="0 0 30 14" style="flex:none;margin:73px 8px 0;color:var(--text-3)"><path d="M1 7h27m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const down = '<svg width="14" height="26" viewBox="0 0 14 26" style="flex:none;margin:6px 0 6px 72px;color:var(--text-3)"><path d="M7 1v23m-5-5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const step = ([title, caption], index) => `<div data-step="${index}" style="display:flex;${compact ? 'align-items:center;gap:18px' : 'flex-direction:column;width:240px'}"><div style="${compact ? 'zoom:.62' : ''}">${drawings[index]}</div><div style="${compact ? 'flex:1' : ''}"><p style="display:flex;align-items:center;gap:8px;margin:${compact ? '0 0 4px' : '18px 0 5px'};font:400 ${compact ? 17 : 19}px/1.2 var(--serif);color:var(--text)"><b style="display:inline-grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font:600 11px var(--sans)">${index + 1}</b>${title}</p><p style="margin:0;font-size:13px;line-height:1.45;color:var(--text-2);text-wrap:balance">${caption.replace('\n', '<br>')}</p></div></div>`;
  const flow = document.createElement('div');
  flow.id = compact ? 'readme-flow-compact' : 'readme-flow';
  flow.style.cssText = `position:relative;display:flex;flex-direction:column;${compact ? 'width:420px;padding:28px 26px' : 'align-items:center;gap:64px;width:1000px;padding:40px 0 36px'};box-sizing:border-box;margin:140px auto 48px;border-radius:18px;background:var(--backdrop)`;
  const steps = text.steps.map(step);
  flow.innerHTML = compact ? steps.join(down) : [0, 3].map(first => `<div style="display:flex;align-items:flex-start">${steps.slice(first, first + 3).join(right)}</div>`).join('');
  // The drawings use the app windows' palette, which the homepage scopes to them.
  const palette = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).find(rule => rule.selectorText === '.app-window, .phone').style;
  for (const name of palette) if (name.startsWith('--')) flow.style.setProperty(name, palette.getPropertyValue(name));
  document.body.append(flow);
  if (compact) return;
  // From the end of the first row, round its corner and come back to the
  // start of the second, between the rows.
  const box = flow.getBoundingClientRect();
  const at = (index, edge) => { const card = flow.querySelector(`[data-step="${index}"] > div`).getBoundingClientRect(); return { x: card[edge] - box.left, y: card.top - box.top, card }; };
  const third = flow.querySelector('[data-step="2"]').getBoundingClientRect(), fourth = at(3, 'left');
  const x1 = third.right - box.left + 18, y1 = at(2, 'right').y + 80, gap = (third.bottom - box.top + fourth.y) / 2, x2 = fourth.card.left - box.left - 18, y2 = fourth.y + 80, r = 14;
  flow.insertAdjacentHTML('beforeend', `<svg width="${box.width}" height="${box.height}" style="position:absolute;inset:0;pointer-events:none;color:var(--text-3)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M${x1 - 14} ${y1}H${x1 + 22 - r}q${r} 0 ${r} ${r}V${gap - r}q0 ${r} -${r} ${r}H${x2 - 22 + r}q-${r} 0 -${r} ${r}V${y2 - r}q0 ${r} ${r} ${r}H${x2 + 14}"/><path d="M${x2 + 9} ${y2 - 5}l5 5-5 5"/></svg>`);
}

// The systems' marks from the README's icons, and the community cards' icons
// in the accent blue (Discord in its own).
const iconPath = name => fs.readFileSync(path.join(root, `docs/assets/readme-icons/${name}.svg`), 'utf8').match(/ d="([^"]+)"/)[1];
const systemIcons = {
  mac: iconPath('apple'), windows: iconPath('windows'), linux: iconPath('linux'),
  homebrew: iconPath('homebrew'), scoop: iconPath('scoop'), debian: iconPath('debian'),
  ubuntu: iconPath('ubuntu'), archlinux: iconPath('archlinux'), nixos: iconPath('nixos'),
};
const lineIcon = name => fs.readFileSync(path.join(root, `docs/assets/readme-icons/${name}.svg`), 'utf8').replace(/ width="24" height="24"/, ' width="26" height="26"').replaceAll('#3b82f6', 'var(--accent)');
const communityIcons = {
  issue: lineIcon('issue'),
  discussion: lineIcon('discussion'),
  discord: `<svg width="26" height="26" viewBox="0 0 24 24" fill="#5865f2"><path d="${fs.readFileSync(path.join(root, 'site/index.html'), 'utf8').match(/discord-link[\s\S]*?<path d="([^"]+)"/)[1]}"/></svg>`,
  contribute: lineIcon('pull-request'),
};
fs.mkdirSync(path.join(root, 'docs/assets/readme-community'), { recursive: true });

const browser = await chromium.launch();
try {
  for (const locale of ['en', 'zh-CN']) for (const scheme of ['light', 'dark']) {
    const url = `${origin}/${locale === 'en' ? '' : `${locale}/`}`;
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'html,body,main,section{background:transparent!important}.topbar,.scroll-cue{display:none!important}.feature-text,.section-head,.hero-copy>:not(.app-window){visibility:hidden!important}' });
    await page.evaluate(() => document.fonts.ready);
    const art = {
      annotate: [await capture(page, '[data-scene="notes"]')],
      review: [await capture(page, '[data-scene="revise"]')],
      record: [await capture(page, '[data-scene="record"]')],
      phone: [await capture(page, '.hero .app-window')],
    };
    // The two drawings go below the page, alone, so no shadow of the
    // homepage's own sections shows around them.
    await page.evaluate(drawOverleaf, copy[locale]);
    await page.evaluate(drawPicker, pickerCopy[locale]);
    await page.evaluate(drawSystems, { text: systemsCopy[locale], icons: systemIcons, surface: cardSurface });
    await page.evaluate(drawCommunity, { icons: communityIcons, text: communityCopy[locale], surface: cardSurface });
    await page.evaluate(drawAgentGrid, 9);
    await page.evaluate(drawAgentGrid, 4);
    await page.evaluate(drawFlow, { text: flowCopy[locale], compact: false });
    await page.evaluate(drawFlow, { text: flowCopy[locale], compact: true });
    await page.addStyleTag({ content: 'body>:not(#readme-overleaf,#readme-picker,#readme-systems,#readme-community,#readme-flow,#readme-flow-compact,#readme-agent-grid-9,#readme-agent-grid-4,svg){visibility:hidden!important}' });
    await page.evaluate(() => document.fonts.ready);
    art.overleaf = [await capture(page, '#readme-overleaf')];
    // Agent names are the same in every language.
    if (locale === 'en') for (const [columns, suffix] of [[9, ''], [4, '-compact']]) {
      const grid = page.locator(`#readme-agent-grid-${columns}`);
      await grid.scrollIntoViewIfNeeded();
      await page.evaluate(() => Promise.all([...document.querySelectorAll('[id^=readme-agent-grid] img')].map(image => image.decode())));
      await grid.screenshot({ path: path.join(root, 'docs/assets/readme-agents', `grid${suffix}${scheme === 'dark' ? '-dark' : ''}.png`), omitBackground: true, animations: 'disabled' });
    }
    for (const id of ['readme-flow', 'readme-flow-compact']) {
      const flow = page.locator(`#${id}`);
      await flow.scrollIntoViewIfNeeded();
      await flow.screenshot({ path: path.join(output, `${id.replace('readme-', '')}${scheme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.png`), omitBackground: true, animations: 'disabled' });
    }
    art.agents = [await capture(page, '#readme-picker')];
    for (const name of ['mac', 'windows', 'linux', 'terminal', 'pm-bar']) for (const variant of ['', '-compact']) {
      await page.locator(`#readme-systems [data-shot="${name}${variant}"]`).screenshot({ path: path.join(root, 'docs/assets/readme-downloads', `${name}${variant}${scheme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.png`), omitBackground: true, animations: 'disabled' });
    }
    for (const name of Object.keys(communityIcons)) for (const variant of ['', '-compact']) {
      await page.locator(`#readme-community [data-shot="${name}${variant}"]`).screenshot({ path: path.join(root, 'docs/assets/readme-community', `${name}${variant}${scheme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.png`), omitBackground: true, animations: 'disabled' });
    }
    const backdrop = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--backdrop'));
    // The phone layout of the opening window.
    const phone = await browser.newPage({ viewport: { width: 430, height: 1000 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
    await phone.goto(url, { waitUntil: 'networkidle' });
    await phone.addStyleTag({ content: 'html,body,main,section{background:transparent!important}.topbar,.scroll-cue{display:none!important}.hero-copy>:not(.app-window){visibility:hidden!important}' });
    await phone.evaluate(() => document.fonts.ready);
    art.phone.push(await capture(phone, '.hero .app-window'));
    await phone.close();

    // Papilot Universe as it is online, without its header, the gallery
    // starting with a thesis, a journal, a conference, a CV and a poster.
    const universe = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
    await universe.goto('https://papilot.ai/universe/', { waitUntil: 'networkidle' });
    const clip = await universe.evaluate(async ({ locale, picks }) => {
      document.documentElement.dataset.lang = document.documentElement.lang = locale;
      document.querySelector('.topbar').style.display = 'none';
      document.querySelector('.section-head').style.display = 'none';
      const grid = document.querySelector('.grid');
      const cards = [...grid.querySelectorAll('a.card')];
      const title = card => (card.querySelector('.card-title [lang="en"]') || card.querySelector('.card-title')).textContent.trim();
      const chosen = picks.map(name => cards.find(card => title(card) === name));
      if (chosen.includes(undefined)) throw new Error(`Universe no longer lists ${picks[chosen.indexOf(undefined)]}.`);
      grid.prepend(...chosen);
      await Promise.all(chosen.map(card => { const image = card.querySelector('img'); image.loading = 'eager'; return image.decode(); }));
      const top = document.querySelector('.hero h1').getBoundingClientRect().top + scrollY - 28;
      const bottom = chosen[0].querySelector('.sheet').getBoundingClientRect().top + scrollY + 260;
      return { x: 0, y: top, width: innerWidth, height: bottom - top };
    }, { locale, picks: ['Tsinghua University Thesis', 'APS / AIP (REVTeX 4.2)', 'NeurIPS 2026', 'moderncv CV', 'Gemini Poster'] });
    await universe.evaluate(() => document.fonts.ready);
    await universe.waitForTimeout(300);
    const gallery = await universe.screenshot({ clip, fullPage: true, animations: 'disabled' });
    const surface = await universe.evaluate(() => getComputedStyle(document.body).backgroundColor);
    art.universe = [{ src: `data:image/png;base64,${gallery.toString('base64')}`, surface }];
    await universe.close();

    // Each tile is 600 x 400 with rounded corners and its window fitted
    // inside; the phone stands in front of the desktop window. The Universe
    // tile is 1200 x 460, a browser window rising from its lower edge.
    const tile = await browser.newPage({ viewport: { width: 1200, height: 460 }, deviceScaleFactor: 1.5, colorScheme: scheme });
    for (const name of ['annotate', 'review', 'overleaf', 'agents', 'record', 'phone', 'universe']) {
      const images = art[name];
      const width = name === 'universe' ? 1200 : 600;
      const height = name === 'universe' ? 460 : 400;
      const lights = '<span style="display:flex;gap:8px">' + ['#ff5f57', '#febc2e', '#28c840'].map(color => `<i style="width:12px;height:12px;border-radius:50%;background:${color}"></i>`).join('') + '</span>';
      const content = name === 'phone'
        ? `<img src="${images[0].src}" style="position:absolute;left:4px;top:58px;width:430px"><img src="${images[1].src}" style="position:absolute;left:318px;top:22px;width:262px">`
        : name === 'universe'
          ? `<div style="position:absolute;left:80px;right:80px;top:40px;overflow:hidden;border-radius:12px;background:${images[0].surface};box-shadow:0 0 0 1px rgb(127 127 127/.22),0 24px 48px -16px rgb(15 23 42/.28)"><div style="display:flex;align-items:center;height:40px;padding:0 16px">${lights}<span style="margin:0 auto;padding:4px 14px;border-radius:999px;background:rgb(127 127 127/.12);font:12.5px system-ui,sans-serif;color:${scheme === 'dark' ? '#a9aaaf' : '#525252'}">papilot.ai/universe</span><span style="width:52px"></span></div><img src="${images[0].src}" style="display:block;width:100%"></div>`
          : `<img src="${images[0].src}" style="max-width:${width - 24}px;max-height:${height - 16}px">`;
      await tile.setViewportSize({ width, height });
      await tile.setContent(`<!doctype html><body style="margin:0"><div id="tile" style="position:relative;display:grid;place-items:center;width:${width}px;height:${height}px;overflow:hidden;border-radius:18px;background:${backdrop}">${content}</div></body>`);
      await tile.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
      const file = `why-${name}${scheme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.png`;
      await tile.locator('#tile').screenshot({ path: path.join(output, file), omitBackground: true });
      console.log(file);
    }
    await tile.close();
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
