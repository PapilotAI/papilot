import { createHash } from "node:crypto";
import type { App } from "../server.ts";
import type { Unit } from "../types.ts";
import { readBytes, same, writeOrDelete } from "./files.ts";
import { merge3Async } from "./git.ts";
import { safePath } from "./review.ts";
import { optionCandidate } from "./option-preview.ts";

export interface OptionInput { id: string; round: number; edits: { unit: string; text: string }[]; accept?: boolean }
type Saved = { request: string; writes: { file: string; before: string; after: string }[]; applied: boolean; publishRequest?: string; comparison?: { before: string; after: string; units: Unit[] }; accept?: { id: string; before: string; units: Unit[] } };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// An option changes wording inside an existing review unit. Keep that range
// through publication so selecting e.g. “numerically stable” does not turn
// the original “stable” unit into an unrelated insertion and lose its choices.
export async function noteOptionUnits(app: App, name: string, job: string, before: string, after: string) {
  const saved = app.store.one<{ data: Saved }>("SELECT s.data FROM source_edits s JOIN build_requests b ON b.id=json_extract(s.data,'$.publishRequest') WHERE b.job=? AND s.task=?", job, name)?.data;
  if (!saved?.applied || saved.comparison?.before !== before) return;
  if (await app.repo.treeIdAsync(saved.comparison.after) !== await app.repo.treeIdAsync(after)) return;
  return saved.comparison.units;
}

/** The checkmark authorizes only this note's edits. Finish that decision after
 * its PDF is published, using the normal idempotent, undoable review journal. */
export async function acceptNoteOption(app: App, name: string, job: string) {
  const saved = app.store.one<{ data: Saved }>("SELECT s.data FROM source_edits s JOIN build_requests b ON b.id=json_extract(s.data,'$.publishRequest') WHERE b.job=? AND s.task=?", job, name)?.data;
  if (!saved?.accept) return;
  const round = app.review.latestRound(name);
  if (!round) throw new Error('The selected option has not been published.');
  const surroundings = (unit: Unit) => {
    if (!unit.old_context || !unit.text_ops) return [];
    const { text, start } = unit.old_context, [, a, b] = unit.text_ops[0];
    return [text.slice(Math.max(0, a - start - 24), a - start), text.slice(b - start, b - start + 24)];
  };
  const changes = saved.accept.units.map(original => {
    const matches = round.units.filter(unit => {
      if (unit.file !== original.file || unit.old_text !== original.old_text || unit.new_text !== original.new_text) return false;
      if (round.before === saved.accept!.before) return unit.text_ops?.[0][1] === original.text_ops?.[0][1] && unit.text_ops?.[0][2] === original.text_ops?.[0][2];
      const context = surroundings(unit);
      return surroundings(original).some((text, index) => text.length >= 8 && text === context[index]);
    });
    if (matches.length !== 1) throw new Error('The selected source range changed. Review it before accepting.');
    return matches[0].id;
  });
  await app.review.decide(name, { id: saved.accept.id, round: round.number, changes, action: 'accept' });
}

/** Replace only pending source ranges. The existing source-save build and
 * review journal retain responsibility for compilation and later acceptance. */
