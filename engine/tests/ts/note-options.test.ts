import fs from 'node:fs';
import path from 'node:path';
import { Builder } from '../../src/core/build.ts';
import * as publisher from '../../src/core/publish.ts';
import { optionCandidate, previewNoteOption } from '../../src/core/option-preview.ts';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Fixture, fakeRound, METHOD, BODY } from './helpers.ts';
import type { App } from '../../src/server.ts';
import type { Task, Unit } from '../../src/types.ts';

let f: Fixture, app: App, task: Task;
beforeEach(async () => {
  f = new Fixture(); app = f.app(); await app.ready;
  task = app.tasks.create('options', 'Note options', [], ['paper'], true);
  f.edit(task, METHOD, 'Method sentence 2.', 'Approach sentence two.');
  f.edit(task, METHOD, 'Detail sentence 15.', 'Detail proposal 15.');
  fakeRound(app, task.name);
  vi.spyOn(app.publisher, 'publish').mockResolvedValue({ outcome: 'unchanged', round: 1, changes: 3 });
});
afterEach(async () => { await f.close(); vi.restoreAllMocks(); });
const units = () => app.review.latestRound(task.name)!.units;
// Accepting a note option decides its changes in this round, with the
// option's wording instead of the round's proposal.
const option = (unit: Unit, text: string, id = `option-${unit.id}`) => app.review.decide(task.name, { id, round: 1, changes: [unit.id], action: 'accept', edits: [{ unit: unit.id, text }] });
const accepted = () => app.repo.blob(app.tasks.get(task.name).accepted, METHOD)!.toString();

