import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { ChildProcess } from "node:child_process";
import { cleanPath, Repo } from "./git.ts";
import { readJson, writeJsonAsync, withLock, now } from "./files.ts";
import { stripComments } from "./outline.ts";
import { signature, type Project } from "./config.ts";
import { Cancelled, ProcessError, capture, commandVersion, runAsync } from "./process.ts";
import { Lease } from "./pool.ts";
import { progressReader, writtenPages } from "./progress.ts";
import { unwrapLog } from "./tex-log.ts";
import type { BuildInfo, BuildProgress } from "../types.ts";
export class BuildError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
    public log?: string,
  ) {
    super(message);
  }
}
function tikzDirectory(file: string) {
  const parent = path.posix.dirname(file.replaceAll("\\", "/"));
  if (parent === "." || /[\x00-\x1f<>:"|?*]/.test(parent)) return null;
  try {
    const dir = cleanPath(parent);
    return dir && !dir.split("/").some(part => /[. ]$/.test(part)) ? dir : null;
  } catch {
    return null;
  }
}
function relativeInside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ? null : relative;
}
async function prepareBuildDirectory(root: string, directory: string) {
  const relative = relativeInside(root, directory);
  if (relative === null) return false;
  if (!relative) return true;
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!stat) {
      await fs.promises.mkdir(directory, { recursive: true });
      return true;
    }
    if (stat.isSymbolicLink()) {
      const [snapshot, target] = await Promise.all([
        fs.promises.realpath(root),
        fs.promises.realpath(current).catch(() => null),
      ]);
      if (!target || relativeInside(snapshot, target) === null || !(await fs.promises.stat(target)).isDirectory()) return false;
    } else if (!stat.isDirectory()) return false;
  }
  return true;
}
const AUXILIARY = new Set([
  ".aux",
  ".bbl",
  ".brf",
  ".toc",
  ".lof",
  ".lot",
  ".loe",
  ".out",
  ".thm",
  ".nav",
  ".snm",
]);
// Recovery follows the output directory, not AUXILIARY's seed-copy list:
// packages write their own list/cache extensions there. Source errors and
// interrupted compilers must keep their original failure.
export function auxiliaryBuildError(error: unknown): error is BuildError {
  return error instanceof BuildError && auxiliaryDiagnostics(error.details);
}
export function auxiliaryDiagnostics(details: readonly string[] = []) {
  return details.some((line) => {
    // Read only the diagnostic's filename, never a path quoted in its message.
    const file = /^([^\r\n]+?):\d+:/.exec(line)?.[1];
    if (!file) return false;
    const normalized = path.posix.normalize(file.replaceAll("\\", "/")),
      absolute = path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized);
    // latexmk always uses -outdir=build. Relative source paths such as
    // chapters/build/example.tex and build/../main.tex are not its output.
    return normalized.startsWith("build/") || (absolute && normalized.includes("/build/"));
  });
}
// Output that TeX writes for this folder: SyncTeX data and the log name its
// absolute path.
const OUTPUT = /\.(?:pdf|xdv|dvi|log|synctex(?:\.gz)?)$/i;
const unzip = promisify(gunzip), zip = promisify(gzip);
async function clone(file: string, target: string) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(file, target, fs.constants.COPYFILE_FICLONE);
}
// Every file below a folder, read without blocking the event loop.
async function filesIn(root: string): Promise<string[]> {
  let items: fs.Dirent[];
  try { items = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return []; }
  return (await Promise.all(items.map((e) => e.isDirectory() ? filesIn(path.join(root, e.name)) : [path.join(root, e.name)]))).flat();
}
// Output that latexmk kept from an earlier build folder still names that
// folder. Build folders differ only in their equal-length key, so the paths
// are replaced in place without moving anything else in the file.
export async function relocate(file: string, from: string, to: string) {
  // Cache keys are ASCII even when TeX writes the shared parent directory in
  // a Windows ANSI code page. Match that unique path component so relocation
  // preserves the original encoding, including in files reused without TeX.
  const keys = path.dirname(from) === path.dirname(to)
    && [path.basename(from), path.basename(to)].every(name => /^[a-f0-9]{32}$/.test(name));
  const old = Buffer.from((keys ? "/" + path.basename(from) : from.replaceAll("\\", "/")) + "/"),
    next = Buffer.from((keys ? "/" + path.basename(to) : to.replaceAll("\\", "/")) + "/");
  if (old.length !== next.length || old.equals(next)) return;
  let data: Buffer;
  try { data = await fs.promises.readFile(file); }
  catch { return; }
  const zipped = file.endsWith(".gz");
  if (zipped) data = await unzip(data);
  let at = data.indexOf(old);
  if (at < 0) return;
  for (; at >= 0; at = data.indexOf(old, at + next.length)) next.copy(data, at);
  await fs.promises.writeFile(file, zipped ? await zip(data, { level: 1 }) : data);
}
/** How much a build matters to the person waiting: the PDF on screen comes
 *  first, a speculative build last. */
export type BuildPriority = "foreground" | "normal" | "background";
/** A priority, or how to find the current one: a review build matters more
 *  while its page is open, and less once a newer round supersedes it. */
export type WantedPriority = BuildPriority | (() => BuildPriority);
const RANK: Record<BuildPriority, number> = { background: 0, normal: 1, foreground: 2 };
const current = (priority: WantedPriority) => (typeof priority === "function" ? priority() : priority);
interface Active {
  key: string;
  priority: BuildPriority;
  child?: ChildProcess;
  // Its share of the TeX pool, while the compiler runs or waits to.
  lease?: Lease;
  paused: boolean;
  // Who is shown each pass, and the latest pass that more work followed.
  watchers: Set<(preview: PassPreview) => void>;
  followed?: () => void;
  progress?: BuildProgress;
}
const active = new Set<Active>();
// Everyone in this process who waits for each build key. A build runs at the
// highest priority among them and shows its passes to all of them, also to
// those who asked before it started compiling.
interface Waiter { priority: WantedPriority; pass?: (preview: PassPreview) => void; progress?: (progress: BuildProgress) => void }
const waiting = new Map<string, Set<Waiter>>();
const building = new Map<string, Promise<BuildInfo>>();
// Stops the compilation under way for a key, once nobody waits for it.
const stops = new Map<string, AbortController>();
// Every build runs at full speed on its slot of the TeX pool, whatever its
// priority: TeX is single-threaded, and the pool bounds how many run at once.
// A build stops (SIGSTOP) only while its slot is lent to one that matters
// more and found no free slot (pool.ts), and continues when that one is done.
function schedule() {
  if (process.platform === "win32") return;
  for (const build of active) {
    const pause = Boolean(build.lease?.lent || build.lease?.revoked);
    if (pause === build.paused || !build.child?.pid || build.child.exitCode !== null) continue;
    try {
      process.kill(-build.child.pid, pause ? "SIGSTOP" : "SIGCONT");
      build.paused = pause;
      build.lease?.pause(pause);
    } catch { /* The compiler has exited. */ }
  }
}
function promote(key: string, priority: BuildPriority) {
  for (const build of active)
    if (build.key === key && RANK[priority] > RANK[build.priority]) {
      build.priority = priority;
      build.lease?.update();
    }
}
/** Runs every build of this process at the current priority of those who
 *  wait for it, raised or lowered: call it after one of them changed. */
