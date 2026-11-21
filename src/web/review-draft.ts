import { useSyncExternalStore } from 'react';
import type { MarkKind, NoteSummary } from '../shared.ts';
import { canonicalGroup, type NoteGroup } from '../note-groups.ts';
import type { Rect } from './note-geometry.ts';
import { noteAnchor } from '../notes.ts';
import { browserStorage } from './storage.ts';

// A passage commented on a whole page rather than a change's strip: the PDF it
// was on (a review round's, the manuscript preview's or a build's) and where.
export type PaperPlace = { page: number; rects: Rect[]; round?: number; key?: string; build?: string };
export type ReviewMark = { returned?: { original: string; createdAt: number; groupInstruction?: string; anchor?: NoteSummary['anchor'] }; paper?: PaperPlace; group?: NoteGroup; kind?: MarkKind; stamp?: string; strip: string; round: number; stop?: number; where: string; quote: string; rects: Rect[]; region: boolean; whole?: boolean; changes?: string[]; option?: { note: string; id: string; label: string; kind: 'comment' | 'reject' } };
export type ReviewNote = ReviewMark & { id: string; comment: string };
export type ReviewComment = { round: number; stop: number; changes?: string[]; scope?: { where: string; quote: string } };
export function reviewCommentMark(base: ReviewMark, detail: ReviewComment, wholeQuote: string): ReviewMark {
  return detail.scope ? {
    ...base, whole: false, stop: detail.stop, changes: detail.changes,
    where: `Round ${detail.round} · ${detail.scope.where} · Source changes: ${detail.changes?.join(', ') || ''}`,
    quote: detail.scope.quote,
  } : { ...base, whole: true, stop: detail.stop, quote: wholeQuote };
}
const sameChanges = (a: string[] | undefined, b: string[] | undefined) => Boolean(a && b && a.length === b.length && a.every(id => b.includes(id)));
type Snapshot = { notes: ReviewNote[]; instructions: string; editing?: { id: string; sequence: number }; reveal?: { note: ReviewNote; sequence: number }; busy: boolean; canUndo: boolean; canRedo: boolean };
// HTTP tailnet addresses are not secure contexts, but still provide random bytes.
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

