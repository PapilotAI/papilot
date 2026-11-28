import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { Fixture, METHOD, BODY, fakeRound, holdFolder } from "./helpers.ts";
import { safePath } from "../../src/core/review.ts";
import { App } from "../../src/server.ts";
import type { Task, ActionKind } from "../../src/types.ts";
let f: Fixture, app: App, task: Task;
beforeEach(() => {
  f = new Fixture();
  app = f.app();
  task = app.tasks.create("polish", "Polish", [], ["paper"]);
});
afterEach(async () => f.close());
function two() {
  f.edit(task, METHOD, "Method sentence 2.", "Agent A.");
  f.edit(task, METHOD, "Detail sentence 15.", "Agent B.");
  return fakeRound(app, task.name);
}
function decide(
  action: ActionKind,
  changes: string[],
  id: string = action,
  body = "",
) {
  return app.review.decide(task.name, {
    action,
    changes,
    id,
    body,
    round: app.review.latestRound(task.name)!.number,
  });
}
it("lists publication times in history and keeps past decisions tied to their changes", async () => {
  const first = two();
  await decide("reject", [first.units[0].id]);
  f.edit(task, METHOD, "Agent B.", "Agent C.");
  const second = fakeRound(app, task.name);
  const state = app.review.pageState(task.name, first.number);
  expect(state.history).toEqual([
    { number: second.number, created: second.created },
    { number: first.number, created: first.created },
  ]);
  expect(state.round).toBe(first.number);
  expect(state.latest).toBe(second.number);
  expect(state.decisions[first.units[0].id]).toBe("rejected");
  expect(state.undo).toBeNull();
});
it("accept merges with user edits and leaves HEAD/index untouched", async () => {
  two();
  f.write(METHOD, BODY.replace("Detail sentence 3.", "User edit."));
  const head = app.repo.rev("HEAD"),
    index = fs.readFileSync(path.join(f.root, ".git/index"));
  const state = await decide("accept", ["c001"]);
  expect(f.read(METHOD)).toBe(
    BODY.replace("Method sentence 2.", "Agent A.").replace(
      "Detail sentence 3.",
      "User edit.",
    ),
  );
  expect(state.decisions).toEqual({ c001: "accepted", c002: "pending" });
  expect(app.repo.rev("HEAD")).toBe(head);
  expect(fs.readFileSync(path.join(f.root, ".git/index"))).toEqual(index);
  expect(
    app.repo.blob(app.tasks.get(task.name).accepted, METHOD)?.toString(),
  ).not.toContain("User edit.");
});
it("undo proceeds one decision at a time and preserves later edits", async () => {
  two();
  await decide("accept", ["c001"], "first");
  await decide("accept", ["c002"], "second");
  await expect((async () => app.review.undo(task.name, "first"))()).rejects.toThrow();
  f.write(
    METHOD,
    f.read(METHOD).replace("Method sentence 15.", "Later user edit."),
  );
  await app.review.undo(task.name, "second");
  const state = await app.review.undo(task.name, "first");
  expect(state.decisions).toEqual({ c001: "pending", c002: "pending" });
  expect(state.undo).toBeNull();
  expect(f.read(METHOD)).toBe(
    BODY.replace("Method sentence 15.", "Later user edit."),
  );
  expect(app.tasks.get(task.name).accepted).toBe(task.base);
});
it("overlapping accept writes nothing", async () => {
  two();
  f.write(
    METHOD,
    BODY.replace("Method sentence 2.", "User rewrote this line."),
  );
  const before = f.read(METHOD);
  await expect((async () => decide("accept", ["c001"]))()).rejects.toThrow(
    "changed in your manuscript",
  );
  expect(f.read(METHOD)).toBe(before);
  expect(app.review.pageState(task.name).decisions.c001).toBe("pending");
});
it("undo refuses to overwrite new edits on an accepted line", async () => {
  two();
  await decide("accept", ["c001"]);
  f.write(
    METHOD,
    f.read(METHOD).replace("Agent A.", "User changed accepted line."),
  );
  await expect((async () => app.review.undo(task.name, "accept"))()).rejects.toThrow("Can't undo");
  expect(app.review.pageState(task.name).undo?.id).toBe("accept");
});
it("reject reverts agent worktree and undo restores it", async () => {
  two();
  await decide("reject", ["c002"]);
  expect(f.read(METHOD, task.worktree)).not.toContain("Agent B.");
  expect(f.read(METHOD)).toBe(BODY);
  await app.review.undo(task.name, "reject");
  expect(f.read(METHOD, task.worktree)).toContain("Agent B.");
});
it("reject preserves agent edits made after publication and reports them", async () => {
  two();
  f.edit(task, METHOD, "Agent B.", "Agent B, edited again.");
  await decide("accept", ["c001"]);
  await decide("reject", ["c002"]);
  const feedback = app.review.feedback(task.name);
  expect(feedback.feedback.at(-1)?.not_reverted).toEqual([METHOD]);
  expect(feedback.state).toBe("revise");
});
it("accept and undo added/deleted files", async () => {
  f.write("paper/new.tex", "New file.\n", task.worktree);
  fs.unlinkSync(path.join(task.worktree, "paper/main.tex"));
  const round = fakeRound(app, task.name);
  await decide(
    "accept",
    round.units.map((u) => u.id),
  );
  expect(fs.existsSync(path.join(f.root, "paper/new.tex"))).toBe(true);
  expect(fs.existsSync(path.join(f.root, "paper/main.tex"))).toBe(false);
  await app.review.undo(task.name, "accept");
  expect(fs.existsSync(path.join(f.root, "paper/new.tex"))).toBe(false);
  expect(fs.existsSync(path.join(f.root, "paper/main.tex"))).toBe(true);
});
it("comments, note cursors and undo remain consistent", async () => {
  two();
  await decide("comment", ["c001"], "remark", "Keep this precise.");
  expect(app.review.pageState(task.name).comments.c001).toBe(
    "Keep this precise.",
  );
  const first = app.review.feedback(task.name);
  app.review.note(task.name, "Pause here.");
  const next = app.review.feedback(task.name, first.cursor);
  expect(next.feedback).toHaveLength(1);
  expect(next.feedback[0]).toMatchObject({ kind: "note", text: "Pause here." });
  await app.review.undo(task.name, "remark");
  expect(app.review.pageState(task.name).decisions.c001).toBe("pending");
  expect(
    app.review.feedback(task.name, first.cursor).feedback.at(-1)?.kind,
  ).toBe("undo");
});
it("action retry is idempotent but conflicting reuse is rejected", async () => {
  two();
  const first = await decide("accept", ["c001"], "retry");
  expect((await decide("accept", ["c001"], "retry")).decisions).toEqual(
    first.decisions,
  );
  expect(app.review.feedback(task.name).feedback).toHaveLength(1);
  await expect((async () => decide("reject", ["c002"], "retry"))()).rejects.toThrow("already used");
});
it("old rounds stay inspectable while stale decisions are rejected", async () => {
  two();
  f.edit(task, METHOD, "Agent A.", "Agent A, revised.");
  fakeRound(app, task.name);
  expect(app.review.pageState(task.name, 1).round).toBe(1);
  expect(app.review.pageState(task.name, 1).latest).toBe(2);
  // The revised change is another version: deciding the old one is refused.
  await expect(
    app.review.decide(task.name, {
      action: "accept",
      changes: ["c001"],
      round: 1,
    }),
  ).rejects.toThrow("newer round");
});
it("applies a decision naming an older round to the same version in the latest round", async () => {
  two();
  // Another edit shifts the numbering: the old c001 is c002 now.
  f.edit(task, METHOD, "Method sentence 0.", "Agent first.");
  const latest = fakeRound(app, task.name),
    old = app.review.round(task.name, 1);
  const moved = latest.units.find((u) => u.new_text === old.units[0].new_text)!;
  expect(moved.id).not.toBe(old.units[0].id);
  const state = await app.review.decide(task.name, { action: "accept", id: "from-round-1", changes: [old.units[0].id], round: 1 });
  // The page that sent it still shows round 1, with the decision made there.
  expect([state.round, state.latest]).toEqual([1, 2]);
  expect(state.decisions[old.units[0].id]).toBe("accepted");
  expect(Object.values(state.decisions).filter((d) => d !== "pending")).toHaveLength(1);
  expect(app.review.pageState(task.name).decisions[moved.id]).toBe("accepted");
  expect(app.review.pageState(task.name, 1).decisions[old.units[0].id]).toBe("accepted");
  expect(app.review.decisions(task.name, old)[old.units[0].id]).toBe("pending");
  const action = app.store.one<{ round: number; changes: string[]; detail: { requested?: unknown } }>("SELECT round,changes,detail FROM actions WHERE id='from-round-1'")!;
  // The action belongs to the round it applies to; the request is kept.
  expect(action.round).toBe(2);
  expect(action.changes).toEqual([moved.id]);
  expect(action.detail.requested).toEqual({ round: 1, changes: [old.units[0].id] });
  // A lost response is retried as it was sent.
  await app.review.decide(task.name, { action: "accept", id: "from-round-1", changes: [old.units[0].id], round: 1 });
  expect(app.store.all("SELECT id FROM actions")).toHaveLength(1);
  // Undo stays within the latest round.
  expect(app.review.undoEntry(task.name)?.id).toBe("from-round-1");
  // A change already decided in the latest round is not decided again.
  await expect(app.review.decide(task.name, { action: "reject", changes: [old.units[0].id], round: 1 })).rejects.toThrow("newer round");
});
it("refuses an older-round decision when its version is ambiguous in the latest round", async () => {
  f.write("paper/twins.tex", "Alpha.\nRepeated line.\nOmega.\n\nAlpha.\nRepeated line.\nOmega.\n");
  f.repo.run(["add", "."]);
  f.repo.run(["commit", "-qm", "Twins"]);
  const twins = app.tasks.create("twins", "Twins", [], ["paper"]);
  f.edit(twins, "paper/twins.tex", "Repeated line.", "Changed line.");
  fakeRound(app, twins.name);
  // The same edit on identical lines elsewhere cannot be told apart.
  f.edit(twins, "paper/twins.tex", "Repeated line.", "Changed line.");
  const latest = fakeRound(app, twins.name);
  expect(new Set(latest.units.map((u) => u.new_text)).size).toBe(1);
  await expect(app.review.decide(twins.name, { action: "accept", changes: ["c001"], round: 1 })).rejects.toThrow("newer round");
});
it("carries a comment from an unrendered earlier round without permitting a decision on its missing comparison", async () => {
  two();
  app.store.execute("UPDATE rounds SET visuals='pending' WHERE task=? AND number=1", task.name);
  f.edit(task, METHOD, "Agent B.", "Agent C.");
  fakeRound(app, task.name);
  const accepted = app.tasks.get(task.name).accepted, source = f.read(METHOD, task.worktree);
  for (const action of ["accept", "reject"] as const)
    await expect(app.review.decide(task.name, { action, round: 1, changes: ["c001"] })).rejects.toThrow("newer round");
  const result = await app.review.decide(task.name, { id: "early-comment", action: "comment", round: 1, changes: ["c001"], body: "Please explain this wording." });
  expect(result.round).toBe(1);
  expect(result.decisions.c001).toBe("commented");
  expect(result.comments.c001).toBe("Please explain this wording.");
  // Undone in the latest round, it is undecided on round 1's page too.
  await app.review.undo(task.name, "early-comment");
  expect(app.review.pageState(task.name, 1).decisions.c001).toBe("pending");
  expect(app.review.pageState(task.name, 1).comments.c001).toBeUndefined();
  expect(app.tasks.get(task.name).accepted).toBe(accepted);
  expect(f.read(METHOD, task.worktree)).toBe(source);
});

