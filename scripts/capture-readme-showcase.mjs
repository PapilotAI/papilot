// README illustrations and the social preview card, captured from the
// homepage's own windows (Node 22):
//
//   node --import tsx scripts/capture-readme-review.mjs   (the real review screenshot)
//   npm run site && node scripts/capture-readme-showcase.mjs
//
// The homepage draws Papilot in HTML and CSS (site/index.html), so the README
// reuses those drawings instead of keeping a second copy: hero*.png is the
// opening window and paradigm*.png the three cards of "Why", whose Papilot
// card shows the real review from scripts/capture-readme-review.mjs. Each is
// captured at 2x with a transparent surround, in light and dark, at desktop
// and phone width (the phone layout draws the phone app), in English and
// Simplified Chinese. Without motion every window shows where its demo ends.
// Other README languages use the English images; renderReadme picks a
// `.<locale>` file when one exists. docs/assets/social-preview.png, the link
// card for GitHub and the site, puts the opening window beside the headline.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from './playwright.mjs';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, '_site');
const output = path.join(root, 'docs/assets/readme-showcase');
if (!fs.existsSync(path.join(site, 'index.html'))) throw new Error('Run npm run site first.');
fs.mkdirSync(output, { recursive: true });

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

// The floating windows keep room for their shadow; the cards need none.
const shots = [
  { name: 'hero', selector: '.hero .app-window', pad: 36 },
  { name: 'paradigm', selector: '#why .eras', pad: 2 },
];
const layouts = [
  { suffix: '', width: 1200 },
  { suffix: '-compact', width: 430 },
];
const browser = await chromium.launch();
try {
  for (const locale of ['en', 'zh-CN']) for (const scheme of ['light', 'dark']) for (const layout of layouts) {
    const page = await browser.newPage({ viewport: { width: layout.width, height: 1000 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(`${origin}/${locale === 'en' ? '' : `${locale}/`}`, { waitUntil: 'networkidle' });
    // Under reduced motion the site greys out the two older ways at once; the
    // README keeps their red marks, the "don't" beside Papilot's "do".
    await page.addStyleTag({ content: 'html,body,main,section{background:transparent!important}.topbar,.scroll-cue{display:none!important}.era.old{--old:0!important}'
      // Text beside a window would show in its shadow margin on a phone.
      + '.hero-copy>:not(.app-window),.feature-text,.section-head{visibility:hidden!important}' });
    // Papilot's card in "Why" shows the real review instead of the homepage's
    // abstract drawing: the review pane of scripts/capture-readme-review.mjs.
    const raw = path.join(root, 'test-results/readme-review', `review-app${scheme === 'dark' ? '-dark' : ''}-raw${locale === 'en' ? '' : `.${locale}`}.png`);
    if (!fs.existsSync(raw)) throw new Error('Run node --import tsx scripts/capture-readme-review.mjs first.');
    await page.evaluate(src => {
      // The screenshot is the desktop app, whose window controls share its
      // toolbar row, so the drawn title bar goes and the controls are drawn
      // on the screenshot where the app leaves room for them.
      document.querySelector('.era.ours .mini-bar').remove();
      const body = document.querySelector('.era.ours .mini-body');
      body.style.display = 'block';
      body.innerHTML = `<div style="position:relative;width:1280px;transform-origin:0 0;transform:scale(${body.clientWidth / 890})"><img src="${src}" alt="" style="display:block;width:1280px;max-width:none"><span class="lights" style="position:absolute;left:18px;top:16px;gap:8px"><i style="width:12px;height:12px"></i><i style="width:12px;height:12px"></i><i style="width:12px;height:12px"></i></span></div>`;
      return body.querySelector('img').decode();
    }, `data:image/png;base64,${fs.readFileSync(raw).toString('base64')}`);
    await page.evaluate(() => document.fonts.ready);
    for (const shot of shots) {
      const element = page.locator(shot.selector);
      await element.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const box = await element.boundingBox();
      const scroll = await page.evaluate(() => window.scrollY);
      const clip = { x: Math.max(0, box.x - shot.pad), y: box.y + scroll - shot.pad, width: box.width + shot.pad * 2, height: box.height + shot.pad * 2 };
      const file = `${shot.name}${layout.suffix}${scheme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.png`;
      await page.screenshot({ path: path.join(output, file), clip, fullPage: true, omitBackground: true, animations: 'disabled' });
      console.log(file);
    }
    await page.close();
  }
  // The link card for GitHub and the site (og:image, 2560 x 1280): the
  // homepage's headline and install command on the left, its window running
  // off the right edge.
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: `
    body>*:not(.social){display:none!important}
    .social{position:fixed;inset:0;overflow:hidden;background:var(--backdrop)}
    .social-copy{position:absolute;left:72px;top:0;bottom:0;width:600px;display:flex;flex-direction:column;justify-content:center}
    .social .brand{display:flex;align-items:center;gap:12px;margin-bottom:34px;font:400 40px/1 var(--serif);color:var(--text)}
    .social .brand img{width:42px;height:42px}
    .social h1{font-size:58px;line-height:1.1;text-align:left}
    .social .install{align-self:flex-start;height:54px;margin-top:36px;padding:0 24px}
    .social .install code{font-size:19px}
    .social .install .copy{display:none}
    .social .app-window{position:absolute;left:700px;top:112px;width:940px;margin:0}
    .social .demo-box,.social .demo-note,.social .app-cursor{display:none}` });
  await page.evaluate(() => {
    const hero = document.querySelector('.hero-copy');
    const card = Object.assign(document.createElement('div'), { className: 'social hero' });
    const copy = Object.assign(document.createElement('div'), { className: 'social-copy' });
    copy.append(document.querySelector('.topbar .brand').cloneNode(true), ...['h1', '.install'].map(selector => hero.querySelector(selector).cloneNode(true)));
    card.append(copy, hero.querySelector('.app-window').cloneNode(true));
    document.body.append(card);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'docs/assets/social-preview.png'), animations: 'disabled' });
  console.log('social-preview.png');
  await page.close();
} finally {
  await browser.close();
  server.close();
}