// One persisted draft shared by the PDF selections and the chat composer.
// Geometry stays local; the message retains the quoted text, source and round.
export class ReviewDraft {
  private value: Snapshot;
  private listeners = new Set<() => void>();
  private history: { action: 'add' | 'remove'; note: ReviewNote; index: number; time?: number }[] = [];
  private future: typeof this.history = [];
  private sequence = 0;
  private stored: string | null = null;
  constructor(private key: string, private storage: Pick<Storage, 'getItem' | 'setItem'> = browserStorage) {
    let saved: any;
    try { this.stored = storage.getItem(key); saved = JSON.parse(this.stored || 'null'); } catch { /* Invalid local draft. */ }
    this.history = Array.isArray(saved?.deleted) ? saved.deleted.map((entry: { note: ReviewNote; index: number }) => ({ ...entry, action: 'remove' })) : [];
    const notes: ReviewNote[] = Array.isArray(saved?.notes) ? saved.notes : [];
    // Recover an unfinished note from the former floating editor.
    if (saved?.editing?.comment?.trim()) {
      const note = { ...saved.editing, id: saved.editing.id || uuid() };
      const index = notes.findIndex(item => item.id === note.id);
      if (index < 0) notes.push(note); else notes[index] = note;
    }
    // Consolidate repeated overall-comment drafts from the first trial without
    // losing anything the author typed into them.
    const recovered: ReviewNote[] = [];
    for (const note of notes) {
      const existing = note.whole && recovered.find(item => item.whole && item.round === note.round && item.stop === note.stop);
      if (existing) {
        if (note.comment.trim() && note.comment !== existing.comment) existing.comment = [existing.comment, note.comment].filter(Boolean).join('\n\n');
      } else recovered.push({ ...note, strip: note.strip.replace(/-clean(?=\.)/, '') });
    }
    this.value = { notes: recovered, instructions: saved?.instructions || '', busy: false, canUndo: Boolean(this.history.length), canRedo: false };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.value;
  refreshFromStorage() {
    if (this.storage.getItem(this.key) === this.stored) return this;
    const latest = new ReviewDraft(this.key, this.storage);
    this.stored = latest.stored;
    this.history = latest.history; this.future = [];
    this.value = { ...latest.value, busy: this.value.busy };
    this.listeners.forEach(listener => listener());
    return this;
  }
  private update(next: Partial<Snapshot>) {
    this.value = { ...this.value, ...next, canUndo: Boolean(this.history.length), canRedo: Boolean(this.future.length) };
    this.stored = JSON.stringify({ notes: this.value.notes, instructions: this.value.instructions, deleted: this.history.filter(entry => entry.action === 'remove') });
    this.storage.setItem(this.key, this.stored);
    this.listeners.forEach(listener => listener());
  }
  add(mark: ReviewMark, focus = true, comment = '') {
    if (mark.returned) this.refreshFromStorage();
    if (this.value.busy) return;
    // Comment is an entry point to this change's overall discussion. Repeated
    // clicks reopen that draft; distinct quotations can still have separate notes.
    const existing = this.value.notes.find(note => note.round === mark.round && (mark.returned ? note.returned?.original === mark.returned.original && note.returned.createdAt === mark.returned.createdAt : mark.option
      ? note.option?.note === mark.option.note && note.option.id === mark.option.id && note.option.kind === mark.option.kind
      : mark.changes ? note.stop === mark.stop && sameChanges(note.changes, mark.changes)
      : mark.whole && note.whole && note.stop === mark.stop));
    if (existing) { if (focus) this.focus(existing.id); return existing.id; }
    const note = { ...mark, id: uuid(), comment };
    this.history.push({ action: 'add', note, index: this.value.notes.length, time: Date.now() }); this.future = [];
    this.update({ notes: [...this.value.notes, note], ...(focus ? { editing: { id: note.id, sequence: ++this.sequence } } : {}) });
    return note.id;
  }
  edit(id: string, comment: string) {
    if (!this.value.busy) this.update({ notes: this.value.notes.map(note => note.id === id ? { ...note, comment } : note) });
  }
  focus(id: string) { this.update({ editing: { id, sequence: ++this.sequence } }); }
  reveal(note: ReviewNote) { this.update({ reveal: { note, sequence: ++this.sequence } }); }
  clearReveal() { if (this.value.reveal) this.update({ reveal: undefined }); }
  instructions(text: string) { if (!this.value.busy) this.update({ instructions: text }); }
  remove(id: string) {
    if (this.value.busy) return;
    const index = this.value.notes.findIndex(note => note.id === id);
    if (index < 0) return;
    this.history.push({ action: 'remove', note: this.value.notes[index], index, time: Date.now() }); this.future = [];
    this.update({ notes: this.value.notes.filter(note => note.id !== id), ...(this.value.reveal?.note.id === id ? { reveal: undefined } : {}) });
  }
  forgetReturn(original: string, createdAt: number) {
    this.refreshFromStorage();
    const keep = (note: ReviewNote) => note.returned?.original !== original || note.returned.createdAt !== createdAt;
    if (this.value.notes.every(keep) && this.history.every(entry => keep(entry.note)) && this.future.every(entry => keep(entry.note))) return;
    this.history = this.history.filter(entry => keep(entry.note));
    this.future = this.future.filter(entry => keep(entry.note));
    this.update({ notes: this.value.notes.filter(keep) });
  }
  private travel(from: typeof this.history, to: typeof this.history) {
    if (this.value.busy) return false;
    const entry = from.pop(); if (!entry) return false;
    const notes = [...this.value.notes];
    if (entry.action === 'add') {
      const index = notes.findIndex(note => note.id === entry.note.id);
      if (index < 0) return false;
      to.push({ action: 'remove', note: notes[index], index }); notes.splice(index, 1);
    } else {
      notes.splice(entry.index, 0, entry.note); to.push({ ...entry, action: 'add' });
    }
    if (to === this.history) to.at(-1)!.time = Date.now();
    this.update({ notes, reveal: undefined }); return true;
  }
  newestUndo() { return this.history.at(-1)?.time ?? 0; }
  undo() { return this.travel(this.history, this.future); }
  redo() { return this.travel(this.future, this.history); }
  setBusy(busy: boolean) { if (this.value.busy !== busy) this.update({ busy }); }
  clear(submitted: Snapshot) {
    // Keep edits saved by a reopened task or another tab while sending.
    let saved: Snapshot = this.value;
    try { saved = JSON.parse(this.storage.getItem(this.key) || 'null') || saved; } catch { /* Keep current draft. */ }
    const notes = saved.notes.filter(note => !submitted.notes.some(sent => JSON.stringify(sent) === JSON.stringify(note)));
    this.history = []; this.future = [];
    this.update({ notes, instructions: saved.instructions === submitted.instructions ? '' : saved.instructions, reveal: undefined });
  }
}
const drafts = new Map<string, ReviewDraft>();
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  const task = event.key?.match(/^(?:playground:)?papilot:review-notes:(.+)$/)?.[1];
  if (task) drafts.get(task)?.refreshFromStorage();
});
export function reviewDraft(taskId: string) {
  let draft = drafts.get(taskId);
  if (!draft) { draft = new ReviewDraft(`papilot:review-notes:${taskId}`); drafts.set(taskId, draft); }
  return draft;
}
export const useReviewDraft = (taskId: string) => {
  const draft = reviewDraft(taskId);
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
};
export const reviewNoteSummary = (note: ReviewNote): NoteSummary => ({
  id: note.id, ...(note.returned ? { returnedFrom: { original: note.returned.original, createdAt: note.returned.createdAt } } : {}), ...(note.group ? { group: note.group } : {}), ...(note.kind ? { kind: note.kind } : {}), ...(note.stamp ? { stamp: note.stamp } : {}),
  where: note.where + (note.region ? ` · Region in displayed strip: ${note.rects[0].map(v => `${Math.round(v * 100)}%`).join(', ')}` : ''),
  quote: note.quote, comment: note.comment.trim(), anchor: note.returned?.anchor ?? { ...noteAnchor(note), ...(note.round ? { round: note.round } : {}) },
  ...(note.paper ? { paper: note.paper } : {}),
});

// Unwritten individual comments remain drafts. A color group's shared direction
// can cover its empty per-location fields without blocking unrelated messages.
export function reviewSubmission(draft: Snapshot, text = '', skill?: string): Snapshot {
  const directedGroups = new Set(draft.notes.filter(note => note.group && note.comment.trim()).map(note => canonicalGroup(note.group!)));
  const shared = Boolean(text.trim() || draft.instructions.trim() || skill);
  return { ...draft, notes: draft.notes.filter(note => note.kind === 'delete' || note.comment.trim() || note.returned?.groupInstruction || (note.group && (shared || directedGroups.has(canonicalGroup(note.group))))) };
}
