import type { NoteSummary } from '../shared.ts';

// Review rounds belong to the old task. Keep their words and source locations
// as editable draft text rather than pretending their change IDs are portable.
export function restartDraftText(text: string, instructions: string, notes: NoteSummary[]) {
  if (!notes.length && !instructions.trim()) return text;
  const comments = notes.map((note, index) => [
    `${index + 1}. ${note.where}`,
    ...(note.context || []),
    ...(note.paper ? [`PDF page ${note.paper.page + 1}`] : []),
    ...(note.anchor?.sources || []).map(source => `${source.file}:${source.lines.join('–')}`),
    note.quote ? `Quoted text: ${note.quote}` : '',
    note.kind ? `Mark: ${note.kind}${note.stamp ? ` (${note.stamp})` : ''}` : '',
    note.group ? `Color group: ${note.group}` : '',
    `Comment: ${note.comment}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  return [text, instructions, comments ? 'Unsent comments from the original task (locations refer to that task; check the current source before editing):\n\n' + comments : ''].filter(Boolean).join('\n\n');
}
