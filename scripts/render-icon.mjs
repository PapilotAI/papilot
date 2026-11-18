// Render the editable SVGs and package the legacy macOS icon, the web favicon
// and the home-screen icon. Requires macOS, Google Chrome, and the Playwright
// dependency installed by setup:review.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../engine/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'desktop/assets');
const iconset = path.join(directory, 'icon.iconset');
const read = name => fs.readFile(path.join(directory, name), 'utf8');
const source = await read('icon.svg');
// Five stripes run together at 16 and 32 px; those sizes use the three-stripe cut.
const small = await read('icon-small.svg');
const dark = await read('icon-dark.svg');
const layers = await Promise.all(['background.svg', 'foreground.svg'].map(name => read(`icon-composer/${name}`)));
await fs.mkdir(iconset, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:transparent"></body></html>');
  // Draws each SVG in turn over the whole canvas, or only the 100..924 tile
  // when crop is set, and returns the PNG.
  const render = async (sources, size, crop = false) => Buffer.from(await page.evaluate(async ({ sources, size, crop }) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    for (const source of sources) {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(source)}`;
      await img.decode();
      if (crop) context.drawImage(img, 100, 100, 824, 824, 0, 0, size, size);
      else context.drawImage(img, 0, 0, size, size);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, { sources, size, crop }), 'base64');
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    const png = await render([size <= 32 ? small : source], size);
    if (size === 1024) await fs.writeFile(path.join(directory, 'icon.png'), png);
    if ([16, 32, 128, 256, 512].includes(size)) {
      await fs.writeFile(path.join(iconset, `icon_${size}x${size}.png`), png);
    }
    if ([32, 64, 256, 512, 1024].includes(size)) {
      await fs.writeFile(path.join(iconset, `icon_${size / 2}x${size / 2}@2x.png`), png);
    }
  }
  // Browser tabs show the favicon at 16 to 32 px: the three-stripe tile, edge to
  // edge. iOS rounds the opaque home-screen icon itself.
  await fs.writeFile(path.join(root, 'public/favicon.png'), await render([small], 64, true));
  await fs.writeFile(path.join(root, 'public/apple-touch-icon.png'), await render(layers, 180));
  const url = png => `data:image/png;base64,${png.toString('base64')}`;
  const icons = { light: url(await fs.readFile(path.join(directory, 'icon.png'))), dark: url(await render([dark], 1024)) };
  const smallIcon = url(await render([small], 64));
  await page.setViewportSize({ width: 1200, height: 720 });
  const samples = theme => [128, 64, 32, 16].map(size => `<figure><img src="${size <= 32 && theme === 'light' ? smallIcon : icons[theme]}" width="${size}" height="${size}"><figcaption>${size} px</figcaption></figure>`).join('');
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;grid-template-columns:1fr 1fr}
    section{height:720px;padding:40px 48px;background:#edf1f6;color:#253b51}section.dark{background:#17222f;color:#dce7f3}
    header{display:flex;align-items:baseline;justify-content:space-between}h1{font-size:24px;font-weight:600;margin:0;letter-spacing:-.6px}
    header span{font-size:12px;letter-spacing:2px;opacity:.55}.hero{display:block;width:384px;height:384px;margin:18px auto 4px}
    .sizes{height:170px;display:flex;align-items:center;justify-content:space-between;gap:12px}figure{margin:0;text-align:center;min-width:48px}
    figure img{display:block;margin:auto}figcaption{font-size:11px;opacity:.55;margin-top:12px}
  </style></head><body>${['light','dark'].map(theme => `<section class="${theme}"><header><h1>Papilot</h1><span>macOS · ${theme.toUpperCase()}</span></header><img class="hero" src="${icons[theme]}"><div class="sizes">${samples(theme)}</div></section>`).join('')}</body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: path.join(directory, 'icon-preview.png') });
} finally {
  await browser.close();
}
execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(directory, 'icon.icns'), iconset]);
console.log('Rendered desktop/assets/icon.png, icon.iconset, public/favicon.png and public/apple-touch-icon.png; packaged icon.icns.');
