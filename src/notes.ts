import type { Annotation, NoteAnchor, NoteSummary } from './shared.ts';
export type { NoteSummary } from './shared.ts';

// PDF notes reach the agent as one plain-text message. The chat shows that
// message as the notes again, so the format and its reader live together.
const PREAMBLE = 'Revise the manuscript according to these notes the author marked on the compiled PDF.';
const QUOTE = '   PDF text: "', REGION = '   Marked region: a figure, equation or other non-text area', NOTE = '\n   Note: ';

const noteWhere = (note: Annotation) => [`Page ${note.page + 1}`, note.source ? `${note.source.file} ${note.source.lines[0] === note.source.lines[1] ? `line ${note.source.lines[0]}` : `lines ${note.source.lines[0]}–${note.source.lines[1]}`}` : '', note.author ? `from ${note.author.name}` : ''].filter(Boolean).join(' · ');
export const summarizeNotes = (notes: Annotation[]): NoteSummary[] => notes.map(note => ({ id: note.id, where: noteWhere(note), quote: note.quote, comment: note.comment, anchor: { sources: note.source ? [{ file: note.source.file, lines: note.source.lines }] : [] } }));

// Also recover anchors from older messages, whose locations were only text.
export function noteAnchor(note: NoteSummary): NoteAnchor {
  if (note.anchor) return note.anchor;
  const round = note.where.match(/^Round (\d+)\b/), sources: NoteAnchor['sources'] = [];
  for (const place of note.where.split(/ · |; /)) {
    const match = place.match(/^(.+?)(?::| lines? )(\d+(?:[–-]\d+)?(?:,\s*\d+(?:[–-]\d+)?)*)$/);
    if (!match) continue;
    for (const range of match[2].split(/,\s*/)) {
      const [start, end] = range.split(/[–-]/).map(Number);
      sources.push({ file: match[1], lines: [start, end ?? start] });
    }
  }
  return { sources, ...(round ? { round: Number(round[1]) } : {}) };
}

export function reviewNotesInstructions(notes: NoteSummary[]) {
  const items = notes.map((note, index) => `${index + 1}. ${note.where}\n${note.quote ? `${QUOTE}${note.quote}"` : REGION}${NOTE}${note.comment.trim().replace(/\n/g, '\n   ')}`);
  return `${PREAMBLE} These notes refer to the displayed review round and its Before, After or Unchanged text. Region coordinates are percentages of the displayed PDF strip (left, top, right, bottom); any quoted text for a region is nearby context. Read the current source before editing. Preserve accepted changes and do not reintroduce rejected edits unless a note explicitly asks for it.\n\n${items.join('\n\n')}`;
}

export function notesInstructions(notes: Annotation[], request = '') {
  const items = notes.map((note, index) => {
    const where = noteWhere(note);
    const source = note.source?.excerpt ? ['   LaTeX source of the marked region:', '   ```latex', ...note.source.excerpt.split('\n').map(line => '   ' + line), '   ```'] : [];
    return [`${index + 1}. ${where}`, ...source, note.quote ? `${QUOTE}${note.quote}"` : REGION, `${NOTE.slice(1)}${note.comment.trim().replace(/\n/g, '\n   ')}`].join('\n');
  });
  const scope = request.trim() ? `follow both the overall request and the notes.\n\nOverall request:\n${request.trim()}` : 'change only what the notes ask for.';
  return `${PREAMBLE} SyncTeX mapped each marked region to the LaTeX file and lines that produced it; the PDF text is what the author saw. Read the current source before editing, and ${scope}\n\n${items.join('\n\n')}`;
}

// The notes in a message written by notesInstructions, or null for any other message.
export function readNotesInstructions(text: string): NoteSummary[] | null {
  if (!text.startsWith(PREAMBLE)) return null;
  const notes: NoteSummary[] = [];
  for (const block of text.split(/\n\n(?=\d+\. )/).slice(1)) {
    const heading = block.match(/^\d+\. (.*)\n/);
    if (!heading) return null;
    let rest = block.slice(heading[0].length);
    if (rest.startsWith('   LaTeX source of the marked region:\n   ```latex\n')) {
      // The excerpt may hold a fence of its own; the closing one is followed by the marked text.
      const end = rest.match(/\n {3}```\n(?= {3}(?:PDF text: "|Marked region: ))/);
      if (!end) return null;
      rest = rest.slice(end.index! + end[0].length);
    }
    const note = rest.indexOf(NOTE);
    if (note < 0) return null;
    const marked = rest.slice(0, note);
    if (marked !== REGION && !(marked.startsWith(QUOTE) && marked.endsWith('"'))) return null;
    notes.push({ where: heading[1], quote: marked === REGION ? '' : marked.slice(QUOTE.length, -1), comment: rest.slice(note + NOTE.length).replace(/\n {3}/g, '\n') });
  }
  return notes.length ? notes : null;
}
