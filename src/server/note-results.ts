import type { NoteChange, NoteResult, NoteSummary, Run, Task, TimelineItem } from '../shared.ts';
import { noteAnchor, readNotesInstructions } from '../notes.ts';
import { taskRoute, type ReviewClient } from './review.ts';

// Only the fields needed to trace notes; the review engine owns the full format.
export interface NoteRound {
  round: number;
  units: { id: string; file: string; old_start: number; old_end: number; old_text: string; new_text: string }[];
  sections: { blocks: NoteBlock[] }[];
  loose: NoteBlock[];
}
interface NoteBlock { kind: string; units?: string[]; before?: { text?: { text: string }[] }[]; identical?: boolean }
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

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
    const matched = source.length ? source : textMatches ? sameFiles : region;
    if (!matched.length) return [];
    const states = new Set(matched.map(unit => decisions[unit.id] || 'pending'));
    const state = states.size === 1 ? [...states][0] : 'mixed';
    return [{ round: detail.round, stop, units: matched.map(unit => unit.id), state: (['accepted', 'rejected', 'commented', 'mixed'].includes(state) ? state : 'pending') as NoteChange['state'], match: source.length || region.length ? 'source' : 'quote' }];
  });
  // A short word needs a unique location. This also covers titles and macros:
  // SyncTeX may point at their use while the changed definition lives elsewhere.
  return quote.length < 8 && matches.filter(match => match.match === 'quote').length > 1 ? matches.filter(match => match.match === 'source') : matches;
}

export async function taskNoteResults(task: Task, items: TimelineItem[], runs: Run[], client: ReviewClient): Promise<NoteResult[]> {
  const byId = new Map(runs.map(run => [run.id, run]));
  const results: NoteResult[] = items.filter(item => item.type === 'user').flatMap(item => (item.meta?.notes || readNotesInstructions(item.text) || []).map((note, index) => {
    const run = byId.get(item.id), origin = noteAnchor(note).round || 0;
    // Older runs predate recorded round IDs. Only their finished review is a
    // fallback; a queued follow-up must never point at an earlier proposal.
    const legacy = (!run || run.status === 'completed') && !['running', 'queued', 'building', 'waiting_input'].includes(task.status) && (task.review?.round || 0) > origin;
    const round = run?.reviewRound !== undefined ? run.reviewRound || null : legacy ? task.review?.round || null : null;
    return { key: `${item.id}:${index}`, itemId: item.id, index, note, round, state: round ? 'unmatched' : run?.reviewRound === null ? 'unmatched' : 'waiting', changes: [] } as NoteResult;
  }));
  const rounds = [...new Set(results.flatMap(result => result.round ? [result.round] : []))];
  await Promise.all(rounds.map(async round => {
    const [detail, state] = await Promise.all([
      client.get<NoteRound>(`${taskRoute(task.name)}/rounds/${round}`),
      client.get<{ decisions: Record<string, string> }>(`${taskRoute(task.name)}/state?round=${round}`),
    ]);
    if (detail.round !== round || !Array.isArray(detail.units) || !Array.isArray(detail.sections) || !Array.isArray(detail.loose) || !state.decisions) throw new Error('The review could not be loaded. Try again.');
    for (const result of results.filter(result => result.round === round)) {
      result.changes = matchNoteChanges(result.note, detail, state.decisions);
      result.state = result.changes.length ? 'matched' : 'unmatched';
    }
  }));
  return results;
}
