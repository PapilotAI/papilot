import fs from "node:fs";
import path from "node:path";
// Papilot 0.9.4 and earlier named a paper's state after the review engine's
// former standalone skill: .git/latex-review/, refs/latex-review/ and
// .latex-review.json in the working tree. A paper moves to the current names
// the first time a newer version opens it. Nothing else reads these names.
const FOLDER = "latex-review", REFS = "refs/latex-review/", SETTINGS = ".latex-review.json";
type Git = (args: string[], input?: string) => string;
// The Git directory that linked worktrees share with the main checkout.
function commonDir(gitDir: string) {
  try {
    return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
  } catch {
    return gitDir;
  }
}
const exists = (file: string) => {
  try { fs.lstatSync(file); return true; } catch { return false; }
};
/** Moves a repository's state and refs from the former names to `folder`
 *  and `refs`. Several processes may open the paper at once: each step is
 *  atomic, and one that another process completed counts as done. */
export function moveLegacyState(gitDir: string, git: Git, folder: string, refs: string) {
  const common = commonDir(gitDir);
  moveRefs(git, refs);
  if (!exists(path.join(common, FOLDER))) return;
  moveFolder(path.join(common, FOLDER), path.join(common, folder), false);
  // A linked worktree keeps only its snapshot index, which Git rebuilds.
  let worktrees: string[] = [];
  try { worktrees = fs.readdirSync(path.join(common, "worktrees")); } catch { /* None. */ }
  for (const name of worktrees)
    moveFolder(path.join(common, "worktrees", name, FOLDER), path.join(common, "worktrees", name, folder), true);
}
function moveFolder(from: string, to: string, disposable: boolean) {
  if (!exists(from)) return;
  // Both exist when an older version ran again after the move. The current
  // state stays authoritative, and the older one is left for the author.
  if (exists(to)) {
    if (disposable) fs.rmSync(from, { recursive: true, force: true });
    return;
  }
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (!exists(from) && exists(to)) return;
    throw new Error(
      `Papilot could not move ${from} to ${to} (${(error as Error).message}). Quit other programs that have this paper open, then try again.`,
    );
  }
}
function moveRefs(git: Git, refs: string) {
  const list = (prefix: string) =>
    new Map(git(["for-each-ref", "--format=%(refname) %(objectname)", prefix])
      .split("\n").filter(Boolean).map((line) => line.split(" ") as [string, string]));
  for (let attempt = 1; ; attempt++) {
    const taken = list(refs),
      // A ref whose new name exists already stays, and keeps its commits.
      moves = [...list(REFS)].map(([ref, oid]) => [ref, refs + ref.slice(REFS.length), oid])
        .filter(([, target]) => !taken.has(target));
    if (!moves.length) return;
    try {
      // One transaction: every ref moves, or none does when another process
      // moved some meanwhile; the next attempt sees what is left.
      git(["update-ref", "--stdin"], moves.map(([ref, target, oid]) => `create ${target} ${oid}\ndelete ${ref} ${oid}\n`).join(""));
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}
/** The settings of `.latex-review.json` in the working tree, if it holds a
 *  JSON object. */
export function legacySettings(root: string): Record<string, unknown> | null {
  const file = path.join(root, SETTINGS);
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
