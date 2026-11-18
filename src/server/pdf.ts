import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './paths.ts';
import { taskRoute } from './review.ts';

type Connect = (root: string) => Promise<{ get<T>(route: string): Promise<T> }>;

type Priority = 'foreground' | 'normal' | 'background';
const RANK: Record<Priority, number> = { background: 0, normal: 1, foreground: 2 };

// The complete PDF of one version of a paper, for the review's full paper. A
// round may compile only the changed chapters; this compiles them all, once.
// It can start before anyone asks, as soon as a round's new version exists;
// whoever then waits for it has it compile first and sees each TeX pass.
interface Paper {
  priority: Priority;
  following: boolean;
  // The passes shown so far, by number, while the PDF compiled.
  passes: Map<number, string>;
  pdf: string | null;
  key: string | null;
  errors?: string[];
  failure: Error | null;
  done: Promise<void>;
  changed: Set<() => void>;
}
const papers = new Map<string, Paper>();
// The same revision can be published with different engines, source roots,
// or fixed dates, and compile another root document of the repository. Each
// round's build keeps its PDF and passes independent.
const paperKey = (root: string, revision: string, buildKey?: string, document?: string) => JSON.stringify([root, revision, buildKey, document]);
// Compiled papers are remembered for the passes they showed, a few at a time.
const REMEMBERED = 32;

// A task compiles the root document it was started on (`document`).
async function builder(root: string, document?: string) {
  const [{ Builder }, { Repo }, { projectFor }] = await Promise.all([
    import(pathToFileURL(path.join(ENGINE, 'src/core/build.ts')).href),
    import(pathToFileURL(path.join(ENGINE, 'src/core/git.ts')).href),
    import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href),
  ]);
  // A main file renamed since compiles as the current document, as the engine does.
  return new Builder(projectFor(root, document), new Repo(root));
}

const notFound = () => Object.assign(new Error('Review resource not found.'), { statusCode: 404 });
const changed = (paper: Paper) => { for (const notify of [...paper.changed]) notify(); };
export interface PaperBuild { key: string; pdf: string; errors?: string[] }
const resultOf = (paper: Paper): PaperBuild => ({ key: paper.key!, pdf: paper.pdf!, ...(paper.errors?.length ? { errors: paper.errors } : {}) });
const available = (paper: Paper) => paper.pdf ? fs.promises.access(paper.pdf).then(() => true, () => false) : Promise.resolve(false);

/** Starts compiling the complete PDF of `revision`, or has the build already
 *  under way run at `priority` and, with `follow`, show its passes. */
export function preparePaper(root: string, revision: string, priority: Priority = 'normal', follow = false, buildKey?: string, document?: string): Paper {
  const key = paperKey(root, revision, buildKey, document);
  let paper = papers.get(key);
  const compile = (target: Paper, wanted: Priority, watch: boolean) => builder(root, document).then(b => b.build(revision, ['full'], null, {
    priority: wanted,
    ...(watch ? {
      pass: (preview: { pass: number; pdf: string }) => {
        if (target.pdf || target.passes.has(preview.pass)) return;
        target.passes.set(preview.pass, preview.pdf);
        changed(target);
      },
    } : {}),
  })) as Promise<PaperBuild>;
  if (paper) {
    papers.delete(key);
    papers.set(key, paper);
    if (!paper.pdf && !paper.failure && (RANK[priority] > RANK[paper.priority] || (follow && !paper.following))) {
      if (RANK[priority] > RANK[paper.priority]) paper.priority = priority;
      paper.following ||= follow;
      void compile(paper, paper.priority, follow).catch(() => undefined);
    }
    return paper;
  }
  const created: Paper = { priority, following: follow, passes: new Map(), pdf: null, key: null, failure: null, done: Promise.resolve(), changed: new Set() };
  created.done = compile(created, priority, follow).then(
    result => { created.pdf = result.pdf; created.key = result.key; created.errors = result.errors; },
    error => {
      created.failure = error instanceof Error ? error : new Error(String(error));
      // A later request compiles it again.
      if (papers.get(key) === created) papers.delete(key);
    },
  ).finally(() => changed(created));
  papers.set(key, created);
  for (const old of papers.keys()) {
    if (papers.size <= REMEMBERED) break;
    if (papers.get(old)!.pdf) papers.delete(old);
  }
  return created;
}

