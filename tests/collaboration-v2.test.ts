import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  collaborationConfig,
  DEFAULT_COLLABORATION_CONFIG,
  type AgentId,
  type CollaborationRoute,
  type PreparedNoteOptions,
  type RuntimeStatus,
} from '../src/shared.ts';
import { resolveCollaborationConfig, modelFamily } from '../src/server/collaboration-auto.ts';
import { clusterCurrentNotes, currentTurnNotes, extractPaperContext, parseRouterPlan } from '../src/server/collaboration-plan.ts';
import {
  anonymizeCandidates,
  applyPatchesToBase,
  buildPreparedRaceOptions,
  checkCandidateFidelity,
  deduplicateCandidates,
  diffFiles,
  parseJudgeVerdict,
  type RaceCandidate,
} from '../src/server/collaboration-race.ts';
import { CollaborationRuntime, type CollaborationHost } from '../src/server/collaboration-runtime.ts';
import { preparedOptionEdits } from '../src/server/prepared-note-options.ts';
import { optionCandidate } from '../engine/src/core/option-preview.ts';
import type { Unit } from '../engine/src/types.ts';

function makePaper() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-collab-v2-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init');
  fs.writeFileSync(path.join(root, 'preamble.tex'), '\\newcommand{\\ty}{\\vdash}\n\\DeclareMathOperator{\\fv}{fv}\n');
  fs.writeFileSync(path.join(root, 'refs.bib'), '@article{pierce2002,\n  title={Types and Programming Languages}\n}\n');
  fs.writeFileSync(path.join(root, 'main.tex'), [
    '\\section{Typing}',
    '',
    'The simple typign rule checks abstractions cleanly.',
    '',
    'The method works well in practice for all closed terms $\\Gamma \\ty e : \\tau$ \\cite{pierce2002}.',
    '',
    'Does soundness require weakening when $x \\notin \\fv(\\Gamma)$?',
    '',
  ].join('\n'));
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Base');
  return { root, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const hostRuntimes: Partial<Record<AgentId, RuntimeStatus>> = {
  deepseek: {
    connected: true, authenticated: true, account: 'dsh', error: null,
    models: [
      { id: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash', isDefault: true, efforts: ['off', 'low', 'high'], defaultEffort: 'low' },
      { id: '["opengateway","deepseek/deepseek-v4.1-flash-ultrafast"]', name: 'DeepSeek V4.1 Flash UltraFast', isDefault: false, efforts: [], defaultEffort: null },
    ],
  },
  codex: {
    connected: true, authenticated: true, account: 'codex', error: null,
    models: [
      { id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'high', fastMode: { serviceTier: 'fast', description: 'Fast' } },
    ],
  },
  antigravity: {
    connected: true, authenticated: true, account: 'agy', error: null,
    models: [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', isDefault: false, efforts: ['low', 'medium', 'high'], defaultEffort: 'low' },
    ],
  },
};

test('auto-team selects ultrafast router/quick, rigorous GPT-6.2-Sol xhigh fast, fluent Gemini 4 Neon xhigh, and cross-family racers', () => {
  const resolved = resolveCollaborationConfig(DEFAULT_COLLABORATION_CONFIG, hostRuntimes);
  assert.equal(resolved.router?.agent, 'deepseek');
  assert.equal(resolved.router?.model, '["opengateway","deepseek/deepseek-v4.1-flash-ultrafast"]');
  assert.equal(resolved.routes.quick?.agent, 'deepseek');
  assert.equal(resolved.routes.rigorous?.agent, 'codex');
  assert.equal(resolved.routes.rigorous?.model, 'gpt-6.2-sol');
  assert.equal(resolved.routes.rigorous?.effort, 'xhigh');
  assert.equal(resolved.routes.rigorous?.serviceTier, 'fast');
  assert.equal(resolved.routes.polish?.agent, 'antigravity');
  assert.equal(resolved.routes.polish?.model, 'gemini-4-neon');
  assert.equal(resolved.routes.polish?.effort, 'xhigh');
  assert.equal(resolved.judge?.agent, 'codex');
  assert.equal(resolved.judge?.model, 'gpt-6.2-sol');
  assert.equal(resolved.racers.length, 2);
  assert.deepEqual(resolved.racers.map(r => r.agent), ['codex', 'antigravity']);
});

test('auto-team builds cross-family racers even on a single multi-provider agent and excludes non-read-only agents from router/judge', () => {
  assert.equal(modelFamily('papilot', 'anthropic/claude-sonnet-4-6', 'Claude Sonnet'), 'anthropic');
  assert.equal(modelFamily('papilot', 'google/gemini-4-neon', 'Gemini 4 Neon'), 'google');
  const singleAgent: Partial<Record<AgentId, RuntimeStatus>> = {
    papilot: {
      connected: true, authenticated: true, account: 'writer', error: null,
      models: [
        { id: 'openai/gpt-6.2-sol', name: 'GPT-6.2-Sol', isDefault: true, efforts: ['high', 'xhigh'], defaultEffort: 'high' },
        { id: 'google/gemini-4-neon', name: 'Gemini 4 Neon', isDefault: false, efforts: ['high', 'xhigh'], defaultEffort: 'high' },
        { id: 'deepseek/deepseek-v4.1-flash-ultrafast', name: 'DeepSeek Flash UltraFast', isDefault: false, efforts: [], defaultEffort: null },
      ],
    },
    qoder: {
      connected: true, authenticated: true, account: 'qoder', error: null,
      models: [{ id: 'qoder-flash', name: 'Qoder UltraFast', isDefault: true, efforts: [], defaultEffort: null }],
    },
  };
  const resolved = resolveCollaborationConfig(DEFAULT_COLLABORATION_CONFIG, singleAgent, { qoder: false, papilot: true });
  assert.equal(resolved.router?.agent, 'papilot');
  assert.equal(resolved.judge?.agent, 'papilot');
  assert.equal(resolved.racers.length, 2);
  assert.notEqual(
    modelFamily(resolved.racers[0].agent, resolved.racers[0].model || ''),
    modelFamily(resolved.racers[1].agent, resolved.racers[1].model || ''),
  );
});

test('legacy collaboration-routes migration turns untouched Codex defaults into Auto while keeping explicit choices', () => {
  const migrated = collaborationConfig(undefined, {
    quick: { agent: 'codex', model: null, effort: null },
    polish: { agent: 'antigravity', model: 'gemini-4-neon', effort: 'xhigh' },
    rigorous: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'xhigh' },
  });
  assert.equal(migrated.routes.quick, null);
  assert.deepEqual(migrated.routes.polish, { agent: 'antigravity', model: 'gemini-4-neon', effort: 'xhigh' });
  assert.deepEqual(migrated.routes.rigorous, { agent: 'codex', model: 'gpt-6.2-sol', effort: 'xhigh' });
});

test('spatial clustering groups same-paragraph notes, separates distant notes, and extracts paper macros/bib keys', () => {
  const f = makePaper();
  try {
    const notes = currentTurnNotes([
      { where: 'main.tex', quote: 'simple typign rule', comment: 'Fix typo' },
      { where: 'main.tex', quote: 'The method works well', comment: 'Polish prose while keeping rigor' },
      { where: 'main.tex', quote: 'all closed terms', comment: 'Clarify closed term hypothesis' },
      { where: 'main.tex', quote: 'Does soundness require weakening', comment: 'Does soundness require weakening?' },
    ], 'run-1');
    const { clusters, unanchored } = clusterCurrentNotes(f.root, notes);
    assert.equal(unanchored.length, 0);
    assert.equal(clusters.length, 3, 'notes 2 and 3 share the same paragraph and cluster together');
    assert.deepEqual(clusters[0].notes.map(n => n.noteNumber), [1]);
    assert.deepEqual(clusters[1].notes.map(n => n.noteNumber), [2, 3]);
    assert.deepEqual(clusters[2].notes.map(n => n.noteNumber), [4]);
    const ctx = extractPaperContext(f.root);
    assert.ok(ctx.macros.some(m => m.includes('\\ty')));
    assert.ok(ctx.bibKeys.includes('pierce2002'));

    // Strategy invariants on router plan parsing.
    const raw = JSON.stringify({
      units: [
        { clusterId: clusters[0].id, mode: 'assign', role: 'quick', instruction: 'Fix typo' },
        { clusterId: clusters[1].id, mode: 'race', role: 'polish', instruction: 'Polish clearly' },
        { clusterId: clusters[2].id, mode: 'answer', role: 'rigorous', instruction: 'Answer question' },
      ],
    });
    assert.deepEqual(parseRouterPlan(raw, clusters, 'balanced', 2).units.map(u => u.mode), ['assign', 'race', 'answer']);
    assert.deepEqual(parseRouterPlan(raw, clusters, 'fast', 2).units.map(u => u.mode), ['assign', 'assign', 'answer']);
    assert.deepEqual(parseRouterPlan(raw, clusters, 'thorough', 2).units.map(u => u.mode), ['race', 'race', 'answer']);
  } finally { f.close(); }
});

test('fidelity checks catch unbalanced LaTeX, dropped citations, and out-of-scope edits; judge catches rigor drift', () => {
  const f = makePaper();
  try {
    const baseText = fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8');
    const base = { 'main.tex': baseText };
    const notes = currentTurnNotes([
      { where: 'main.tex', quote: 'simple typign rule', comment: 'Fix typo' },
      { where: 'main.tex', quote: 'The method works well', comment: 'Make clearer without losing rigor' },
    ], 'run-2');
    const { clusters } = clusterCurrentNotes(f.root, notes);
    const [c1, c2] = clusters;

    const brokenLatex = applyPatchesToBase(base, [{ file: 'main.tex', find: 'The method works well', replace: 'The \\emph{method works well' }]);
    assert.equal(checkCandidateFidelity(base, brokenLatex, c2, [c1]).hardFail, true);

    const droppedCite = applyPatchesToBase(base, [{ file: 'main.tex', find: ' \\cite{pierce2002}', replace: '' }]);
    const dropCheck = checkCandidateFidelity(base, droppedCite, c2, [c1]);
    assert.equal(dropCheck.hardFail, false);
    assert.ok(dropCheck.droppedCitations.some(c => c.includes('pierce2002')));

    const outOfScope = applyPatchesToBase(base, [{ file: 'main.tex', find: 'simple typign rule', replace: 'simple typing rule' }]);
    assert.equal(checkCandidateFidelity(base, outOfScope, c2, [c1]).outOfScope, true);

    // Consensus deduplication collapses identical edits.
    const gptText = applyPatchesToBase(base, [{ file: 'main.tex', find: 'The method works well in practice', replace: 'Our method performs reliably in practice' }]);
    const gemText = applyPatchesToBase(base, [{ file: 'main.tex', find: 'The method works well in practice for all closed terms', replace: 'Our approach works smoothly for most terms' }]);
    const gptRoute: CollaborationRoute = { agent: 'codex', model: 'gpt-6.2-sol', effort: 'xhigh', serviceTier: 'fast' };
    const gemRoute: CollaborationRoute = { agent: 'antigravity', model: 'gemini-4-neon', effort: 'xhigh' };
    const cGpt: RaceCandidate = { id: 'gpt', route: gptRoute, role: 'rigorous', modelName: 'GPT-6.2-Sol', summary: 'Rigorous', files: gptText, diffs: diffFiles(base, gptText), fidelity: checkCandidateFidelity(base, gptText, c2, [c1]) };
    const cGem: RaceCandidate = { id: 'gem', route: gemRoute, role: 'polish', modelName: 'Gemini 4 Neon', summary: 'Fluent', files: gemText, diffs: diffFiles(base, gemText), fidelity: checkCandidateFidelity(base, gemText, c2, [c1]) };
    assert.equal(deduplicateCandidates([cGpt, { ...cGpt, id: 'dup', route: gemRoute, modelName: 'Other' }])[0].consensus?.length, 2);
    // Two different agents sharing the same display name still count as 2 agreeing models.
    const sameNameConsensus = deduplicateCandidates([cGpt, { ...cGpt, id: 'dup2', route: gemRoute, modelName: cGpt.modelName }])[0].consensus;
    assert.equal(sameNameConsensus?.length, 2);
    assert.ok(sameNameConsensus?.some(name => name.includes('Codex')) && sameNameConsensus?.some(name => name.includes('Antigravity')));

    const anon = anonymizeCandidates(c2.id, [cGpt, cGem]);
    const gptAnon = anon.find(a => a.candidate.id === 'gpt')!.anonId;
    const gemAnon = anon.find(a => a.candidate.id === 'gem')!.anonId;
    const verdict = parseJudgeVerdict({
      reply: JSON.stringify({
        recommended: 'synthesized',
        summary: 'Combined fluent phrasing with exact quantifier.',
        candidates: [
          { id: gptAnon, rigor: 'pass', tag: 'Rigorous', reason: 'Preserves all closed terms; slightly stiff.' },
          { id: gemAnon, rigor: 'warn', tag: 'Fluent but drifts', reason: 'Weakened "all closed terms" to "most terms".' },
        ],
        synthesized: {
          tag: 'Rigorous + natural',
          reason: 'Reads naturally while keeping "all closed terms".',
          edits: [{ file: 'main.tex', find: 'The method works well in practice for all closed terms', replace: 'Our approach performs smoothly for all closed terms' }],
        },
      }),
      anonymized: anon, base, cluster: c2, otherClusters: [c1], judgeRoute: gptRoute, judgeName: 'GPT-6.2-Sol',
    });
    assert.equal(verdict.winner.candidate.synthesized, true);
    assert.equal(verdict.winner.recommended, true);
    assert.equal(verdict.alternatives.length, 2);
    assert.equal(verdict.alternatives.find(a => a.candidate.id === 'gem')?.rigor, 'warn');
  } finally { f.close(); }
});

test('boundary-divergent cross-model race alternatives project via before/after span expansion in preparedOptionEdits and optionCandidate', () => {
  const before = 'The method works well in practice.\n';
  const after = 'The method performs reliably in practice.\n';
  const unit: Unit = {
    id: 'u1', file: 'main.tex', kind: 'text', status: 'modified', whole_file: false, truncated: false,
    old_start: 1, old_end: 1, new_start: 1, new_end: 1,
    old_text: 'works well', new_text: 'performs reliably',
    ops: [['replace', 0, 1, 0, 1]],
    text_ops: [['replace', 11, 21, 11, 28]],
  };
  // Alternative changes "The method" -> "Our approach" (11 chars BEFORE unit.text_ops[0]).
  const edits = preparedOptionEdits(
    { label: 'Gemini 4 Neon', reason: 'More direct opening.', meta: { model: 'Gemini 4 Neon', rigor: 'pass' }, edits: [{ file: 'main.tex', find: 'The method performs reliably', replace: 'Our approach performs reliably' }] },
    [unit],
    new Map([['main.tex', after]]),
    [unit],
  );
  assert.deepEqual(edits, [{ unit: 'u1', text: 'Our approach performs reliably', before: 11 }]);

  const candidate = optionCandidate([unit], edits, () => after);
  assert.equal(candidate.files['main.tex']!.toString('utf8'), 'Our approach performs reliably in practice.\n');
  assert.equal(candidate.units[0].old_text, 'The method works well');
  assert.equal(candidate.units[0].new_text, 'Our approach performs reliably');
});

test('CollaborationRuntime orchestrates routing, single-worker assignment, per-annotation racing, judging, and PreparedNoteOptions end-to-end', async () => {
  const f = makePaper();
  try {
    const resolved = resolveCollaborationConfig(DEFAULT_COLLABORATION_CONFIG, hostRuntimes);
    const savedItems: any[] = [];
    let savedOptions: PreparedNoteOptions[] = [];
    const notes = [
      { where: 'main.tex', quote: 'simple typign rule', comment: 'Fix typo' },
      { where: 'main.tex', quote: 'The method works well', comment: 'Make more readable while preserving rigor' },
      { where: 'main.tex', quote: 'Does soundness require weakening', comment: 'Does soundness require weakening?' },
    ];
    const host: CollaborationHost = {
      availability: () => ({ installed: true, ready: true }),
      resolved: () => resolved,
      context: () => ({
        taskId: 'task-1', runId: 'run-1', worktree: f.root, notes,
        request: 'Fix typos, polish prose carefully, and answer my question.',
        history: '', memory: '', resolved, runtimes: hostRuntimes,
        readOnlyAgents: { deepseek: true, codex: true, antigravity: true },
      }),
      saveItem: (_taskId, item) => savedItems.push(item),
      workerStep: () => {},
      settleWorker: () => {},
      registerWorker: () => () => {},
      onNoteOptions: (_taskId, _runId, options) => { savedOptions = options; },
      activity: () => {},
      generate: async (worker, prompt) => {
        if (prompt.includes('fast dispatcher for Papilot Collaboration Mode')) {
          return JSON.stringify({
            units: [
              { clusterId: 'c1', mode: 'assign', role: 'quick', instruction: 'Fix typign -> typing.' },
              { clusterId: 'c2', mode: 'race', role: 'polish', instruction: 'Improve prose while keeping all closed terms and citation.' },
              { clusterId: 'c3', mode: 'answer', role: 'rigorous', instruction: 'Answer soundness weakening question.' },
            ],
          });
        }
        if (prompt.includes('Answer the author\'s question')) {
          return 'Yes, standard preservation proofs use weakening for fresh variables.';
        }
        if (prompt.includes('rigor-first academic paper judge')) {
          const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
          const gptEntry = data.candidates.find((c: any) => JSON.stringify(c.diffs).includes('reliably'));
          const gemEntry = data.candidates.find((c: any) => JSON.stringify(c.diffs).includes('most terms'));
          return JSON.stringify({
            recommended: gptEntry.id,
            summary: 'GPT preserves the universal quantifier while Gemini weakened it.',
            candidates: [
              { id: gptEntry.id, rigor: 'pass', tag: 'Rigorous', reason: 'Preserves universal quantifier and citation.' },
              { id: gemEntry.id, rigor: 'warn', tag: 'Natural but drifts', reason: 'Reads smoothly, but weakened "all closed terms" to "most terms".' },
            ],
          });
        }
        const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        if (data.targetExcerpt.includes('simple typign rule')) {
          return JSON.stringify({ summary: 'Fixed typo.', edits: [{ file: 'main.tex', find: 'simple typign rule', replace: 'simple typing rule' }] });
        }
        if (worker.agent === 'codex') {
          return JSON.stringify({ summary: 'Tightened phrasing rigorously.', edits: [{ file: 'main.tex', find: 'The method works well in practice', replace: 'The method performs reliably in practice' }] });
        }
        return JSON.stringify({ summary: 'Made prose smoother.', edits: [{ file: 'main.tex', find: 'The method works well in practice for all closed terms', replace: 'Our approach works smoothly for most terms' }] });
      },
    };

    const runtime = new CollaborationRuntime(host);
    await runtime.start();
    assert.ok(runtime.permissionOptions().some(opt => opt.value === 'workspace'));
    const { thread } = await runtime.request('thread/start', { cwd: f.root, model: 'balanced', taskPermissions: 'workspace' });
    let completed = false, replyText = '';
    const done = new Promise<void>((resolve, reject) => {
      runtime.on('notification', msg => {
        if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage') replyText = msg.params.item.text;
        if (msg.method === 'turn/completed') {
          if (msg.params?.turn?.status === 'completed') { completed = true; resolve(); }
          else reject(new Error(msg.params?.turn?.error?.message || 'Turn failed'));
        }
      });
    });
    await runtime.request('turn/start', { threadId: thread.id, clientUserMessageId: 'run-1', cwd: f.root, input: [{ type: 'text', text: 'Go' }] });
    await done;

    assert.equal(completed, true);
    const updated = fs.readFileSync(path.join(f.root, 'main.tex'), 'utf8');
    assert.ok(updated.includes('simple typing rule'), 'quick worker fixed typo');
    assert.ok(updated.includes('The method performs reliably in practice for all closed terms'), 'rigorous winner merged into worktree');
    assert.ok(replyText.includes('weakening'), 'answer-only note answered in chat');
    assert.equal(savedOptions.length, 1, 'raced note produced inline PreparedNoteOptions');
    assert.equal(savedOptions[0].note, 2);
    assert.equal(savedOptions[0].current.meta?.recommended, true);
    assert.equal(savedOptions[0].options[0].meta?.rigor, 'warn');
    assert.ok(savedItems.some(i => i.text === 'workflow_route' && i.status === 'completed'));
    assert.ok(savedItems.some(i => i.text.startsWith('workflow_race') && i.status === 'completed'));
    assert.ok(savedItems.some(i => i.text.startsWith('workflow_judge') && i.status === 'completed'));
  } finally { f.close(); }
});

test('fidelity & patch helpers handle CRLF files, \\\\%% comments, verbatim/lstlisting code, biblatex cites, and single-cluster scope', () => {
  // CRLF support when model returns LF JSON strings
  const crlfBase = { 'main.tex': 'Line one.\r\nLine two.\r\nLine three.\r\n' };
  const patched = applyPatchesToBase(crlfBase, [{ file: 'main.tex', find: 'Line one.\nLine two.', replace: 'Line 1.\nLine 2.' }]);
  assert.equal(patched['main.tex'], 'Line 1.\r\nLine 2.\r\nLine three.\r\n');

  // PL paper with lstlisting, \verb|{unbalanced}|, \\% table comment, and \parencite -> \textcite
  const plSource = [
    '\\section{Calculus}',
    '\\begin{lstlisting}',
    'let f x = { unbalanced $ code',
    '\\end{lstlisting}',
    'We write \\verb|foo { bar $| and cite \\parencite{pierce2002}.\\\\% comment with {',
    'The typing rule holds for all closed terms.',
  ].join('\n');
  const cluster = {
    id: 'c1', file: 'main.tex', lines: [5, 6] as [number, number], window: [4, 6] as [number, number],
    notes: [{ noteNumber: 1, id: 'r:1', note: { where: 'p.1', quote: 'typing rule', comment: 'Polish prose' }, file: 'main.tex', lines: [5, 6] as [number, number], window: [4, 6] as [number, number] }],
    excerpt: plSource.split('\n').slice(3).join('\n'),
  };
  const goodAfter = plSource.replace('\\parencite{pierce2002}', '\\textcite{pierce2002}').replace('holds for all closed terms', 'holds for every closed term');
  const ok = checkCandidateFidelity({ 'main.tex': plSource }, { 'main.tex': goodAfter }, cluster, []);
  assert.equal(ok.hardFail, false);
  assert.deepEqual(ok.latexErrors, []);
  assert.deepEqual(ok.droppedCitations, []);

  // Out-of-scope edit far outside single cluster window is rejected
  const farLines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}.`).join('\n');
  const singleCluster = {
    id: 'c1', file: 'main.tex', lines: [25, 26] as [number, number], window: [24, 27] as [number, number],
    notes: [{ noteNumber: 1, id: 'r:1', note: { where: 'p.1', quote: 'Line 25', comment: 'Polish' }, file: 'main.tex', lines: [25, 26] as [number, number], window: [24, 27] as [number, number] }],
    excerpt: 'Line 24.\nLine 25.\nLine 26.\nLine 27.',
  };
  const escaped = farLines.replace('Line 1.', 'Hijacked line 1.');
  const oos = checkCandidateFidelity({ 'main.tex': farLines }, { 'main.tex': escaped }, singleCluster, []);
  assert.equal(oos.outOfScope, true);
  assert.equal(oos.hardFail, true);
});

test('extractJsonObject ignores preceding LaTeX fences and balanced braces', async () => {
  const { extractJsonObject } = await import('../src/server/collaboration-plan.ts');
  const reply = 'Here is the LaTeX:\n```latex\n\\frac{a}{b}\n```\nAnd the JSON:\n```json\n{"units":[{"clusterId":"c1","mode":"race","role":"polish","instruction":"Polish"}]}\n```';
  const parsed = extractJsonObject(reply);
  assert.equal(parsed?.units?.[0]?.clusterId, 'c1');
  assert.equal(extractJsonObject('[1,2,3]'), null);
});

test('preparedOptionEdits supports multi-unit notes and optionCandidate adjusts newline-boundary old_end cleanly', async () => {
  const { preparedOptionEdits } = await import('../src/server/prepared-note-options.ts');
  const { optionCandidate } = await import('../engine/src/core/option-preview.ts');
  const source = 'Intro line.\nThe new method is quick and also clear.\nNext line.\n';
  // Two units inside the same sentence for one note: "new" [16..19] and "quick" [30..35]
  const u1 = { id: 'u1', file: 'main.tex', kind: 'text' as const, old_start: 2, old_end: 2, new_start: 2, new_end: 2, old_text: 'old', new_text: 'new', ops: [['replace', 1, 2, 1, 2]] as any, text_ops: [['replace', 16, 19, 16, 19]] as any };
  const u2 = { id: 'u2', file: 'main.tex', kind: 'text' as const, old_start: 2, old_end: 2, new_start: 2, new_end: 2, old_text: 'slow', new_text: 'quick', ops: [['replace', 1, 2, 1, 2]] as any, text_ops: [['replace', 30, 35, 30, 35]] as any };
  const edits = preparedOptionEdits(
    { label: 'Gemini', reason: 'Natural phrasing', meta: { model: 'Gemini 4 Neon', rigor: 'pass' }, edits: [{ file: 'main.tex', find: 'The new method is quick and also clear.', replace: 'Our revised method is fast and crisp.' }] },
    [u1, u2] as any,
    new Map([['main.tex', source]]),
    [u1, u2] as any,
  );
  assert.equal(edits.length, 2);
  const candidate = optionCandidate([u1, u2] as any, edits, () => source);
  assert.equal(candidate.files['main.tex']!.toString('utf8'), 'Intro line.\nOur revised method is fast and crisp.\nNext line.\n');

  // Newline-boundary expansion: unit ends right after '\n' on line 1, expands into line 2
  const multi = 'aaa\nccc\n';
  const lineUnit = { id: 'u3', file: 'main.tex', kind: 'text' as const, old_start: 1, old_end: 1, new_start: 1, new_end: 1, old_text: 'bbb\n', new_text: 'aaa\n', ops: [['replace', 0, 1, 0, 1]] as any, text_ops: [['replace', 0, 4, 0, 4]] as any };
  const expanded = optionCandidate([lineUnit] as any, [{ unit: 'u3', text: 'xxx\nyyy', after: 3 }], () => multi);
  assert.equal(expanded.units[0].ops[0][2], 2, 'old_end half-open line count includes absorbed line 2');
  assert.equal(expanded.units[0].old_end, 2);
});

test('clusterCurrentNotes relocates SyncTeX anchors shifted across blank lines and numbered theorem headers', () => {
  const f = makePaper();
  try {
    const tex = [
      '\\section{Soundness}',
      'First intro paragraph of soundness.',
      '',
      'Second paragraph about closed expressions $e$ and effect row $\\varepsilon$.',
      '',
      '\\begin{lemma}[Substitution]',
      'If $\\Gamma, x:\\tau_1 \\vdash e : \\tau_2$, then substitution holds.',
      '\\end{lemma}',
    ].join('\n');
    fs.writeFileSync(path.join(f.root, 'main.tex'), tex);
    const notes = currentTurnNotes([
      // SyncTeX shifted 2 lines up into paragraph 1, across the blank line from paragraph 2!
      { where: 'p.1', quote: 'Second paragraph about closed expressions e and effect row', comment: 'Polish prose', anchor: { sources: [{ file: 'main.tex', lines: [2, 2] }] } },
      // SyncTeX shifted up and PDF rendered auto-numbered "Lemma 1 (Substitution)"
      { where: 'p.1', quote: 'Lemma 1 (Substitution)', comment: 'Does weakening apply?', anchor: { sources: [{ file: 'main.tex', lines: [4, 4] }] } },
    ], 'run-shift');
    const { clusters, unanchored } = clusterCurrentNotes(f.root, notes);
    assert.equal(unanchored.length, 0);
    assert.equal(clusters.length, 2);
    assert.deepEqual(clusters[0].lines, [4, 4]);
    assert.ok(clusters[0].excerpt.includes('Second paragraph'));
    assert.deepEqual(clusters[1].lines, [6, 6]);
    assert.ok(clusters[1].excerpt.includes('\\begin{lemma}[Substitution]'));
  } finally { f.close(); }
});
