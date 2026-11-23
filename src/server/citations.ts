import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Library, LibraryInput } from './library.ts';
import type { CitationEvidence, CitationFinding, CitationVerdict, CitingSentence } from '../shared.ts';

// Whether the works a paper cites say what its sentences claim. An agent
// reads each citing sentence and the cited work's PDF and records a verdict
// with the lines that show it; Papilot cuts the quotes out of the PDF from
// those line anchors, so evidence is always the work's own text. Findings
// are kept per sentence and work: a sentence that changes is checked
// again, and one moved elsewhere keeps its findings.

export const VERDICTS: CitationVerdict[] = ['supported', 'partial', 'unsupported', 'unclear'];
type Sentence = Omit<CitingSentence, 'id' | 'findings'>;
type Stored = Omit<CitationFinding, 'stale'>;

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const sentenceKey = (sentence: string) => digest(sentence.replace(/\s+/g, ' ').trim()).slice(0, 16);
const findingKey = (sentence: string, key: string) => `${sentenceKey(sentence)}|${key}`;

/** The findings of one paper, beside the review engine's state in its Git
 * directory, read and written whole and at once. */
export class CitationChecks {
  constructor(private file: string) {}
  private read(): Record<string, Stored> {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data?.version === 1 && data.findings && typeof data.findings === 'object' ? data.findings : {};
    } catch { return {}; }
  }
  private write(findings: Record<string, Stored>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, findings }));
    fs.renameSync(temporary, this.file);
  }
  all() { return this.read(); }
  set(sentence: string, key: string, finding: Stored) { this.write({ ...this.read(), [findingKey(sentence, key)]: finding }); }
  remove(sentence: string, key: string) {
    const findings = this.read();
    delete findings[findingKey(sentence, key)];
    this.write(findings);
  }
}

/** Each citing sentence with an ID for agents and the findings for its
 * works, marked stale where the library now has another PDF of the work. */
export function citingReport(sentences: Sentence[], findings: Record<string, Stored>, pdfOf: (key: string) => string | null): CitingSentence[] {
  const seen = new Map<string, number>();
  return sentences.map(sentence => {
    const base = digest(`${sentence.file}\n${sentence.sentence}`).slice(0, 10), n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const found: Record<string, CitationFinding> = {};
    for (const key of sentence.keys) {
      const finding = findings[findingKey(sentence.sentence, key)];
      if (finding) found[key] = finding.pdf === pdfOf(key) ? finding : { ...finding, stale: true };
    }
    return { ...sentence, id: n > 1 ? `${base}-${n}` : base, findings: found };
  });
}

export interface CitationRecord { id: string; key: string; verdict: string; evidence: { start: string; end: string }[]; note: string }
const refuse = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** Record what an agent found for one work a sentence cites: the evidence
 * is the PDF's lines from each start anchor to its end anchor. */
export async function recordCitation(sentences: CitingSentence[], inputs: LibraryInput[], library: Library, checks: CitationChecks, record: CitationRecord, now = Date.now()) {
  const sentence = sentences.find(item => item.id === record.id);
  if (!sentence) throw refuse(`No citing sentence has the ID ${record.id}; the paper may have changed. Use citations_list.`);
  if (!sentence.keys.includes(record.key)) throw refuse(`This sentence cites ${sentence.keys.join(', ')}, not ${record.key}.`);
  if (!VERDICTS.includes(record.verdict as CitationVerdict)) throw refuse(`The verdict is one of ${VERDICTS.join(', ')}.`);
  const verdict = record.verdict as CitationVerdict;
  const input = inputs.find(item => item.key === record.key), found = input && library.pdfOf(input);
  if (!found) throw refuse(`The library has no PDF of ${record.key}, so it cannot be checked. Tell the author.`);
  const snapshot = await library.text(found.hash);
  if (!snapshot) throw refuse(`The PDF of ${record.key} has no selectable text, so it cannot be checked. Tell the author.`);
  if ((verdict === 'supported' || verdict === 'partial') && !record.evidence.length) throw refuse('Give the lines of the work that support the sentence as evidence.');
  const index = new Map(snapshot.lines.map((line, at) => [line.id, at]));
  const evidence: CitationEvidence[] = record.evidence.map(({ start, end }) => {
    const from = index.get(start), to = index.get(end);
    if (from === undefined || to === undefined) throw refuse(`The PDF of ${record.key} has no line ${from === undefined ? start : end}. Use anchors from library_search or library_read.`);
    const lines = snapshot.lines.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { quote: lines.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim(), page: lines[0].page + 1, marks: lines.map(line => ({ page: line.page + 1, rect: line.rect })) };
  });
  const finding = { verdict, note: record.note.trim(), evidence, pdf: found.hash, checkedAt: now };
  checks.set(sentence.sentence, record.key, finding);
  return finding;
}
