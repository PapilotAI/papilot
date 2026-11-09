import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Lease, SLOTS } from "../../src/core/pool.ts";
import { Builder } from "../../src/core/build.ts";
import { Fixture } from "./helpers.ts";

const posix = process.platform !== "win32";
const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 10000) => {
  for (const end = Date.now() + ms; !check() && Date.now() < end; ) await sleep(25);
  expect(check()).toBe(true);
};
const stopped = (pid: number) => { try { return execFileSync("ps", ["-o", "stat=", "-p", String(pid)]).toString().trim().startsWith("T"); } catch { return false; } };
let dir = "", previous: string | undefined, leases: Lease[] = [], children: ChildProcess[] = [], groups: number[] = [];
const lease = (priority: "foreground" | "normal" | "background") => { const made = new Lease(() => priority); leases.push(made); return made; };
// A stand-in compiler in its own process group, as latexmk runs.
const compiler = (held: Lease) => { const child = spawn("sleep", ["120"], { detached: true, stdio: "ignore" }); groups.push(child.pid!); held.attach(child); return child.pid!; };
// A lease held by another process.
async function holder(priority: string, stale = "20000") {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(ENGINE, "tests/ts/pool-holder.ts"), priority], { cwd: ENGINE, env: { ...process.env, PAPILOT_TEX_POOL: dir, PAPILOT_TEX_POOL_STALE: stale }, stdio: ["pipe", "pipe", "inherit"] });
  children.push(child);
  const line = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout! }).once("line", resolve);
    child.once("exit", () => reject(new Error("The other process ended before it held a lease.")));
  });
  const held = JSON.parse(line) as { slot: number; borrowed: boolean; pgid: number };
  groups.push(held.pgid);
  return { child, ...held };
}
beforeEach(() => {
  previous = process.env.PAPILOT_TEX_POOL;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "papilot-pool-test-"));
  process.env.PAPILOT_TEX_POOL = dir;
});
afterEach(async () => {
  await Promise.all(leases.map((held) => held.release()));
  for (const child of children) child.kill("SIGKILL");
  for (const group of groups) for (const signal of ["SIGCONT", "SIGKILL"] as const) try { process.kill(-group, signal); } catch { /* Gone. */ }
  leases = []; children = []; groups = [];
  if (previous === undefined) delete process.env.PAPILOT_TEX_POOL; else process.env.PAPILOT_TEX_POOL = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("lets two TeX runs hold slots at once, and the next one waits for a slot", async () => {
  expect(SLOTS).toBe(2);
  const first = lease("normal"), second = lease("normal");
  await Promise.all([first.ready, second.ready]);
  expect(new Set([first.slot, second.slot])).toEqual(new Set([0, 1]));
  const third = lease("normal");
  let acquired = false;
  void third.ready.then(() => { acquired = true; });
  await sleep(400);
  expect(acquired).toBe(false);
  await first.release();
  await third.ready;
  expect(third.slot).toBe(first.slot);
});

it("never gives background work more than one slot", async () => {
  const speculative = lease("background");
  await speculative.ready;
  const another = lease("background");
  let acquired = false;
  void another.ready.then(() => { acquired = true; });
  await sleep(400);
  expect(acquired).toBe(false);
  // The free slot is still there for work someone waits for.
  const wanted = lease("normal");
  await wanted.ready;
  await speculative.release();
  await another.ready;
  expect(another.slot).toBe(speculative.slot);
});

it("gives a free slot to the highest priority first, then to whoever waited longest", async () => {
  const first = lease("normal"), second = lease("normal");
  await Promise.all([first.ready, second.ready]);
  const order: string[] = [];
  const older = lease("normal");
  void older.ready.then(() => order.push("older"));
  await sleep(100);
  const urgent = lease("foreground");
  void urgent.ready.then(() => order.push("urgent"));
  await sleep(300);
  expect(order).toEqual([]);
  await first.release();
  await until(() => order.length === 1);
  expect(order).toEqual(["urgent"]);
  await second.release();
  await until(() => order.length === 2);
  expect(order).toEqual(["urgent", "older"]);
});

it.skipIf(!posix)("stops another process's background run to lend its slot, and continues it when the borrower is done", async () => {
  const lender = await holder("background"), busy = lease("normal");
  await busy.ready;
  expect(busy.slot).not.toBe(lender.slot);
  expect(stopped(lender.pgid)).toBe(false);
  const urgent = lease("foreground");
  await urgent.ready;
  expect([urgent.borrowed, urgent.slot]).toEqual([true, lender.slot]);
  // Confirmed before the borrower runs.
  expect(stopped(lender.pgid)).toBe(true);
  await urgent.release();
  await until(() => !stopped(lender.pgid));
});

it.skipIf(!posix)("continues a lent run when its borrower dies", async () => {
  const lender = lease("background");
  await lender.ready;
  const pgid = compiler(lender), busy = lease("normal");
  await busy.ready;
  const borrower = await holder("foreground");
  expect([borrower.borrowed, borrower.slot]).toEqual([true, lender.slot]);
  expect(stopped(pgid)).toBe(true);
  borrower.child.kill("SIGKILL");
  await until(() => !stopped(pgid));
  // The slot is the lender's again: normal work cannot borrow it.
  const next = lease("normal");
  let acquired = false;
  void next.ready.then(() => { acquired = true; });
  await sleep(400);
  expect(acquired).toBe(false);
});

it.skipIf(!posix)("takes over the slot of a process that crashed once its lease goes stale", async () => {
  process.env.PAPILOT_TEX_POOL_STALE = "2000";
  try {
    const crashed = await holder("normal", "2000"), busy = lease("normal");
    await busy.ready;
    const waiting = lease("normal");
    let acquired = false;
    void waiting.ready.then(() => { acquired = true; });
    await sleep(300);
    expect(acquired).toBe(false);
    crashed.child.kill("SIGKILL");
    await until(() => acquired, 15000);
    expect(waiting.slot).toBe(crashed.slot);
  } finally { delete process.env.PAPILOT_TEX_POOL_STALE; }
});

it.skipIf(!posix)("runs at most two latexmk at once when three builds start together", async () => {
  const f = new Fixture(), bin = path.join(f.base, "bin"), runs = path.join(f.base, "runs"), previousPath = process.env.PATH;
  fs.mkdirSync(bin); fs.mkdirSync(runs);
  fs.writeFileSync(path.join(bin, "pdflatex"), "#!/bin/sh\necho 'pdfTeX 3.14 (fake)'\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "latexmk"), `#!/bin/sh\ntouch "${runs}/running-$$"\nls "${runs}" | grep -c running >> "${runs}/counts"\nsleep 0.7\nrm "${runs}/running-$$"\nmkdir -p build && echo pdf > build/main.pdf\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  try {
    const builder = new Builder((await import("../../src/core/config.ts")).loadProject(f.root), f.repo), revisions = [f.repo.rev("HEAD")];
    for (const text of ["Second.", "Third."]) {
      f.write("paper/main.tex", f.read("paper/main.tex").replace("We conclude.", `We conclude. ${text}`));
      f.repo.run(["commit", "-qam", text]);
      revisions.push(f.repo.rev("HEAD"));
    }
    const built = await Promise.all(revisions.map((rev) => builder.build(rev)));
    expect(new Set(built.map((b) => b.key)).size).toBe(3);
    const counts = fs.readFileSync(path.join(runs, "counts"), "utf8").trim().split("\n").map(Number);
    expect(counts).toHaveLength(3);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  } finally {
    process.env.PATH = previousPath;
    await f.close();
  }
});
