export const NOTE_GROUPS = ['yellow', 'green', 'purple', 'orange', 'red'] as const;
// Older saved annotations and review drafts keep their identity; blue is now
// displayed and described as yellow, and is no longer offered in the palette.
export type NoteGroup = typeof NOTE_GROUPS[number] | 'blue';
export type GroupInstructions = Partial<Record<typeof NOTE_GROUPS[number], string>>;
export const canonicalGroup = (group: NoteGroup): typeof NOTE_GROUPS[number] => group === 'blue' ? 'yellow' : group;
export const isNoteGroup = (value: unknown): value is NoteGroup => value === 'blue' || NOTE_GROUPS.includes(value as typeof NOTE_GROUPS[number]);
// A saved group instruction belongs to its color. Moving a mark preserves its
// own comment, while Undo can restore the instruction with the original color.
export function regroupAnnotation<T extends { group?: NoteGroup; groupInstruction?: string }>(note: T, group: unknown, instruction?: string): T {
  if (group !== null && !isNoteGroup(group)) throw new Error('Invalid annotation group.');
  const target = group === null ? undefined : canonicalGroup(group);
  if ((note.group && canonicalGroup(note.group)) === target) return note;
  const next = { ...note };
  delete next.group;
  delete next.groupInstruction;
  if (target) {
    next.group = target;
    if (instruction) next.groupInstruction = instruction;
  }
  return next;
}
export function sameAnnotationGroup(note: { group?: NoteGroup | null; groupInstruction?: string }, other: { group?: NoteGroup | null; groupInstruction?: string }) {
  return (note.group ? canonicalGroup(note.group) : null) === (other.group ? canonicalGroup(other.group) : null)
    && (note.groupInstruction || '') === (other.groupInstruction || '');
}
export function annotationGroupState(note: { id: string; createdAt: number; group?: NoteGroup; groupInstruction?: string }) {
  const { id, createdAt, group, groupInstruction } = note;
  return { id, createdAt, group: group ?? null, groupInstruction };
}
export function parseGroupInstructions(value: unknown): GroupInstructions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use valid instructions for each color group.');
  const result: GroupInstructions = {};
  for (const [key, text] of Object.entries(value)) {
    if (!isNoteGroup(key) || typeof text !== 'string') throw new Error('Use valid instructions for each color group.');
    const group = canonicalGroup(key);
    if (result[group] && result[group] !== text.trim()) throw new Error('Use one instruction for each color group.');
    if (text.trim()) result[group] = text.trim();
  }
  return result;
}
// A deletion says what to do by itself, so its group needs no instruction for it.
export const groupsWithoutInstructions = (notes: { group?: NoteGroup; comment: string; kind?: string }[], instructions: GroupInstructions) =>
  NOTE_GROUPS.filter(group => !instructions[group]?.trim() && notes.some(note => note.group && canonicalGroup(note.group) === group && !note.comment.trim() && note.kind !== 'delete'));
// The interface palette's own hues (theme.css), so a group's marks, dots and
// swatches match its green, purple and red; yellow and orange sit between amber's.
export const GROUP_COLORS: Record<NoteGroup, string> = { yellow: '#f5bd00', blue: '#f5bd00', green: '#14a35a', purple: '#8a46f0', orange: '#f5841f', red: '#e5482d' };
export const GROUP_NAMES: Record<NoteGroup, string> = { yellow: 'Yellow', blue: 'Yellow', green: 'Green', purple: 'Purple', orange: 'Orange', red: 'Red' };
export function noteGroups<T extends { group?: NoteGroup }>(notes: T[]) {
  return NOTE_GROUPS.flatMap(group => {
    const entries = notes.flatMap((note, index) => note.group && canonicalGroup(note.group) === group ? [{ note, index }] : []);
    return entries.length ? [{ group, entries }] : [];
  });
}
export const GROUP_INSTRUCTIONS = 'Color groups are labels only, with no built-in meaning. Apply the author\'s instructions for this message to every marked location in each named color group. Never infer an editing action from a color. If a group\'s intended treatment is unclear, ask the author.';
