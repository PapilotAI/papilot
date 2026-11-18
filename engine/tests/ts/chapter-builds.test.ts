import fs from "node:fs";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { Builder } from "../../src/core/build.ts";
import { loadProject, writeSettings } from "../../src/core/config.ts";
import { which } from "../../src/core/process.ts";
import { mupdf } from "../../src/render/pdf.ts";
import { Fixture } from "./helpers.ts";
import { view } from "../../src/core/view.ts";
import { previewNoteOption } from "../../src/core/option-preview.ts";
import type { BuildInfo } from "../../src/types.ts";
const tex = Boolean(which("latexmk") && which("pdflatex"));
const text = (pdf: string) => {
  const document = mupdf.Document.openDocument(fs.readFileSync(pdf), "application/pdf");
  try {
    return Array.from({ length: document.countPages() }, (_, index) => {
      const page = document.loadPage(index), structured = page.toStructuredText("");
      try { return structured.asText(); } finally { structured.destroy(); page.destroy(); }
    }).join(" ").replace(/\s+/g, " ");
  } finally { document.destroy(); }
};
const runs = (build: BuildInfo) => {
  const log = fs.readFileSync(path.join(path.dirname(build.root), "latexmk.log"), "utf8");
  return { latex: (log.match(/^Running 'pdflatex/gm) ?? []).length, bibtex: (log.match(/^Running 'bibtex/gm) ?? []).length };
};
const output = (build: BuildInfo, file: string) => fs.readFileSync(path.join(path.dirname(build.pdf), file), "utf8");
// A package that keeps its own state in the output folder, as minted keeps
// its cache: starting from nothing, it settles in two runs.
const MAIN = String.raw`\documentclass{book}
\makeatletter
\InputIfFileExists{\jobname.stl}{}{\def\settled{none}}
\def\settleA{A}\def\settleB{B}
\ifx\settled\settleA\def\settlenext{B}\else\ifx\settled\settleB\def\settlenext{B}\else\def\settlenext{A}\fi\fi
\newwrite\settleout
\AtBeginDocument{\immediate\openout\settleout=\jobname.stl}
\AtEndDocument{\immediate\write\settleout{\string\def\string\settled{\settlenext}}\immediate\closeout\settleout}
\makeatother
\begin{document}
\frontmatter
State: \settled.
\tableofcontents
\mainmatter
\include{chapters/a}
\include{chapters/b}
\include{chapters/c}
\backmatter
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;
const chapter = (name: string, other: string, cite: string, opening: string) => String.raw`\chapter{${name.toUpperCase()}}
\section{Start of ${name}}\label{sec:${name}}
${opening} See Section~\ref{sec:${other}} on page~\pageref{sec:${other}} and \cite{${cite}}.
${Array.from({ length: 40 }, (_, i) => `Body ${name} sentence ${i}.`).join(" ")}
`;
it.skipIf(!tex).each(["manual", "comparison"])("a recovered %s full build supersedes clean seeds without becoming continuation state", async origin => {
  const f = new Fixture(), external = path.join(f.base, "package.tex");
  try {
    fs.writeFileSync(external, "Package text.\n");
    f.write("paper/main.tex", "\\documentclass{book}\n\\begin{document}\n\\include{chapters/a}\n\\include{chapters/b}\n\\end{document}\n");
    f.write("paper/chapters/a.tex", "\\chapter{A}\nOriginal chapter a.\n");
    f.write("paper/chapters/b.tex", `\\chapter{B}\nOriginal chapter b.\\input{${external.replaceAll("\\", "/")}}\n`);
    f.repo.run(["rm", "-q", "paper/sections/method.tex"]);
    f.repo.run(["add", "-A"]); f.repo.run(["commit", "-qm", "Book"]);
    const app = f.app(), task = app.tasks.create("refresh", "Refresh", [], ["paper"], true), builder = new Builder(app.project, app.repo);
    const clean = await builder.buildSeed(task.base);
    expect(clean.errors).toBeUndefined();
    const history = ["recent.json", "latest.json"].map(name => ({ file: path.join(builder.cache, name), bytes: fs.readFileSync(path.join(builder.cache, name)) }));
    // A package update changes compilation without changing the Git tree or
    // TeX engine version, just as a manual recompile can discover in practice.
    fs.writeFileSync(external, "Package text. \\PackageError{fixture}{Updated package diagnostic}{}\n");
    const recovered = await builder.build(task.base, ["full"], null, origin === "manual" ? { force: true }
      : { date: { SOURCE_DATE_EPOCH: "1600000000", FORCE_SOURCE_DATE: "1" } });
    expect(recovered.errors?.join("\n")).toContain("Updated package diagnostic");
    if (origin === "manual") expect((await builder.build(task.base)).key).toBe(recovered.key);
    expect((await builder.buildSeed(task.base)).key).toBe(recovered.key);
    // Older caches recorded only the clean build. Their preferred refresh
    // still must prevent it from being selected again, including after loss.
    if (origin === "manual") for (const { file, bytes } of history) fs.writeFileSync(file, bytes);
    let authoritative = await builder.buildSeed(task.base);
    expect(authoritative.errors?.join("\n")).toContain("Updated package diagnostic");
    fs.rmSync(path.join(path.dirname(authoritative.pdf), "main.aux"));
    expect((await builder.buildSeed(task.base)).key).toBe(authoritative.key);
    fs.rmSync(authoritative.pdf);
    authoritative = await builder.buildSeed(task.base);
    expect(authoritative.errors?.join("\n")).toContain("Updated package diagnostic");
    // Recovered output must not be copied into the next incremental build.
    fs.writeFileSync(path.join(path.dirname(authoritative.pdf), "recovered-only.cache"), "Do not continue this output.");
    f.edit(task, "paper/chapters/a.tex", "Original", "Revised");
    const checked = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(checked.error).toBeUndefined();
    expect(checked.targets).toEqual(["full"]);
    expect(checked.errors?.join("\n")).toContain("Updated package diagnostic");
    expect(text(checked.compiled!.pdf)).toContain("Original chapter b.");
    expect(fs.existsSync(path.join(path.dirname(checked.compiled!.pdf), "recovered-only.cache"))).toBe(false);
    const job = app.publisher.submit(task.name, undefined, false);
    await app.publisher.join();
    expect(app.publisher.job(job.id).status).toBe("done");
    const round = app.review.latestRound(task.name)!;
    expect(round.summary.targets).toEqual(["full"]);
    expect(round.summary.baselineErrors?.join("\n")).toContain("Updated package diagnostic");
    expect(round.summary.revisedErrors?.join("\n")).toContain("Updated package diagnostic");
    fs.writeFileSync(external, "Package text, repaired.\n");
    // A newer successful dated comparison takes precedence even while the
    // ordinary-preview preferred pointer still names the recovered refresh.
    const repaired = await builder.build(task.base, ["full"], null, { date: { SOURCE_DATE_EPOCH: "1700000000", FORCE_SOURCE_DATE: "1" } });
    expect(repaired.errors).toBeUndefined();
    expect((await builder.buildSeed(task.base)).key).toBe(repaired.key);
    fs.rmSync(path.join(path.dirname(repaired.pdf), "main.aux"));
    const reseeded = await builder.buildSeed(task.base);
    expect(reseeded.errors).toBeUndefined();
    expect(reseeded.key).not.toBe(authoritative.key);
    const again = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(again.targets).toEqual(["chapters/a"]);
    expect(again.errors).toEqual([]);
  } finally { await f.close(); }
}, 180000);

it.skipIf(!tex)("chapter reviews recover persistent auxiliary errors after a clean retry", async () => {
  const f = new Fixture(), problem = String.raw`\makeatletter