// A deferred task whose author accepted a change while the agent worked, and
// the agent's round that followed.
async function acceptedBeforeNewerRound() {
  const later = app.tasks.create("later", "Later", [], ["paper"], true);
  f.edit(later, METHOD, "Method sentence 2.", "Agent A.");
  f.edit(later, METHOD, "Detail sentence 15.", "Agent B.");
  const first = fakeRound(app, later.name), accepted = app.tasks.get(later.name).accepted;
  const change = first.units.find((u) => u.new_text === "Agent A")!;
  await app.review.decide(later.name, { id: "while-working", action: "accept", round: 1, changes: [change.id] });
  f.edit(later, METHOD, "Method sentence 4.", "Agent D.");
  const second = fakeRound(app, later.name);
  // The round compiles in the background, as the publisher would.
  vi.spyOn(app.publisher, "publish").mockImplementation(async (job) => ({ outcome: "published", round: app.review.latestRound(job.task)!.number, changes: 0 }));
  return { later, accepted, second };
}
it("undoes an accept made before a newer round nobody decided on, with a round showing the change again", async () => {
  const { later, accepted, second } = await acceptedBeforeNewerRound();
  expect(second.before).toBe(app.tasks.get(later.name).accepted);
  expect(app.review.pageState(later.name).undo).toMatchObject({ id: "while-working", kind: "accept", republish: true });
  const undone = await app.review.undo(later.name, "while-working");
  // Rounds stay as they were; the next one has the accepted text without it.
  const third = app.review.latestRound(later.name)!;
  expect([third.number, undone.round, undone.latest, undone.republished]).toEqual([3, 3, 3, true]);
  expect(app.tasks.get(later.name).accepted).toBe(accepted);
  expect(third.before).toBe(accepted);
  expect(app.review.round(later.name, 2)).toEqual(second);
  expect(third.units.map((u) => u.new_text).sort()).toEqual(["Agent A", "Agent B", "Agent D"]);
  expect(Object.values(undone.decisions)).toEqual(["pending", "pending", "pending"]);
  expect(undone.undo).toBeNull();
  expect(undone.job?.id).toBe(third.summary.job);
  // A lost reply is answered again without another round.
  expect((await app.review.undo(later.name, "while-working")).republished).toBe(true);
  await app.publisher.join();
  expect(app.review.latestRound(later.name)!.number).toBe(3);
  expect(app.store.one<{ kind: string }>("SELECT kind FROM messages WHERE task=? ORDER BY id DESC LIMIT 1", later.name)?.kind).toBe("undo");
});
it("keeps an earlier round's decision final once anything follows it", async () => {
  const { later } = await acceptedBeforeNewerRound();
  // The task's files changed since the newest round.
  f.edit(later, METHOD, "Method sentence 5.", "Agent E.");
  await expect((async () => app.review.undo(later.name, "while-working"))()).rejects.toThrow("changed since the newest round");
  expect(app.store.one<{ status: string }>("SELECT status FROM actions WHERE id='while-working'")?.status).toBe("applied");
  expect(app.review.latestRound(later.name)!.number).toBe(2);
  f.edit(later, METHOD, "Agent E.", "Method sentence 5.");
  // A decision on the newer round.
  const second = app.review.latestRound(later.name)!;
  await app.review.decide(later.name, { id: "newer", action: "comment", round: 2, changes: [second.units[0].id], body: "Shorter." });
  expect(app.review.pageState(later.name).undo?.id).toBe("newer");
  await app.review.undo(later.name, "newer");
  expect(app.review.pageState(later.name).undo?.id).toBe("while-working");
  // A rejection of an earlier round.
  const other = app.tasks.create("rejected", "Rejected", [], ["paper"], true);
  f.edit(other, METHOD, "Method sentence 2.", "Agent A.");
  const first = fakeRound(app, other.name);
  await app.review.decide(other.name, { id: "rejected-early", action: "reject", round: 1, changes: [first.units[0].id] });
  f.edit(other, METHOD, "Method sentence 4.", "Agent D.");
  fakeRound(app, other.name);
  expect(app.review.pageState(other.name).undo).toBeNull();
});
it("inserts the round of an undo that a restart interrupted before the insert", async () => {
  const { later } = await acceptedBeforeNewerRound();
  await app.review.undo(later.name, "while-working");
  await app.publisher.join();
  // As if the server stopped after the undo, before its round.
  app.store.execute("DELETE FROM rounds WHERE task=? AND number=3", later.name);
  app.repo.run(["update-ref", "-d", `refs/papilot/${later.name}/round-3`]);
  await app.close(); f.apps.splice(f.apps.indexOf(app), 1);
  const restarted = f.app();
  vi.spyOn(restarted.publisher, "publish").mockImplementation(async (job) => {
    const inserted = await restarted.exclusive(() => restarted.publisher.insertNow(job));
    return "result" in inserted ? inserted.result : { outcome: "published", round: inserted.round.number, changes: 0 };
  });
  await restarted.ready; await restarted.publisher.join();
  const third = restarted.review.latestRound(later.name)!;
  expect(third.number).toBe(3);
  expect(third.before).toBe(restarted.tasks.get(later.name).accepted);
  expect(third.units.map((u) => u.new_text).sort()).toEqual(["Agent A", "Agent B", "Agent D"]);
});

