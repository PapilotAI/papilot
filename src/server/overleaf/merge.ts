import { diffArrays } from 'diff';
import { textHunks, type Hunk } from './ot.ts';

// Joins what changed on this computer and on Overleaf since both last held
// the same text, the way Git merges a file: by lines first, and by characters
// only within lines both sides changed. Where both changed the same passage
// differently, Overleaf's text stays, so coauthors never see their words
// replaced, and the author's version is returned to offer again.

export interface Conflict { ours: string; theirs: string; before: string; after: string }
const CONTEXT = 80;
type Change<T> = { at: number; remove: number; insert: T; side: 0 | 1 };

// Changes from the two sides collide when they overlap or touch, as Git
// treats adjacent changes: "two" made "TWO" there and "two (mine)" here has
// no right answer. `b` never starts before `a`.
function clash(a: { at: number; remove: number }, b: { at: number; remove: number }) {
  return a.remove ? b.at <= a.at + a.remove : b.at === a.at;
}
function cluster<T>(changes: Change<T>[], collide: (a: Change<T>, b: Change<T>) => boolean = clash) {
  const sorted = [...changes].sort((a, b) => a.at - b.at || a.remove - b.remove || a.side - b.side);
  const clusters: { start: number; stop: number; items: Change<T>[] }[] = [];
  for (const change of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && last.items.some(item => item.side !== change.side && collide(item, change))) { last.items.push(change); last.stop = Math.max(last.stop, change.at + change.remove); }
    else clusters.push({ start: change.at, stop: change.at + change.remove, items: [change] });
  }
  return clusters;
}

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
function lineChanges(base: string[], other: string[], side: 0 | 1): Change<string[]>[] {
  const changes: Change<string[]>[] = [];
  let at = 0, pending: Change<string[]> | null = null;
  for (const part of diffArrays(base, other)) {
    if (part.added) { pending ??= { at, remove: 0, insert: [], side }; pending.insert.push(...part.value); }
    else if (part.removed) { pending ??= { at, remove: 0, insert: [], side }; pending.remove += part.value.length; at += part.value.length; }
    else { if (pending) changes.push(pending); pending = null; at += part.value.length; }
  }
  if (pending) changes.push(pending);
  return changes;
}

export function merge3(base: string, ours: string, theirs: string): { text: string; conflicts: Conflict[] } {
  if (ours === theirs || base === ours) return { text: theirs, conflicts: [] };
  if (base === theirs) return { text: ours, conflicts: [] };
  const B = lines(base), mine = lineChanges(B, lines(ours), 0);
  const key = (change: Change<string[]>) => `${change.at}\0${change.remove}\0${change.insert.join('')}`, shared = new Set(mine.map(key));
  // A change both sides made is made once.
  const changes = [...mine, ...lineChanges(B, lines(theirs), 1).filter(change => !shared.has(key(change)))];
  let text = '', cursor = 0;
  const conflicts: Conflict[] = [];
  for (const { start, stop, items } of cluster(changes)) {
    text += B.slice(cursor, start).join('');
    const version = (side: 0 | 1) => {
      let out = '', at = start;
      for (const change of items) if (change.side === side) { out += B.slice(at, change.at).join('') + change.insert.join(''); at = change.at + change.remove; }
      return out + B.slice(at, stop).join('');
    };
    if (items.every(item => item.side === items[0].side)) text += version(items[0].side);
    else {
      // Both sides changed these lines: merge them by characters.
      const merged = mergeCharacters(B.slice(start, stop).join(''), version(0), version(1));
      for (const conflict of merged.conflicts) conflicts.push({ ...conflict, before: (text + conflict.before).slice(-CONTEXT), after: (conflict.after + B.slice(stop).join('')).slice(0, CONTEXT) });
      text += merged.text;
    }
    cursor = stop;
  }
  return { text: text + B.slice(cursor).join(''), conflicts };
}

// Within lines both sides changed, their edits join only when separated by
// unchanged text with a space in it, so in different words, or by a line
// break between edits that each stay within a line. A diff can split
// one change differently on each side (a doubled letter, a repeated line
// ending); such edits are close together, and close edits are a conflict
// rather than a guess.
function mergeCharacters(base: string, ours: string, theirs: string): { text: string; conflicts: Conflict[] } {
  if (ours === theirs) return { text: theirs, conflicts: [] };
  const theirChanges = textHunks(base, theirs), key = (hunk: Hunk) => `${hunk.at}\0${hunk.remove}\0${hunk.insert}`, theirKeys = new Set(theirChanges.map(key));
  const changes: Change<string>[] = [
    ...textHunks(base, ours).filter(hunk => !theirKeys.has(key(hunk))).map(hunk => ({ at: hunk.at, remove: hunk.remove.length, insert: hunk.insert, side: 0 as const })),
    ...theirChanges.map(hunk => ({ at: hunk.at, remove: hunk.remove.length, insert: hunk.insert, side: 1 as const })),
  ];
  // Edits within single lines are also apart across a line break.
  const multiline = (change: Change<string>) => /\n/.test(change.insert + base.slice(change.at, change.at + change.remove));
  const apart = (a: Change<string>, b: Change<string>) => {
    if (b.at < a.at + a.remove) return true;
    const gap = base.slice(a.at + a.remove, b.at);
    return !(/[ \t]/.test(gap) || (gap.includes('\n') && !multiline(a) && !multiline(b)));
  };
  let text = '', cursor = 0;
  const conflicts: Conflict[] = [];
  for (const { start, stop, items } of cluster(changes, apart)) {
    text += base.slice(cursor, start);
    const version = (side: 0 | 1) => {
      let out = '', at = start;
      for (const change of items) if (change.side === side) { out += base.slice(at, change.at) + change.insert; at = change.at + change.remove; }
      return out + base.slice(at, stop);
    };
    if (items.every(item => item.side === items[0].side)) text += version(items[0].side);
    else {
      const mineText = version(0), theirsText = version(1);
      if (mineText !== theirsText) conflicts.push({ ours: mineText, theirs: theirsText, before: text, after: base.slice(stop) });
      text += theirsText;
    }
    cursor = stop;
  }
  return { text: text + base.slice(cursor), conflicts };
}

/** Puts the author's version of a passage back where Overleaf's now is,
 *  if that passage can still be found without doubt. */
export function restore(text: string, conflict: Conflict): string | null {
  const { ours, theirs, before, after } = conflict;
  // A whole-file deletion has no surrounding text. It is unambiguous only
  // while the file is still empty; searching for an empty needle never ends.
  if (!theirs && !before && !after) return text === '' ? ours : null;
  const places: number[] = [];
  if (theirs) for (let at = text.indexOf(theirs); at >= 0; at = text.indexOf(theirs, at + 1)) places.push(at);
  else for (let at = text.indexOf(before + after); at >= 0; at = text.indexOf(before + after, at + 1)) places.push(at + before.length);
  const fits = (at: number) => text.slice(Math.max(0, at - before.length), at) === before && text.slice(at + theirs.length, at + theirs.length + after.length) === after;
  const exact = places.filter(fits), at = exact.length === 1 ? exact[0] : !exact.length && places.length === 1 && theirs ? places[0] : -1;
  return at < 0 ? null : text.slice(0, at) + ours + text.slice(at + theirs.length);
}