it('accepts an option in this round without a new round or build, and replays its id', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  const state = await option(word, 'Procedure', 'first-option');
  expect(app.publisher.publish).not.toHaveBeenCalled();
  expect(app.publisher.current(task.name)).toBeFalsy();
  expect(app.review.latestRound(task.name)!.number).toBe(1);
  expect(state.variants).toEqual({ [word.id]: 'Procedure' });
  expect(state.decisions[word.id]).toBe('accepted');
  expect(Object.values(state.decisions).filter(decision => decision === 'pending')).toHaveLength(units().length - 1);
  expect(state.undo).toMatchObject({ id: 'first-option', kind: 'accept', worktree: true });
  // The accepted text and the task's files take the option; the manuscript
  // of a deferred task does not change until it is applied.
  expect(accepted()).toContain('Procedure sentence 2.');
  expect(accepted()).toContain('Detail sentence 15.');
  expect(f.read(METHOD, task.worktree)).toContain('Procedure sentence two.');
  expect(f.read(METHOD, task.worktree)).toContain('Detail proposal 15.');
  expect(f.read(METHOD)).toBe(BODY);
  // The id replays its own decision only.
  await option(word, 'Procedure', 'first-option');
  expect(app.store.all('SELECT id FROM actions')).toHaveLength(1);
  await expect(option(word, 'Different', 'first-option')).rejects.toThrow('already used');
  await expect(app.review.decide(task.name, { id: 'first-option', round: 1, changes: [word.id], action: 'accept' })).rejects.toThrow('already used');
  // Applying the task delivers the option's wording, with the changes still
  // pending accepted as applying them would.
  expect((await app.delivery.preview(task.name))![METHOD]!.toString()).toContain('Procedure sentence two.');
});
it('undoing an option restores the proposal in the task and the accepted text', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, before = accepted(), files = f.read(METHOD, task.worktree);
  await option(word, 'Procedure', 'undone-option');
  const state = await app.review.undo(task.name, 'undone-option');
  expect(state.decisions[word.id]).toBe('pending');
  expect(state.variants).toBeUndefined();
  expect(accepted()).toBe(before);
  expect(f.read(METHOD, task.worktree)).toBe(files);
  await expect(option(word, 'Procedure', 'undone-option')).rejects.toThrow('undone');
  await option(word, 'Technique', 'second-option');
  expect(accepted()).toContain('Technique sentence 2.');
});
it('writes the manuscript of a task that applies accepted changes directly', async () => {
  const direct = app.tasks.create('direct', 'Direct', [], ['paper']);
  f.edit(direct, METHOD, 'Method sentence 2.', 'Approach sentence two.');
  fakeRound(app, direct.name);
  const word = app.review.latestRound(direct.name)!.units.find(unit => unit.new_text === 'Approach')!;
  await app.review.decide(direct.name, { round: 1, changes: [word.id], action: 'accept', edits: [{ unit: word.id, text: 'Procedure' }] });
  expect(f.read(METHOD)).toBe(BODY.replace('Method sentence 2.', 'Procedure sentence 2.'));
  expect(f.read(METHOD, direct.worktree)).toContain('Procedure sentence two.');
});
it('keeps the original source range when an alternative includes the old wording', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  await option(word, `Revised ${word.old_text}`);
  expect(accepted()).toContain('Revised Method sentence 2.');
  expect(f.read(METHOD, task.worktree)).toContain('Revised Method sentence two.');
});
it('refuses an option shared with an accepted edit before writing any fragment', async () => {
  const [first, second] = units();
  await app.review.decide(task.name, { round: 1, changes: [first.id], action: 'accept' });
  const before = f.read(METHOD, task.worktree);
  await expect(app.review.decide(task.name, { round: 1, changes: [second.id, first.id], action: 'accept', edits: [{ unit: second.id, text: 'other' }, { unit: first.id, text: 'overwrite' }] })).rejects.toThrow('already decided');
  expect(f.read(METHOD, task.worktree)).toBe(before);
});
for (const neighbor of ['accepted', 'rejected'] as const) it(`accepts an alternative beside an ${neighbor} change on the same line`, async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, number = units().find(unit => unit.new_text === 'two')!;
  await app.review.decide(task.name, { round: 1, changes: [word.id], action: neighbor === 'accepted' ? 'accept' : 'reject' });
  await option(number, 'about 2');
  const expected = neighbor === 'accepted' ? 'Approach' : 'Method';
  expect(f.read(METHOD, task.worktree)).toContain(`${expected} sentence about 2.`);
  expect(accepted()).toContain(`${expected} sentence about 2.`);
  const decisions = app.review.decisions(task.name, app.review.latestRound(task.name)!);
  expect(decisions[word.id]).toBe(neighbor);
  expect(units().filter(unit => decisions[unit.id] === 'pending').map(unit => unit.new_text)).toEqual(['proposal']);
});
it('keeps an option\'s wording when a neighbour on its line is rejected afterwards', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, number = units().find(unit => unit.new_text === 'two')!;
  await option(word, 'Procedure');
  await app.review.decide(task.name, { round: 1, changes: [number.id], action: 'reject' });
  expect(f.read(METHOD, task.worktree)).toContain('Procedure sentence 2.');
  expect(accepted()).toContain('Procedure sentence 2.');
});
it('accepts an option that restores the original wording', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  const state = await option(word, word.old_text);
  expect(state.variants).toEqual({ [word.id]: 'Method' });
  expect(accepted()).toBe(BODY);
  expect(f.read(METHOD, task.worktree)).toContain('Method sentence two.');
});
it('accepts the intended fragment after a distant accepted edit', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, distant = units().find(unit => unit.new_text === 'proposal')!;
  await app.review.decide(task.name, { round: 1, changes: [distant.id], action: 'accept' });
  await option(word, 'Procedure');
  expect(accepted()).toContain('Procedure sentence 2.');
  expect(accepted()).toContain('Method sentence 3.');
  expect(accepted()).toContain('Detail proposal 15.');
});
it('keeps an independent manual edit outside the selected acceptance', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  f.edit(task, METHOD, 'Method sentence 4.', 'Manual sentence 4.');
  await option(word, 'Revised Method');
  expect(f.read(METHOD, task.worktree)).toContain('Manual sentence 4.');
  expect(f.read(METHOD, task.worktree)).toContain('Revised Method sentence two.');
  expect(accepted()).toContain('Revised Method sentence 2.');
  expect(accepted()).toContain('Method sentence 4.');
});
it('accepts an empty option without consuming the surrounding whitespace or neighbor', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  await option(word, '');
  expect(accepted()).toBe(BODY.replace('Method sentence 2.', ' sentence 2.'));
  expect(f.read(METHOD, task.worktree)).toBe(BODY.replace('Method sentence 2.', ' sentence two.').replace('Detail sentence 15.', 'Detail proposal 15.'));
});
it('refuses stale rounds, a passage changed in the task and malformed options', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, number = units().find(unit => unit.new_text === 'two')!, before = accepted();
  await expect(app.review.decide(task.name, { round: 99, changes: [word.id], action: 'accept', edits: [{ unit: word.id, text: 'Procedure' }] })).rejects.toThrow('newer round');
  await expect(app.review.decide(task.name, { round: 1, changes: [word.id], action: 'reject', edits: [{ unit: word.id, text: 'Procedure' }] })).rejects.toThrow('Invalid note option');
  await expect(app.review.decide(task.name, { round: 1, changes: [word.id, number.id], action: 'accept', edits: [{ unit: word.id, text: 'Procedure' }] })).rejects.toThrow('Invalid note option');
  f.edit(task, METHOD, 'Approach', 'External');
  await expect(option(word, 'Procedure')).rejects.toThrow('source changed');
  expect(app.store.all('SELECT id FROM actions')).toHaveLength(0);
  expect(accepted()).toBe(before);
  expect(f.read(METHOD, task.worktree)).toContain('External sentence two.');
});
it('keeps the preview of an accepted option, and refuses other wording for its change', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!;
  // Accepting before its preview finished; the same preview remains available.
  await option(word, 'Procedure');
  const pdf = path.join(app.state, 'accepted-preview.pdf'); fs.writeFileSync(pdf, 'test PDF');
  vi.spyOn(Builder.prototype, 'build').mockImplementation(async rev => ({ key: rev, tree: rev, targets: ['full'], root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [] }));
  vi.spyOn(publisher, 'render').mockImplementation(async out => { fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] })); });
  const preview = await previewNoteOption(app, task.name, { id: 'accepted', round: 1, edits: [{ unit: word.id, text: 'Procedure' }] });
  expect(preview.units.find(unit => unit.id === word.id)?.new_text).toBe('Procedure');
  await expect(previewNoteOption(app, task.name, { id: 'other', round: 1, edits: [{ unit: word.id, text: 'Technique' }] })).rejects.toThrow('reviewed change');
});
it('shows the source panel the option wording among the round\'s changes', async () => {
  const word = units().find(unit => unit.new_text === 'Approach')!, number = units().find(unit => unit.new_text === 'two')!;
  await app.review.decide(task.name, { round: 1, changes: [number.id], action: 'reject' });
  await option(word, 'Procedure');
  expect(app.sourceEdits.readFile(task.name, METHOD)).toMatchObject({ reviewed: true, reverted: [number.id], worded: { [word.id]: 'Procedure' } });
});

