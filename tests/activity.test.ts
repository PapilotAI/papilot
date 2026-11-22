import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { ClaudeAgent, GlmAgent, type AgentRuntime } from '../src/server/agents.ts';
import {
  CodexUsageTracker,
  buildActivityReport,
  estimateModelCostUsd,
  localDateHour,
  normalizeTurnUsage,
  parseCodexBreakdown,
} from '../src/server/activity.ts';

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('CodexUsageTracker normalizes OpenAI cached/reasoning breakdowns and differences cumulative thread totals without double counting', () => {
  const tracker = new CodexUsageTracker();
  tracker.seedThread('thread-1');

  // Step 1 in Turn 1: inputTokens=10000 (of which 8000 cached), outputTokens=500 (of which 200 reasoning).
  const step1 = tracker.consume('thread-1', {
    total: { totalTokens: 10500, inputTokens: 10000, cachedInputTokens: 8000, cacheWriteInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 200 },
    last: { totalTokens: 10500, inputTokens: 10000, cachedInputTokens: 8000, cacheWriteInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 200 },
  });
  assert.deepEqual(step1, {
    input: 2000,
    cached: 8000,
    cacheWrite: 0,
    output: 500,
    reasoning: 200,
    total: 10500,
  });

  // Step 2 in Turn 1: cumulative total grows by 3000 input (2500 cached) + 400 output (100 reasoning).
  const step2 = tracker.consume('thread-1', {
    total: { totalTokens: 13900, inputTokens: 13000, cachedInputTokens: 10500, cacheWriteInputTokens: 0, outputTokens: 900, reasoningOutputTokens: 300 },
    last: { totalTokens: 3400, inputTokens: 3000, cachedInputTokens: 2500, cacheWriteInputTokens: 0, outputTokens: 400, reasoningOutputTokens: 100 },
  });
  assert.deepEqual(step2, {
    input: 500,
    cached: 2500,
    cacheWrite: 0,
    output: 400,
    reasoning: 100,
    total: 3400,
  });

  // Duplicate notification with unchanged cumulative total yields null.
  assert.equal(
    tracker.consume('thread-1', {
      total: { totalTokens: 13900, inputTokens: 13000, cachedInputTokens: 10500, outputTokens: 900, reasoningOutputTokens: 300 },
      last: { totalTokens: 3400, inputTokens: 3000, cachedInputTokens: 2500, outputTokens: 400, reasoningOutputTokens: 100 },
    }),
    null,
  );

  // Resumed thread after server restart (not seeded): first event uses `last` rather than re-counting historical `total`,
  // and subsequent events difference against the newly recorded `total`.
  const resumedFirst = tracker.consume('resumed-thread', {
    total: { totalTokens: 55000, inputTokens: 50000, cachedInputTokens: 40000, outputTokens: 5000, reasoningOutputTokens: 1000 },
    last: { totalTokens: 5500, inputTokens: 5000, cachedInputTokens: 4000, outputTokens: 500, reasoningOutputTokens: 100 },
  });
  assert.deepEqual(resumedFirst, {
    input: 1000,
    cached: 4000,
    cacheWrite: 0,
    output: 500,
    reasoning: 100,
    total: 5500,
  });

  const resumedSecond = tracker.consume('resumed-thread', {
    total: { totalTokens: 58200, inputTokens: 53000, cachedInputTokens: 42000, outputTokens: 5200, reasoningOutputTokens: 1050 },
    last: { totalTokens: 3200, inputTokens: 3000, cachedInputTokens: 2000, outputTokens: 200, reasoningOutputTokens: 50 },
  });
  assert.deepEqual(resumedSecond, {
    input: 1000,
    cached: 2000,
    cacheWrite: 0,
    output: 200,
    reasoning: 50,
    total: 3200,
  });

  // Resumed thread replay during thread/resume seeds baseline without emitting a duplicate delta.
  tracker.seedBaseline('replayed-thread', {
    total: { totalTokens: 55000, inputTokens: 50000, cachedInputTokens: 40000, outputTokens: 5000, reasoningOutputTokens: 1000 },
    last: { totalTokens: 5500, inputTokens: 5000, cachedInputTokens: 4000, outputTokens: 500, reasoningOutputTokens: 100 },
  });
  const afterReplay = tracker.consume('replayed-thread', {
    total: { totalTokens: 58200, inputTokens: 53000, cachedInputTokens: 42000, outputTokens: 5200, reasoningOutputTokens: 1050 },
    last: { totalTokens: 3200, inputTokens: 3000, cachedInputTokens: 2000, outputTokens: 200, reasoningOutputTokens: 50 },
  });
  assert.deepEqual(afterReplay, {
    input: 1000,
    cached: 2000,
    cacheWrite: 0,
    output: 200,
    reasoning: 50,
    total: 3200,
  });

  // Papilot Writer's context-window notification carries only totalTokens + modelContextWindow and must not be billed as Codex usage.
  assert.equal(parseCodexBreakdown({ totalTokens: 12000 }), null);
});

