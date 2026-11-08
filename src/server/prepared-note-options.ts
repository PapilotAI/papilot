import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PreparedNoteOptions, Run, Task } from '../shared.ts';
import type { Store } from './store.ts';
import type { ReviewClient } from './review.ts';
import { noteOptionContext, noteOptionsKey, parseNoteOptions } from './note-options.ts';
import type { NoteRound } from './note-results.ts';
import { textEdits } from '../../engine/src/core/text-edits.ts';

const execute = promisify(execFile);
const marker = '```papilot-note-options';
export const preparedNoteOptionsInstructions = `For manuscript edits the author requests, prepare alternatives during this editing turn, together with the main revision, for the numbered PDF notes in this message. Apply only the preferred proposal to the source. Respect requests for discussion or explanation without editing; this preference does not authorize extra manuscript changes. For each edited note with a meaningful wording choice, also prepare exactly two distinct alternatives now; do not leave generation for the review UI. Do not invent alternatives to factual corrections, deletions, or changes that have only one valid result.
After your normal concise summary, append one fenced block whose language is papilot-note-options, containing JSON in this shape:
{"notes":[{"note":1,"current":{"label":"short title","reason":"one concrete sentence"},"options":[{"label":"short title","reason":"one concrete sentence","edits":[{"file":"relative/path.tex","find":"exact source in the final proposed file","replace":"alternative source"}]},{"label":"another short title","reason":"one concrete sentence","edits":[{"file":"relative/path.tex","find":"exact source in the final proposed file","replace":"alternative source"}]}]}]}
Use the note numbers in this message (1-based). Use short titles and specific reasons in the note's language, at most 80 and 180 characters respectively. Each find string must occur exactly once in the final source; include unchanged surrounding text to disambiguate it when needed and preserve that context verbatim in replace. Only vary source you changed for that note; keep all other notes' edits, whitespace, citations, facts, quantities, and mathematical meaning intact. For overlapping notes, prepare each note's alternatives against the same final proposed file. Do not apply alternatives or write metadata files. This block is application data shown as choices in the PDF pane, not part of the conversational summary. Omit notes with no meaningful alternatives.`;

// Keep the original response in rawText while streaming only the human summary.
// A partly received marker must not briefly flash JSON in the conversation.
export function noteOptionsSummary(text: string) {
  const at = text.indexOf(marker);
  if (at >= 0) return text.slice(0, at).trimEnd();
  const last = text.lastIndexOf('\n');
  const tail = text.slice(last + 1);
  return tail && marker.startsWith(tail) ? text.slice(0, last < 0 ? 0 : last).trimEnd() : text;
}

export function readPreparedNoteOptions(text: string, count: number): PreparedNoteOptions[] {
  const at = text.indexOf(marker);
  if (at < 0 || text.length > 1024 * 1024) return [];
  const body = text.slice(at + marker.length), end = body.indexOf('```');
  if (end < 0) return [];
  let value: any;
  try { value = JSON.parse(body.slice(0, end)); } catch { return []; }
  if (!Array.isArray(value?.notes) || value.notes.length > count) return [];
  const title = (entry: any) => typeof entry?.label === 'string' && Boolean(entry.label.trim()) && entry.label.length <= 80
    && typeof entry.reason === 'string' && Boolean(entry.reason.trim()) && entry.reason.length <= 180 && !entry.reason.includes('\0');
  const seen = new Set<number>();
  return value.notes.filter((entry: any) => {
    if (!Number.isInteger(entry?.note) || entry.note < 1 || entry.note > count || seen.has(entry.note)) return false;
    seen.add(entry.note);
    return title(entry.current) && Array.isArray(entry.options) && entry.options.length === 2 && entry.options.every((option: any) =>
      title(option) && Array.isArray(option.edits) && option.edits.length > 0 && option.edits.length <= 64 && option.edits.every((edit: any) =>
        typeof edit?.file === 'string' && edit.file.length <= 500 && typeof edit.find === 'string' && edit.find.length > 0 && edit.find.length <= 20000
        && typeof edit.replace === 'string' && edit.replace.length <= 20000 && ![edit.file, edit.find, edit.replace].some(text => text.includes('\0'))));
  });
}

// Resolve source patches to exactly the units linked to this note. Context may
// identify a patch, but it cannot authorize changing another note's source.
export function preparedOptionEdits(option: PreparedNoteOptions['options'][number], units: NoteRound['units'], files: Map<string, string>) {
  const changes = new Map<string, { start: number; end: number; text: string }[]>();
  for (const patch of option.edits) {
    const source = files.get(patch.file);
    if (source === undefined) throw new Error('The option targets an unrelated source file.');
    const at = source.indexOf(patch.find);
    if (at < 0 || source.indexOf(patch.find, at + 1) >= 0) throw new Error('The option source is missing or ambiguous.');
    for (const [, i, j, x, y] of textEdits(patch.find, patch.replace)) {
      const start = at + i, end = at + j;
      const matches = units.filter(unit => unit.file === patch.file && unit.text_ops?.length === 1 && unit.text_ops[0][3] <= start && end <= unit.text_ops[0][4]);
      if (matches.length !== 1) throw new Error('The option changes source outside this note.');
      const unit = matches[0], offset = unit.text_ops![0][3], edits = changes.get(unit.id) || [];
      if (edits.some(edit => start - offset <= edit.end && edit.start <= end - offset)) throw new Error('The option has overlapping patches.');
      edits.push({ start: start - offset, end: end - offset, text: patch.replace.slice(x, y) });
      changes.set(unit.id, edits);
    }
  }
  return units.map(unit => ({ unit: unit.id, text: (changes.get(unit.id) || []).sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), unit.new_text) }));
}

export async function savePreparedNoteOptions(store: Store, task: Task, run: Run, client: ReviewClient) {
  if (!run.reviewRound || !run.noteOptions?.length) return;
  for (const prepared of run.noteOptions) {
    const key = `${run.id}:${prepared.note - 1}`, cacheKey = noteOptionsKey(task.id, key, run.reviewRound);
    if (store.preference(cacheKey)) continue;
    try {
      const context = await noteOptionContext(store, task, key, client);
      if (context.options.locked || context.options.round !== run.reviewRound || !context.detail.after || !/^[a-f0-9]{40,64}$/.test(context.detail.after)) continue;
      const files = new Map<string, string>();
      for (const file of new Set(context.units.map(unit => unit.file))) {
        const { stdout } = await execute('git', ['-C', task.worktree, 'cat-file', 'blob', `${context.detail.after}:${file}`], { maxBuffer: 8 * 1024 * 1024 });
        files.set(file, stdout);
      }
      const current = { ...context.options.options[0], ...prepared.current };
      const alternatives = parseNoteOptions(JSON.stringify({ options: prepared.options.map(option => ({ ...option, edits: preparedOptionEdits(option, context.units, files) })) }), current);
      // Stable IDs and cache survive retries, restarts and later option choices.
      store.savePreference(cacheKey, { ...context.options, options: [current, ...alternatives] });
    } catch (error) {
      // A malformed optional choice must not discard the author's main review.
      console.warn('Could not use prepared note options:', task.name, prepared.note, (error as Error).message);
    }
  }
}