for (const replacement of ['Procedure', 'A much longer\nprocedure', '']) it(`previews exact ranges without losing neighboring IDs: ${JSON.stringify(replacement)}`, () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const original = f.read(METHOD, task.worktree);
  const candidate = optionCandidate(units(), [{ unit: selected.id, text: replacement }], () => original);
  const source = candidate.files[METHOD]!.toString();
  expect(source).toBe(original.replace('Approach', replacement));
  expect(candidate.units.map(unit => unit.id)).toEqual(units().map(unit => unit.id));
  for (const unit of candidate.units) {
    const [, , , start, end] = unit.text_ops![0];
    expect(source.slice(start, end)).toBe(unit.new_text);
    expect(unit.new_start).toBe(source.slice(0, start).split('\n').length);
    if (start === end) expect(unit.ops[0][3]).toBe(unit.ops[0][4]);
    expect(unit.new_end).toBeGreaterThanOrEqual(unit.new_start);
  }
  expect(candidate.units.map(unit => unit.old_text)).toEqual(units().map(unit => unit.old_text));
});

it('compiles an isolated preview and caches it without publishing, writing source, or deciding', async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const round = app.review.latestRound(task.name)!, decisions = app.review.decisions(task.name, round);
  const original = f.read(METHOD, task.worktree), head = app.repo.rev('HEAD');
  const pdf = path.join(app.state, 'preview-test.pdf'); fs.writeFileSync(pdf, 'test PDF');
  const errors = ['sections/method.tex:3: Undefined control sequence.'];
  const baselineErrors = ['sections/method.tex:1: Missing number.'];
  const built = vi.spyOn(Builder.prototype, 'build').mockImplementation(async rev => ({ key: rev, tree: rev, targets: ['full'], root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [], errors: rev === round.before ? baselineErrors : errors }));
  vi.spyOn(publisher, 'render').mockImplementation(async (out, request) => {
    expect(app.repo.blob(request.new.tree, METHOD)?.toString()).toContain('Procedure sentence two.');
    fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] }));
  });
  const input = { id: 'preview-only', round: 1, edits: [{ unit: selected.id, text: 'Procedure' }] };
  const [first, second] = await Promise.all([previewNoteOption(app, task.name, input), previewNoteOption(app, task.name, input)]);
  expect(first.after).toBe(second.after);
  expect(first.revisedErrors).toEqual(errors);
  expect(first.baselineErrors).toEqual(baselineErrors);
  expect(first.units.find(unit => unit.id === selected.id)?.new_text).toBe('Procedure');
  expect((await previewNoteOption(app, task.name, input)).revisedErrors).toEqual(errors);
  expect((await previewNoteOption(app, task.name, input)).baselineErrors).toEqual(baselineErrors);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-02T13:00:00Z'));
  expect((await previewNoteOption(app, task.name, input)).files).toBe(first.files);
  vi.useRealTimers();
  expect(built).toHaveBeenCalledTimes(2);
  expect(f.read(METHOD, task.worktree)).toBe(original);
  expect(f.read(METHOD)).toBe(BODY);
  expect(app.repo.rev('HEAD')).toBe(head);
  expect(app.review.latestRound(task.name)).toEqual(round);
  expect(app.review.decisions(task.name, round)).toEqual(decisions);
  expect(app.publisher.publish).not.toHaveBeenCalled();
  await app.review.decide(task.name, { round: 1, changes: [selected.id], action: 'accept' });
  await expect(previewNoteOption(app, task.name, input)).rejects.toThrow('reviewed');
});