test('exact model pricing estimates known API models and leaves unknown models unpriced instead of inventing rates', () => {
  const sample = { input: 100_000, cached: 200_000, cacheWrite: 0, output: 20_000, reasoning: 5_000, total: 320_000 };
  const gptCost = estimateModelCostUsd('codex', 'gpt-5.4', sample);
  assert.ok(gptCost !== null && gptCost > 0, 'gpt-5.4 has exact API rates');

  const copilotWrapper = normalizeTurnUsage('papilot', 'github-copilot/gpt-5.4', {
    input: 100_000,
    cached: 200_000,
    cacheWrite: 0,
    output: 20_000,
    total: 320_000,
  });
  assert.equal(copilotWrapper?.costSource, 'estimated');
  assert.equal(copilotWrapper?.costUsd, gptCost);

  const unknown = normalizeTurnUsage('glm', 'glm-5.3-custom-unknown', {
    input: 50_000,
    cached: 0,
    cacheWrite: 0,
    output: 10_000,
    total: 60_000,
  });
  assert.equal(unknown?.costUsd, null);
  assert.equal(unknown?.costSource, 'unknown');

  // Inclusive prompt_tokens / ACP inputTokens must subtract cached tokens rather than double-counting them.
  const openaiInclusive = normalizeTurnUsage('copilot', 'gpt-5.4', {
    prompt_tokens: 1000,
    prompt_tokens_details: { cached_tokens: 600 },
    completion_tokens: 200,
    completion_tokens_details: { reasoning_tokens: 50 },
    total_tokens: 1200,
  });
  assert.deepEqual(openaiInclusive?.tokens, {
    input: 400,
    cached: 600,
    cacheWrite: 0,
    output: 200,
    reasoning: 50,
    total: 1200,
  });

  const acpInclusive = normalizeTurnUsage('antigravity', 'gemini-2.5-pro', {
    inputTokens: 1500,
    cachedReadTokens: 1000,
    outputTokens: 300,
    thoughtTokens: 80,
    totalTokens: 1800,
  });
  assert.deepEqual(acpInclusive?.tokens, {
    input: 500,
    cached: 1000,
    cacheWrite: 0,
    output: 300,
    reasoning: 80,
    total: 1800,
  });

  // Locally calculated pi-ai rate-table cost stays 'estimated' rather than 'reported'.
  const writerEstimated = normalizeTurnUsage('papilot', 'openai-codex/gpt-5.4', {
    input: 1000,
    cached: 2000,
    cacheWrite: 0,
    output: 500,
    total: 3500,
    costUsd: 0.0123,
    costSource: 'estimated',
  });
  assert.equal(writerEstimated?.costSource, 'estimated');
  assert.equal(writerEstimated?.costUsd, 0.0123);
});

