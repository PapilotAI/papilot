import fs from "node:fs";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { Builder, BuildError, auxiliaryBuildError, auxiliaryDiagnostics } from "../../src/core/build.ts";
import { chooseDocument, loadProject, readSettings, writeSettings } from "../../src/core/config.ts";
import { which } from "../../src/core/process.ts";
import { PdfDocument } from "../../src/render/pdf.ts";
import { Fixture } from "./helpers.ts";

const tex = Boolean(which("latexmk") && which("pdflatex"));
const paper = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

it.each([
  ["build/main.lol:3: Undefined control sequence.", true],
  ["./build/main.loa:3: Undefined control sequence.", true],
  ["build/main.package-list:3: Undefined control sequence.", true],
  ["build\\main.lol:3: Undefined control sequence.", true],
  ["/tmp/paper/build/main.loa:3: Undefined control sequence.", true],
  ["C:\\paper\\build\\main.lol:3: Undefined control sequence.", true],
  ["main.lol:3: Undefined control sequence.", false],
  ["chapters/build/main.tex:3: Undefined control sequence.", false],
  ["build/../main.tex:3: Undefined control sequence.", false],
  ["build\\..\\main.tex:3: Undefined control sequence.", false],
  ["/tmp/paper/build/../main.tex:3: Undefined control sequence.", false],
  ["main.tex:3: Could not read build/main.lol:1: input.", false],
  ["latexmk failed (1)", false],
])("recognizes generated-output diagnostics: %s", (diagnostic, expected) => {
  expect(auxiliaryDiagnostics([diagnostic])).toBe(expected);
  expect(auxiliaryBuildError(new BuildError("LaTeX failed to compile.", [diagnostic]))).toBe(expected);
});

it("defaults to continuing after errors, validates the option and keeps it per document", async () => {
  const f = new Fixture();
  try {
    expect(loadProject(f.root).halt_on_error).toBe(false);
    for (const invalid of ["false", 0, null]) {
      writeSettings(f.root, { halt_on_error: invalid });
      expect(() => loadProject(f.root)).toThrow('"halt_on_error" must be a boolean.');
    }
    writeSettings(f.root, { halt_on_error: true });
    f.write("slides/talk.tex", paper("Slides."));
    chooseDocument(f.root, "slides/talk.tex");
    expect(loadProject(f.root).halt_on_error).toBe(false);
    expect(loadProject(f.root, undefined, "paper/main.tex").halt_on_error).toBe(true);
    chooseDocument(f.root, "paper/main.tex");
    expect(readSettings(f.root).halt_on_error).toBe(true);
  } finally { await f.close(); }
});

it.skipIf(!tex)("keeps the PDF and diagnostics by default; strict builds have separate caches", async () => {
  const f = new Fixture();
  try {
    // A recoverable package error, like minted falling back to plain code.
    f.write("paper/main.tex", paper("Before. \\PackageError{fixture}{Highlighting unavailable}{} After."));
    f.repo.run(["commit", "-qam", "recoverable"]);
    const builder = new Builder(loadProject(f.root), f.repo), built = await builder.build("HEAD");
    expect(built.errors?.join("\n")).toContain("Highlighting unavailable");
    const pdf = new PdfDocument(built.pdf);
    try { expect(pdf.page(0).text()).toMatch(/Before\.[\s\S]*After\./); } finally { pdf.close(); }
    const transcript = fs.readFileSync(path.join(path.dirname(built.root), "latexmk.log"), "utf8");
    expect(transcript).not.toContain("-halt-on-error");
    expect((await builder.build("HEAD")).key).toBe(built.key);

    writeSettings(f.root, { halt_on_error: true });
    const strict = new Builder(loadProject(f.root), f.repo);
    expect(await strict.cached("HEAD", ["full"], null)).toBeNull();
    await expect(strict.build("HEAD")).rejects.toBeInstanceOf(BuildError);
    const comparison = await strict.build("HEAD", ["full"], null, { pastErrors: true });
    expect(comparison.errors?.join("\n")).toContain("Highlighting unavailable");

    // A strict build must not reuse the PDF from the explicit recovery build.
    await expect(strict.build("HEAD")).rejects.toBeInstanceOf(BuildError);
    writeSettings(f.root, { halt_on_error: false });
    expect((await new Builder(loadProject(f.root), f.repo).build("HEAD")).key).toBe(built.key);
  } finally { await f.close(); }
});

