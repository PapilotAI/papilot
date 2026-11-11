import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { Fixture } from "./helpers.ts";
import { loadProject } from "../../src/core/config.ts";
import { moveLegacyState } from "../../src/core/legacy-state.ts";
import { REFS, STATE, gitBinary, stateOf } from "../../src/core/git.ts";
import { run } from "../../src/core/process.ts";
import { realPath } from "../../src/core/files.ts";
import { Store } from "../../src/core/store.ts";
import { DatabaseSync } from "node:sqlite";

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
  f.write("rounds/polish/001/round.json", "{}", old);
  // A round keeps the builds it compares, and a failed job its log, by path.
  const real = path.join(realPath(path.join(f.root, ".git")), "latex-review"), build = (key: string) => ({ key, root: path.join(real, "cache/builds", key, "src"), pdf: path.join(real, "cache/builds", key, "src/build/main.pdf") });
  f.write("rounds/polish/001/places.json", JSON.stringify({ main: "paper/main.tex", old: build("a"), new: build("b"), units: { u1: [] } }), old);
  const store = new Store(path.join(old, "state.sqlite3"));
  store.db.prepare("INSERT INTO jobs(id, task, status, result, created) VALUES ('j', 'polish', 'failed', ?, 1)").run(JSON.stringify({ error: "Your edits do not compile.", log: `${real}/logs/j.log` }));
  store.db.close();
  f.repo.run(["update-ref", "refs/latex-review/polish/base", head]);
  f.repo.run(["update-ref", "refs/latex-review/polish/round-1", head]);
  f.repo.run(["pack-refs", "--all"]);
  f.repo.run(["update-ref", "refs/latex-review/polish/accepted", head]);
  const worktree = path.join(f.base, "polish");
  f.repo.run(["worktree", "add", "-q", "--detach", worktree]);
  const worktreeState = path.join(f.root, ".git/worktrees/polish");
  f.write("latex-review/snapshot-index", "index", worktreeState);
  f.write(".latex-review.json", JSON.stringify({ main: "paper/main.tex", engine: "lualatex", partial_builds: false }));

  const project = loadProject(f.root), state = path.join(realPath(f.root), ".git", STATE);
  expect(project.state).toBe(state);
  expect([project.main, project.engine, project.partial_builds]).toEqual(["paper/main.tex", "lualatex", false]);
  expect(fs.existsSync(old)).toBe(false);
  expect(fs.existsSync(path.join(state, "rounds/polish/001/round.json"))).toBe(true);
  const moved = (key: string) => ({ key, root: path.join(state, `cache/builds/${key}/src`), pdf: path.join(state, `cache/builds/${key}/src/build/main.pdf`) });
  expect(JSON.parse(fs.readFileSync(path.join(state, "rounds/polish/001/places.json"), "utf8"))).toEqual({ main: "paper/main.tex", old: moved("a"), new: moved("b"), units: { u1: [] } });
  const db = new DatabaseSync(path.join(state, "state.sqlite3"));
  expect(JSON.parse((db.prepare("SELECT result FROM jobs WHERE id = 'j'").get() as { result: string }).result).log).toBe(path.join(state, "logs/j.log"));
  db.close();
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
  expect(stateOf(worktree)).toBe(path.join(realPath(f.root), ".git/worktrees/task", STATE));
  expect(fs.readFileSync(path.join(f.root, ".git", STATE, "state.sqlite3"), "utf8")).toBe("tasks");
  expect(refs("refs/latex-review/")).toBe("");
});