export function reprioritize() {
  for (const build of active) {
    const waiters = [...(waiting.get(build.key) ?? [])];
    if (!waiters.length) continue;
    const priority = waiters.reduce<BuildPriority>((top, w) => (RANK[current(w.priority)] > RANK[top] ? current(w.priority) : top), "background");
    if (priority === build.priority) continue;
    build.priority = priority;
    build.lease?.update();
  }
}
// This file is part of every build key, so a change to how builds run
// starts new build folders.
const SELF = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
// latexmk (4.84 and later) runs this after every TeX pass: it copies the
// pass's output aside, so that the pages can be shown while later passes
// settle references, page numbers and the bibliography. Older versions
// have no hooks and skip it.
const PASS_HOOK = String.raw`if (defined &add_hook) { my $papilot_pass = 0; add_hook('after_xlatex', sub { my $dir = $ENV{PAPILOT_PASS_DIR}; return 0 unless $dir; $papilot_pass++; my $to = "$dir/$papilot_pass"; make_path($to); for my $file (split /\n/, $ENV{PAPILOT_PASS_FILES}) { next unless -f $file; my ($name) = $file =~ m{([^/]+)$}; copy($file, "$to/$name"); } print "Papilot: pass $papilot_pass output saved\n"; return 0; }); }`;
// Every build records how TeX read the paper, in <job>.papilot beside the
// PDF: each file it entered and left, and the file and line where each
// contents entry (sections, floats), label, the title and the abstract
// came from, with the contents text as TeX expanded it. Papilot Writer's
// paper map is made from it, so the map shows the paper TeX typeset: no
// commented-out or \iffalse'd parts, and the PDF's own numbering. It loads
// before the paper, writes only that file, and does nothing on a LaTeX
// older than the 2020 hooks.
export const OUTLINE_TRACE = String.raw`\makeatletter
\ifdefined\AddToHook
\newwrite\papilot@trace
\immediate\openout\papilot@trace=\jobname.papilot\relax
\def\papilot@at{\the\inputlineno|\CurrentFilePath|\CurrentFile}
\def\papilot@w#1{\immediate\write\papilot@trace{#1}}
\papilot@w{V|1}
\AddToHook{file/before}{\papilot@w{F|\papilot@at}}
\AddToHook{file/after}{\papilot@w{X|\papilot@at}}
\AddToHook{env/abstract/begin}{\papilot@w{A|\papilot@at}}
\AddToHook{env/abstract/end}{\papilot@w{a|\papilot@at}}
\AddToHook{enddocument}{\papilot@w{E|\papilot@at}}
\let\papilot@titled\@empty
\def\papilot@title{\papilot@w{T|\papilot@at}\gdef\papilot@titled{1}\papilot@ttl}
\def\papilot@patchtitle{\ifx\title\papilot@title\else\let\papilot@ttl\title\let\title\papilot@title\fi}
\AddToHook{class/after}{\papilot@w{C|\CurrentFile}\papilot@patchtitle}
\def\papilot@addcl#1#2#3{{\let\protect\@unexpandable@protect\let\label\@gobble\let\index\@gobble\let\glossary\@gobble
  \papilot@w{H|\papilot@at|#1|#2|#3}}\papilot@acl{#1}{#2}{#3}}
\protected\def\papilot@label{\@ifnextchar[\papilot@labelopt\papilot@labelone}
\def\papilot@labelopt[#1]#2{\papilot@w{L|\papilot@at|\detokenize{#2}}\papilot@lbl[#1]{#2}}
\def\papilot@labelone#1{\papilot@w{L|\papilot@at|\detokenize{#1}}\papilot@lbl{#1}}
\def\papilot@patch{\ifx\addcontentsline\papilot@addcl\else\let\papilot@acl\addcontentsline\let\addcontentsline\papilot@addcl\fi
  \ifx\label\papilot@label\else\let\papilot@lbl\label\let\label\papilot@label\fi
  \ifx\papilot@titled\@empty\else\papilot@w{TT|\detokenize\expandafter{\@title}}\fi}
\AddToHook{begindocument/end}{\papilot@patch}
\fi
\makeatother`;
const SAVED = /^Papilot: pass (\d+) output saved/m, NEXT = /^Run number \d+ of rule '([^' ]+)/m;
/** A TeX pass's PDF, shown while the build goes on. */
export interface PassPreview { pass: number; pdf: string; root: string; cwd: string }
// Completed builds kept per set of targets, as candidates to continue from.
const RECENT = 16;
interface Recent { key: string; context: string; date: unknown; tree?: string; dated?: boolean }
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const includes = (text: string) =>
  [...stripComments(text).matchAll(/^\s*\\include\{([^}]+)\}/gm)].map((m) =>
    m[1].trim(),
  );