it('reuses the published chapter scope, baseline and frozen date, compiling only the candidate', async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const round = app.review.latestRound(task.name)!;
  const date = { SOURCE_DATE_EPOCH: '1735732800', FORCE_SOURCE_DATE: '1' };
  const keys = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)], targets = ['sections/method'];
  app.store.execute('UPDATE rounds SET summary=? WHERE task=? AND number=1', JSON.stringify({ ...round.summary, date, targets, builds: keys }), task.name);
  const pdf = path.join(app.state, 'preview-test.pdf'); fs.writeFileSync(pdf, 'test PDF');
  const info = (key: string) => ({ key, tree: key, targets, root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [] });
  const completed = vi.spyOn(Builder.prototype, 'completed').mockImplementation(async key => info(key));
  const seed = vi.spyOn(Builder.prototype, 'buildSeed');
  const build = vi.spyOn(Builder.prototype, 'build').mockImplementation(async rev => info(rev));
  vi.spyOn(publisher, 'render').mockImplementation(async (out, request) => {
    expect(request.old.key).toBe(keys[1]);
    fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] }));
  });
  const detail = await previewNoteOption(app, task.name, { id: 'chapter', round: 1, edits: [{ unit: selected.id, text: 'Procedure' }] });
  expect(detail.build?.targets).toEqual(targets);
  expect(completed.mock.calls).toEqual([[keys[0]], [keys[1]]]);
  expect(seed).not.toHaveBeenCalled();
  expect(build).toHaveBeenCalledExactlyOnceWith(detail.after, targets, info(keys[0]), { date, priority: expect.any(Function) });
});

