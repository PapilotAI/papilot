import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT, codeVersion } from "../runtime.ts";
import { Builder, BuildError, auxiliaryBuildError, buildDate, reprioritize, type BuildPriority } from "./build.ts";
import { diffUnitsAsync, scopeViolationsAsync, withHashesAsync, withUnits } from "./changes.ts";
import { provisional, roundFolder, writeProvisional } from "./carry.ts";
import { acceptNoteOption, noteOptionUnits } from "./note-options.ts";
import { isFigure } from "./config.ts";
import { now, readJson, writeJson } from "./files.ts";
import { runAsync } from "./process.ts";
import { Lease } from "./pool.ts";
import type { App } from "../server.ts";
import type {
  BuildInfo,
  BuildProgress,
  DocumentEffect,
  Job,
  JobResult,
  PlaceView,
  RenderedRound,
  RenderRequest,
  Round,
  Unit,
} from "../types.ts";
export class PublishError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
    public next = "",
    public log?: string,
  ) {
    super(message);
  }
}
// Seconds for which a review page that asked for its state counts as open.
const VIEWING = 15;
// Each rendering step takes its own share of the TeX pool, so a comparison
// waiting for variant builds between steps never holds one meanwhile.
async function work(output: string, request: object, priority: () => BuildPriority = () => "normal") {
  // Its own name, as several requests may render into one round's folder.
  const file = path.join(
    output,
    `request-${randomBytes(4).toString("hex")}.json`,
  );
  writeJson(file, request);
  const lease = new Lease(priority);
  try {
    await lease.ready;
    await runAsync(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "src/render/worker.ts"), file],
      { cwd: ROOT, timeout: 1200000, started: (child) => lease.attach(child) },
    );
  } catch (error) {
    throw new PublishError(
      "Rendering the PDF comparison failed.",
      [
        (error as Error).message,
        ...String((error as { stderr?: Buffer }).stderr ?? "")
          .trim()
          .split("\n")
          .slice(-12),
      ],
      "Fix the renderer error, then publish again.",
    );
  } finally {
    await lease.release();
    fs.rmSync(file, { force: true });
  }
}
// One sufficient combination of edits for each whole-document change.
// An edit that prints nothing of its own, such as a macro definition, is
// compiled alone onto the accepted text: the changes that build makes are
// exactly what accepting it makes. Changes outside every crop that those
// builds leave unexplained are found by halving the other edits: each half is
// compiled alone, and a change one half makes has its cause there. A change
// neither half makes keeps the whole group, as it does when a variant cannot
// be compared. Partial singleton effects remain available to a joint group.
// This is not an enumeration of all causes or a proof of minimality: another
// combination, including one crossing the split, can produce the same effect.
export async function attribute(
  units: Unit[],
  changes: { within: string[] }[],
  silent: string[],
  shown: (units: Unit[]) => Promise<boolean[] | null>,
) {
  const causes = changes.map(() => new Set<string>()),
    cache = new Map<string, Promise<boolean[] | null>>(),
    compiled = async (group: Unit[]) => {
      const key = JSON.stringify(group.map((u) => u.id));
      if (!cache.has(key))
        cache.set(
          key,
          shown(group).catch((error) => {
            if (error instanceof BuildError) return null;
            throw error;
          }),
        );
      return cache.get(key)!;
    };
  for (const id of silent) {
    const unit = units.find((u) => u.id === id)!,
      seen = await compiled([unit]);
    seen?.forEach((s, i) => s && causes[i].add(id));
  }
  const all = (group: Unit[], indices: number[]) =>
    indices.forEach((i) => group.forEach((u) => causes[i].add(u.id)));
  const split = async (group: Unit[], indices: number[]): Promise<void> => {
    if (!indices.length) return;
    if (group.length <= 1) return all(group, indices);
    const halves = [
        group.slice(0, Math.ceil(group.length / 2)),
        group.slice(Math.ceil(group.length / 2)),
      ],
      seen: boolean[][] = [];
    for (const half of halves) {
      const result = await compiled(half);
      if (!result) return all(group, indices);
      seen.push(result);
    }
    all(
      group,
      indices.filter((i) => !seen[0][i] && !seen[1][i]),
    );
    await split(
      halves[0],
      indices.filter((i) => seen[0][i]),
    );
    await split(
      halves[1],
      indices.filter((i) => seen[1][i]),
    );
  };
  await split(
    units,
    changes.map((_, i) => i),
  );
  const result: string[][] = [],
    full = units.map((u) => u.id);
  for (const [index, set] of causes.entries()) {
    const group = units.filter((u) => set.has(u.id));
    // Different sufficient combinations can cancel when combined. Verify
    // their union before presenting it; the full set is already witnessed
    // by the final PDF. A failed variant never becomes a causal assertion.
    const verified =
      group.length === units.length ||
      (group.length > 0 && (await compiled(group))?.[index]);
    result.push(verified ? group.map((u) => u.id) : full);
  }
  return result;
}
// Renders a comparison. `variant` compiles the accepted text with only some
// of the edits; without it, changes outside every crop list every edit.
export async function render(
  output: string,
  request: RenderRequest,
  variant?: (units: Unit[]) => Promise<BuildInfo>,
  priority: () => BuildPriority = () => "normal",
) {
  await work(output, request, priority);
  const file = path.join(output, "attribute.json");
  if (!fs.existsSync(file)) return;
  const { changes, silent, cards } = readJson<{
    changes: { effect: DocumentEffect; within: string[] }[];
    silent: string[];
    cards: RenderRequest["cards"];
  }>(file, { changes: [], silent: [], cards: undefined });
  fs.rmSync(file);
  const effects = changes.map((c) => c.effect),
    causes = variant
      ? await attribute(request.units, changes, silent, async (units) => {
          await work(output, {
            ...request,
            final: request.new,
            new: await variant(units),
            effects,
          }, priority);
          const shown = path.join(output, "shown.json"),
            result = readJson<boolean[] | null>(shown, null);
          fs.rmSync(shown, { force: true });
          return result;
        })
      : changes.map((c) =>
          c.within.length ? [] : request.units.map((u) => u.id),
        );
  await work(output, { ...request, causes, cards }, priority);
}
// The places of an edit past those rendered with its round.
export async function more(output: string, unit: string) {
  const file = path.join(output, `places-${unit}.json`);
  if (!fs.existsSync(file)) {
    const saved = readJson<{ old: BuildInfo; new: BuildInfo } | null>(
      path.join(output, "places.json"),
      null,
    );
    if (!saved) return [];
    if (![saved.old, saved.new].every((b) => fs.existsSync(b.pdf)))
      throw new PublishError(
        "The builds of this round were removed.",
        [],
        "Publish again to see every place.",
      );
    // The review page waits for these places.
    await work(output, { more: unit }, () => "foreground");
  }
  return readJson<PlaceView[]>(file, []);
}
export class Publisher {
  private pruning: Promise<void> | null = null;
  pending = new Map<string, string>();
  running = new Map<string, Promise<void>>();
  queue: string[] = [];
  stopping = false;
  // The new version of each running job whose round compiles only some of
  // its chapters: a host may compile the whole paper meanwhile, without
  // waiting for or competing with a build of the same files here.
  private revisions = new Map<string, string>();
  // Page updates are transient, like revisions; polling must not write SQLite
  // for every page of a long baseline or either parallel comparison build.
  private builds = new Map<string, Partial<Record<"baseline" | "revised", BuildProgress>>>();
  progress(id: string) { return this.builds.get(id); }
  /** Whether a newer job of the same task will publish after this one. */
  superseded(job: Pick<Job, "id" | "task">) {
    const latest = this.pending.get(job.task);
    return latest !== undefined && latest !== job.id;
  }
  /** A job compiles in the foreground while its review page is open. Once a
   *  newer job of its task supersedes it, it continues in the background:
   *  that job can still continue from its builds. */
  priority(job: Pick<Job, "id" | "task">): BuildPriority {
    if (this.superseded(job)) return "background";
    return now() - (this.app.viewers.get(job.task) ?? 0) < VIEWING ? "foreground" : "normal";
  }
  /** Someone opened or still reads a task's review page. */
  attend() {
    reprioritize();
  }
  // Viewing ends without a request, so running builds are looked at again.
  private watching: NodeJS.Timeout | null = null;
  // Each task whose agent's writes are being compiled ahead, whether newer
  // writes came meanwhile, the baseline it built, and whether the round
  // after it needed that very build.
  private speculating = new Map<string, { again: boolean }>();
  private speculations = new Set<Promise<void>>();
  private guesses = new Map<string, string>();
  private verdicts = new Map<string, "hit" | "miss">();
  /** A task's agent is writing files. Compiles in the background what its
   *  next round will compile first: the seed of its base and the baseline of
   *  the chapters that `planAsync` chooses for the edits so far. Writes made
   *  meanwhile are planned again once that is done. */
  prefetch(name: string) {
    this.app.tasks.get(name);
    const running = this.speculating.get(name);
    if (running) { running.again = true; return; }
    const entry = { again: true };
    this.speculating.set(name, entry);
    const promise = (async () => {
      try {
        while (entry.again && !this.stopping) {
          entry.again = false;
          // A guess that does not compile is no error: the round reports it.
          await this.speculate(name).catch(() => undefined);
        }
      } finally { this.speculating.delete(name); }
    })();
    this.speculations.add(promise);
    void promise.finally(() => this.speculations.delete(promise));
  }
  private async speculate(name: string) {
    // A round being built compiles the real thing.
    if (this.busy(name)) return;
    const app = this.app, task = app.tasks.get(name);
    if (!fs.existsSync(task.worktree)) return;
    const after = await app.tasks.snapshotAsync(task), before = task.accepted,
      files = await app.repo.changedFilesAsync(before, after);
    if (!files.length) return;
    const builder = new Builder(app.project, app.repo), targets = await builder.planAsync(before, after, files);
    const seed = targets[0] !== "full" ? await builder.buildSeed(task.base, { priority: "background" }) : null;
    if (this.busy(name) || this.stopping) return;
    const date = buildDate();
    const baseline = await builder.build(before, targets, seed, { date, priority: "background" });
    this.guesses.set(name, baseline.key);
    // Only chapter-sized revised speculation is approved. A finished run
    // also supplies the next observed edit with compatible warm state.
    if (targets[0] !== "full" && !this.busy(name) && !this.stopping && !this.speculating.get(name)?.again)
      await builder.build(after, targets, seed, { date, priority: "background" });
  }
  private async compile(job: Pick<Job, "id" | "task">, side: "baseline" | "revised", builder: Builder, rev: string, targets = ["full"], seed: BuildInfo | null = null, { asSeed = false, force = false, date }: { asSeed?: boolean; force?: boolean; date?: ReturnType<typeof buildDate> } = {}) {
    const progress = this.builds.get(job.id) ?? {};
    this.builds.set(job.id, progress);
    progress[side] = { step: "tex", pass: 0, pages: 0, total: null };
    try {
      const options = { force, date, priority: () => this.priority(job), progress: (value: BuildProgress) => { progress[side] = value; } };
      const result = await (asSeed ? builder.buildSeed(rev, options) : builder.build(rev, targets, seed, options));
      const guess = this.guesses.get(job.task);
      if (side === "baseline" && !asSeed && guess) this.verdicts.set(job.id, guess === result.key ? "hit" : "miss");
      return result;
    } finally {
      delete progress[side];
      if (!Object.keys(progress).length) this.builds.delete(job.id);
    }
  }
  // Whether each job lists indirect changes, and each task's latest choice:
  // a request that does not say, such as an inline source edit or the CLI
  // without --indirect, keeps the task's choice.
  private indirect = new Map<string, boolean>();
  private tracking = new Map<string, boolean>();
  constructor(public app: App) {
    // A job whose round is inserted renders it after the restart (`recover`).
    app.store.execute(
      `UPDATE jobs SET status='failed', finished=?, result=? WHERE status IN ('queued','running')
        AND id NOT IN (SELECT json_extract(summary,'$.job') FROM rounds AS r WHERE visuals='pending'
          AND json_extract(summary,'$.job') IS NOT NULL AND number=(SELECT MAX(number) FROM rounds WHERE task=r.task))`,
      now(),
      JSON.stringify({
        error: "The review server restarted during the build.",
        next: "Publish again.",
      }),
    );
  }
  submit(name: string, requestId?: string, indirect?: boolean) {
    this.app.tasks.get(name);
    if (indirect !== undefined) this.tracking.set(name, indirect);
    const job = this.app.store.transaction(() => this.enqueue(name, requestId));
    if (job.status === "queued" && (indirect !== undefined || !this.indirect.has(job.id)))
      this.indirect.set(job.id, this.tracking.get(name) ?? false);
    return job;
  }
  private enqueue(name: string, requestId?: string) {
    if (requestId) {
      const existing = this.app.store.one<Job>("SELECT jobs.* FROM jobs JOIN build_requests ON jobs.id=build_requests.job WHERE build_requests.id=?", requestId);
      if (existing) {
        if (existing.task !== name) throw new Error("This build request belongs to another task.");
        return existing;
      }
    }
    const remember = (job: Job) => {
      if (requestId) this.app.store.execute("INSERT INTO build_requests(id,task,job) VALUES(?,?,?)", requestId, name, job.id);
      return job;
    };
    if (this.stopping)
      throw new Error(
        "The review server is stopping. Publish again after it restarts.",
      );
    const current = this.pending.get(name);
    if (current) {
      const job = this.job(current);
      if (job.status === "queued") return remember(job);
    }
    const id = randomBytes(8).toString("hex");
    this.app.store.execute(
      "INSERT INTO jobs(id,task,status,created) VALUES(?,?,'queued',?)",
      id,
      name,
      now(),
    );
    this.pending.set(name, id);
    if (!this.running.has(name)) this.queue.push(id);
    // The running job of this task is superseded now.
    else reprioritize();
    queueMicrotask(() => this.drain());
    return remember(this.job(id));
  }
  job(id: string) {
    const job = this.app.store.one<Job>("SELECT * FROM jobs WHERE id=?", id);
    if (!job) throw new Error("Unknown job " + id);
    return job;
  }
  revision(id: string) {
    return this.revisions.get(id) ?? null;
  }
  current(name: string) {
    return this.app.store.one<Job>(
      "SELECT * FROM jobs WHERE task=? ORDER BY created DESC,rowid DESC LIMIT 1",
      name,
    );
  }
  busy(name?: string) {
    return name ? this.pending.has(name) : this.pending.size > 0;
  }
  ahead(job: Job) {
    return this.app.store.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') AND created<?",
      job.created,
    )!.n;
  }
  update(
    id: string,
    fields: Partial<Pick<Job, "phase" | "status" | "finished">> & {
      result?: JobResult;
    },
  ) {
    const entries = Object.entries(fields);
    this.app.store.execute(
      "UPDATE jobs SET " +
        entries.map(([key]) => key + "=?").join(",") +
        " WHERE id=?",
      ...entries.map(([key, value]) =>
        key === "result" ? JSON.stringify(value) : (value as string | number),
      ),
      id,
    );
  }
  stop() {
    this.stopping = true;
  }
  private phase(job: Pick<Job, "id">, phase: string) {
    if (this.stopping) throw new Error("Server stopped during publication.");
    this.update(job.id, { phase });
  }
  async join() {
    await Promise.resolve();
    while (this.running.size || this.pruning || this.speculations.size)
      await Promise.allSettled([
        ...this.running.values(),
        ...this.speculations,
        ...(this.pruning ? [this.pruning] : []),
      ]);
  }
  private drain() {
    if (this.pruning) return;
    while (
      !this.stopping &&
      this.queue.length &&
      this.running.size < this.app.project.build_workers
    ) {
      const job = this.next();
      this.update(job.id, { status: "running" });
      const promise = Promise.resolve().then(() => this.work(job));
      this.running.set(job.task, promise);
    }
    if (this.running.size && !this.watching) {
      this.watching = setInterval(() => reprioritize(), 5000);
      this.watching.unref();
    } else if (!this.running.size && this.watching) {
      clearInterval(this.watching);
      this.watching = null;
    }
  }
  // The queued job whose review page was looked at most recently, and of
  // those the oldest: the author waits for what they read.
  private next() {
    const jobs = this.queue.map((id) => this.job(id)),
      viewed = (job: Job) => this.app.viewers.get(job.task) ?? 0;
    let best = 0;
    for (let i = 1; i < jobs.length; i++) if (viewed(jobs[i]) > viewed(jobs[best])) best = i;
    this.queue.splice(best, 1);
    return jobs[best];
  }
  private async work(job: Job) {
    try {
      const result = await this.publish(job);
      // A newer round replaced this one before its PDF was ready: the note
      // option's checkmark waits for the author to review that round.
      if (!result.superseded) await acceptNoteOption(this.app, job.task, job.id);
      const verdict = this.verdicts.get(job.id);
      this.update(job.id, { status: "done", result: verdict ? { ...result, prefetch: verdict } : result, finished: now() });
    } catch (error) {
      // A build the server stopped stays unfinished: the next server marks it
      // as interrupted by a restart, and the app builds it again.
      if (this.stopping) return;
      const result: JobResult =
        error instanceof PublishError
          ? {
              error: error.message,
              details: error.details,
              next: error.next,
              ...(error.log ? { log: error.log } : {}),
            }
          : { error: (error as Error).message, next: "Publish again." };
      this.update(job.id, { status: "failed", result, finished: now() });
    } finally {
      this.revisions.delete(job.id);
      this.builds.delete(job.id);
      this.indirect.delete(job.id);
      // A guess serves the round after the writes it saw, once.
      if (this.verdicts.delete(job.id)) this.guesses.delete(job.task);
      this.running.delete(job.task);
      if (this.pending.get(job.task) === job.id) this.pending.delete(job.task);
      else if (!this.stopping) this.queue.push(this.pending.get(job.task)!);
      this.drain();
      if (!this.pending.size && !this.stopping) await this.pruneCache();
    }
  }
  /** Publishes the task's worktree: inserts its round, then renders the
   *  round's PDF comparison. */
  async publish(job: Pick<Job, "id" | "task">): Promise<JobResult> {
    const app = this.app,
      name = job.task;
    if (app.reconciliation.get(name)?.ready === false) throw new Error("Retry applying to finish preparing the merge review.");
    this.phase(job, "snapshot");
    const inserted = await app.exclusive(() => this.insertNow(job));
    return "result" in inserted ? inserted.result : this.renderRound(job, inserted.round);
  }
  /** Inserts a round for the worktree as it is now, with its comparison
   *  pending. The caller holds the engine's write turn: the worktree, the
   *  accepted text and the latest round are read together with the insert, so
   *  a decision either comes before the round, or applies to it. */
  async insertNow(job: Pick<Job, "id" | "task">): Promise<{ result: JobResult } | { round: Round }> {
    const app = this.app,
      name = job.task,
      project = app.project;
    const task = app.tasks.get(name);
    if (!fs.existsSync(task.worktree))
      throw new PublishError(
        `The task worktree ${task.worktree} no longer exists.`,
        [],
        "Run `finish --force`, then start a new task.",
      );
    const after = await app.tasks.snapshotAsync(task),
      before = app.tasks.get(name).accepted,
      latest = app.review.latestRound(name);
    const violations = await scopeViolationsAsync(app.repo, task.base, after, task.scope);
    const reconciliation = app.reconciliation.get(name);
    if (reconciliation) {
      for (const file of await app.repo.changedFilesAsync(task.base, after))
        if (!reconciliation.files.includes(file) && !violations.includes(file)) violations.push(file);
    }
    if (violations.length)
      throw new PublishError(
        "Some edits are outside the task scope: " +
          violations.slice(0, 10).join(", "),
        [
          "Allowed: " +
            (reconciliation ? reconciliation.files : task.scope.sections.length
              ? task.scope.sections.map((s) => `${s.number} ${s.title}`)
              : task.scope.paths
            ).join(", "),
        ],
        "Undo edits outside the scope, then publish again.",
      );
    // A round from before the choice existed listed indirect changes.
    const indirect = this.indirect.get(job.id) ?? this.tracking.get(name) ?? false;
    if (
      latest &&
      latest.before === before &&
      (await app.repo.treeIdAsync(latest.after)) === (await app.repo.treeIdAsync(after)) &&
      latest.summary.renderer === codeVersion() &&
      (latest.summary.indirect ?? true) === indirect
    )
      // A round whose render failed or was interrupted renders again.
      return (latest.visuals ?? "ready") === "ready"
        ? { result: { outcome: "unchanged", round: latest.number, changes: latest.units.length } }
        : { round: latest };
    const files = await app.repo.changedFilesAsync(before, after);
    const optionUnits = await noteOptionUnits(app, name, job.id, before, after);
    const number = (latest?.number ?? 0) + 1,
      final = roundFolder(app, name, number);
    const insert = async (units: Unit[], summary: Round["summary"], visuals: Round["visuals"]) => {
      // The ref comes first: a round in the store always keeps its version
      // across Git's garbage collection.
      await app.repo.updateRefAsync(`refs/latex-review/${name}/round-${number}`, after);
      app.store.execute(
        "INSERT INTO rounds(task,number,before,after,units,summary,created,visuals) VALUES(?,?,?,?,?,?,?,?)",
        name,
        number,
        before,
        after,
        JSON.stringify(units),
        JSON.stringify(summary),
        now(),
        visuals!,
      );
      return app.review.round(name, number);
    };
    if (!files.length && !optionUnits) {
      // A manual correction can remove the final proposal altogether. Give
      // it an empty latest round so the viewer cannot keep offering the old
      // wording for acceptance after it has disappeared from the worktree.
      if (latest && app.store.one("SELECT id FROM build_requests WHERE job=? AND id LIKE 'source-%'", job.id)) {
        await fs.promises.rm(final, { recursive: true, force: true });
        await insert([], { renderer: codeVersion(), indirect, warnings: [], targets: ["full"], builds: [], job: job.id }, "ready");
        return { result: { outcome: "empty", round: number, changes: 0 } };
      }
      return { result: { outcome: "empty", round: null, changes: 0 } };
    }
    const units = await withHashesAsync(app.repo, before, after, optionUnits ?? await diffUnitsAsync(app.repo, before, after, (f) =>
      isFigure(project, f),
    ));
    const targets = await new Builder(project, app.repo).planAsync(before, after, files),
      shown = await provisional(app, name, latest, { before, after, units }),
      pending = final + ".pending-" + randomBytes(4).toString("hex");
    try {
      await writeProvisional(pending, shown);
      await fs.promises.rm(final, { recursive: true, force: true });
      await fs.promises.rename(pending, final);
    } finally {
      await fs.promises.rm(pending, { recursive: true, force: true });
    }
    const round = await insert(units, { renderer: codeVersion(), indirect, warnings: [], targets, date: buildDate(), builds: [], job: job.id }, "pending");
    return { round };
  }
  /** Inserts the worktree's round now when an earlier build of the task is
   *  still running, so a source edit need not wait for it. The caller holds
   *  the engine's write turn. Problems are reported when the job runs. */
  async insertBehind(job: Pick<Job, "id" | "task" | "status">) {
    if (job.status !== "queued" || !this.running.has(job.task)) return;
    try {
      await this.insertNow(job);
    } catch {
      /* The job inserts again when it starts, and fails with the reason. */
    }
  }
  private roundSuperseded(round: Round) {
    return this.app.review.latestRound(round.task)?.number !== round.number;
  }
  /** Compiles and renders a round's PDF comparison and attaches it to that
   *  round. Running it again for the same round is safe. */
  private async renderRound(job: Pick<Job, "id" | "task">, round: Round): Promise<JobResult> {
    try {
      return await this.renderComparison(job, round);
    } catch (error) {
      // A build the server stopped renders again after the restart.
      if (!this.stopping) await this.app.exclusive(() => this.renderFailed(round)).catch((problem) => console.error("Marking a failed comparison:", problem));
      throw error;
    }
  }
  private async renderComparison(job: Pick<Job, "id" | "task">, round: Round): Promise<JobResult> {
    const app = this.app,
      name = job.task,
      project = app.project,
      { before, after, units } = round,
      superseded = { outcome: "published" as const, round: round.number, changes: units.length, superseded: true };
    // A newer round needs its own render; this one would only be replaced.
    if (this.roundSuperseded(round)) return superseded;
    this.phase(job, "build");
    const builder = new Builder(project, app.repo),
      targets = round.summary.targets?.length ? round.summary.targets : ["full"],
      date = round.summary.date ?? buildDate(new Date(round.created * 1000)),
      indirect = round.summary.indirect ?? true;
    if (targets[0] !== "full") this.revisions.set(job.id, after);
    const failed = (what: string) => (error: unknown) => {
      if (error instanceof BuildError)
        throw new PublishError(
          what,
          error.details,
          "Check the compiler diagnostics, fix the document or build environment, then publish again.",
          error.log,
        );
      throw error;
    };
    const base = app.tasks.get(name).base;
    let seed = targets[0] !== "full" ? await this.compile(job, "baseline", builder, base, ["full"], null, { asSeed: true }).catch(failed("The comparison baseline could not be compiled.")) : null;
    // Both versions compile at once: each needs only the seed.
    const versions = () => Promise.allSettled([
      this.compile(job, "baseline", builder, before, targets, seed, { date }),
      this.compile(job, "revised", builder, after, targets, seed, { date }),
    ]);
    let builds = await versions();
    if (!this.stopping && seed && builds.some((built) => built.status === "rejected" && auxiliaryBuildError(built.reason))) {
      // An external package can invalidate readable aux files without
      // changing the source tree or engine version. Rebuild the seed once,
      // after both attempts finish, then use it for both comparison sides.
      seed = await this.compile(job, "baseline", builder, base, ["full"], null, { asSeed: true, force: true }).catch(failed("The comparison baseline could not be compiled."));
      builds = await versions();
    }
    // A failure of either is reported once both have settled, the baseline's first.
    const [baseline, revised] = builds,
      old = baseline.status === "fulfilled" ? baseline.value : failed("The comparison baseline could not be compiled.")(baseline.reason),
      next = revised.status === "fulfilled" ? revised.value : failed("The revised document could not be compiled.")(revised.reason);
    if (this.roundSuperseded(round)) return superseded;
    const warnings = next.warnings.filter((w) => !old.warnings.includes(w));
    this.phase(job, "render");
    const final = roundFolder(app, name, round.number),
      output = final + ".pending-" + randomBytes(4).toString("hex");
    fs.mkdirSync(output, { recursive: true });
    const summary = {
      ...round.summary,
      warnings,
      targets,
      date,
      builds: [seed, old, next].filter((b) => b !== null).map((b) => b.key),
    };
    try {
      await render(
        output,
        {
          main: project.main,
          source_dir: project.source_dir,
          figures: project.figures,
          old,
          new: next,
          units,
          indirect,
        },
        // Only a round that lists indirect changes compiles variants to
        // find the edits behind them.
        indirect
          ? (subset) =>
              builder.build(
                withUnits(app.repo, before, after, subset),
                targets,
                seed,
                { date, priority: () => this.priority(job) },
              )
          : undefined,
        () => this.priority(job),
      );
      // Decisions go on meanwhile; they never change a round's versions.
      await app.exclusive(async () => {
        await fs.promises.mkdir(final, { recursive: true });
        // The page may still show the carried strips: keep them until it
        // reloads, and replace round.json last.
        for (const file of await fs.promises.readdir(output))
          if (file !== "round.json") await fs.promises.rename(path.join(output, file), path.join(final, file));
        await fs.promises.rename(path.join(output, "round.json"), path.join(final, "round.json"));
        app.store.execute(
          "UPDATE rounds SET visuals='ready', summary=? WHERE task=? AND number=?",
          JSON.stringify(summary),
          name,
          round.number,
        );
      });
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
    const visual = readJson<RenderedRound>(path.join(final, "round.json"), {
        units: {},
        sections: [],
        loose: [],
      }),
      kinds: Record<string, number> = {};
    for (const unit of Object.values(visual.units))
      kinds[unit.visual] = (kinds[unit.visual] ?? 0) + 1;
    return {
      outcome: "published",
      round: round.number,
      changes: units.length,
      kinds,
      warnings,
    };
  }
  // Without its own comparison, each change that exactly matches one of the
  // previous round shows that round's comparison, labelled with its round,
  // rather than none: the old version is better than no version. The rest
  // cannot be decided until a later round renders.
  private async renderFailed(round: Round) {
    const app = this.app,
      current = app.review.round(round.task, round.number);
    if ((current.visuals ?? "ready") !== "pending") return;
    if (!this.roundSuperseded(round) && round.number > 1) {
      const previous = app.review.round(round.task, round.number - 1);
      await writeProvisional(roundFolder(app, round.task, round.number), await provisional(app, round.task, previous, round, true));
    }
    app.store.execute("UPDATE rounds SET visuals='failed' WHERE task=? AND number=?", round.task, round.number);
  }
  /** At start, after interrupted writes are finished: renders each task's
   *  latest round whose comparison a restart interrupted, and restores round
   *  refs a restart between a round's ref and its insert left behind. */
  async recover() {
    const app = this.app;
    for (const task of app.tasks.list()) {
      const rounds = app.store.all<Pick<Round, "number" | "after">>("SELECT number,after FROM rounds WHERE task=?", task.name),
        refs = new Map(
          (await app.repo.textAsync(["for-each-ref", "--format=%(refname) %(objectname)", `refs/latex-review/${task.name}/`]))
            .split("\n")
            .filter(Boolean)
            .map((line) => line.split(" ") as [string, string]),
        );
      for (const round of rounds) {
        const ref = `refs/latex-review/${task.name}/round-${round.number}`;
        if (refs.get(ref) !== round.after) await app.repo.updateRefAsync(ref, round.after);
      }
      const latest = app.review.latestRound(task.name);
      // An undo that inserts a round stopped before the insert: its accept
      // is undone, so the round with the change pending again follows now.
      const undone = app.store.one<{ status: string; detail: { republish?: number } }>("SELECT status,detail FROM actions WHERE task=? ORDER BY seq DESC LIMIT 1", task.name);
      if (undone?.status === "undone" && undone.detail.republish && (latest?.number ?? 0) < undone.detail.republish) {
        if (!this.pending.has(task.name) && !this.stopping) this.submit(task.name, undefined, latest?.summary.indirect ?? true);
        continue;
      }
      if (!latest || latest.visuals !== "pending" || this.stopping) continue;
      // The job that inserted it continues, so a host polling it sees the
      // round it is waiting for. It lists indirect changes as the round
      // does, so it renders that round rather than inserting another.
      const job = latest.summary.job ? app.store.one<Job>("SELECT * FROM jobs WHERE id=? AND status IN ('queued','running')", latest.summary.job) : null,
        indirect = latest.summary.indirect ?? true;
      if (job && !this.pending.has(task.name)) {
        this.update(job.id, { status: "queued" });
        this.indirect.set(job.id, indirect);
        this.pending.set(task.name, job.id);
        this.queue.push(job.id);
        queueMicrotask(() => this.drain());
      } else if (!this.pending.has(task.name)) this.submit(task.name, undefined, indirect);
    }
  }
  async pruneCache() {
    if (this.pruning) return this.pruning;
    if (this.busy()) return;
    const keep = new Set(
      this.app.store
        .all<Pick<Round, "summary">>(
          "SELECT summary FROM rounds JOIN tasks ON rounds.task=tasks.name WHERE tasks.closed IS NULL",
        )
        .flatMap((r) => r.summary.builds ?? []),
    );
    this.pruning = new Builder(this.app.project, this.app.repo).prune(keep);
    try {
      await this.pruning;
    } catch (error) {
      console.error("Build cache cleanup:", error);
    } finally {
      this.pruning = null;
      this.drain();
    }
  }
}
