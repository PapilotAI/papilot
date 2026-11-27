import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { buildManualPrompt } from '../src/server/manual-agent.ts';
import { detectReusableRemoteBranch, githubRemotes, manualGithubBranch, parseGithubRepository, syncWorktreeToGithub } from '../src/server/manual-github.ts';
import type { AgentRuntime } from '../src/server/agents.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { Run, Task, TimelineItem } from '../src/shared.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class FakeRuntime extends EventEmitter implements AgentRuntime {
  ready = true;
  readonly supportsReadOnlyTasks = true;
  calls: { method: string; params: any }[] = [];
  nextThread = 1;
  nextTurn = 1;
  models: { id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: any[]; defaultReasoningEffort: null }[];

  constructor(models = [{ id: 'fake-default', displayName: 'Fake Model', isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null }]) {
    super();
    this.models = models;
  }

  detect() { return true; }
  async start() { this.ready = true; }
  async request(method: string, params: any = {}): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { email: 'author@example.com' }, requiresOpenaiAuth: false };
    if (method === 'model/list') return { data: this.models };
    if (method === 'account/rateLimits/read') return {};
    if (method === 'thread/start') return { thread: { id: `thread-${this.nextThread++}` }, model: params.model || this.models[0].id };
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: params.model || this.models[0].id };
    if (method === 'turn/start') return { turn: { id: `turn-${this.nextTurn++}` } };
    if (method === 'turn/interrupt') return {};
    return {};
  }
  respond() {}
  reject() {}
  close() {}
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-chatgpt-pro-'));
  const repo = path.join(dir, 'paper');
  const worktree = path.join(dir, 'worktree');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, 'paper.tex'), [
    '\\documentclass{article}',
    '\\begin{document}',
    'The effect is really small and needs clarification.',
    'Second sentence remains unchanged.',
    '\\end{document}',
    '',
  ].join('\n'));

  const store = new Store(path.join(dir, 'papilot.db'));
  const codex = new FakeRuntime([{ id: 'gpt-5.4', displayName: 'GPT-5.4', isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null }]);
  const claude = new FakeRuntime([{ id: 'claude-sonnet', displayName: 'Claude Sonnet', isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null }]);
  const published: string[] = [];

  const review: ReviewClient = {
    url: 'http://127.0.0.1:0',
    token: 'test',
    get: (async (route: string) => {
      if (route.includes('/feedback')) return { cursor: 0, feedback: [] };
      if (route.includes('/jobs/')) return { status: 'done', result: { state: 'reviewing', round: 1, counts: { pending: 1 } } };
      if (route.endsWith('/state')) return { task: route.split('/')[3], csrf: 'test', latest: 1, closed: false, decisions: {} };
      return { state: 'reviewing', round: 1, counts: { pending: 1 }, scope: { files: [] } };
    }) as ReviewClient['get'],
    post: (async (route: string, body?: any) => {
      if (route === '/api/tasks') return { task: body?.name || 'p-task', worktree, deferred: true, document: 'paper.tex' };
      if (route.endsWith('/publish')) { published.push(route); return { job: 'job-1' }; }
      if (route.endsWith('/finish')) return { task: route.split('/')[3], finished: true };
      return {};
    }) as ReviewClient['post'],
  };

  const workspace = new Workspace(store, codex, async () => review, { claude });
  for (const id of Object.keys(workspace.agents) as (keyof typeof workspace.agents)[]) {
    if (!['codex', 'claude', 'chatgpt'].includes(id)) {
      workspace.agents[id] = Object.assign(new EventEmitter(), {
        ready: false,
        detect: () => false,
        start: async () => {},
        request: async () => ({}),
        respond() {},
        reject() {},
        close() {},
      }) as AgentRuntime;
    }
  }
  const project = { id: 'paper-1', name: 'Paper', path: repo, createdAt: 1 };
  store.saveProject(project);

  return {
    dir, repo, worktree, store, codex, claude, workspace, project, published,
    async connect() {
      await workspace.connect();
    },
    close() {
      workspace.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('ChatGPT Pro (web) runs as a native manual task: claims annotations, waits for reply, and hands off to a local agent in the same task', async () => {
  const f = createFixture();
  try {
    await f.connect();
    assert.equal(f.workspace.snapshot().runtimes?.chatgpt?.hidden, true, 'Hidden until enabled in Experiments');

    f.workspace.setChatgptProEnabled(true);
    await tick();
    await f.workspace.refreshAgent('chatgpt');
    const runtime = f.workspace.snapshot().runtimes?.chatgpt;
    assert.ok(runtime);
    assert.equal(runtime.hidden, false);
    assert.equal(runtime.connected, true);
    assert.equal(runtime.authenticated, true);
    assert.equal(runtime.supportsReadOnlyTasks, false);

    // Save a PDF annotation on the manuscript.
    const note = f.store.saveAnnotation({
      id: 'note-1',
      projectId: f.project.id,
      key: 'pdf-v1',
      page: 0,
      rect: [0.1, 0.2, 0.5, 0.25],
      comment: 'Tighten the wording here.',
      quote: 'The effect is really small and needs clarification.',
      source: { file: 'paper.tex', lines: [3, 3], excerpt: 'The effect is really small and needs clarification.' },
      createdAt: 10,
    });

    // Create a normal task targeting ChatGPT Pro (web).
    const created = await f.workspace.createTask({
      id: 'chatgpt-task-00000001',
      projectId: f.project.id,
      title: 'Tighten the wording here',
      instructions: '',
      annotations: [note.id],
      agent: 'chatgpt',
    });
    assert.equal(created.agent, 'chatgpt');

    // Annotation is claimed immediately so it shows as in-flight on the manuscript.
    assert.equal(f.store.annotation(f.project.id, note.id).taskId, created.id);

    // Wait for background worktree preparation and drain().
    await (f.workspace as any).preparing.get(created.id);
    await tick();
    await tick();

    const waiting = f.store.task(created.id);
    assert.equal(waiting.status, 'waiting_input');
    assert.equal(waiting.manualTurn?.status, 'awaiting_reply');

    // Prompt contains the PDF annotation and the current LaTeX file from the worktree.
    const promptInfo = await f.workspace.manualPrompt(created.id);
    assert.equal(promptInfo.runId, waiting.manualTurn!.runId);
    assert.match(promptInfo.prompt, /Tighten the wording here\./);
    assert.match(promptInfo.prompt, /### `paper\.tex`/);
    assert.match(promptInfo.prompt, /The effect is really small and needs clarification\./);
    assert.equal(promptInfo.executor?.agent, 'codex');

    // Server restart recovery preserves the waiting manual turn.
    f.store.recover();
    assert.equal(f.store.task(created.id).status, 'waiting_input');
    assert.equal(f.store.task(created.id).manualTurn?.status, 'awaiting_reply');

    // Normal enqueue is blocked while awaiting Pro's reply.
    await assert.rejects(
      f.workspace.enqueue(created.id, 'Something else', 'extra-req', false),
      /Paste ChatGPT Pro’s reply or pause/,
    );

    // Paste free-form Markdown advice from ChatGPT Pro — no rigid JSON required.
    const proReply = 'Replace "really small and needs clarification" with "modest; see Table 1 for details."';
    const afterReply = f.workspace.submitManualReply(created.id, proReply, 'reply-key-1');
    assert.equal(afterReply.manualTurn?.status, 'implementing');
    assert.equal(afterReply.manualTurn?.executor?.agent, 'codex');

    // Retrying with the same requestKey is idempotent and does not duplicate Pro's message.
    f.workspace.submitManualReply(created.id, proReply, 'reply-key-1');

    // Wait for Codex startRun to dispatch thread/start + turn/start.
    await tick();
    await tick();
    const items = f.store.items(created.id);
    const proMessages = items.filter(item => item.type === 'assistant' && item.meta?.advisor === 'ChatGPT Pro');
    assert.equal(proMessages.length, 1);
    assert.equal(proMessages[0].text, proReply);

    const turnStart = f.codex.calls.find(call => call.method === 'turn/start' && call.params.clientUserMessageId);
    assert.ok(turnStart, 'Local executor started a turn on the same task');
    const promptSentToCodex = turnStart.params.input[0].text as string;
    assert.match(promptSentToCodex, /Tighten the wording here\./);
    assert.match(promptSentToCodex, /modest; see Table 1 for details\./);

    // Complete Codex's implementation turn.
    const runningTask = f.store.task(created.id);
    assert.equal(runningTask.status, 'running');
    assert.ok(runningTask.threadId && runningTask.turnId);
    f.codex.emit('notification', {
      method: 'item/completed',
      params: { threadId: runningTask.threadId, turnId: runningTask.turnId, item: { id: 'msg-1', type: 'agentMessage', text: 'Updated paper.tex as suggested.' } },
    });
    f.codex.emit('notification', {
      method: 'turn/completed',
      params: { threadId: runningTask.threadId, turnId: runningTask.turnId, turn: { id: runningTask.turnId, status: 'completed' } },
    });
    await tick();
    await tick();

    const finished = f.store.task(created.id);
    assert.equal(finished.manualTurn, null);
    assert.equal(finished.agent, 'chatgpt', 'Task stays on ChatGPT Pro for follow-up turns');
    assert.equal(finished.manualExecutor?.agent, 'codex');
    assert.ok(f.published.length >= 1, 'Normal PDF comparison publication was triggered');
  } finally {
    f.close();
  }
});

test('explicit local executor choice, pause, switch agent, and delete work cleanly for manual tasks', async () => {
  const f = createFixture();
  try {
    await f.connect();
    f.workspace.setChatgptProEnabled(true);
    await f.workspace.refreshAgent('chatgpt');
    f.workspace.setChatgptProExecutor({ agent: 'claude', model: 'claude-sonnet' });

    const created = await f.workspace.createTask({
      id: 'chatgpt-task-00000002',
      projectId: f.project.id,
      title: 'Polish introduction',
      instructions: 'Improve clarity of the opening paragraph.',
      agent: 'chatgpt',
    });
    await (f.workspace as any).preparing.get(created.id);
    await tick();
    await tick();

    assert.equal((await f.workspace.manualPrompt(created.id)).executor?.agent, 'claude');

    // Per-reply executor override can switch away from Settings default right on submit (and rejects manual/collaboration).
    assert.throws(
      () => f.workspace.submitManualReply(created.id, 'Reply', 'bad-exec', { agent: 'chatgpt' }),
      /Choose a local agent/,
    );
    const overridden = f.workspace.submitManualReply(created.id, 'Apply this edit with Codex.', 'override-1', { agent: 'codex', model: 'gpt-5.4', effort: 'high' });
    assert.equal(overridden.manualTurn?.executor?.agent, 'codex');
    assert.equal(overridden.manualTurn?.executor?.effort, null, 'Unsupported effort is stripped for models with efforts: []');
    assert.equal(overridden.manualExecutor?.agent, 'codex');
    await tick();
    await tick();
    const codexRunning = f.store.task(created.id);
    f.codex.emit('notification', { method: 'turn/completed', params: { threadId: codexRunning.threadId, turnId: codexRunning.turnId, turn: { id: codexRunning.turnId, status: 'completed' } } });
    for (let i = 0; i < 20 && f.store.task(created.id).status !== 'reviewing'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.store.task(created.id).status, 'reviewing');

    // Follow-up turn remembers the task's last local executor (Codex) cleanly.
    await f.workspace.enqueue(created.id, 'Tighten the conclusion too.', 'followup-0', false);
    for (let i = 0; i < 20 && f.store.task(created.id).status !== 'waiting_input'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await f.workspace.manualPrompt(created.id)).executor?.agent, 'codex');

    // Switching local executor on a follow-up turn (Codex -> Claude) resets threadId and marks handoff.
    const switchedExec = f.workspace.submitManualReply(created.id, 'Now apply conclusion with Claude.', 'override-2', { agent: 'claude', model: 'claude-sonnet' });
    assert.equal(switchedExec.manualTurn?.executor?.agent, 'claude');
    assert.equal(switchedExec.handoff, true);
    assert.equal(switchedExec.threadId, null);
    await tick();
    await tick();
    const claudeRunning = f.store.task(created.id);
    f.claude.emit('notification', { method: 'turn/completed', params: { threadId: claudeRunning.threadId, turnId: claudeRunning.turnId, turn: { id: claudeRunning.turnId, status: 'completed' } } });
    for (let i = 0; i < 20 && f.store.task(created.id).status !== 'reviewing'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await f.workspace.enqueue(created.id, 'One more quick pass.', 'followup-0b', false);
    for (let i = 0; i < 20 && f.store.task(created.id).status !== 'waiting_input'; i++) await new Promise(resolve => setTimeout(resolve, 10));

    // Pause cancels waiting_input cleanly.
    await f.workspace.interrupt(created.id);
    assert.equal(f.store.task(created.id).status, 'interrupted');
    assert.equal(f.store.task(created.id).manualTurn, null);

    // Follow-up message enters awaiting_reply again.
    await f.workspace.enqueue(created.id, 'Actually shorten it to one sentence.', 'followup-1', false);
    await tick();
    await tick();
    assert.equal(f.store.task(created.id).status, 'waiting_input');
    assert.equal(f.store.task(created.id).manualTurn?.status, 'awaiting_reply');

    // Switching agents away from ChatGPT Pro while waiting stops the manual turn cleanly and clears cached prompt.
    const switched = await f.workspace.switchTaskAgent(created.id, { agent: 'codex', model: 'gpt-5.4', stop: true });
    assert.equal(switched.agent, 'codex');
    assert.equal(switched.manualTurn, null);
    assert.equal(switched.status, 'interrupted');
    assert.equal(f.store.preference(`manual-prompt:${created.id}`), undefined);

    // Strict conflict-resolution helper rejects manual agents instead of silently falling back.
    assert.throws(() => (f.workspace as any).helper({ agent: 'chatgpt' }, 'resolve merge conflicts', { strict: 'conflict-resolution' }), /unavailable/i);

    // Deleting a waiting manual task succeeds without needing a separate pause.
    const toDelete = await f.workspace.createTask({
      id: 'chatgpt-task-00000003',
      projectId: f.project.id,
      title: 'Temporary manual task',
      instructions: 'Check notation.',
      agent: 'chatgpt',
    });
    await (f.workspace as any).preparing.get(toDelete.id);
    await tick();
    await tick();
    assert.equal(f.store.task(toDelete.id).status, 'waiting_input');
    await f.workspace.deleteTask(toDelete.id);
    assert.equal(f.store.findTask(toDelete.id), undefined);
    assert.equal(f.store.preference(`manual-prompt:${toDelete.id}`), undefined);
  } finally {
    f.close();
  }
});

test('buildManualPrompt extracts bounded line windows for large files and blocks path traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-manual-prompt-'));
  const dir = path.join(root, 'wt');
  fs.mkdirSync(dir);
  try {
    const lines = Array.from({ length: 2200 }, (_, i) => `% Line ${i + 1}: ` + 'x'.repeat(35));
    lines[499] = 'Target theorem statement on line 500.';
    fs.writeFileSync(path.join(dir, 'big.tex'), lines.join('\n'));
    const outside = path.join(root, 'secret.txt');
    fs.writeFileSync(outside, 'TOP SECRET');
    try { fs.symlinkSync(outside, path.join(dir, 'link.tex')); } catch { /* Windows without symlink privileges */ }

    const task = { id: 't1', projectId: 'p1', name: 'p-t1', title: 'Big', instructions: '', worktree: dir, document: 'big.tex', threadId: null, turnId: null, agent: 'chatgpt', model: 'chatgpt-pro', effort: null, status: 'waiting_input', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null } as Task;
    const run = { id: 'r1', taskId: 't1', requestKey: 'k1', prompt: 'Fix theorem 1.', status: 'running', createdAt: 2, finishedAt: null } as Run;
    const items: TimelineItem[] = [{
      id: 'r1', taskId: 't1', type: 'user', text: 'Fix theorem 1.', createdAt: 2,
      meta: {
        notes: [
          {
            where: 'Page 5 · big.tex line 500',
            quote: 'Target theorem',
            comment: 'Verify proof.',
            anchor: {
              sources: [
                { file: 'big.tex', lines: [500, 500] },
                { file: 'big.tex', lines: [9999, 9000] },
                { file: '../secret.txt', lines: [1, 1] },
                { file: 'link.tex', lines: [1, 1] },
              ],
            },
          },
        ],
      },
    }];

    const prompt = buildManualPrompt(dir, task, run, items);
    assert.match(prompt, /### `big\.tex` \(excerpts\)/);
    assert.match(prompt, /500: Target theorem statement on line 500\./);
    assert.doesNotMatch(prompt, /TOP SECRET/);
    assert.doesNotMatch(prompt, /Lines 9/);
    assert.ok(prompt.length < 15_000, 'Large files are windowed around annotated lines');

    // Missing worktree directory returns a prompt without throwing ENOENT.
    const missingPrompt = buildManualPrompt(path.join(dir, 'does-not-exist'), task, run, items);
    assert.match(missingPrompt, /Fix theorem 1\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GitHub context reuses pushed remote branch, pushes snapshot commits without touching worktree HEAD, and keeps GitHub prompts concise', async () => {
  assert.equal(parseGithubRepository('git@github.com:acme/quantum-paper.git'), 'acme/quantum-paper');
  assert.equal(parseGithubRepository('https://github.com/acme/quantum-paper.git'), 'acme/quantum-paper');
  assert.equal(parseGithubRepository('https://gitlab.com/acme/quantum-paper.git'), null);
  assert.equal(parseGithubRepository('https://github.com:8443/acme/quantum-paper.git'), null);
  assert.equal(parseGithubRepository('git@github.com:acme/..'), null);
  assert.equal(manualGithubBranch('a..b.lock'), 'papilot-pro/a-b');
  assert.equal(manualGithubBranch('foo.lock.'), 'papilot-pro/foo');
  assert.equal(manualGithubBranch('x'.repeat(47) + '.tail'), 'papilot-pro/' + 'x'.repeat(47));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-manual-github-'));
  const bare = path.join(root, 'remote.git');
  const worktree = path.join(root, 'paper');
  const git = (cwd: string, args: string[]) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();

  try {
    fs.mkdirSync(bare);
    fs.mkdirSync(worktree);
    git(bare, ['init', '--bare', '-b', 'main']);
    git(worktree, ['init', '-b', 'main']);
    fs.mkdirSync(path.join(worktree, 'sections'));
    fs.writeFileSync(path.join(worktree, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n');
    fs.writeFileSync(path.join(worktree, 'sections/intro.tex'), 'Original introduction text.\n');
    git(worktree, ['add', '.']);
    git(worktree, ['commit', '-m', 'Initial manuscript']);
    git(worktree, ['remote', 'add', 'origin', bare]);
    git(worktree, ['push', '-u', 'origin', 'main']);

    // Local fallback automatically includes \input{sections/intro} for richer multi-file context.
    const task = { id: 't-gh', projectId: 'p1', name: 'p-gh1', title: 'Revise intro', instructions: '', worktree, document: 'main.tex', threadId: null, turnId: null, agent: 'chatgpt', model: 'chatgpt-pro', effort: null, status: 'waiting_input', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null } as Task;
    const run = { id: 'r-gh', taskId: 't-gh', requestKey: 'k-gh', prompt: 'Clarify Theorem 1.', status: 'running', createdAt: 2, finishedAt: null } as Run;
    const items: TimelineItem[] = [{
      id: 'r-gh', taskId: 't-gh', type: 'user', text: 'Clarify Theorem 1.', createdAt: 2,
      meta: { notes: [{ where: 'Page 1 · sections/intro.tex line 1', quote: 'Original introduction', comment: 'Expand motivation.', anchor: { sources: [{ file: 'sections/intro.tex', lines: [1, 1] }] } }] },
    }];
    const localPrompt = buildManualPrompt(worktree, task, run, items, { repoFiles: ['main.tex', 'sections/intro.tex'] });
    assert.match(localPrompt, /### `main\.tex`/);
    assert.match(localPrompt, /### `sections\/intro\.tex`/);

    // Reusable remote detection succeeds when worktree is clean and matches origin/main.
    const fakeGithubRemote = { name: 'origin', repository: 'acme/quantum-paper', url: 'https://github.com/acme/quantum-paper' };
    // Untracked files inside a .papilot-* scratch directory do not mark the worktree dirty or appear in repoFiles.
    fs.mkdirSync(path.join(worktree, '.papilot-cache'));
    fs.writeFileSync(path.join(worktree, '.papilot-cache/scratch.tex'), 'scratch');
    const reused = await detectReusableRemoteBranch(worktree, fakeGithubRemote);
    assert.ok(reused);
    assert.equal(reused.reusedRemote, true);
    assert.equal(reused.branch, 'main');
    assert.equal(reused.url, 'https://github.com/acme/quantum-paper/tree/main');
    fs.rmSync(path.join(worktree, '.papilot-cache'), { recursive: true, force: true });

    // Staged rename of a tracked file into .papilot-tmp still marks the worktree dirty.
    git(worktree, ['mv', 'main.tex', '.papilot-tmp']);
    assert.equal(await detectReusableRemoteBranch(worktree, fakeGithubRemote), null);
    git(worktree, ['mv', '.papilot-tmp', 'main.tex']);

    // Local edits trigger a snapshot commit pushed to papilot-pro/<task> without altering worktree HEAD or status!
    const headBefore = git(worktree, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(worktree, 'sections/intro.tex'), 'Updated local draft text.\n');
    assert.equal(await detectReusableRemoteBranch(worktree, fakeGithubRemote), null);

    const synced = await syncWorktreeToGithub(worktree, task.name, fakeGithubRemote);
    assert.equal(synced.reusedRemote, false);
    assert.equal(synced.branch, manualGithubBranch(task.name));
    assert.notEqual(synced.commit, headBefore);
    assert.equal(git(worktree, ['rev-parse', 'HEAD']), headBefore, 'Worktree HEAD is untouched');
    assert.match(git(worktree, ['status', '--porcelain']), /M sections\/intro\.tex/, 'Worktree dirty state is untouched');
    assert.equal(git(bare, ['show', `${synced.branch}:sections/intro.tex`]), 'Updated local draft text.');

    // GitHub-backed prompt points ChatGPT Pro to the synced repo/branch/commit and omits inline source dumps.
    const ghPrompt = buildManualPrompt(worktree, task, run, items, { github: synced, repoFiles: ['main.tex', 'sections/intro.tex'] });
    assert.match(ghPrompt, /acme\/quantum-paper/);
    assert.match(ghPrompt, new RegExp(synced.branch));
    assert.match(ghPrompt, new RegExp(synced.commit.slice(0, 12)));
    assert.match(ghPrompt, /sections\/intro\.tex` \(L1\)/);
    assert.match(ghPrompt, /Manuscript files in repository:/);
    assert.doesNotMatch(ghPrompt, /## Current LaTeX source/);
    assert.doesNotMatch(ghPrompt, /Updated local draft text\./);

    // githubRemotes detects real GitHub remote URLs and ignores non-GitHub remotes.
    git(worktree, ['remote', 'set-url', 'origin', 'https://github.com/acme/quantum-paper.git']);
    git(worktree, ['remote', 'add', 'overleaf', 'https://git.overleaf.com/123456']);
    const detected = await githubRemotes(worktree);
    assert.deepEqual(detected, [{ name: 'origin', repository: 'acme/quantum-paper', url: 'https://github.com/acme/quantum-paper' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
