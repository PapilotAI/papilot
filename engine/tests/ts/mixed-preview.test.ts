import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Builder } from "../../src/core/build.ts";
import { roundFolder } from "../../src/core/carry.ts";
import { previewMixedBlock } from "../../src/core/mixed-preview.ts";
import * as publisher from "../../src/core/publish.ts";
import { which } from "../../src/core/process.ts";
import type { App } from "../../src/server.ts";
import type { Task } from "../../src/types.ts";
import { BODY, Fixture, METHOD, fakeRound } from "./helpers.ts";

const tex = Boolean(which("latexmk") && which("pdflatex"));

let f: Fixture, app: App, task: Task;
beforeEach(async () => {
  f = new Fixture();
  app = f.app();
  await app.ready;
  task = app.tasks.create("mixed", "Mixed block preview", [], ["paper"], true);
  f.edit(task, METHOD, "Method sentence 2.", "Approach sentence two.");
  fakeRound(app, task.name);
});
afterEach(async () => {
  await f.close();
  vi.restoreAllMocks();
});

const units = () => app.review.latestRound(task.name)!.units;

it("rejects empty, full, or unknown subsets", async () => {
  const all = units().map((u) => u.id);
  expect(all.length).toBeGreaterThanOrEqual(2);
  await expect(previewMixedBlock(app, task.name, 1, { units: all, accepted: [] })).rejects.toThrow("Invalid mixed preview");
  await expect(previewMixedBlock(app, task.name, 1, { units: all, accepted: all })).rejects.toThrow("Invalid mixed preview");
  await expect(previewMixedBlock(app, task.name, 1, { units: [all[0], all[0]], accepted: [all[0]] })).rejects.toThrow("Invalid mixed preview");
  await expect(previewMixedBlock(app, task.name, 1, { units: ["missing", all[0]], accepted: [all[0]] })).rejects.toThrow("Unknown edit");
  await expect(previewMixedBlock(app, task.name, 99, { units: all, accepted: [all[0]] })).rejects.toThrow(/round/i);
});

