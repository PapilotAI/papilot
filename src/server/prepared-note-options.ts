import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PreparedNoteOptions, Run, Task } from '../shared.ts';
import { MAX_NOTE_ALTERNATIVES, NOTE_ALTERNATIVE_RANGES, noteAlternativeRange } from '../shared.ts';
import type { Store } from './store.ts';
import type { ReviewClient } from './review.ts';
import { noteOptionContext, noteOptionsKey, parseNoteOptions } from './note-options.ts';
import { taskNoteResults, type NoteRound } from './note-results.ts';
import { taskRoute } from './review.ts';
import { textEdits } from '../../engine/src/core/text-edits.ts';

const execute = promisify(execFile);
const language = 'papilot-note-options';
export function preparedNoteOptionsInstructions(range: unknown = 'few') {
  const [min, max] = NOTE_ALTERNATIVE_RANGES[noteAlternativeRange(range)];
  return `For manuscript edits the author requests, prepare alternatives during this editing turn, together with the main revision, for the numbered PDF notes in this message. Apply only the preferred proposal to the source. Respect requests for discussion or explanation without editing; this preference does not authorize extra manuscript changes. For each edited note with a meaningful wording choice, aim for ${min}–${max} extra alternatives, excluding the main proposal, now; do not leave generation for the review UI. This is a target range, not a quota: fewer or more useful choices are fine, up to ${MAX_NOTE_ALTERNATIVES}. Never pad the response with repetitive or weak choices. Do not invent alternatives to factual corrections, deletions, or changes that have only one valid result.
After your normal concise summary, append one fenced block whose language is papilot-note-options, containing JSON in this shape:
{"notes":[{"note":1,"current":{"label":"short title","reason":"one concrete sentence"},"options":[{"label":"short title","reason":"one concrete sentence","edits":[{"file":"relative/path.tex","find":"exact source in the final proposed file","replace":"alternative source"}]},{"label":"another short title","reason":"one concrete sentence","edits":[{"file":"relative/path.tex","find":"exact source in the final proposed file","replace":"alternative source"}]}]}]}
The JSON shape above illustrates two alternatives; use the requested range for the actual options array. Use the note numbers in this message (1-based). Use short titles and specific reasons in the note's language, at most 80 and 180 characters respectively. Each find string must occur exactly once in the final source; include unchanged surrounding text to disambiguate it when needed and preserve that context verbatim in replace. Only vary source you changed for that note; keep all other notes' edits, whitespace, citations, facts, quantities, and mathematical meaning intact. Compare your main revision to the original source and keep every unchanged prefix and suffix unchanged in each alternative. For example, if you change "The estimates are stable." to "The estimates exhibit stability.", vary "exhibit stability"; do not add "resulting" before the unchanged word "estimates". For overlapping notes, prepare each note's alternatives against the same final proposed file. Do not apply alternatives or write metadata files. This block is application data shown as choices in the PDF pane, not part of the conversational summary. Omit notes with no meaningful alternatives.`;
}

const fenceLine = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/;

// Some agents omit the reserved fence or label it as ordinary JSON. Only
// recognize a standalone object with the structure of prepared choices.
function choiceObject(text: string) {
  try {
    const value = JSON.parse(text);
    return Object.keys(value).length === 1 && Array.isArray(value.notes) && value.notes.length > 0 && value.notes.every((entry: any) =>
      Number.isInteger(entry?.note) && typeof entry.current?.label === 'string' && typeof entry.current.reason === 'string'
      && Array.isArray(entry.options) && entry.options.every((option: any) => typeof option?.label === 'string'
        && typeof option.reason === 'string' && Array.isArray(option.edits)
        && option.edits.every((edit: any) => typeof edit?.file === 'string' && typeof edit.find === 'string' && typeof edit.replace === 'string')));
  } catch { return false; }
}

// Find the end without treating braces or escaped quotes in LaTeX edits as
// delimiters. The rest of the assistant's message can follow the closing brace.
function objectEnd(text: string, start: number) {
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '\\') i++;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '{' || char === '[')) depth++;
    else if (!quoted && (char === '}' || char === ']') && --depth === 0) return i + 1;
  }
  return -1;
}

