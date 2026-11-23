import { searchPaper } from './paper-tools.ts';
import type { ReviewSnapshot } from './ai-review.ts';
import type { LibraryInput } from './library.ts';
import type { CitingSentence, EvidenceMark } from '../shared.ts';

// Where the checked citations print in the paper's PDF, so the reader shows
// their verdicts beside the sentences. A sentence is found by a run of its
// words in the PDF's text: math, citations and words broken across lines
// differ between the source and the PDF, so several runs are tried and the
// first that occurs once wins. A sentence not found has no mark; the Library
// still lists it.

const RUN = 5;
const plainWords = (sentence: string) => sentence.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean);
const usable = (word: string) => !/[$\\{}^_~]/.test(word);

/** The page and lines of a sentence in the PDF, or null: from the first run
 * of its words found to the last, when both are on one page. */
export function locateSentence(snapshot: ReviewSnapshot, sentence: string): { page: number; rects: [number, number, number, number][] } | null {
  const words = plainWords(sentence), lines = new Map(snapshot.lines.map((line, index) => [line.id, index]));
  const runs = words.length <= RUN ? [0] : Array.from({ length: Math.ceil((words.length - RUN + 1) / 2) }, (_, index) => index * 2);
  const find = (order: number[]) => {
    let fallback: { start: string; end: string } | null = null;
    for (const from of order) {
      const run = words.slice(from, from + RUN);
      if (run.length < Math.min(RUN, words.length) || !run.every(usable) || run.join(' ').length < 16) continue;
      const { matches } = searchPaper(snapshot, run.join(' '));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) fallback ??= matches[0];
    }
    return fallback;
  };
  const first = find(runs);
  if (!first) return null;
  const last = find([...runs].reverse()) ?? first;
  // A sentence spans a few lines; a later run found elsewhere does not stretch it.
  const start = lines.get(first.start)!, tail = lines.get(last.end)!;
  const end = lines.get(last.start)! >= start && tail - start <= 12 && snapshot.lines[tail].page === snapshot.lines[start].page ? Math.max(tail, lines.get(first.end)!) : lines.get(first.end)!;
  const found = snapshot.lines.slice(start, end + 1);
  return { page: found[0].page, rects: found.map(line => line.rect) };
}

/** The marks of every sentence with a current finding that the PDF shows. */
export function evidenceMarks(snapshot: ReviewSnapshot, sentences: CitingSentence[], entries: LibraryInput[], pdfOf: (input: LibraryInput) => string | null): EvidenceMark[] {
  return sentences.flatMap(sentence => {
    const findings = sentence.keys.flatMap(key => {
      const finding = sentence.findings[key], input = entries.find(entry => entry.key === key), hash = input && pdfOf(input);
      return finding && !finding.stale && hash ? [{ ...finding, key, entry: input!.id, title: (input!.fields.title ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim(), hash }] : [];
    });
    if (!findings.length) return [];
    const place = locateSentence(snapshot, sentence.sentence);
    return place ? [{ id: sentence.id, page: place.page, rects: place.rects, sentence: sentence.sentence, file: sentence.file, line: sentence.line, findings }] : [];
  });
}
