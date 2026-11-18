import fs from 'node:fs';
import path from 'node:path';
import { engine } from '../references.ts';
import { syncView } from '../build-problems.ts';
import { pdfWords } from '../manuscript.ts';
import { blankComments, definitions, project, simpleMacros, wordCount } from './plain-text.ts';
import { isProse, SKIP_DIRS } from './policy.ts';
import { diffArrays } from 'diff';
import { readTrace, type CompiledPaper, type Traced } from './build-map.ts';

// The paper map: what Papilot Writer knows about the manuscript before it
// reads a line. It is made from the latest build of the paper (see
// build-map.ts), so it shows the paper TeX typeset: the PDF's numbering and
// pages, the title TeX stored and the abstract as printed, and only the
// files TeX read. Sources edited since that build keep its structure, with
// line numbers carried over; the map says which files those are.

export interface Heading { id: string; title: string; number: string; kind: string; level: number; file: string; line: number; labels: string[]; ranges?: Record<string, [number, number][]>; parent?: string | null; page?: string; changed?: boolean }
interface Paper {
  bibliographyEntries(read: (file: string) => string | null, bibs: string[]): Map<string, { key: string }[]>;
}
export const paper = async () => (await engine()) as unknown as Paper;

/** The last build Papilot Writer ran in this task, if any. */
export interface BuildNote { ok: boolean; at: number; pages?: number; errors: string[]; warnings: string[] }

export interface PaperMap {
  main: string | null;
  text: string;
  files: string[];
  bibs: string[];
  outline: Heading[];
  /** The source of every file of the paper TeX read, by worktree-relative path, as it is now. */
  sources: Map<string, string>;
  /** The build the map was made from. */
  compiled: CompiledPaper | null;
}

export function reader(root: string) {
  return (file: string) => {
    const target = path.resolve(root, file);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    try { return fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null; } catch { return null; }
  };
}
const cap = <T>(items: T[], limit: number, show: (item: T) => string) =>
  items.length > limit ? `${items.slice(0, limit).map(show).join(', ')}, and ${items.length - limit} more` : items.map(show).join(', ');