it.skipIf(!tex)("a fatal build cannot return a PDF retained from an earlier build or tracked source", async () => {
  const f = new Fixture();
  try {
    const builder = new Builder(loadProject(f.root), f.repo), first = await builder.build("HEAD");
    f.write("paper/main.tex", paper("\\input{missing-fixture-input}"));
    f.repo.run(["commit", "-qam", "fatal"]);
    await expect(builder.build("HEAD")).rejects.toBeInstanceOf(BuildError);
    expect(fs.existsSync(first.pdf)).toBe(true);

    f.write("paper/build/main.pdf", fs.readFileSync(first.pdf));
    f.repo.run(["add", "."]); f.repo.run(["commit", "-qm", "tracked PDF"]);
    await expect(builder.build("HEAD", ["full"], null, { force: true })).rejects.toBeInstanceOf(BuildError);
  } finally { await f.close(); }
});

it.skipIf(!tex || !which("xelatex")).each([
  { reason: "a missing input", source: "\\input{missing-fixture-chapter}", diagnostic: "Emergency stop" },
  { reason: "a hard-wrapped emergency stop", source: `\\input{${"a".repeat(62)}}`, diagnostic: "Emergency stop" },
  { reason: "100 errors", source: "\\undefinedcommand\n".repeat(110), diagnostic: "Undefined control sequence" },
])("rejects a truncated XeLaTeX PDF after $reason", async ({ source, diagnostic }) => {
  const f = new Fixture();
  try {
    f.write("paper/main.tex", paper(`Before fatal errors.\\newpage\n${source}\nAfter fatal errors.`));
    f.write(`paper/${"a".repeat(62)}.tex`, "\\input{missing-fixture-chapter}\n");
    f.repo.run(["add", "."]); f.repo.run(["commit", "-qm", "fatal errors"]);
    writeSettings(f.root, { engine: "xelatex" });
    const builder = new Builder(loadProject(f.root), f.repo);
    await expect(builder.build("HEAD")).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringContaining(diagnostic)]) });
    expect(await builder.cached("HEAD", ["full"], null)).toBeNull();
  } finally { await f.close(); }
});

it.skipIf(!tex)("published reviews retain revised compiler errors and clear them after a repair", async () => {
  const f = new Fixture();
  try {
    f.write("paper/main.tex", paper("Original text."));
    f.repo.run(["commit", "-qam", "simple paper"]);
    const app = f.app(), task = app.tasks.create("recoverable");
    const publish = async () => {
      const job = app.publisher.submit(task.name, undefined, false);
      await app.publisher.join();
      const done = app.publisher.job(job.id);
      expect(done.status, JSON.stringify(done.result)).toBe("done");
      return app.review.latestRound(task.name)!;
    };
    f.edit(task, "paper/main.tex", "Original text.", "Revised \\undefinedcommand text.");
    const first = await publish();
    expect(first.summary.revisedErrors?.join("\n")).toContain("Undefined control sequence");
    const detail = app.review.roundDetail(task.name, first.number);
    expect(detail.revisedErrors).toEqual(first.summary.revisedErrors);
    expect(detail.baselineErrors).toBeUndefined();
    const built = await new Builder(app.project, app.repo).completed(detail.build!.key);
    const pdf = new PdfDocument(built!.pdf);
    try { expect(pdf.page(0).text()).toMatch(/Revised\s+text/); } finally { pdf.close(); }

    f.edit(task, "paper/main.tex", "\\undefinedcommand ", "");
    const repaired = await publish();
    expect(app.review.roundDetail(task.name, repaired.number).revisedErrors).toBeUndefined();
    expect(app.review.roundDetail(task.name, first.number).revisedErrors).toEqual(detail.revisedErrors);
  } finally { await f.close(); }
}, 120000);

