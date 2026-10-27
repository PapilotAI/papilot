// Builds the GitHub Pages site into _site (or the folder given): the page in
// site/, the README's logo and screenshots, the workspace's fonts, and the demo
// GIF re-encoded as an MP4 with a poster frame, a fraction of the GIF's size.
// The page has its own title and install command, so the video leaves out the
// GIF's opening and closing title cards; move these times if the GIF changes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.argv[2] ?? path.join(root, '_site'));
const copy = (from, names, to = '') => {
  fs.mkdirSync(path.join(out, to), { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(root, from, name), path.join(out, to, name));
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
copy('public', ['favicon.png', 'apple-touch-icon.png']);
copy('docs/assets', ['logo.svg', 'feature-note.png', 'feature-review.png', 'feature-contents.png', 'feature-git.png'], 'assets');
copy('src/web/fonts', fs.readdirSync(path.join(root, 'src/web/fonts')).filter(name => /\.(otf|txt)$/.test(name)), 'fonts');

const gif = path.join(root, 'docs/assets/demo.gif');
const [start, end] = ['2.4', '23.7'];
const ffmpeg = (...args) => {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', start, '-to', end, '-i', gif, ...args], { stdio: 'inherit' });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('The site needs FFmpeg to turn the demo GIF into a video: install ffmpeg and run this again.');
    throw error;
  }
};
ffmpeg('-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'assets/demo.mp4'));
ffmpeg('-frames:v', '1', '-q:v', '2', path.join(out, 'assets/demo-poster.jpg'));
console.log(`Site built in ${path.relative(process.cwd(), out) || '.'}`);
