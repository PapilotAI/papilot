import type { NoteChange, NoteResult, NoteSummary, Run, Task, TimelineItem } from '../shared.ts';
import { noteAnchor, readNotesInstructions } from '../notes.ts';
import { taskRoute, type ReviewClient } from './review.ts';

// Only the fields needed to trace notes; the review engine owns the full format.
export interface NoteRound {
  round: number;
  units: { id: string; file: string; old_start: number; old_end: number; old_text: string; new_text: string; truncated?: boolean; whole_file?: boolean; kind?: string; text_ops?: [string, number, number, number, number][]; old_context?: { text: string; start: number } }[];
  sections: { blocks: NoteBlock[] }[];
  loose: NoteBlock[];
}
interface NoteBlock { kind: string; units?: string[]; before?: { text?: { text: string }[] }[]; identical?: boolean }
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Exact source offsets distinguish edits sharing one line and one PDF crop.
// Legacy rounds without these offsets retain their existing source association.
function quotedUnit(note: NoteSummary, unit: NoteRound['units'][number]): boolean | null {
  if (!unit.text_ops || !unit.old_context || !note.quote.trim()) return null;
  const { text, start } = unit.old_context, letters: number[] = [];
  let normalized = '';
  for (let i = 0; i < text.length; i++) {
    const part = normalize(text[i]);
    normalized += part;
    for (let j = 0; j < part.length; j++) letters.push(start + i);
  }
  const quote = normalize(note.quote), at = normalized.indexOf(quote);
  if (!quote || at < 0 || normalized.indexOf(quote, at + 1) >= 0) return null;
  const low = letters[at], high = letters[at + quote.length - 1] + 1;
  return unit.text_ops.some(([, a, b]) => a === b ? low <= a && a <= high : a < high && b > low);
}

export function matchNoteChanges(note: NoteSummary, detail: NoteRound, decisions: Record<string, string>): NoteChange[] {
  const anchor = noteAnchor(note), quote = normalize(note.quote);
  const units = new Map(detail.units.map(unit => [unit.id, unit]));
  const blocks = [...detail.sections.flatMap(section => section.blocks.filter(block => block.kind === 'change')), ...detail.loose];
  const matches = blocks.flatMap<NoteChange>((block, stop) => {
    const known = (block.units || []).map(id => units.get(id)).filter(unit => Boolean(unit) && unit!.old_text !== unit!.new_text) as NoteRound['units'];
    // Manuscript positions refer to the source before this revision. Review
    // selections refer to an older proposal, so prefer their actual PDF text.
    const source = anchor.round === undefined ? known.filter(unit => anchor.sources.some(place => place.file === unit.file && Math.max(place.lines[0], unit.old_start) <= Math.min(place.lines[1], unit.old_end))) : [];
    const sameFiles = anchor.sources.length ? known.filter(unit => anchor.sources.some(place => place.file === unit.file)) : known;
    const textMatches = quote.length >= 4 && sameFiles.length && (
      normalize((block.before || []).flatMap(strip => (strip.text || []).map(line => line.text)).join(' ')).includes(quote)
      || sameFiles.some(unit => normalize(unit.old_text).includes(quote))
    );
    // Region notes can lack text; their location is the remaining evidence.
    const region = !quote && anchor.round !== undefined ? sameFiles.filter(unit => anchor.sources.some(place => place.file === unit.file && Math.max(place.lines[0], unit.old_start) <= Math.min(place.lines[1], unit.old_end))) : [];
    const candidates = source.length ? source : textMatches ? sameFiles : region;
    const matched = candidates.filter(unit => quotedUnit(note, unit) !== false);
    if (!matched.length) return [];
    const states = new Set(matched.map(unit => decisions[unit.id] || 'pending'));
    const state = states.size === 1 ? [...states][0] : 'mixed';
    return [{ round: detail.round, stop, units: matched.map(unit => unit.id), state: (['accepted', 'rejected', 'commented', 'mixed'].includes(state) ? state : 'pending') as NoteChange['state'], match: source.length || region.length ? 'source' : 'quote' }];
  });
  // A short word needs a unique location. This also covers titles and macros:
  // SyncTeX may point at their use while the changed definition lives elsewhere.
  return quote.length < 8 && matches.filter(match => match.match === 'quote').length > 1 ? matches.filter(match => match.match === 'source') : matches;
}

