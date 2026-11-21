import type { NoteChange, NoteResult, NoteSummary, Run, Task, TimelineItem } from '../shared.ts';
import { noteAnchor, readNotesInstructions } from '../notes.ts';
import { taskRoute, type ReviewClient } from './review.ts';
import type { Op } from '../../engine/src/types.ts';

// Only the fields needed to trace notes; the review engine owns the full format.
export interface NoteRound {
  round: number;
  before?: string;
  after?: string;
  units: NoteUnit[];
  proposal_edits?: Record<string, Op[]>;
  sections: { blocks: NoteBlock[] }[];
  loose: NoteBlock[];
}
type NoteStrip = { text?: { text: string }[] };
type NoteContext = { text: string; start: number; source_hash?: string };
interface NoteBlock { kind: string; units?: string[]; before?: NoteStrip[]; after?: NoteStrip[]; identical?: boolean }
interface NoteUnit {
  id: string;
  hash?: string;
  file: string;
  old_start: number;
  old_end: number;
  new_start?: number;
  old_text: string;
  new_text: string;
  truncated?: boolean;
  whole_file?: boolean;
  kind?: string;
  formattingFor?: string;
  text_ops?: Op[];
  old_context?: NoteContext;
  new_context?: NoteContext;
  continued_ranges?: [number, number][];
}
const changeBlocks = (detail: NoteRound) => [...detail.sections.flatMap(section => section.blocks.filter(block => block.kind === 'change')), ...detail.loose];
const renderedQuote = (strips: NoteStrip[] | undefined, quote: string) => normalize((strips || []).flatMap(strip => (strip.text || []).map(line => line.text)).join(' ')).includes(quote);
const GENERATED = '\x01';
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Project printable arguments to source offsets. Unknown commands and their
// arguments remain boundaries. Citations and inline math can only stand for
// generated text when the actual PDF and a source location corroborate it.
function quoteSource(text: string, start: number, literalMath = false): { normalized: string; letters: number[]; ends: number[]; hasMath: boolean } {
  const letters: number[] = [];
  const ends: number[] = [];
  let normalized = '', hasMath = false;
  const marker = (value: string, offset: number) => {
    normalized += value;
    letters.push(start + offset);
    ends.push(start + offset);
  };
  const nextGroup = (offset: number) => offset + (text.slice(offset).match(/^\s*/)?.[0].length || 0);
  const groupEnd = (offset: number) => {
    const open = text[offset], close = open === '{' ? '}' : ']';
    let depth = 1, i = offset + 1;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return i + 1;
    }
    return text.length;
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === '%') { marker('\0', i); const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue; }
    const math = text[i] === '$' && text[i - 1] !== '$' ? text.slice(i).match(/^\$(?!\$)(?:\\[^\n]|[^$\\\n])+\$/)?.[0]
      : text.startsWith('\\(', i) ? text.slice(i).match(/^\\\((?:\\(?!\))[^\n]|[^\\\n])*\\\)/)?.[0] : undefined;
    if (math) {
      hasMath = true;
      if (literalMath) {
        const delimiter = text[i] === '$' ? 1 : 2;
        const expression = quoteSource(math.slice(delimiter, -delimiter), start + i + delimiter, true);
        normalized += expression.normalized;
        for (let offset = 0; offset < expression.letters.length; offset++) {
          letters.push(expression.letters[offset]);
          ends.push(expression.ends[offset]);
        }
      } else {
        marker(GENERATED, i);
        ends[ends.length - 1] = start + i + math.length;
      }
      i += math.length;
      continue;
    }
    if (text[i] === '\\') {
      const offset = i, command = text.slice(i).match(/^\\(?:[a-zA-Z@]+\*?|[^])/u)?.[0] || '\\';
      i += command.length;
      if (/^\\[%&#_$^~{}]$/.test(command)) continue;
      if (/^\\(?:emph|textbf|textit|textrm|textsf|texttt|textsc|textsl|textup|textnormal|underline|mbox)$/.test(command) && text[nextGroup(i)] === '{') continue;
      if (/^\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title|caption|href)\*?$/.test(command)) {
        let arg = nextGroup(i);
        if (text[arg] === '[') arg = nextGroup(groupEnd(arg));
        if (command === '\\href' && text[arg] === '{') arg = nextGroup(groupEnd(arg));
        if (text[arg] === '{') { i = arg + 1; continue; }
      }
      const generated = /^\\(?:cite|citep|citet|parencite|textcite|autocite)\*?$/.test(command);
      marker(generated ? GENERATED : '\0', offset);
      for (;;) {
        const next = nextGroup(i);
        if (text[next] !== '{' && text[next] !== '[') break;
        i = groupEnd(next);
        if (generated && text[next] === '{') break;
      }
      ends[ends.length - 1] = start + i;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(i)!), part = normalize(char);
    normalized += part;
    for (let j = 0; j < part.length; j++) {
      letters.push(start + i);
      ends.push(start + i + char.length);
    }
    i += char.length;
  }
  return { normalized, letters, ends, hasMath };
}

