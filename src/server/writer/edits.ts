import { parsePatch } from 'diff';
import type { EditPlace, FileEdit } from '../../shared.ts';
import type { Heading } from './paper-map.ts';
import { sectionsOf } from './tools.ts';

// A file change as the chat shows it: the diff, how many lines it adds and
// removes, and, for the paper's files, which parts of the paper each change
// is in ("§2.2 A Simple Implementation, p. 4"), from the outline of the
// latest build.

const MAX_DIFF = 20000;

/** A change as an agent reports it. A new or deleted file may come as its whole text. */
export function fileEdit(path: string, diff: string | undefined, outline: Heading[], kind?: string): FileEdit {
  let patch = diff || '';
  if (patch && !patch.startsWith('@@') && !patch.startsWith('---') && !patch.startsWith('diff ') && !patch.startsWith('Index:')) {
    const lines = patch.replace(/\n$/, '').split('\n'), sign = kind === 'delete' ? '-' : '+';
    patch = `@@ ${sign === '-' ? `-1,${lines.length} +0,0` : `-0,0 +1,${lines.length}`} @@\n${lines.map(line => sign + line).join('\n')}\n`;
  }
  const edit: FileEdit = { path, added: 0, removed: 0 };
  if (!patch) return edit;
  let hunks: ReturnType<typeof parsePatch>[number]['hunks'] = [];
  try { hunks = parsePatch(patch).flatMap(file => file.hunks); } catch { /* An unreadable diff is still shown. */ }
  const places: EditPlace[] = [];
  for (const hunk of hunks) {
    const added = hunk.lines.filter(line => line.startsWith('+')).length, removed = hunk.lines.filter(line => line.startsWith('-')).length;
    edit.added += added; edit.removed += removed;
    const start = Math.max(1, hunk.newStart), end = Math.max(start, hunk.newStart + hunk.newLines - 1);
    const where = outline.length ? sectionsOf(outline, path, start, end) : null;
    const sections = where?.sections || [];
    const innermost = sections.at(-1), page = innermost && outline.find(node => node.number === innermost.number && node.title === innermost.title)?.page;
    const last = places.at(-1);
    // Hunks in the same part read as one change there.
    if (last && JSON.stringify(last.sections) === JSON.stringify(sections)) { last.added += added; last.removed += removed; last.lines = `${last.lines.split('–')[0]}–${end}`; }
    else places.push({ sections, ...(page ? { page } : {}), lines: start === end ? String(start) : `${start}–${end}`, added, removed });
  }
  if (places.some(place => place.sections.length)) edit.places = places;
  edit.diff = patch.length > MAX_DIFF ? patch.slice(0, MAX_DIFF) + '\n…' : patch;
  return edit;
}
