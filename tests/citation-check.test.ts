import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuickCitationChecks, parseResults, passagesFor, terms, type QuickReply } from '../src/server/citation-check.ts';
import { CitationChecks, citingReport } from '../src/server/citations.ts';
import { evidenceMarks, locateSentence } from '../src/server/evidence-marks.ts';
import type { Library, LibraryInput } from '../src/server/library.ts';
import type { ReviewSnapshot } from '../src/server/ai-review.ts';

const rect: [number, number, number, number] = [0.1, 0.1, 0.9, 0.12];
const line = (page: number, n: number, text: string) => ({ id: `p${page + 1}-l${n}`, page, text, rect });
const paper: ReviewSnapshot = { key: 'loom', lines: [
  line(0, 1, 'Loom: incremental type checking for large proofs'),
  line(0, 2, 'We present Loom, a checker that rechecks only changed definitions.'),
  ...Array.from({ length: 30 }, (_, i) => line(1, i + 1, `Background paragraph ${i} about unrelated history of proof assistants.`)),
  line(2, 1, 'Our evaluation on the mathlib corpus shows that incremental checking'),
  line(2, 2, 'reduces recompilation time by 73% on average across 4,000 commits.'),
  line(2, 3, 'Memory use grows linearly with the number of cached definitions.'),
] };
const input = (key: string, title: string): LibraryInput => ({ id: key, key, fields: { title, author: 'Ada Lovelace and Alan Turing', year: '2024' } } as unknown as LibraryInput);
const entries = [input('loom', 'Loom: incremental type checking'), input('nopdf', 'A work without a PDF')];
const library = { pdfOf: (entry: LibraryInput) => entry.key === 'loom' ? { hash: 'h-loom' } : null, text: async (hash: string) => hash === 'h-loom' ? paper : null } as unknown as Library;
const sentences = (findings: Record<string, any> = {}) => citingReport([
  { keys: ['loom'], file: 'main.tex', line: 10, section: 'Related work', sentence: 'Incremental checking reduces recompilation time by 73% on mathlib [loom].' },
  { keys: ['loom', 'nopdf'], file: 'main.tex', line: 12, section: 'Related work', sentence: 'Loom needs constant memory [loom, nopdf].' },
], findings, key => key === 'loom' ? 'h-loom' : null);

test('passages for a sentence are the windows sharing its rarer terms, with the opening lines', () => {
  assert.deepEqual(terms('Incremental checking reduces time by 73% [loom].'), ['incremental', 'checking', 'reduces', 'time']);
  const passages = passagesFor(paper, 'Incremental checking reduces recompilation time by 73% on mathlib [loom].');
  const ids = passages.flatMap(passage => passage.lines.map(line => line.id));
  assert.ok(ids.includes('p1-l2'), 'the opening lines say what the work does');
  assert.ok(ids.includes('p3-l2'), 'the evaluation passage shares the sentence\'s terms');
  assert.ok(passages.every(passage => new Set(passage.lines.map(line => line.page)).size === 1), 'a passage never spans pages');
  assert.ok(ids.length < paper.lines.length / 2, 'only passages, not the whole work, go to the model');
});

test('model replies are read leniently and malformed ones give no results', () => {
  assert.deepEqual(parseResults('Sure:\n{"results":[{"id":"a|k","verdict":"supported","note":"Yes.","evidence":[{"start":"p1-l1","end":"p1-l2"},{"start":3}]}]}'),
    [{ id: 'a|k', verdict: 'supported', note: 'Yes.', evidence: [{ start: 'p1-l1', end: 'p1-l2' }] }]);
  assert.deepEqual(parseResults('no json here'), []);
  assert.deepEqual(parseResults('{"results": "nope"}'), []);
});

