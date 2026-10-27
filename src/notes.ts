import type { Annotation } from './shared.ts';

// PDF notes reach the agent as one plain-text message. The chat shows that
// message as the notes again, so the format and its reader live together.
const PREAMBLE = 'Revise the manuscript according to these notes the author marked on the compiled PDF.';
const QUOTE = '   PDF text: "', REGION = '   Marked region: a figure, equation or other non-text area', NOTE = '\n   Note: ';

export interface NoteSummary { where: string; quote: string; comment: string }

export function notesInstructions(notes: Annotation[]) {
  const items = notes.map((note, index) => {
    const where = [`Page ${note.page + 1}`, note.source ? `${note.source.file} ${note.source.lines[0] === note.source.lines[1] ? `line ${note.source.lines[0]}` : `lines ${note.source.lines[0]}–${note.source.lines[1]}`}` : ''].filter(Boolean).join(' · ');
    const source = note.source?.excerpt ? ['   LaTeX source of the marked region:', '   ```latex', ...note.source.excerpt.split('\n').map(line => '   ' + line), '   ```'] : [];
    return [`${index + 1}. ${where}`, ...source, note.quote ? `${QUOTE}${note.quote}"` : REGION, `${NOTE.slice(1)}${note.comment.trim().replace(/\n/g, '\n   ')}`].join('\n');
  });
  return `${PREAMBLE} SyncTeX mapped each marked region to the LaTeX file and lines that produced it; the PDF text is what the author saw. Read the current source before editing, and change only what the notes ask for.\n\n${items.join('\n\n')}`;
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
