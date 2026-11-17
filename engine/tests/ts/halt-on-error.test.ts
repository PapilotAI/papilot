import fs from "node:fs";
import path from "node:path";
import { it, expect } from "vitest";
import { Builder, BuildError } from "../../src/core/build.ts";
import { chooseDocument, loadProject, readSettings, writeSettings } from "../../src/core/config.ts";
import { which } from "../../src/core/process.ts";
import { PdfDocument } from "../../src/render/pdf.ts";
import { Fixture } from "./helpers.ts";

const tex = Boolean(which("latexmk") && which("pdflatex"));
const paper = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

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