type QuoteRange = { low: number; high: number };

// Track reachable quote positions so generated spans can vary in length, and
// retain all possible source ranges for the same-line ambiguity check.
function generatedRanges(source: ReturnType<typeof quoteSource>, quote: string, onLine: (range: QuoteRange) => boolean) {
  const { normalized, letters, ends } = source;
  const candidates: (QuoteRange & { literal: number })[] = [];
  for (let start = 0; start < normalized.length; start++) {
    if (normalized[start] !== quote[0] && normalized[start] !== GENERATED) continue;
    let positions = [0], hasGenerated = false, literal = 0, best: typeof candidates = [];
    for (let end = start; end < normalized.length && positions.length; end++) {
      const token = normalized[end];
      if (token === '\0') break;
      if (token === GENERATED) {
        if (!onLine({ low: letters[start], high: ends[end] })) break;
        const first = positions[0] + Number(start === end);
        if (first >= quote.length) break;
        hasGenerated = true;
        // positions are sorted; this span can consume any suffix after the
        // earliest position, including a symbol with no normalized letters.
        positions = Array.from({ length: quote.length - first + 1 }, (_, i) => first + i);
      } else {
        literal++;
        positions = positions.filter(position => quote[position] === token).map(position => position + 1);
      }
      if (hasGenerated && literal >= 4 && positions.at(-1) === quote.length) {
        const range = { low: letters[start], high: ends[end], literal };
        if (!onLine(range)) continue;
        // Prefer a match that accounts for more of the PDF quote literally.
        // A citation in mid-sentence cannot swallow the remaining prose.
        if (literal > (best[0]?.literal ?? 0)) best = [];
        if (best.length < 2) best.push(range);
      }
    }
    candidates.push(...best);
  }
  const first = candidates.sort((a, b) => b.literal - a.literal)[0];
  if (!first) return [];
  const contains = (a: QuoteRange, b: QuoteRange) => a.low <= b.low && a.high >= b.high;
  // Extra literal text disambiguates alternatives at the same passage only.
  // It cannot choose between two different occurrences of the same quote.
  const other = candidates.find(range => (range.low !== first.low || range.high !== first.high)
    && (range.literal === first.literal || !(contains(first, range) || contains(range, first))));
  return other ? [first, other] : [first];
}

