import { diffChars, diffLines } from 'diff';

// Overleaf keeps each text file of a project as one of two operational
// transformation types, and its document updater transforms every incoming
// edit against the ones it has not seen. Papilot's transforms must match the
// server's exactly, including which of two inserts at the same place comes
// first, or its copy of a file drifts from Overleaf's.

/* ShareJS text type ("sharejs-text-ot"), ported from the version Overleaf's
 * document updater runs. Copyright 2011 Joseph Gentle, 2012-2024 Overleaf.
 * MIT License: https://github.com/overleaf/overleaf/blob/main/services/document-updater/app/js/sharejs/LICENSE */
export type TextComponent = { p: number; i: string } | { p: number; d: string } | { p: number; c: string; t: string };
export type TextOp = TextComponent[];
const isInsert = (c: TextComponent): c is { p: number; i: string } => typeof (c as { i?: unknown }).i === 'string';
const isDelete = (c: TextComponent): c is { p: number; d: string } => typeof (c as { d?: unknown }).d === 'string';
const inject = (text: string, at: number, insert: string) => text.slice(0, at) + insert + text.slice(at);

export function applyText(snapshot: string, op: TextOp) {
  for (const c of op) {
    if (isInsert(c)) {
      if (c.p > snapshot.length) throw new Error('Insert beyond the end of the document.');
      snapshot = inject(snapshot, c.p, c.i);
    } else if (isDelete(c)) {
      if (snapshot.slice(c.p, c.p + c.d.length) !== c.d) throw new Error('Delete does not match the document.');
      snapshot = snapshot.slice(0, c.p) + snapshot.slice(c.p + c.d.length);
    } else if (snapshot.slice(c.p, c.p + c.c.length) !== c.c) throw new Error('Comment does not match the document.');
  }
  return snapshot;
}
function append(op: TextOp, c: TextComponent) {
  if ((isInsert(c) && c.i === '') || (isDelete(c) && c.d === '')) return;
  const last = op[op.length - 1];
  if (last && isInsert(last) && isInsert(c) && last.p <= c.p && c.p <= last.p + last.i.length) op[op.length - 1] = { i: inject(last.i, c.p - last.p, c.i), p: last.p };
  else if (last && isDelete(last) && isDelete(c) && c.p <= last.p && last.p <= c.p + c.d.length) op[op.length - 1] = { d: inject(c.d, last.p - c.p, last.d), p: c.p };
  else op.push(c);
}
function transformPosition(position: number, c: TextComponent, insertAfter = false) {
  if (isInsert(c)) return c.p < position || (c.p === position && insertAfter) ? position + c.i.length : position;
  if (isDelete(c)) return position <= c.p ? position : position <= c.p + c.d.length ? c.p : position - c.d.length;
  return position;
}
type Side = 'left' | 'right';
function transformComponent(dest: TextOp, c: TextComponent, other: TextComponent, side: Side) {
  if (isInsert(c)) { append(dest, { i: c.i, p: transformPosition(c.p, other, side === 'right') }); return dest; }
  if (isDelete(c)) {
    if (isInsert(other)) {
      let s = c.d;
      if (c.p < other.p) { append(dest, { d: s.slice(0, other.p - c.p), p: c.p }); s = s.slice(other.p - c.p); }
      if (s !== '') append(dest, { d: s, p: c.p + other.i.length });
    } else if (isDelete(other)) {
      if (c.p >= other.p + other.d.length) append(dest, { d: c.d, p: c.p - other.d.length });
      else if (c.p + c.d.length <= other.p) append(dest, c);
      else {
        const next = { d: '', p: c.p };
        if (c.p < other.p) next.d = c.d.slice(0, other.p - c.p);
        if (c.p + c.d.length > other.p + other.d.length) next.d += c.d.slice(other.p + other.d.length - c.p);
        const start = Math.max(c.p, other.p), end = Math.min(c.p + c.d.length, other.p + other.d.length);
        if (c.d.slice(start - c.p, end - c.p) !== other.d.slice(start - other.p, end - other.p)) throw new Error('Delete ops delete different text in the same region of the document.');
        if (next.d !== '') { next.p = transformPosition(next.p, other); append(dest, next); }
      }
    } else append(dest, c);
    return dest;
  }
  // A comment moves with the text around it and grows with text typed inside it.
  if (isInsert(other)) {
    if (c.p < other.p && other.p < c.p + c.c.length) append(dest, { c: c.c.slice(0, other.p - c.p) + other.i + c.c.slice(other.p - c.p), p: c.p, t: c.t });
    else append(dest, { c: c.c, p: transformPosition(c.p, other, true), t: c.t });
  } else if (isDelete(other)) {
    if (c.p >= other.p + other.d.length) append(dest, { c: c.c, p: c.p - other.d.length, t: c.t });
    else if (c.p + c.c.length <= other.p) append(dest, c);
    else {
      const next = { c: '', p: c.p, t: c.t };
      if (c.p < other.p) next.c = c.c.slice(0, other.p - c.p);
      if (c.p + c.c.length > other.p + other.d.length) next.c += c.c.slice(other.p + other.d.length - c.p);
      next.p = transformPosition(next.p, other);
      append(dest, next);
    }
  } else append(dest, c);
  return dest;
}
/** Both sides of a concurrent pair: left as if right came first, and right
 *  as if left came first. The server takes incoming edits as left. */