export function useNoteOption(app: App, name: string, input: OptionInput) {
  return app.exclusive(async () => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.id) || !Array.isArray(input.edits) || !input.edits.length || input.edits.length > 100
      || input.edits.some(edit => typeof edit.unit !== "string" || typeof edit.text !== "string" || edit.text.includes("\0") || edit.text.length > 20000))
      throw new Error("Invalid note option.");
    const identity = `option-${input.id}`, request = hash(JSON.stringify(input));
    let saved = app.store.one<{ task: string; data: Saved }>("SELECT task,data FROM source_edits WHERE id=?", identity);
    if (saved && (saved.task !== name || saved.data.request !== request)) throw new Error("This option request was already used.");
    const task = app.tasks.get(name);
    app.delivery.assertReady(name);
    if (task.closed) throw new Error("This task is closed.");
    if (!saved) {
      const round = app.review.latestRound(name), merge = app.reconciliation.get(name);
      if (app.publisher.busy(name)) throw new Error("Wait for the PDF build to finish.");
      if (!round || round.number !== input.round) throw new Error("A newer round is available. Reload the options.");
      if (merge && (!merge.ready || round.number <= merge.round)) throw new Error("Finish reviewing the merge suggestion first.");
      const states = app.review.decisions(name, round), ids = new Set<string>();
      const groups = new Map<string, { unit: Unit; text: string }[]>();
      for (const edit of input.edits) {
        const unit = round.units.find(unit => unit.id === edit.unit);
        if (!unit || unit.truncated || unit.whole_file || unit.kind !== "text" || unit.text_ops?.length !== 1 || ids.has(unit.id)) throw new Error("This change cannot be replaced independently.");
        if (states[unit.id] !== "pending") throw new Error("This option overlaps a reviewed change. Undo that decision before replacing it.");
        ids.add(unit.id);
        if (!groups.has(unit.file)) groups.set(unit.file, []);
        groups.get(unit.file)!.push({ unit, text: edit.text });
      }
      const writes: Saved["writes"] = [];
      for (const [file, edits] of groups) {
        const original = app.repo.blob(round.after, file);
        if (!original) throw new Error("The proposal source is unavailable.");
        let text = original.toString("utf8"), boundary = text.length;
        for (const { unit, text: replacement } of edits.sort((a, b) => b.unit.text_ops![0][3] - a.unit.text_ops![0][3])) {
          const [, , , start, end] = unit.text_ops![0];
          if (end > boundary) throw new Error("These changes overlap and must be revised together.");
          text = text.slice(0, start) + replacement + text.slice(end); boundary = start;
        }
        const current = readBytes(safePath(task.worktree, file));
        const [merged, conflict] = await merge3Async(current, original, Buffer.from(text));
        if (conflict || !current || !merged) throw new Error("The source changed since these options were prepared. Reload the review.");
        writes.push({ file, before: current.toString("base64"), after: merged.toString("base64") });
      }
      let comparison: Saved['comparison'];
      if (round.units.every(unit => states[unit.id] === 'pending' && unit.text_ops?.length)) {
        const candidate = optionCandidate(round.units, input.edits, file => app.repo.blob(round.after, file)!.toString('utf8'));
        comparison = { before: round.before, after: await app.repo.commitWithAsync(round.after, candidate.files, 'Selected note option'), units: candidate.units };
      }
      const accept = input.accept ? { id: `note-accept-${hash(identity)}`, before: round.before, units: input.edits.map(edit => ({ ...round.units.find(unit => unit.id === edit.unit)!, new_text: edit.text })) } : undefined;
      saved = { task: name, data: { request, writes, applied: false, publishRequest: `source-${hash(identity)}`, ...(comparison ? { comparison } : {}), ...(accept ? { accept } : {}) } };
      app.store.execute("INSERT INTO source_edits(id,task,data) VALUES(?,?,?)", identity, name, JSON.stringify(saved.data));
    }
    if (!saved.data.applied) {
      // Validate every file before writing any. A retry also completes an
      // interrupted multi-file write without applying the replacement twice.
      for (const write of saved.data.writes) {
        const current = readBytes(safePath(task.worktree, write.file));
        if (!same(current, Buffer.from(write.before, "base64")) && !same(current, Buffer.from(write.after, "base64"))) throw new Error("The source changed before this option could be saved.");
      }
      for (const write of saved.data.writes) writeOrDelete(safePath(task.worktree, write.file), Buffer.from(write.after, "base64"));
      saved.data.applied = true;
      app.store.execute("UPDATE source_edits SET data=? WHERE id=?", JSON.stringify(saved.data), identity);
    }
    app.publisher.submit(name, `source-${hash(identity)}`);
    return app.review.pageState(name);
  });
}