export function sameFragment(previous: NoteRound['units'][number], next: NoteRound['units'][number]) {
  if (previous.file !== next.file || previous.old_text !== next.old_text) return false;
  if (!previous.old_context || !next.old_context || !previous.text_ops || !next.text_ops) return true;
  const surroundings = (unit: NoteRound['units'][number]) => {
    const { text, start } = unit.old_context!, [, a, b] = unit.text_ops![0];
    return [normalize(text.slice(Math.max(0, a - start - 32), a - start)).slice(-12), normalize(text.slice(b - start, b - start + 32)).slice(0, 12)];
  };
  const before = surroundings(previous), after = surroundings(next);
  return before.some((text, i) => text.length >= 8 && text === after[i]);
}

export async function taskNoteResults(task: Task, items: TimelineItem[], runs: Run[], client: ReviewClient): Promise<NoteResult[]> {
  const byId = new Map(runs.map(run => [run.id, run]));
  const results: NoteResult[] = items.filter(item => item.type === 'user').flatMap(item => (item.meta?.notes || readNotesInstructions(item.text) || []).map((note, index) => {
    const run = byId.get(item.id), origin = noteAnchor(note).round || 0;
    // Older runs predate recorded round IDs. Only their finished review is a
    // fallback; a queued follow-up must never point at an earlier proposal.
    const legacy = (!run || run.status === 'completed') && !['running', 'queued', 'building', 'waiting_input'].includes(task.status) && (task.review?.round || 0) > origin;
    const round = run?.noteRounds?.[index] ?? (run?.reviewRound !== undefined ? run.reviewRound || null : legacy ? task.review?.round || null : null);
    return { key: `${item.id}:${index}`, itemId: item.id, index, note, round, state: round ? 'unmatched' : run?.reviewRound === null ? 'unmatched' : 'waiting', changes: [] } as NoteResult;
  }));
  const contexts = new Map<number, Promise<{ detail: NoteRound; decisions: Record<string, string> }>>();
  const read = (round: number) => {
    if (!contexts.has(round)) contexts.set(round, Promise.all([
      client.get<NoteRound>(`${taskRoute(task.name)}/rounds/${round}`),
      client.get<{ decisions: Record<string, string> }>(`${taskRoute(task.name)}/state?round=${round}`),
    ]).then(([detail, state]) => {
      if (detail.round !== round || !Array.isArray(detail.units) || !Array.isArray(detail.sections) || !Array.isArray(detail.loose) || !state.decisions) throw new Error('The review could not be loaded. Try again.');
      return { detail, decisions: state.decisions };
    }));
    return contexts.get(round)!;
  };
  await Promise.all(results.map(async result => {
    if (!result.round) return;
    const origin = result.round, { detail, decisions } = await read(origin);
    result.changes = matchNoteChanges(result.note, detail, decisions);
    const run = byId.get(result.itemId), latest = run?.reviewRound || origin;
    if (run?.noteRounds?.[result.index] && latest > origin) {
      // Options revise the proposal, while accepted/rejected fragments keep
      // their original decisions. Follow remaining exact fragments through
      // the intervening rounds without re-matching a whole source line.
      const ids = new Set(result.changes.flatMap(change => change.units));
      const tracked = detail.units.filter(unit => ids.has(unit.id)).map(unit => ({ unit, round: origin, state: decisions[unit.id] || 'pending' }));
      for (let number = origin + 1; number <= latest && tracked.some(item => item.state === 'pending'); number++) {
        const next = await read(number);
        for (const item of tracked.filter(item => item.state === 'pending')) {
          const matches = next.detail.units.filter(unit => sameFragment(item.unit, unit));
          // Repeated fragments are ambiguous. Keep the historical link rather
          // than associate an unrelated change or revive a reviewed choice.
          if (matches.length !== 1) continue;
          item.unit = matches[0]; item.round = number; item.state = next.decisions[item.unit.id] || 'pending';
        }
      }
      result.changes = [];
      for (const number of [...new Set(tracked.map(item => item.round))].sort((a, b) => b - a)) {
        const shown = await read(number), blocks = [...shown.detail.sections.flatMap(section => section.blocks.filter(block => block.kind === 'change')), ...shown.detail.loose];
        blocks.forEach((block, stop) => {
          const members = tracked.filter(item => item.round === number && block.units?.includes(item.unit.id));
          if (!members.length) return;
          const states = new Set(members.map(item => item.state));
          result.changes.push({ round: number, stop, units: members.map(item => item.unit.id), state: (states.size === 1 ? [...states][0] : 'mixed') as NoteChange['state'], match: 'source' });
        });
      }
      result.round = result.changes[0]?.round || origin;
    }
    result.state = result.changes.length ? 'matched' : 'unmatched';
  }));
  return results;
}
