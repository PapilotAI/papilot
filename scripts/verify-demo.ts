import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA } from '../src/server/paths.ts';

if (!process.argv.includes('--allow-example-writes')) throw new Error('This check changes only the generated example manuscript. Pass --allow-example-writes to run it.');
const origin = 'http://127.0.0.1:4317';
const state = await (await fetch(origin + '/api/state')).json() as any;
const tasks = JSON.parse(fs.readFileSync(path.join(DATA, 'smoke.json'), 'utf8')) as { id: string; title: string }[];
const a = state.tasks.find((t: any) => t.id === tasks[0].id), b = state.tasks.find((t: any) => t.id === tasks[1].id);
assert(a && b && a.projectId === b.projectId);
const project = state.projects.find((p: any) => p.id === a.projectId);
assert.equal(fs.realpathSync(project.path), fs.realpathSync(path.join(DATA, 'example-paper')));
assert.notEqual(a.threadId, b.threadId);
assert.notEqual(a.worktree, b.worktree);
assert.equal(b.review.round, 2);
const prefix = `/review/${project.id}`;
const get = async (url: string) => { const response = await fetch(origin + prefix + url); const data = await response.json() as any; assert(response.ok, JSON.stringify(data)); return data; };
const post = async (url: string, body: unknown, token: string) => {
  const response = await fetch(origin + prefix + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token }, body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, data: await response.json() as any };
};
const aState = await get(`/api/tasks/${a.name}/state`), bState = await get(`/api/tasks/${b.name}/state`);
const aRound = await get(`/api/tasks/${a.name}/rounds/${aState.round}`), bRound = await get(`/api/tasks/${b.name}/rounds/${bState.round}`);
assert(bRound.units.some((u: any) => u.new_text.includes('The author retains final control over the manuscript.')));
const pending = (round: any, page: any) => round.units.filter((u: any) => page.decisions[u.id] === 'pending').map((u: any) => u.id);
const aChanges = pending(aRound, aState);
if (aChanges.length) {
  const accepted = await post(`/api/tasks/${a.name}/decide`, { action: 'accept', id: randomUUID(), round: aState.round, changes: aChanges }, aState.csrf);
  assert(accepted.ok, JSON.stringify(accepted.data));
}
const main = path.join(project.path, 'main.tex');
const afterA = fs.readFileSync(main, 'utf8');
assert(afterA.includes('Asynchronous feedback'));
const bChanges = pending(bRound, bState); assert(bChanges.length);
const conflictId = randomUUID();
const conflicted = afterA.replace('\\end{document}', 'A deliberately conflicting example edit.\n\\end{document}');
let conflict: Awaited<ReturnType<typeof post>>;
try {
  fs.writeFileSync(main, conflicted);
  conflict = await post(`/api/tasks/${b.name}/decide`, { action: 'accept', id: conflictId, round: bState.round, changes: bChanges }, bState.csrf);
  if (conflict.ok) await post(`/api/tasks/${b.name}/undo`, { id: conflictId }, bState.csrf);
  assert.equal(conflict.ok, false, 'A conflicting insertion must not overwrite the manuscript');
  assert.equal(fs.readFileSync(main, 'utf8'), conflicted, 'Failed acceptance must leave the manuscript byte-for-byte unchanged');
} finally { fs.writeFileSync(main, afterA); }
const acceptedId = randomUUID();
const accepted = await post(`/api/tasks/${b.name}/decide`, { action: 'accept', id: acceptedId, round: bState.round, changes: bChanges }, bState.csrf);
assert(accepted.ok, JSON.stringify(accepted.data));
const afterBoth = fs.readFileSync(main, 'utf8');
assert(afterBoth.includes('Asynchronous feedback'));
assert(afterBoth.includes('The author retains final control over the manuscript.'));
const undone = await post(`/api/tasks/${b.name}/undo`, { id: acceptedId }, bState.csrf);
assert(undone.ok, JSON.stringify(undone.data));
assert.equal(fs.readFileSync(main, 'utf8'), afterA);
const findStrip = (v: any): string | null => {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.src === 'string' && v.src.endsWith('.svg')) return v.src;
  for (const child of Object.values(v)) { const result = findStrip(child); if (result) return result; }
  return null;
};
const strip = findStrip(bRound); assert(strip);
const asset = await fetch(origin + bRound.files + strip);
assert.equal(asset.status, 200);
assert.match(asset.headers.get('content-type') || '', /svg/);
const svg = await asset.text(); assert(svg.includes('<svg'));
const result = { checkedAt: new Date().toISOString(), independentCodexThreads: true, originalThreadRevisedFeedback: true, revisedRound: b.review.round, conflictingAcceptanceBlocked: true, failedAcceptancePreservesManuscript: true, nonOverlappingChangesMerged: true, undoPreservesOtherAcceptedChanges: true, proxiedSvgBytes: Buffer.byteLength(svg), note: 'Example abstract accepted; revised conclusion is left pending for inspection.' };
fs.writeFileSync(path.join(DATA, 'verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