// Exact source offsets distinguish edits sharing one line and one PDF crop.
// Legacy rounds without these offsets retain their existing source association.
function sourceQuote(note: NoteSummary, unit: NoteUnit, proposed: boolean, inPdf: boolean, requireLocation = proposed): QuoteRange | 'ambiguous' | null | undefined {
  const context = proposed ? unit.new_context : unit.old_context;
  if (!unit.text_ops?.length || !context || !note.quote.trim()) return undefined;
  const quote = normalize(note.quote);
  if (!quote) return null;
  const { text, start } = context, source = quoteSource(text, start);
  // Simple mathematics can reproduce the PDF selection literally, down to
  // an individual operand. Opaque commands still cannot supply a match.
  const { normalized, letters, ends } = inPdf && source.hasMath ? quoteSource(text, start, true) : source;
  let occurrences: QuoteRange[] = [];
  for (let at = normalized.indexOf(quote); at >= 0; at = normalized.indexOf(quote, at + 1)) {
    occurrences.push({ low: letters[at], high: ends[at + quote.length - 1] });
  }
  const anchor = noteAnchor(note), from = proposed ? 3 : 1;
  const origin = unit.text_ops[0][from], line = proposed ? unit.new_start : unit.old_start;
  const places = (proposed || anchor.round === undefined) && line !== undefined && origin >= start && origin <= start + text.length
    ? anchor.sources.filter(place => place.file === unit.file) : [];
  const newlines = (a: number, b: number) => (text.slice(a - start, b - start).match(/\n/g) || []).length;
  const lineAt = (offset: number) => line! + (offset < origin ? -newlines(offset, origin) : newlines(origin, offset));
  if (occurrences.length > 1 || requireLocation) {
    // An earlier review's source lines only apply to its own revision.
    occurrences = occurrences.filter(({ low, high }) => places.some(place => Math.max(place.lines[0], lineAt(low)) <= Math.min(place.lines[1], lineAt(high - 1))));
  }
  if (inPdf && places.length && source.normalized.includes(GENERATED)) {
    const generated = generatedRanges(source, quote, ({ low, high }) => places.some(place => place.lines[0] <= lineAt(low) && lineAt(high - 1) <= place.lines[1]));
    occurrences.push(...generated.filter(range => !occurrences.some(exact => range.low <= exact.low && exact.high <= range.high)));
  }
  return occurrences.length > 1 ? 'ambiguous' : occurrences[0] ?? null;
}

const touchesQuote = ({ low, high }: QuoteRange, a: number, b: number) =>
  a === b ? low <= a && a <= high : a < high && b > low;

export function matchNoteChanges(note: NoteSummary, detail: NoteRound, decisions: Record<string, string>, continued?: Set<string>): NoteChange[] {
  const anchor = noteAnchor(note), quote = normalize(note.quote);
  const units = new Map(detail.units.map(unit => [unit.id, unit]));
  const blocks = changeBlocks(detail);
  let ambiguousSource = false;
  const matches = blocks.flatMap<NoteChange>((block, stop) => {
    const known = (block.units || []).map(id => units.get(id)).filter(unit => Boolean(unit) && unit!.old_text !== unit!.new_text) as NoteRound['units'];
    // Manuscript positions refer to the source before this revision. Review
    // selections refer to an older proposal, so prefer their actual PDF text.
    const source = anchor.round === undefined ? known.filter(unit => anchor.sources.some(place => place.file === unit.file && Math.max(place.lines[0], unit.old_start) <= Math.min(place.lines[1], unit.old_end))) : [];
    const sameFiles = anchor.sources.length ? known.filter(unit => anchor.sources.some(place => place.file === unit.file)) : known;
    const inPdf = Boolean(quote) && renderedQuote(block.before, quote);
    const textMatches = quote.length >= 4 && sameFiles.length && (inPdf || sameFiles.some(unit => normalize(unit.old_text).includes(quote)));
    // Region notes can lack text; their location is the remaining evidence.
    const region = !quote && anchor.round !== undefined ? sameFiles.filter(unit => anchor.sources.some(place => place.file === unit.file && Math.max(place.lines[0], unit.old_start) <= Math.min(place.lines[1], unit.old_end))) : [];
    const candidates = source.length ? source : textMatches ? sameFiles : region;
    const matched = continued ? known.filter(unit => continued.has(unit.id)) : candidates.filter(unit => {
      const range = sourceQuote(note, unit, false, inPdf, Boolean(source.length));
      if (range === 'ambiguous') { ambiguousSource ||= source.length > 0; return false; }
      // Older rounds lack exact offsets and retain their source association.
      return range === undefined || Boolean(range && unit.text_ops!.some(([, a, b]) => touchesQuote(range, a, b)));
    });
    // The engine verifies these as invisible wrapping of the same paragraph.
    // A note decision includes its formatting so no empty pending card remains.
    const matchedIds = new Set(matched.map(unit => unit.id));
    matched.push(...known.filter(unit => unit.formattingFor && matchedIds.has(unit.formattingFor) && !matchedIds.has(unit.id)));
    if (!matched.length) return [];
    const states = new Set(matched.map(unit => decisions[unit.id] || 'pending'));
    const state = states.size === 1 ? [...states][0] : 'mixed';
    return [{ round: detail.round, stop, units: matched.map(unit => unit.id), state: (['accepted', 'rejected', 'commented', 'mixed'].includes(state) ? state : 'pending') as NoteChange['state'], match: continued || source.length || region.length ? 'source' : 'quote' }];
  });
  // A short word needs a unique location. This also covers titles and macros:
  // SyncTeX may point at their use while the changed definition lives elsewhere.
  return ambiguousSource || matches.some(match => match.match === 'source') || (quote.length < 8 && matches.filter(match => match.match === 'quote').length > 1)
    ? matches.filter(match => match.match === 'source') : matches;
}

