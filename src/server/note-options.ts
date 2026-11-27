import { createHash, randomUUID } from 'node:crypto';
import type { NoteOption, NoteOptionEdit, NoteOptionMeta, NoteOptions, Task } from '../shared.ts';
import { MAX_NOTE_ALTERNATIVES } from '../shared.ts';
import type { Store } from './store.ts';
import { readRound, sameFragment, taskNoteResults, type NoteRound } from './note-results.ts';
import { taskRoute, type ReviewClient } from './review.ts';

export const noteOptionsKey = (task: string, key: string, round: number) => `note-options:${task}:${round}:${createHash('sha256').update(key).digest('hex')}`;

function sanitizeMeta(value: unknown): NoteOptionMeta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const meta: NoteOptionMeta = {};
  if (raw.recommended === true) meta.recommended = true;
  if (raw.rigor === 'pass' || raw.rigor === 'warn' || raw.rigor === 'fail') meta.rigor = raw.rigor;
  if (typeof raw.lineDelta === 'number' && Number.isFinite(raw.lineDelta)) meta.lineDelta = Math.trunc(raw.lineDelta);
  if (Array.isArray(raw.consensus)) {
    const list = raw.consensus.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()) && item.length <= 80).slice(0, 6);
    if (list.length) meta.consensus = list;
  }
  if (typeof raw.model === 'string' && raw.model.trim() && raw.model.length <= 80) meta.model = raw.model.trim();
  if (raw.synthesized === true) meta.synthesized = true;
  return Object.keys(meta).length ? meta : undefined;
}

const sameEdit = (a: NoteOptionEdit, b: NoteOptionEdit) => a.unit === b.unit && a.text === b.text && (a.before ?? 0) === (b.before ?? 0) && (a.after ?? 0) === (b.after ?? 0);

// Choices remain the same choices after a selection rebuilds the proposal.
// Match source fragments, never their ordinal IDs alone (IDs can be reused).
export function rebaseNoteOptions(options: NoteOption[], previous: NoteRound['units'], next: NoteRound['units'], sameBase = false): NoteOption[] {
  const mapping = new Map<string, string>();
  for (const unit of previous) {
    const matches = next.filter(candidate => sameFragment(unit, candidate, sameBase));
    if (matches.length === 1) mapping.set(unit.id, matches[0].id);
  }
  return options.filter(option => option.id !== 'latest').flatMap(({ previewError: _error, ...option }) => {
    if (!sameBase && option.edits.some(edit => edit.before || edit.after)) return [];
    const edits = option.edits.map(edit => ({ ...edit, unit: mapping.get(edit.unit) || '' }));
    return edits.length === next.length && edits.every(edit => edit.unit) && new Set(edits.map(edit => edit.unit)).size === next.length ? [{ ...option, edits }] : [];
  });
}

/** Whether an option's wording differs from the round's proposal. */
export function replacesProposal(option: NoteOption, units: { id: string; new_text: string }[]) {
  return option.edits.some(edit => Boolean(edit.before || edit.after) || units.find(unit => unit.id === edit.unit)?.new_text !== edit.text);
}

export function selectedNoteOptions(choices: NoteOption[], current: NoteOption) {
  const selected = choices.find(option => option.edits.length === current.edits.length && option.edits.every(edit => current.edits.some(actual => sameEdit(actual, edit))));
  // Overlapping notes can produce a combination that is none of this note's
  // original choices. Show that actual combination without losing the choices.
  const { meta: _meta, ...latest } = current;
  return selected ? { options: choices, selected: selected.id } : { options: [{ ...latest, id: 'latest' }, ...choices], selected: 'latest' };
}

export function parseNoteOptions(text: string, current: NoteOption, partial = false): NoteOption[] {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  if (!Array.isArray(value.options) || value.options.length > MAX_NOTE_ALTERNATIVES || (!partial && !value.options.length)) throw new Error('The agent returned an incomplete option. Try again.');
  const signatureOf = (edits: NoteOptionEdit[]) => JSON.stringify(edits.map(edit => [edit.unit, edit.text, edit.before ?? 0, edit.after ?? 0]));
  const signatures = new Set([signatureOf(current.edits)]);
  const validSpan = (n: unknown) => n === undefined || (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 20000);
  return value.options.flatMap((entry: any) => {
    try {
      if (typeof entry?.label !== 'string' || !entry.label.trim() || entry.label.length > 80 || !Array.isArray(entry.edits)
        || entry.edits.length !== current.edits.length || new Set(entry.edits.map((edit: any) => edit?.unit)).size !== current.edits.length)
        throw new Error('The agent returned an incomplete option. Try again.');
      if (typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 180 || entry.reason.includes('\0'))
        throw new Error('Each option needs a brief, specific reason. Try again.');
      const edits: NoteOptionEdit[] = current.edits.map(original => {
        const edit = entry.edits.find((edit: any) => edit?.unit === original.unit);
        if (!edit || typeof edit.text !== 'string' || edit.text.includes('\0') || edit.text.length > 20000 || !validSpan(edit.before) || !validSpan(edit.after))
          throw new Error('The option includes an invalid change. Try again.');
        return { unit: original.unit, text: edit.text, ...(edit.before ? { before: edit.before } : {}), ...(edit.after ? { after: edit.after } : {}) };
      });
      const signature = signatureOf(edits);
      if (signatures.has(signature)) throw new Error('The agent repeated an option. Try again.');
      signatures.add(signature);
      const meta = sanitizeMeta(entry.meta);
      return [{ id: randomUUID(), label: entry.label.trim(), reason: entry.reason.trim(), ...(meta ? { meta } : {}), edits }];
    } catch (error) {
      if (!partial) throw error;
      return [];
    }
  });
}

