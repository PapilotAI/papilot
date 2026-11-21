import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, resolveInside } from '../src/server/writer/policy.ts';
import { blankComments, contentsEntry, onlyInput, project, simpleMacros, wordCount } from '../src/server/writer/plain-text.ts';
import { execFileSync } from 'node:child_process';
import { mapUpdate, paperMap } from '../src/server/writer/paper-map.ts';
import type { CompiledPaper } from '../src/server/writer/build-map.ts';
import { OUTLINE_TRACE } from '../engine/src/core/build.ts';
import { writerTools, type ToolHost } from '../src/server/writer/tools.ts';
import { WriterAgent, toolItem } from '../src/server/writer/agent.ts';
import { claudeSubscription, WriterCredentials } from '../src/server/writer/auth.ts';
import { contextBreakdown, COMPACTION_RESERVE } from '../src/server/writer/context.ts';
import { fileEdit } from '../src/server/writer/edits.ts';
import { killTree } from '../bin/agent-paths.mjs';
import { validateToolArguments } from '@mariozechner/pi-ai';

function paper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer 中文 '));
  fs.mkdirSync(path.join(dir, 'sections'));
  fs.writeFileSync(path.join(dir, 'main.tex'), String.raw`\documentclass{article}
\newcommand{\method}{FlowNet}
\newcommand{\vect}[1]{\mathbf{#1}}
\title{Learning to \emph{Fly}}
\begin{document}
\maketitle
\begin{abstract}
We present \method, a model that learns % a comment
to fly.
\end{abstract}
\section{Introduction}\label{sec:intro}
\method{} is \textbf{fast}. As shown in Section~\ref{sec:method}
and in~\cite{smith2020}, it
generalizes well.
\input{sections/method}
\section{Results}
See Figure~\ref{fig:missing}.
\bibliographystyle{plain}\bibliography{refs}
\end{document}
`);
  fs.writeFileSync(path.join(dir, 'sections', 'method.tex'), String.raw`\section{Method}\label{sec:method}
We train \method\ on birds.
\subsection{Loss}
The loss is small.
\begin{figure}\caption{The architecture of the model.}\label{fig:arch}\end{figure}
`);
  fs.writeFileSync(path.join(dir, 'refs.bib'), '@article{smith2020,\n  title = {Flying},\n  author = {Smith, A.},\n  year = {2020}\n}\n');
  fs.writeFileSync(path.join(dir, 'data.csv'), 'x,y\n1,2\n');
  return dir;
}