// Remember completed rounds; a pending round gains its build keys later.
// Only the versions and builds: a round's detail also carries every change.
interface RoundInfo { before: string; after: string; build?: { key: string; targets: string[] }; builds?: string[]; document?: string }
const rounds = new Map<string, Promise<RoundInfo>>();
function roundInfo(connect: Connect, root: string, name: string, round: number) {
  const key = JSON.stringify([root, name, round]);
  let found = rounds.get(key);
  if (!found) {
    found = connect(root)
      .then(client => client.get<RoundInfo & { rendering?: string }>(`${taskRoute(name)}/rounds/${round}`))
      .then((detail): RoundInfo => {
        const { before, after, build, builds, document, rendering } = detail ?? {};
        if (typeof before !== 'string' || typeof after !== 'string') throw notFound();
        if (rendering) rounds.delete(key);
        return { before, after, build, builds, ...(typeof document === 'string' ? { document } : {}) };
      });
    rounds.set(key, found);
    found.catch(() => rounds.delete(key));
    if (rounds.size > 256) rounds.delete(rounds.keys().next().value!);
  }
  return found;
}

// The round's own PDF when it compiled only the changed chapters: their pages
// with the changes, exactly where its strips come from, at once.
async function chaptersBuild(root: string, info: RoundInfo): Promise<PaperBuild | null> {
  if (!info.build || !/^[0-9a-f]{32}$/.test(info.build.key) || JSON.stringify(info.build.targets) === '["full"]') return null;
  const { loadProject } = await import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href);
  try {
    const result = JSON.parse(await fs.promises.readFile(path.join(loadProject(root).state, 'cache/builds', info.build.key, 'result.json'), 'utf8')) as { pdf?: unknown; errors?: string[] };
    if (typeof result.pdf !== 'string') return null;
    await fs.promises.access(result.pdf);
    return { key: info.build.key, pdf: result.pdf, ...(result.errors?.length ? { errors: result.errors } : {}) };
  } catch { return null; }
}
const chaptersPdf = async (root: string, info: RoundInfo) => (await chaptersBuild(root, info))?.pdf ?? null;

// A round that compiled the whole paper published its complete PDF of the
// new version. The full paper shows that build rather than compiling the same
// version again under another cache key, one without the round's fixed date.
const adopting = new Map<string, Promise<void>>();
function adopt(root: string, revision: string, info: RoundInfo, side: 'before' | 'after' = 'after') {
  const keyForSide = side === 'before' ? info.builds?.at(-2) : info.build?.key;
  const build = info.build && keyForSide ? { ...info.build, key: keyForSide } : undefined;
  if (!build || JSON.stringify(build.targets) !== '["full"]' || !/^[0-9a-f]{32}$/.test(build.key)) return Promise.resolve();
  const key = paperKey(root, revision, build.key, info.document);
  if (papers.has(key)) return Promise.resolve();
  let found = adopting.get(key);
  if (!found) {
    found = (async () => {
      const b = await builder(root, info.document);
      const [published, tree] = await Promise.all([b.completed(build.key), b.repo.treeIdAsync(revision, b.project.source_dir)]);
      // Only that very version: a round's build of another tree, such as an
      // empty round's baseline, is not this revision's PDF.
      if (!published || published.tree !== tree || JSON.stringify(published.targets) !== '["full"]') return;
      if (papers.has(key)) return;
      papers.set(key, { priority: 'foreground', following: false, passes: new Map(), pdf: published.pdf, key: published.key, errors: published.errors, failure: null, done: Promise.resolve(), changed: new Set() });
    })().catch(() => undefined).finally(() => adopting.delete(key));
    adopting.set(key, found);
  }
  return found;
}

async function ready(root: string, revision: string, follow = false, priority: Priority = 'foreground', buildKey?: string, document?: string) {
  const key = paperKey(root, revision, buildKey, document);
  for (let attempt = 0; ; attempt++) {
    const paper = preparePaper(root, revision, priority, follow, buildKey, document);
    await paper.done;
    if (paper.failure) throw paper.failure;
    // The build cache may have removed an old PDF meanwhile.
    if (await available(paper)) return resultOf(paper);
    if (attempt) throw notFound();
    if (papers.get(key) === paper) papers.delete(key);
  }
}

/** The complete PDF of a round's version, once it has compiled. */
export async function fullPaperPdf(connect: Connect, root: string, name: string, round: number, side: 'before' | 'after'): Promise<string> {
  const info = await roundInfo(connect, root, name, round);
  await adopt(root, info[side], info, side);
  const buildKey = side === 'before' ? info.builds?.at(-2) ?? info.build?.key : info.build?.key;
  return (await ready(root, info[side], false, 'foreground', buildKey, info.document)).pdf;
}

/** A round's already-compiled PDF for the retained fallback reader, or a
 *  background build when neither the full paper nor changed chapters exist. */