export async function noteOptionContext(store: Store, task: Task, key: string, client: ReviewClient) {
  const notes = await taskNoteResults(task, store.items(task.id), store.runs().filter(run => run.taskId === task.id), client);
  const note = notes.find(note => note.key === key);
  if (!note?.round || !note.changes.length) throw new Error('This note has no linked changes.');
  const [detail, state] = await Promise.all([
    readRound(client, task, note.round),
    client.get<{ decisions: Record<string, string>; variants?: Record<string, string>; variantSpans?: Record<string, [number, number]>; latest: number; closed: boolean }>(`${taskRoute(task.name)}/state?round=${note.round}`),
  ]);
  const ids = new Set(note.changes.filter(change => change.round === note.round).flatMap(change => change.units)), units = detail.units.filter(unit => ids.has(unit.id));
  let locked: string | undefined;
  if (note.round !== state.latest || state.closed) locked = 'Options are available on the latest open review.';
  else if (note.changes.some(change => change.round !== note.round || change.state !== 'pending') || units.some(unit => state.decisions[unit.id] !== 'pending')) locked = 'This note includes a reviewed change. Undo that decision before replacing it.';
  else if (units.some(unit => unit.text_ops?.length !== 1 || unit.truncated || unit.whole_file || (unit.kind && unit.kind !== 'text'))) locked = 'Options are not available for this source range yet.';
  else if (task.status !== 'reviewing' || task.pendingReview || task.delivery?.pending || task.reconciliation) locked = 'Wait for the current task and review actions to finish.';
  const current: NoteOption = { id: 'current', label: 'Current proposal', edits: units.map(unit => ({ unit: unit.id, text: unit.new_text })) };
  // The wording in effect: an accepted option's, otherwise the proposal.
  const actual: NoteOption = {
    ...current,
    edits: units.map(unit => {
      const span = state.variantSpans?.[unit.id];
      return { unit: unit.id, text: state.variants?.[unit.id] ?? unit.new_text, ...(span?.[0] ? { before: span[0] } : {}), ...(span?.[1] ? { after: span[1] } : {}) };
    }),
  };
  const cacheKey = noteOptionsKey(task.id, key, note.round);
  let cached = store.preference<NoteOptions>(cacheKey);
  const origin = store.runs().find(run => run.id === note.itemId)?.noteRounds?.[note.index];
  if (!cached && origin) for (let number = note.round - 1; number >= origin; number--) {
    const previous = store.preference<NoteOptions>(noteOptionsKey(task.id, key, number));
    if (!previous) continue;
    const old = await readRound(client, task, number);
    const oldIds = new Set(previous.options.flatMap(option => option.edits.map(edit => edit.unit)));
    const original = { id: 'current', label: 'Initial proposal', edits: old.units.filter(unit => oldIds.has(unit.id)).map(unit => ({ unit: unit.id, text: unit.new_text })) };
    const choices = rebaseNoteOptions(previous.options.some(option => option.id === 'current') ? previous.options : [original, ...previous.options], old.units, units, Boolean(old.before && old.before === detail.before));
    if (choices.length) { cached = { ...previous, round: note.round, options: choices }; store.savePreference(cacheKey, cached); }
    break;
  }
  if (cached && !cached.options.some(option => option.id === 'current')) {
    const old = origin && origin < note.round ? await readRound(client, task, origin) : detail;
    const sameBase = Boolean(old.before && old.before === detail.before);
    const originalUnits = old.units.filter(unit => units.some(next => sameFragment(unit, next, sameBase)));
    const original = { id: 'current', label: 'Initial proposal', edits: originalUnits.map(unit => ({ unit: unit.id, text: unit.new_text })) };
    const initial = rebaseNoteOptions([original], old.units, units, sameBase);
    if (initial.length) { cached = { ...cached, options: [...initial, ...cached.options] }; store.savePreference(cacheKey, cached); }
  }
  const choices = cached?.options.filter(option => option.id === 'current' || (option.id !== 'latest' && typeof option.reason === 'string' && option.reason.trim())) || [current];
  const rejected = Object.keys(state.decisions).filter(id => state.decisions[id] === 'rejected').sort();
  const comparisonKey = createHash('sha256').update(JSON.stringify([detail.after, rejected])).digest('hex');
  const options: NoteOptions = { before: Object.fromEntries(units.map(unit => [unit.id, unit.old_text])), round: note.round, key, comparisonKey, ...selectedNoteOptions(choices.length ? choices : [current], actual), ...(locked ? { locked } : {}) };
  return { note, notes, units, options, detail, rejected };
}