export function affectedTargets(
  texts: Record<string, string>,
  changed: string[],
  targets: string[],
) {
  const owners: Record<string, Set<string>> = {};
  function visit(file: string, target: string, seen: Set<string>) {
    if (!path.posix.extname(file)) file += ".tex";
    if (seen.has(file) || !(file in texts)) return;
    seen.add(file);
    (owners[file] ??= new Set()).add(target);
    for (const m of stripComments(texts[file]).matchAll(
      /\\(?:input|include|subfile)\{([^}]+)\}/g,
    ))
      visit(path.posix.normalize(m[1].trim()), target, seen);
  }
  targets.forEach((t) => visit(t, t, new Set()));
  const selected = new Set<string>();
  for (const file of changed) {
    if (!owners[file]) return ["full"];
    for (const owner of owners[file]) selected.add(owner);
  }
  return [...selected].sort();
}
export function errors(text: string) {
  const lines = text.split(/\r?\n/),
    result: string[] = [];
  const startsError = (line: string) =>
    /^(\S[^\n]*):(\d+): (.+)$/.test(line) || line.startsWith("! ");
  for (const [i, line] of lines.entries())
    if (startsError(line)) {
      let message = line,
        last = line;
      // TeX hard-wraps even in the middle of words ("P\nackage"). Keep
      // continuations, but stop before help text, source context or a new error.
      let end = i + 1;
      for (; end < lines.length && end < i + 20; end++) {
        const next = lines[end];
        if (
          !next.trim() ||
          startsError(next) ||
          /^(?:See |Type |l\.\d+ |\s*\.\.\.|\s*<)/.test(next)
        )
          break;
        message += (last.length >= 78 ? "" : " ") + next;
        last = next;
      }
      const context = lines
        .slice(end, end + 12)
        .find((l) => /^l\.\d+ /.test(l))
        ?.trim();
      result.push(
        message
          .replace(/^! |^\.\//, "")
          .replace(/\s+/g, " ")
          .trim() + (context ? `  [${context}]` : ""),
      );
      if (result.length === 8) break;
    }
  return result;
}
export function compilerDiagnostics(log: string, transcript: string) {
  // The final TeX log can omit an error from an earlier pass.
  const details = [...errors(log), ...errors(transcript)];
  // BibTeX and Biber report outside the TeX log. Later TeX passes can push
  // their diagnostics out of latexmk's final error summary.
  for (const line of transcript.split(/\r?\n/))
    if (/---line \d+ of file |\b(?:ERROR|FATAL) - /.test(line)) details.push(line.trim());
  // Errors from shell-escape helpers go to latexmk's stderr, not the TeX log.
  for (const traceback of transcript
    .split("Traceback (most recent call last):")
    .slice(1)) {
    const exception = traceback
      .split(/\r?\n/)
      .find((line) => /^[\w.]+(?:Error|Exception): /.test(line));
    if (!exception) continue;
    const minted = traceback
      .slice(0, traceback.indexOf(exception))
      .includes("latexminted");
    details.push((minted ? "latexminted: " : "") + exception);
    if (minted && exception.includes("unexpected keyword argument 'color'"))
      details.push(
        "latexminted is incompatible with this Python version. Update latexminted or select a compatible Python on PATH, then restart the service and retry.",
      );
  }
  return [...new Set(details)];
}
export function warnings(text: string) {
  const patterns: [RegExp, string][] = [
    [/LaTeX Warning: Reference `([^']+)' on page/g, "Undefined reference: "],
    [/Warning: Citation [`']([^']+)' on page/g, "Undefined citation: "],
    [
      /LaTeX Warning: Label `([^']+)' multiply defined/g,
      "Label defined twice: ",
    ],
    [/Missing character: There is no (\S+)/g, "Missing glyph: "],
  ];
  return [
    ...new Set(
      patterns.flatMap(([re, label]) =>
        [...text.matchAll(re)].map((m) => label + m[1]),
      ),
    ),
  ].sort();
}
// The date used when TeX actually runs, not an expiry date for cached PDFs.
// Noon UTC of the local date shows the local date in every time zone.
// A SOURCE_DATE_EPOCH set by the user is kept as it is.
export function buildDate(now = new Date(), env = process.env) {
  return env.SOURCE_DATE_EPOCH
    ? { SOURCE_DATE_EPOCH: env.SOURCE_DATE_EPOCH }
    : {
        SOURCE_DATE_EPOCH: String(
          Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12) / 1000,
        ),
        FORCE_SOURCE_DATE: "1",
      };
}
export class Builder {
  cache: string;
  constructor(
    public project: Project,
    public repo: Repo,
  ) {
    this.cache = path.join(project.state, "cache/builds");
  }
  documentTexts(rev: string) {
    const files = this.repo
        .files(rev, this.project.doc_dir)
        .filter((f) => f.endsWith(".tex")),
      blobs = this.repo.blobs(rev, files);
    return Object.fromEntries(
      files.map((f) => [
        path.posix.relative(this.project.doc_dir || ".", f),
        blobs[f]?.toString() ?? "",
      ]),
    );
  }
  async documentTextsAsync(rev: string) {
    const files = (await this.repo.runAsync(["ls-tree", "-r", "-z", "--name-only", rev, ...(this.project.doc_dir ? ["--", this.project.doc_dir] : [])]))
        .toString().split("\0").filter((f) => f.endsWith(".tex")),
      blobs = await this.repo.blobsAsync(rev, files);
    return Object.fromEntries(
      files.map((f) => [
        path.posix.relative(this.project.doc_dir || ".", f),
        blobs[f]?.toString() ?? "",
      ]),
    );
  }
  plan(before: string, after: string, changed: string[]) {
    return this.choose(this.documentTexts(before), this.documentTexts(after), changed);
  }
  /** `plan` for servers, which keep answering requests meanwhile. */
  async planAsync(before: string, after: string, changed: string[], seedRevision?: string) {
    const [old, next, accepted] = await Promise.all([
      this.documentTextsAsync(before), this.documentTextsAsync(after),
      seedRevision ? this.repo.changedFilesAsync(seedRevision, before) : [],
    ]);
    // Omitted chapters must still match the fixed seed. Otherwise an error
    // accepted in an earlier round disappears when the next edit is elsewhere.
    return this.choose(old, next, [...new Set([...changed, ...accepted])]);
  }
  private choose(old: Record<string, string>, next: Record<string, string>, changed: string[]) {
    const p = this.project,
      main = path.posix.basename(p.main),
      targets = includes(next[main] ?? "");
    if (
      !p.partial_builds ||
      targets.length < 2 ||
      JSON.stringify(targets) !== JSON.stringify(includes(old[main] ?? ""))
    )
      return ["full"];
    if (p.doc_dir && changed.some((f) => !f.startsWith(p.doc_dir + "/")))
      return ["full"];
    const local = changed.map((f) => path.posix.relative(p.doc_dir || ".", f)),
      selected = new Set([
        ...affectedTargets(old, local, targets),
        ...affectedTargets(next, local, targets),
      ]);
    if (selected.has("full") || !selected.size) return ["full"];
    for (const name of [...selected])
      for (const dependency of p.dependencies[name] ?? [])
        selected.add(dependency);
    return targets.filter((t) => selected.has(t));
  }
  /** A chapter comparison needs the fixed baseline's auxiliary files, not a
   *  freshly dated full PDF. Reuse that exact snapshot even across days and
   *  app upgrades, with the same compatibility checks as incremental builds. */
  async buildSeed(rev: string, options: { force?: boolean; progress?: (progress: BuildProgress) => void; priority?: WantedPriority } = {}): Promise<BuildInfo> {
    if (options.force) return this.build(rev, ["full"], null, options);
    const { tree, context, cacheKey } = await this.resolve(rev, ["full"], null),
      entries = this.recent(["full"]), preferred = this.preferred(cacheKey);
    // Older caches did not record recovered refreshes in history. Establish
    // fresh evidence instead of resurrecting their superseded clean seed.
    if (preferred && (!entries.some(entry => entry.key === preferred) || !await this.finished(path.join(this.cache, preferred))))
      return this.build(rev, ["full"], null, { ...options, force: true });
    for (const entry of entries) {
      if (entry.context !== context || (entry.tree && entry.tree !== tree)
        || (process.env.SOURCE_DATE_EPOCH && entry.date !== process.env.SOURCE_DATE_EPOCH)) continue;
      let matched = false;
      try {
        const replacement = this.preferred(entry.key),
          folder = path.join(this.cache, replacement ?? entry.key), info = await this.finished(folder);
        if (!info && (replacement || entry.tree === tree))
          return this.build(rev, ["full"], null, { ...options, force: true });
        if (!info || info.tree !== tree || JSON.stringify(info.targets) !== '["full"]') continue;
        matched = true;
        // The latest full result governs scope even when its auxiliaries
        // cannot be reused: callers compare whole to retain its diagnostics.
        if (info.errors?.length) {
          await this.remember(["full"], { ...entry, key: info.key, tree });
          return info;
        }
        const main = path.posix.basename(this.project.main), out = path.dirname(info.pdf),
          auxiliary = new Set([path.basename(main, ".tex") + ".aux"]);
        await fs.promises.access(path.join(info.cwd, main));
        // A PDF alone is not a seed: the omitted chapters need their labels
        // and counters. An incomplete cache falls back to a normal build.
        for (const file of auxiliary) {
          const text = await fs.promises.readFile(path.join(out, file), "utf8");
          for (const match of text.matchAll(/\\@input\{([^}]+\.aux)\}/g)) auxiliary.add(match[1]);
        }
        await this.remember(["full"], { ...entry, key: info.key, tree });
        return info;
      } catch {
        // The newest matching result stays authoritative even if its seed
        // files were removed. Rebuild instead of reviving older diagnostics.
        if (matched) return this.build(rev, ["full"], null, { ...options, force: true });
      }
    }
    return this.build(rev, ["full"], null, options);
  }
  /** What identifies the build of `rev`: its cache key, and the tree and
   *  date that it compiles. */
  async resolve(rev: string, targets: string[], seed: BuildInfo | null, options: { date?: ReturnType<typeof buildDate>; pastErrors?: boolean } = {}) {
    const p = this.project,
      partial = JSON.stringify(targets) !== '["full"]';
    if (partial && !seed)
      throw new BuildError(
        "A partial build needs a completed full build to start from.",
      );
    let version: string;
    try {
      version = await commandVersion(p.engine);
    } catch {
      throw new BuildError(
        `${p.engine} was not found. Install TeX Live (or MacTeX) with latexmk.`,
      );
    }
    const tree = await this.repo.treeIdAsync(rev, p.source_dir),
      date = options.date ?? buildDate(),
      // Ordinary previews do not expire each day. Comparisons need one date
      // for both sides, including a previously cached chapter baseline.
      fixedDate = process.env.SOURCE_DATE_EPOCH ? buildDate() : null,
      dated = Boolean(options.date || partial || fixedDate),
      context = hash(JSON.stringify([signature(p), version, ...(fixedDate ? [fixedDate] : [])])),
      cacheKey = hash(
        JSON.stringify([
          tree,
          targets,
          seed?.key ?? null,
          signature(p),
          version,
          dated ? date : null,
          SELF,
          // Existing keys stay valid: only a build past errors adds this.
          ...(options.pastErrors ? ["past errors"] : []),
        ]),
      ).slice(0, 32);
    return { partial, tree, date, dated, context, cacheKey };
  }
  /** The completed build of `rev`, if there is one, without compiling. */
  async cached(rev: string, targets: string[], seed: BuildInfo | null, options: { date?: ReturnType<typeof buildDate>; pastErrors?: boolean } = {}) {
    const { cacheKey } = await this.resolve(rev, targets, seed, options),
      preferred = this.preferred(cacheKey);
    // A refresh replaced the build of this key (see build()).
    return this.finished(path.join(this.cache, preferred ?? cacheKey));
  }
  async build(
    rev: string,
    targets = ["full"],
    seed: BuildInfo | null = null,
    options: {
      force?: boolean;
      progress?: (progress: BuildProgress) => void;
      priority?: WantedPriority;
      pass?: (preview: PassPreview) => void;
      date?: ReturnType<typeof buildDate>;
      /** The caller no longer needs this build: it rejects with Cancelled.
       *  The compilation stops once nobody else waits for it, unless TeX
       *  already finished: then its result stays, to continue from. */
      signal?: AbortSignal;
      /** Called once this request waits for its build key, so that a
       *  request it replaces can be cancelled without stopping a
       *  compilation both need. */
      onKey?: (key: string) => void;
      /** Continue past recoverable errors even when halt_on_error is enabled,
       *  returning the PDF with those errors in `errors`.
       *  For a version shown only for comparison, such
       *  as the text a task fixing a compilation error starts from. */
      pastErrors?: boolean;
    } = {},
  ): Promise<BuildInfo> {
    const p = this.project,
      priority = options.priority ?? "normal",
      { partial, tree, date, dated, context, cacheKey } = await this.resolve(rev, targets, seed, options),
      // Manual recompilation gets a fresh output directory. Other previews
      // and review rounds may still be reading the previous cached PDF.
      key = options.force ? hash(JSON.stringify([cacheKey, randomUUID()])).slice(0, 32) : cacheKey,
      folder = path.join(this.cache, key);
    // Someone now waits for a build of this key that may already be running,
    // and sees its passes from now on, starting with the latest one.
    const waiter: Waiter = { priority, pass: options.pass, progress: options.progress };
    let waiters = waiting.get(key);
    if (!waiters) waiting.set(key, (waiters = new Set()));
    waiters.add(waiter);
    const signal = options.signal;
    let leave: (() => void) | null = null;
    // Rejects once the caller cancels; the compilation goes on while someone
    // else still waits for it.
    const cancelled = new Promise<never>((_, reject) => {
      leave = () => {
        waiters.delete(waiter);
        if (!waiters.size) {
          if (waiting.get(key) === waiters) waiting.delete(key);
          stops.get(key)?.abort();
        } else reprioritize();
        reject(new Cancelled());
      };
      if (signal?.aborted) leave();
      else signal?.addEventListener("abort", leave, { once: true });
    });
    cancelled.catch(() => undefined);
    const until = <T>(work: Promise<T>) => (signal ? Promise.race([work, cancelled]) : work);
    try {
      options.onKey?.(key);
      if (signal?.aborted) await cancelled;
      promote(key, current(priority));
      for (const build of active) {
        if (build.key !== key) continue;
        if (options.pass) { build.watchers.add(options.pass); build.followed?.(); }
        if (build.progress) options.progress?.(build.progress);
      }
      // A build of this key under way in this process is awaited directly,
      // rather than by polling its lock, so its result arrives the moment it
      // is ready. The lock keeps other processes from building it twice.
      const ongoing = building.get(key);
      if (ongoing) {
        const result = await until(ongoing.catch(() => null));
        if (result) return result;
      }
      const stop = new AbortController();
      stops.set(key, stop);
      const attempt = (async () => {
        // A refresh has a durable pointer independent of the bounded recent
        // list. If its output was pruned, rebuild rather than resurrecting
        // the superseded PDF, which may still belong to an older review.
        if (!options.force) {
          const preferred = this.preferred(cacheKey);
          if (preferred) {
            const refreshed = await this.finished(path.join(this.cache, preferred));
            if (refreshed) return refreshed;
            // Recovery has fresh immutable output, but retains this request's
            // stable lock and waiters so other processes share it and a later
            // foreground reader can promote it and receive progress/passes.
            return withLock(path.join(this.cache, key + ".lock"), async () => {
              const latest = this.preferred(cacheKey), recovered = latest && await this.finished(path.join(this.cache, latest));
              if (recovered) return recovered;
              const recovery = hash(JSON.stringify([cacheKey, randomUUID()])).slice(0, 32);
              return withLock(path.join(this.cache, recovery + ".lock"), () =>
                this.compileOnce(rev, tree, recovery, cacheKey, context, targets, seed, date, dated, partial, { ...options, force: true }, key, stop.signal));
            });
          }
        }
        return (await this.finished(folder)) ??
          withLock(path.join(this.cache, key + ".lock"), async () =>
            (await this.finished(folder)) ?? this.compileOnce(rev, tree, key, cacheKey, context, targets, seed, date, dated, partial, options, key, stop.signal),
          );
      })();
      building.set(key, attempt);
      // Others may still wait for it after this caller cancelled.
      void attempt.catch(() => undefined).finally(() => {
        if (building.get(key) === attempt) building.delete(key);
        if (stops.get(key) === stop) stops.delete(key);
      });
      return await until(attempt);
    } finally {
      if (leave) signal?.removeEventListener("abort", leave);
      waiters.delete(waiter);
      if (!waiters.size && waiting.get(key) === waiters) waiting.delete(key);
    }
  }
  private async compileOnce(
    rev: string,
    tree: string,
    key: string,
    cacheKey: string,
    context: string,
    targets: string[],
    seed: BuildInfo | null,
    date: ReturnType<typeof buildDate>,
    dated: boolean,
    partial: boolean,
    options: { force?: boolean; progress?: (progress: BuildProgress) => void; pastErrors?: boolean },
    requestKey = key,
    signal?: AbortSignal,
  ) {
    const pastErrors = options.pastErrors ?? false;
    if (signal?.aborted) throw new Cancelled();
    // A build continues from the completed one with the same targets whose
    // sources differ least from this one, or a full build from the author's
    // own latexmk output, as latexmk does when a folder is compiled again:
    // unchanged files are cloned and LaTeX keeps its state, so it reruns
    // only as often as the edit requires. The first build of a set of
    // chapters continues from its seed, whose auxiliary files it reads
    // anyway: latexmk's record and the state packages keep in the folder,
    // such as minted's cache, come along, so it reruns only what leaving out
    // the other chapters changes. Manual recompilation starts clean, and so
    // does a retry when leftover state broke a build.
    const start = options.force ? null : (await this.closest(context, targets, tree)) ?? (partial ? (seed && { info: seed, date: null }) : "author" as const);
    const waiters = [...(waiting.get(requestKey) ?? [])],
      priority = waiters.reduce<BuildPriority>((top, w) => (RANK[current(w.priority)] > RANK[top] ? current(w.priority) : top), "background");
    const run: Active = { key: requestKey, priority, paused: false, watchers: new Set(waiters.flatMap((w) => (w.pass ? [w.pass] : []))) };
    active.add(run);
    // Keep the latest update even when nobody initially requested progress:
    // another task or PDF view can join this shared compilation later.
    const progress = (value: BuildProgress) => {
      run.progress = value;
      for (const waiter of waiting.get(requestKey) ?? []) waiter.progress?.(value);
    };
    let continuation = start, result: BuildInfo;
    const knownDirectories = (start && start !== "author" ? start.info : seed)?.tikzDirectories ?? [];
    const tikzDirectories = new Set(knownDirectories.filter(dir => tikzDirectory(dir + "/cache.md5") === dir));
    try {
      for (;;) {
        try {
          result = await this.compile(rev, tree, key, targets, seed, date, dated, continuation, tikzDirectories, progress, run, signal, pastErrors);
          break;
        } catch (error) {
          if (error instanceof Cancelled || signal?.aborted) throw error;
          // TeX writes TikZ's checksum before running its external compiler.
          // Git does not retain empty cache directories and latexmk's output
          // directory needs its own copy of the directory structure.
          const directories = error instanceof BuildError ? error.details.flatMap(line => {
            const file = /Can't write on file `([^']+\.md5)'/i.exec(line)?.[1];
            const directory = file && tikzDirectory(file);
            return directory && !tikzDirectories.has(directory) ? [directory] : [];
          }) : [];
          if (directories.length && tikzDirectories.size < knownDirectories.length + 8) {
            for (const directory of directories) tikzDirectories.add(directory);
            continue;
          }
          // As before, retry from clean auxiliary state if it broke the build.
          if (!continuation || !auxiliaryBuildError(error)) throw error;
          continuation = null;
        }
      }
    } finally {
      active.delete(run);
      schedule();
    }
    // Full results govern seed selection, including recovered diagnostics.
    // closest() separately excludes their auxiliary state from continuation.
    if (!pastErrors && (!result.errors?.length || !partial)) await this.remember(targets, { key, context, date: date.SOURCE_DATE_EPOCH, tree, dated });
    if (options.force) {
      const preferred = this.preferredFile(cacheKey);
      await withLock(preferred, () => writeJsonAsync(preferred, { key }));
    }
    return result;
  }
  private preferredFile(key: string) {
    return path.join(this.cache, key + ".preferred.json");
  }
  private preferred(key: string): string | null {
    const value = readJson<{ key?: string } | null>(this.preferredFile(key), null);
    return typeof value?.key === "string" && /^[0-9a-f]{32}$/.test(value.key) ? value.key : null;
  }
  /** Reuse an immutable published build while its cached PDF is available. */
  async completed(key: string) {
    return /^[a-f0-9]{32}$/.test(key) ? this.finished(path.join(this.cache, key)) : null;
  }
  /** Remember a completed seed retry so later readers keep the recovered
   *  chapter PDF instead of refreshing the same full baseline again. */
  async markSeedRetried(info: BuildInfo): Promise<BuildInfo> {
    if (info.seedRetried || info.targets[0] === "full" || !auxiliaryDiagnostics(info.errors)) return info;
    return withLock(path.join(this.cache, info.key + ".lock"), async () => {
      const folder = path.join(this.cache, info.key), saved = await this.finished(folder);
      if (!saved) return info;
      const result = { ...saved, seedRetried: true };
      await writeJsonAsync(path.join(folder, "result.json"), result);
      return result;
    });
  }
  // A completed build in this folder, whose PDF is still there.
  private async finished(folder: string) {
    try {
      const cached = JSON.parse(await fs.promises.readFile(path.join(folder, "result.json"), "utf8")) as BuildInfo;
      await fs.promises.access(cached.pdf);
      const time = new Date();
      await fs.promises.utimes(folder, time, time).catch(() => undefined);
      return cached;
    } catch {
      return null;
    }
  }
  // Review rounds build the same chapters again and again (\includeonly), so
  // each set of targets continues from its own recent builds.
  private latestFile(targets: string[]) {
    const name = JSON.stringify(targets) === '["full"]' ? "latest.json" : `latest-${hash(JSON.stringify(targets)).slice(0, 16)}.json`;
    return path.join(this.cache, name);
  }
  private recentFile(targets: string[]) {
    return this.latestFile(targets).replace(/latest(-[0-9a-f]+)?\.json$/, "recent$1.json");
  }
  private recent(targets: string[]): Recent[] {
    const list = readJson<unknown>(this.recentFile(targets), []),
      latest = readJson<Partial<Recent> | null>(this.latestFile(targets), null),
      valid = (r: unknown): r is Recent => typeof (r as Recent)?.key === "string" && /^[0-9a-f]{32}$/.test((r as Recent).key) && typeof (r as Recent).context === "string";
    const entries = (Array.isArray(list) ? list : []).filter(valid);
    // latest.json, also written by earlier versions, names the newest build.
    if (valid(latest) && !entries.some((r) => r.key === latest.key)) entries.unshift(latest);
    return entries;
  }
  private async remember(targets: string[], entry: Recent) {
    const entries = [entry, ...this.recent(targets).filter((r) => r.key !== entry.key)].slice(0, RECENT);
    await writeJsonAsync(this.recentFile(targets), entries);
    await writeJsonAsync(this.latestFile(targets), entry);
  }
  // Of the recent builds that can be continued, the one whose sources differ
  // in the fewest files from `tree`, preferring the newer: after a review or a
  // speculative build, the manuscript's own previous build may be further
  // from the next version than either.
  private async closest(context: string, targets: string[], tree: string): Promise<{ info: BuildInfo; date: unknown } | null> {
    const candidates = (await Promise.all(this.recent(targets).filter((r) => r.context === context).map(async (r) => {
      try {
        const info = JSON.parse(await fs.promises.readFile(path.join(this.cache, r.key, "result.json"), "utf8")) as BuildInfo;
        if (info.errors?.length) return null;
        if (JSON.stringify(info.targets) !== JSON.stringify(targets)) return null;
        await Promise.all([fs.promises.access(info.pdf), fs.promises.access(info.root)]);
        const changed = info.tree === tree ? 0 : (await this.repo.runAsync(["diff-tree", "-r", "--name-only", "-z", info.tree, tree])).toString().split("\0").filter(Boolean).length;
        // An ordinary preview may have kept an older PDF without running TeX.
        // Its request date does not prove which date its pages actually show.
        return { info, date: r.dated ? r.date : null, changed };
      } catch {
        return null;
      }
    }))).filter((c) => c !== null);
    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) if (!best || candidate.changed < best.changed) best = candidate;
    return best && { info: best.info, date: best.date };
  }
  private async compile(
    rev: string,
    tree: string,
    key: string,
    targets: string[],
    seed: BuildInfo | null,
    date: ReturnType<typeof buildDate>,
    dated: boolean,
    start: { info: BuildInfo; date: unknown } | "author" | null,
    tikzDirectories: Set<string>,
    progress?: (progress: BuildProgress) => void,
    scheduled?: Active,
    signal?: AbortSignal,
    pastErrors = false,
  ): Promise<BuildInfo> {
    const p = this.project,
      haltOnError = p.halt_on_error && !pastErrors,
      partial = JSON.stringify(targets) !== '["full"]',
      folder = path.join(this.cache, key);
    // A cancelled build leaves nothing behind: no result, log or folder, so
    // that no later build continues from it or shows it.
    const abandon = async () => {
      await fs.promises.rm(folder, { recursive: true, force: true });
      throw new Cancelled();
    };
    await fs.promises.rm(folder, { recursive: true, force: true });
    const source = path.join(folder, "src");
    const base = start && start !== "author" ? start.info : null;
    await this.repo.export(rev, p.source_dir, source, base ? { root: base.root, tree: base.tree } : undefined);
    if (signal?.aborted) return abandon();
    const cwd = path.join(
        source,
        path.posix.relative(p.source_dir || ".", p.doc_dir || "."),
      ),
      main = path.posix.basename(p.main),
      job = path.posix.basename(main, ".tex"),
      out = path.join(cwd, "build");
    if (!(await prepareBuildDirectory(source, out)))
      throw new BuildError("LaTeX failed to compile.", ["The build output path must be a directory inside the snapshot."]);
    const included = includes(await fs.promises.readFile(path.join(cwd, main), "utf8"));
    const auxDirectories = [...new Set(included.map(target => path.dirname(path.resolve(out, target + ".aux"))))];
    const prepared = await Promise.all(auxDirectories.map(dir => prepareBuildDirectory(source, dir)));
    const readyDirs = new Set(auxDirectories.filter((_, index) => prepared[index]));
    await Promise.all([
      ...[...tikzDirectories].flatMap(directory => [
        prepareBuildDirectory(source, path.join(cwd, directory)),
        prepareBuildDirectory(source, path.join(out, directory)),
      ]),
    ]);
    // Preview outputs carry across days. A dated comparison can still use
    // older auxiliary state, but TeX must refresh the date on its pages.
    // Pages of other targets, such as a chapter build's full seed, are never
    // this build's output: without them latexmk has to run TeX.
    // A build past errors starts without them: its PDF is then the one TeX
    // wrote, not one left over that latexmk stopped before replacing.
    const reused = !pastErrors && base !== null && JSON.stringify(base.targets) === JSON.stringify(targets)
      && (!dated || (start !== "author" && start?.date === date.SOURCE_DATE_EPOCH));
    if (base) {
      const previous = path.dirname(base.pdf);
      await Promise.all((await filesIn(previous))
        .filter((file) => !/\.fls$/i.test(file) && (reused || !OUTPUT.test(file)))
        .map((file) => clone(file, path.join(out, path.relative(previous, file)))));
      // latexmk names files below this folder relative to it; one it named
      // absolutely must be checked here, not in the build this continues.
      await relocate(path.join(out, job + ".fdb_latexmk"), path.dirname(base.root), folder);
    } else if (start === "author") {
      // Only this job's state: the author's folder may hold other editions.
      const own = path.join(p.root, p.doc_dir, "build");
      if (fs.existsSync(path.join(own, job + ".fdb_latexmk")))
        await Promise.all([
          ...(await fs.promises.readdir(own)).filter((name) => (name.startsWith(job + ".") && !OUTPUT.test(name) && !name.endsWith(".fls")) || name.startsWith("_minted")),
          ...included.flatMap(target => {
            const file = path.resolve(out, target + ".aux"), relative = relativeInside(out, file);
            return relative && readyDirs.has(path.dirname(file)) ? [relative] : [];
          }),
        ].map(async (name) => {
          try {
            if ((await fs.promises.stat(path.join(own, name))).isDirectory()) await fs.promises.cp(path.join(own, name), path.join(out, name), { recursive: true });
            else await clone(path.join(own, name), path.join(out, name));
          } catch {
            /* A missing file is regenerated. */
          }
        }));
    }
    if (signal?.aborted) return abandon();
    // Only a matching completed build can supply an existing PDF.
    if (!reused) await Promise.all(["pdf", "xdv"].map((ext) => fs.promises.rm(path.join(out, `${job}.${ext}`), { force: true })));
    const pdf = path.join(out, job + ".pdf"),
      previousPdf = await fs.promises.stat(pdf, { bigint: true }).catch(() => null);
    const args = [
      "-norc",
      ...(p.latexmkrc
        ? ["-r", path.posix.relative(p.doc_dir || ".", p.latexmkrc)]
        : []),
      { pdflatex: "-pdf", xelatex: "-xelatex", lualatex: "-lualatex" }[
        p.engine
      ],
      "-outdir=build",
      `-jobname=${job}`,
      "-synctex=1",
      "-interaction=nonstopmode",
      // latexmk -f runs the remaining passes and the PDF driver after errors.
      ...(haltOnError ? ["-halt-on-error"] : ["-f"]),
      "-file-line-error",
    ];
    // The outline trace comes first; a chapter build adds its \includeonly.
    const trace = path.join(folder, "papilot-trace.tex");
    await fs.promises.writeFile(trace, OUTLINE_TRACE + "\n");
    let pretex = `\\input{${path.relative(cwd, trace).split(path.sep).join("/")}}`;
    if (partial) {
      // Chapters outside \includeonly keep the seed's auxiliary files, also
      // when this build continues from an earlier one built on another seed.
      // latexmk compares contents, so an unchanged chapter causes no rerun.
      const seedOut = path.dirname(seed!.pdf),
        others = new Set(included.filter((target) => !targets.includes(target)).map((target) => path.join(...target.split("/")) + ".aux"));
      await Promise.all((await filesIn(seedOut)).filter((file) => AUXILIARY.has(path.extname(file))).map(async (file) => {
        const relative = path.relative(seedOut, file), target = path.join(out, relative);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (others.has(relative) || !fs.existsSync(target)) await fs.promises.copyFile(file, target);
      }));
      const preload = Object.entries(p.preload)
        .filter(
          ([name, file]) =>
            !targets.includes(name) && fs.existsSync(path.join(cwd, file)),
        )
        .map(([, file]) => `\\input{${file}}`)
        .join("");
      pretex += `\\includeonly{${targets.join(",")}}` + (preload ? `\\AtBeginDocument{${preload}}` : "");
    }
    args.push(`-usepretex=${pretex}`);
    // latexmk only reruns TeX for changed inputs. Output carried over from a
    // build without the trace would stay without one, so TeX runs once more.
    if (fs.existsSync(path.join(out, job + ".fdb_latexmk")) && !fs.existsSync(path.join(out, job + ".papilot"))) args.push("-g");
    // Each pass's pages are shown once latexmk decides to run more than that
    // pass: a bibliography or another pass. The last pass's are the result.
    // A background build keeps its passes too, for whoever starts waiting
    // for it before it ends.
    const passes = path.join(folder, "passes"),
      keeping = Boolean(scheduled && (scheduled.watchers.size || scheduled.priority === "background"));
    let saved = 0, followed = 0, shown = 0, previewing = Promise.resolve();
    const kept = new Set<number>();
    const preview = () => {
      if (!scheduled?.watchers.size || followed <= shown) return;
      const number = (shown = followed);
      kept.add(number);
      previewing = previewing.then(async () => {
        const dir = path.join(passes, String(number)), xdv = path.join(dir, job + ".xdv"), file = path.join(dir, job + ".pdf");
        if (fs.existsSync(xdv)) {
          await capture("xdvipdfmx", ["-q", "-E", "-o", file, xdv], { cwd, env: { ...process.env, ...date }, timeout: 300000, signal });
          await fs.promises.rm(xdv, { force: true });
        }
        await fs.promises.access(file);
        for (const watcher of scheduled.watchers) watcher({ pass: number, pdf: file, root: source, cwd });
      }).catch(() => undefined);
    };
    if (scheduled) scheduled.followed = preview;
    let pending = "";
    const watch = (chunk: Buffer) => {
      const lines = (pending + chunk.toString("latin1")).split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const done = SAVED.exec(line), next = NEXT.exec(line);
        if (done) saved = Number(done[1]);
        else if (next && saved > followed && !/^(?:xdvipdfmx|dvipdfmx?|dvips|ps2pdf)$/.test(next[1])) { followed = saved; preview(); }
      }
    };
    if (keeping) {
      // MiKTeX's Windows launcher strips embedded quotes when forwarding -e
      // to Perl. Keep the code in this build's cache, outside the exported
      // paper, and load it after the project's own rc file.
      const hook = path.join(folder, "papilot-pass.latexmkrc");
      await fs.promises.writeFile(hook, PASS_HOOK + "\n");
      // The cache is an ancestor of cwd: a relative path also avoids passing
      // Unicode checkout paths through a legacy Windows Perl code page.
      args.push("-r", path.relative(cwd, hook).split(path.sep).join("/"));
    }
    // A repository can contain a filename that looks like a latexmk option.
    args.push(main.startsWith("-") ? "./" + main : main);
    const transcript = path.join(folder, "latexmk.log"),
      log = await fs.promises.open(transcript, "w"),
      // Pages are counted against the build this one continues from.
      read = progress
        ? progressReader(
            progress,
            writtenPages(
              base
                ? path.join(path.dirname(base.pdf), job + ".log")
                : path.join(p.root, p.doc_dir, "build", job + ".log"),
            ),
          )
        : null;
    let failure: Error | null = null, writing = Promise.resolve();
    // A share of the TeX pool for as long as latexmk runs; another process
    // borrowing it stops this build meanwhile (see schedule).
    const lease = new Lease(() => scheduled?.priority ?? "normal");
    if (scheduled) { scheduled.lease = lease; lease.onLent = schedule; }
    // Waiting for a slot ends at once.
    const release = () => void lease.release();
    signal?.addEventListener("abort", release, { once: true });
    try {
      await lease.ready;
      if (signal?.aborted) throw new Cancelled();
    } catch (error) {
      signal?.removeEventListener("abort", release);
      if (scheduled) scheduled.lease = undefined;
      await lease.release();
      await log.close();
      if (signal?.aborted) return abandon();
      throw error;
    }
    signal?.removeEventListener("abort", release);
    const ran = now();
    try {
      await runAsync("latexmk", args, {
        cwd,
        env: {
          ...process.env,
          ...date,
          ...(keeping ? { PAPILOT_PASS_DIR: passes.replaceAll("\\", "/"), PAPILOT_PASS_FILES: ["xdv", "pdf", "synctex.gz"].map((ext) => `build/${job}.${ext}`).join("\n") } : {}),
        },
        timeout: 1800000,
        signal,
        started: (child) => {
          lease.attach(child);
          if (!scheduled) return;
          scheduled.child = child;
          schedule();
        },
        output: (chunk) => {
          writing = writing.then(() => log.write(chunk)).then(() => undefined, () => undefined);
          read?.(chunk);
          if (keeping) watch(chunk);
        },
      });
    } catch (error) {
      failure = error as Error;
    } finally {
      if (scheduled) { scheduled.child = undefined; scheduled.paused = false; scheduled.lease = undefined; schedule(); }
      lease.detach();
      await lease.release();
      await writing;
      await log.close();
      await previewing;
    }
    if (failure instanceof Cancelled) return abandon();
    // Passes that were not shown are not needed.
    if (scheduled) scheduled.followed = undefined;
    if (keeping) for (let number = 1; number <= saved; number++) if (!kept.has(number)) await fs.promises.rm(path.join(passes, String(number)), { recursive: true, force: true });
    const texLog = path.join(out, job + ".log"),
      writtenPdf = await fs.promises.stat(pdf, { bigint: true }).catch(() => null),
      freshPdf = writtenPdf && (!previousPdf || writtenPdf.ino !== previousPdf.ino || writtenPdf.mtimeNs !== previousPdf.mtimeNs || writtenPdf.ctimeNs !== previousPdf.ctimeNs);
    if (reused && !failure)
      await Promise.all([path.join(out, job + ".synctex.gz"), texLog].map((file) => relocate(file, path.dirname(base!.root), folder)));
    const logBytes = await fs.promises.readFile(texLog).catch(() => Buffer.alloc(0)),
      logText = logBytes.toString("utf8"),
      // XeLaTeX can leave a partial XDV after stopping; latexmk -f then
      // converts it to a fresh but truncated PDF. Read the full log because
      // the diagnostic summary can stop before this terminal error. TeX's
      // hard wrapping can split the terminal message inside a word.
      fatal = /^(?:!\s*|[^\r\n]+:\d+:\s*)?(?:Emergency stop\.|TeX capacity exceeded)|^\s*\*\*\* \(job aborted|^\s*!?\s*==> Fatal error occurred|^\(That makes 100 errors; please try again\.\)/m.test(unwrapLog(logBytes).join("\n")),
      // latexmk reports the errors TeX went past with its exit status. A
      // latexmk that a timeout or a shutdown killed has none, and may have
      // left the PDF unfinished.
      past = !haltOnError && !fatal && failure instanceof ProcessError && / failed \(\d+\)$/.test(failure.message) && freshPdf;
    let errors: string[] | undefined;
    if (past) {
      const transcriptText = await fs.promises.readFile(transcript, "utf8");
      errors = compilerDiagnostics(logText, transcriptText);
      if (!errors.length) errors = transcriptText.split("\n").slice(-25);
    }
    // Retry stale continuation state once, even if TeX wrote a PDF. After
    // that clean attempt, current source may still generate auxiliary errors;
    // retain its recovered PDF and diagnostics, including for chapter builds.
    const auxiliaryFailure = start && auxiliaryDiagnostics(errors);
    if ((!past && failure) || !writtenPdf || auxiliaryFailure) {
      const transcriptText = await fs.promises.readFile(transcript, "utf8"),
        details = compilerDiagnostics(logText, transcriptText),
        kept = path.join(p.state, "logs", key + ".log");
      await fs.promises.mkdir(path.dirname(kept), { recursive: true });
      await fs.promises.writeFile(
        kept,
        transcriptText + (logText ? "\n\n--- TeX log ---\n" + logText : ""),
      );
      const tail = transcriptText.split("\n").slice(-25);
      await fs.promises.rm(folder, { recursive: true, force: true });
      throw new BuildError(
        failure?.message.includes("ENOENT")
          ? "latexmk was not found. Install TeX Live or MacTeX."
          : "LaTeX failed to compile.",
        details.length ? details : tail,
        kept,
      );
    }
    const result: BuildInfo = {
      key,
      tree,
      targets,
      root: source,
      cwd,
      pdf,
      seconds: Math.round((now() - ran) * 10) / 10,
      warnings: warnings(logText),
      ...(tikzDirectories.size ? { tikzDirectories: [...tikzDirectories] } : {}),
      ...(errors ? { errors } : {}),
    };
    await writeJsonAsync(path.join(folder, "result.json"), result);
    return result;
  }
  // Removes builds unused for `maxAge` seconds, except those in `keep` and the
  // two newest of each set of targets, which the next build continues from.
  async prune(keep: Set<string>, maxAge = 3 * 86400) {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(this.cache, { withFileTypes: true }); }
    catch { return; }
    const kept = new Set(keep);
    for (const entry of entries)
      if (entry.isFile() && /^(?:recent|latest)(?:-[0-9a-f]+)?\.json$/.test(entry.name)) {
        const value = readJson<unknown>(path.join(this.cache, entry.name), null),
          list = Array.isArray(value) ? value : [value];
        for (const item of list.slice(0, 2)) if (typeof (item as Recent)?.key === "string") kept.add((item as Recent).key);
      }
    for (const entry of entries) {
      const folder = path.join(this.cache, entry.name);
      if (!entry.isDirectory() || entry.name.endsWith(".lock") || kept.has(entry.name)) continue;
      const stat = await fs.promises.stat(folder).catch(() => null);
      if (!stat || now() - stat.mtimeMs / 1000 <= maxAge) continue;
      await withLock(path.join(this.cache, entry.name + ".lock"), () => fs.promises.rm(folder, { recursive: true, force: true }));
      await fs.promises.rm(path.join(this.cache, entry.name + ".lock"), { force: true });
    }
    // Keep a missing refresh's pointer while its superseded output exists:
    // readers must rebuild, not silently fall back to that older PDF.
    for (const entry of entries) {
      const key = /^([0-9a-f]{32})\.preferred\.json$/.exec(entry.name)?.[1];
      if (!key) continue;
      const file = this.preferredFile(key);
      await withLock(file, async () => {
        const preferred = this.preferred(key);
        if (!fs.existsSync(path.join(this.cache, key)) && (!preferred || !fs.existsSync(path.join(this.cache, preferred))))
          await fs.promises.rm(file, { force: true });
      });
    }
  }
}
