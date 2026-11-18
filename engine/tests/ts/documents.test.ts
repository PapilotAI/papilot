import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { chooseDocument, documentsFile, loadProject, projectFor, readBuildOverrides, readSettings, saveBuildOverrides, writeSettings } from "../../src/core/config.ts";
import { Fixture } from "./helpers.ts";
import { createServer } from "../../src/server.ts";

// A repository with several root documents, such as a paper and its slides:
// the paper compiles one at a time, each keeps its own settings, and a task
// keeps compiling the document it was started on.
const SLIDES = "slides/talk.tex";
const TALK = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Results}Counts rose.\end{frame}
\end{document}
`;
let f: Fixture;
beforeEach(() => {
  f = new Fixture();
  f.write(SLIDES, TALK);
  f.repo.run(["add", "."]);
  f.repo.run(["commit", "-qm", "slides"]);
});
afterEach(() => f.close());

it("keeps each root document's settings when the paper compiles another", () => {
  // The paper's main file is detected; the slides were never compiled.
  expect(loadProject(f.root).main).toBe("paper/main.tex");
  writeSettings(f.root, { build_workers: 2 });
  expect(chooseDocument(f.root, SLIDES)).toBe(true);
  expect(chooseDocument(f.root, SLIDES)).toBe(false);
  // Repository settings stay; a new document compiles with the whole repository.
  expect(readSettings(f.root)).toEqual({ build_workers: 2, source_dir: "", main: SLIDES });
  expect(loadProject(f.root)).toMatchObject({ main: SLIDES, source_dir: "", build_workers: 2 });
  // The paper still compiles as it did, also while it is not the current one.
  expect(loadProject(f.root, undefined, "paper/main.tex")).toMatchObject({ main: "paper/main.tex", source_dir: "paper", build_workers: 2 });
  // The slides' engine comes back with them.
  writeSettings(f.root, { ...readSettings(f.root), engine: "xelatex" });
  chooseDocument(f.root, "paper/main.tex");
  // The paper's main file was detected, and still is.
  expect(readSettings(f.root)).toEqual({ build_workers: 2 });
  expect(loadProject(f.root).engine).toBe("pdflatex");
  expect(JSON.parse(fs.readFileSync(documentsFile(f.root), "utf8"))[SLIDES]).toEqual({ engine: "xelatex", source_dir: "", main: SLIDES });
  expect(loadProject(f.root, undefined, SLIDES).engine).toBe("xelatex");
  chooseDocument(f.root, SLIDES);
  expect(readSettings(f.root)).toEqual({ build_workers: 2, engine: "xelatex", source_dir: "", main: SLIDES });
});

it("shares a source folder that contains the new document", () => {
  f.write("paper/appendix.tex", TALK);
  writeSettings(f.root, { main: "paper/main.tex", source_dir: "paper" });
  chooseDocument(f.root, "paper/appendix.tex");
  expect(readSettings(f.root)).toEqual({ main: "paper/appendix.tex", source_dir: "paper" });
  chooseDocument(f.root, SLIDES);
  expect(readSettings(f.root)).toEqual({ main: SLIDES, source_dir: "" });
  // Also the folder a main file compiles in when none is named.
  writeSettings(f.root, { main: "paper/main.tex" });
  chooseDocument(f.root, "paper/appendix.tex");
  expect(readSettings(f.root)).toEqual({ main: "paper/appendix.tex", source_dir: "paper" });
});

it("keeps an agent's repair of each document's build", () => {
  const data = process.env.PAPILOT_DATA;
  process.env.PAPILOT_DATA = path.join(f.base, "data");
  try {
    saveBuildOverrides(f.root, { engine: "lualatex" });
    expect(loadProject(f.root).engine).toBe("lualatex");
    chooseDocument(f.root, SLIDES);
    expect(loadProject(f.root).engine).toBe("pdflatex");
    saveBuildOverrides(f.root, { engine: "xelatex" });
    // Each document has its own repair, also while the other one compiles.
    expect(loadProject(f.root, undefined, "paper/main.tex").engine).toBe("lualatex");
    chooseDocument(f.root, "paper/main.tex");
    expect(loadProject(f.root).engine).toBe("lualatex");
    expect(readBuildOverrides(f.root, { main: SLIDES, source_dir: "" })).toEqual({ engine: "xelatex" });
  } finally {
    if (data === undefined) delete process.env.PAPILOT_DATA; else process.env.PAPILOT_DATA = data;
  }
});

it("compiles a task whose main file is gone with the current document", async () => {
  writeSettings(f.root, { main: "paper/main.tex" });
  const app = f.app();
  await app.ready;
  const task = app.tasks.create("renamed", "Renamed", [], ["paper"]);
  f.repo.run(["mv", "paper/main.tex", "paper/thesis.tex"]);
  writeSettings(f.root, { main: "paper/thesis.tex" });
  expect(app.projectOf(task).main).toBe("paper/thesis.tex");
  expect(app.taskInfo(task.name).document).toBe("paper/thesis.tex");
  expect(() => app.tasks.snapshot(task)).not.toThrow();
});

it("marks tasks from before as compiling the document of their time", async () => {
  const app = f.app();
  await app.ready;
  const task = app.tasks.create("older", "Older", [], ["paper"]);
  app.store.execute("UPDATE tasks SET document=NULL WHERE name=?", task.name);
  await app.close();
  f.apps.splice(f.apps.indexOf(app), 1);
  const restarted = f.app();
  expect(restarted.tasks.get(task.name).document).toBe("paper/main.tex");
  chooseDocument(f.root, SLIDES);
  expect(restarted.projectOf(task.name).main).toBe("paper/main.tex");
});

it("compiles a task with the document it was started on", async () => {
  const app = f.app();
  await app.ready;
  const paper = app.tasks.create("paper-task", "Paper", [], ["paper"]);
  expect(paper.document).toBe("paper/main.tex");
  chooseDocument(f.root, SLIDES);
  expect(app.project.main).toBe(SLIDES);
  expect(app.projectOf(paper)).toMatchObject({ main: "paper/main.tex", source_dir: "paper" });
  expect(app.projectOf(paper.name).main).toBe("paper/main.tex");
  // New files count in the task's document's folder, not the whole repository's.
  f.write("slides/new.tex", "New.", paper.worktree);
  f.write("paper/new.tex", "New.", paper.worktree);
  expect(app.repo.changedFiles(paper.base, app.tasks.snapshot(paper))).toEqual(["paper/new.tex"]);
  // A task started now compiles the slides.
  expect(app.tasks.create("slides-task", "Slides").document).toBe(SLIDES);
  // A task from before tasks kept their document compiles the current one.
  app.store.execute("UPDATE tasks SET document=NULL WHERE name=?", paper.name);
  expect(app.projectOf(paper.name).main).toBe(SLIDES);
  expect(fs.existsSync(path.join(f.root, SLIDES))).toBe(true);
});

it("resumes a named task on its document after the paper switches", async () => {
  const app = f.app();
  await app.ready;
  const task = await app.tasks.createAsync("resumed", "Resumed", [], [], true);
  chooseDocument(f.root, SLIDES);
  // Papilot asks for the task by name again to finish preparing it.
  const again = await app.tasks.createAsync("resumed", "Resumed", [], [], true);
  expect(again).toMatchObject({ name: task.name, worktree: task.worktree, document: "paper/main.tex" });
  // An unnamed request is a new task, on the slides.
  const other = app.tasks.create(undefined, "Resumed");
  expect(other.name).not.toBe(task.name);
  expect(other.document).toBe(SLIDES);
});

it("creates a task on the document asked for, as a retry after a switch does", async () => {
  const app = f.app();
  await app.ready;
  chooseDocument(f.root, SLIDES);
  const server = createServer(app);
  try {
    const post = (body: object) => server.inject({ method: "POST", url: "/api/tasks", headers: { host: "127.0.0.1:9", origin: app.url, "x-review-token": app.csrf }, payload: body });
    const asked = await post({ name: "asked", title: "Asked", deferred: true, document: "paper/main.tex" });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json().document).toBe("paper/main.tex");
    expect(app.projectOf("asked")).toMatchObject({ main: "paper/main.tex", source_dir: "paper" });
    // A document since removed: the one the paper compiles now.
    expect((await post({ name: "gone", title: "Gone", deferred: true, document: "paper/gone.tex" })).json().document).toBe(SLIDES);
    expect((await post({ name: "outside", title: "Outside", document: "../main.tex" })).statusCode).not.toBe(200);
  } finally {
    await server.close();
  }
});

it("gives the paper's document settings to the document chosen while none could be told apart", () => {
  // Two main files of the same rank: detection cannot choose, so nothing compiles yet.
  f.write("thesis/main.tex", TALK);
  writeSettings(f.root, { engine: "xelatex", build_workers: 2 });
  expect(() => loadProject(f.root)).toThrow(/Several root documents/);
  chooseDocument(f.root, "paper/main.tex");
  expect(readSettings(f.root)).toEqual({ engine: "xelatex", build_workers: 2, source_dir: "", main: "paper/main.tex" });
  expect(loadProject(f.root).engine).toBe("xelatex");
});

it("drops a document's repair once its settings are chosen by hand, also when undone", () => {
  const data = process.env.PAPILOT_DATA;
  process.env.PAPILOT_DATA = path.join(f.base, "data");
  try {
    saveBuildOverrides(f.root, { engine: "lualatex" });
    // The author names the engine; the next repair is made for that.
    writeSettings(f.root, { engine: "xelatex" });
    saveBuildOverrides(f.root, { source_dir: "" });
    writeSettings(f.root, {});
    expect(loadProject(f.root).engine).toBe("pdflatex");
    // Another document's repair stays.
    chooseDocument(f.root, SLIDES);
    saveBuildOverrides(f.root, { engine: "xelatex" });
    chooseDocument(f.root, "paper/main.tex");
    expect(readBuildOverrides(f.root, { main: SLIDES, source_dir: "" })).toEqual({ engine: "xelatex" });
  } finally {
    if (data === undefined) delete process.env.PAPILOT_DATA; else process.env.PAPILOT_DATA = data;
  }
});

it("compiles a document whose file is gone as the paper's current one", () => {
  expect(projectFor(f.root, "paper/gone.tex").main).toBe("paper/main.tex");
  expect(projectFor(f.root, SLIDES).main).toBe(SLIDES);
  expect(() => projectFor(f.root, "../outside.tex")).toThrow(/repository-relative/);
});

it("compiles a task as the current document once its main file is renamed, though read before", async () => {
  const app = f.app();
  await app.ready;
  const task = app.tasks.create("cached", "Cached", [], ["paper"]);
  chooseDocument(f.root, SLIDES);
  expect(app.projectOf(task).main).toBe("paper/main.tex");
  // Renamed without a change of settings, while the slides compile.
  f.repo.run(["mv", "paper/main.tex", "paper/thesis.tex"]);
  expect(app.projectOf(task).main).toBe(SLIDES);
  expect(app.projectOf(task).main).toBe(SLIDES);
  // Back again, it compiles as itself.
  f.repo.run(["mv", "paper/thesis.tex", "paper/main.tex"]);
  expect(app.projectOf(task).main).toBe("paper/main.tex");
});

it("reads a documents file it cannot use as none", () => {
  fs.mkdirSync(path.dirname(documentsFile(f.root)), { recursive: true });
  fs.writeFileSync(documentsFile(f.root), "null");
  expect(loadProject(f.root, undefined, SLIDES).main).toBe(SLIDES);
  expect(chooseDocument(f.root, SLIDES)).toBe(true);
  expect(JSON.parse(fs.readFileSync(documentsFile(f.root), "utf8"))).toHaveProperty(["paper/main.tex"]);
});
