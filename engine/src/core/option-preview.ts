import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { App } from "../server.ts";
import type { Op, OptionEdit, RenderedRound, RoundDetail, Unit } from "../types.ts";
import { groupFormattingChanges } from "./formatting-changes.ts";
import { splitLines } from "./changes.ts";
import { Builder, buildDate, reprioritize, type BuildPriority } from "./build.ts";
import { readJson, writeJson } from "./files.ts";
import { render, reprioritizeRenders, sourceComparison } from "./publish.ts";
/** A note option: replacement wording for some of the latest round's changes. */
export interface OptionInput { id: string; round: number; edits: OptionEdit[] }

export function validOptionEdit(edit: unknown): edit is OptionEdit {
  if (!edit || typeof edit !== "object") return false;
  const candidate = edit as Record<string, unknown>;
  const span = (value: unknown) => value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 20000);
  return typeof candidate.unit === "string" && typeof candidate.text === "string" && !candidate.text.includes("\0") && candidate.text.length <= 20000
    && span(candidate.before) && span(candidate.after);
}

/** Keep annotation IDs and old ranges stable while adjusting candidate ranges.
 * This only constructs buffers: neither checkout nor review decisions change. */
export function optionCandidate(units: Unit[], edits: OptionInput["edits"], source: (file: string) => string,
  restored: { ids: Set<string>; source: (file: string) => Buffer | null } = { ids: new Set(), source: () => null }) {
  const chosen = new Map(edits.map(edit => [edit.unit, edit]));
  const files: Record<string, Buffer | null> = {}, updated = structuredClone(units.filter(unit => !restored.ids.has(unit.id)));
  for (const file of new Set(units.filter(unit => chosen.has(unit.id) || restored.ids.has(unit.id)).map(unit => unit.file))) {
    const rejected = units.filter(unit => unit.file === file && restored.ids.has(unit.id));
    const before = rejected.length ? restored.source(file) : null;
    if (rejected.some(unit => unit.whole_file)) {
      if (units.some(unit => unit.file === file && chosen.has(unit.id))) throw new Error("These changes overlap and must be revised together.");
      files[file] = before; continue;
    }
    const original = source(file);
    const patches = units.filter(unit => unit.file === file && chosen.has(unit.id)).map(unit => {
      if (unit.text_ops?.length !== 1) throw new Error("This change cannot be previewed independently.");
      const edit = chosen.get(unit.id)!;
      const expandBefore = edit.before ?? 0, expandAfter = edit.after ?? 0;
      const [, oldStart, oldEnd, start, end] = unit.text_ops[0];
      if (expandBefore > start || expandBefore > oldStart || end + expandAfter > original.length)
        throw new Error("This change cannot be previewed independently.");
      return { id: unit.id, start: start - expandBefore, end: end + expandAfter, text: edit.text, expandBefore, expandAfter, origStart: start, origEnd: end, oldStart, oldEnd };
    });
    const offset = (text: string, line: number) => splitLines(text).slice(0, line).join("").length;
    for (const unit of rejected) {
      if (!before) throw new Error("The original source is unavailable.");
      const old = before.toString("utf8");
      const ops = unit.text_ops ?? unit.ops.map(([tag, i, j, x, y]): Op => [tag, offset(old, i), offset(old, j), offset(original, x), offset(original, y)]);
      for (const [, i, j, start, end] of ops) patches.push({ id: unit.id, start, end, text: old.slice(i, j), expandBefore: 0, expandAfter: 0, origStart: start, origEnd: end, oldStart: i, oldEnd: j });
    }
    patches.sort((a, b) => a.start - b.start || a.end - b.end);
    let text = original, boundary = original.length, prevZeroAt = -1;
    for (const patch of [...patches].reverse()) {
      if (patch.start < 0 || patch.end > original.length || patch.start > patch.end || patch.end > boundary
        || (patch.start === patch.end && patch.start === prevZeroAt))
        throw new Error("These changes overlap and must be revised together.");
      text = text.slice(0, patch.start) + patch.text + text.slice(patch.end);
      // Adjacent nonempty replacements and a replacement abutting a pure deletion
      // are independent; two zero-length insertions at the same offset are not.
      boundary = patch.start;
      prevZeroAt = patch.start === patch.end ? patch.start : -1;
    }
    files[file] = Buffer.from(text);
    const line = (value: string, offset: number) => value.slice(0, offset).split("\n").length - 1;
    for (const unit of updated.filter(unit => unit.file === file)) {
      if (!unit.text_ops?.length) throw new Error("This source range cannot be previewed independently.");
      const own = patches.find(patch => patch.id === unit.id);
      unit.text_ops = unit.text_ops.map(([tag, i, j, x, y]): Op => {
        let shift = 0;
        const unitStart = own ? own.start : x, unitEnd = own ? own.end : y;
        for (const patch of patches) {
          if (patch === own) continue;
          if (patch.end <= unitStart) shift += patch.text.length - (patch.end - patch.start);
          else if (patch.start < unitEnd) throw new Error("These changes overlap and must be revised together.");
        }
        if (own) {
          const nextOldStart = i - own.expandBefore, nextOldEnd = j + own.expandAfter;
          const nextTag: Op[0] = (own.expandBefore || own.expandAfter) && nextOldStart < nextOldEnd
            ? (own.text ? "replace" : "delete")
            : tag;
          return [nextTag, nextOldStart, nextOldEnd, own.start + shift, own.start + shift + own.text.length];
        }
        return [tag, i, j, x + shift, y + shift];
      });
      unit.ops = unit.text_ops.map(([tag, , , x, y], index) => {
        let oldStartLine = unit.ops[index][1], oldEndLine = unit.ops[index][2];
        if (own && (own.expandBefore || own.expandAfter)) {
          const beforeLines = own.expandBefore ? line(original, own.origStart) - line(original, own.start) : 0;
          const origEndLine = own.origEnd === own.origStart ? line(original, own.origStart) : line(original, own.origEnd - 1) + 1;
          const expandedEndLine = own.end === own.start ? line(original, own.start) : line(original, own.end - 1) + 1;
          const afterLines = own.expandAfter ? Math.max(0, expandedEndLine - origEndLine) : 0;
          oldStartLine = Math.max(0, oldStartLine - beforeLines);
          oldEndLine = Math.max(oldStartLine, oldEndLine + afterLines);
          if (tag !== "insert" && oldEndLine === oldStartLine) oldEndLine = oldStartLine + 1;
        }
        return [tag, oldStartLine, oldEndLine, line(text, x), x === y ? line(text, x) : line(text, y - 1) + 1];
      });
      unit.old_start = unit.ops[0][1] + 1;
      unit.old_end = Math.max(unit.old_start, unit.ops.at(-1)![2]);
      unit.new_start = unit.ops[0][3] + 1;
      unit.new_end = Math.max(unit.new_start, unit.ops.at(-1)![4]);
      if (own && chosen.has(unit.id)) {
        if (own.expandBefore || own.expandAfter) {
          unit.old_text = original.slice(own.start, own.origStart) + unit.old_text + original.slice(own.origEnd, own.end);
        }
        unit.new_text = own.text;
      }
    }
  }
  return { files, units: updated };
}

