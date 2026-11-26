import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/papilot.mjs', import.meta.url));
const file = 'chapters/intro with spaces.tex';
const original = 'The method is really very fast.';
const suggestion = 'The method is fast.';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(cwd: string, message: string) {
  git(cwd, '-c', 'user.name=Papilot Test', '-c', 'user.email=papilot@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/no-hooks', 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function run(repo: string, command: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [cli, 'handoff', command, '--repo', repo, ...args], { input, encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

function json(markdown: string) {
  const match = /^```json\n([\s\S]+?)\n```$/m.exec(markdown);
  assert.ok(match, markdown);
  return JSON.parse(match[1]);
}

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papilot-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, process.platform === 'win32' ? 'manuscript' : 'manuscript ');
  mkdirSync(path.join(repo, 'chapters'), { recursive: true });
  git(repo, 'init', '-b', 'main');
  const source = `${original}\nRepeated line.\nRepeated line.\n\n\`\`\`json\n{"schema":"papilot-handoff/v1","kind":"proposal"}\n\`\`\`\n`;
  writeFileSync(path.join(repo, file), source);
  writeFileSync(path.join(repo, 'other.tex'), 'Other text.\n');
  git(repo, 'add', '--', file, 'other.tex');
  const base = commit(repo, 'Create manuscript');
  const result = run(repo, 'request', ['--question', 'Make the first sentence concise.', '--include-source', file]);
  assert.equal(result.status, 0, result.stderr);
  const { requestId, baseCommit, schema } = json(result.stdout);
  assert.equal(baseCommit, base);
  const request = path.join(root, 'request.md');
  writeFileSync(request, result.stdout);
  const proposal = { schema, kind: 'proposal', requestId, baseCommit, changes: [{ file, original, suggestion, reason: 'Remove the redundant intensifiers.' }] };
  return { root, repo, source, request, requestMarkdown: result.stdout, proposal };
}

test('exchanges a proposal over Git and a Page export with the same checked receipt', t => {
  const { root, repo, source, request, requestMarkdown, proposal } = setup(t);
  assert.ok(requestMarkdown.includes('````text\n'));
  const page = path.join(root, 'page.md');
  writeFileSync(page, `${requestMarkdown}\n## Proposal\n\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\`\n`);

  const remote = path.join(root, 'remote.git'), reviewer = path.join(root, 'reviewer');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(repo, 'remote', 'add', 'exchange', remote);
  git(repo, 'push', 'exchange', 'HEAD:main');
  git(root, 'clone', remote, reviewer);
  assert.equal(git(reviewer, 'show', `${proposal.baseCommit}:${file}`).split('\n')[0], original);
  git(reviewer, 'checkout', '-b', 'proposal');
  writeFileSync(path.join(reviewer, 'proposal.json'), JSON.stringify(proposal));
  git(reviewer, 'add', 'proposal.json');
  commit(reviewer, 'Propose a shorter sentence');
  git(reviewer, 'push', 'origin', 'proposal');
  git(repo, 'fetch', 'exchange');

  const fromGit = run(repo, 'prepare', [request, '-'], git(repo, 'show', 'exchange/proposal:proposal.json'));
  const fromPage = run(repo, 'prepare', [request, page]);
  assert.equal(fromGit.status, 0, fromGit.stderr);
  assert.equal(fromPage.status, 0, fromPage.stderr);
  assert.equal(fromGit.stdout, fromPage.stdout);
  assert.deepEqual(json(fromGit.stdout).changes, proposal.changes);

  writeFileSync(path.join(repo, file), source.replace(original, suggestion));
  git(repo, 'add', '--', file);
  const resultCommit = commit(repo, 'Implement the proposed edit');
  const receipt = run(repo, 'receipt', ['--result', 'HEAD', request, page]);
  assert.equal(receipt.status, 0, receipt.stderr);
  assert.deepEqual(json(receipt.stdout), {
    schema: proposal.schema, kind: 'receipt', requestId: proposal.requestId, baseCommit: proposal.baseCommit,
    proposalSha256: json(receipt.stdout).proposalSha256, resultCommit, files: [file], status: 'ready_for_review',
  });
  assert.match(json(receipt.stdout).proposalSha256, /^[a-f0-9]{64}$/);

  git(repo, 'config', 'diff.ignoreSubmodules', 'all');
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${resultCommit},unapproved-module`);
  commit(repo, 'Add an unrelated submodule pointer');
  const outsideScope = run(repo, 'receipt', ['--result', 'HEAD', request, page]);
  assert.equal(outsideScope.status, 1);
  assert.match(outsideScope.stderr, /outside the proposal: unapproved-module/);
});

test('rejects stale, ambiguous, and out-of-scope proposals without running an agent', t => {
  const { repo, request, proposal } = setup(t);
  function rejects(record: unknown, error: RegExp) {
    const result = run(repo, 'prepare', [request, '-'], JSON.stringify(record));
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, error);
    assert.equal(result.stdout, '');
  }
  rejects({ ...proposal, baseCommit: '0'.repeat(40) }, /match the local request ID and base commit/);
  rejects({ ...proposal, changes: [{ ...proposal.changes[0], file: '../other.tex' }] }, /repository-relative/);
  rejects({ ...proposal, changes: [{ ...proposal.changes[0], file: 'other.tex' }] }, /did not authorize/);
  rejects({ ...proposal, changes: [{ ...proposal.changes[0], original: 'Repeated line.' }] }, /exactly once/);

  writeFileSync(path.join(repo, 'other.tex'), 'A different change.\n');
  rejects(proposal, /clean worktree/);
  git(repo, 'add', 'other.tex');
  commit(repo, 'Advance the manuscript');
  rejects(proposal, /at the requested base commit/);
  const receipt = run(repo, 'receipt', ['--result', 'HEAD', request, '-'], JSON.stringify(proposal));
  assert.equal(receipt.status, 1);
  assert.match(receipt.stderr, /outside the proposal: other\.tex/);
});

test('exports the published commit even when Git has a local replacement', t => {
  const { repo, source, proposal } = setup(t);
  const replacementSource = 'Local replacement.\n';
  writeFileSync(path.join(repo, file), replacementSource);
  git(repo, 'add', '--', file);
  const replacement = commit(repo, 'Replace local text');
  git(repo, 'reset', '--hard', proposal.baseCommit);
  git(repo, 'replace', proposal.baseCommit, replacement);
  const request = run(repo, 'request', ['--question', 'Use the published version.', '--include-source', file]);
  assert.equal(request.status, 0, request.stderr);
  assert.equal(json(request.stdout).baseCommit, proposal.baseCommit);
  assert.ok(request.stdout.includes(source));
  assert.ok(!request.stdout.includes(replacementSource));
});