it.skipIf(!tex).each(["nav", "snm"])("strict Beamer builds recover from stale .%s files", async extension => {
  const f = new Fixture();
  try {
    // Beamer reads .nav automatically; the companion-document API reads .snm.
    f.write("paper/main.tex", "\\documentclass{beamer}\n\\setjobnamebeamerversion{main}\n\\begin{document}\n\\begin{frame}{Example}\nOriginal text.\n\\end{frame}\n\\end{document}\n");
    f.repo.run(["commit", "-qam", "slides"]);
    writeSettings(f.root, { halt_on_error: true });
    const project = loadProject(f.root), builder = new Builder(project, f.repo);
    const first = await builder.build("HEAD");
    fs.appendFileSync(path.join(path.dirname(first.pdf), `main.${extension}`), "\\obsoletecommand\n");
    f.write("paper/main.tex", f.read("paper/main.tex").replace("Original", "Revised"));
    f.repo.run(["commit", "-qam", "revise slides"]);
    const next = await builder.build("HEAD");
    expect(fs.readFileSync(path.join(project.state, "logs", next.key + ".log"), "utf8")).toContain(`main.${extension}`);
    const pdf = new PdfDocument(next.pdf);
    try { expect(pdf.page(0).text()).toContain("Revised text."); } finally { pdf.close(); }
    expect(next.errors).toBeUndefined();
    expect(fs.existsSync(first.pdf)).toBe(true);
  } finally { await f.close(); }
}, 120000);

it.skipIf(!tex).each([
  { extension: "lol", strict: true },
  { extension: "loa", strict: true },
  { extension: "lol", strict: false },
  { extension: "loa", strict: false },
  { extension: "package-list", strict: true },
])("clears stale generated .$extension files with strict=$strict", async ({ extension, strict }) => {
  const f = new Fixture();
  try {
    // LaTeX's list machinery writes arbitrary package-specific extensions.
    // The next version removes a macro used only by the previous list file.
    const source = (old: boolean) => `\\documentclass{article}\n${old ? "\\newcommand{\\obsoletecommand}{Original list entry.}\n" : ""}\\begin{document}\n\\makeatletter\\@starttoc{${extension}}\\makeatother\n\\addtocontents{${extension}}{${old ? "\\protect\\obsoletecommand" : "Revised list entry."}}\n${old ? "Original" : "Revised"} text.\n\\end{document}\n`;
    f.write("paper/main.tex", source(true));
    f.repo.run(["commit", "-qam", "write generated list"]);
    writeSettings(f.root, { halt_on_error: strict });
    const project = loadProject(f.root), builder = new Builder(project, f.repo), first = await builder.build("HEAD");
    expect(fs.readFileSync(path.join(path.dirname(first.pdf), `main.${extension}`), "utf8")).toContain("\\obsoletecommand");
    f.write("paper/main.tex", source(false));
    f.repo.run(["commit", "-qam", "remove old list macro"]);
    const compile = vi.spyOn(builder as any, "compile");
    const next = await builder.build("HEAD");
    expect(next.errors).toBeUndefined();
    if (strict) {
      expect(compile).toHaveBeenCalledTimes(2);
      const stale = fs.readFileSync(path.join(project.state, "logs", next.key + ".log"), "utf8");
      expect(stale).toContain(`main.${extension}`);
      expect(stale).toContain("Undefined control sequence");
    }
    const pdf = new PdfDocument(next.pdf);
    try { expect(pdf.page(0).text()).toMatch(/Revised list entry\.[\s\S]*Revised text\./); } finally { pdf.close(); }
    expect(fs.existsSync(first.pdf)).toBe(true);

    // A genuine source error does not justify clearing the auxiliary state.
    f.write("paper/main.tex", source(false).replace("Revised text.", "Revised \\undefinedcommand text."));
    f.repo.run(["commit", "-qam", "source error"]);
    compile.mockClear();
    if (strict) {
      await expect(builder.build("HEAD")).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringMatching(/main\.tex:\d+: Undefined control sequence/)]) });
      expect(await builder.cached("HEAD", ["full"], null)).toBeNull();
    } else {
      const broken = await builder.build("HEAD");
      expect(broken.errors?.join("\n")).toMatch(/main\.tex:\d+: Undefined control sequence/);
    }
    expect(compile).toHaveBeenCalledTimes(1);
    compile.mockRestore();
  } finally { await f.close(); }
}, 120000);