it("recovery completes a journaled accept after restart", async () => {
  const round = two(),
    target = path.join(f.root, METHOD),
    after = Buffer.from(BODY.replace("Method sentence 2.", "Agent A.")),
    accepted = app.repo.commitWith(
      task.accepted,
      { [METHOD]: after },
      "accept",
    );
  app.review.record(
    "crash",
    task,
    round,
    "accept",
    ["c001"],
    "",
    { accepted_before: task.accepted, accepted_after: accepted },
    [[target, Buffer.from(BODY), after]],
  );
  fs.writeFileSync(target, after);
  await app.review.recover();
  expect(app.review.pageState(task.name).decisions.c001).toBe("accepted");
  expect(app.tasks.get(task.name).accepted).toBe(accepted);
  expect(app.review.feedback(task.name).feedback).toHaveLength(1);
  await app.review.recover();
  expect(app.review.feedback(task.name).feedback).toHaveLength(1);
});
it("refuses a write through a symlink outside the manuscript", async () => {
  const out = path.join(f.base, "outside");
  fs.mkdirSync(out);
  fs.symlinkSync(out, path.join(f.root, "paper/escape"));
  expect(() => safePath(f.root, "paper/escape/file.tex")).toThrow();
});
it("reattaches matching scopes and requires explicit force before discarding", async () => {
  expect(app.tasks.create("polish").worktree).toBe(task.worktree);
  expect(() => app.tasks.create("polish", "Different", [], [METHOD])).toThrow(
    "different scope",
  );
  two();
  await expect(app.tasks.finish(task.name)).rejects.toThrow("pending");
  await app.tasks.finish(task.name, true);
  expect(app.tasks.list()).toEqual([]);
  expect(fs.existsSync(task.worktree)).toBe(false);
  expect(app.repo.text(["for-each-ref", "refs/papilot/polish/"])).toBe("");
});
it("a folder another program keeps open stops finishing until a retry after it is released", async () => {
  const release = await holdFolder(task.worktree);
  try {
    await expect(app.tasks.finish(task.name, true)).rejects.toThrow(
      `Could not delete the task folder ${task.worktree}. If another program is using it`,
    );
    expect(fs.existsSync(task.worktree)).toBe(true);
    expect(app.tasks.get(task.name).closed).toBeNull();
  } finally {
    await release();
  }
  await app.tasks.finish(task.name, true);
  expect(fs.existsSync(task.worktree)).toBe(false);
  expect(fs.existsSync(path.join(f.root, ".git/worktrees", task.name))).toBe(false);
  expect(app.tasks.list()).toEqual([]);
  expect(app.repo.text(["for-each-ref", "refs/papilot/polish/"])).toBe("");
});
it("finishing removes a worktree folder that Git unregistered but could not delete", async () => {
  const release = await holdFolder(task.worktree);
  try {
    // What `git worktree remove` left before Papilot deleted the folder itself.
    expect(() => app.repo.run(["worktree", "remove", "--force", task.worktree])).toThrow();
  } finally {
    await release();
  }
  expect(fs.existsSync(task.worktree)).toBe(true);
  expect(fs.existsSync(path.join(f.root, ".git/worktrees", task.name))).toBe(false);
  await app.tasks.finish(task.name, true);
  expect(fs.existsSync(task.worktree)).toBe(false);
  expect(app.tasks.list()).toEqual([]);
  expect(app.repo.text(["for-each-ref", "refs/papilot/polish/"])).toBe("");
});
it("recreating a finished task clears its old write journal", async () => {
  two();
  await decide("accept", ["c001"], "reused-id");
  await app.review.undo(task.name, "reused-id");
  await app.tasks.finish(task.name, true);
  task = app.tasks.create("polish");
  two();
  await decide("accept", ["c001"], "reused-id");
});
it("a reused comment id cannot silently discard changed opinion text", async () => {
  two();
  await decide("comment", ["c001"], "same-comment", "First opinion.");
  await expect(
    decide("comment", ["c001"], "same-comment", "A different opinion."),
  ).rejects.toThrow("already used");
  expect(app.review.feedback(task.name).feedback[0].text).toBe(
    "First opinion.",
  );
});
it("a conflicting accept-all writes none of the otherwise mergeable changes", async () => {
  f.edit(task, "paper/main.tex", "Intro sentence 2.", "Agent intro edit.");
  f.edit(task, METHOD, "Detail sentence 15.", "Agent method edit.");
  fakeRound(app, task.name);
  const mainBefore = f.read("paper/main.tex");
  f.write(
    METHOD,
    BODY.replace("Detail sentence 15.", "User rewrote the second change."),
  );
  const before = f.read(METHOD);
  await expect((async () => decide("accept", ["c001", "c002"], "all"))()).rejects.toThrow(
    "changed in your manuscript",
  );
  expect(f.read(METHOD)).toBe(before);
  expect(f.read("paper/main.tex")).toBe(mainBefore);
  expect(app.review.pageState(task.name).decisions).toEqual({
    c001: "pending",
    c002: "pending",
  });
});