export async function retainedPaperBuild(connect: Connect, root: string, name: string, round: number): Promise<PaperBuild> {
  const info = await roundInfo(connect, root, name, round);
  await adopt(root, info.after, info);
  const existing = papers.get(paperKey(root, info.after, info.build?.key, info.document));
  if (existing && await available(existing)) return resultOf(existing);
  const chapters = await chaptersBuild(root, info);
  if (chapters) return chapters;
  return ready(root, info.after, false, 'background', info.build?.key, info.document);
}
export const retainedPaperPdf = async (connect: Connect, root: string, name: string, round: number) => (await retainedPaperBuild(connect, root, name, round)).pdf;

/** An immutable build identified by a reader's metadata, never a replacement
 *  compiled after that metadata was sent. */
export async function paperBuildPdf(connect: Connect, root: string, name: string, round: number, key: string, side: 'before' | 'after' = 'after'): Promise<string> {
  const info = await roundInfo(connect, root, name, round), b = await builder(root, info.document),
    [built, tree] = await Promise.all([b.completed(key), b.repo.treeIdAsync(info[side], b.project.source_dir)]),
    roundKey = side === 'before' ? info.builds?.at(-2) : info.build?.key;
  if (!built || built.tree !== tree || (JSON.stringify(built.targets) !== '["full"]' && key !== roundKey)) throw notFound();
  return built.pdf;
}

interface PaperPass { pass?: number | null; key?: string; errors?: string[] }
const complete = (paper: Paper): PaperPass => ({ pass: null, key: paper.key!, ...(paper.errors?.length ? { errors: paper.errors } : {}) });

/** What the review's full paper shows next, after version `after`: a later
 *  version, `null` once the complete PDF is ready, or nothing when `wait`
 *  ends first. Until then it shows the round's changed chapters (version 1
 *  when the round compiled only those), then each TeX pass of the whole. */
export async function nextPaperPass(connect: Connect, root: string, name: string, round: number, after: number, wait = 20000): Promise<PaperPass> {
  const info = await roundInfo(connect, root, name, round), chapters = await chaptersBuild(root, info), offset = chapters ? 1 : 0;
  await adopt(root, info.after, info);
  if (chapters && after < 1) {
    // A complete PDF that is already there, or nearly, comes first.
    const paper = preparePaper(root, info.after, 'foreground', true, info.build?.key, info.document);
    await Promise.race([paper.done, new Promise(resolve => setTimeout(resolve, 300))]);
    if (await available(paper)) return complete(paper);
    if (paper.pdf) {
      const key = paperKey(root, info.after, info.build?.key, info.document);
      if (papers.get(key) === paper) papers.delete(key);
      preparePaper(root, info.after, 'foreground', true, info.build?.key, info.document);
    }
    return { pass: 1, key: chapters.key, ...(chapters.errors?.length ? { errors: chapters.errors } : {}) };
  }
  const next = await nextPass(root, info.after, Math.max(0, after - offset), wait, info.build?.key, info.document);
  return typeof next.pass === 'number' ? { pass: next.pass + offset } : next;
}
export async function nextPass(root: string, revision: string, after: number, wait = 20000, buildKey?: string, document?: string): Promise<PaperPass> {
  let paper = preparePaper(root, revision, 'foreground', true, buildKey, document);
  const key = paperKey(root, revision, buildKey, document), deadline = Date.now() + wait;
  for (;;) {
    if (paper.failure) throw paper.failure;
    if (paper.pdf) {
      if (await available(paper)) return complete(paper);
      if (papers.get(key) === paper) papers.delete(key);
      paper = preparePaper(root, revision, 'foreground', true, buildKey, document);
    }
    const newest = Math.max(0, ...paper.passes.keys());
    if (newest > after) return { pass: newest };
    const left = deadline - Date.now();
    if (left <= 0) return {};
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); paper.changed.delete(done); resolve(); };
      const timer = setTimeout(done, left);
      paper.changed.add(done);
    });
  }
}

/** The PDF of a version that `nextPaperPass` named. */
export async function paperPassPdf(connect: Connect, root: string, name: string, round: number, pass: number) {
  const info = await roundInfo(connect, root, name, round), chapters = await chaptersPdf(root, info);
  if (chapters && pass === 1) return chapters;
  return passPdf(root, info.after, pass - (chapters ? 1 : 0), info.build?.key, info.document);
}
export function passPdf(root: string, revision: string, pass: number, buildKey?: string, document?: string) {
  const pdf = papers.get(paperKey(root, revision, buildKey, document))?.passes.get(pass);
  if (!pdf) throw notFound();
  return pdf;
}

/** The complete PDF of `revision`, once it has compiled. */
export const paperPdf = async (root: string, revision: string, follow = false, priority: Priority = 'foreground', buildKey?: string, document?: string) => (await ready(root, revision, follow, priority, buildKey, document)).pdf;