\protected@write\@auxout{}{\string\undefinedchaptercommand}
\makeatother`;
  const seeds = vi.spyOn(Builder.prototype, "buildSeed");
  try {
    f.write("paper/main.tex", "\\documentclass{book}\n\\begin{document}\n\\include{chapters/a}\n\\include{chapters/b}\n\\end{document}\n");
    for (const name of ["a", "b"])
      f.write(`paper/chapters/${name}.tex`, `\\chapter{${name.toUpperCase()}}\nOriginal chapter ${name}.\n`);
    f.repo.run(["rm", "-q", "paper/sections/method.tex"]);
    f.repo.run(["add", "-A"]); f.repo.run(["commit", "-qm", "Book"]);
    let app = f.app();
    await app.ready;
    const task = app.tasks.create("auxiliary", "Auxiliary", [], ["paper"], true);
    const publish = async () => {
      const job = app.publisher.submit(task.name, undefined, false);
      await app.publisher.join();
      const done = app.publisher.job(job.id);
      expect(done.status, JSON.stringify(done.result)).toBe("done");
      return app.review.latestRound(task.name)!;
    };
    // A stale omitted chapter must still refresh its seed in both entry paths.
    const seed = await new Builder(app.project, app.repo).buildSeed(task.base);
    fs.appendFileSync(path.join(path.dirname(seed.pdf), "chapters/b.aux"), "\\staleseedcommand\n");
    f.edit(task, "paper/chapters/a.tex", "Original", "Updated");
    const refreshed = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(refreshed.error).toBeUndefined();
    expect(refreshed.errors).toEqual([]);
    const freshSeed = await new Builder(app.project, app.repo).buildSeed(task.base);
    fs.appendFileSync(path.join(path.dirname(freshSeed.pdf), "chapters/b.aux"), "\\staleseedcommand\n");
    const clean = await publish();
    expect(clean.summary.baselineErrors).toBeUndefined();
    expect(clean.summary.revisedErrors).toBeUndefined();
    f.edit(task, "paper/chapters/a.tex", "Updated", "Original");
    f.edit(task, "paper/chapters/a.tex", "Original chapter a.", `Revised chapter a.\n${problem}`);
    seeds.mockClear();
    const checked = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(checked.error).toBeUndefined();
    expect(checked.targets).toEqual(["chapters/a"]);
    expect(checked.errors?.join("\n")).toContain("Undefined control sequence");
    expect(seeds.mock.calls.filter(([, options]) => options?.force)).toHaveLength(1);
    for (const restart of [false, true]) {
      if (restart) {
        await app.close(); f.apps.splice(f.apps.indexOf(app), 1);
        app = f.app(); await app.ready;
      }
      const again = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
      expect(again.errors).toEqual(checked.errors);
      expect(again.compiled?.pdf).toBe(checked.compiled?.pdf);
      expect(seeds.mock.calls.filter(([, options]) => options?.force)).toHaveLength(1);
    }
    f.edit(task, "paper/chapters/a.tex", "Revised chapter a.", "Revised chapter a. Another edit.");
    const changed = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(changed.errors?.join("\n")).toContain("Undefined control sequence");
    expect(changed.compiled?.pdf).not.toBe(checked.compiled?.pdf);
    expect(seeds.mock.calls.filter(([, options]) => options?.force)).toHaveLength(2);
    const first = await publish();
    expect(first.summary.revisedErrors?.join("\n")).toContain("Undefined control sequence");
    expect(first.summary.baselineErrors).toBeUndefined();
    expect((await new Builder(app.project, app.repo).completed(first.summary.builds.at(-1)!))?.seedRetried).toBe(true);
    await app.review.decide(task.name, { action: "accept", round: first.number, changes: first.units.map(unit => unit.id) });
    await app.applied.join();
    expect((await app.applied.state(task.name)).shown?.errors?.join("\n")).toContain("Undefined control sequence");

    // Strict mode still recovers the broken accepted baseline while showing
    // a repair, even though the task's original full seed compiles cleanly.
    await app.close(); f.apps.splice(f.apps.indexOf(app), 1);
    writeSettings(f.root, { halt_on_error: true });
    app = f.app(); await app.ready;
    f.edit(task, "paper/chapters/a.tex", problem, "");
    const repaired = await publish();
    expect(repaired.summary.targets).toEqual(["chapters/a"]);
    expect(repaired.summary.sourceOnly).toBeUndefined();
    expect(repaired.summary.baselineErrors?.join("\n")).toContain("Undefined control sequence");
    expect(repaired.summary.revisedErrors).toBeUndefined();
    const builder = new Builder(app.project, app.repo), before = await builder.completed(repaired.summary.builds.at(-2)!);
    expect(before?.errors?.join("\n")).toContain("Undefined control sequence");
    expect(before?.seedRetried).toBe(true);
    expect(text(before!.pdf)).toContain("Revised chapter a.");
  } finally { seeds.mockRestore(); await f.close(); }
}, 180000);

it.skipIf(!tex).each(["seed", "accepted"])("chapter reviews retain errors outside the new edit from the %s text", async (origin) => {
  const f = new Fixture(), problem = "\\PackageError{fixture}{Other chapter diagnostic}{}";
  try {
    f.write("paper/main.tex", "\\documentclass{book}\n\\begin{document}\n\\include{chapters/a}\n\\include{chapters/b}\n\\include{chapters/c}\n\\end{document}\n");
    for (const name of ["a", "b", "c"])
      f.write(`paper/chapters/${name}.tex`, `\\chapter{${name.toUpperCase()}}\nOriginal chapter ${name}.\n${name === "b" && origin === "seed" ? problem : ""}\n`);
    f.repo.run(["rm", "-q", "paper/sections/method.tex"]);
    f.repo.run(["add", "-A"]); f.repo.run(["commit", "-qm", "Book"]);
    const app = f.app(), task = app.tasks.create("chapters", "Chapters", [], ["paper"], true);
    const publish = async () => {
      const job = app.publisher.submit(task.name, undefined, false);
      await app.publisher.join();
      expect(app.publisher.job(job.id).status).toBe("done");
      return app.review.latestRound(task.name)!;
    };
    if (origin === "accepted") {
      f.edit(task, "paper/chapters/b.tex", "Original chapter b.", `Original chapter b. ${problem}`);
      const first = await publish();
      await app.review.decide(task.name, { action: "accept", round: first.number, changes: first.units.map(unit => unit.id) });
      await app.applied.join();
      expect((await app.applied.state(task.name)).shown?.errors?.join("\n")).toContain("Other chapter diagnostic");
    }
    f.edit(task, "paper/chapters/a.tex", "Original", "Revised");
    const checked = await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] });
    expect(checked.errors?.join("\n")).toContain("Other chapter diagnostic");
    expect(checked.targets).toEqual(origin === "seed" ? ["full"] : ["chapters/a", "chapters/b"]);
    app.publisher.prefetch(task.name);
    await app.publisher.join();
    const round = await publish();
    expect(round.summary.targets).toEqual(checked.targets);
    expect(round.summary.baselineErrors?.join("\n")).toContain("Other chapter diagnostic");
    expect(round.summary.revisedErrors?.join("\n")).toContain("Other chapter diagnostic");
    if (origin === "seed") {
      // A round saved by the earlier implementation may already have clean
      // chapter PDFs built from a recovered full seed. Previews and decisions
      // must expand both sides, rather than reuse that partial baseline.
      const builder = new Builder(app.project, app.repo), seed = await builder.buildSeed(task.base), targets = ["chapters/a"];
      const sides = await Promise.all([round.before, round.after].map(rev => builder.build(rev, targets, seed, { date: round.summary.date, force: true })));
      expect(sides.every(build => !build.errors?.length)).toBe(true);
      app.store.execute("UPDATE rounds SET summary=? WHERE task=? AND number=?", JSON.stringify({ ...round.summary, targets, builds: [seed.key, ...sides.map(build => build.key)], baselineErrors: undefined, revisedErrors: undefined }), task.name, round.number);
    }
    const selected = round.units.find(unit => unit.file === "paper/chapters/a.tex")!;
    const option = await previewNoteOption(app, task.name, { id: "alternative", round: round.number, edits: [{ unit: selected.id, text: "Alternative" }] });
    expect(option.baselineErrors?.join("\n")).toContain("Other chapter diagnostic");
    expect(option.revisedErrors?.join("\n")).toContain("Other chapter diagnostic");
    await app.review.decide(task.name, { action: "accept", round: round.number, changes: [selected.id] });
    await app.applied.join();
    const accepted = (await app.applied.state(task.name)).shown;
    expect(accepted?.errors?.join("\n")).toContain("Other chapter diagnostic");
    expect(accepted?.targets).toEqual(checked.targets);
    f.edit(task, "paper/chapters/b.tex", problem, "");
    const repaired = await publish();
    expect(repaired.summary.baselineErrors?.join("\n")).toContain("Other chapter diagnostic");
    expect(repaired.summary.revisedErrors).toBeUndefined();
    expect((await view(app, task.name, { check: true, locations: ["paper/chapters/a.tex:2"] })).errors).toEqual([]);
  } finally { await f.close(); }
}, 180000);

it.skipIf(!tex)(
  "the first chapter build of a round continues from its seed and typesets the same pages in fewer passes",
  async () => {
    const f = new Fixture();
    try {
      f.write("paper/main.tex", MAIN);
      f.write("paper/refs.bib", ["knuth", "lamport", "goossens"].map((key, i) => `@book{${key},author={Author ${key}},title={Title ${i}},year={${1980 + i}},publisher={P}}`).join("\n"));
      f.write("paper/chapters/a.tex", chapter("a", "b", "knuth", "First chapter."));
      f.write("paper/chapters/b.tex", chapter("b", "c", "lamport", "Middle chapter."));
      f.write("paper/chapters/c.tex", chapter("c", "a", "goossens", "Last chapter."));
      f.repo.run(["rm", "-q", "paper/sections/method.tex"]);
      f.repo.run(["add", "-A"]);
      f.repo.run(["commit", "-qm", "Book"]);
      const before = f.repo.rev("HEAD");
      f.write("paper/chapters/b.tex", chapter("b", "c", "lamport", "Middle chapter, revised with a longer opening."));
      f.repo.run(["commit", "-qam", "Revise"]);
      const after = f.repo.rev("HEAD"), builder = new Builder(loadProject(f.root), f.repo),
        targets = await builder.planAsync(before, after, ["paper/chapters/b.tex"]);
      expect(targets).toEqual(["chapters/b"]);
      const seed = await builder.buildSeed(before),
        date = { SOURCE_DATE_EPOCH: "1700000000", FORCE_SOURCE_DATE: "1" },
        sides = (force: boolean) => Promise.all([before, after].map((rev) => builder.build(rev, targets, seed, { date, force })));
      // Both sides of the round's first comparison, as published, and both
      // compiled clean, as every first chapter build was compiled before.
      const warm = await sides(false), cold = await sides(true);
      for (const [index, build] of warm.entries()) {
        expect(runs(build).latex).toBeLessThan(runs(cold[index]).latex);
        expect(runs(build).bibtex).toBeLessThanOrEqual(runs(cold[index]).bibtex);
        expect(text(build.pdf)).toBe(text(cold[index].pdf));
        for (const file of ["main.aux", "main.toc", "main.bbl", "main.stl", "chapters/b.aux"])
          expect(output(build, file)).toBe(output(cold[index], file));
      }
      const revised = text(warm[1].pdf);
      expect(revised).toContain("State: B.");
      expect(revised).toMatch(/revised with a longer opening\. See Section 3\.1 on page \d+ and \[3\]\./);
      // The chapter's own pages, not the seed's: other chapters stay out.
      expect(revised).not.toContain("Body a sentence 0.");
    } finally {
      await f.close();
    }
  },
  180000,
);
it.skipIf(!tex)(
  "a chapter's fix compiles the whole paper when the task's starting text does not compile",
  async () => {
    const f = new Fixture();
    f.write(".git/papilot/settings.json", JSON.stringify({ halt_on_error: true }));
    try {
      f.write("paper/main.tex", String.raw`\documentclass{book}