it.skipIf(!tex).each([true, false])("stops retrying persistent generated-output errors with strict=%s", async strict => {
  const f = new Fixture();
  try {
    f.write("paper/main.tex", paper("\\newwrite\\listing\n\\immediate\\openout\\listing=main.package-list\n\\immediate\\write\\listing{\\string\\undefinedcommand}\n\\immediate\\closeout\\listing\n\\input{build/main.package-list}\nText after the error."));
    f.repo.run(["commit", "-qam", "persistent list error"]);
    writeSettings(f.root, { halt_on_error: strict });
    const builder = new Builder(loadProject(f.root), f.repo), compile = vi.spyOn(builder as any, "compile");
    if (strict) {
      await expect(builder.build("HEAD")).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringContaining("build/main.package-list:1: Undefined control sequence")]) });
      expect(await builder.cached("HEAD", ["full"], null)).toBeNull();
    } else {
      const built = await builder.build("HEAD");
      expect(built.errors?.join("\n")).toContain("build/main.package-list:1: Undefined control sequence");
      expect(fs.existsSync(built.pdf)).toBe(true);
    }
    expect(compile).toHaveBeenCalledTimes(2);
    compile.mockRestore();
  } finally { await f.close(); }
}, 120000);

it.skipIf(!tex)("accepted PDF diagnostics follow the baseline, partial decisions, restart and repair", async () => {
  const f = new Fixture();
  try {
    f.write("paper/main.tex", paper("Original text.\n\n\\PackageError{fixture}{Baseline diagnostic}{}").replace("\\begin{document}", "\\input{defs}\n\\begin{document}"));
    f.write("paper/defs.tex", "% Definitions.\n");
    f.repo.run(["add", "."]); f.repo.run(["commit", "-qm", "baseline"]);
    let app = f.app();
    await app.ready;
    const task = app.tasks.create("partial", "Partial", [], ["paper"], true);
    f.edit(task, "paper/main.tex", "Original", "\\addedword{}");
    f.edit(task, "paper/main.tex", "\\PackageError{fixture}{Baseline diagnostic}{}", "");
    f.write("paper/defs.tex", "\\newcommand{\\addedword}{Revised}\n", task.worktree);
    const job = app.publisher.submit(task.name, undefined, false);
    await app.publisher.join();
    expect(app.publisher.job(job.id).status).toBe("done");
    const round = app.review.latestRound(task.name)!;
    expect(round.summary.revisedErrors).toBeUndefined();
    const baseline = await app.applied.state(task.name);
    expect(baseline.shown?.current).toBe(true);
    expect(baseline.shown?.errors?.join("\n")).toContain("Baseline diagnostic");

    const use = round.units.filter(unit => unit.file === "paper/main.tex" && unit.new_text.includes("\\addedword"));
    expect(use).toHaveLength(1);
    await app.review.decide(task.name, { id: "use", action: "accept", round: round.number, changes: use.map(unit => unit.id) });
    await app.applied.join();
    const broken = await app.applied.state(task.name);
    expect(broken.shown?.current).toBe(true);
    expect(broken.error).toBeUndefined();
    expect(broken.shown?.errors?.join("\n")).toContain("Undefined control sequence");
    const pdf = new PdfDocument((await app.applied.pdf(task.name, broken.shown!.key))!);
    try { expect(pdf.page(0).text()).toContain("text."); } finally { pdf.close(); }

    await app.close(); f.apps.splice(f.apps.indexOf(app), 1);
    app = f.app(); await app.ready;
    expect((await app.applied.state(task.name)).shown).toEqual(broken.shown);
    await app.review.decide(task.name, { id: "repair", action: "accept", round: round.number, changes: round.units.filter(unit => !use.includes(unit)).map(unit => unit.id) });
    await app.applied.join();
    const repaired = await app.applied.state(task.name);
    expect(repaired.shown?.current).toBe(true);
    expect(repaired.shown?.errors).toBeUndefined();
    const fixed = new PdfDocument((await app.applied.pdf(task.name, repaired.shown!.key))!);
    try { expect(fixed.page(0).text()).toContain("Revised text."); } finally { fixed.close(); }
    await app.review.undo(task.name, "repair");
    await app.applied.join();
    expect((await app.applied.state(task.name)).shown?.errors).toEqual(broken.shown?.errors);
  } finally { await f.close(); }
}, 120000);