export function sameFragment(previous: NoteRound['units'][number], next: NoteRound['units'][number], sameBase = false) {
  if (previous.file !== next.file || previous.old_text !== next.old_text) return false;
  const sameSource = sameBase || Boolean(previous.old_context?.source_hash && previous.old_context.source_hash === next.old_context?.source_hash);
  if (sameSource && previous.text_ops && next.text_ops) return previous.text_ops.length === next.text_ops.length && previous.text_ops.every((op, index) => op[1] === next.text_ops![index][1] && op[2] === next.text_ops![index][2]);
  if (!previous.old_context || !next.old_context || !previous.text_ops || !next.text_ops) return true;
  const surroundings = (unit: NoteRound['units'][number]) => {
    const { text, start } = unit.old_context!, [, a, b] = unit.text_ops![0];
    return [normalize(text.slice(Math.max(0, a - start - 32), a - start)).slice(-12), normalize(text.slice(b - start, b - start + 32)).slice(0, 12)];
  };
  const before = surroundings(previous), after = surroundings(next);
  return before.some((text, i) => text.length >= 8 && text === after[i]);
}

// A round's detail is the largest read here (about 0.6 MB for a thesis
// chapter), and opening a review asks for every note's options and previews
// at once, each of which read it, often twice. A rendered round no longer
// changes, so its detail is shared for a short while; one still rendering is
// always read afresh.
const ROUND_REUSE = 30000;
const rounds = new Map<string, { at: number; detail: Promise<NoteRound> }>();
export function readRound(client: ReviewClient, task: Pick<Task, 'name'>, round: number, proposedFor?: number): Promise<NoteRound> {
  const route = `${taskRoute(task.name)}/rounds/${round}${proposedFor ? '?proposedFor=' + proposedFor : ''}`;
  const key = client.url + route, now = Date.now(), kept = rounds.get(key);
  if (kept && now - kept.at < ROUND_REUSE) return kept.detail;
  for (const [old, entry] of rounds) if (now - entry.at >= ROUND_REUSE) rounds.delete(old);
  const detail = client.get<NoteRound>(route);
  rounds.set(key, { at: now, detail });
  // Only a finished rendering is shared; a failed read is never kept.
  detail.then(value => { if (!value || (value as { rendering?: string }).rendering) rounds.delete(key); }, () => rounds.delete(key));
  return detail;
}

// Translate selected text that still exists in the new baseline. Ranges that
// were replaced in the meantime need the separate pending-proposal match.
function translatedQuote({ low, high }: QuoteRange, edits: Op[]) {
  const ranges: QuoteRange[] = [];
  let start = low, shift = 0;
  for (const [, a, b, , end] of edits) {
    if (a >= high) break;
    if (start < a) ranges.push({ low: start + shift, high: a + shift });
    start = Math.max(start, b);
    shift = end - b;
  }
  if (start < high) ranges.push({ low: start + shift, high: high + shift });
  return ranges;
}

