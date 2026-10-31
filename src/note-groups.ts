export const NOTE_GROUPS = ['yellow', 'green', 'purple', 'orange', 'red'] as const;
// Older saved annotations and review drafts keep their identity; blue is now
// displayed and described as yellow, and is no longer offered in the palette.
export type NoteGroup = typeof NOTE_GROUPS[number] | 'blue';
export const canonicalGroup = (group: NoteGroup): typeof NOTE_GROUPS[number] => group === 'blue' ? 'yellow' : group;
export const isNoteGroup = (value: unknown): value is NoteGroup => value === 'blue' || NOTE_GROUPS.includes(value as typeof NOTE_GROUPS[number]);
export const GROUP_COLORS: Record<NoteGroup, string> = { yellow: '#eab308', blue: '#eab308', green: '#16a34a', purple: '#a855f7', orange: '#ea860c', red: '#e05260' };
export const GROUP_NAMES: Record<NoteGroup, string> = { yellow: 'Yellow', blue: 'Yellow', green: 'Green', purple: 'Purple', orange: 'Orange', red: 'Red' };
export function noteGroups<T extends { group?: NoteGroup }>(notes: T[]) {
  return NOTE_GROUPS.flatMap(group => {
    const entries = notes.flatMap((note, index) => note.group && canonicalGroup(note.group) === group ? [{ note, index }] : []);
    return entries.length ? [{ group, entries }] : [];
  });
}
export const GROUP_INSTRUCTIONS = 'Color groups are labels only, with no built-in meaning. Apply the author\'s instructions for this message to every marked location in each named color group. Never infer an editing action from a color. If a group\'s intended treatment is unclear, ask the author.';