it("compiles an isolated mixed subset, deduplicates concurrent calls and errors, caches clean strips, and supports closed tasks", async () => {
  const all = units();
  const first = all.find((u) => u.new_text === "Approach")!;
  const second = all.find((u) => u.new_text === "two")!;
  const roundDir = roundFolder(app, task.name, 1);
  fs.mkdirSync(roundDir, { recursive: true });
  fs.writeFileSync(
    path.join(roundDir, "round.json"),
    JSON.stringify({
      units: {},
      sections: [
        {
          node: "method",
          number: "1",
          title: "Method",
          blocks: [
            {
              kind: "change",
              units: [first.id, second.id],
              identical: false,
              before: [{ src: "b.svg", clean: "b-clean.svg", width: 400, height: 36, page: 1, label: "1", top: 100 }],
              after: [{ src: "a.svg", clean: "a-clean.svg", width: 400, height: 36, page: 1, label: "1", top: 100 }],
            },
          ],
        },
      ],
      loose: [],
    }),
  );

  const original = f.read(METHOD, task.worktree);
  const head = app.repo.rev("HEAD");
  const pdf = path.join(app.state, "mixed-test.pdf");
  fs.writeFileSync(pdf, "test PDF");
  const built = vi.spyOn(Builder.prototype, "build").mockImplementation(async (rev) => ({
    key: rev,
    tree: rev,
    targets: ["full"],
    root: task.worktree,
    cwd: task.worktree,
    pdf,
    seconds: 0,
    warnings: [],
  }));
  const rendered = vi.spyOn(publisher, "renderMixed").mockImplementation(async (out, request) => {
    const content = app.repo.blob(request.new.tree, METHOD)?.toString() ?? "";
    expect(content).toContain("Approach sentence 2.");
    expect(content).not.toContain("sentence two.");
    expect(request.mixed).toEqual([{ page: 1, top: 100, height: 36, width: 400 }]);
    fs.writeFileSync(path.join(out, "s1-clean.svg"), "<svg>clean</svg>");
    fs.writeFileSync(
      path.join(out, "mixed.json"),
      JSON.stringify({
        strips: [
          {
            src: "s1.svg",
            clean: "s1-clean.svg",
            width: 400,
            height: 36,
            page: 1,
            label: "1",
            top: 100,
            marks: [{ unit: first.id, kind: "added", rect: [10, 5, 80, 20] }],
          },
        ],
      }),
    );
  });

  const payload = { units: [first.id, second.id], accepted: [first.id] };
  const [a, b] = await Promise.all([
    previewMixedBlock(app, task.name, 1, payload),
    previewMixedBlock(app, task.name, 1, payload),
  ]);
  expect(a).toEqual(b);
  expect(a.unavailable).toBeUndefined();
  expect(a.files).toMatch(/^\/mixed-files\/mixed\/1\/[0-9a-f]{64}\/$/);
  expect(a.strips).toHaveLength(1);
  expect(a.strips[0].src).toBe("s1-clean.svg");
  expect(a.strips[0].clean).toBe("s1-clean.svg");
  expect(a.strips[0].marks).toBeUndefined();
  expect(built).toHaveBeenCalledTimes(2);
  expect(rendered).toHaveBeenCalledTimes(1);

  // Subsequent call hits disk cache without rebuilding or re-rendering, even after task closes.
  app.store.execute("UPDATE tasks SET closed=? WHERE name=?", 1, task.name);
  const cached = await previewMixedBlock(app, task.name, 1, payload);
  expect(cached).toEqual(a);
  expect(built).toHaveBeenCalledTimes(2);
  expect(rendered).toHaveBeenCalledTimes(1);

  // Repo, worktree, and HEAD remain completely untouched.
  expect(f.read(METHOD, task.worktree)).toBe(original);
  expect(f.read(METHOD)).toBe(BODY);
  expect(app.repo.rev("HEAD")).toBe(head);

  // Concurrent callers on a failing build BOTH degrade gracefully to { unavailable: true }.
  built.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20));
    throw new Error("latex error");
  });
  const [failA, failB] = await Promise.all([
    previewMixedBlock(app, task.name, 1, { units: [first.id, second.id], accepted: [second.id] }),
    previewMixedBlock(app, task.name, 1, { units: [first.id, second.id], accepted: [second.id] }),
  ]);
  expect(failA).toEqual({ files: "", strips: [], unavailable: true });
  expect(failB).toEqual({ files: "", strips: [], unavailable: true });
});

it.skipIf(!tex)(
  "compiles a real LaTeX multi-line mixed block end to end, preserving accepted, intervening, and rejected lines",
  async () => {
    const f2 = new Fixture();
    const app2 = f2.app();
    await app2.ready;
    try {
      const t2 = app2.tasks.create("real-mixed", "Real mixed TeX", [], ["paper"], true);
      // Two edits separated by an unchanged middle sentence inside one merged change block.
      f2.edit(t2, METHOD, "Method sentence 2.", "Approach sentence 2.");
      f2.edit(t2, METHOD, "Method sentence 4.", "Procedure sentence 4.");
      const job = app2.publisher.submit(t2.name);
      await app2.publisher.join();
      expect(app2.publisher.job(job.id)?.status).toBe("done");
      const round = app2.review.latestRound(t2.name)!;
      const first = round.units.find((u) => u.new_text === "Approach")!;
      const second = round.units.find((u) => u.new_text === "Procedure")!;
      expect(first && second).toBeTruthy();

      const preview = await previewMixedBlock(app2, t2.name, round.number, {
        units: [first.id, second.id],
        accepted: [first.id],
      });
      expect(preview.unavailable).toBeUndefined();
      expect(preview.files).toMatch(/^\/mixed-files\/real-mixed\/1\/[0-9a-f]{64}\/$/);
      expect(preview.strips.length).toBeGreaterThanOrEqual(1);
      expect(preview.strips[0].marks).toBeUndefined();
      const text = preview.strips.flatMap((s) => s.text ?? []).map((l) => l.text).join(" ");
      // Must include accepted edit 1 ("Approach"), intervening unchanged sentence 3, AND rejected edit 2 ("Method sentence 4.").
      expect(text).toContain("Approach sentence 2.");
      expect(text).toContain("Method sentence 3.");
      expect(text).toContain("Method sentence 4.");
      expect(text).not.toContain("Procedure sentence 4.");
    } finally {
      await f2.close();
    }
  },
  60000,
);