it("preserves long comments and review messages in feedback", async () => {
  two();
  const text = "Explain the reasoning in this passage. ".repeat(1000) + "FINAL COMMENT";
  await decide("comment", ["c001"], "long-comment", text);
  expect(app.review.pageState(task.name).comments.c001).toBe(text);
  const cursor = app.review.feedback(task.name).cursor;
  app.review.note(task.name, text);
  expect(app.review.feedback(task.name, cursor).feedback[0].text).toBe(text);
});

// Simulates a Windows Git checkout under `core.autocrlf=true`: Git HEAD stores
// LF blobs and `.git/index` has matching stat entries, while the working tree
// on disk has CRLF line endings.
function enableAutocrlfCrlf(fixture: Fixture, file = METHOD) {
  const crlf = BODY.replace(/\n/g, "\r\n");
  fixture.write(file, crlf);
  // Backdate mtime so Git does not treat the index entry as racy.
  const past = new Date(Date.now() - 5000);
  fs.utimesSync(path.join(fixture.root, file), past, past);
  execFileSync("git", ["-C", fixture.root, "config", "core.autocrlf", "true"]);
  execFileSync("git", ["-C", fixture.root, "-c", "core.autocrlf=true", "add", "--all"]);
  execFileSync("git", ["-C", fixture.root, "-c", "core.autocrlf=true", "commit", "--no-gpg-sign", "-qm", "Windows CRLF import", "--allow-empty"]);
  execFileSync("git", ["-C", fixture.root, "-c", "core.autocrlf=true", "update-index", "--refresh"]);
  return crlf;
}

