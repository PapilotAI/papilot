import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { Fixture } from "./helpers.ts";
import { loadProject } from "../../src/core/config.ts";
import { moveLegacyState } from "../../src/core/legacy-state.ts";
import { REFS, STATE, gitBinary, stateOf } from "../../src/core/git.ts";
import { run } from "../../src/core/process.ts";

// Papilot 0.9.4 and earlier kept a paper's state under the names of the review
// engine's former standalone skill. Opening the paper moves it.
let f: Fixture;
afterEach(() => f?.close());
const refs = (prefix: string) => f.repo.text(["for-each-ref", "--format=%(refname) %(objectname)", prefix]);
const git = (gitDir: string) => (args: string[], input?: string) =>
  run(gitBinary(), ["--git-dir", gitDir, ...args], { input }).stdout.toString();

it("moves the state folder, task refs, worktree indexes and settings of an earlier version", () => {
  f = new Fixture();
  const head = f.repo.rev("HEAD"), old = path.join(f.root, ".git/latex-review");
  f.write("state.sqlite3", "tasks", old);
  f.write("rounds/polish/001/round.json", "{}", old);
  f.repo.run(["update-ref", "refs/latex-review/polish/base", head]);
  f.repo.run(["update-ref", "refs/latex-review/polish/round-1", head]);
  f.repo.run(["pack-refs", "--all"]);
  f.repo.run(["update-ref", "refs/latex-review/polish/accepted", head]);
  const worktree = path.join(f.base, "polish");
  f.repo.run(["worktree", "add", "-q", "--detach", worktree]);
  const worktreeState = path.join(f.root, ".git/worktrees/polish");
  f.write("latex-review/snapshot-index", "index", worktreeState);
  f.write(".latex-review.json", JSON.stringify({ main: "paper/main.tex", engine: "lualatex", partial_builds: false }));

  const project = loadProject(f.root), state = path.join(fs.realpathSync(f.root), ".git", STATE);
  expect(project.state).toBe(state);
  expect([project.main, project.engine, project.partial_builds]).toEqual(["paper/main.tex", "lualatex", false]);
  expect(fs.existsSync(old)).toBe(false);
  expect(fs.readFileSync(path.join(state, "state.sqlite3"), "utf8")).toBe("tasks");
  expect(fs.existsSync(path.join(state, "rounds/polish/001/round.json"))).toBe(true);
  expect(refs("refs/latex-review/")).toBe("");
  expect(refs(REFS).split("\n").sort()).toEqual(["accepted", "base", "round-1"].map((name) => `${REFS}polish/${name} ${head}`));
  expect(fs.existsSync(path.join(worktreeState, "latex-review"))).toBe(false);
  expect(fs.readFileSync(path.join(worktreeState, STATE, "snapshot-index"), "utf8")).toBe("index");
  expect(JSON.parse(fs.readFileSync(path.join(state, "settings.json"), "utf8"))).toEqual({ main: "paper/main.tex", engine: "lualatex", partial_builds: false });
  // The author's file is left as it is; later changes go to the new settings.
  expect(fs.existsSync(path.join(f.root, ".latex-review.json"))).toBe(true);
  fs.writeFileSync(path.join(state, "settings.json"), JSON.stringify({ main: "paper/main.tex" }));
  expect(loadProject(f.root).engine).toBe("pdflatex");
});

it("keeps the current state when an older version ran again after the move", () => {
  f = new Fixture();
  const head = f.repo.rev("HEAD"), gitDir = path.join(f.root, ".git");
  f.write("latex-review/state.sqlite3", "older", gitDir);
  f.write(`${STATE}/state.sqlite3`, "current", gitDir);
  f.repo.run(["update-ref", "refs/latex-review/polish/base", head]);
  f.repo.run(["update-ref", `${REFS}polish/base`, f.repo.rev("HEAD")]);
  f.repo.run(["update-ref", "refs/latex-review/other/base", head]);
  moveLegacyState(gitDir, git(gitDir), STATE, REFS);
  expect(fs.readFileSync(path.join(gitDir, STATE, "state.sqlite3"), "utf8")).toBe("current");
  expect(fs.readFileSync(path.join(gitDir, "latex-review/state.sqlite3"), "utf8")).toBe("older");
  // A ref whose new name is taken stays where it was, so its commits remain.
  expect(refs("refs/latex-review/")).toBe(`refs/latex-review/polish/base ${head}`);
  expect(refs(`${REFS}other/`)).toBe(`${REFS}other/base ${head}`);
  // Moving again changes nothing.
  moveLegacyState(gitDir, git(gitDir), STATE, REFS);
  expect(refs("refs/latex-review/")).toBe(`refs/latex-review/polish/base ${head}`);
});

it("a linked worktree's Git directory moves the whole repository's state", () => {
  f = new Fixture();
  const worktree = path.join(f.base, "task");
  f.repo.run(["worktree", "add", "-q", "--detach", worktree]);
  f.write(".git/latex-review/state.sqlite3", "tasks");
  f.repo.run(["update-ref", "refs/latex-review/task/base", f.repo.rev("HEAD")]);
  expect(stateOf(worktree)).toBe(path.join(fs.realpathSync(f.root), ".git/worktrees/task", STATE));
  expect(fs.readFileSync(path.join(f.root, ".git", STATE, "state.sqlite3"), "utf8")).toBe("tasks");
  expect(refs("refs/latex-review/")).toBe("");
});
