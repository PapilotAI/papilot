import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { merge3Async } from '../../engine/src/core/git.ts';
import { atomicWrite } from '../../engine/src/core/files.ts';
import { realPath } from './real-path.ts';

export type WorkflowEdit = { cwd: string; files: string[] };
/** What one worker changed in its copy, before it is merged into the task. */
export type WorkflowChange = { file: string; diff: string };
type Source = { file: string; source: string };
const integrations = new Map<string, Promise<void>>();
const invalid = () => new Error('Delegated edits must stay within the selected source files.');

// Do not follow links when copying a source or reading a worker's output.
// A canonical root also coalesces callers using different worktree aliases.
function sourceFile(root: string, file: string, missing = false) {
  const parts = file.split(/[\\/]/);
  if (path.isAbsolute(file) || parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw invalid();
  let target = root;
  for (let index = 0; index < parts.length; index++) {
    target = path.join(target, parts[index]);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(target); }
    catch (error) { if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw invalid();
  }
  const stat = fs.statSync(target), bytes = fs.readFileSync(target);
  if (bytes.includes(0)) throw invalid();
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw invalid(); }
  return { target, bytes, mode: stat.mode, identity: `${stat.dev}:${stat.ino}` };
}

// Models work concurrently. Only the short read/merge/write integration is
// serialized, using the same three-way/word merge as manuscript delivery.
async function integrate<T>(root: string, work: () => Promise<T>) {
  const previous = integrations.get(root) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => next);
  integrations.set(root, tail);
  await previous;
  try { return await work(); }
  finally { release(); if (integrations.get(root) === tail) integrations.delete(root); }
}

export interface WorkflowConflict { file: string; base: string; current: string | null; incoming: string; candidate: string | null }