function unmarkedOptions(text: string, streaming: boolean) {
  let summary = '', cursor = 0, payload: string | undefined, hidden = false;
  const objects = /^[ \t]*[[{]/gm;
  for (let match; (match = objects.exec(text));) {
    const start = objects.lastIndex - 1;
    const tail = text.slice(start);
    // Hold the ambiguous prefix until we know whether it is normal JSON.
    const prefix = tail.slice(0, 80).replace(/\s/g, '');
    const possible = /^\{\s*"notes"\s*:/.test(tail) || (streaming && '{"notes":'.startsWith(prefix));
    // Skip ordinary JSON as a unit, including an array of example objects.
    if (!possible && !/^\{\s*["}]|^\[\s*(?:["{[\]0-9-]|true|false|null)/.test(tail)) continue;
    const end = objectEnd(text, start);
    if (!possible) {
      if (end === -1) break;
      objects.lastIndex = end;
      continue;
    }
    const candidate = end === -1 ? tail : text.slice(start, end);
    if (end === -1 ? streaming || /^\{\s*"notes"\s*:\s*\[\s*\{\s*"note"\s*:\s*\d+[\s\S]*?"current"\s*:\s*\{[\s\S]*?"options"\s*:\s*\[/.test(candidate) : choiceObject(candidate)) {
      hidden = true;
      summary += text.slice(cursor, match.index);
      cursor = end === -1 ? text.length : end;
      if (end !== -1) payload ??= candidate;
    }
    if (end === -1) break;
    objects.lastIndex = end;
  }
  return { summary: hidden ? (summary + text.slice(cursor)) : text, payload, hidden };
}

function scanNoteOptions(text: string, streaming: boolean) {
  if (!/[`~{]/.test(text)) return { summary: text };
  let summary = '', payload: string | undefined, hidden = false, plain = '';
  let fence: { delimiter: string; lang: string; opener: string; body: string } | undefined;
  const flushPlain = (live: boolean) => {
    const result = unmarkedOptions(plain, live);
    summary += result.summary; payload ??= result.payload; hidden ||= result.hidden; plain = '';
  };
  const close = (closing: string) => {
    if (!fence) return;
    const { lang, opener, body } = fence;
    if (lang === language) { hidden = true; if (closing) payload ??= body; }
    else if (lang.toLowerCase() === 'json' || !lang) {
      const candidate = !closing && streaming ? body.replace(/(?:^|\n) {0,3}[`~]{1,2}$/, '') : body;
      const result = unmarkedOptions(candidate, !closing && streaming);
      if (result.hidden && !result.summary.trim()) { hidden = true; payload ??= result.payload; }
      else if (!closing && streaming && !candidate.trim()) hidden = true;
      else summary += opener + body + closing;
    } else summary += opener + body + closing;
    fence = undefined;
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const content = line.replace(/\r?\n$/, ''), opening = content.match(fenceLine);
    if (fence) {
      if (opening && opening[1][0] === fence.delimiter[0] && opening[1].length >= fence.delimiter.length && !opening[2].trim()) close(line);
      else fence.body += line;
      continue;
    }
    const partial = streaming && !line.endsWith('\n') && content.match(/^ {0,3}(?:`+|~+)[ \t]*([a-z-]*)$/i);
    if (partial && (language.startsWith(partial[1]) || 'json'.startsWith(partial[1].toLowerCase()))) { hidden = true; continue; }
    if (opening && (opening[1][0] === '~' || !opening[2].includes('`'))) {
      flushPlain(false);
      fence = { delimiter: opening[1], lang: opening[2].trim().split(/[ \t]+/, 1)[0], opener: line, body: '' };
    } else plain += line;
  }
  if (fence) close('');
  else flushPlain(streaming);
  return { summary: hidden ? summary.trimEnd() : summary, payload };
}

export function noteOptionsSummary(text: string, streaming = false) {
  return scanNoteOptions(text, streaming).summary;
}

export function readPreparedNoteOptions(text: string, count: number): PreparedNoteOptions[] {
  if (text.length > 1024 * 1024) return [];
  const { payload } = scanNoteOptions(text, false);
  if (!payload) return [];
  let value: any;
  try { value = JSON.parse(payload); } catch { return []; }
  if (!Array.isArray(value?.notes) || value.notes.length > count) return [];
  const title = (entry: any) => typeof entry?.label === 'string' && Boolean(entry.label.trim()) && entry.label.length <= 80
    && typeof entry.reason === 'string' && Boolean(entry.reason.trim()) && entry.reason.length <= 180 && !entry.reason.includes('\0');
  const seen = new Set<number>();
  return value.notes.filter((entry: any) => {
    if (!Number.isInteger(entry?.note) || entry.note < 1 || entry.note > count || seen.has(entry.note)) return false;
    seen.add(entry.note);
    return title(entry.current) && Array.isArray(entry.options) && entry.options.length <= MAX_NOTE_ALTERNATIVES && entry.options.every((option: any) =>
      title(option) && Array.isArray(option.edits) && option.edits.length > 0 && option.edits.length <= 64 && option.edits.every((edit: any) =>
        typeof edit?.file === 'string' && edit.file.length <= 500 && typeof edit.find === 'string' && edit.find.length > 0 && edit.find.length <= 20000
        && typeof edit.replace === 'string' && edit.replace.length <= 20000 && ![edit.file, edit.find, edit.replace].some(text => text.includes('\0'))));
  });
}

// A minimal diff can align a moved word with the wrong occurrence. When that
// crosses a unit boundary, project against the unchanged source between units
// instead. Only a unique placement of every unchanged gap is safe to use.
function projectPreparedSource(source: string, candidate: string, units: NoteRound['units']) {
  const ranges = units.map(unit => ({ unit, start: unit.text_ops![0][3], end: unit.text_ops![0][4] })).sort((a, b) => a.start - b.start);
  if (!ranges.length) throw new Error('The option changes source outside this note.');
  const prefix = source.slice(0, ranges[0].start), suffix = source.slice(ranges.at(-1)!.end);
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix) || candidate.length < prefix.length + suffix.length)
    throw new Error('The option changes source outside this note.');
  const body = candidate.slice(prefix.length, candidate.length - suffix.length);
  const gaps = ranges.slice(1).map((range, i) => source.slice(ranges[i].end, range.start));
  const positions: number[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    const at = body.indexOf(gap, cursor);
    if (at < 0) throw new Error('The option changes source outside this note.');
    positions.push(at); cursor = at + gap.length;
  }
  cursor = body.length;
  for (let i = gaps.length - 1; i >= 0; i--) {
    const at = body.lastIndexOf(gaps[i], cursor - gaps[i].length);
    if (at !== positions[i]) throw new Error('The option source is missing or ambiguous.');
    cursor = at;
  }
  return ranges.map(({ unit }, i) => ({ unit: unit.id, text: body.slice(i ? positions[i - 1] + gaps[i - 1].length : 0, i < gaps.length ? positions[i] : body.length) }));
}

// Resolve source patches to the units linked to this note. Context may
// identify a patch, and when an independent cross-model alternative varies a
// few unchanged words immediately before/after a unit (without touching any
// other unit in the round), absorb that margin into `before`/`after` so the
// alternative can still be previewed and accepted cleanly.
export function preparedOptionEdits(option: PreparedNoteOptions['options'][number], units: NoteRound['units'], files: Map<string, string>, allUnits: NoteRound['units'] = units, allowSpanExpansion = Boolean(option.meta)) {
  const changes = new Map<string, { start: number; end: number; text: string }[]>();
  for (const unit of units) {
    const op = unit.text_ops?.length === 1 && unit.text_ops[0], source = files.get(unit.file);
    if (!op || source === undefined || op[3] < 0 || op[4] < op[3] || op[4] > source.length || source.slice(op[3], op[4]) !== unit.new_text)
      throw new Error('The option source is missing or ambiguous.');
  }
  for (const patch of option.edits) {
    const source = files.get(patch.file);
    if (source === undefined) throw new Error('The option targets an unrelated source file.');
    const at = source.indexOf(patch.find);
    if (at < 0 || source.indexOf(patch.find, at + 1) >= 0) throw new Error('The option source is missing or ambiguous.');
    for (const [, i, j, x, y] of textEdits(patch.find, patch.replace)) {
      const start = at + i, end = at + j;
      const edits = changes.get(patch.file) || [];
      if (edits.some(edit => start <= edit.end && edit.start <= end)) throw new Error('The option has overlapping patches.');
      edits.push({ start, end, text: patch.replace.slice(x, y) });
      changes.set(patch.file, edits);
    }
  }
  const result = new Map<string, { text: string; before?: number; after?: number }>(units.map(unit => [unit.id, { text: unit.new_text }]));
  for (const [file, edits] of changes) {
    const source = files.get(file)!, ranges = units.filter(unit => unit.file === file).sort((a, b) => a.text_ops![0][3] - b.text_ops![0][3]);
    if (ranges.some((unit, i) => i && ranges[i - 1].text_ops![0][4] > unit.text_ops![0][3])) throw new Error('The option source is missing or ambiguous.');
    edits.sort((a, b) => b.start - a.start);
    const owners = edits.map(edit => ranges.filter(unit => unit.text_ops![0][3] <= edit.start && edit.end <= unit.text_ops![0][4]));
    if (owners.every(matches => matches.length === 1)) {
      edits.forEach((edit, i) => {
        const unit = owners[i][0], offset = unit.text_ops![0][3], entry = result.get(unit.id)!;
        entry.text = entry.text.slice(0, edit.start - offset) + edit.text + entry.text.slice(edit.end - offset);
      });
    } else {
      const candidate = edits.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
      try {
        for (const edit of projectPreparedSource(source, candidate, ranges)) result.set(edit.unit, { text: edit.text });
      } catch (error) {
        // Cross-model race alternatives (marked with option.meta or explicit
        // opt-in) can vary boundaries immediately outside one or more linked
        // units' minimal diff spans. Expand into unchanged same-paragraph text
        // only when all changes stay strictly clear of every other unit.
        if (!allowSpanExpansion || !ranges.length) throw error;
        const first = ranges[0], last = ranges.at(-1)!;
        const firstOldStart = first.text_ops![0][1], firstStart = first.text_ops![0][3];
        const lastEnd = last.text_ops![0][4];
        const minStart = Math.min(firstStart, ...edits.map(edit => edit.start));
        const maxEnd = Math.max(lastEnd, ...edits.map(edit => edit.end));
        if (/\n\s*\n/.test(source.slice(minStart, firstStart)) || /\n\s*\n/.test(source.slice(lastEnd, maxEnd))) {
          throw new Error('The option changes source outside this note.');
        }
        const rangeIds = new Set(ranges.map(unit => unit.id));
        const others = allUnits.filter(other => other.file === file && !rangeIds.has(other.id));
        const collides = others.some(other => other.whole_file || !other.text_ops?.length || other.text_ops.some(([, , , ox, oy]) => ox < maxEnd && minStart < oy));
        if (collides) throw new Error('The option changes source outside this note.');
        const beforeFirst = firstStart - minStart;
        if (beforeFirst > firstOldStart || beforeFirst > 20000 || maxEnd - lastEnd > 20000) throw new Error('The option changes source outside this note.');
        const expanded = edits.reduce((text, edit) => text.slice(0, edit.start - minStart) + edit.text + text.slice(edit.end - minStart), source.slice(minStart, maxEnd));
        if (expanded.length > 20000) throw new Error('The option changes source outside this note.');
        if (ranges.length === 1) {
          const after = maxEnd - lastEnd;
          result.set(first.id, { text: expanded, ...(beforeFirst ? { before: beforeFirst } : {}), ...(after ? { after } : {}) });
        } else {
          // Partition [minStart, maxEnd) across the linked units as adjacent
          // non-overlapping spans so optionCandidate and review.accept apply them cleanly.
          for (let idx = 0; idx < ranges.length; idx++) {
            const unit = ranges[idx], [, , , uStart, uEnd] = unit.text_ops![0];
            const spanStart = idx === 0 ? minStart : uStart;
            const spanEnd = idx + 1 < ranges.length ? ranges[idx + 1].text_ops![0][3] : maxEnd;
            const before = uStart - spanStart, after = spanEnd - uEnd;
            if (before < 0 || after < 0 || before > 20000 || after > 20000) throw new Error('The option changes source outside this note.');
            result.set(unit.id, {
              text: idx === 0 ? expanded : '',
              ...(before ? { before } : {}),
              ...(after ? { after } : {}),
            });
          }
        }
      }
    }
  }
  return units.map(unit => ({ unit: unit.id, ...result.get(unit.id)! }));
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
      const projected = prepared.options.flatMap(option => {
        try { return [{ ...option, edits: preparedOptionEdits(option, context.units, files, context.detail.units) }]; }
        catch (error) {
          console.warn('Could not use prepared note option:', task.name, prepared.note, option.label, (error as Error).message);
          return [];
        }
      });
      const alternatives = parseNoteOptions(JSON.stringify({ options: projected }), current, true);
      // Stable IDs and cache survive retries, restarts and later option choices.
      store.savePreference(cacheKey, { ...context.options, options: [current, ...alternatives] });
    } catch (error) {
      // A malformed optional choice must not discard the author's main review.
      console.warn('Could not use prepared note options:', task.name, prepared.note, (error as Error).message);
    }
  }
}

/** Warm optional PDFs after publication. Decisions and newer rounds can
 * supersede this work; they must never wait for it or inherit stale errors. */
export async function prepareNoteComparisons(store: Store, task: Task, client: ReviewClient,
  progress: (completed: number, total: number) => void = () => {}, stopped = () => false) {
  const runs = store.runs().filter(run => run.taskId === task.id);
  if (!runs.some(run => run.noteOptions?.length)) return;
  const notes = await taskNoteResults(task, store.items(task.id), runs, client);
  const contexts = [];
  for (const note of notes) {
    if (stopped()) return;
    if (note.round !== task.review?.round || !note.changes.length) continue;
    const context = await noteOptionContext(store, task, note.key, client);
    if (!context.options.locked) contexts.push(context.options);
  }
  const total = contexts.reduce((n, options) => n + options.options.filter(option => option.id !== options.selected).length, 0);
  let completed = 0;
  if (total) progress(completed, total);
  // Warm one alternative per note before the next alternative of any note.
  // The first choices of later annotations should not wait for all six choices
  // of the first. Foreground requests can join and promote these same builds.
  const candidates = contexts.map(options => ({ options, remaining: options.options.filter(option => option.id !== options.selected) }));
  while (candidates.some(candidate => candidate.remaining.length)) for (const candidate of candidates) {
    const { options, remaining } = candidate, option = remaining.shift();
    if (!option) continue;
    if (stopped()) return;
    const context = await noteOptionContext(store, task, options.key, client);
    if (stopped()) return;
    if (context.options.locked || context.options.comparisonKey !== options.comparisonKey) { remaining.length = 0; continue; }
    let previewError: string | undefined;
    try {
      await client.post(`${taskRoute(task.name)}/source/options/preview`, { id: option.id, round: options.round, edits: option.edits, rejected: context.rejected, background: true }, 1850000);
    } catch (error) {
      previewError = (error as Error).message;
    }
    if (stopped()) return;
    const fresh = await noteOptionContext(store, task, options.key, client);
    if (stopped()) return;
    if (fresh.options.locked || fresh.options.comparisonKey !== options.comparisonKey) { remaining.length = 0; continue; }
    const saved = fresh.options.options.find(candidate => candidate.id === option.id);
    if (saved) {
      // Read the latest choices again: a decision or another preview may have
      // finished while this PDF compiled. Never replace their cached state.
      if (previewError) {
        saved.previewError = previewError;
        console.warn('Could not prepare note comparison:', task.name, option.label, previewError);
      } else delete saved.previewError;
      store.savePreference(noteOptionsKey(task.id, options.key, options.round), fresh.options);
    }
    progress(++completed, total);
  }
}