function continuedProposal(note: NoteSummary, previous: NoteRound, detail: NoteRound): Set<string> | undefined {
  const quote = normalize(note.quote), previousBlocks = changeBlocks(previous);
  const files = new Set(noteAnchor(note).sources.map(place => place.file));
  let ambiguous = false;
  const selected = previous.units.flatMap(unit => {
    if (!files.has(unit.file) || !unit.new_context) return [];
    const range = sourceQuote(note, unit, true, previousBlocks.some(block => block.units?.includes(unit.id) && renderedQuote(block.after, quote)));
    if (range === 'ambiguous') { ambiguous = true; return []; }
    return range ? [{ unit, range }] : [];
  });
  if (ambiguous) return new Set();
  if (!selected.length) return undefined;
  // A resolved proposal is the reference. The same words elsewhere in the
  // latest baseline cannot substitute for that location.
  const continued = new Set<string>();
  for (const { unit, range } of selected) {
    const edits = previous.proposal_edits?.[unit.file];
    const accepted = edits ? translatedQuote(range, edits) : [];
    const inFile = detail.units.filter(next => unit.file === next.file && next.text_ops?.length);
    for (const next of inFile) {
      if (next.text_ops!.some(([, a, b]) => accepted.some(range => touchesQuote(range, a, b)))) continued.add(next.id);
    }
    if (!unit.text_ops!.some(([, , , a, b]) => touchesQuote(range, a, b))) continue;
    const pending = inFile.filter(next => {
      const ranges = unit.continued_ranges;
      return next.old_text === unit.old_text && next.new_text !== unit.new_text
        && ranges?.length === next.text_ops!.length && ranges.every(([a, b], i) => next.text_ops![i][1] === a && next.text_ops![i][2] === b);
    });
    if (pending.length === 1) continued.add(pending[0].id);
  }
  return continued;
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
      readRound(client, task, round),
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
    const anchor = noteAnchor(result.note);
    let continued: Set<string> | undefined;
    if (anchor.round && anchor.round < origin && anchor.sources.length && result.note.quote.trim()
      && !result.note.where.split(' · ').some(part => part === 'Before' || part === 'Paper as decided' || part === 'Unchanged text')) {
      const previous = await readRound(client, task, anchor.round, origin);
      continued = continuedProposal(result.note, previous, detail);
    }
    result.changes = matchNoteChanges(result.note, detail, decisions, continued);
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
          const previous = await read(item.round);
          const matches = next.detail.units.filter(unit => sameFragment(item.unit, unit, Boolean(previous.detail.before && previous.detail.before === next.detail.before)));
          // Repeated fragments are ambiguous. Keep the historical link rather
          // than associate an unrelated change or revive a reviewed choice.
          if (matches.length !== 1) continue;
          item.unit = matches[0]; item.round = number; item.state = next.decisions[item.unit.id] || 'pending';
        }
      }
      result.changes = [];
      for (const number of [...new Set(tracked.map(item => item.round))].sort((a, b) => b - a)) {
        const shown = await read(number), blocks = changeBlocks(shown.detail);
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

// Unit IDs belong to a single round. For a pending change the engine carried
// forward, its version hash identifies the same text and surrounding context.
export async function notesForRejection(task: Task, client: ReviewClient, notes: NoteResult[], round: number, changes: string[], key?: string) {
  const rejected = new Set(changes);
  if (key) {
    const note = notes.find(note => note.key === key);
    const units = new Set(note?.changes.filter(change => change.round === round).flatMap(change => change.units));
    if (!note || !rejected.size || changes.some(id => !units.has(id))) throw new Error('The review changed. Reload the options.');
    return [note];
  }
  const originals = notes.filter(note => note.note.id && !note.note.anchor?.round);
  const linked = new Set(originals.filter(note => note.changes.some(change => change.round === round && change.units.some(id => rejected.has(id)))));
  const historical = originals.filter(note => !linked.has(note));
  const earlier = new Set(historical.flatMap(note => note.changes.filter(change => change.round < round && ['pending', 'mixed'].includes(change.state)).map(change => change.round)));
  if (earlier.size && rejected.size) {
    const uniqueHashes = (detail: NoteRound) => {
      const hashes = new Map<string, string | null>();
      for (const { id, hash } of detail.units) if (hash) hashes.set(hash, hashes.has(hash) ? null : id);
      return hashes;
    };
    const target = uniqueHashes(await readRound(client, task, round));
    const hashes = [...target].filter(([, id]) => id && rejected.has(id)).map(([hash]) => hash);
    await Promise.all([...earlier].map(async number => {
      const [origin, state] = await Promise.all([readRound(client, task, number),
        client.get<{ decisions: Record<string, string> }>(`${taskRoute(task.name)}/state?round=${number}`)]);
      const byHash = uniqueHashes(origin);
      const ids = new Set(hashes.map(hash => byHash.get(hash)).filter(id => id && state.decisions[id] === 'pending'));
      for (const note of historical) if (note.changes.some(change => change.round === number && change.units.some(id => ids.has(id)))) linked.add(note);
    }));
  }
  return originals.filter(note => linked.has(note));
}
