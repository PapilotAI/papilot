// Builds the GitHub Pages site into _site: the page in site/, the README's logo
// and screenshots, and the workspace's fonts. It then checks that every file the
// page and its stylesheet point to was built.
//
// The page plays the demo GIF as an MP4 with a poster frame, a fraction of the
// GIF's size. FFmpeg makes them and they are committed in site/assets, so the
// Pages workflow needs nothing but Node; --video (`npm run site:video`) remakes
// them. The page has its own title and install command, so the video leaves out
// the GIF's opening and closing title cards; move these times if the GIF changes.
// The video's comment tag records the GIF's hash and the times, and the build
// stops when either has changed since the video was made.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
// The build empties this folder first, so it takes no folder argument that
// could name the source or the repository by mistake.
const out = path.join(root, '_site');
const site = 'https://papilot.ai/';
const copy = (from, names, to = '') => {
  fs.mkdirSync(path.join(out, to), { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(root, from, name), path.join(out, to, name));
};

const gif = path.join(root, 'docs/assets/demo.gif');
const video = path.join(root, 'site/assets/demo.mp4'), poster = path.join(root, 'site/assets/demo-poster.jpg');
const [start, end] = ['3.0', '31.2'];
const stamp = `papilot-demo ${createHash('sha256').update(fs.readFileSync(gif)).digest('hex')} ${start}-${end}`;

if (args.includes('--video')) {
  const ffmpeg = (...ffmpegArgs) => {
    const result = spawnSync('ffmpeg', ['-hide_banner', ...ffmpegArgs], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') throw new Error('Making the demo video needs FFmpeg: install ffmpeg and run this again.');
    if (result.error) throw result.error;
    return result;
  };
  const [, h, m, s] = ffmpeg('-i', gif).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? [];
  if (h === undefined) throw new Error('FFmpeg could not read the length of docs/assets/demo.gif.');
  const length = h * 3600 + m * 60 + Number(s);
  if (Number(end) > length) throw new Error(`docs/assets/demo.gif is ${length}s long, so the video cannot end at ${end}s: move the times in scripts/build-site.mjs.`);
  const encode = (...encodeArgs) => {
    const result = ffmpeg('-v', 'error', '-y', '-ss', start, '-to', end, '-i', gif, ...encodeArgs);
    if (result.status !== 0) throw new Error(`FFmpeg failed:\n${result.stderr}`);
  };
  fs.mkdirSync(path.dirname(video), { recursive: true });
  encode('-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata', `comment=${stamp}`, video);
  encode('-frames:v', '1', '-q:v', '2', poster);
  console.log(`Made site/assets/demo.mp4 from ${start}s to ${end}s of the ${length}s GIF: check that it starts and ends past the title cards.`);
}
if (!fs.existsSync(video) || !fs.readFileSync(video).includes(stamp)) {
  throw new Error('docs/assets/demo.gif or the video times have changed since site/assets/demo.mp4 was made: run `npm run site:video`, check the video, and commit site/assets.');
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
copy('public', ['favicon.png', 'apple-touch-icon.png']);
copy('docs/assets', ['logo.svg', 'social-preview.png', 'feature-note.png', 'feature-review.png', 'feature-contents.png', 'feature-git.png'], 'assets');
copy('src/web/fonts', fs.readdirSync(path.join(root, 'src/web/fonts')).filter(name => /\.(otf|txt)$/.test(name)), 'fonts');

const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
const refs = [
  ...[...html.matchAll(/\s(?:src|href|poster|data-zh-href)="([^"]*)"/g)].map(match => match[1]),
  ...[...html.matchAll(/\scontent="([^"]*)"/g)].map(match => match[1]).filter(value => value.startsWith(site)),
  ...[...css.matchAll(/url\("?([^")]*)"?\)/g)].map(match => match[1]),
];
const missing = refs
  .map(ref => (ref.startsWith(site) ? ref.slice(site.length) : ref).replace(/[?#].*/, ''))
  .filter(ref => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref))
  .map(ref => ref === '' || ref.endsWith('/') ? ref + 'index.html' : ref)
  .filter(ref => !fs.existsSync(path.join(out, ref)));
if (missing.length) throw new Error(`The page points to files the build does not have: ${[...new Set(missing)].join(', ')}`);
console.log(`Site built in ${path.relative(process.cwd(), out) || '.'}`);