const compactWords = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k words` : `${n} words`;
const time = (at?: number) => at ? new Date(at).toISOString().slice(11, 16) + ' UTC' : 'an earlier session';


// The abstract as the PDF prints it: the words inside the boxes SyncTeX
// places its source lines in. Text TeX skipped (a comment environment, an
// \iffalse) prints nothing, so it is not there. Kept per build.
const printed = new Map<string, Promise<string | null>>();
function printedText(pdf: string, snapshot: string, start: number, end: number) {
  const key = `${pdf}:${fs.statSync(pdf).mtimeMs}:${snapshot}:${start}-${end}`;
  if (!printed.has(key)) {
    if (printed.size > 16) printed.delete(printed.keys().next().value!);
    printed.set(key, (async () => {
      const lines = Array.from({ length: Math.min(400, end - start + 1) }, (_, i) => start + i), boxes: Awaited<ReturnType<typeof syncView>> = [];
      for (let i = 0; i < lines.length; i += 16) boxes.push(...(await Promise.all(lines.slice(i, i + 16).map(line => syncView(pdf, snapshot, line)))).flat());
      const pages = [...new Set(boxes.map(box => box.page))].sort((a, b) => a - b), text: string[] = [];
      for (const page of pages.slice(0, 3)) {
        const own = boxes.filter(box => box.page === page && box.H > 0 && box.W > 0 && box.H < 60);
        if (!own.length) continue;
        const inside = (x: number, y: number) => own.some(box => x >= box.h - 1 && x <= box.h + box.W + 1 && y >= box.v - box.H - 1 && y <= box.v + 2);
        const { words: list } = await pdfWords(pdf, page);
        let joining = false;
        for (const [word, left, baseline, , width, eol] of list) if (inside(left + width / 2, baseline)) {
          // A word hyphenated at the end of a line joins its other half.
          if (joining) text[text.length - 1] += word; else text.push(word);
          joining = Boolean(eol) && /\p{L}-$/u.test(word);
          if (joining) text[text.length - 1] = text[text.length - 1].slice(0, -1);
        }
      }
      return text.length ? text.join(' ') : null;
    })().catch(() => null));
  }
  return printed.get(key)!;
}

// The paper's TeX files, for a map without a build.
function texFiles(root: string) {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || found.length > 200) return;
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel, depth + 1);
      else if (/\.(?:tex|bib)$/i.test(entry.name)) found.push(rel);
    }
  };
  try { walk('', 0); } catch { /* An unreadable folder lists nothing. */ }
  return found;
}

/** The traced headings as the outline the tools use. */
export function outlineOf(traced: Traced): Heading[] {
  const ids = new Map<object, string>();
  return traced.headings.map((heading, index) => {
    const id = heading.anchor || `part-${index + 1}`;
    ids.set(heading, id);
    const parent = traced.headings.slice(0, index).reverse().find(other => other.level < heading.level);
    return { id, title: heading.title, number: heading.number, kind: heading.kind, level: heading.level, file: heading.file, line: heading.line, labels: heading.labels,
      ranges: heading.ranges, parent: parent ? ids.get(parent) : null, page: heading.page, changed: heading.changed };
  });
}
/** Only the outline of the paper in a worktree, from its latest build; empty without one. */
export function paperOutline(root: string, compiled: CompiledPaper | null): Heading[] {
  try { const traced = compiled && fs.existsSync(compiled.pdf) ? readTrace(compiled, fs.realpathSync(root)) : null; return traced ? outlineOf(traced) : []; } catch { return []; }
}

/** Builds the map of the paper in a worktree from its latest build. Never throws. */
export async function paperMap(root: string, options: { compiled?: CompiledPaper | null; note?: BuildNote | null } = {}): Promise<PaperMap> {
  const lines: string[] = [], compiled = options.compiled ?? null;
  const result: PaperMap = { main: null, text: '', files: [], bibs: [], outline: [], sources: new Map(), compiled };
  try {
    root = fs.realpathSync(root);
    const read = reader(root);
    let traced: Traced | null = null;
    try { traced = compiled && fs.existsSync(compiled.pdf) ? readTrace(compiled, root) : null; } catch { traced = null; }
    if (!traced?.main) {
      const files = texFiles(root);
      lines.push(compiled
        ? 'The latest build of the paper predates Papilot\'s outline, so there is no map of its sections yet. Call check_build: the map then shows the paper as TeX typeset it.'
        : 'The paper has not been compiled yet, so there is no map of its sections. Call check_build: the map then shows the paper as TeX typeset it.');
      if (files.length) lines.push(`TeX and bibliography files in the worktree (${files.length}): ${cap(files, 60, file => file)}`);
      result.files = files;
      // Searches still cover the paper's files.
      for (const file of files.filter(isProse)) { const text = read(file); if (text != null) result.sources.set(file, text); }
    } else {
      result.main = traced.main;
      for (const file of traced.inputs.filter(isProse)) { const text = read(file); if (text != null) result.sources.set(file, text); }
      result.files = traced.inputs; result.bibs = traced.bibs;
      const macros = simpleMacros([...result.sources.values()]);

      lines.push(`Made from the build of ${time(compiled!.builtAt)}${compiled!.pages ? ` (${compiled!.pages} pages)` : ''}: the paper as TeX typeset it, numbered as in the PDF. Line numbers are 1-based.`);
      if (traced.changed.length) lines.push(`Edited since that build: ${cap(traced.changed, 20, file => file)}. Their line numbers are carried over to the current text; parts added or renamed there show after the next build (check_build).`);
      if (traced.missing.length) lines.push(`Gone since that build: ${cap(traced.missing, 20, file => file)}.`);
      lines.push('');

      const title = traced.title?.source ? project(traced.title.source, macros).text.trim() : '';
      lines.push(title ? `Title (${traced.title!.file}:${traced.title!.line}): ${title}` : 'Title: none (the paper sets no \\title).');
      if (traced.abstract) {
        const { file, start, end } = traced.abstract;
        // The build's own copy of the file, which its PDF was typeset from.
        const snapshot = path.join(compiled!.root, path.posix.relative(compiled!.sourceDir || '', file));
        const text = traced.changed.includes(file) ? null : await printedText(compiled!.pdf, snapshot, start, end);
        const shown = text ?? project(blankComments((read(file) || '').split('\n').slice(start - 1, end).join('\n')), macros).text.trim();
        lines.push(`Abstract (${file}:${start}-${end}${text ? '' : ', from the source'}):`, shown.slice(0, 3000) + (shown.length > 3000 ? ' …' : ''));
      } else lines.push('Abstract: none (no abstract environment).');
      lines.push('');

      lines.push(`Main file: ${traced.main}${traced.documentClass ? ` (class ${traced.documentClass})` : ''}`);
      lines.push(`Files TeX read (${traced.inputs.length}): ${cap(traced.inputs, 40, file => { const text = read(file); return text == null ? `${file} (gone)` : `${file} (${text.split('\n').length} lines)`; })}`);
      if (traced.bibs.length) lines.push(`Bibliography files: ${traced.bibs.join(', ')}`);

      result.outline = outlineOf(traced);
      if (result.outline.length) {
        const top = Math.min(...result.outline.map(node => node.level));
        lines.push('', 'Outline (each part with its first page, and every file and line range it spans, subsections included):');
        lines.push(...outlineLines(result.outline, result.outline.length > 150 ? 1 : 9, result.sources, top));
        if (result.outline.length > 150) lines.push(`  … deeper headings omitted (${result.outline.length} in all); use paper_outline with a section.`);
      } else lines.push('', 'Outline: the paper has no numbered parts in its table of contents.');

      const floats = traced.labels.filter(label => label.caption);
      if (floats.length) lines.push('', `Floats (${floats.length}):`, ...floats.slice(0, 40).map(label => `- ${label.kind} ${label.number}${label.page ? ` (p. ${label.page})` : ''} ${label.name} ${label.file}:${label.line} "${label.caption!.slice(0, 90)}${label.caption!.length > 90 ? '…' : ''}"`),
        ...(floats.length > 40 ? [`- … ${floats.length - 40} more`] : []));
      const named = new Set(result.outline.flatMap(node => node.labels)), others = traced.labels.filter(label => !label.caption && !named.has(label.name));
      lines.push('', `Labels: ${traced.labels.length} set.${others.length ? ` Besides parts and floats: ${cap(others, 30, label => `${label.name}${label.number ? ` = ${label.number}` : ''}${label.page ? ` p. ${label.page}` : ''} (${label.file}:${label.line})`)}` : ''}`);
      if (traced.undefinedRefs.length) lines.push(`Undefined references in that build: ${cap(traced.undefinedRefs, 15, key => key)}`);

      const defined = new Set<string>();
      for (const [, text] of result.sources) for (const { name, parameters } of definitions(text)) defined.add(`\\${name}${parameters ? `[${parameters}]` : ''}`);
      if (defined.size) lines.push('', `Macros defined by the paper (${defined.size}): ${cap([...defined], 60, name => name)}`);

      try {
        const entries = [...(await paper()).bibliographyEntries(read, traced.bibs).values()].flat(), keys = new Set(entries.map(entry => entry.key));
        const missing = [...new Set([...traced.citations].filter(key => !keys.has(key)).concat(traced.undefinedCites))];
        lines.push('', `References: ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in ${traced.bibs.join(', ') || 'no .bib file'}, ${[...traced.citations].filter(key => keys.has(key)).length} cited.`);
        if (missing.length) lines.push(`Cited but missing from the bibliography: ${cap(missing, 15, key => key)}`);
        const seen = new Map<string, number>();
        for (const entry of entries) seen.set(entry.key, (seen.get(entry.key) || 0) + 1);
        const duplicates = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
        if (duplicates.length) lines.push(`Duplicate entries: ${cap(duplicates, 10, key => key)}`);
      } catch { /* A malformed .bib shows up in the build instead. */ }
    }
  } catch (error) {
    lines.push(`The paper map could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
  const note = options.note;
  if (note) {
    lines.push('', `Last check_build (${time(note.at)}): ${note.ok ? 'compiled' : 'failed'}${note.pages ? `, ${note.pages} pages` : ''}, ${note.errors.length} errors, ${note.warnings.length} warnings.`);
    for (const error of note.errors.slice(0, 5)) lines.push(`- error: ${error}`);
  } else lines.push('', 'Not compiled by you yet in this task. Call check_build after edits that could break the build.');
  result.text = lines.join('\n');
  return result;
}