test('ClaudeAgent differences cumulative session modelUsage across turns while GlmAgent ignores guessed unknown-model costs', async () => {
  let turnIndex = 0;
  const claude = new ClaudeAgent(async () => (({ options }: any) => (async function* () {
    turnIndex++;
    yield { type: 'system', subtype: 'init', session_id: options.sessionId || options.resume } as any;
    yield { type: 'assistant', uuid: `u-${turnIndex}`, message: { id: `m-${turnIndex}`, content: [{ type: 'text', text: `Reply ${turnIndex}` }] } } as any;
    if (turnIndex === 1) {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Reply 1',
        total_cost_usd: 0.18,
        modelUsage: {
          'claude-sonnet-4-6': { inputTokens: 2000, cacheReadInputTokens: 5000, cacheCreationInputTokens: 1000, outputTokens: 600, thinkingTokens: 150, costUSD: 0.15 },
          'claude-haiku-4-5': { inputTokens: 1000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 200, thinkingTokens: 0, costUSD: 0.03 },
        },
      } as any;
    } else if (turnIndex === 2) {
      // Simulate a startup error result with zeroed modelUsage; sessionUsage must NOT reset to zero.
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Transient transport failure'],
        total_cost_usd: 0,
        modelUsage: {
          'claude-sonnet-4-6': { inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUSD: 0 },
        },
      } as any;
    } else {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Reply 3',
        total_cost_usd: 0.30,
        modelUsage: {
          'claude-sonnet-4-6': { inputTokens: 3500, cacheReadInputTokens: 9000, cacheCreationInputTokens: 1000, outputTokens: 1100, thinkingTokens: 250, costUSD: 0.27 },
          'claude-haiku-4-5': { inputTokens: 1000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 200, thinkingTokens: 0, costUSD: 0.03 },
        },
      } as any;
    }
  })()) as any, () => null);

  const claudeUsages: any[] = [];
  claude.on('notification', msg => { if (msg.method === 'turn/usage') claudeUsages.push(msg.params); });
  const started = await claude.request('thread/start', { cwd: os.tmpdir(), developerInstructions: '' });

  for (let i = 0; i < 3; i++) {
    const done = new Promise<void>(resolve => {
      const onMsg = (msg: any) => { if (msg.method === 'turn/completed') { claude.off('notification', onMsg); resolve(); } };
      claude.on('notification', onMsg);
    });
    await claude.request('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'Go' }], cwd: os.tmpdir() });
    await done;
  }

  assert.equal(claudeUsages.length, 3, 'Turn 1 emits Sonnet + Haiku; zeroed crash Turn 2 emits nothing; Turn 3 emits only changed Sonnet delta');
  assert.equal(claudeUsages[2].model, 'claude-sonnet-4-6');
  assert.equal(claudeUsages[2].usage.input, 1500);
  assert.equal(claudeUsages[2].usage.cached, 4000);
  assert.equal(claudeUsages[2].usage.cacheWrite, 0);
  assert.equal(claudeUsages[2].usage.output, 500);
  assert.equal(claudeUsages[2].usage.reasoning, 100);
  assert.ok(Math.abs(claudeUsages[2].usage.costUsd - 0.12) < 1e-9);

  // GLM runs on Claude SDK where Claude Code may guess Opus costUSD for unknown models; GlmAgent must strip that fake cost.
  const glm = new GlmAgent(async () => (({ options }: any) => (async function* () {
    yield { type: 'system', subtype: 'init', session_id: options.sessionId } as any;
    yield { type: 'assistant', uuid: 'g-1', message: { id: 'gm-1', content: [{ type: 'text', text: 'GLM reply' }] } } as any;
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'GLM reply',
      total_cost_usd: 1.95,
      modelUsage: {
        'glm-5.3': { inputTokens: 4000, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0, outputTokens: 800, costUSD: 1.95, costBasis: 'unknown' },
      },
    } as any;
  })()) as any, { ZHIPU_API_KEY: 'test-key' });

  const glmUsages: any[] = [];
  glm.on('notification', msg => { if (msg.method === 'turn/usage') glmUsages.push(msg.params); });
  const glmThread = await glm.request('thread/start', { cwd: os.tmpdir(), developerInstructions: '', model: 'glm-5.3' });
  const glmDone = new Promise<void>(resolve => {
    glm.on('notification', msg => { if (msg.method === 'turn/completed') resolve(); });
  });
  await glm.request('turn/start', { threadId: glmThread.thread.id, input: [{ type: 'text', text: 'Hi' }], cwd: os.tmpdir(), model: 'glm-5.3' });
  await glmDone;

  assert.equal(glmUsages.length, 1);
  assert.equal(glmUsages[0].usage.costUsd, undefined);
  assert.equal(glmUsages[0].usage.total, 5800);
});

