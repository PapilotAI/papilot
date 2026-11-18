// Regression check for https://github.com/PapilotAI/papilot/issues/171.
// Run with Node >= 22.22: node --import tsx scripts/check-miktex-synctex.mjs
// Add --native on Windows with MiKTeX to test its untouched compiler output.
// Requires pdflatex. Keeps the compiled PDFs and round.json for inspection.
// The default mode changes Input records and process.platform for synchronous
// lookups. --native uses actual MiKTeX output without either modification.
// Both modes use the actual WASM parser, locator and round renderer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { unitsOf } from '../engine/src/core/changes.ts';
import { SynctexIndex } from '../engine/src/render/synctex.ts';
import { Build } from '../engine/src/render/locate.ts';
import { renderRound } from '../engine/src/render/round.ts';

const host = process.platform;
const native = process.argv.includes('--native');
const compiler = execFileSync('pdflatex', ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
if (native) {
  assert.equal(host, 'win32', '--native requires a real Windows process');
  assert.match(compiler, /MiKTeX/, '--native requires MiKTeX pdflatex on PATH');
}
fs.mkdirSync('test-results', { recursive: true });
const out = fs.mkdtempSync(path.resolve('test-results/issue-171-'));
const main = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
The original method is reliable and produces useful results.

This unchanged paragraph should also have source locations.
\input{section}
\end{document}
`;
const section = String.raw`\section{Results}
The original experiment confirms the proposed method.
`;
const before = { 'main.tex': main, 'section.tex': section };
const after = {
  'main.tex': main.replace('original method', 'improved method'),
  'section.tex': section.replace('original experiment', 'repeated experiment'),
};
const files = Object.keys(before);
const blobs = (sources) => Object.fromEntries(files.map(file => [file, Buffer.from(sources[file])]));
const units = unitsOf(files, blobs(before), blobs(after), () => false);
assert.equal(units.length, 2);

function compile(name, sources) {
  const root = path.join(out, name);
  fs.mkdirSync(root);
  for (const [file, text] of Object.entries(sources)) fs.writeFileSync(path.join(root, file), text);
  const log = execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-synctex=1', path.join(root, 'main.tex')], { cwd: root, encoding: 'utf8', timeout: 180000 });
  fs.writeFileSync(path.join(root, 'compile.stdout'), log);
  const pdf = path.join(root, 'main.pdf'), sync = pdf.replace(/\.pdf$/, '.synctex.gz');
  const raw = fs.readFileSync(sync), original = gunzipSync(raw).toString('utf8');
  // Resolve relative Input names so only the separator differs in each case.
  const canonical = original.replace(/^(Input:\d+:)([^\r\n]*)/gm,
    (_, head, input) => head + path.resolve(root, input).split(path.sep).join('/'));
  fs.writeFileSync(path.join(root, 'original.synctex.gz'), raw);
  return { info: { key: name, tree: name, targets: ['full'], root, cwd: root, pdf, seconds: 0, warnings: [] }, sync, canonical, original, raw };
}

const old = compile('before', before), next = compile('after', after);
const builds = [old, next];
const inputs = (text, convert) => text.replace(/^(Input:\d+:)([^\r\n]*)/gm, (_, head, input) => head + convert(input));
function asWindows(run) {
  if (native) return run();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  try { return run(); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
}

// Use real drive-letter paths here, independently of the host filesystem.
// No source file access is needed for a direct parser query.
const parser = [];
const query = 'E:/paper with spaces/论文/main.tex';
const sample = inputs(old.canonical, input => input === path.join(old.info.root, 'main.tex').split(path.sep).join('/') ? query : input);
const parserDir = path.join(out, 'parser');
fs.mkdirSync(parserDir);
const parserPdf = path.join(parserDir, 'main.pdf');
for (const compressed of native ? [] : [true, false]) {
  const sync = parserPdf.replace(/\.pdf$/, compressed ? '.synctex.gz' : '.synctex');
  for (const backslashes of [false, true]) {
    const text = inputs(sample, input => backslashes ? input.replaceAll('/', '\\') : input);
    fs.writeFileSync(sync, compressed ? gzipSync(text) : text);
    const counts = asWindows(() => {
      const index = new SynctexIndex(parserPdf);
      try {
        return {
          forwardQuery: index.view(query, 4).length,
          backwardQuery: index.view(query.replaceAll('/', '\\'), 4).length,
        };
      } finally { index.close(); }
    });
    parser.push({ compressed, inputSeparators: backslashes ? 'backslash' : 'slash', ...counts });
    assert.ok(counts.forwardQuery > 0 && counts.backwardQuery === counts.forwardQuery);
  }
  fs.unlinkSync(sync);
}

// Keep native source paths for filesystem reads. Both the Windows load/query
// branches still run, and the only difference between rounds is Input slashes.
const rounds = [];
for (const format of native ? ['native-miktex', 'normalized-control'] : ['slash-control', 'miktex-backslash', 'normalized-control']) {
  const dir = path.join(out, format);
  fs.mkdirSync(dir);
  for (const [i, build] of builds.entries()) {
    const miktex = native ? build.original : inputs(build.canonical, input => input.replaceAll('/', '\\'));
    const text = format === 'slash-control' ? build.canonical
      : format === 'miktex-backslash' ? miktex
      : inputs(miktex, input => input.replaceAll('\\', '/'));
    fs.writeFileSync(build.sync, format === 'native-miktex' ? build.raw : gzipSync(text));
    fs.copyFileSync(build.sync, path.join(dir, `${i ? 'after' : 'before'}.synctex.gz`));
  }
  const result = asWindows(() => {
    const boxes = builds.map(build => {
      const loaded = new Build(build.info, 'main.tex', '');
      try {
        return {
          main: loaded.locator.boxes('main.tex', 4, 4).length,
          unchanged: loaded.locator.boxes('main.tex', 6, 6).length,
          input: loaded.locator.boxes('section.tex', 2, 2).length,
        };
      } finally { loaded.close(); }
    });
    const round = renderRound({ main: 'main.tex', source_dir: '', figures: [], old: old.info, new: next.info, units, indirect: false }, dir);
    assert.ok(round);
    for (const [i, build] of builds.entries())
      assert.deepEqual(fs.readFileSync(build.sync), fs.readFileSync(path.join(dir, `${i ? 'after' : 'before'}.synctex.gz`)), 'rendering must not rewrite compiler files');
    return { format, boxes, units: round.units, sections: round.sections.length, loose: round.loose.length };
  });
  rounds.push(result);
  for (const boxes of result.boxes) assert.ok(Object.values(boxes).every(count => count > 0));
  for (const unit of Object.values(result.units)) {
    assert.equal(unit.visual, 'text');
    assert.deepEqual(unit.pages, ['1']);
  }
  assert.equal(result.loose, 0);
}
for (const round of rounds.slice(1)) {
  assert.deepEqual(rounds[0].boxes, round.boxes);
  assert.deepEqual(rounds[0].units, round.units);
}
assert.equal(process.platform, host);
const report = { issue: 171, host, machine: os.hostname(), osRelease: os.release(), node: process.version, native, simulatedPlatform: native ? undefined : 'win32', compiler, originalInputs: builds.map(build => build.original.split(/\r?\n/).filter(line => line.startsWith('Input:'))), parser, rounds, artifacts: out };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