/** Atomically three-way merge isolated base->after file edits into `root`. */
export async function mergeWorkflowFiles(
  root: string,
  base: Record<string, string>,
  next: Record<string, string>,
  signal: AbortSignal,
  current: () => boolean,
  integrated?: () => void,
): Promise<{ status: 'applied' | 'conflict' | 'unchanged'; appliedFiles: string[]; conflicts: WorkflowConflict[] }> {
  const baseRoot = realPath(root);
  const active = () => { signal.throwIfAborted(); if (!current() || realPath(root) !== baseRoot) throw new Error('The workflow is no longer active.'); };
  active();
  const changes = Object.keys(base)
    .map(file => ({ file: file.replaceAll('\\', '/').replace(/^\.\//, ''), before: Buffer.from(base[file], 'utf8'), after: Buffer.from(next[file] ?? base[file], 'utf8') }))
    .filter(change => !change.before.equals(change.after));
  if (changes.some(change => change.after.includes(0))) throw invalid();
  if (!changes.length) return { status: 'unchanged', appliedFiles: [], conflicts: [] };
  return await integrate(baseRoot, async () => {
    active();
    const conflicts: WorkflowConflict[] = [];
    const writes: { file: string; target: string; before: Buffer; after: Buffer; mode: number }[] = [];
    for (const change of changes) {
      const now = sourceFile(baseRoot, change.file, true);
      const [merged, conflict] = await merge3Async(now?.bytes || null, change.before, change.after);
      active();
      if (conflict) conflicts.push({ file: change.file, base: change.before.toString('utf8'), current: now?.bytes.toString('utf8') ?? null, incoming: change.after.toString('utf8'), candidate: merged?.toString('utf8') ?? null });
      else if (now && merged && !now.bytes.equals(merged)) writes.push({ file: change.file, target: now.target, before: now.bytes, after: merged, mode: now.mode });
    }
    active();
    for (const write of writes) {
      const now = sourceFile(baseRoot, write.file, true);
      if (!now || now.mode !== write.mode || !now.bytes.equals(write.before)) throw new Error('The source changed while merging delegated edits. Retry the delegation.');
    }
    const written: typeof writes = [];
    try { for (const write of writes) { atomicWrite(write.target, write.after, write.mode & 0o7777); written.push(write); } }
    catch (error) { for (const write of written.reverse()) { const now = sourceFile(baseRoot, write.file, true); if (now?.bytes.equals(write.after)) atomicWrite(write.target, write.before, write.mode & 0o7777); } throw error; }
    integrated?.();
    return { status: conflicts.length ? 'conflict' : writes.length ? 'applied' : 'unchanged', appliedFiles: writes.map(write => write.file), conflicts };
  });
}

/** Run an edit worker in an isolated temp copy and return its modified files without merging yet. */
export async function captureWorkflowEdits(
  root: string,
  sources: Source[],
  run: (edit: WorkflowEdit) => Promise<string>,
  signal: AbortSignal,
  current: () => boolean,
  changed?: (changes: WorkflowChange[]) => void,
): Promise<{ summary: string; base: Record<string, string>; files: Record<string, string>; changes: WorkflowChange[] }> {
  const baseRoot = realPath(root);
  const active = () => { signal.throwIfAborted(); if (!current() || realPath(root) !== baseRoot) throw new Error('The workflow is no longer active.'); };
  active();
  const base = new Map<string, Buffer>();
  const identities = new Map<string, string>();
  for (const source of sources) {
    if (path.sep !== '\\' && source.file.includes('\\')) throw invalid();
    const file = source.file.replaceAll('\\', '/').replace(/^\.\//, '');
    const entry = sourceFile(baseRoot, file)!;
    if (identities.has(entry.identity) && identities.get(entry.identity) !== file) throw invalid();
    identities.set(entry.identity, file);
    if (entry.bytes.toString('utf8') !== source.source) throw new Error('The source changed while preparing delegated edits.');
    base.set(file, entry.bytes);
  }
  const cwd = realPath(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workflow-edit-')));
  try {
    for (const [file, bytes] of base) { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), bytes); }
    const copies = new Set<string>();
    for (const [file, bytes] of base) {
      const copy = sourceFile(cwd, file)!;
      if (copies.has(copy.identity) || !copy.bytes.equals(bytes)) throw invalid();
      copies.add(copy.identity);
    }
    const summary = await run({ cwd, files: [...base.keys()] });
    active();
    const inspect = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name), relative = path.relative(cwd, target).split(path.sep).join('/');
        if (entry.isDirectory()) inspect(target);
        else if (!entry.isFile() || !base.has(relative)) throw invalid();
      }
    };
    inspect(cwd);
    const baseRecord: Record<string, string> = {};
    const filesRecord: Record<string, string> = {};
    const rawChanges: WorkflowChange[] = [];
    for (const [file, before] of base) {
      const after = sourceFile(cwd, file)!.bytes;
      baseRecord[file] = before.toString('utf8');
      filesRecord[file] = after.toString('utf8');
      if (!before.equals(after)) {
        rawChanges.push({ file, diff: createTwoFilesPatch(file, file, baseRecord[file], filesRecord[file], '', '', { context: 2 }).split('\n').slice(2).join('\n') });
      }
    }
    changed?.(rawChanges);
    return { summary, base: baseRecord, files: filesRecord, changes: rawChanges };
  } finally { await fs.promises.rm(cwd, { recursive: true, force: true, maxRetries: 5 }); }
}

export async function editWorkflowSources(root: string, sources: Source[], run: (edit: WorkflowEdit) => Promise<string>, signal: AbortSignal, current: () => boolean, changed?: (changes: WorkflowChange[]) => void, integrated?: () => void) {
  const baseRoot = realPath(root);
  const active = () => { signal.throwIfAborted(); if (!current() || realPath(root) !== baseRoot) throw new Error('The workflow is no longer active.'); };
  active();
  const base = new Map<string, Buffer>();
  const identities = new Map<string, string>();
  for (const source of sources) {
    if (path.sep !== '\\' && source.file.includes('\\')) throw invalid();
    const file = source.file.replaceAll('\\', '/').replace(/^\.\//, '');
    const entry = sourceFile(baseRoot, file)!;
    if (identities.has(entry.identity) && identities.get(entry.identity) !== file) throw invalid();
    identities.set(entry.identity, file);
    if (entry.bytes.toString('utf8') !== source.source) throw new Error('The source changed while merging delegated edits. Retry the delegation.');
    base.set(file, entry.bytes);
  }
  const cwd = realPath(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workflow-edit-')));
  try {
    for (const [file, bytes] of base) { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), bytes); }
    // A manuscript and the temp volume may differ in case/Unicode handling.
    // Reject collapsed names before a worker sees an overwritten snapshot.
    const copies = new Set<string>();
    for (const [file, bytes] of base) {
      const copy = sourceFile(cwd, file)!;
      if (copies.has(copy.identity) || !copy.bytes.equals(bytes)) throw invalid();
      copies.add(copy.identity);
    }
    const summary = await run({ cwd, files: [...base.keys()] });
    active();
    const inspect = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name), relative = path.relative(cwd, target).split(path.sep).join('/');
        if (entry.isDirectory()) inspect(target);
        else if (!entry.isFile() || !base.has(relative)) throw invalid();
      }
    };
    inspect(cwd);
    const changes = [...base].map(([file, before]) => ({ file, before, after: sourceFile(cwd, file)!.bytes })).filter(change => !change.before.equals(change.after));
    changed?.(changes.map(({ file, before, after }) => ({ file, diff: createTwoFilesPatch(file, file, before.toString('utf8'), after.toString('utf8'), '', '', { context: 2 }).split('\n').slice(2).join('\n') })));
    return await integrate(baseRoot, async () => {
      active();
      const conflicts: { file: string; base: string; current: string | null; incoming: string; candidate: string | null }[] = [];
      const writes: { file: string; target: string; before: Buffer; after: Buffer; mode: number }[] = [];
      for (const change of changes) {
        const now = sourceFile(baseRoot, change.file, true);
        const [merged, conflict] = await merge3Async(now?.bytes || null, change.before, change.after);
        active();
        if (conflict) conflicts.push({ file: change.file, base: change.before.toString('utf8'), current: now?.bytes.toString('utf8') ?? null, incoming: change.after.toString('utf8'), candidate: merged?.toString('utf8') ?? null });
        else if (now && merged && !now.bytes.equals(merged)) writes.push({ file: change.file, target: now.target, before: now.bytes, after: merged, mode: now.mode });
      }
      // Nothing yields between the final validation and atomic file replacements.
      // This also catches independent coordinator/editor writes during merge3Async.
      active();
      for (const write of writes) {
        const now = sourceFile(baseRoot, write.file, true);
        if (!now || now.mode !== write.mode || !now.bytes.equals(write.before)) throw new Error('The source changed while merging delegated edits. Retry the delegation.');
      }
      const written: typeof writes = [];
      try { for (const write of writes) { atomicWrite(write.target, write.after, write.mode & 0o7777); written.push(write); } }
      catch (error) { for (const write of written.reverse()) { const now = sourceFile(baseRoot, write.file, true); if (now?.bytes.equals(write.after)) atomicWrite(write.target, write.before, write.mode & 0o7777); } throw error; }
      // Edits are committed now; cancellation must stop being offered before
      // asynchronous cleanup yields while the integrated result is retained.
      integrated?.();
      return { status: conflicts.length ? 'conflict' : writes.length ? 'applied' : 'unchanged', appliedFiles: writes.map(write => write.file), conflicts, summary };
    });
  } finally { await fs.promises.rm(cwd, { recursive: true, force: true, maxRetries: 5 }); }
}