it("delivers deferred tasks cleanly to Windows CRLF working trees whose Git blobs are LF", async () => {
  const fx = new Fixture();
  try {
    const crlf = enableAutocrlfCrlf(fx);
    const local = fx.app();
    expect(fs.readFileSync(path.join(fx.root, METHOD)).includes("\r\n")).toBe(true);
    expect(fx.repo.blob("HEAD", METHOD)!.includes("\r\n")).toBe(false);

    const deferred = local.tasks.create("win-crlf", "Windows CRLF", [], ["paper"], true);
    // Task base inherited the LF blob via `.git/index`'s stat cache.
    expect(local.repo.blob(deferred.base, METHOD)!.includes("\r\n")).toBe(false);

    fx.edit(deferred, METHOD, "Method sentence 2.", "Revised sentence 2.\nInserted line.");
    const round = fakeRound(local, deferred.name);
    await local.review.decide(deferred.name, { action: "accept", round: 1, changes: round.units.map((u) => u.id) });

    const preview = await local.delivery.preview(deferred.name);
    expect(preview?.[METHOD]?.toString()).toContain("Revised sentence 2.\r\nInserted line.\r\n");

    const workspace = await local.delivery.apply(deferred.name);
    expect(workspace.delivery?.mode).toBe("workspace");
    expect(fs.readFileSync(path.join(fx.root, METHOD)).toString()).toBe(
      crlf.replace("Method sentence 2.", "Revised sentence 2.\r\nInserted line."),
    );

    // A follow-up round in the same task delivers and commits only its own delta
    // in LF onto HEAD while keeping round 1's workspace edit in CRLF on disk.
    fx.edit(deferred, METHOD, "Detail sentence 15.", "Updated detail 15.");
    const second = fakeRound(local, deferred.name);
    await local.review.decide(deferred.name, { action: "accept", round: 2, changes: second.units.map((u) => u.id) });
    const committed = await local.delivery.apply(deferred.name, false, "commit", "Apply reviewed edits");
    expect(committed.delivery?.mode).toBe("commit");
    expect(fs.readFileSync(path.join(fx.root, METHOD)).toString()).toContain("Updated detail 15.\r\n");
    expect(fx.repo.blob("HEAD", METHOD)!.includes("\r\n")).toBe(false);
    expect(fx.repo.blob("HEAD", METHOD)!.toString()).toContain("Updated detail 15.\n");
    expect(fx.repo.blob("HEAD", METHOD)!.toString()).not.toContain("Revised sentence 2.");
    const diff = execFileSync("git", ["-C", fx.root, "-c", "core.autocrlf=true", "diff"], { encoding: "utf8" });
    expect(diff).toContain("Revised sentence 2.");
    expect(diff).not.toContain("Updated detail 15.");

    // Delivering directly as a commit from a clean CRLF tree leaves `git status` clean.
    const fx2 = new Fixture();
    try {
      enableAutocrlfCrlf(fx2);
      const local2 = fx2.app();
      const clean = local2.tasks.create("win-crlf-commit", "Windows CRLF commit", [], ["paper"], true);
      expect(local2.repo.blob(clean.base, METHOD)!.includes("\r\n")).toBe(false);
      fx2.edit(clean, METHOD, "Method sentence 4.", "Committed cleanly.\nNext line.");
      const r3 = fakeRound(local2, clean.name);
      await local2.review.decide(clean.name, { action: "accept", round: 1, changes: r3.units.map((u) => u.id) });
      expect((await local2.delivery.apply(clean.name, false, "commit", "Clean commit")).delivery?.mode).toBe("commit");
      expect(fs.readFileSync(path.join(fx2.root, METHOD)).toString()).toContain("Committed cleanly.\r\nNext line.\r\n");
      expect(fx2.repo.blob("HEAD", METHOD)!.includes("\r\n")).toBe(false);
      expect(execFileSync("git", ["-C", fx2.root, "-c", "core.autocrlf=true", "status", "--short"], { encoding: "utf8" })).toBe("");
    } finally {
      await fx2.close();
    }
  } finally {
    await fx.close();
  }
});