for (const phase of ['compilation', 'rendering']) it(`promotes a background comparison in place during ${phase}`, async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const pdf = path.join(app.state, 'preview-test.pdf'); fs.writeFileSync(pdf, 'test PDF');
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const compiling = deferred(), compiled = deferred();
  const rendering = deferred(), rendered = deferred();
  const priorities: (() => string)[] = [];
  const build = vi.spyOn(Builder.prototype, 'build').mockImplementation(async (rev, _targets, _seed, options) => {
    priorities.push(options!.priority as () => string); compiling.resolve(); await compiled.promise;
    return { key: rev, tree: rev, targets: ['full'], root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [] };
  });
  const render = vi.spyOn(publisher, 'render').mockImplementation(async (out, _request, _variant, priority) => {
    priorities.push(priority!); rendering.resolve(); await rendered.promise;
    fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] }));
  });
  const input = { id: 'promoted', round: 1, edits: [{ unit: selected.id, text: 'Procedure' }] };
  const warming = previewNoteOption(app, task.name, { ...input, background: true });
  let foreground: Promise<unknown> | undefined;
  try {
    await compiling.promise;
    expect(priorities.map(priority => priority())).toEqual(['background', 'background']);
    if (phase === 'rendering') { compiled.resolve(); await rendering.promise; }
    expect(priorities.at(-1)!()).toBe('background');
    foreground = previewNoteOption(app, task.name, input);
    expect(priorities.every(priority => priority() === 'foreground')).toBe(true);
    const again = previewNoteOption(app, task.name, { ...input, background: true });
    compiled.resolve(); await rendering.promise;
    expect(priorities.at(-1)!()).toBe('foreground');
    rendered.resolve();
    const [first, second, third] = await Promise.all([warming, foreground, again]);
    expect(second).toBe(first); expect(third).toBe(first);
    expect(build).toHaveBeenCalledTimes(2); expect(render).toHaveBeenCalledOnce();
    await previewNoteOption(app, task.name, input);
    expect(build).toHaveBeenCalledTimes(2);
  } finally { compiled.resolve(); rendered.resolve(); await Promise.allSettled([warming, foreground]); }
});

it('preview caches follow rejection and undo without resurrecting a neighboring edit', async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!, neighbor = units().find(unit => unit.new_text === 'two')!;
  const pdf = path.join(app.state, 'preview-test.pdf'); fs.writeFileSync(pdf, 'test PDF');
  const build = vi.spyOn(Builder.prototype, 'build').mockImplementation(async rev => ({ key: rev, tree: rev, targets: ['full'], root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [] }));
  vi.spyOn(publisher, 'render').mockImplementation(async out => {
    fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] }));
  });
  const input = { id: 'respect-rejection', round: 1, edits: [{ unit: selected.id, text: 'Procedure' }], rejected: [] as string[] };
  const first = await previewNoteOption(app, task.name, input);
  expect(app.repo.blob(first.after, METHOD)?.toString()).toContain('Procedure sentence two.');
  await app.review.decide(task.name, { id: 'reject-neighbor', round: 1, changes: [neighbor.id], action: 'reject' });
  // A rejection can land after the host checks its comparison key but before
  // the engine receives the preview request. Never cache that new state under
  // the browser's old key, which becomes reusable after undo.
  await expect(previewNoteOption(app, task.name, input)).rejects.toThrow('The review changed. Reload the options.');
  const second = await previewNoteOption(app, task.name, { ...input, rejected: [neighbor.id] });
  expect(second.files).not.toBe(first.files);
  expect(app.repo.blob(second.after, METHOD)?.toString()).toContain('Procedure sentence 2.');
  expect(second.units.map(unit => unit.id)).toEqual(first.units.filter(unit => unit.id !== neighbor.id).map(unit => unit.id));
  expect(f.read(METHOD, task.worktree)).toContain('Approach sentence 2.');
  await app.review.undo(task.name, 'reject-neighbor');
  await expect(previewNoteOption(app, task.name, { ...input, rejected: [neighbor.id] })).rejects.toThrow('The review changed. Reload the options.');
  expect((await previewNoteOption(app, task.name, input)).files).toBe(first.files);
  expect(build).toHaveBeenCalledTimes(4);
});

