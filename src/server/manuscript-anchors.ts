import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SourceAnchor, SourcePlace } from '../shared.ts';
import type { Manuscripts } from './manuscript.ts';
import type { Store } from './store.ts';
import { ENGINE } from './paths.ts';
import { followLines, type LineOp } from './note-location.ts';
import { placeSource, revision } from './manuscript-source.ts';

type Rect = [number, number, number, number];
const linesOf = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');

/** Preserve the source itself, not a build-cache path that can disappear. */
export async function captureAnchor(manuscripts: Manuscripts, store: Store, projectId: string, key: string, page: number, rect: Rect, rects: Rect[], quote: string): Promise<{ source: SourceAnchor | null }> {
  const located = await manuscripts.locate(projectId, key, page, rect, rects, quote), source = located.compiled;
  if (!source) return { source: null };
  // Generated files such as a build's .toc are not the author's TeX source.
  // Only bind files that also belong to the editable paper, as the source tool does.
  const { safePath } = await import(pathToFileURL(path.join(ENGINE, 'src/core/review.ts')).href);
  try { if (!(await fs.stat(safePath(store.project(projectId).path, source.file))).isFile()) return { source: null }; }
  catch { return { source: null }; }
  const text = await compiledText(manuscripts, projectId, key, source.file);
  if (text === null || source.lines[0] < 1 || source.lines[1] > linesOf(text).length) return { source: null };
  const hash = revision(Buffer.from(text));
  store.saveAnchorSource(projectId, hash, text);
  return { source: { file: source.file, revision: hash, lines: source.lines, quote: located.quote.replace(/‸/g, '').replace(/\s+/g, ' ').trim() } };
}

async function compiledText(manuscripts: Manuscripts, projectId: string, key: string, file: string) {
  const build = manuscripts.compiled(projectId, key);
  const relative = path.posix.relative(build.sourceDir || '.', file);
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  const { safePath } = await import(pathToFileURL(path.join(ENGINE, 'src/core/review.ts')).href);
  let input: string;
  try { input = safePath(build.root, relative); } catch { return null; }
  try {
    const stat = await fs.stat(input);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    return await fs.readFile(input, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Follow edits at the same passage, or a unique intact passage moved elsewhere.
 * Deletion, a boundary-crossing replacement, or a timed-out diff never falls
 * back to the old line/page number. */
export function followAnchor(before: string[], after: string[], lines: [number, number], ops: LineOp[] | null): [number, number] | null {
  if (!ops) return null;
  const needle = before.slice(lines[0] - 1, lines[1]);
  if (!needle.length || !needle.some(line => line.trim())) return null;
  let originalCount = 0;
  for (let at = 0; at <= before.length - needle.length; at++) if (needle.every((line, index) => before[at + index] === line)) originalCount++;
  let match: number | undefined, count = 0;
  for (let at = 0; at <= after.length - needle.length; at++) {
    if (needle.every((line, index) => after[at + index] === line)) { match = at; count++; }
  }
  if (originalCount === 1 && count === 1) return [match! + 1, match! + needle.length];
  const followed = followLines(ops, lines);
  // Diff can arbitrarily choose which identical line was inserted/deleted.
  // Preserve a local replacement, but refuse an unchanged duplicate when
  // the number of occurrences changed and its identity cannot be proven.
  if (followed && count !== originalCount && needle.every((line, index) => after[followed[0] - 1 + index] === line)) return null;
  return followed;
}

export interface AnchorRequest { id: string; source: SourceAnchor; near: number }
export async function resolveAnchors(manuscripts: Manuscripts, store: Store, projectId: string, key: string, anchors: AnchorRequest[]): Promise<{ id: string; place: SourcePlace | null }[]> {
  manuscripts.compiled(projectId, key);
  const { opcodesWithin } = await import(pathToFileURL(path.join(ENGINE, 'src/core/diff.ts')).href);
  const comparisons = new Map<string, { before: string[]; after: string[]; ops: LineOp[] | null } | null>();
  const result: { id: string; place: SourcePlace | null }[] = [];
  for (const anchor of anchors) {
    const { source } = anchor, identity = JSON.stringify([source.file, source.revision]);
    if (!comparisons.has(identity)) {
      const original = store.anchorSource(projectId, source.revision), current = await compiledText(manuscripts, projectId, key, source.file);
      const before = original === undefined ? null : linesOf(original), after = current === null ? null : linesOf(current);
      comparisons.set(identity, before && after ? { before, after, ops: opcodesWithin(before, after, 1000) } : null);
    }
    const comparison = comparisons.get(identity);
    const lines = comparison && source.lines[1] <= comparison.before.length ? followAnchor(comparison.before, comparison.after, source.lines, comparison.ops) : null;
    let place = lines ? (await placeSource(manuscripts, projectId, key, source.file, lines[0] - 1, lines[1], anchor.near, source.quote || '')).place : null;
    if (place && lines) {
      // SyncTeX may substitute the nearest printable line for a comment or
      // an unused input. Verify the return trip before accepting that box.
      const located = (await manuscripts.locate(projectId, key, place.page, place.rect, [place.rect], '')).compiled;
      if (!located || located.file !== source.file || located.lines[1] < lines[0] || located.lines[0] > lines[1]) place = null;
    }
    result.push({ id: anchor.id, place });
  }
  return result;
}

export function isSourceAnchor(value: unknown): value is SourceAnchor {
  const source = value as SourceAnchor | null;
  return Boolean(source && typeof source.file === 'string' && source.file.length <= 1024 && source.file && !source.file.includes('\0')
    && typeof source.revision === 'string' && /^[a-f0-9]{64}$/.test(source.revision) && Array.isArray(source.lines) && source.lines.length === 2
    && source.lines.every(line => Number.isSafeInteger(line) && line > 0) && source.lines[1] >= source.lines[0]
    && (source.quote === undefined || (typeof source.quote === 'string' && source.quote.length <= 20000)));
}