// Compiles a paper as Papilot's builds do: a snapshot of the sources, built
// into build/ with the outline trace loaded first.
let texAvailable: boolean | undefined;
const hasTeX = () => texAvailable ??= (() => { try { execFileSync('latexmk', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
function compile(dir: string): CompiledPaper {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot build ')), root = path.join(folder, 'src');
  fs.cpSync(dir, root, { recursive: true });
  fs.writeFileSync(path.join(folder, 'papilot-trace.tex'), OUTLINE_TRACE + '\n');
  try { execFileSync('latexmk', ['-norc', '-pdf', '-outdir=build', '-jobname=main', '-synctex=1', '-interaction=nonstopmode', '-usepretex=\\input{../papilot-trace.tex}', 'main.tex'], { cwd: root, stdio: 'ignore', timeout: 120000 }); }
  catch { /* A paper with warnings still has its PDF. */ }
  return { pdf: path.join(root, 'build', 'main.pdf'), root, sourceDir: '', builtAt: Date.UTC(2026, 10, 15, 9, 30), pages: 1 };
}
const built = (compiled: CompiledPaper) => async (tool: string) => tool === 'paper_build' ? { success: true, text: JSON.stringify(compiled) } : { success: true, text: '' };

test('the policy runs paper edits, asks before other changes and refuses to leave the worktree', () => {
  assert.equal(decide('paper', 'read', 'data.csv').tier, 'safe');
  assert.equal(decide('paper', 'edit', 'sections/intro.tex').tier, 'safe');
  assert.equal(decide('paper', 'create', 'refs.bib').tier, 'safe');
  assert.equal(decide('paper', 'overwrite', 'main.tex').tier, 'ask');
  for (const file of ['data.csv', 'analysis.py', 'paper.sty', 'latexmkrc', 'figure.png']) assert.equal(decide('paper', 'edit', file).tier, 'ask', file);
  assert.equal(decide('paper', 'delete', 'main.tex').tier, 'ask');
  assert.equal(decide('paper', 'move', 'main.tex').tier, 'ask');
  assert.equal(decide('full', 'delete', 'main.tex').tier, 'safe');
  assert.equal(decide('read-only', 'edit', 'main.tex').tier, 'refuse');
  const dir = paper();
  assert.equal(resolveInside(dir, 'sections/method.tex').rel, 'sections/method.tex');
  assert.throws(() => resolveInside(dir, '../outside.tex'), /outside the task worktree/);
  assert.throws(() => resolveInside(dir, '/etc/passwd'), /outside the task worktree/);
  assert.throws(() => resolveInside(dir, '.git/config'), /Git's own folder/);
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'escape'));
  assert.throws(() => resolveInside(dir, 'escape/x.tex'), /outside the task worktree/);
});

test('the reading text sees through macros, line breaks and comments, and remembers source offsets', () => {
  const source = String.raw`We present \method, a model that \emph{learns} % hidden
to~fly \cite{a,b}.`;
  const macros = simpleMacros([String.raw`\newcommand{\method}{FlowNet} \newcommand{\vect}[1]{\mathbf{#1}}`]);
  assert.deepEqual([...macros], [['method', 'FlowNet']]);
  const view = project(source, macros);
  assert.equal(view.text, 'We present FlowNet, a model that learns to fly [cite].');
  const at = view.text.indexOf('to fly');
  assert.equal(source.slice(view.offsets[at], view.offsets[at] + 2), 'to');
});

test('the paper map is made from the build: the title TeX stored, the printed abstract and the PDF\'s numbering', { skip: !hasTeX() }, async () => {
  const dir = paper(), compiled = compile(dir);
  const map = await paperMap(dir, { compiled });
  assert.match(map.text, /^Made from the build of 09:30 UTC \(1 pages\)/);
  assert.match(map.text, /^Title \(main\.tex:4\): Learning to Fly$/m);
  assert.match(map.text, /Abstract \(main\.tex:8-9\):\nWe present FlowNet, a model that learns to fly\.$/m);
  assert.match(map.text, /^Main file: main\.tex \(class article\)$/m);
  assert.match(map.text, /^Files TeX read \(2\): main\.tex \(20 lines\), sections\/method\.tex \(6 lines\)$/m);
  assert.match(map.text, /^- 1 Introduction \(p\. 1\) — main\.tex:11-14 \(\d+ words\) \[sec:intro\]$/m);
  assert.match(map.text, /^- 2 Method \(p\. 1\) — sections\/method\.tex:1-5 \(\d+ words\) \[sec:method\]$/m);
  assert.match(map.text, /^ {2}- 2\.1 Loss \(p\. 1\) — sections\/method\.tex:3-5 /m);
  assert.match(map.text, /^- 3 Results \(p\. 1\) — main\.tex:16-18 /m);
  assert.match(map.text, /^Undefined references in that build: fig:missing$/m);
  assert.match(map.text, /^- figure 1 \(p\. 1\) fig:arch sections\/method\.tex:5 "The architecture of the model\."$/m);
  assert.match(map.text, /\\method, \\vect\[1\]/);
  assert.match(map.text, /^References: 1 entry in refs\.bib, 1 cited\.$/m);
  // Edits after the build keep its structure, with the lines carried over.
  fs.writeFileSync(path.join(dir, 'sections', 'method.tex'), '% Notes\n% more notes\n' + fs.readFileSync(path.join(dir, 'sections', 'method.tex'), 'utf8'));
  const later = await paperMap(dir, { compiled });
  assert.match(later.text, /^Edited since that build: sections\/method\.tex\./m);
  assert.match(later.text, /^- 2 Method \(p\. 1\) — sections\/method\.tex:3-7 /m);
  assert.match(later.text, /^ {2}- 2\.1 Loss \(p\. 1\) — sections\/method\.tex:5-7 /m);
  // Without a build there is no outline to guess at.
  const none = await paperMap(dir);
  assert.match(none.text, /^The paper has not been compiled yet, so there is no map of its sections\./);
  assert.equal(none.outline.length, 0);
});

test('after the first map, a turn brings only what changed in it', () => {
  const map = 'Title (main.tex:4): Fly\n\n- 1 Introduction (p. 1)\n- 2 Method (p. 2)\n- 3 Results (p. 3)\n- 4 Discussion (p. 4)';
  assert.equal(mapUpdate(map, map), '');
  const update = mapUpdate(map, map.replace('2 Method (p. 2)', '2 Approach (p. 2)'))!;
  assert.match(update, /^<paper-map-update>/);
  assert.match(update, /^- - 2 Method \(p\. 2\)\n\+ - 2 Approach \(p\. 2\)$/m);
  assert.doesNotMatch(update, /Introduction/);
  assert.equal(mapUpdate(map, 'Something else entirely\nand more'), null, 'A map that mostly changed is sent whole');
});

function host(dir: string, overrides: Partial<ToolHost> = {}): ToolHost & { approvals: string[] } {
  const approvals: string[] = [];
  return {
    approvals, cwd: dir, mode: () => 'paper', approve: async request => { approvals.push(request.title); return true; }, ask: async () => [],
    papilot: async () => ({ success: true, text: '' }), lastBuild: () => null, recordBuild: () => {}, chore: () => null, enterChore: async () => true, exitChore: () => {},
    ...overrides,
  };
}
const call = async (tools: ReturnType<typeof writerTools>, name: string, params: unknown, signal?: AbortSignal) => {
  const result = await tools.find(tool => tool.name === name)!.execute('id', params as never, signal, undefined, undefined as never);
  return result.content.map(part => part.type === 'text' ? part.text : '[image]').join('\n');
};

test('the paper tools find text, outline sections and edit LaTeX without asking', { skip: !hasTeX() }, async () => {
  const dir = paper(), h = host(dir, { papilot: built(compile(paper())) }), tools = writerTools(h);
  assert.deepEqual(tools.map(tool => tool.name).filter(name => ['run_command', 'enter_chore_mode', 'search_text'].includes(name)), ['search_text', 'enter_chore_mode', 'run_command']);
  const found = await call(tools, 'search_text', { query: 'FlowNet is fast' });
  assert.match(found, /^main\.tex:12: ….*FlowNet is fast\./m);
  assert.match(await call(tools, 'search_text', { query: 'section [ref] and in [cite], it generalizes' }), /main\.tex:12-14/);
  assert.match(await call(tools, 'paper_outline', { section: 'sec:method' }), /^- 2 Method \(p\. 1\) — sections\/method\.tex:1-5 .*\n {2}- 2\.1 Loss/);
  assert.match(await call(tools, 'read_file', { section: 'Loss' }), /sections\/method\.tex:3-5/);
  assert.match(await call(tools, 'find_references', { name: 'sec:method' }), /label: sections\/method\.tex:1.*\nreference: main\.tex:12/s);
  const diff = await call(tools, 'edit_file', { path: 'sections/method.tex', edits: [{ old_text: 'The loss is small.', new_text: 'The loss is tiny.' }] });
  assert.match(diff, /-The loss is small\.\n\+The loss is tiny\./);
  assert.deepEqual(h.approvals, []);
  await assert.rejects(call(tools, 'edit_file', { path: 'main.tex', edits: [{ old_text: 'section', new_text: 'x' }] }), /more than once/);
});

test('changing data asks first, a declined change is not made, and commands need chore mode', async () => {
  const dir = paper(), declined = host(dir, { approve: async () => false });
  await assert.rejects(call(writerTools(declined), 'edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] }), /declined/);
  assert.equal(fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'), 'x,y\n1,2\n');
  const h = host(dir);
  await call(writerTools(h), 'edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] });
  assert.deepEqual(h.approvals, ['Edit data.csv']);
  await assert.rejects(call(writerTools(h), 'run_command', { command: 'echo hi' }), /only in chore mode/);
  const readOnly = writerTools(host(dir, { mode: () => 'read-only' })).map(tool => tool.name);
  assert.ok(readOnly.includes('search_text') && !readOnly.includes('edit_file') && !readOnly.includes('run_command'));
});

for (const scenario of ['timeout', 'cancel', 'cancel without pipes']) test(`chore commands stop their descendants on ${scenario}`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot command ')), stop = new AbortController();
  const tools = writerTools(host(dir, { chore: () => ({ reason: 'Test cancellation' }) }));
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  fs.writeFileSync(path.join(dir, 'child.cjs'), `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync('child.pid', String(process.pid));
    setInterval(() => fs.appendFileSync('writes', 'x'), 20);
  `);
  fs.writeFileSync(path.join(dir, 'parent.cjs'), `
    require('node:fs').writeFileSync('parent.pid', String(process.pid));
    require('node:child_process').spawn(process.execPath, ['child.cjs'], { stdio: ${JSON.stringify(scenario === 'cancel without pipes' ? 'ignore' : 'inherit')} });
    setInterval(() => {}, 1000);
  `);
  try {
    const result = call(tools, 'run_command', { command: `"${process.execPath}" parent.cjs`, timeout_seconds: scenario === 'timeout' ? 2 : 60 }, stop.signal);
    let finished: string | undefined;
    void result.then(output => { finished = output; }, error => { finished = String(error); });
    const bounded = Promise.race([result, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('The command did not stop its descendants')), 8000); })]);
    void bounded.catch(() => {}); // Readiness can fail before this is awaited.
    // The descendant installs a SIGTERM handler before the cancellation lands.
    for (let i = 0; i < 200 && finished === undefined && !fs.existsSync(path.join(dir, 'writes')); i++) await wait(10);
    assert.ok(fs.existsSync(path.join(dir, 'writes')), finished || 'The descendant started writing');
    if (scenario !== 'timeout') stop.abort();
    const output = await bounded;
    if (scenario === 'timeout') assert.match(output, /stopped after 2 s/);
    // Descendants with closed output pipes must also stop before the tool returns.
    await wait(100);
    const writes = fs.readFileSync(path.join(dir, 'writes'), 'utf8');
    await wait(150);
    assert.equal(fs.readFileSync(path.join(dir, 'writes'), 'utf8'), writes);
  } finally {
    clearTimeout(deadline); stop.abort();
    for (const file of ['parent.pid', 'child.pid']) {
      if (fs.existsSync(path.join(dir, file))) killTree(Number(fs.readFileSync(path.join(dir, file), 'utf8')), 'SIGKILL');
    }
    await wait(100);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a chore command cancelled before it starts does not write to the worktree', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot cancelled command '));
  try {
    const tools = writerTools(host(dir, { chore: () => ({ reason: 'Already cancelled' }) }));
    await assert.rejects(call(tools, 'run_command', { command: 'echo changed > changed.txt' }, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(fs.existsSync(path.join(dir, 'changed.txt')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Claude subscription tokens are refused and credentials stay in Papilot', async () => {
  const { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  const storage = AuthStorage.inMemory();
  const credentials = new WriterCredentials(storage, { ANTHROPIC_API_KEY: 'sk-ant-oat01-abc', OPENAI_API_KEY: 'sk-test' });
  assert.ok(claudeSubscription('sk-ant-oat01-abc'));
  assert.equal(credentials.usable('anthropic'), false);
  assert.throws(() => credentials.setKey('anthropic', 'sk-ant-oat01-xyz'), /subscription token/);
  credentials.setKey('anthropic', 'sk-ant-api03-key');
  assert.equal(credentials.usable('anthropic'), true);
  const status = credentials.status().providers;
  assert.deepEqual(status.filter(p => p.configured).map(p => [p.id, p.source]), [['anthropic', 'stored'], ['openai', 'environment']]);
  assert.deepEqual(status.filter(p => p.kind === 'login').map(p => p.id), ['openai-codex', 'github-copilot']);
});

test('tool calls show as file changes, commands, page views or named tools', () => {
  assert.equal(toolItem('1', 'edit_file', { path: 'a.tex' }).type, 'fileChange');
  assert.equal(toolItem('2', 'run_command', { command: 'make' }).type, 'commandExecution');
  assert.deepEqual(toolItem('3', 'view_pages', { pages: ['3'] }), { id: '3', type: 'dynamicToolCall', tool: 'view_pdf', arguments: { pages: ['3'] }, status: 'inProgress' });
  assert.equal(toolItem('4', 'search_text', { query: 'flow' }).text, 'Search text flow');
});

test('Papilot Writer runs a turn on Pi: map first, approvals through Papilot, chore mode within the turn', { timeout: 60000, skip: !hasTeX() }, async () => {
  const dir = paper(), compiled = compile(dir), data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer data '));
  const ai = await import('@mariozechner/pi-ai'), { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  const faux = ai.registerFauxProvider({ provider: 'faux', models: [{ id: 'writer', reasoning: false }] });
  const prompts: string[] = [];
  faux.setResponses([
    context => { prompts.push(JSON.stringify(context.messages.at(-1))); return ai.fauxAssistantMessage(ai.fauxToolCall('edit_file', { path: 'sections/method.tex', edits: [{ old_text: 'small', new_text: 'tiny' }] }), { stopReason: 'toolUse' }); },
    ai.fauxAssistantMessage(ai.fauxToolCall('edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] }), { stopReason: 'toolUse' }),
    ai.fauxAssistantMessage(ai.fauxToolCall('enter_chore_mode', { chore: 'Count lines', plan: 'wc -l data.csv' }), { stopReason: 'toolUse' }),
    context => { prompts.push(JSON.stringify(context.messages.at(-1))); return ai.fauxAssistantMessage(ai.fauxToolCall('run_command', { command: 'echo chore-done' }), { stopReason: 'toolUse' }); },
    ai.fauxAssistantMessage(ai.fauxToolCall('exit_chore_mode', { summary: 'Counted.' }), { stopReason: 'toolUse' }),
    ai.fauxAssistantMessage('Made the loss tiny.'),
    context => { prompts.push(JSON.stringify(context.messages.at(-1))); return ai.fauxAssistantMessage('It reads well.'); },
  ]);
  try {
    // Refreshing the registry would drop the faux provider's registration.
    class Writer extends WriterAgent { available() { return [faux.getModel()] as never; } async refreshModels() {} }
    const agent = new Writer({ dir: data, auth: AuthStorage.inMemory({ faux: { type: 'api_key', key: 'test' } }) });
    const notes: any[] = [], requests: any[] = [];
    agent.on('notification', note => notes.push(note));
    agent.on('request', request => {
      // Papilot answers where the latest build is.
      if (request.method === 'item/tool/call' && request.params.tool === 'paper_build') { setImmediate(() => agent.respond(request.id, { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(compiled) }] })); return; }
      requests.push(request); setImmediate(() => agent.respond(request.id, { decision: 'accept' }));
    });
    await agent.start();
    const { thread } = await agent.request('thread/start', { cwd: dir, developerInstructions: 'Task instructions.' });
    const done = new Promise<any>(resolve => agent.on('notification', note => { if (note.method === 'turn/completed') resolve(note.params.turn); }));
    await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Make the loss tiny.' }], model: 'faux/writer' });
    const turn = await done;
    assert.equal(turn.status, 'completed', turn.error?.message);
    assert.match(prompts[0], /<paper-map>[\s\S]*Title \(main\.tex:4\): Learning to Fly[\s\S]*Make the loss tiny\./);
    assert.match(prompts[1], /Chore mode is now on for: Count lines/);
    assert.match(fs.readFileSync(path.join(dir, 'sections/method.tex'), 'utf8'), /The loss is tiny\./);
    assert.equal(fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'), 'x,y\n1,3\n');
    assert.deepEqual(requests.map(r => r.method), ['item/fileChange/requestApproval', 'item/commandExecution/requestApproval']);
    assert.match(requests[1].params.reason, /Enter chore mode: Count lines/);
    const completed = notes.filter(n => n.method === 'item/completed').map(n => n.params.item);
    assert.deepEqual(completed.filter(item => item.type === 'fileChange').map(item => item.changes[0].path), ['sections/method.tex', 'data.csv']);
    assert.match(completed.find(item => item.type === 'commandExecution').aggregatedOutput, /chore-done/);
    assert.equal(completed.at(-1).text, 'Made the loss tiny.');
    assert.ok(fs.existsSync(path.join(data, 'sessions', `${thread.id}.jsonl`)), 'the session is kept for resuming');
    // The next turn brings only what changed in the map: the edited file.
    const again = new Promise<any>(resolve => agent.on('notification', note => { if (note.method === 'turn/completed') resolve(note.params.turn); }));
    await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Does it read well?' }], model: 'faux/writer' });
    assert.equal((await again).status, 'completed');
    assert.doesNotMatch(prompts[2], /<paper-map>/);
    assert.match(prompts[2], /<paper-map-update>[\s\S]*\+ Edited since that build: sections\/method\.tex\.[\s\S]*Does it read well\?/);
    agent.close();
  } finally { faux.unregister(); }
});

test('models come from each provider\'s own list, with Pi\'s entries only as templates', async () => {
  const ai = await import('@mariozechner/pi-ai');
  const { listModels, fromList } = await import('../src/server/writer/models.ts');
  const builtins = ai.getModels('openai-codex') as any[];
  const token = ['x', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } })).toString('base64url'), 'y'].join('.');
  let seen: { url: string; headers: any } | null = null;
  const fetcher = async (url: string, init?: RequestInit) => {
    seen = { url, headers: init?.headers };
    return new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-mini', display_name: 'GPT-6 Mini', priority: 2, visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', priority: 1, visibility: 'list', context_window: 400000 },
      { slug: 'internal-eval', priority: 0, visibility: 'hide' },
    ] }));
  };
  const listed = await listModels('openai-codex', token, builtins[0], fetcher, '0.164.0');
  assert.match(seen!.url, /\/codex\/models\?client_version=0\.164\.0$/);
  assert.equal(seen!.headers['chatgpt-account-id'], 'acct-1');
  assert.deepEqual(listed!.map(entry => entry.id), ['gpt-6-astra', 'gpt-6-mini'], 'Hidden models are left out; the backend\'s order is kept');
  const models = fromList(listed!, builtins);
  assert.equal(models[0].name, 'GPT-6-Astra');
  assert.equal(models[0].contextWindow, 400000);
  assert.equal(models[0].api, builtins[0].api, 'Request settings come from a built-in entry');
  assert.equal(models[0].baseUrl, builtins[0].baseUrl);
  assert.deepEqual(models[0].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'An unknown model has no made-up prices');
});

