import { textHunks } from './ot.ts';

// Who wrote which part of a synced file: the text each coauthor's edits put
// there, kept in place as the file changes. A span is [from, to) in the text
// it was carried to, the Overleaf user who wrote it, and when.

export interface Span { from: number; to: number; user: string; at: number }

/** The spans of `before`, moved to where their text is in `after`. Text
 *  removed takes its part of a span with it; text inserted belongs to no one,
 *  or to `user` when it is that user's edit. */
export function carry(before: string, after: string, spans: Span[], user?: string, at = Date.now()): Span[] {
  if (before === after) return spans;
  const hunks = textHunks(before, after);
  // Where a place in `before` is in `after`: inside removed text, at the
  // start of what replaced it.
  const place = (position: number) => {
    let shift = 0;
    for (const hunk of hunks) {
      if (position <= hunk.at) break;
      if (position < hunk.at + hunk.remove.length) return hunk.at + shift;
      shift += hunk.insert.length - hunk.remove.length;
    }
    return position + shift;
  };
  const inserted: [number, number][] = [];
  let shift = 0;
  for (const hunk of hunks) {
    if (hunk.insert) inserted.push([hunk.at + shift, hunk.at + shift + hunk.insert.length]);
    shift += hunk.insert.length - hunk.remove.length;
  }
  const moved: Span[] = [];
  for (const span of spans) {
    let from = place(span.from);
    const to = place(span.to);
    // What was inserted inside a span is not that span's author's.
    for (const [start, end] of inserted) {
      if (end <= from || start >= to) continue;
      if (start > from) moved.push({ ...span, from, to: start });
      from = Math.max(from, end);
    }
    if (to > from) moved.push({ ...span, from, to });
  }
  if (user) for (const [from, to] of inserted) moved.push({ from, to, user, at });
  return tidy(moved);
}

/** Spans in order, touching spans of one user joined. */
export function tidy(spans: Span[]): Span[] {
  const sorted = spans.filter(span => span.to > span.from).sort((a, b) => a.from - b.from || a.to - b.to), out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && last.user === span.user && span.from <= last.to) { last.to = Math.max(last.to, span.to); last.at = Math.max(last.at, span.at); }
    else out.push({ ...span });
  }
  return out;
}
