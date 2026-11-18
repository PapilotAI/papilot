import fs from 'node:fs';
import path from 'node:path';
import { diffArrays } from 'diff';
import { blankComments, contentsEntry, onlyInput } from './plain-text.ts';

// What a build of the paper says about its structure. Every build Papilot
// runs records how TeX read the paper (engine/src/core/build.ts writes the
// trace, <job>.papilot): the files TeX entered and left, and the file and
// line of each contents entry, label, the title and the abstract. The .aux
// adds what TeX numbered: each heading's page, each label's number and page.
// So the outline is the one in the PDF, with nothing a comment, \iffalse or
// a draft switch left out, and no guessing about macros or \input.
//
// The build compiled a snapshot of the sources. Files edited since then keep
// the build's structure, with its line numbers carried over to the current
// text line by line; what an edit added only shows after the next build.

/** A build of the paper: its PDF and the snapshot of the source folder it compiled. */
export interface CompiledPaper { pdf: string; root: string; sourceDir: string; builtAt?: number; pages?: number }

export interface Place { file: string; line: number }
export interface TracedHeading extends Place { kind: string; level: number; number: string; title: string; page?: string; anchor?: string; labels: string[]; ranges: Record<string, [number, number][]>; changed?: boolean }
export interface TracedLabel extends Place { name: string; number?: string; page?: string; kind?: string; caption?: string }
export interface Traced {
  /** Paths are worktree-relative. */
  main: string | null;
  documentClass?: string;
  title?: Place & { source: string };
  abstract?: { file: string; start: number; end: number };
  headings: TracedHeading[];
  labels: TracedLabel[];
  /** Files of the paper TeX read, in the order it first read them. */
  inputs: string[];
  bibs: string[];
  citations: Set<string>;
  undefinedRefs: string[];
  undefinedCites: string[];
  /** Files edited since the build, and those it read that are gone. */
  changed: string[];
  missing: string[];
}

export const LEVELS: Record<string, number> = { part: -1, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };

/** A TeX group's text from an opening brace, and where it ends. */
function group(text: string, open: number): [string, number] | null {
  if (text[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [text.slice(open + 1, i), i + 1];
  }
  return null;
}
/** The arguments of each \name{..}{..} in a .aux file. */
function commands(aux: string, name: string, count: number) {
  const found: string[][] = [];
  for (let at = aux.indexOf('\\' + name); at >= 0; at = aux.indexOf('\\' + name, at + 1)) {
    let next = at + name.length + 1;
    const args: string[] = [];
    for (let i = 0; i < count; i++) {
      while (aux[next] === ' ') next++;
      const arg = group(aux, next);
      if (!arg) break;
      args.push(arg[0]); next = arg[1];
    }
    if (args.length === count) found.push(args);
  }
  return found;
}
/** Each group of a value written as {a}{b}{c}. */
function fields(value: string) {
  const out: string[] = [];
  for (let at = 0; at < value.length;) {
    while (value[at] === ' ') at++;
    const arg = group(value, at);
    if (!arg) break;
    out.push(arg[0]); at = arg[1];
  }
  return out;
}
/** Contents text as TeX expanded it, read as plain text. */
export const contentsText = (text: string) => contentsEntry(text).title;

/** Reads a build's trace and auxiliary files, by worktree-relative path. Null without a trace. */
/** Pass null to retain the compiled snapshot's coordinates, for PDF marks. */
export function readTrace(build: CompiledPaper, worktree: string | null): Traced | null {
  const out = path.dirname(build.pdf), job = path.basename(build.pdf, '.pdf'), cwd = path.dirname(out);
  let trace: string;
  try { trace = fs.readFileSync(path.join(out, job + '.papilot'), 'latin1'); } catch { return null; }
  // TeX writes bytes; names and titles are UTF-8.
  trace = Buffer.from(trace, 'latin1').toString('utf8');
  const inside = (file: string) => { const rel = path.relative(build.root, file); return !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null; };
  // A file TeX read, as a path in the snapshot and in the worktree, if it is the paper's.
  const files = new Map<string, { snapshot: string; rel: string } | null>();
  const resolve = (dir: string, name: string) => {
    const key = dir + '|' + name;
    if (!files.has(key)) {
      const snapshot = path.resolve(cwd, dir, name), rel = fs.existsSync(snapshot) ? inside(snapshot) : null;
      files.set(key, rel == null ? null : { snapshot, rel: path.posix.join(build.sourceDir || '', rel) });
    }
    return files.get(key)!;
  };
  const traced: Traced = { main: null, headings: [], labels: [], inputs: [], bibs: [], citations: new Set(), undefinedRefs: [], undefinedCites: [], changed: [], missing: [] };
  // Lines and line maps of each file: the build's copy and the current one.
  const lengths = new Map<string, number>(), texts = new Map<string, string[]>(), maps = new Map<string, ReturnType<typeof lineMap>>();
  const snapshotLines = (file: { snapshot: string; rel: string }) => {
    if (!lengths.has(file.rel)) {
      const before = fs.readFileSync(file.snapshot, 'utf8');
      texts.set(file.rel, blankComments(before).split('\n'));
      lengths.set(file.rel, texts.get(file.rel)!.length);
      let now: string | null = before;
      if (worktree !== null) try { now = fs.readFileSync(path.join(worktree, file.rel), 'utf8'); } catch { now = null; traced.missing.push(file.rel); }
      if (now != null && now !== before) { traced.changed.push(file.rel); maps.set(file.rel, lineMap(before.split('\n'), now.split('\n'))); }
    }
    return lengths.get(file.rel)!;
  };

  // Reading order: where TeX was in which file, as pieces of files.
  type Piece = { file: string; from: number; to: number };
  const pieces: Piece[] = [], stack: { file: { snapshot: string; rel: string } | null; line: number }[] = [];
  let current: { file: { snapshot: string; rel: string } | null; line: number } = { file: null, line: 1 };
  const advance = (file: { snapshot: string; rel: string } | null, line: number) => {
    if (current.file && file?.rel === current.file.rel && line >= current.line) pieces.push({ file: current.file.rel, from: current.line, to: line });
    current = { file, line };
  };
  const marks: { kind: 'heading' | 'end'; at: number; heading?: TracedHeading; place?: Place }[] = [];
  const tocEvents: TracedHeading[] = [], floatEvents: TracedLabel[] = [];
  for (const raw of trace.split('\n')) {
    const parts = raw.replace(/\r$/, '').split('|'), type = parts[0];
    if (type === 'TT' && traced.title) { traced.title.source = parts.slice(1).join('|'); continue; }
    if (type === 'C') { traced.documentClass = parts[1]?.replace(/\.cls$/, ''); continue; }
    if (!['F', 'X', 'H', 'L', 'T', 'A', 'a', 'E'].includes(type)) continue;
    const line = Number(parts[1]) || 1, file = resolve(parts[2] || '', parts[3] || '');
    if (type === 'F') {
      // TeX enters a file from the line of its \input.
      advance(current.file, line);
      stack.push({ file: current.file, line });
      if (file) { snapshotLines(file); if (!traced.inputs.includes(file.rel)) traced.inputs.push(file.rel); traced.main ??= file.rel; }
      current = { file, line: 1 };
      continue;
    }
    if (type === 'X') {
      if (current.file) pieces.push({ file: current.file.rel, from: current.line, to: snapshotLines(current.file) });
      const parent = stack.pop();
      current = parent ? { file: parent.file, line: parent.line } : { file: null, line: 1 };
      continue;
    }
    if (!file) continue;
    advance(file, line);
    const at = { file: file.rel, line };
    if (type === 'H') {
      const [list, kind] = [parts[4], parts[5]], text = parts.slice(6).join('|');
      const { number, title } = contentsEntry(text);
      if (list === 'toc' && kind in LEVELS) {
        const heading: TracedHeading = { ...at, kind, level: LEVELS[kind], number, title, labels: [], ranges: {} };
        traced.headings.push(heading); tocEvents.push(heading);
        marks.push({ kind: 'heading', at: pieces.length, heading });
      } else if (list === 'lof' || list === 'lot') floatEvents.push({ ...at, name: '', number, kind: list === 'lof' ? 'figure' : 'table', caption: title });
    } else if (type === 'L') {
      const name = parts.slice(4).join('|');
      if (!name.startsWith('sub@')) traced.labels.push({ ...at, name });
    } else if (type === 'T') traced.title = { ...at, source: '' };
    // A paper with more than one abstract (one per language) is described by the first.
    else if (type === 'A') traced.abstract ??= { file: file.rel, start: line + 1, end: 0 };
    else if (type === 'a' && traced.abstract?.file === file.rel && !traced.abstract.end) traced.abstract.end = Math.max(traced.abstract.start, line - 1);
    else if (type === 'E') marks.push({ kind: 'end', at: pieces.length, place: at });
  }
  if (!marks.some(mark => mark.kind === 'end')) marks.push({ kind: 'end', at: pieces.length });
  // A build that stopped inside the abstract never closed it.
  if (traced.abstract && !traced.abstract.end) traced.abstract.end = traced.abstract.start;

  // Lines between parts hold no text of their own: blank lines, comments
  // and the \input lines that lead into the next file.
  const empty = (file: string, line: number) => { const text = (texts.get(file)?.[line - 1] ?? '').trim(); return !text || onlyInput(text); };
  const trim = (ranges: Record<string, [number, number][]>, heading: TracedHeading) => {
    const kept: Record<string, [number, number][]> = {};
    for (const [file, list] of Object.entries(ranges)) for (let [a, b] of list) {
      const own = file === heading.file && a <= heading.line && heading.line <= b;
      while (a <= b && empty(file, a) && !(own && a === heading.line)) a++;
      while (b >= a && empty(file, b) && !(own && b === heading.line)) b--;
      if (a <= b) (kept[file] ??= []).push([a, b]);
    }
    return kept;
  };
  // A part spans from its heading to the next heading at its level or above.
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.kind !== 'heading') continue;
    const next = marks.slice(i + 1).find(other => other.kind === 'end' || other.heading!.level <= mark.heading!.level)!;
    const ranges: Record<string, [number, number][]> = {};
    const add = (file: string, from: number, to: number) => {
      const list = (ranges[file] ??= []), last = list[list.length - 1];
      if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
      else list.push([from, to]);
    };
    add(mark.heading!.file, mark.heading!.line, mark.heading!.line);
    for (const piece of pieces.slice(mark.at, next.at)) add(piece.file, piece.from, piece.to);
    // The next part starts on its own heading line; the last ends before \end{document}.
    const stop = next.heading ?? next.place, list = stop && ranges[stop.file], own = list?.at(-1);
    if (stop && list && own && own[1] >= stop.line) {
      if (own[0] >= stop.line && !(stop.file === mark.heading!.file && own[0] <= mark.heading!.line)) list.pop(); else own[1] = Math.max(own[0], stop.line - 1);
      if (!list.length) delete ranges[stop.file];
    }
    mark.heading!.ranges = trim(ranges, mark.heading!);
  }

  // Numbers and pages, from the .aux files (an \include has its own).
  const auxText: string[] = [];
  const readAux = (file: string, depth = 0) => {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    auxText.push(text);
    if (depth < 4) for (const [child] of commands(text, '@input', 1)) readAux(path.join(out, child), depth + 1);
  };
  readAux(path.join(out, job + '.aux'));
  const aux = auxText.join('\n');
  const toc = commands(aux, '@writefile', 2).filter(([list]) => list === 'toc').map(([, entry]) => fields(entry.slice(entry.indexOf('{'))))
    .filter(entry => entry[0] in LEVELS);
  // The trace and the .aux list the contents in the same order.
  if (toc.length === tocEvents.length) tocEvents.forEach((heading, i) => { heading.page = toc[i][2]; heading.anchor = toc[i][3] || undefined; });
  const numbers = new Map<string, string[]>(), kinds = new Map<string, string>();
  for (const [name, value] of commands(aux, 'newlabel', 2)) {
    if (name.endsWith('@cref')) { const kind = fields(value)[0] || ''; kinds.set(name.slice(0, -5), kind.startsWith('[') ? kind.slice(1, kind.indexOf(']')) : ''); }
    else numbers.set(name, fields(value));
  }
  for (const label of traced.labels) {
    const value = numbers.get(label.name);
    if (!value) continue;
    label.number = contentsText(value[0] || ''); label.page = value[1];
    const anchor = value[3] || '';
    label.kind = kinds.get(label.name) || anchor.split('.')[0] || undefined;
    if (value[2] && ['figure', 'table', 'algorithm', 'listing', 'lstlisting'].some(kind => label.kind?.startsWith(kind))) label.caption = contentsText(value[2]);
    // A label set right after a heading names it.
    const heading = traced.headings.find(item => anchor && item.anchor === anchor)
      || traced.headings.find(item => !item.anchor && item.number === label.number && item.file === label.file && label.line >= item.line && label.line <= item.line + 3);
    if (heading && label.kind !== 'figure' && label.kind !== 'table') heading.labels.push(label.name);
  }
  // A float's caption is its contents entry; its label follows the caption.
  for (const float of floatEvents) {
    const label = traced.labels.filter(item => item.file === float.file && item.line >= float.line && item.line - float.line < 12 && (!item.number || item.number === float.number))
      .sort((a, b) => a.line - b.line)[0];
    if (label) { label.caption ??= float.caption; label.kind ??= float.kind; label.number ??= float.number; }
  }
  for (const [keys] of commands(aux, 'citation', 1)) for (const key of keys.split(',')) if (key.trim() && key.trim() !== '*') traced.citations.add(key.trim());
  for (const [names] of commands(aux, 'bibdata', 1)) for (const name of names.split(',')) {
    const file = path.resolve(cwd, name.trim().endsWith('.bib') ? name.trim() : name.trim() + '.bib'), rel = fs.existsSync(file) ? inside(file) : null;
    if (rel != null) traced.bibs.push(path.posix.join(build.sourceDir || '', rel));
  }
  // biblatex names its data sources in the .bcf.
  try {
    for (const m of fs.readFileSync(path.join(out, job + '.bcf'), 'utf8').matchAll(/<bcf:datasource[^>]*>([^<]+)<\/bcf:datasource>/g)) {
      const file = path.resolve(cwd, m[1].trim()), rel = fs.existsSync(file) ? inside(file) : null;
      if (rel != null) traced.bibs.push(path.posix.join(build.sourceDir || '', rel));
    }
  } catch { /* No biblatex. */ }
  try {
    const log = fs.readFileSync(path.join(out, job + '.log'), 'latin1');
    traced.undefinedRefs = [...new Set([...log.matchAll(/Reference `([^']+)' on page \S+ undefined/g)].map(m => m[1]))];
    traced.undefinedCites = [...new Set([...log.matchAll(/Citation `([^']+)' on page \S+ undefined/g)].map(m => m[1]))];
  } catch { /* No log. */ }

  // Line numbers in files edited since the build, carried over to their text now.
  if (maps.size) {
    const move = (file: string, line: number) => { const map = maps.get(file); return map ? map(line) ?? map.near(line) : line; };
    // A place whose own line was edited moves to the nearest line kept.
    const moved = (place: Place) => { const map = maps.get(place.file); if (!map) return false; const line = map(place.line); place.line = line ?? map.near(place.line); return line == null; };
    for (const heading of traced.headings) {
      heading.changed = moved(heading) || undefined;
      for (const [file, list] of Object.entries(heading.ranges)) if (maps.has(file)) heading.ranges[file] = list.map(([a, b]) => [move(file, a), Math.max(move(file, a), move(file, b))]);
    }
    for (const label of traced.labels) moved(label);
    if (traced.title) moved(traced.title);
    if (traced.abstract && maps.has(traced.abstract.file)) { const file = traced.abstract.file; traced.abstract = { file, start: move(file, traced.abstract.start), end: move(file, traced.abstract.end) }; }
  }
  return traced;
}

/**
 * A line of the build's copy of a file, as a line of the file now: the same
 * line when it is unchanged, null when it was edited. `near` places an edited
 * line after the nearest unchanged line before it, by the same distance.
 */
export function lineMap(before: string[], after: string[]) {
  const map = new Array<number | null>(before.length + 1).fill(null);
  let a = 1, b = 1;
  for (const change of diffArrays(before, after)) {
    const n = change.count ?? change.value.length;
    if (change.added) b += n;
    else if (change.removed) a += n;
    else for (let i = 0; i < n; i++) map[a++] = b++;
  }
  return Object.assign((line: number) => {
    if (line < 1) return 1;
    if (line > before.length) return Math.max(1, after.length - (line - before.length));
    return map[line];
  }, {
    near(line: number) {
      for (let at = Math.min(line, before.length); at >= 1; at--) if (map[at] != null) return Math.min(after.length, map[at]! + (line - at));
      return Math.min(line, after.length);
    },
  });
}

/** The build of the paper to map: the task's own last full build, else the one in Papilot's preview. */
export async function compiledPaper(host: { papilot(tool: 'paper_build', args: Record<string, unknown>): Promise<{ success: boolean; text: string }> }): Promise<CompiledPaper | null> {
  try {
    const found = await host.papilot('paper_build', {});
    const value = found.success ? JSON.parse(found.text) : null;
    return value && typeof value.pdf === 'string' && typeof value.root === 'string' ? value : null;
  } catch { return null; }
}