export function transformTextX(leftOp: TextOp, rightOp: TextOp): [TextOp, TextOp] {
  const newRight: TextOp = [];
  for (const right of rightOp) {
    let current: TextComponent | null = right;
    const newLeft: TextOp = [];
    let k = 0;
    while (k < leftOp.length) {
      const next: TextOp = [];
      transformComponent(newLeft, leftOp[k], current!, 'left');
      transformComponent(next, current!, leftOp[k], 'right');
      k++;
      if (next.length === 1) current = next[0];
      else if (next.length === 0) { for (const l of leftOp.slice(k)) append(newLeft, l); current = null; break; }
      else {
        const [l, r] = transformTextX(leftOp.slice(k), next);
        for (const c of l) append(newLeft, c);
        for (const c of r) append(newRight, c);
        current = null; break;
      }
    }
    if (current) append(newRight, current);
    leftOp = newLeft;
  }
  return [leftOp, newRight];
}
/* End of the ShareJS port. */

// "history-ot": the operations of Overleaf's history (overleaf-editor-core).
// A file is its content, including text a track-changes deletion only marks,
// and a TextOperation retains, inserts and removes over all of it.
type Tracking = { type: 'insert' | 'delete'; userId: string; ts: string } | { type: 'none' };
export type RawScan = number | string | { r: number; tracking?: Tracking; commentIds?: string[] } | { i: string; tracking?: Tracking; commentIds?: string[] };
export type RawTextOperation = { textOperation: RawScan[]; contentHash?: string };
export type RawEditOperation = RawTextOperation | Record<string, unknown>;
export type StringFileRaw = { content: string; comments?: unknown[]; trackedChanges?: { range: { pos: number; length: number }; tracking: { type: 'insert' | 'delete' } }[] };
type Scan = { kind: 'retain'; n: number; tracking?: Tracking; commentIds?: string[] } | { kind: 'insert'; s: string; tracking?: Tracking; commentIds?: string[] } | { kind: 'remove'; n: number };

