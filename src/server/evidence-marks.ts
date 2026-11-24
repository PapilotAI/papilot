import type { ReviewSnapshot } from './ai-review.ts';
import type { LibraryInput } from './library.ts';
import type { CitationSuggestion, CitingSentence, EvidenceMark } from '../shared.ts';

// Where the checked citations print in the paper's PDF, so the reader shows
// their verdicts beside the sentences. A sentence is found by a run of its
// words in the PDF's text: math, citations and words broken across lines
// differ between the source and the PDF, so several runs are tried and the
// first that occurs once wins. A sentence not found has no mark; the Library
// still lists it.

const RUN = 5;
const plainWords = (sentence: string) => sentence.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean);
const usable = (word: string) => !/[$\\{}^_~]/.test(word);

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** A PDF's text prepared once for many lookups: each page's lines joined,
 * with where each line starts. */
export interface PdfText { pages: { text: string; starts: number[]; lines: number[] }[] }
export function pdfText(snapshot: ReviewSnapshot): PdfText {
  const pages: PdfText['pages'] = [];
  snapshot.lines.forEach((line, index) => {
    const page = pages[line.page] ??= { text: '', starts: [], lines: [] }, text = normalize(line.text);
    if (page.text) page.text += ' ';
    page.starts.push(page.text.length); page.lines.push(index); page.text += text;
  });
  return { pages: pages.map(page => page ?? { text: '', starts: [], lines: [] }) };
}
// Every place a run of words occurs, as the snapshot's first and last line.
function occurrences(text: PdfText, run: string) {
  const found: { page: number; from: number; to: number }[] = [];
  text.pages.forEach((page, number) => {
    for (let at = page.text.indexOf(run); at >= 0; at = page.text.indexOf(run, at + 1)) {
      const line = (offset: number) => { let low = 0, high = page.starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (page.starts[mid] <= offset) low = mid; else high = mid - 1; } return page.lines[low]; };
      found.push({ page: number, from: line(at), to: line(at + run.length - 1) });
    }
  });
  return found;
}

/** The page and lines of a sentence in the PDF, or null: from the first run
 * of its words found to the last, when both are on one page. */
export function locateSentence(snapshot: ReviewSnapshot, sentence: string, text = pdfText(snapshot)): { page: number; rects: [number, number, number, number][] } | null {
  const words = plainWords(sentence);
  const runs = words.length <= RUN ? [0] : Array.from({ length: Math.ceil((words.length - RUN + 1) / 2) }, (_, index) => index * 2);
  const find = (order: number[]) => {
    let fallback: { page: number; from: number; to: number } | null = null;
    for (const from of order) {
      const run = words.slice(from, from + RUN);
      if (run.length < Math.min(RUN, words.length) || !run.every(usable) || run.join(' ').length < 16) continue;
      const matches = occurrences(text, normalize(run.join(' ')));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) fallback ??= matches[0];
    }
    return fallback;
  };
  const first = find(runs);
  if (!first) return null;
  const last = find([...runs].reverse()) ?? first;
  // A sentence spans a few lines; a later run found elsewhere does not stretch it.
  const end = last.page === first.page && last.from >= first.from && last.to - first.from <= 12 ? Math.max(last.to, first.to) : first.to;
  const found = snapshot.lines.slice(first.from, end + 1);
  return { page: found[0].page, rects: found.map(line => line.rect) };
}

/** The marks of every sentence with a current finding that the PDF shows. */
const titleOf = (input: LibraryInput) => (input.fields.title ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
/** The marks of sentences citing nothing that a library work could support. */
export function suggestionMarks(snapshot: ReviewSnapshot, suggestions: CitationSuggestion[], entries: LibraryInput[], text = pdfText(snapshot)): EvidenceMark[] {
  return suggestions.flatMap(suggestion => {
    const input = entries.find(entry => entry.key === suggestion.key), place = input && locateSentence(snapshot, suggestion.sentence, text);
    return input && place ? [{ id: `suggest:${suggestion.id}`, page: place.page, rects: place.rects, sentence: suggestion.sentence, file: suggestion.file, line: suggestion.line, findings: [], suggestion: { ...suggestion, entry: input.id, title: titleOf(input) } }] : [];
  });
}

export function evidenceMarks(snapshot: ReviewSnapshot, sentences: CitingSentence[], entries: LibraryInput[], pdfOf: (input: LibraryInput) => string | null, text = pdfText(snapshot)): EvidenceMark[] {
  return sentences.flatMap(sentence => {
    const findings = sentence.keys.flatMap(key => {
      const finding = sentence.findings[key], input = entries.find(entry => entry.key === key), hash = input && pdfOf(input);
      return finding && !finding.stale && hash ? [{ ...finding, key, entry: input!.id, title: (input!.fields.title ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim(), hash }] : [];
    });
    if (!findings.length) return [];
    const place = locateSentence(snapshot, sentence.sentence, text);
    return place ? [{ id: sentence.id, page: place.page, rects: place.rects, sentence: sentence.sentence, file: sentence.file, line: sentence.line, findings }] : [];
  });
}
