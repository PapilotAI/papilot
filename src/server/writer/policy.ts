import fs from 'node:fs';
import path from 'node:path';

// Which of Papilot Writer's actions run without asking. Writing prose is the
// agent's job, so reading anything in the task worktree and editing LaTeX or
// BibTeX runs freely. Changes whose effects are hard to see in a review of
// the text, such as data, scripts, packages, build settings, binaries,
// overwrites, moves, deletions and commands, ask the author first. Nothing
// may reach outside the worktree or into Git's or Papilot's state.

/** An error the model reads in a tool result; the author never sees it, so it is not translated. */
export const toolError = (message: string) => new Error(message);

/** paper: the default. full: never ask. read-only: review tasks. */
export type WriterMode = 'paper' | 'full' | 'read-only';
export type Tier = 'safe' | 'ask' | 'refuse';
export interface Decision { tier: Tier; reason: string }
export type Action = 'read' | 'edit' | 'create' | 'overwrite' | 'move' | 'delete' | 'command';

// The paper's own text: free to edit in paper mode.
const PROSE = new Set(['.tex', '.bib', '.ltx']);
// Plain text the tools can read and show. Anything else is treated as binary.
const TEXT = new Set([...PROSE, '.sty', '.cls', '.bst', '.bbx', '.cbx', '.dtx', '.ins', '.def', '.cfg', '.clo', '.md', '.txt', '.csv', '.tsv',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.svg', '.tikz', '.pgf', '.pgf-plot', '.dat', '.table', '.py', '.r', '.jl', '.m', '.sh', '.gp', '.plt',
  '.mk', '.cff', '.rst', '.org', '.html', '.css', '.js', '.ts', '.lua', '.ini', '.log', '.blg', '.aux', '.bbl', '.toc', '.out', '.gitignore']);
const TEXT_NAMES = new Set(['latexmkrc', '.latexmkrc', 'makefile', 'readme', 'license', 'agents.md', 'claude.md']);

export const isProse = (file: string) => PROSE.has(path.extname(file).toLowerCase());
export const isText = (file: string) => TEXT.has(path.extname(file).toLowerCase()) || TEXT_NAMES.has(path.basename(file).toLowerCase());

/** A path inside the worktree: its absolute and worktree-relative forms. */
export interface Inside { abs: string; rel: string }

// The nearest existing ancestor's real path, so a symlink cannot lead out.
function realAncestor(target: string) {
  let current = target;
  for (;;) {
    try { return path.join(fs.realpathSync(current), path.relative(current, target)); }
    catch { const parent = path.dirname(current); if (parent === current) return target; current = parent; }
  }
}

/** Resolves a path the model gave against the worktree, or throws why not. */
export function resolveInside(cwd: string, file: string): Inside {
  if (typeof file !== 'string' || !file.trim()) throw toolError('Give a file path relative to the task worktree.');
  if (file.includes('\0')) throw toolError('The path contains a NUL character.');
  const root = fs.realpathSync(cwd);
  const lexical = path.resolve(root, file.trim().replace(/^@/, ''));
  const abs = realAncestor(lexical);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (!rel && abs === root) return { abs, rel: '.' };
    throw toolError(`${file} is outside the task worktree. Papilot Writer only works inside the paper's task worktree.`);
  }
  const parts = rel.split(path.sep).map(part => part.toLowerCase());
  if (parts.includes('.git')) throw toolError(`${file} is inside Git's own folder, which Papilot Writer never touches.`);
  return { abs, rel: rel.split(path.sep).join('/') };
}

/** Whether an action on a worktree path runs, asks or is refused. */
export function decide(mode: WriterMode, action: Action, rel = ''): Decision {
  if (action === 'read') return { tier: 'safe', reason: 'Reading the paper is always allowed.' };
  if (mode === 'read-only') return { tier: 'refuse', reason: 'This task is read-only, so Papilot Writer cannot change files or run commands.' };
  if (mode === 'full') return { tier: 'safe', reason: 'Full access is on for this task.' };
  if (action === 'command') return { tier: 'ask', reason: 'Commands can change anything in the worktree.' };
  if (action === 'delete') return { tier: 'ask', reason: `Deleting ${rel} is easy to miss in a review.` };
  if (action === 'move') return { tier: 'ask', reason: `Moving ${rel} changes where the paper finds it.` };
  if (!isText(rel)) return { tier: 'ask', reason: `${rel} is not a text file, so the change cannot be reviewed as text.` };
  if (!isProse(rel)) return { tier: 'ask', reason: `${rel} is not LaTeX or BibTeX: changing data, code, packages or build settings can change results.` };
  if (action === 'overwrite') return { tier: 'ask', reason: `Rewriting all of ${rel} replaces text that may already be accepted.` };
  return { tier: 'safe', reason: 'Editing LaTeX and BibTeX is the paper work itself.' };
}

/** Folders skipped when listing or searching: output and tool caches. */
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '_minted', '.papilot', '__pycache__', '.venv', 'venv', 'svg-inkscape']);