export const isTextOperation = (op: RawEditOperation): op is RawTextOperation => Boolean(op) && Array.isArray((op as RawTextOperation).textOperation);
function scans(op: RawTextOperation): Scan[] {
  return op.textOperation.map(raw => {
    if (typeof raw === 'number') return raw > 0 ? { kind: 'retain', n: raw } : { kind: 'remove', n: -raw };
    if (typeof raw === 'string') return { kind: 'insert', s: raw };
    if ('r' in raw) return { kind: 'retain', n: raw.r, tracking: raw.tracking, commentIds: raw.commentIds };
    return { kind: 'insert', s: raw.i, tracking: raw.tracking, commentIds: raw.commentIds };
  });
}
// Builds an operation the way overleaf-editor-core does: neighbours of the
// same kind and properties merge, and an insert goes before a remove.
class Builder {
  ops: Scan[] = [];
  retain(n: number, tracking?: Tracking, commentIds?: string[]) {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === 'retain' && same(last.tracking, tracking) && same(last.commentIds, commentIds)) last.n += n;
    else this.ops.push({ kind: 'retain', n, ...(tracking ? { tracking } : {}), ...(commentIds ? { commentIds } : {}) });
    return this;
  }
  insert(s: string, tracking?: Tracking, commentIds?: string[]) {
    if (!s) return this;
    const last = this.ops[this.ops.length - 1], before = this.ops[this.ops.length - 2];
    if (last?.kind === 'insert' && same(last.tracking, tracking) && same(last.commentIds, commentIds)) last.s += s;
    else if (last?.kind === 'remove') {
      if (before?.kind === 'insert' && same(before.tracking, tracking) && same(before.commentIds, commentIds)) before.s += s;
      else this.ops.splice(this.ops.length - 1, 0, { kind: 'insert', s, ...(tracking ? { tracking } : {}), ...(commentIds ? { commentIds } : {}) });
    } else this.ops.push({ kind: 'insert', s, ...(tracking ? { tracking } : {}), ...(commentIds ? { commentIds } : {}) });
    return this;
  }
  remove(n: number) {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === 'remove') last.n += n; else this.ops.push({ kind: 'remove', n });
    return this;
  }
  raw(): RawTextOperation {
    return { textOperation: this.ops.map(op => op.kind === 'remove' ? -op.n
      : op.kind === 'retain' ? op.tracking || op.commentIds ? { r: op.n, ...(op.tracking ? { tracking: op.tracking } : {}), ...(op.commentIds ? { commentIds: op.commentIds } : {}) } : op.n
      : op.tracking || op.commentIds ? { i: op.s, ...(op.tracking ? { tracking: op.tracking } : {}), ...(op.commentIds ? { commentIds: op.commentIds } : {}) } : op.s) };
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A history-ot file: its content and which characters a tracked deletion hides. */
export interface TrackedText { content: string; deleted: Uint8Array }
export function trackedText(raw: StringFileRaw): TrackedText {
  const deleted = new Uint8Array(raw.content.length);
  for (const change of raw.trackedChanges || []) if (change.tracking?.type === 'delete') deleted.fill(1, change.range.pos, change.range.pos + change.range.length);
  return { content: raw.content, deleted };
}
/** The text a compile sees, without tracked deletions. */
export function visibleText(text: TrackedText) {
  let out = '', start = -1;
  for (let i = 0; i <= text.content.length; i++) {
    const shown = i < text.content.length && !text.deleted[i];
    if (shown && start < 0) start = i;
    else if (!shown && start >= 0) { out += text.content.slice(start, i); start = -1; }
  }
  return out;
}
export function applyHistory(text: TrackedText, op: RawEditOperation): TrackedText {
  if (!isTextOperation(op)) return text;
  let cursor = 0, content = '';
  const flags: number[] = [];
  for (const scan of scans(op)) {
    if (scan.kind === 'insert') {
      content += scan.s;
      for (let i = 0; i < scan.s.length; i++) flags.push(scan.tracking?.type === 'delete' ? 1 : 0);
    } else if (scan.kind === 'remove') {
      if (cursor + scan.n > text.content.length) throw new Error('Remove beyond the end of the document.');
      cursor += scan.n;
    } else {
      if (cursor + scan.n > text.content.length) throw new Error('Retain beyond the end of the document.');
      content += text.content.slice(cursor, cursor + scan.n);
      for (let i = cursor; i < cursor + scan.n; i++) flags.push(scan.tracking ? scan.tracking.type === 'delete' ? 1 : 0 : text.deleted[i]);
      cursor += scan.n;
    }
  }
  if (cursor !== text.content.length) throw new Error('The operation does not cover the document.');
  return { content, deleted: Uint8Array.from(flags) };
}
/** Both sides of a concurrent pair of history operations, the first one's
 *  inserts first where they meet, as overleaf-editor-core transforms them. */
export function transformHistoryX(a: RawEditOperation, b: RawEditOperation): [RawEditOperation, RawEditOperation] {
  // Comment operations never change text; Papilot sends only text edits.
  if (!isTextOperation(a) || !isTextOperation(b)) return [a, b];
  const ops1 = scans(a), ops2 = scans(b), one = new Builder(), two = new Builder();
  let i1 = 0, i2 = 0, op1: Scan | undefined = ops1[i1++], op2: Scan | undefined = ops2[i2++];
  const copy = (op: Scan, n: number): Scan => ({ ...op, n } as Scan);
  for (;;) {
    if (!op1 && !op2) break;
    if (op1?.kind === 'insert') { one.insert(op1.s, op1.tracking, op1.commentIds); two.retain(op1.s.length); op1 = ops1[i1++]; continue; }
    if (op2?.kind === 'insert') { one.retain(op2.s.length); two.insert(op2.s, op2.tracking, op2.commentIds); op2 = ops2[i2++]; continue; }
    if (!op1 || !op2) throw new Error('The operations have different lengths.');
    const n = Math.min(op1.n, op2.n);
    if (op1.kind === 'retain' && op2.kind === 'retain') {
      one.retain(n, op1.tracking); two.retain(n, op1.tracking ? undefined : op2.tracking);
    } else if (op1.kind === 'remove' && op2.kind === 'retain') one.remove(n);
    else if (op1.kind === 'retain' && op2.kind === 'remove') two.remove(n);
    op1 = op1.n > n ? copy(op1, op1.n - n) : ops1[i1++];
    op2 = op2.n > n ? copy(op2, op2.n - n) : ops2[i2++];
  }
  return [one.raw(), two.raw()];
}

// Edits as the smallest changes between two texts: whole lines first, then
// characters within the lines that changed, so a coauthor typing elsewhere
// in the same paragraph keeps their words when both edits meet.
export interface Hunk { at: number; remove: string; insert: string }
const CHARACTER_DIFF_LIMIT = 20_000;
export function textHunks(before: string, after: string): Hunk[] {
  if (before === after) return [];
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  // Keep a surrogate pair together.
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start--;
  if (end > 0 && isLow(before.charCodeAt(before.length - end))) end--;
  const a = before.slice(start, before.length - end), b = after.slice(start, after.length - end), hunks: Hunk[] = [];
  const refine = (at: number, remove: string, insert: string) => {
    if (!remove || !insert || remove.length + insert.length > CHARACTER_DIFF_LIMIT) { hunks.push({ at, remove, insert }); return; }
    let position = at, pending: Hunk | null = null;
    for (const part of diffChars(remove, insert)) {
      if (part.added) { pending ??= { at: position, remove: '', insert: '' }; pending.insert += part.value; }
      else if (part.removed) { pending ??= { at: position, remove: '', insert: '' }; pending.remove += part.value; position += part.value.length; }
      else { if (pending) hunks.push(pending); pending = null; position += part.value.length; }
    }
    if (pending) hunks.push(pending);
  };
  let position = start, removed = '', added = '', from = start;
  const flush = () => { if (removed || added) refine(from, removed, added); removed = ''; added = ''; };
  for (const part of diffLines(a, b)) {
    if (part.added) { if (!removed && !added) from = position; added += part.value; }
    else if (part.removed) { if (!removed && !added) from = position; removed += part.value; position += part.value.length; }
    else { flush(); position += part.value.length; }
  }
  flush();
  return hunks;
}
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The ShareJS operation that turns one text into another. */
export function textOp(before: string, after: string): TextOp {
  const op: TextOp = [];
  let shift = 0;
  for (const hunk of textHunks(before, after)) {
    if (hunk.remove) op.push({ p: hunk.at + shift, d: hunk.remove });
    if (hunk.insert) op.push({ p: hunk.at + shift, i: hunk.insert });
    shift += hunk.insert.length - hunk.remove.length;
  }
  return op;
}
/** The history operation that turns a file's visible text into another,
 *  leaving text hidden by tracked deletions where it is. With tracking, the
 *  edit is a suggestion: inserts are marked, and removed text is only marked
 *  deleted, as the Overleaf editor sends it in track-changes mode. */
export function historyOp(text: TrackedText, after: string, tracking?: { userId: string; ts: string }): RawTextOperation | null {
  const visible: number[] = [];
  for (let i = 0; i < text.content.length; i++) if (!text.deleted[i]) visible.push(i);
  const hunks = textHunks(visibleText(text), after);
  if (!hunks.length) return null;
  const op = new Builder(), insert = tracking ? { type: 'insert' as const, ...tracking } : undefined, remove = tracking ? { type: 'delete' as const, ...tracking } : undefined;
  let cursor = 0;
  for (const hunk of hunks) {
    if (hunk.remove) {
      // Text a tracked deletion hides inside the removed passage goes with
      // it; next to it, it stays, so a coauthor's suggestion keeps its record.
      const first = visible[hunk.at], last = visible[hunk.at + hunk.remove.length - 1];
      op.retain(first - cursor).insert(hunk.insert, insert);
      if (remove) op.retain(last + 1 - first, remove); else op.remove(last + 1 - first);
      cursor = last + 1;
    } else {
      // An insert lands right after the visible character before it.
      const at = Math.max(cursor, hunk.at === 0 ? 0 : visible[hunk.at - 1] + 1);
      op.retain(at - cursor).insert(hunk.insert, insert);
      cursor = at;
    }
  }
  op.retain(text.content.length - cursor);
  return op.raw();
}

// Overleaf keeps neither carriage returns nor characters outside the Basic
// Multilingual Plane: its editor removes the former, and its document updater
// turns each half of a surrogate pair into U+FFFD. Edits are normalized the
// same way before they are sent, so both copies stay identical.
export const sanitizeText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\uD800-\uDFFF]/g, '\uFFFD');
// Only what an edit inserts is replaced: such characters already on Overleaf,
// from an upload for instance, stay.
const replaceSurrogates = (text: string) => text.replace(/[\uD800-\uDFFF]/g, '\uFFFD');
export const sanitizeTextOp = (op: TextOp): TextOp => op.map(c => isInsert(c) ? { ...c, i: replaceSurrogates(c.i) } : c);
export const sanitizeHistoryOp = (op: RawEditOperation): RawEditOperation => !isTextOperation(op) ? op : { ...op, textOperation: op.textOperation.map(scan => typeof scan === 'string' ? replaceSurrogates(scan) : typeof scan === 'object' && 'i' in scan ? { ...scan, i: replaceSurrogates(scan.i) } : scan) };