const spans = (node: Heading) => Object.entries(node.ranges || {}).map(([file, list]) => `${file}:${list.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(',')}`).join('; ') || `${node.file}:${node.line}`;
/** The outline as a nested list: number, title, page, where it is, size, labels. */
export function outlineLines(nodes: Heading[], maxLevel: number, sources: Map<string, string>, base = 0) {
  return nodes.filter(node => node.level - base <= maxLevel).map(node => {
    let size = 0;
    for (const [file, list] of Object.entries(node.ranges || {})) {
      if (!isProse(file)) continue;
      for (const [a, b] of list) size += wordCount(sources.get(file) || '', a, b);
    }
    return `${'  '.repeat(Math.max(0, node.level - base))}- ${node.number ? node.number + ' ' : ''}${node.title}${node.page ? ` (p. ${node.page})` : ''} — ${spans(node)} (${compactWords(size)})${node.labels.length ? ` [${node.labels.join(', ')}]` : ''}${node.changed ? ' (its heading line was edited since the build)' : ''}`;
  });
}

/** The map as the model sees it at the start of a turn. */
export const mapMessage = (map: PaperMap) =>
  `<paper-map>\nThis is the map of the paper in your task worktree, made at the start of this turn. Later turns bring only what changed, in a <paper-map-update>.\n\n${map.text}\n</paper-map>`;

/**
 * What changed in the map since the one the model has, as an update; '' when
 * nothing did, and null when so much did that a whole map reads better.
 */
export function mapUpdate(before: string, after: string): string | null {
  if (before === after) return '';
  const changes: string[] = [];
  let changed = 0;
  for (const change of diffArrays(before.split('\n'), after.split('\n'))) {
    if (!change.added && !change.removed) continue;
    for (const line of change.value) if (line.trim()) { changes.push(`${change.added ? '+' : '-'} ${line}`); changed++; }
  }
  if (!changes.length) return '';
  if (changed > after.split('\n').length / 2) return null;
  return `<paper-map-update>\nThe paper map changed since the last one: each line marked - is gone, each marked + is new. Everything else in it still holds.\n\n${changes.join('\n')}\n</paper-map-update>`;
}
