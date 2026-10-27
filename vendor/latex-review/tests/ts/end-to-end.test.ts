import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { App } from "../../src/server.ts";
import { Builder, BuildError } from "../../src/core/build.ts";
import { which } from "../../src/core/process.ts";
import { prepareDemo, applyDemo } from "../../examples/demo.ts";
import { Fixture, METHOD } from "./helpers.ts";
const tex = Boolean(which("latexmk") && which("pdflatex"));
it.skipIf(!tex)(
  "retains shell-helper tracebacks in diagnostics and the saved build log",
  async () => {
    const f = new Fixture(),
      app = f.app(),
      previous = process.env.PATH;
    try {
      const tools = path.join(f.base, "tools");
      fs.mkdirSync(tools);
      fs.writeFileSync(
        path.join(tools, "latexmk"),
        `#!/bin/sh
cat >&2 <<'FAILURE'
Traceback (most recent call last):
  File "/tex/latexminted.py", line 372, in <module>
    main()
TypeError: ArgParser.__init__() got an unexpected keyword argument 'color'
FAILURE
exit 1
`,
        { mode: 0o755 },
      );
      process.env.PATH = tools + path.delimiter + previous;
      try {
        await new Builder(app.project, app.repo).build("HEAD");
        throw new Error("Expected the helper failure");
      } catch (error) {
        expect(error).toBeInstanceOf(BuildError);
        const failure = error as BuildError;
        expect(failure.details.join("\n")).toContain("latexminted: TypeError");
        expect(failure.details.join("\n")).toContain("compatible Python");
        expect(fs.readFileSync(failure.log!, "utf8")).toContain(
          "Traceback (most recent call last):",
        );
      }
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
      await f.close();
    }
  },
);
it.skipIf(!tex)(
  "renders KOMA acknowledgments and refreshes old renderer output without editing the paper",
  async () => {
    const f = new Fixture();
    f.write(
      "paper/main.tex",
      String.raw`\documentclass{scrbook}
\usepackage{hyperref}
\begin{document}
\frontmatter
\include{acknowledgments}
\mainmatter
\include{body}
\end{document}
`,
    );
    f.write(
      "paper/acknowledgments.tex",
      "\\addchap{Acknowledgments}\nThanks to my supervisor for the guidance.\n",
    );
    f.write(
      "paper/body.tex",
      "\\chapter{Introduction}\nAn unchanged chapter.\n",
    );
    f.repo.run(["add", "."]);
    f.repo.run(["commit", "-qm", "KOMA fixture"]);
    const app = f.app();
    try {
      const task = app.tasks.create("thanks", undefined, ["Acknowledgments"]);
      f.edit(
        task,
        "paper/acknowledgments.tex",
        "the guidance",
        "the patient guidance throughout my research",
      );
      const publish = async () => {
        const job = app.publisher.submit(task.name);
        await app.publisher.join();
        const done = app.publisher.job(job.id);
        expect(done.status, JSON.stringify(done.result)).toBe("done");
        return done.result;
      };
      expect((await publish()).outcome).toBe("published");
      const round = app.review.round(task.name, 1);
      const detail = app.review.roundDetail(task.name, 1);
      expect(detail.units).toHaveLength(1);
      expect(detail.units[0]).toMatchObject({
        visual: "text",
        section: "Acknowledgments",
      });
      expect(detail.sections[0].title).toBe("Acknowledgments");
      expect(detail.units[0].pages?.length).toBeGreaterThan(0);
      expect((await publish()).outcome).toBe("unchanged");

      // Simulate a round made before renderer versions were recorded.
      const { renderer: _oldRenderer, ...legacy } = round.summary;
      app.store.execute(
        "UPDATE rounds SET summary=? WHERE task=? AND number=1",
        JSON.stringify(legacy),
        task.name,
      );
      expect(await publish()).toMatchObject({ outcome: "published", round: 2 });
      const refreshed = app.review.round(task.name, 2);
      expect(refreshed.before).toBe(round.before);
      expect(app.repo.treeId(refreshed.after)).toBe(
        app.repo.treeId(round.after),
      );
      expect(app.review.roundDetail(task.name, 2).units[0].visual).toBe("text");
      expect((await publish()).outcome).toBe("unchanged");
      expect(f.read("paper/acknowledgments.tex")).not.toContain("patient");
    } finally {
      await f.close();
    }
  },
  120000,
);
it.skipIf(!tex)(
  "compiles the bundled paper, renders all seven edits and completes review",
  async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "latex-review-e2e-")),
      { root, plan } = prepareDemo(base),
      app = new App(root);
    try {
      const task = app.tasks.create(plan.task, plan.title, [plan.section]);
      applyDemo(task.worktree, plan);
      const job = app.publisher.submit(task.name);
      await app.publisher.join();
      const result = app.publisher.job(job.id);
      expect(result.status, JSON.stringify(result.result)).toBe("done");
      expect(result.result.changes).toBe(7);
      const detail = app.review.roundDetail(task.name, 1);
      expect(detail.units.some((u) => u.kind === "figure")).toBe(true);
      expect(detail.units.some((u) => u.visual === "identical")).toBe(true);
      expect(detail.units.every((u) => u.visual !== "unmapped")).toBe(true);
      const state = app.review.decide(task.name, {
        action: "accept",
        round: 1,
        changes: detail.units.map((u) => u.id),
      });
      expect(
        Object.values(state.decisions).every((d) => d === "accepted"),
      ).toBe(true);
      expect(app.review.summary(task.name).state).toBe("done");
      app.review.undo(task.name, state.undo!.id);
      expect(app.review.summary(task.name).state).toBe("reviewing");
    } finally {
      await app.close();
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
  120000,
);
it.skipIf(!tex)(
  "shares a cached compilation and retains useful logs on failure",
  async () => {
    const f = new Fixture(),
      app = f.app();
    try {
      const builder = new Builder(app.project, app.repo),
        [a, b] = await Promise.all([
          builder.build("HEAD"),
          builder.build("HEAD"),
        ]);
      expect(a).toEqual(b);
      expect(fs.existsSync(a.pdf)).toBe(true);
      f.write(METHOD, "\\thiscommanddoesnotexist\n");
      const revision = app.repo.snapshot(["paper"]);
      try {
        await builder.build(revision);
        throw new Error("Should fail");
      } catch (error) {
        expect(error).toBeInstanceOf(BuildError);
        const e = error as BuildError;
        expect(e.details.join(" ")).toContain("Undefined control sequence");
        expect(fs.existsSync(e.log!)).toBe(true);
      }
    } finally {
      await f.close();
    }
  },
  120000,
);
it.skipIf(!tex)(
  "a decision arriving during compilation is included in the published round",
  async () => {
    const f = new Fixture(),
      app = f.app();
    const { vi } = await import("vitest"),
      { fakeRound } = await import("./helpers.ts");
    try {
      const task = app.tasks.create("during");
      f.edit(task, METHOD, "Method sentence 2.", "First proposal.");
      fakeRound(app, task.name);
      f.edit(task, METHOD, "Detail sentence 15.", "Second proposal.");
      const original = Builder.prototype.build;
      let decided = false;
      const spy = vi
        .spyOn(Builder.prototype, "build")
        .mockImplementation(async function (
          this: Builder,
          ...args: Parameters<Builder["build"]>
        ) {
          const result = await original.apply(this, args);
          if (!decided) {
            decided = true;
            app.review.decide(task.name, {
              action: "accept",
              round: 1,
              changes: ["c001"],
              id: "during-build",
            });
          }
          return result;
        });
      try {
        const job = app.publisher.submit(task.name);
        await app.publisher.join();
        expect(
          app.publisher.job(job.id).status,
          JSON.stringify(app.publisher.job(job.id).result),
        ).toBe("done");
        const round = app.review.round(task.name, 2);
        expect(round.before).toBe(app.tasks.get(task.name).accepted);
        expect(round.units).toHaveLength(1);
        expect(round.units[0].new_text).toContain("Second proposal.");
        expect(round.units[0].new_text).not.toContain("First proposal.");
      } finally {
        spy.mockRestore();
      }
    } finally {
      await f.close();
    }
  },
  120000,
);
it.skipIf(!tex)(
  "partial builds retain cross-chapter references and preload excluded macros",
  async () => {
    const f = new Fixture();
    f.write(
      "paper/main.tex",
      String.raw`\documentclass{book}
\usepackage{hyperref}
\begin{document}
\include{sections/one}
\include{sections/two}
\end{document}
`,
    );
    f.write(
      "paper/sections/one.tex",
      String.raw`\chapter{One}\label{one}
\input{macros/one}
First chapter.
`,
    );
    f.write(
      "paper/macros/one.tex",
      String.raw`\newcommand{\sharedmacro}{shared definition}`,
    );
    f.write(
      "paper/sections/two.tex",
      String.raw`\chapter{Two}
This uses the \sharedmacro{} from Chapter~\ref{one}.
`,
    );
    f.write(
      ".latex-review.json",
      JSON.stringify({ preload: { "sections/one": "macros/one.tex" } }),
    );
    f.repo.run(["add", "."]);
    f.repo.run(["commit", "-qm", "Book fixture"]);
    const app = f.app();
    try {
      const before = app.repo.rev("HEAD");
      f.write(
        "paper/sections/two.tex",
        f
          .read("paper/sections/two.tex")
          .replace("This uses", "This carefully uses"),
      );
      const after = app.repo.snapshot(["paper"]),
        builder = new Builder(app.project, app.repo),
        targets = builder.plan(before, after, ["paper/sections/two.tex"]);
      expect(targets).toEqual(["sections/two"]);
      const seed = await builder.build(before),
        partial = await builder.build(after, targets, seed);
      expect(partial.warnings).toEqual([]);
      expect(fs.existsSync(partial.pdf)).toBe(true);
      expect(
        fs.readFileSync(path.join(partial.cwd, "build/main.aux"), "utf8"),
      ).toContain("sections/one.aux");
    } finally {
      await f.close();
    }
  },
  120000,
);