it("merges disjoint CRLF edits and keeps commit reviews LF-clean under core.autocrlf=true", async () => {
  const fx = new Fixture();
  try {
    const crlf = enableAutocrlfCrlf(fx);
    const local = fx.app();

    // Case A: Disjoint CRLF edit on disk after task creation merges without false reconciliation.
    const after = local.tasks.create("crlf-after", "CRLF after", [], ["paper"], true);
    expect(local.repo.blob(after.base, METHOD)!.includes("\r\n")).toBe(false);
    fx.write(METHOD, crlf.replace("Detail sentence 15.", "Author edit after start."));
    fx.edit(after, METHOD, "Method sentence 2.", "Agent edit.\nExtra line.");
    const r1 = fakeRound(local, after.name);
    await local.review.decide(after.name, { action: "accept", round: 1, changes: r1.units.map((u) => u.id) });
    const applied = await local.delivery.apply(after.name);
    expect(applied.delivery?.mode).toBe("workspace");
    const disk = fs.readFileSync(path.join(fx.root, METHOD)).toString();
    expect(disk).toContain("Author edit after start.\r\n");
    expect(disk).toContain("Agent edit.\r\nExtra line.\r\n");

    // Case B: Uncommitted CRLF edit before task creation projects only the agent's
    // disjoint edit onto LF HEAD without a false CommitNeedsReview.
    fx.write(METHOD, crlf.replace("Detail sentence 15.", "Uncommitted author edit."));
    const before = local.tasks.create("crlf-before", "CRLF before", [], ["paper"], true);
    fx.edit(before, METHOD, "Method sentence 2.", "Committed agent edit.\r\nAdded line.");
    const r2 = fakeRound(local, before.name);
    await local.review.decide(before.name, { action: "accept", round: 1, changes: r2.units.map((u) => u.id) });
    const committed = await local.delivery.apply(before.name, false, "commit", "Commit agent edit only");
    expect(committed.delivery?.mode).toBe("commit");
    const headText = fx.repo.blob("HEAD", METHOD)!.toString();
    expect(headText.includes("\r\n")).toBe(false);
    expect(headText).toContain("Committed agent edit.\nAdded line.\n");
    expect(headText).not.toContain("Uncommitted author edit.");
    expect(fs.readFileSync(path.join(fx.root, METHOD)).toString()).toContain("Uncommitted author edit.\r\n");

    // Case C: An overlapping uncommitted CRLF edit produces an LF-only CommitNeedsReview diff,
    // and confirming it commits LF to HEAD while keeping CRLF on disk.
    fx.write(METHOD, fx.repo.blob("HEAD", METHOD)!.toString().replace(/\n/g, "\r\n").replace("Detail sentence 15.", "Author overlap."));
    const overlap = local.tasks.create("crlf-overlap", "CRLF overlap", [], ["paper"], true);
    fx.edit(overlap, METHOD, "Author overlap.", "Agent overlap.");
    const r3 = fakeRound(local, overlap.name);
    await local.review.decide(overlap.name, { action: "accept", round: 1, changes: r3.units.map((u) => u.id) });
    const review = await local.delivery.apply(overlap.name, false, "commit", "Combined overlap");
    expect(review.commitReview?.files).toEqual([METHOD]);
    expect(review.commitReview?.diff.includes("\r")).toBe(false);
    const confirmed = await local.delivery.apply(overlap.name, false, "commit", "Combined overlap", review.commitReview!.token);
    expect(confirmed.delivery?.mode).toBe("commit");
    expect(fx.repo.blob("HEAD", METHOD)!.includes("\r\n")).toBe(false);
    expect(fx.repo.blob("HEAD", METHOD)!.toString()).toContain("Agent overlap.\n");
    expect(fs.readFileSync(path.join(fx.root, METHOD)).toString()).toContain("Agent overlap.\r\n");

    // Case D: Deleting a tracked CRLF file delivers cleanly when destination has only CRLF differences.
    const fxDel = new Fixture();
    try {
      enableAutocrlfCrlf(fxDel);
      const localDel = fxDel.app();
      const delTask = localDel.tasks.create("crlf-delete", "CRLF delete", [], ["paper"], true);
      expect(localDel.repo.blob(delTask.base, METHOD)!.includes("\r\n")).toBe(false);
      fs.rmSync(path.join(delTask.worktree, METHOD));
      const rd = fakeRound(localDel, delTask.name);
      await localDel.review.decide(delTask.name, { action: "accept", round: 1, changes: rd.units.map((u) => u.id) });
      expect((await localDel.delivery.preview(delTask.name))?.[METHOD]).toBeNull();
      expect((await localDel.delivery.apply(delTask.name, false, "commit", "Remove method section")).delivery?.mode).toBe("commit");
      expect(fs.existsSync(path.join(fxDel.root, METHOD))).toBe(false);
      expect(fxDel.repo.blob("HEAD", METHOD)).toBeNull();
    } finally {
      await fxDel.close();
    }
  } finally {
    await fx.close();
  }
});

it("applies non-deferred accepts cleanly to CRLF files under core.autocrlf=true", async () => {
  const fx = new Fixture();
  try {
    enableAutocrlfCrlf(fx);
    const local = fx.app();
    const direct = local.tasks.create("win-direct", "Win direct", [], ["paper"], false);
    expect(local.repo.blob(direct.base, METHOD)!.includes("\r\n")).toBe(false);
    fx.edit(direct, METHOD, "Method sentence 2.", "Direct edit.\nSecond line.");
    const round = fakeRound(local, direct.name);
    await local.review.decide(direct.name, { action: "accept", round: 1, changes: round.units.map((u) => u.id) });
    const disk = fs.readFileSync(path.join(fx.root, METHOD)).toString();
    expect(disk).toContain("Direct edit.\r\nSecond line.\r\n");
  } finally {
    await fx.close();
  }
});