const pending = new Map<string, { promise: Promise<RoundDetail>; priority: BuildPriority }>();
export async function previewNoteOption(app: App, name: string, input: OptionInput & { rejected?: string[]; background?: boolean }): Promise<RoundDetail> {
  if (!input || !Array.isArray(input.edits) || !input.edits.length || input.edits.length > 100
    || input.edits.some(edit => !validOptionEdit(edit)))
    throw new Error("Invalid note option.");
  const task = app.tasks.get(name), round = app.review.latestRound(name);
  app.delivery.assertReady(name);
  if (task.closed || !round || round.number !== input.round) throw new Error("A newer round is available. Reload the options.");
  if (app.publisher.busy(name)) throw new Error("Wait for the PDF build to finish.");
  const merge = app.reconciliation.get(name);
  if (merge && (!merge.ready || round.number <= merge.round)) throw new Error("Finish reviewing the merge suggestion first.");
  const decisions = app.review.decisions(name, round), variantEdits = app.review.variantEdits(name, round.number), ids = new Set<string>();
  for (const edit of input.edits) {
    const unit = round.units.find(unit => unit.id === edit.unit);
    if (!unit || unit.kind !== "text" || unit.truncated || unit.whole_file || unit.text_ops?.length !== 1 || ids.has(unit.id)) throw new Error("This change cannot be previewed independently.");
    // An accepted option keeps showing its own PDF.
    const accepted = variantEdits[unit.id];
    const sameAccepted = accepted && accepted.text === edit.text && (accepted.before ?? 0) === (edit.before ?? 0) && (accepted.after ?? 0) === (edit.after ?? 0);
    if (decisions[unit.id] !== "pending" && !(decisions[unit.id] === "accepted" && sameAccepted))
      throw new Error("This option overlaps a reviewed change. Undo that decision before replacing it.");
    ids.add(unit.id);
  }
  const project = app.projectOf(name);
  // A saved round is immutable. Opening it tomorrow or after an app restart
  // must not invalidate its comparisons (or change \today in the document).
  const date = round.summary.date ?? buildDate(new Date(round.created * 1000), {});
  let targets = round.summary.targets.length ? round.summary.targets : ["full"];
  const rejected = round.units.filter(unit => decisions[unit.id] === "rejected").map(unit => unit.id).sort();
  // The host's comparison key describes the state it read before this request.
  // Check that state again here, before any await or cache lookup, so a racing
  // rejection/undo cannot put a different comparison under the browser's key.
  if (input.rejected !== undefined && JSON.stringify(input.rejected) !== JSON.stringify(rejected))
    throw new Error("The review changed. Reload the options.");
  const key = createHash("sha256").update(JSON.stringify([5, round.before, round.after, input.edits, rejected, project, targets, date, ...(round.summary.sourceOnly ? [true] : [])])).digest("hex");
  const output = path.join(app.state, "cache/option-previews", name, String(round.number), key);
  const cached = readJson<RoundDetail | null>(path.join(output, "preview.json"), null);
  if (cached) return cached;
  const existing = pending.get(output);
  if (existing) {
    if (input.background !== true) { existing.priority = "foreground"; reprioritize(); reprioritizeRenders(); }
    return existing.promise;
  }
  // The existing machine-wide TeX/render pool bounds concurrency. Optional
  // work yields to publication and saving; selecting it promotes the same
  // build, including one already waiting for a compiler slot.
  const entry = { priority: input.background === true ? "background" : "foreground" } as { promise: Promise<RoundDetail>; priority: BuildPriority };
  const priority = () => entry.priority;
  const work = (async () => {
    const candidate = optionCandidate(round.units, input.edits, file => {
      const data = app.repo.blob(round.after, file);
      if (!data) throw new Error("The proposal source is unavailable.");
      return data.toString("utf8");
    }, { ids: new Set(rejected), source: file => app.repo.blob(round.before, file) });
    // An unreferenced Git object is safe to compile; no branch or index moves.
    const after = await app.repo.commitWithAsync(round.after, candidate.files, "Preview note option");
    const builder = new Builder(project, app.repo);
    // Reuse precisely the baseline and chapter scope the author is reviewing.
    // Rebuilding the whole thesis here was both slow and a different comparison.
    const keys = round.summary.builds;
    let seed = targets.includes("full") ? null
      : (keys.length > 2 ? await builder.completed(keys[0]) : null) ?? await builder.buildSeed(task.base, { priority });
    const expanded = Boolean(seed?.errors?.length);
    if (expanded) { targets = ["full"]; seed = null; }
    const baseline = !expanded && keys.length >= 2 ? await builder.completed(keys.at(-2)!) : null;
    const [old, next] = await Promise.all([
      round.summary.sourceOnly ? null : baseline ?? builder.build(round.before, targets, seed, { date, priority }),
      builder.build(after, targets, seed, { date, priority }),
    ]);
    fs.mkdirSync(output, { recursive: true });
    // A choice can restore part of the original wording (including cancelling
    // an insertion). Keep its decision ID in the saved round, but do not render
    // a before/after card for an edit that this candidate no longer contains.
    const visible = candidate.units.filter(unit => unit.kind !== "text" || unit.truncated || unit.whole_file || unit.old_text !== unit.new_text);
    if (old) await render(output, { main: project.main, source_dir: project.source_dir, figures: project.figures, old, new: next, units: visible, indirect: false }, undefined, priority);
    const rendered = old
      ? readJson<RenderedRound>(path.join(output, "round.json"), { units: {}, sections: [], loose: [] })
      : sourceComparison(visible);
    fs.copyFileSync(next.pdf, path.join(output, "preview.pdf"));
    const files = `/option-files/${name}/${round.number}/${key}/`;
    const detail: RoundDetail = groupFormattingChanges({ ...rendered, task: name, round: round.number, before: round.before, after,
      units: visible.map(unit => ({ ...unit, ...rendered.units[unit.id] })),
      warnings: [...(old?.warnings ?? []), ...next.warnings], files, pdf: files + "preview.pdf", build: { key: next.key, targets },
      ...(next.errors?.length ? { revisedErrors: next.errors } : {}),
      ...(old?.errors?.length ? { baselineErrors: old.errors } : {}),
      ...(round.summary.sourceOnly ? { sourceOnly: true, baselineErrors: round.summary.baselineErrors } : {}),
    }, file => app.repo.blob(round.before, file)?.toString("utf8") ?? null);
    writeJson(path.join(output, "preview.json"), detail);
    return detail;
  })();
  entry.promise = work;
  pending.set(output, entry);
  try { return await work; }
  catch (error) { fs.rmSync(output, { recursive: true, force: true }); throw error; }
  finally { pending.delete(output); }
}
