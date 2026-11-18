import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { WORKFLOW_TOOLS, auditWorkflow, delegateWorkflow as delegateTo, sourceEvidence, workflowInstructions, workflowItem, workflowNotes, workflowRequests, workflowSnapshot, runWorkflowHelper, workflowOpenCodeConfig, workflowOpenCodeProfile, type WorkflowGenerate, type WorkflowWorker } from '../src/server/collaboration.ts';
import { offeredAgents, noAgent, chosenAgent } from '../src/web/agent-choice.ts';
import { AGENT_IDS, collaborationRoutes, validRoutes, type CollaborationRole, type CollaborationRoutes, type RuntimeStatus } from '../src/shared.ts';

function paper() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workflow-test-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init'); fs.writeFileSync(path.join(root, 'main.tex'), 'First paragraph.\n\nSecond paragraph.\n'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Base');
  return { root, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const notes = workflowNotes([{ id: 'message', meta: { notes: [{ where: 'main.tex', quote: 'First', comment: 'Polish first.' }, { where: 'main.tex', quote: 'Second', comment: 'Check second.' }] } }], 'Edit');
const signal = () => new AbortController().signal;
const routes: CollaborationRoutes = {
  quick: { agent: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: 'max' },
  polish: { agent: 'antigravity', model: 'gemini-4-argon', effort: 'high' },
  rigorous: { agent: 'codex', model: 'task-codex-model', effort: 'xhigh' },
};
const auditor: WorkflowWorker = { agent: 'codex', model: 'task-codex-model', effort: 'high' };
const delegateWorkflow = (root: string, list: typeof notes, args: any, generate: WorkflowGenerate, abort: AbortSignal, current: () => boolean = () => true) =>
  delegateTo(root, list, args, generate, abort, current, (role: CollaborationRole) => routes[role]);
const outcomes = () => notes.map(note => ({ id: note.id, status: 'unchanged', explanation: 'Already correct.', evidence: [{ file: 'main.tex', quote: note.quote }] }));
const verified: WorkflowGenerate = async (_worker, prompt) => {
  const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  return JSON.stringify({ verified: true, outcomes: data.outcomes.map((entry: any) => ({ id: entry.id, status: entry.status, reason: 'Checked the source.' })), issues: [] });
};

test('workflow choices require explicit host enablement, even for saved selections', () => {
  const ready: RuntimeStatus = { connected: true, authenticated: true, models: [], account: null, error: null };
  assert.deepEqual(offeredAgents({ codex: ready, collaboration: ready }), ['codex']);
  assert.deepEqual(offeredAgents({ codex: ready, collaboration: { ...ready, hidden: false } }), ['codex', 'collaboration']);
  assert.equal(chosenAgent('collaboration', offeredAgents({ codex: ready, collaboration: { ...ready, hidden: true } }), { codex: ready }), 'codex');
  assert.equal(noAgent(Object.fromEntries(AGENT_IDS.filter(id => id !== 'collaboration').map(id => [id, { ...ready, installed: false }]))), true);
});
test('timeline entries name the role, worker, notes and outcome instead of the raw reply', () => {
  const reply = { role: 'quick', worker: 'OpenCode (flash, max reasoning effort)', status: 'applied', appliedFiles: ['main.tex'], conflicts: [], summary: 'Fixed the typo.' };
  const delegate = workflowItem({ tool: 'workflow_delegate', arguments: { role: 'quick', annotationIds: ['message:1', 'message:3'] }, contentItems: [{ text: JSON.stringify(reply) }] });
  assert.equal(delegate.text, 'workflow_delegate · quick');
  assert.equal(delegate.detail, 'OpenCode (flash, max reasoning effort)\nNotes: 1, 3\nResult: applied (main.tex)', 'the worker\'s own report is among its steps');
  const failed = workflowItem({ tool: 'workflow_delegate', arguments: { role: 'polish', annotationIds: ['message:2'], instruction: 'Polish.' }, contentItems: [{ text: 'Antigravity does not offer gemini-x on the Papilot host.' }] });
  assert.equal(failed.detail, 'Notes: 2\nPolish.\nAntigravity does not offer gemini-x on the Papilot host.');
  // While it runs, the line already names the configured worker and what it was asked.
  const running = workflowItem({ tool: 'workflow_delegate', arguments: { role: 'rigorous', annotationIds: ['message:2'], instruction: 'Check the sum.' } }, role => `Codex (${role})`);
  assert.equal(running.detail, 'Codex (rigorous)\nNotes: 2\nCheck the sum.');
  assert.match(workflowItem({ tool: 'workflow_audit', arguments: { outcomes: [{}, {}] }, contentItems: [{ text: JSON.stringify({ verified: true, report: '{}' }) }] }).detail!, /^Verified\./);
});
test('the ledger carries color-group directions and the author\'s own requests to workers and the audit', async () => {
  const items = [
    { id: 'm1', type: 'user', text: 'Generated prompt with every note.', meta: { notes: [{ where: 'main.tex', quote: 'First', comment: '', group: 'red' as const }, { where: 'main.tex', quote: 'Second', comment: 'Check second.' }], groupInstructions: { red: 'Translate the red passages into French.' }, request: 'Keep British spelling.' } },
    { id: 'reply', type: 'assistant', text: 'Done.' },
    { id: 'm2', type: 'user', text: 'Also shorten the abstract.' },
  ];
  const ledger = workflowNotes(items, 'Also shorten the abstract.');
  assert.equal(ledger[0].instruction, 'Translate the red passages into French.'); assert.equal(ledger[1].instruction, undefined);
  const requests = workflowRequests(items);
  assert.deepEqual(requests, [{ message: 'm1', text: 'Keep British spelling.' }, { message: 'm2', text: 'Also shorten the abstract.' }], 'not the generated prompt, and not dropped beside notes');
  const f = paper();
  try {
    let audited: any, delegated: any;
    await delegateTo(f.root, ledger, { ...delegateArgs, annotationIds: ['m1:1'] }, async (_worker, prompt, _signal, edit) => { delegated = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); fs.writeFileSync(path.join(edit!.cwd, 'main.tex'), 'Premier paragraphe.\n\nSecond paragraph.\n'); return 'Translated.'; }, signal(), () => true, role => routes[role]);
    assert.equal(delegated.annotations[0].instruction, 'Translate the red passages into French.', 'the worker sees its group direction');
    const outcomes = ledger.map(note => ({ id: note.id, status: 'addressed', explanation: 'Done.', evidence: [{ file: 'main.tex', quote: 'paragraph' }] }));
    await auditWorkflow(f.root, ledger, { outcomes }, async (worker, prompt, signal) => { audited = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); return verified(worker, prompt, signal); }, signal(), auditor, requests);
    assert.deepEqual(audited.requests, requests); assert.equal(audited.annotations[0].instruction, 'Translate the red passages into French.');
  } finally { f.close(); }
});
test('annotation ledger retains repeated notes separately and provides a request for plain tasks', () => {
  assert.deepEqual(notes.map(note => note.id), ['message:1', 'message:2']);
  assert.equal(workflowNotes([], 'Explain')[0].comment, 'Explain');
});
test('parallel edits to different words in the same line are merged by the program', async () => {
  const f = paper(), releases: (() => void)[] = [], copies: string[] = [];
  const original = 'First paragraph. Second paragraph. Existing uncommitted text.\n';
  fs.writeFileSync(path.join(f.root, 'main.tex'), original);
  const generate: WorkflowGenerate = async (worker, _prompt, _signal, edit) => {
    assert.ok(edit); copies.push(edit.cwd); assert.deepEqual(edit.files, ['main.tex']);
    const file = path.join(edit.cwd, 'main.tex'), quick = worker.agent === 'opencode';
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(quick ? 'First' : 'Second', quick ? 'Updated first' : 'Updated second'));
    await new Promise<void>(resolve => releases.push(resolve)); return 'Edited the assigned annotation.';
  };
  try {
    const jobs = notes.map((note, i) => delegateWorkflow(f.root, notes, { role: i ? 'polish' : 'quick', annotationIds: [note.id], instruction: note.comment, sources: [{ file: 'main.tex', quote: note.quote }] }, generate, signal()));
    assert.equal(releases.length, 2); assert.notEqual(copies[0], copies[1]);
    assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), original);
    releases.forEach(release => release());
    const replies = await Promise.all(jobs); assert.ok(replies.every(reply => reply.status === 'applied'));
    assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), 'Updated first paragraph. Updated second paragraph. Existing uncommitted text.\n');
    assert.ok(copies.every(copy => !fs.existsSync(copy)));
    await assert.rejects(delegateWorkflow(f.root, notes, { role: 'quick', annotationIds: ['unknown'] }, generate, signal()), /Unknown/);
    await assert.rejects(delegateWorkflow(f.root, notes, { role: 'quick', annotationIds: [notes[0].id], instruction: 'Edit', sources: [{ file: 'main.tex', quote: 'stale source' }] }, generate, signal()), /no longer matches/);
  } finally { f.close(); }
});
const delegateArgs = { role: 'polish', annotationIds: [notes[0].id], instruction: 'Edit first.', sources: [{ file: 'main.tex', quote: 'First' }] };
test('every role uses the same isolated merge route with its configured worker', async () => {
  assert.deepEqual((WORKFLOW_TOOLS[0].inputSchema.properties as { role: { enum: string[] } }).role.enum, ['quick', 'polish', 'rigorous']);
  for (const role of ['rigorous', 'polish', 'quick'] as CollaborationRole[]) {
    const f = paper(); let copy = '';
    try {
      const result = await delegateWorkflow(f.root, notes, { ...delegateArgs, role }, async (worker, _prompt, _signal, edit) => {
        assert.deepEqual(worker, routes[role]);
        assert.ok(edit); copy = edit.cwd; assert.notEqual(copy, fs.realpathSync(f.root));
        assert.equal(copy, fs.realpathSync.native(copy), 'workers use the native path identity, including Windows short-name expansion');
        const file = path.join(copy, 'main.tex'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('First', 'Checked'));
        assert.match(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), /^First/); return 'Checked the annotation.';
      }, signal());
      assert.equal(result.role, role); assert.match(result.worker, new RegExp(routes[role].model!)); assert.equal(result.status, 'applied'); assert.deepEqual(result.appliedFiles, ['main.tex']);
      assert.match(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), /^Checked/); assert.equal(fs.existsSync(copy), false);
    } finally { f.close(); }
  }
});
test('duplicate source excerpts share one snapshot file and case aliases cannot overwrite it', async () => {
  const f = paper();
  try {
    let called = false;
    const generate: WorkflowGenerate = async (_w, _p, _s, edit) => { called = true; assert.deepEqual(edit!.files, ['main.tex']); return 'Unchanged'; };
    await delegateWorkflow(f.root, notes, { ...delegateArgs, sources: [{ file: 'main.tex', quote: 'First' }, { file: './main.tex', quote: 'Second' }] }, generate, signal());
    assert.equal(called, true); called = false;
    if (fs.existsSync(path.join(f.root, 'MAIN.TEX'))) {
      await assert.rejects(delegateWorkflow(f.root, notes, { ...delegateArgs, sources: [{ file: 'main.tex', quote: 'First' }, { file: 'MAIN.TEX', quote: 'First' }] }, generate, signal()), /selected source files/);
      assert.equal(called, false);
    }
  } finally { f.close(); }
});
test('overlapping edits return a conflict without overwriting the first integrated edit', async () => {
  const f = paper(), releases: (() => void)[] = [];
  let calls = 0;
  const generate: WorkflowGenerate = async (_worker, _prompt, _signal, edit) => {
    const file = path.join(edit!.cwd, 'main.tex');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('First', calls++ ? 'Overlapping' : 'Integrated'));
    await new Promise<void>(resolve => releases.push(resolve)); return 'Done';
  };
  try {
    const first = delegateWorkflow(f.root, notes, delegateArgs, generate, signal()), second = delegateWorkflow(f.root, notes, delegateArgs, generate, signal());
    releases[0](); assert.equal((await first).status, 'applied');
    releases[1](); const result = await second;
    assert.equal(result.status, 'conflict'); assert.deepEqual(result.appliedFiles, []);
    assert.match(result.conflicts[0].incoming, /Overlapping/); assert.match(result.conflicts[0].current!, /Integrated/);
    assert.match(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), /^Integrated/);
    assert.doesNotMatch(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), /<<<<<<|Overlapping/);
  } finally { f.close(); }
});
test('coordinator edits made while a worker runs are retained by three-way merge', async () => {
  const f = paper();
  try {
    const result = await delegateWorkflow(f.root, notes, delegateArgs, async (_w, _p, _s, edit) => {
      const file = path.join(edit!.cwd, 'main.tex'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('First', 'Improved'));
      fs.appendFileSync(path.join(f.root, 'main.tex'), 'New coordinator text.\n'); return 'Edited';
    }, signal());
    assert.equal(result.status, 'applied'); assert.match(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), /^Improved[\s\S]*New coordinator text/);
  } finally { f.close(); }
});
test('source changes and cancellation during asynchronous merging prevent stale writes', async () => {
  for (const operation of ['edit', 'cancel']) {
    const f = paper(), controller = new AbortController(), mkdtemp = fs.promises.mkdtemp;
    const current = 'First paragraph.\n\nUpdated coordinator paragraph.\n', latest = current + 'Newer edit.\n';
    try {
      fs.promises.mkdtemp = (async (...args: Parameters<typeof mkdtemp>) => {
        if (String(args[0]).includes('papilot-merge-')) {
          if (operation === 'edit') fs.writeFileSync(path.join(f.root, 'main.tex'), latest); else controller.abort();
        }
        return mkdtemp(...args);
      }) as typeof mkdtemp;
      await assert.rejects(delegateWorkflow(f.root, notes, delegateArgs, async (_w, _p, _s, edit) => {
        const file = path.join(edit!.cwd, 'main.tex'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('First', 'Improved'));
        fs.writeFileSync(path.join(f.root, 'main.tex'), current); return 'Edited';
      }, controller.signal));
      assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), operation === 'edit' ? latest : current);
    } finally { fs.promises.mkdtemp = mkdtemp; f.close(); }
  }
});
test('clean files are applied while conflicted files and deleted targets are retained', async () => {
  const f = paper(); fs.writeFileSync(path.join(f.root, 'other.tex'), 'Other text.');
  try {
    const result = await delegateWorkflow(f.root, notes, { ...delegateArgs, sources: [...delegateArgs.sources, { file: 'other.tex', quote: 'Other' }] }, async (_w, _p, _s, edit) => {
      fs.writeFileSync(path.join(edit!.cwd, 'main.tex'), 'Worker version.'); fs.writeFileSync(path.join(edit!.cwd, 'other.tex'), 'Improved other text.');
      fs.unlinkSync(path.join(f.root, 'main.tex')); return 'Edited both.';
    }, signal());
    assert.equal(result.status, 'conflict'); assert.deepEqual(result.appliedFiles, ['other.tex']); assert.equal(result.conflicts[0].current, null);
    assert.equal(fs.existsSync(path.join(f.root, 'main.tex')), false); assert.equal(fs.readFileSync(path.join(f.root, 'other.tex'), 'utf8'), 'Improved other text.');
  } finally { f.close(); }
});
test('a failed atomic replacement rolls back files already integrated by the same delegate', async () => {
  const f = paper(); fs.writeFileSync(path.join(f.root, 'other.tex'), 'Other text.');
  const before = fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (String(to) === path.join(fs.realpathSync(f.root), 'other.tex')) throw new Error('Simulated write failure'); return rename(from, to); };
    await assert.rejects(delegateWorkflow(f.root, notes, { ...delegateArgs, sources: [...delegateArgs.sources, { file: 'other.tex', quote: 'Other' }] }, async (_w, _p, _s, edit) => {
      fs.writeFileSync(path.join(edit!.cwd, 'main.tex'), 'Improved.'); fs.writeFileSync(path.join(edit!.cwd, 'other.tex'), 'Improved other.'); return 'Edited both.';
    }, signal()), /Simulated write failure/);
    assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), before); assert.equal(fs.readFileSync(path.join(f.root, 'other.tex'), 'utf8'), 'Other text.');
  } finally { fs.renameSync = rename; f.close(); }
});
test('OpenCode editing rules allow only selected files and keep unrelated native actions denied', () => {
  const config = JSON.parse(workflowOpenCodeConfig({ cwd: '/isolated', files: ['main.tex'] }));
  const rules = config.agents['papilot-default'].permissions;
  const effect = (action: string, resource: string) => rules.filter((rule: any) => (rule.action === '*' || rule.action === action) && (rule.resource === '*' || rule.resource === resource)).at(-1)?.effect;
  for (const file of ['main.tex', '/isolated/main.tex']) for (const action of ['read', 'edit']) assert.equal(effect(action, file), 'allow');
  for (const [action, resource] of [['edit', '../other.tex'], ['edit', 'new.tex'], ['shell', 'git status'], ['subagent', 'helper'], ['webfetch', 'https://example.com']]) assert.equal(effect(action, resource), 'deny');
  assert.equal(config.agent['papilot-default'].permission.edit['*'], 'deny');
  assert.equal(config.agent['papilot-default'].permission.edit['main.tex'], 'allow');
});
test('OpenCode workers retain host provider configuration while replacing permissions', () => {
  const previous = process.env.OPENCODE_CONFIG_CONTENT;
  const own = {
    provider: { custom: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://example.invalid/v1' }, models: { manuscript: { name: 'Manuscript model' } } } },
    model: 'custom/manuscript', permission: 'allow', permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    agent: { 'papilot-default': { permission: 'allow' } }, agents: { 'papilot-default': { permissions: [{ action: '*', resource: '*', effect: 'allow' }] } },
  };
  try {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(own);
    const edit = { cwd: '/isolated', files: ['main.tex'] };
    const config = JSON.parse(workflowOpenCodeProfile(edit).env!().OPENCODE_CONFIG_CONTENT!);
    assert.deepEqual(config.provider, own.provider);
    assert.equal(config.model, own.model);
    const scoped = JSON.parse(workflowOpenCodeConfig(edit));
    for (const key of ['permission', 'permissions', 'agent', 'agents']) assert.deepEqual(config[key], scoped[key], `${key} must retain worker isolation`);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT = previous;
  }
});
test('cancelled and stale runs never integrate late edits', async () => {
  for (const mode of ['cancel', 'stale']) {
    const f = paper(), controller = new AbortController(); let current = true, copy = '';
    const before = fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8');
    try {
      await assert.rejects(delegateWorkflow(f.root, notes, delegateArgs, async (_w, _p, _s, edit) => {
        copy = edit!.cwd; fs.writeFileSync(path.join(copy, 'main.tex'), 'Late edit.');
        if (mode === 'cancel') controller.abort(); else current = false;
        return 'Edited';
      }, controller.signal, () => current));
      assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), before); assert.equal(fs.existsSync(copy), false);
    } finally { f.close(); }
  }
});
test('workers cannot integrate extra files, deleted files or symlink outputs', async () => {
  for (const mode of ['extra', 'deleted', 'symlink']) {
    const f = paper(), before = fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8');
    try {
      await assert.rejects(delegateWorkflow(f.root, notes, delegateArgs, async (_w, _p, _s, edit) => {
        const file = path.join(edit!.cwd, 'main.tex');
        if (mode === 'extra') fs.writeFileSync(path.join(edit!.cwd, 'other.tex'), 'Out of scope');
        else { fs.unlinkSync(file); if (mode === 'symlink') fs.symlinkSync(path.join(f.root, 'main.tex'), file); }
        return 'Edited';
      }, signal()));
      assert.equal(fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8'), before); assert.equal(fs.existsSync(path.join(f.root, 'other.tex')), false);
    } finally { f.close(); }
  }
});
test('a task source replaced by a symlink during delegation cannot be overwritten', async () => {
  const f = paper(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-worker-outside-'));
  fs.writeFileSync(path.join(outside, 'other.tex'), 'Protected');
  try {
    await assert.rejects(delegateWorkflow(f.root, notes, delegateArgs, async (_w, _p, _s, edit) => {
      fs.writeFileSync(path.join(edit!.cwd, 'main.tex'), 'Worker edit');
      fs.unlinkSync(path.join(f.root, 'main.tex')); fs.symlinkSync(path.join(outside, 'other.tex'), path.join(f.root, 'main.tex')); return 'Edited';
    }, signal()), /selected source files/);
    assert.equal(fs.readFileSync(path.join(outside, 'other.tex'), 'utf8'), 'Protected');
  } finally { f.close(); fs.rmSync(outside, { recursive: true, force: true }); }
});
test('evidence rejects path escapes, symlinks and stale text', () => {
  const f = paper(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret'), 'Secret'); fs.symlinkSync(outside, path.join(f.root, 'link'));
    for (const file of ['../secret', path.join(outside, 'secret'), 'link/secret', '.git/config']) assert.throws(() => sourceEvidence(f.root, [{ file, quote: 'Secret' }]), /inside this task/);
  } finally { f.close(); fs.rmSync(outside, { recursive: true, force: true }); }
});
test('audit enforces exact coverage and independent verification, including unresolved notes', async () => {
  const f = paper();
  try {
    await assert.rejects(auditWorkflow(f.root, notes, { outcomes: outcomes().slice(0, 1) }, verified, signal(), auditor), /every annotation/);
    await assert.rejects(auditWorkflow(f.root, notes, { outcomes: [outcomes()[0], outcomes()[0]] }, verified, signal(), auditor), /exactly once/);
    await assert.rejects(auditWorkflow(f.root, notes, { outcomes: outcomes().map(entry => ({ ...entry, evidence: [] })) }, verified, signal(), auditor), /source evidence/);
    const result = await auditWorkflow(f.root, notes, { outcomes: outcomes() }, verified, signal(), auditor); assert.equal(result.verified, true);
    fs.appendFileSync(path.join(f.root, 'main.tex'), 'Later edit.'); assert.notEqual((await workflowSnapshot(f.root)).fingerprint, result.fingerprint);
    const blocked = outcomes(); blocked[1] = { ...blocked[1], status: 'blocked', evidence: [], explanation: 'Need a missing reference.' };
    assert.equal((await auditWorkflow(f.root, notes, { outcomes: blocked }, verified, signal(), auditor)).verified, true);
    const rejected: WorkflowGenerate = async (worker, prompt) => JSON.stringify({ ...JSON.parse(await verified(worker, prompt, signal())), verified: false, issues: ['First annotation is missed.'] });
    assert.equal((await auditWorkflow(f.root, notes, { outcomes: outcomes() }, rejected, signal(), auditor)).verified, false);
    const disagrees: WorkflowGenerate = async (worker, prompt) => { const report = JSON.parse(await verified(worker, prompt, signal())); report.outcomes[0].status = 'addressed'; return 'Here is the audit:\n```json\n' + JSON.stringify(report) + '\n```'; };
    assert.equal((await auditWorkflow(f.root, notes, { outcomes: outcomes() }, disagrees, signal(), auditor)).verified, false, 'a different verdict is a finding');
    const wrapped: WorkflowGenerate = async (worker, prompt) => 'Audit complete. ' + await verified(worker, prompt, signal()) + ' Done.';
    assert.equal((await auditWorkflow(f.root, notes, { outcomes: outcomes() }, wrapped, signal(), auditor)).verified, true);
    await assert.rejects(auditWorkflow(f.root, notes, { outcomes: outcomes() }, async () => 'No JSON here.', signal(), auditor), /incomplete outcomes/);
    const mutate: WorkflowGenerate = async (worker, prompt, signal) => { assert.deepEqual(worker, auditor); const result = await verified(worker, prompt, signal); fs.writeFileSync(path.join(f.root, 'new.tex'), 'Untracked change'); return result; };
    await assert.rejects(auditWorkflow(f.root, notes, { outcomes: outcomes() }, mutate, signal(), auditor), /changed during/);
  } finally { f.close(); }
});
class Helper extends EventEmitter {
  ready = false; cwd = ''; closed = false; calls: any[] = [];
  models: { model: string; isDefault?: boolean; supportedReasoningEfforts?: { reasoningEffort: string }[] }[] = [{ model: 'opencode-go/deepseek-v4.1-flash' }, { model: 'gemini-3.8-flash' }, { model: 'gemini-4-argon', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort })) }];
  async start() { this.ready = true; }
  async request(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'model/list') return { data: this.models };
    if (method === 'thread/start') { this.cwd = params.cwd; return { thread: { id: 'helper' } }; }
    if (method === 'turn/start') setImmediate(() => { this.emit('notification', { method: 'item/completed', params: { threadId: 'helper', item: { type: 'agentMessage', text: 'Proposal' } } }); this.emit('notification', { method: 'turn/completed', params: { threadId: 'helper', turn: { status: 'completed' } } }); });
    return { turn: { id: 'turn' } };
  }
  respond() {} reject() {} close() { this.closed = true; this.ready = false; }
}
const call = (helper: Helper, method: string) => helper.calls.find(entry => entry.method === method)?.params;
test('native helpers use the configured model and effort in a disposable read-only cwd', async () => {
  for (const worker of [routes.quick, routes.polish]) {
    const helper = new Helper();
    assert.equal(await runWorkflowHelper(worker, 'Fix text', signal(), undefined, undefined, () => helper), 'Proposal');
    assert.equal(call(helper, 'thread/start').model, worker.model); assert.equal(call(helper, 'thread/start').sandbox, 'read-only');
    assert.equal(call(helper, 'turn/start').effort, worker.effort);
    assert.equal(helper.closed, true); assert.equal(fs.existsSync(helper.cwd), false);
  }
  const helper = new Helper();
  await runWorkflowHelper({ agent: 'antigravity', model: null, effort: null }, 'Polish', signal(), undefined, undefined, () => helper);
  assert.equal(call(helper, 'thread/start').model, undefined, 'no model uses the runtime default'); assert.equal(call(helper, 'turn/start').effort, undefined);
});
test('a worker\'s steps are reported as it works, with paths inside its copy made relative', async () => {
  const helper = new Helper(), steps: { item: any; completed: boolean }[] = [];
  const cwd = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workflow-steps-')));
  try {
    fs.mkdirSync(path.join(cwd, 'sections')); fs.writeFileSync(path.join(cwd, 'sections', 'intro.tex'), 'Text.\n');
    helper.request = async (method, params) => {
      helper.calls.push({ method, params });
      if (method === 'model/list') return { data: helper.models };
      if (method === 'thread/start') return { thread: { id: 'helper' } };
      if (method === 'turn/start') setImmediate(() => {
        const notify = (method: string, item: object) => helper.emit('notification', { method, params: { threadId: 'helper', item } });
        notify('item/started', { id: 'read', type: 'toolCall', kind: 'read', target: path.join(cwd, 'sections', 'intro.tex'), status: 'inProgress' });
        notify('item/started', { id: 'think', type: 'reasoning' });
        notify('item/completed', { id: 'edit', type: 'fileChange', changes: [{ path: path.join(cwd, 'sections/intro.tex') }], status: 'completed' });
        notify('item/completed', { id: 'reply', type: 'agentMessage', text: `Fixed note 1 in ${cwd}/sections/intro.tex. Used \\ref{tab:memory} in ${cwd}\\sections\\intro.tex, as Windows reports it.` });
        helper.emit('notification', { method: 'turn/completed', params: { threadId: 'helper', turn: { status: 'completed' } } });
      });
      return { turn: { id: 'turn' } };
    };
    await runWorkflowHelper(routes.quick, 'Edit', signal(), { cwd, files: ['sections/intro.tex'] }, step => steps.push(step), () => helper);
    assert.deepEqual(steps.map(step => [step.item.id, step.completed]), [['read', false], ['edit', true], ['reply', true]], 'reasoning stays private');
    assert.equal(steps[0].item.target, 'sections/intro.tex');
    assert.deepEqual(steps[1].item.changes, [{ path: 'sections/intro.tex' }]);
    assert.equal(steps[2].item.text, 'Fixed note 1 in sections/intro.tex. Used \\ref{tab:memory} in sections/intro.tex, as Windows reports it.', 'LaTeX backslashes stay; paths use the task\'s slashes');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
test('a delegation reports what its worker changed before the edit is merged', async () => {
  const f = paper();
  try {
    const reported: { file: string; diff: string }[][] = [];
    const result = await delegateTo(f.root, notes, { ...delegateArgs, role: 'polish' }, async (_worker, _prompt, _signal, edit) => {
      fs.writeFileSync(path.join(edit!.cwd, 'main.tex'), 'First paragraph, polished.\n\nSecond paragraph.\n'); return 'Polished.';
    }, signal(), () => true, role => routes[role], { changes: changes => reported.push(changes) });
    assert.equal(result.status, 'applied');
    assert.equal(reported.length, 1); assert.equal(reported[0][0].file, 'main.tex');
    assert.match(reported[0][0].diff, /^--- main\.tex/); assert.match(reported[0][0].diff, /\n-First paragraph\.\n\+First paragraph, polished\.\n/);
  } finally { f.close(); }
});
test('unavailable models and efforts fail without a fallback or model turn', async () => {
  for (const [worker, error] of [[{ agent: 'antigravity', model: 'gemini-missing', effort: null }, /does not offer gemini-missing/], [{ agent: 'antigravity', model: 'gemini-4-argon', effort: 'max' }, /does not support max/]] as const) {
    const helper = new Helper();
    await assert.rejects(runWorkflowHelper(worker, 'Polish', signal(), undefined, undefined, () => helper), error);
    assert.equal(helper.calls.some(entry => entry.method === 'thread/start'), false); assert.equal(helper.closed, true);
  }
});
test('Antigravity default models and models without effort variants reject unavailable efforts', async () => {
  for (const [model, efforts] of [[null, ['low']], ['gemini-4-argon', []]] as const) {
    const helper = new Helper();
    helper.models = [{ model: 'gemini-4-argon', isDefault: true, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })) }];
    await assert.rejects(runWorkflowHelper({ agent: 'antigravity', model, effort: 'high' }, 'Polish', signal(), undefined, undefined, () => helper), /gemini-4-argon does not support high/);
    assert.equal(helper.calls.some(entry => entry.method === 'thread/start'), false);
    assert.equal(helper.closed, true);
  }
});
test('Antigravity workers reject a selected effort when the default model is unknown', async () => {
  const helper = new Helper();
  await assert.rejects(runWorkflowHelper({ agent: 'antigravity', model: null, effort: 'high' }, 'Polish', signal(), undefined, undefined, () => helper), /does not offer a default model/);
  assert.equal(helper.calls.some(entry => entry.method === 'thread/start'), false);
  assert.equal(helper.closed, true);
});
test('saved routes default to Codex with the task model and reject unknown workers', () => {
  assert.deepEqual(collaborationRoutes(undefined), { quick: { agent: 'codex', model: null, effort: null }, polish: { agent: 'codex', model: null, effort: null }, rigorous: { agent: 'codex', model: null, effort: null } });
  assert.deepEqual(collaborationRoutes(routes), routes);
  assert.deepEqual(collaborationRoutes({ ...routes, quick: { agent: 'shell', model: 'x', effort: null }, rigorous: { agent: 'codex', model: ' ', effort: 'xhigh' } }).quick, { agent: 'codex', model: null, effort: null });
  assert.equal(collaborationRoutes({ rigorous: { agent: 'codex', model: null, effort: 'xhigh' } }).rigorous.effort, null, 'a Codex worker without a model inherits the task effort');
  assert.equal(validRoutes(routes), true);
  assert.equal(validRoutes({ ...routes, polish: { agent: 'claude', model: null, effort: null } }), false);
  assert.equal(validRoutes({ quick: routes.quick }), false);
  const instructions = workflowInstructions(collaborationRoutes({ ...routes, rigorous: { agent: 'codex', model: null, effort: null } }));
  assert.match(instructions, /quick: .*OpenCode \(opencode-go\/deepseek-v4\.1-flash, max reasoning effort\)/);
  assert.match(instructions, /polish: .*Antigravity \(gemini-4-argon, high reasoning effort\)/);
  assert.match(instructions, /rigorous: .*Codex \(the task's model\)/);
});
test('stopping a native helper closes its process and ignores late results', async () => {
  const helper = new Helper(), controller = new AbortController();
  helper.request = async (method, params) => { if (method === 'model/list') return { data: [] }; if (method === 'thread/start') { helper.cwd = params.cwd; return { thread: { id: 'helper' } }; } if (method === 'turn/start') controller.abort(); return {}; };
  await assert.rejects(runWorkflowHelper(auditor, 'Audit', controller.signal, undefined, undefined, () => helper), /stopped/);
  assert.equal(helper.closed, true); assert.equal(fs.existsSync(helper.cwd), false);
});
test('a Codex editor rejects a runtime that keeps host writable roots before starting a turn', async () => {
  const f = paper(), helper = new Helper(), request = helper.request.bind(helper);
  helper.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'thread/start') return { ...result, approvalPolicy: 'never', sandbox: { type: 'workspaceWrite', writableRoots: ['/host'], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } };
    return result;
  };
  try {
    await assert.rejects(runWorkflowHelper(routes.rigorous, 'Edit', signal(), { cwd: f.root, files: ['main.tex'] }, undefined, () => helper), /isolated workflow permissions/);
    assert.equal(helper.calls.some(call => call.method === 'turn/start'), false); assert.equal(helper.closed, true);
    assert.equal(fs.existsSync(f.root), true, 'the delegation owns snapshot cleanup');
  } finally { f.close(); }
});
test('Codex helpers reject enabled MCP names that native overrides cannot address and skip disabled ones', async () => {
  for (const enabled of [true, false]) {
    const helper = new Helper(), request = helper.request.bind(helper);
    helper.request = async (method, params) => method === 'config/read' ? { config: { mcp_servers: { 'dot.name': { enabled } } } } : request(method, params);
    const work = runWorkflowHelper(auditor, 'Audit', signal(), undefined, undefined, () => helper);
    if (enabled) { await assert.rejects(work, /isolated workflow permissions/); assert.equal(helper.calls.some(call => call.method === 'thread/start'), false); }
    else { assert.equal(await work, 'Proposal'); assert.equal(helper.calls.find(call => call.method === 'thread/start').params.sandbox, 'read-only'); }
    assert.equal(helper.closed, true);
  }
});
test('a delayed installation probe cannot start a helper after cancellation', async () => {
  const helper = new Helper(), controller = new AbortController(); let resolve!: (value: boolean) => void, starts = 0;
  const runtime = Object.assign(helper, { detect: () => new Promise<boolean>(done => { resolve = done; }) });
  runtime.start = async () => { starts++; helper.ready = true; };
  const work = runWorkflowHelper(auditor, 'Audit', controller.signal, undefined, undefined, () => runtime);
  controller.abort(); await assert.rejects(work, /stopped/); resolve(true); await new Promise(done => setImmediate(done));
  assert.equal(starts, 0); assert.equal(helper.ready, false);
});
test('an ignored evidence file is included in the audit fingerprint and sources are deduplicated', async () => {
  const f = paper();
  try {
    fs.writeFileSync(path.join(f.root, '.gitignore'), 'generated.tex\n'); fs.writeFileSync(path.join(f.root, 'generated.tex'), 'Generated text.');
    const entries = outcomes().map(entry => ({ ...entry, evidence: [{ file: 'generated.tex', quote: 'Generated' }] }));
    const check: WorkflowGenerate = async (worker, prompt, signal) => { const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); assert.deepEqual(Object.keys(data.sources), ['generated.tex']); assert.equal(data.outcomes[0].evidence[0].source, undefined); return verified(worker, prompt, signal); };
    const result = await auditWorkflow(f.root, notes, { outcomes: entries }, check, signal(), auditor);
    fs.writeFileSync(path.join(f.root, 'generated.tex'), 'Changed text.');
    assert.notEqual((await workflowSnapshot(f.root, result.files)).fingerprint, result.fingerprint);
  } finally { f.close(); }
});
test('a submodule is fingerprinted by its commit and changes instead of being read as a file', async () => {
  const f = paper(), library = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workflow-submodule-')));
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  try {
    git(library, 'init'); fs.writeFileSync(path.join(library, 'macros.tex'), '\\newcommand{\\R}{\\mathbb{R}}\n'); git(library, 'add', '.'); git(library, 'commit', '-m', 'Macros');
    git(f.root, 'submodule', 'add', library, 'lib'); git(f.root, 'commit', '-m', 'Add macros');
    const before = await workflowSnapshot(f.root);
    assert.equal((await workflowSnapshot(f.root)).fingerprint, before.fingerprint);
    // Each further edit counts, including in an already dirty submodule and its untracked files.
    const prints = [before.fingerprint];
    for (const change of [() => fs.appendFileSync(path.join(f.root, 'lib', 'macros.tex'), '% edited\n'), () => fs.appendFileSync(path.join(f.root, 'lib', 'macros.tex'), '% again\n'), () => fs.writeFileSync(path.join(f.root, 'lib', 'extra.tex'), 'New'), () => fs.writeFileSync(path.join(f.root, 'lib', 'extra.tex'), 'Newer')]) {
      change(); const next = (await workflowSnapshot(f.root, ['main.tex'])).fingerprint;
      assert.ok(!prints.includes(next)); prints.push(next);
    }
  } finally { f.close(); fs.rmSync(library, { recursive: true, force: true }); }
});
test('audit binds the quoted source bytes to the fingerprint before asking the verifier', async () => {
  const f = paper();
  try {
    let called = false;
    const generate: WorkflowGenerate = async (worker, prompt, signal) => { called = true; return verified(worker, prompt, signal); };
    const work = auditWorkflow(f.root, notes, { outcomes: outcomes() }, generate, signal(), auditor);
    fs.writeFileSync(path.join(f.root, 'main.tex'), 'Different text without the requested quotations.');
    await assert.rejects(work, /no longer matches/); assert.equal(called, false);
  } finally { f.close(); }
});
