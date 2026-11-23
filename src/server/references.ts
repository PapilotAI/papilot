import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, ENGINE } from './paths.ts';
import { stateDir } from './state.ts';
import { Library, type LibraryInput } from './library.ts';
import { ReviewSnapshots } from './review-snapshot.ts';
import { CitationChecks, citingReport, recordCitation, type CitationRecord } from './citations.ts';
import type { BibliographyReport, CitingSentence, LibraryReport, ReferenceCheck } from '../shared.ts';

// The paper's bibliography as it is on disk: every entry, where it is cited,
// what is wrong with it without looking anything up, and, when asked, what
// Crossref, DBLP and arXiv know of it. The review engine does the reading
// and the checking; this is where Papilot asks it for a whole paper.

type Input = { id: string; type: string; fields: Record<string, string> };
interface Checker { lookup(inputs: Input[], start?: boolean, retry?: boolean): { checks: Record<string, ReferenceCheck>; pending: number } }
interface Confirmations { of(inputs: Input[]): Record<string, number>; set(input: Input, on: boolean): void }
interface Engine {
  bibliographyReport(doc: { read(file: string): string | null; main: string; outline: unknown[] }): Omit<BibliographyReport, 'checks' | 'pending' | 'confirmed'>;
  citingSentences(doc: { read(file: string): string | null; main: string; outline: unknown[] }): Omit<CitingSentence, 'id' | 'findings'>[];
  buildOutline(read: (file: string) => string | null, main: string): { nodes: unknown[] };
  loadProject(root: string): { main: string };
  checkInputs(references: unknown): Input[];
  entryInputs(entries: unknown[]): Input[];
  ReferenceChecker: new (file: string) => Checker;
  Confirmations: new (file: string) => Confirmations;
  Repo: new (root: string) => { gitDir(): string; textAsync(args: string[]): Promise<string> };
}
let loading: Promise<Engine> | undefined;
export function engine(): Promise<Engine> {
  const load = (file: string) => import(pathToFileURL(path.join(ENGINE, file)).href);
  loading ??= Promise.all(['src/core/bib.ts', 'src/core/outline.ts', 'src/core/config.ts', 'src/core/verify.ts', 'src/core/git.ts'].map(load))
    .then(modules => Object.assign({}, ...modules) as Engine);
  return loading;
}
// One checker for Papilot's process, so that the panel and the review of
// uncommitted changes share their results and their file.
let shared: Checker | undefined;
export async function checker(file = path.join(DATA, 'references.json')) {
  const { ReferenceChecker } = await engine();
  return shared ??= new ReferenceChecker(file);
}
// Confirmations live beside the review engine's state in the repository, so
// a task's review, the uncommitted changes and this panel agree.
const gitDirs = new Map<string, Promise<string>>();
// The panel polls while a check runs; the Git directory is looked up once.
async function gitDir(root: string) {
  const { Repo } = await engine();
  let dir = gitDirs.get(root);
  if (!dir) {
    const found = new Repo(root).textAsync(['rev-parse', '--absolute-git-dir']).then(folder => fs.promises.realpath(folder));
    found.catch(() => gitDirs.delete(root));
    gitDirs.set(root, dir = found);
  }
  return dir;
}
export async function confirmations(root: string) {
  const { Confirmations } = await engine();
  return new Confirmations(path.join(await stateDir(await gitDir(root)), 'references-confirmed.json'));
}
/** What agents found of the paper's citations, beside its confirmations. */
export async function citationChecks(root: string) {
  return new CitationChecks(path.join(await stateDir(await gitDir(root)), 'citation-checks.json'));
}

// A file of the paper, read only from inside its folder.
function reader(root: string) {
  const base = fs.realpathSync(root);
  return (file: string) => {
    const target = path.resolve(base, file);
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    try { return fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null; } catch { return null; }
  };
}
async function report(root: string) {
  const mods = await engine(), read = reader(root), { main } = mods.loadProject(root);
  const doc = { read, main, outline: mods.buildOutline(read, main).nodes };
  const result = mods.bibliographyReport(doc);
  return { result, inputs: mods.entryInputs(result.entries), sentences: mods.citingSentences(doc) };
}

export async function confirmEntry(root: string, id: string, on: boolean) {
  const { inputs } = await report(root), input = inputs.find(item => item.id === id);
  if (!input) throw Object.assign(new Error('This entry is no longer in the bibliography. Refresh the panel.'), { statusCode: 404 });
  (await confirmations(root)).set(input, on);
}

// One library for every paper, with its own PDF reader so that reading a
// long list of papers never holds up an AI review.
let sharedLibrary: { library: Library; snapshots: ReviewSnapshots } | undefined;
export function library(dir = path.join(DATA, 'library')) {
  if (!sharedLibrary) { const snapshots = new ReviewSnapshots(); sharedLibrary = { library: new Library(dir, { snapshots }), snapshots }; }
  return sharedLibrary.library;
}
export async function stopLibrary() {
  const stopping = sharedLibrary;
  sharedLibrary = undefined;
  stopping?.library.stop();
  await stopping?.snapshots.stop();
}

export interface LibraryOptions { online: boolean; zotero: boolean; retry?: boolean; poll?: boolean }
/** The paper's entries with the online checks already made, which say
 * which work an entry without an identifier is. */
export async function libraryInputs(root: string, online: boolean, retry = false) {
  const { result, inputs, sentences } = await report(root);
  const looked = (await checker()).lookup(inputs, online, retry);
  const keys = new Map(result.entries.map(entry => [entry.id, entry.key]));
  return { result, inputs, looked, sentences, entries: inputs.map(input => ({ ...input, key: keys.get(input.id) ?? '', check: looked.checks[input.id] })) as LibraryInput[] };
}

/** The paper's citing sentences with what agents found of each work they
 * cite, judged against the PDF the library has of it now. */
export async function citations(root: string, store = library()) {
  const { sentences, entries } = await libraryInputs(root, false);
  const pdfOf = (key: string) => { const input = entries.find(entry => entry.key === key); return (input && store.pdfOf(input)?.hash) ?? null; };
  return { sentences: citingReport(sentences, (await citationChecks(root)).all(), pdfOf), entries };
}
/** Forget what was found for a work a sentence cites, for the author who
 * judges it otherwise. */
export async function forgetFinding(root: string, id: string, key: string, store = library()) {
  const sentence = (await citations(root, store)).sentences.find(item => item.id === id);
  if (!sentence) throw Object.assign(new Error('This sentence is no longer in the paper. Refresh the library.'), { statusCode: 404 });
  (await citationChecks(root)).remove(sentence.sentence, key);
}
/** Record what an agent found for a work one of the paper's sentences cites. */
export async function recordFinding(root: string, record: CitationRecord, store = library()) {
  const { sentences, entries } = await citations(root, store);
  return recordCitation(sentences, entries, store, await citationChecks(root), record);
}

/** The bibliography with every entry's PDF, starting the work that finds
 * missing PDFs. Online, entries are also checked against their records. */
export async function libraryReport(root: string, options: LibraryOptions, store = library()): Promise<LibraryReport> {
  const { result, inputs, looked, entries, sentences } = await libraryInputs(root, options.online, options.retry);
  const found = store.status(entries, options);
  const pdfOf = (key: string) => { const entry = result.entries.find(item => item.key === key); return (entry && found.entries[entry.id]?.pdf?.hash) ?? null; };
  return { ...result, ...looked, confirmed: (await confirmations(root)).of(inputs), library: found, citations: citingReport(sentences, (await citationChecks(root)).all(), pdfOf) };
}
