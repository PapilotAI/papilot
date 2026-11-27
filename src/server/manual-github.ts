import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ManualGithubRemote, ManualGithubSynced } from '../shared.ts';

const exec = promisify(execFile);
const LOCAL_TIMEOUT = 15_000;
const PUSH_TIMEOUT = 60_000;
const MAX_REPO_FILES = 120;
const MANUSCRIPT_EXTENSIONS = /\.(?:tex|bib|sty|cls|bst|md)$/i;

async function git(cwd: string, args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  const { stdout } = await exec('git', args, {
    cwd,
    timeout: options.timeout ?? LOCAL_TIMEOUT,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...options.env },
  });
  return stdout;
}

function redactCredentials(text: string) {
  return text.replace(/(https?:\/\/)[^/\s@]+@/gi, '$1***@');
}

export function parseGithubRepository(raw: string): string | null {
  const trimmed = raw.trim();
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+)$/i.exec(trimmed)?.[1];
  let repo = ssh;
  if (!repo) {
    try {
      const url = new URL(trimmed);
      if (['https:', 'ssh:'].includes(url.protocol) && url.hostname.toLowerCase() === 'github.com' && !url.port && !url.search && !url.hash) {
        repo = url.pathname.replace(/^\/+/, '');
      }
    } catch {
      return null;
    }
  }
  if (!repo) return null;
  const cleaned = repo.replace(/\.git$/i, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return null;
  const [owner, name] = cleaned.split('/');
  if (!owner || !name || owner === '.' || owner === '..' || name === '.' || name === '..') return null;
  return cleaned;
}

function githubTreeUrl(repoUrl: string, branch: string) {
  const encoded = branch.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl}/tree/${encoded}`;
}

export function manualGithubBranch(taskName: string): string {
  const slug = taskName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/\.lock$/i, '')
    .slice(0, 48)
    .replace(/\.lock$/i, '')
    .replace(/^[.-]+|[.-]+$/g, '') || 'task';
  return `papilot-pro/${slug}`;
}

/**
 * Lists GitHub remotes whose fetch and push URLs resolve to the same GitHub repository.
 * Prefers `origin` first when present.
 */
export async function githubRemotes(root: string): Promise<ManualGithubRemote[]> {
  if (!root || !fs.existsSync(root)) return [];
  let names: string[];
  try {
    names = (await git(root, ['remote'])).split('\n').map(line => line.trim()).filter(name => Boolean(name) && !name.startsWith('-'));
  } catch {
    return [];
  }
  const resolved = await Promise.all(names.map(async name => {
    try {
      const [fetchOut, pushOut] = await Promise.all([
        git(root, ['remote', 'get-url', '--all', '--', name]),
        git(root, ['remote', 'get-url', '--all', '--push', '--', name]),
      ]);
      const fetchUrls = fetchOut.trim().split('\n').filter(Boolean);
      const pushUrls = pushOut.trim().split('\n').filter(Boolean);
      if (fetchUrls.length !== 1 || pushUrls.length !== 1) return null;
      const fetchRepo = parseGithubRepository(fetchUrls[0]);
      const pushRepo = parseGithubRepository(pushUrls[0]);
      if (!fetchRepo || !pushRepo || fetchRepo.toLowerCase() !== pushRepo.toLowerCase()) return null;
      return { name, repository: fetchRepo, url: `https://github.com/${fetchRepo}` };
    } catch {
      return null;
    }
  }));
  return resolved
    .filter((item): item is ManualGithubRemote => item !== null)
    .sort((a, b) => (a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : a.name.localeCompare(b.name)));
}

/**
 * Lists manuscript-relevant tracked and non-ignored files in the task worktree.
 */