it('restores rejected multi-range and whole-file edits while adjusting the selected candidate', () => {
  const original = 'new word and tail';
  const selected = { ...units()[0], id: 'selected', file: 'main.tex', old_text: 'word', new_text: 'word', text_ops: [['replace', 4, 8, 4, 8]], ops: [['replace', 0, 1, 0, 1]] } as Unit;
  const rejected = { ...selected, id: 'rejected', text_ops: [['replace', 0, 3, 0, 3], ['replace', 13, 16, 13, 17]], ops: [['replace', 0, 1, 0, 1], ['replace', 0, 1, 0, 1]] } as typeof selected;
  const file = { ...selected, id: 'file', file: 'added.tex', whole_file: true };
  const candidate = optionCandidate([selected, rejected, file], [{ unit: selected.id, text: 'longer word' }], () => original,
    { ids: new Set(['rejected', 'file']), source: file => file === 'main.tex' ? Buffer.from('old word and end') : null });
  expect(candidate.files['main.tex']?.toString()).toBe('old longer word and end');
  expect(candidate.files['added.tex']).toBeNull();
  expect(candidate.units.map(unit => unit.id)).toEqual(['selected']);
});

it('a candidate restoring the original wording has no empty diff card or source row', async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const original = f.read(METHOD, task.worktree), round = app.review.latestRound(task.name)!;
  const pdf = path.join(app.state, 'preview-test.pdf'); fs.writeFileSync(pdf, 'test PDF');
  vi.spyOn(Builder.prototype, 'build').mockImplementation(async rev => ({ key: rev, tree: rev, targets: ['full'], root: task.worktree, cwd: task.worktree, pdf, seconds: 0, warnings: [] }));
  vi.spyOn(publisher, 'render').mockImplementation(async (out, request) => {
    expect(request.units.some(unit => unit.id === selected.id)).toBe(false);
    expect(app.repo.blob(request.new.tree, METHOD)?.toString()).toContain('Method sentence two.');
    fs.writeFileSync(path.join(out, 'round.json'), JSON.stringify({ units: {}, sections: [], loose: [] }));
  });
  const detail = await previewNoteOption(app, task.name, { id: 'restore-word', round: 1, edits: [{ unit: selected.id, text: selected.old_text }] });
  expect(detail.units.map(unit => unit.id)).toEqual(round.units.filter(unit => unit.id !== selected.id).map(unit => unit.id));
  expect(f.read(METHOD, task.worktree)).toBe(original);
  expect(app.review.latestRound(task.name)).toEqual(round);
  expect(app.review.decisions(task.name, round)[selected.id]).toBe('pending');
});

it('a failed candidate compilation leaves the published review and source intact', async () => {
  const selected = units().find(unit => unit.new_text === 'Approach')!;
  const round = app.review.latestRound(task.name), original = f.read(METHOD, task.worktree);
  vi.spyOn(Builder.prototype, 'build').mockRejectedValue(new Error('Invalid candidate LaTeX'));
  await expect(previewNoteOption(app, task.name, { id: 'bad-preview', round: 1, edits: [{ unit: selected.id, text: '\\broken' }] })).rejects.toThrow('Invalid candidate LaTeX');
  expect(f.read(METHOD, task.worktree)).toBe(original);
  expect(app.review.latestRound(task.name)).toEqual(round);
  expect(app.publisher.publish).not.toHaveBeenCalled();
});