test('activity ledger records tasks, helpers, workers, tokens, reviews, undos and annotations, and survives task and paper deletion', async () => {
  const dir = tempDir('papilot-activity-store-');
  const store = new Store(path.join(dir, 'papilot.sqlite'));
  try {
    const baseMs = Date.UTC(2026, 10, 22, 16, 30, 0); // 2026-11-22 16:30 UTC == 2026-11-23 00:30 Asia/Shanghai == 2026-11-22 11:30 America/New_York
    const p1 = { id: 'paper-1', name: 'Quantum Error Correction', path: path.join(dir, 'p1'), createdAt: baseMs };
    const p2 = { id: 'paper-2', name: 'Stochastic Optimal Control', path: path.join(dir, 'p2'), createdAt: baseMs };
    store.saveProject(p1);
    store.saveProject(p2);

    // Record task, turns, token usage, annotations, decisions, undo, delivery, and commit across two papers.
    store.recordActivity({ key: 'task:t1', at: baseMs, kind: 'task_started', projectId: p1.id, taskId: 't1', agent: 'codex', model: 'gpt-5.4', data: { mode: 'edit', projectName: p1.name } });
    store.recordActivity({ key: 'turn:r1', at: baseMs, kind: 'agent_turn', projectId: p1.id, taskId: 't1', agent: 'codex', model: 'gpt-5.4', data: { role: 'edit', status: 'completed', finishedAt: baseMs + 5000, projectName: p1.name } }, true);
    store.recordActivity({ key: 'turn:helper:h1', at: baseMs + 1000, kind: 'agent_turn', projectId: p1.id, taskId: 't1', agent: 'codex', model: 'gpt-5.4-mini', data: { role: 'helper', what: 'generate a task title', status: 'completed', projectName: p1.name } }, true);
    store.recordActivity({ key: 'turn:worker:w1', at: baseMs + 2000, kind: 'agent_turn', projectId: p1.id, taskId: 't1', agent: 'opencode', model: 'qwen3.6-plus', data: { role: 'worker', status: 'completed', projectName: p1.name } }, true);

    store.recordActivity({
      key: 'usage:u1',
      at: baseMs,
      kind: 'token_usage',
      projectId: p1.id,
      taskId: 't1',
      agent: 'codex',
      model: 'gpt-5.4',
      data: { role: 'edit', tokens: { input: 10000, cached: 30000, cacheWrite: 0, output: 2000, reasoning: 500, total: 42000 }, costUsd: null, costSource: 'unknown', projectName: p1.name },
    });
    store.recordActivity({
      key: 'usage:u2',
      at: baseMs - 86_400_000,
      kind: 'token_usage',
      projectId: p2.id,
      taskId: 't2',
      agent: 'claude',
      model: 'claude-sonnet-4-6',
      data: { role: 'review', tokens: { input: 5000, cached: 10000, cacheWrite: 2000, output: 1500, reasoning: 300, total: 18500 }, costUsd: 0.048, costSource: 'reported', projectName: p2.name },
    });
    store.recordActivity({
      key: 'usage:u3',
      at: baseMs,
      kind: 'token_usage',
      projectId: p2.id,
      taskId: 't2',
      agent: 'glm',
      model: 'glm-5.3',
      data: { role: 'edit', tokens: { input: 8000, cached: 0, cacheWrite: 0, output: 1000, reasoning: 0, total: 9000 }, costUsd: null, costSource: 'unknown', projectName: p2.name },
    });

    // Annotations: 2 author, 1 agent, 1 ai-review, and 3 sent to tasks.
    store.recordActivity({ key: 'note:n1', at: baseMs, kind: 'annotation_created', projectId: p1.id, data: { source: 'author', projectName: p1.name } });
    store.recordActivity({ key: 'note:n2', at: baseMs, kind: 'annotation_created', projectId: p1.id, data: { source: 'author', projectName: p1.name } });
    store.recordActivity({ key: 'note:n3', at: baseMs, kind: 'annotation_created', projectId: p1.id, taskId: 't1', agent: 'codex', data: { source: 'agent', projectName: p1.name } });
    store.recordActivity({ key: 'note:n4', at: baseMs, kind: 'annotation_created', projectId: p2.id, taskId: 't2', agent: 'claude', data: { source: 'ai-review', projectName: p2.name } });
    store.recordActivity({ key: 'notes-sent:r1', at: baseMs, kind: 'annotations_sent', projectId: p1.id, taskId: 't1', agent: 'codex', data: { count: 3, projectName: p1.name } });

    // Review decisions: accept 4 (idempotent replay ignored), reject 2, then undo the reject!
    store.recordActivity({ key: 'decision:t1:act-1', at: baseMs, kind: 'review_decision', projectId: p1.id, taskId: 't1', agent: 'codex', data: { action: 'accept', count: 4, source: 'task', projectName: p1.name } });
    store.recordActivity({ key: 'decision:t1:act-1', at: baseMs + 500, kind: 'review_decision', projectId: p1.id, taskId: 't1', agent: 'codex', data: { action: 'accept', count: 4, source: 'task', projectName: p1.name } });
    store.recordActivity({ key: 'decision:t1:act-2', at: baseMs, kind: 'review_decision', projectId: p1.id, taskId: 't1', agent: 'codex', data: { action: 'reject', count: 2, source: 'task', projectName: p1.name } });
    store.recordActivity({ key: 'decision:t1:act-3', at: baseMs, kind: 'review_decision', projectId: p1.id, taskId: 't1', agent: 'codex', data: { action: 'comment', count: 1, source: 'task', projectName: p1.name } });
    assert.equal(store.undoActivity('decision:t1:act-2', baseMs + 1000), true);
    assert.equal(store.undoActivity('decision:t1:act-2', baseMs + 2000), false, 'Second undo is a no-op');

    // Stage then unstage uncommitted change leaves zero phantom accepts or undos.
    store.recordActivity({ key: 'decision:changes:paper-1:1:c1', at: baseMs, kind: 'review_decision', projectId: p1.id, data: { action: 'accept', count: 1, source: 'changes', projectName: p1.name } }, true);
    store.clearActivity('decision:changes:paper-1:1:c1');

    store.recordActivity({ key: 'delivery:t1:sha1', at: baseMs, kind: 'task_delivered', projectId: p1.id, taskId: 't1', agent: 'codex', data: { mode: 'commit', projectName: p1.name } });
    store.recordActivity({ key: 'commit:p1:sha2', at: baseMs, kind: 'git_commit', projectId: p1.id, data: { projectName: p1.name } });

    // Delete task t1 and remove paper p2 completely; historical activity must remain intact!
    store.deleteTask('t1');
    store.removeProject(p2.id);

    // Check timezone bucketing across UTC, Asia/Shanghai (+08), and America/New_York (-05).
    assert.deepEqual(localDateHour(baseMs, 'UTC'), { date: '2026-11-22', hour: 16 });
    assert.deepEqual(localDateHour(baseMs, 'Asia/Shanghai'), { date: '2026-11-23', hour: 0 });
    assert.deepEqual(localDateHour(baseMs, 'America/New_York'), { date: '2026-11-22', hour: 11 });

    const shanghaiReport = buildActivityReport(store, { tz: 'Asia/Shanghai', range: '7d', now: baseMs + 3600_000 });
    assert.equal(shanghaiReport.today, '2026-11-23');
    assert.deepEqual(shanghaiReport.days.map(day => day.date), ['2026-11-22', '2026-11-23'], 'Days list only active days of the range, oldest first');
    assert.equal(shanghaiReport.totals.tokens.total, 42000 + 18500 + 9000);
    assert.equal(shanghaiReport.totals.unpricedTokens, 9000);
    const expectedGptCost = estimateModelCostUsd('codex', 'gpt-5.4', { input: 10000, cached: 30000, cacheWrite: 0, output: 2000, reasoning: 500, total: 42000 })!;
    assert.ok(Math.abs((shanghaiReport.totals.costUsd ?? 0) - (expectedGptCost + 0.048)) < 1e-9);
    const p1Summary = shanghaiReport.projects.find(project => project.id === p1.id);
    assert.ok(p1Summary && Math.abs((p1Summary.costUsd ?? 0) - expectedGptCost) < 1e-9, 'Per-paper costUsd includes dynamically estimated model cost');
    assert.equal(shanghaiReport.totals.turns, 3);
    assert.deepEqual(shanghaiReport.totals.turnsByRole, { edit: 1, review: 0, worker: 1, helper: 1 });
    assert.equal(shanghaiReport.totals.accepted, 4);
    assert.equal(shanghaiReport.totals.rejected, 0);
    assert.equal(shanghaiReport.totals.commented, 1);
    assert.equal(shanghaiReport.totals.undone, 2);
    assert.equal(shanghaiReport.totals.tasksCommitted, 1);
    assert.equal(shanghaiReport.totals.gitCommits, 1);
    assert.equal(shanghaiReport.totals.annotationsCreated, 4);
    assert.equal(shanghaiReport.totals.authorAnnotations, 2);
    assert.equal(shanghaiReport.totals.agentAnnotations, 1);
    assert.equal(shanghaiReport.totals.aiReviewAnnotations, 1);
    assert.equal(shanghaiReport.totals.annotationsSent, 3);
    assert.ok(shanghaiReport.hours[0] > 0, '00:30 in Asia/Shanghai lands in hour 0');

    const removedSummary = shanghaiReport.projects.find(project => project.id === p2.id);
    assert.ok(removedSummary);
    assert.equal(removedSummary.name, 'Stochastic Optimal Control');
    assert.equal(removedSummary.removed, true);

    // Filter to removed paper p2 only.
    const p2Only = buildActivityReport(store, { tz: 'UTC', range: '30d', projectId: p2.id, now: baseMs });
    assert.equal(p2Only.totals.tokens.total, 18500 + 9000);
    assert.equal(p2Only.totals.annotationsCreated, 1);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the past-year calendar covers 53 weeks of active days whatever the range, while totals, agents and papers follow the range', () => {
  const dir = tempDir('papilot-activity-calendar-');
  const store = new Store(path.join(dir, 'papilot.sqlite'));
  try {
    const now = Date.UTC(2026, 10, 22, 12, 0, 0);
    const day = 86_400_000;
    const p1 = { id: 'paper-1', name: 'Main Paper', path: path.join(dir, 'p1'), createdAt: now };
    const p2 = { id: 'paper-2', name: 'Side Paper', path: path.join(dir, 'p2'), createdAt: now };
    store.saveProject(p1);
    store.saveProject(p2);
    const turn = (key: string, at: number, projectId: string, agent: string) => store.recordActivity({ key, at, kind: 'agent_turn', projectId, taskId: key, agent, model: `${agent}-model`, data: { role: 'edit', status: 'completed' } }, true);
    turn('turn:today', now, p1.id, 'codex');
    store.recordActivity({ key: 'usage:today', at: now, kind: 'token_usage', projectId: p1.id, taskId: 'turn:today', agent: 'claude', model: 'claude-sonnet-4-6', data: { tokens: { input: 100, cached: 0, cacheWrite: 0, output: 50, reasoning: 0, total: 150 }, costUsd: 0.01, costSource: 'reported' } });
    turn('turn:20d', now - 20 * day, p2.id, 'glm');
    store.recordActivity({ key: 'decision:20d', at: now - 20 * day, kind: 'review_decision', projectId: p2.id, data: { action: 'accept', count: 3, source: 'task' } });
    turn('turn:first-column', now - 370 * day, p1.id, 'codex');
    turn('turn:too-old', now - 371 * day, p1.id, 'codex');

    const week = buildActivityReport(store, { tz: 'UTC', range: '7d', now });
    assert.deepEqual(week.calendar.map(entry => entry.date), ['2025-11-17', '2026-11-02', '2026-11-22']);
    assert.deepEqual(week.calendar.at(-1), { date: '2026-11-22', tokens: 150, costUsd: 0.01, reportedCostUsd: 0.01, estimatedCostUsd: 0, turns: 1, accepted: 0, rejected: 0, commented: 0, annotationsCreated: 0 });
    assert.equal(week.calendar[1].accepted, 3);
    assert.equal(week.calendar[1].costUsd, null);
    assert.equal(week.totals.turns, 1);
    assert.equal(week.totals.accepted, 0);
    assert.equal(week.totals.activeDays, 1);
    assert.deepEqual(week.days.map(entry => entry.date), ['2026-11-22']);
    assert.deepEqual(week.agents.map(entry => entry.agent).sort(), ['claude', 'codex'], 'Calendar-only days add no agents');
    assert.deepEqual(week.models.map(entry => entry.model).sort(), ['claude-sonnet-4-6', 'codex-model']);
    assert.equal(week.projects.find(project => project.id === p2.id)?.turns, 0, 'Calendar-only days add nothing to paper summaries');
    assert.equal(week.hours.reduce((sum, value) => sum + value, 0), 1);

    const sidePaper = buildActivityReport(store, { tz: 'UTC', range: '7d', projectId: p2.id, now });
    assert.deepEqual(sidePaper.calendar.map(entry => entry.date), ['2026-11-02'], 'The paper filter applies to the calendar');

    const everything = buildActivityReport(store, { tz: 'UTC', range: 'all', now });
    assert.deepEqual(everything.calendar, week.calendar);
    assert.equal(everything.totals.turns, 4);
    assert.equal(everything.totals.activeDays, 4);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrading an existing workspace database backfills tasks, runs, feedback decisions and annotations once without counting returned or adopted copies twice', () => {
  const dir = tempDir('papilot-activity-upgrade-');
  const dbFile = path.join(dir, 'legacy.sqlite');
  try {
    const raw = new DatabaseSync(dbFile);
    const created = Date.UTC(2026, 10, 20, 14, 0, 0);
    raw.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE items(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE annotations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    raw.prepare('INSERT INTO projects VALUES(?,?,?)').run('p1', '/papers/p1', JSON.stringify({ id: 'p1', name: 'Legacy Paper', path: '/papers/p1', createdAt: created }));
    raw.prepare('INSERT INTO tasks VALUES(?,?,?)').run('t1', 'p1', JSON.stringify({
      id: 't1', projectId: 'p1', name: 'p-t1', title: 'Polish intro', instructions: 'Polish', worktree: '/wt/t1',
      threadId: 'th-1', turnId: null, agent: 'codex', model: 'gpt-5.4', status: 'reviewing',
      createdAt: created, updatedAt: created + 10000, feedbackCursor: 0, error: null,
      delivery: { mode: 'workspace', accepted: 'abc123' },
      review: { state: 'done', round: 1, counts: { pending: 0, accepted: 3, rejected: 1, commented: 0 } },
    }));
    raw.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run('run-1', 't1', 'initial-t1', 'completed', JSON.stringify({
      id: 'run-1', taskId: 't1', requestKey: 'initial-t1', prompt: 'Polish', status: 'completed', createdAt: created, finishedAt: created + 5000, reviewRound: 1,
    }));
    raw.prepare('INSERT INTO items VALUES(?,?,?,?)').run('run-1', 't1', created, JSON.stringify({
      id: 'run-1', taskId: 't1', type: 'user', text: 'Polish', createdAt: created,
      meta: { notes: [{ id: 'note-author', where: 'p. 1', quote: 'x', comment: 'fix' }] },
    }));
    // Author annotation + returned copy + AI review finding + adopted copy
    raw.prepare('INSERT INTO annotations VALUES(?,?,?)').run('note-author', 'p1', JSON.stringify({
      id: 'note-author', projectId: 'p1', key: 'k1', page: 0, rect: [0, 0, 0.5, 0.5], comment: 'fix', quote: 'x', source: null, createdAt: created - 1000, taskId: 't1',
    }));
    raw.prepare('INSERT INTO annotations VALUES(?,?,?)').run('returned-1', 'p1', JSON.stringify({
      id: 'returned-1', projectId: 'p1', key: 'k1', page: 0, rect: [0, 0, 0.5, 0.5], comment: 'fix', quote: 'x', source: null, createdAt: created + 8000,
      returnAction: { taskId: 't1', id: 'dec-1', key: 'run-1:0', originalId: 'note-author' },
    }));
    raw.prepare('INSERT INTO annotations VALUES(?,?,?)').run('ai-1', 'p1', JSON.stringify({
      id: 'ai-1', projectId: 'p1', key: 'k1', page: 0, rect: [0, 0, 0.5, 0.5], comment: 'clarify', quote: 'y', source: null, createdAt: created + 2000,
      deletedAt: created + 4000,
      aiReview: { taskId: 't-rev', agent: 'codex', copiedTo: 'adopt-1' },
    }));
    raw.prepare('INSERT INTO annotations VALUES(?,?,?)').run('adopt-1', 'p1', JSON.stringify({
      id: 'adopt-1', projectId: 'p1', key: 'k1', page: 0, rect: [0, 0, 0.5, 0.5], comment: 'clarify', quote: 'y', source: null, createdAt: created + 3000,
      aiReview: { taskId: 't-rev', agent: 'codex', sourceId: 'ai-1' },
    }));
    raw.close();

    const store = new Store(dbFile);
    const report = buildActivityReport(store, { tz: 'UTC', range: 'all', now: created + 20000 });
    assert.equal(report.totals.tasksStarted, 1);
    assert.equal(report.totals.turns, 1);
    assert.equal(report.totals.tasksApplied, 1);
    assert.equal(report.totals.annotationsCreated, 2, 'Counts author note and AI finding, skipping returned and adopted copies');
    assert.equal(report.totals.annotationsSent, 1);
    assert.equal(report.totals.accepted, 4, '3 task review accepts + 1 adopted AI review suggestion');
    assert.equal(report.totals.rejected, 1);
    store.close();

    // Reopening does not duplicate backfilled events.
    const reopened = new Store(dbFile);
    const second = buildActivityReport(reopened, { tz: 'UTC', range: 'all', now: created + 20000 });
    assert.deepEqual(second.totals, report.totals);
    reopened.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the upgrade backfill adds unsent decisions of a later review round without recounting sent feedback', () => {
  const dir = tempDir('papilot-activity-rounds-');
  const dbFile = path.join(dir, 'legacy.sqlite');
  try {
    const raw = new DatabaseSync(dbFile);
    const created = Date.UTC(2026, 10, 20, 14, 0, 0);
    raw.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE items(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE annotations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    raw.prepare('INSERT INTO projects VALUES(?,?,?)').run('p1', '/papers/p1', JSON.stringify({ id: 'p1', name: 'Legacy Paper', path: '/papers/p1', createdAt: created }));
    const task = (id: string, review: unknown) => raw.prepare('INSERT INTO tasks VALUES(?,?,?)').run(id, 'p1', JSON.stringify({
      id, projectId: 'p1', name: `p-${id}`, title: 'Polish', instructions: 'Polish', worktree: `/wt/${id}`, threadId: `th-${id}`, turnId: null,
      agent: 'codex', model: 'gpt-5.4', status: 'reviewing', createdAt: created, updatedAt: created + 10000, feedbackCursor: 0, error: null, review,
    }));
    const feedback = (id: string, taskId: string, summary: unknown) => raw.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id, taskId, created + 5000, JSON.stringify({
      id, taskId, type: 'user', text: 'Continue', createdAt: created + 5000, meta: { feedback: summary },
    }));
    // Round 1 was sent back (2 accepted, 1 comment); round 2 is decided but not sent yet.
    task('later', { state: 'done', round: 2, counts: { pending: 0, accepted: 3, rejected: 1, commented: 0 } });
    feedback('later-feedback', 'later', { round: 1, accepted: 2, rejected: 0, undone: 0, comments: [{ where: 'p. 1', text: 'Shorter' }] });
    // The latest round was sent back after 2 accepts, then 1 more accept and 1 comment followed.
    task('partial', { state: 'done', round: 1, counts: { pending: 0, accepted: 3, rejected: 0, commented: 1 } });
    feedback('partial-feedback', 'partial', { round: 1, accepted: 2, rejected: 0, undone: 0, comments: [] });
    raw.close();

    const store = new Store(dbFile);
    const report = buildActivityReport(store, { tz: 'UTC', range: 'all', now: created + 20000 });
    assert.equal(report.totals.accepted, (2 + 3) + 3, 'Round 1 feedback plus round 2, and the latest round once');
    assert.equal(report.totals.rejected, 1);
    assert.equal(report.totals.commented, 1 + 1);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Workspace records Codex thread token deltas and helper turns without emitting redundant state broadcasts', async () => {
  const dir = tempDir('papilot-workspace-activity-');
  const store = new Store(path.join(dir, 'papilot.sqlite'));
  class FakeCodex extends EventEmitter implements AgentRuntime {
    ready = true;
    private seq = 0;
    async start() {}
    async request(method: string, params: any = {}) {
      if (method === 'account/read') return { account: { email: 'user@example.edu' }, requiresOpenaiAuth: true };
      if (method === 'model/list') return { data: [{ model: 'gpt-5.4', displayName: 'GPT-5.4', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium' }] };
      if (method === 'config/read') return { config: { model: 'gpt-5.4' } };
      if (method === 'account/rateLimits/read') return { rateLimits: null };
      if (method === 'thread/start') return { thread: { id: `th-${++this.seq}` }, model: params.model || 'gpt-5.4' };
      if (method === 'thread/unsubscribe') return { status: 'notLoaded' };
      if (method === 'turn/start') {
        const turnId = `turn-${++this.seq}`;
        setImmediate(() => {
          this.emit('notification', {
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: params.threadId,
              turnId,
              tokenUsage: {
                total: { totalTokens: 6500, inputTokens: 6000, cachedInputTokens: 4000, outputTokens: 500, reasoningOutputTokens: 100 },
                last: { totalTokens: 6500, inputTokens: 6000, cachedInputTokens: 4000, outputTokens: 500, reasoningOutputTokens: 100 },
              },
            },
          });
          this.emit('notification', {
            method: 'item/completed',
            params: { threadId: params.threadId, turnId, item: { id: 'm1', type: 'agentMessage', text: 'Refine convergence proof' } },
          });
          this.emit('notification', {
            method: 'turn/completed',
            params: { threadId: params.threadId, turn: { id: turnId, status: 'completed' } },
          });
        });
        return { turn: { id: turnId } };
      }
      return {};
    }
    respond() {}
    reject() {}
    close() {}
  }

  const fakeCodex = new FakeCodex();
  const workspace = new Workspace(
    store,
    fakeCodex,
    async () => ({
      url: 'http://127.0.0.1:1',
      token: 't',
      get: async () => ({ state: 'done', round: null, counts: {} }),
      post: async (route: string) => (route === '/api/tasks' ? { worktree: dir, deferred: true } : { job: 'j1' }),
    }) as any,
  );

  try {
    await workspace.connect();
    const project = { id: 'proj-1', name: 'Convergence Paper', path: dir, createdAt: Date.now() };
    store.saveProject(project);

    let storeChanges = 0;
    store.on('change', () => { storeChanges++; });
    store.recordActivity({ key: 'manual:1', at: Date.now(), kind: 'git_commit', projectId: project.id, data: {} });
    assert.equal(storeChanges, 0, 'recordActivity does not wake SSE state listeners');

    // Run a read-only commit-message helper turn directly through oneOff/helperTurn via diagnoseLatexBuild.
    const diagnosis = await workspace.diagnoseLatexBuild(dir, 'Undefined control sequence', { agent: 'codex', model: 'gpt-5.4', projectId: project.id });
    assert.equal(diagnosis, 'Refine convergence proof');

    const report = buildActivityReport(store, { tz: 'UTC', range: '7d' });
    assert.equal(report.totals.turnsByRole.helper, 1);
    assert.equal(report.totals.tokens.total, 6500);
    assert.equal(report.totals.tokens.input, 2000);
    assert.equal(report.totals.tokens.cached, 4000);
    assert.equal(report.totals.tokens.output, 500);
    assert.ok((report.totals.costUsd ?? 0) > 0);
  } finally {
    workspace.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
