// Real, disposable TeX publication and option previews; no agent is needed.
// Run with: node --import tsx scripts/check-note-preview-performance.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Fixture, METHOD } from '../engine/tests/ts/helpers.ts';
import { Builder } from '../engine/src/core/build.ts';
import { createServer } from '../engine/src/server.ts';

const fixture = new Fixture(), app = fixture.app();
await app.ready;
const server = createServer(app), builds = [], lookups = [], renders = [], report = {};
const build = Builder.prototype.build, completed = Builder.prototype.completed;
const spawn = childProcess.spawn;
let buildStarted;
childProcess.spawn = function (...args) {
  const start = performance.now(), child = spawn.apply(this, args);
  if (args[1]?.some(arg => /[/\\]render[/\\]worker\.ts$/.test(arg)))
    child.once('close', () => renders.push({ processMs: Math.round(performance.now() - start) }));
  return child;
};
syncBuiltinESMExports();
Builder.prototype.build = async function (...args) {
  buildStarted?.();
  const start = performance.now(), result = await build.apply(this, args);
  builds.push({ ms: Math.round(performance.now() - start), compilerSeconds: result.seconds, key: result.key });
  return result;
};
Builder.prototype.completed = async function (...args) {
  const start = performance.now(), result = await completed.apply(this, args);
  lookups.push({ ms: Math.round(performance.now() - start), hit: Boolean(result) });
  return result;
};
try {
  const task = app.tasks.create('preview-timing', 'Synthetic alternative timings', [], ['paper'], true);
  fixture.edit(task, METHOD, 'Method sentence 2.', 'Approach sentence two.');
  fixture.edit(task, METHOD, 'Detail sentence 15.', 'Precise proposal 15.');
  const start = performance.now(), job = app.publisher.submit(task.name);
  await app.publisher.join();
  assert.equal(app.publisher.job(job.id).status, 'done');
  report.publicationMs = Math.round(performance.now() - start);
  const round = app.review.latestRound(task.name), original = fixture.read(METHOD, task.worktree);
  const units = ['Approach', 'Precise'].map(text => round.units.find(unit => unit.new_text.includes(text)));
  assert.ok(units.every(Boolean), JSON.stringify(round.units.map(unit => unit.new_text)));
  await server.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  app.url = origin;
  const preview = async (unit, text, background = false) => {
    const start = performance.now();
    const response = await fetch(`${origin}/api/tasks/${task.name}/source/options/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': app.csrf },
      body: JSON.stringify({ id: text, round: round.number, edits: [{ unit: unit.id, text: unit.new_text.replace(/Approach|Precise/, text) }], background }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200, JSON.stringify(detail));
    return { ms: Math.round(performance.now() - start), detail };
  };
  builds.length = 0; lookups.length = 0; renders.length = 0;
  const cold = await preview(units[0], 'Procedure');
  report.cold = { responseMs: cold.ms, builds: [...builds], baselineLookups: [...lookups], renders: [...renders] };
  builds.length = 0; lookups.length = 0; renders.length = 0;
  const started = new Promise(resolve => { buildStarted = resolve; });
  const warming = preview(units[1], 'Expanded', true);
  await Promise.race([started, warming]); buildStarted = undefined;
  const selected = preview(units[1], 'Expanded');
  const [warm, joined] = await Promise.all([warming, selected]);
  assert.equal(warm.detail.files, joined.detail.files);
  assert.equal(builds.length, 1, 'Background and selection share a single candidate build');
  report.inFlight = { preparationMs: warm.ms, selectionMs: joined.ms, builds: [...builds], baselineLookups: [...lookups], renders: [...renders] };
  builds.length = 0;
  const cached = await preview(units[0], 'Procedure');
  assert.equal(cached.detail.files, cold.detail.files);
  assert.equal(builds.length, 0, 'A completed option does not compile again');
  assert.equal(fixture.read(METHOD, task.worktree), original);
  assert.equal(app.review.latestRound(task.name).number, round.number);
  report.cachedResponseMs = cached.ms;
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/note-preview-performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  childProcess.spawn = spawn; syncBuiltinESMExports();
  Builder.prototype.build = build; Builder.prototype.completed = completed;
  await server.close(); await fixture.close();
}