\begin{document}
\include{chapters/a}
\include{chapters/b}
\end{document}
`);
      f.write("paper/chapters/a.tex", "\\chapter{A}\nFirst chapter. See Chapter~\\ref{ch:b}.\n");
      f.write("paper/chapters/b.tex", "\\chapter{B}\\label{ch:b}\nSecond chapter. \\thiscommanddoesnotexist\n");
      f.repo.run(["rm", "-q", "paper/sections/method.tex"]);
      f.repo.run(["add", "-A"]);
      f.repo.run(["commit", "-qm", "Book"]);
      const app = f.app(), task = app.tasks.create("fix");
      f.edit(task, "paper/chapters/b.tex", " \\thiscommanddoesnotexist", "");
      f.edit(task, "paper/chapters/b.tex", "Second chapter.", "Second chapter, fixed.");
      expect(await new Builder(app.project, app.repo).planAsync(task.accepted, app.tasks.snapshot(task), ["paper/chapters/b.tex"])).toEqual(["chapters/b"]);
      const job = app.publisher.submit(task.name);
      await app.publisher.join();
      const done = app.publisher.job(job.id);
      expect(done.status, JSON.stringify(done.result)).toBe("done");
      const round = app.review.round(task.name, 1), detail = app.review.roundDetail(task.name, 1);
      expect(round.summary.targets).toEqual(["full"]);
      expect(detail.baselineErrors?.join("\n")).toContain("Undefined control sequence");
      // The whole revised paper, with the other chapter's reference resolved.
      const revised = (await new Builder(app.project, app.repo).completed(round.summary.builds.at(-1)!))!;
      expect(text(revised.pdf)).toMatch(/See Chapter 2\..*Second chapter, fixed\./);
      // The next round knows the starting text does not compile.
      const seeds = vi.spyOn(Builder.prototype, "buildSeed");
      f.edit(task, "paper/chapters/b.tex", "Second chapter, fixed.", "Second chapter, fixed twice.");
      const again = app.publisher.submit(task.name);
      await app.publisher.join();
      expect(app.publisher.job(again.id).status).toBe("done");
      expect(seeds).not.toHaveBeenCalled();
      expect(app.review.round(task.name, 2).summary.targets).toEqual(["full"]);
      seeds.mockRestore();
    } finally {
      await f.close();
    }
  },
  180000,
);