export async function listRepoManuscriptFiles(worktree: string): Promise<string[]> {
  if (!worktree || !fs.existsSync(worktree)) return [];
  try {
    const out = await git(worktree, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    return out
      .split('\0')
      .filter(file => Boolean(file) && !path.basename(file).startsWith('.papilot-') && MANUSCRIPT_EXTENSIONS.test(file))
      .sort()
      .slice(0, MAX_REPO_FILES);
  } catch {
    return [];
  }
}

/**
 * Checks whether the task worktree is clean and its HEAD already matches a
 * remote-tracking branch on the given GitHub remote (so no snapshot push is needed).
 */
export async function detectReusableRemoteBranch(worktree: string, remote: ManualGithubRemote): Promise<ManualGithubSynced | null> {
  if (!worktree || !fs.existsSync(worktree)) return null;
  try {
    const status = await git(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    const dirty = status.split('\0').filter(Boolean).some(entry => {
      const file = entry.slice(3);
      return file && !path.basename(file).startsWith('.papilot-');
    });
    if (dirty) return null;
    const head = (await git(worktree, ['rev-parse', '--verify', 'HEAD'])).trim();
    if (!head) return null;
    const refsOut = await git(worktree, ['for-each-ref', '--format=%(objectname)%00%(refname)', `refs/remotes/${remote.name}`]);
    const prefix = `refs/remotes/${remote.name}/`;
    const matches: string[] = [];
    for (const line of refsOut.split('\n').filter(Boolean)) {
      const [object, refname] = line.split('\0');
      if (object !== head || !refname.startsWith(prefix)) continue;
      const branch = refname.slice(prefix.length);
      if (!branch || branch === 'HEAD') continue;
      matches.push(branch);
    }
    if (!matches.length) return null;
    const preferred =
      matches.find(branch => branch === 'main')
      ?? matches.find(branch => branch === 'master')
      ?? matches.find(branch => !branch.startsWith('papilot-pro/'))
      ?? matches[0];
    return {
      remote: remote.name,
      repository: remote.repository,
      branch: preferred,
      commit: head,
      url: githubTreeUrl(remote.url, preferred),
      reusedRemote: true,
    };
  } catch {
    return null;
  }
}

/**
 * Pushes a snapshot of the task worktree to a dedicated `papilot-pro/<task>`
 * branch on the GitHub remote without modifying the worktree's HEAD, index,
 * or working files. Reuses an already-pushed remote branch if identical.
 */
export async function syncWorktreeToGithub(worktree: string, taskName: string, remote: ManualGithubRemote): Promise<ManualGithubSynced> {
  if (!worktree || !fs.existsSync(worktree)) throw new Error('The task worktree is not available.');
  const reused = await detectReusableRemoteBranch(worktree, remote);
  if (reused) return reused;

  const head = await git(worktree, ['rev-parse', '--verify', 'HEAD']).then(out => out.trim()).catch(() => '');
  const headTree = head ? await git(worktree, ['rev-parse', '--verify', 'HEAD^{tree}']).then(out => out.trim()).catch(() => '') : '';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-github-'));
  const tempIndex = path.join(tempDir, 'index');
  let commit = head;
  try {
    const indexEnv = { GIT_INDEX_FILE: tempIndex };
    if (head) await git(worktree, ['read-tree', head], { env: indexEnv });
    await git(worktree, ['add', '-A', '--', '.'], { env: indexEnv });
    await git(worktree, ['rm', '-rf', '--cached', '--ignore-unmatch', '--', ':(glob)**/.papilot-*', '.papilot-*'], { env: indexEnv }).catch(() => {});
    const tree = (await git(worktree, ['write-tree'], { env: indexEnv })).trim();
    if (!head || tree !== headTree) {
      const commitArgs = head
        ? ['commit-tree', tree, '-p', head, '-m', `Papilot ChatGPT Pro snapshot (${taskName})`]
        : ['commit-tree', tree, '-m', `Papilot ChatGPT Pro snapshot (${taskName})`];
      commit = (await git(worktree, commitArgs, {
        env: {
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'Papilot',
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'papilot@local',
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'Papilot',
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'papilot@local',
        },
      })).trim();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const branch = manualGithubBranch(taskName);
  const ref = `refs/heads/${branch}`;
  try {
    await git(worktree, ['-c', `remote.${remote.name}.mirror=false`, 'push', '--no-follow-tags', '--force', '--', remote.name, `${commit}:${ref}`], {
      timeout: PUSH_TIMEOUT,
    });
  } catch (error) {
    const raw = error instanceof Error ? (error as { stderr?: string }).stderr?.trim() || error.message : String(error);
    const firstLine = redactCredentials(raw.split('\n')[0] || 'Git push failed.');
    throw new Error(`Could not push snapshot to ${remote.repository}: ${firstLine}`);
  }

  return {
    remote: remote.name,
    repository: remote.repository,
    branch,
    commit,
    url: githubTreeUrl(remote.url, branch),
    reusedRemote: false,
  };
}