test('Papilot Writer lists the provider\'s models and falls back to Pi\'s entries when the list is unavailable', async () => {
  const { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  let online = true;
  const fetcher = async (url: string) => {
    if (!online) throw new Error('offline');
    assert.equal(url, 'https://api.openai.com/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-6' }, { id: 'text-embedding-3-large' }, { id: 'gpt-realtime' }, { id: 'gpt-5.4' }] }));
  };
  const listed = new WriterAgent({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer models ')), auth: AuthStorage.inMemory({ openai: { type: 'api_key', key: 'sk-test' } }), env: {}, fetch: fetcher });
  await listed.start();
  const data = (await listed.request('model/list')).data, ids = data.map((model: any) => model.model);
  assert.ok(data.every((model: any) => model.source === 'OpenAI' && !model.displayName.includes(' · ')), 'The provider is a group in the picker, not a suffix');
  assert.deepEqual([...ids].sort(), ['openai/gpt-5.4', 'openai/gpt-6']);
  online = false;
  const offline = new WriterAgent({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer models ')), auth: AuthStorage.inMemory({ openai: { type: 'api_key', key: 'sk-test' } }), env: {}, fetch: fetcher });
  await offline.start();
  const fallback = (await offline.request('model/list')).data.map((model: any) => model.model);
  assert.ok(fallback.length > 2 && fallback.every((id: string) => id.startsWith('openai/')), 'Pi\'s built-in entries stand in');
});

test('tool calls read as sentences and a run of them as a summary of what happened', async () => {
  const { toolSentence, toolSummary, toolIcon } = await import('../src/web/tool-calls.ts');
  const tool = (id: string, name: string, args: Record<string, unknown>) => {
    const item = toolItem(id, name, args) as any;
    return { id, taskId: 't', createdAt: 0, type: 'tool', text: item.text, tool: { kind: item.kind, target: item.target, ...(item.lines ? { lines: item.lines } : {}) } };
  };
  const read = tool('2', 'read_file', { path: 'paper.tex', start_line: 1, end_line: 362 });
  assert.equal(toolSentence(read), 'Read paper.tex, lines 1–362');
  assert.equal(toolIcon(read), 'paper');
  const items = [tool('1', 'list_files', {}), read, tool('3', 'read_file', { path: 'sections/intro.tex' }), tool('4', 'read_file', { path: 'paper.tex', start_line: 363 }),
    tool('5', 'search_text', { query: 'flow' }), tool('6', 'search_source', { pattern: '\\cite' }), { id: '7', taskId: 't', createdAt: 0, type: 'command', text: 'make' }];
  const summary = toolSummary(items, () => []);
  assert.equal(summary.text, 'Listed the files, read 2 files, searched 2 times, ran 1 command');
  assert.equal(summary.icon, 'paper', 'The icon follows what the run did most');
  assert.equal(toolSummary([tool('8', 'read_file', { path: 'macros.tex' })], () => []).text, 'Read macros.tex');
  assert.equal(toolSentence({ id: '9', taskId: 't', createdAt: 0, type: 'tool', text: 'server / tool' }), null, 'Other agents keep their own text');
});

test('a read names the sections it covered and the pages they print on', { skip: !hasTeX() }, async () => {
  const { sectionsOf } = await import('../src/server/writer/tools.ts');
  const { toolSentence, toolNote, toolSummary } = await import('../src/web/tool-calls.ts');
  const dir = paper(), compiled = compile(dir), outline = (await paperMap(dir, { compiled })).outline;
  assert.deepEqual(sectionsOf(outline, 'sections/method.tex', 1, 5), { sections: [{ number: '2', title: 'Method' }] }, 'A section read whole is named at its highest level');
  assert.deepEqual(sectionsOf(outline, 'sections/method.tex', 4, 4), { sections: [{ number: '2.1', title: 'Loss' }], partial: true }, 'Part of a section names the innermost one');
  assert.equal(sectionsOf(outline, 'refs.bib', 1, 3), null);
  // The pages come from SyncTeX through Papilot; the read reports both.
  const asked: any[] = [];
  const tools = writerTools(host(dir, { papilot: async (tool, args) => { asked.push([tool, args]); return tool === 'paper_build' ? built(compiled)(tool) : { success: true, text: '[4,5]' }; } }));
  const read = tools.find(item => item.name === 'read_file')!;
  const result: any = await read.execute('call', { path: 'sections/method.tex', start_line: 3, end_line: 5 }, undefined, undefined, undefined as never);
  assert.ok(asked.some(([tool]) => tool === 'source_pages'));
  assert.deepEqual(result.details.place, { sections: [{ number: '2.1', title: 'Loss' }], pages: [4, 5] });
  const item = { id: 'r', taskId: 't', createdAt: 0, type: 'tool', text: '', tool: { kind: 'read', target: 'sections/method.tex', lines: '3-5', place: result.details.place } };
  assert.equal(toolSentence(item), 'Read §2.1 Loss');
  assert.equal(toolNote(item), 'pages 4–5 · sections/method.tex, lines 3–5');
  assert.equal(toolSummary([item, { ...item, id: 's', tool: { ...item.tool, target: 'main.tex', place: { sections: [], pages: [2, 2] } } }], () => []).text, 'Read 2 files on pages 2–5');
});

test('The context breakdown names what fills the window and adds up to what the provider counted', () => {
  const map = '<paper-map>' + 'x'.repeat(4000) + '</paper-map>';
  const session = {
    systemPrompt: 's'.repeat(8000),
    getActiveToolNames: () => ['read_file'],
    getAllTools: () => [{ name: 'read_file', description: 'd'.repeat(400), parameters: {} }, { name: 'unused', description: 'u'.repeat(9000), parameters: {} }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: map + 'Tighten the abstract.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'r'.repeat(400) }, { type: 'toolCall', name: 'read_file', arguments: { path: 'main.tex' } }] },
      { role: 'toolResult', content: [{ type: 'text', text: 't'.repeat(2000) }, { type: 'image' }] },
      { role: 'compactionSummary', summary: 'm'.repeat(800) },
    ],
  } as any;
  const parts = contextBreakdown(session, 10000, 200000);
  const of = (id: string) => parts.find(part => part.id === id)?.tokens || 0;
  assert.deepEqual(parts.map(part => part.id), ['system', 'tools', 'map', 'messages', 'replies', 'toolCalls', 'toolResults', 'summaries', 'reserve', 'free']);
  assert.equal(parts.filter(part => part.id !== 'reserve' && part.id !== 'free').reduce((sum, part) => sum + part.tokens, 0), 10000, 'The used parts add up to the reported total');
  assert.equal(of('reserve'), COMPACTION_RESERVE);
  assert.equal(of('free'), 200000 - 10000 - COMPACTION_RESERVE);
  assert.ok(of('system') > of('map') && of('map') > of('messages'), 'The paper map is told apart from what the author wrote');
  assert.ok(of('tools') < of('replies') * 2, 'Inactive tools are not counted');
  // Near the limit, the reserve is only what is left.
  const full = contextBreakdown(session, 195000, 200000);
  assert.equal(full.find(part => part.id === 'reserve')?.tokens, 5000);
  assert.equal(full.find(part => part.id === 'free')?.tokens, 0);
});

test('the paper map leaves out what TeX skipped: comments, a comment environment and a switched-off part', { skip: !hasTeX() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer title '));
  fs.writeFileSync(path.join(dir, 'main.tex'), String.raw`\documentclass{article}
\usepackage{verbatim}
% \title{An Old Working Title}
\title{The Real Title}
\begin{document}
\begin{abstract}
We cut errors by 50\% overall. % not this
\begin{comment}
A draft sentence.
\end{comment}
\end{abstract}
\iffalse
\section{Hidden}
\fi
\section{Shown}
Text.
\end{document}
`);
  const map = await paperMap(dir, { compiled: compile(dir) });
  assert.match(map.text, /^Title \(main\.tex:4\): The Real Title$/m);
  assert.match(map.text, /^Abstract \(main\.tex:7-10\):\nWe cut errors by 50% overall\.$/m);
  assert.match(map.text, /^- 1 Shown \(p\. 1\) — main\.tex:15-16 /m);
  assert.doesNotMatch(map.text, /Old Working Title|draft sentence|not this|Hidden/);
  assert.equal(blankComments('a\\% b % c\n\\\\% d'), 'a\\% b    \n\\\\   ', 'An escaped % stays; one after \\\\ starts a comment');
});

test('an edit is shown as its diff and named by the parts of the paper it changed', () => {
  const heading = (id: string, number: string, title: string, level: number, ranges: [number, number][], page: string, parent: string | null = null) =>
    ({ id, number, title, kind: 'section', level, file: 'main.tex', line: ranges[0][0], labels: [], ranges: { 'main.tex': ranges }, parent, page });
  const outline = [heading('s1', '1', 'Introduction', 1, [[10, 30]], '1'), heading('s2', '2', 'Parsing', 1, [[31, 80]], '3'), heading('s2.1', '2.1', 'A Simple Implementation', 2, [[40, 60]], '4', 's2')];
  const diff = '--- a/main.tex\n+++ b/main.tex\n@@ -12,2 +12,3 @@\n a\n-b\n+c\n+d\n@@ -44,1 +45,1 @@\n-x\n+y\n@@ -50,1 +51,1 @@\n-p\n+q\n';
  const edit = fileEdit('main.tex', diff, outline);
  assert.equal(edit.added, 4); assert.equal(edit.removed, 3);
  assert.deepEqual(edit.places, [
    { sections: [{ number: '1', title: 'Introduction' }], page: '1', lines: '12–14', added: 2, removed: 1 },
    { sections: [{ number: '2.1', title: 'A Simple Implementation' }], page: '4', lines: '45–51', added: 2, removed: 2 },
  ]);
  assert.match(edit.diff!, /\+d/);
  // A new file comes as its whole text, and a file outside the paper has no places.
  const added = fileEdit('notes.md', 'one\ntwo\n', outline, 'add');
  assert.deepEqual([added.added, added.removed, added.places], [2, 0, undefined]);
  assert.match(added.diff!, /^@@ -0,0 \+1,2 @@\n\+one\n\+two/);
});

test('references, contents and macros are read from LaTeX\'s syntax, not its look', async () => {
  const dir = paper();
  fs.appendFileSync(path.join(dir, 'sections', 'method.tex'), String.raw`% \ref{sec:method} in a comment is not a reference
\verb|\cite{smith2020}| is code. \Cref{sec:intro,sec:method} and \citep[p.~2]{jones,smith2020}.
\DeclareRobustCommand{\loss}{L} \def\fast{quick} \loss\ is \fast.
`);
  const tools = writerTools(host(dir));
  const found = await call(tools, 'find_references', { name: 'sec:method' });
  assert.deepEqual(found.split('\n').map(line => line.split(': ').slice(0, 2).join(': ')), ['label: sections/method.tex:1', 'reference: main.tex:12', 'reference: sections/method.tex:7']);
  const cited = await call(tools, 'find_references', { name: 'smith2020' });
  assert.deepEqual(cited.split('\n').map(line => line.split(': ').slice(0, 2).join(': ')), ['bib entry: refs.bib:1', 'citation: main.tex:13', 'citation: sections/method.tex:7']);
  const loss = await call(tools, 'find_references', { name: '\\loss' });
  assert.deepEqual(loss.split('\n').map(line => line.split(': ').slice(0, 2).join(': ')), ['definition: sections/method.tex:8']);
  assert.match(await call(tools, 'find_references', { name: '\\fast' }), /^definition: sections\/method\.tex:8/);
  assert.deepEqual(contentsEntry(String.raw`\protect \numberline {2.1}A \emph {Simple}~Implementation\relax`), { number: '2.1', title: 'A Simple Implementation' });
  assert.deepEqual(contentsEntry('Introduction'), { number: '', title: 'Introduction' });
  assert.equal(onlyInput(String.raw`\input{sections/method}`), true);
  assert.equal(onlyInput(String.raw`\input{a} and text`), false);
  assert.equal(wordCount(String.raw`We train \emph{a} model~\cite{x} % not this
on 3 birds.`), 8, 'A citation counts as one word, as it reads: [cite]');
});


test('Writer uses the common annotation tools without entering shell mode', async () => {
  const received: unknown[] = [];
  const h = host('/unused', { papilot: async (tool, args) => { received.push([tool, args]); return { success: true, text: '{"saved":true}' }; } });
  const tools = writerTools(h);
  assert.equal(await call(tools, 'annotation_create', { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Clarify.', group: 'green', stamp: 'Verify', requestId: 'one' }), '{"saved":true}');
  assert.equal(await call(tools, 'annotation_update', { id: 'note-1', revision: 'rev-1', group: null, stamp: 'Polish' }), '{"saved":true}');
  assert.deepEqual(received, [
    ['annotation_create', { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Clarify.', group: 'green', stamp: 'Verify', requestId: 'one' }],
    ['annotation_update', { id: 'note-1', revision: 'rev-1', group: null, stamp: 'Polish' }],
  ]);
  const createTool = tools.find(tool => tool.name === 'annotation_create')!;
  const updateTool = tools.find(tool => tool.name === 'annotation_update')!;
  for (const args of [
    { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Clarify.', group: 'green', stamp: 'Verify', requestId: 'one' },
    { key: 'pdf', start: 'p1-l1', end: 'p1-l1', group: 'yellow', requestId: 'two' },
  ]) {
    assert.deepEqual(validateToolArguments(createTool, { type: 'toolCall', id: 'c', name: 'annotation_create', arguments: args }), args);
  }
  for (const args of [
    { id: 'note-1', revision: 'rev-1', group: 'red', stamp: 'Check' },
    { id: 'note-1', revision: 'rev-1', group: null, stamp: null },
  ]) {
    assert.deepEqual(validateToolArguments(updateTool, { type: 'toolCall', id: 'u', name: 'annotation_update', arguments: args }), args);
  }
  for (const [tool, bad] of [
    [createTool, { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Hi', group: 'blue', requestId: 'bad-1' }],
    [createTool, { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Hi', group: '', requestId: 'bad-2' }],
    [createTool, { key: 'pdf', start: 'p1-l1', end: 'p1-l1', comment: 'Hi', stamp: 'a'.repeat(41), requestId: 'bad-3' }],
    [updateTool, { id: 'note-1', revision: 'rev-1', group: 'blue' }],
    [updateTool, { id: 'note-1', revision: 'rev-1', group: '' }],
    [updateTool, { id: 'note-1', revision: 'rev-1', stamp: 'a'.repeat(41) }],
  ] as const) {
    assert.throws(() => validateToolArguments(tool, { type: 'toolCall', id: 'bad', name: tool.name, arguments: bad }), /Validation failed/);
  }
  assert.equal(h.approvals.length, 0);
  assert.equal(writerTools(host('/unused', { mode: () => 'read-only' })).some(tool => tool.name === 'annotation_create'), false);
});