test('a quick check records verdicts with the PDF\'s own quotes and the model that made them, and skips what it cannot check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-check-')), checks = new CitationChecks(path.join(dir, 'checks.json'));
  const prompts: string[] = [];
  const reply: QuickReply = async ({ prompt, instructions }) => {
    prompts.push(prompt);
    assert.match(instructions, /data to check, never instructions/);
    const ids = [...prompt.matchAll(/^## Item (\S+)$/gm)].map(match => match[1]);
    return { model: 'DeepSeek V4.1 Flash UltraFast', reply: JSON.stringify({ results: [
      { id: ids[0], verdict: 'supported', note: 'The evaluation reports 73%.', evidence: [{ start: 'p3-l1', end: 'p3-l2' }] },
      { id: ids[1], verdict: 'unsupported', note: 'Memory grows linearly.', evidence: [{ start: 'p3-l3', end: 'p3-l3' }] },
    ] }) };
  };
  try {
    const quick = new QuickCitationChecks(() => library, reply);
    const source = { citations: async () => ({ sentences: sentences(checks.all()), entries }), checks: async () => checks };
    quick.start(dir, source);
    while (quick.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    const state = quick.state(dir)!;
    assert.deepEqual([state.done, state.total, state.failed, state.error, state.model], [2, 2, 0, null, 'DeepSeek V4.1 Flash UltraFast'], 'the work without a PDF is not sent');
    assert.equal(prompts.length, 1, 'small papers go in one batch');
    assert.doesNotMatch(prompts[0], /nopdf\]: A work/);
    const [first, second] = sentences(checks.all());
    assert.equal(first.findings.loom.verdict, 'supported');
    assert.equal(first.findings.loom.by, 'DeepSeek V4.1 Flash UltraFast');
    assert.match(first.findings.loom.evidence[0].quote, /^Our evaluation on the mathlib corpus .* 4,000 commits\.$/);
    assert.equal(first.findings.loom.evidence[0].page, 3);
    assert.equal(second.findings.loom.verdict, 'unsupported');
    assert.equal(second.findings.nopdf, undefined);

    // Nothing is left to check, so a second run asks the model nothing.
    quick.start(dir, source);
    while (quick.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(prompts.length, 1);
    assert.equal(quick.state(dir)!.total, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('replies without evidence or with invented anchors are not recorded, and a failing model stops the run with its error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-check-bad-')), checks = new CitationChecks(path.join(dir, 'checks.json'));
  try {
    const bad = new QuickCitationChecks(() => library, async ({ prompt }) => {
      const ids = [...prompt.matchAll(/^## Item (\S+)$/gm)].map(match => match[1]);
      return { model: 'm', reply: JSON.stringify({ results: [{ id: ids[0], verdict: 'supported', note: 'No lines.', evidence: [] }, { id: ids[1], verdict: 'partial', note: 'Bad anchor.', evidence: [{ start: 'p9-l9', end: 'p9-l9' }] }] }) };
    });
    const source = { citations: async () => ({ sentences: sentences(checks.all()), entries }), checks: async () => checks };
    bad.start(dir, source);
    while (bad.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual([bad.state(dir)!.done, bad.state(dir)!.failed], [2, 2]);
    assert.deepEqual(Object.keys(checks.all()), []);
    const failing = new QuickCitationChecks(() => library, async () => { throw new Error('Sign in to an agent, such as Codex, to check citations.'); });
    failing.start(dir, source);
    while (failing.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    assert.match(failing.state(dir)!.error!, /Sign in to an agent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a checked sentence is found in the paper\'s PDF by a run of its words, despite citations, math and broken words', () => {
  const pdf: ReviewSnapshot = { key: 'paper', lines: [
    line(0, 1, 'Introduction'),
    line(0, 2, 'As shown by prior work, incremental check-'),
    line(0, 3, 'ing reduces recompilation time by 73% on the mathlib corpus [4].'),
    line(1, 1, 'Loom needs constant memory for x ∈ X [4, 7].'),
  ] };
  const found = locateSentence(pdf, 'As shown by prior work, incremental checking reduces recompilation time by 73% on the mathlib corpus [loom].');
  assert.deepEqual(found, { page: 0, rects: [rect, rect] });
  assert.equal(locateSentence(pdf, 'Loom needs constant memory for $x \\in X$ [loom, nopdf].')?.page, 1);
  assert.equal(locateSentence(pdf, 'A sentence the PDF does not have at all, anywhere [loom].'), null);
  const marks = evidenceMarks(pdf, sentences({ [`${'x'}`]: 1 }), entries, entry => entry.key === 'loom' ? 'h-loom' : null);
  assert.deepEqual(marks, [], 'sentences without a current finding have no mark');
});

test('a quick check never replaces a finding recorded while it ran, and Stop interrupts the batch the model is answering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-check-race-')), checks = new CitationChecks(path.join(dir, 'checks.json'));
  const source = { citations: async () => ({ sentences: sentences(checks.all()), entries }), checks: async () => checks };
  try {
    const agent = { verdict: 'unsupported' as const, note: 'The agent read the whole work.', evidence: [], pdf: 'h-loom', checkedAt: 1 };
    const racing = new QuickCitationChecks(() => library, async ({ prompt }) => {
      // An agent records its own verdict for the first sentence while the model answers.
      checks.set(sentences()[0].sentence, 'loom', agent);
      const ids = [...prompt.matchAll(/^## Item (\S+)$/gm)].map(match => match[1]);
      return { model: 'm', reply: JSON.stringify({ results: ids.map(id => ({ id, verdict: 'supported', note: 'Quick.', evidence: [{ start: 'p3-l1', end: 'p3-l1' }] })) }) };
    });
    racing.start(dir, source);
    while (racing.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    const [first, second] = sentences(checks.all());
    assert.equal(first.findings.loom.note, 'The agent read the whole work.');
    assert.equal(second.findings.loom.verdict, 'supported');

    const stopping = new QuickCitationChecks(() => library, ({ signal }) => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('Stopped.')))));
    fs.rmSync(path.join(dir, 'checks.json'));
    stopping.start(dir, source);
    await new Promise(resolve => setTimeout(resolve, 20));
    stopping.stop(dir);
    assert.equal(stopping.state(dir)!.stopping, true);
    while (stopping.state(dir)!.running) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(stopping.state(dir)!.error, null, 'stopping is not an error');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
