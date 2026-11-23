import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { App } from "../server.ts";
import type { ChangeBlock, RenderedRound, Strip } from "../types.ts";
import { applyUnits } from "./changes.ts";
import { Builder, buildDate, type BuildPriority } from "./build.ts";
import { roundFolder } from "./carry.ts";
import { readJson, writeJson } from "./files.ts";
import { renderMixed } from "./publish.ts";
import { optionCandidate } from "./option-preview.ts";

export interface MixedPreviewInput {
  units: string[];
  accepted: string[];
}

export interface MixedPreviewResult {
  files: string;
  strips: Strip[];
  unavailable?: boolean;
}

const pending = new Map<string, Promise<MixedPreviewResult>>();

function findBlock(rendered: RenderedRound | null, unitSet: ReadonlySet<string>): ChangeBlock | null {
  if (!rendered) return null;
  const target = [...unitSet].sort().join("\0");
  const all: ChangeBlock[] = [
    ...rendered.sections.flatMap((section) =>
      section.blocks.filter((block): block is ChangeBlock => block.kind === "change"),
    ),
    ...rendered.loose,
  ];
  return (
    all.find((block) => [...new Set(block.units)].sort().join("\0") === target) ??
    null
  );
}

/** Render the newly-typeset PDF strips for a single block whose edits finished
 *  with mixed decisions (some accepted, some rejected). Compiles only the
 *  round's chapter targets into an unreferenced Git commit, aligns the block's
 *  full original span to the mixed PDF (keeping accepted, rejected, and
 *  intervening lines intact), and caches by content hash. */
export async function previewMixedBlock(
  app: App,
  name: string,
  roundNumber: number,
  input: MixedPreviewInput,
): Promise<MixedPreviewResult> {
  if (
    !input ||
    !Array.isArray(input.units) ||
    !Array.isArray(input.accepted) ||
    !input.units.length ||
    !input.accepted.length ||
    input.units.length > 200
  ) {
    throw new Error("Invalid mixed preview request.");
  }
  const task = app.tasks.get(name, false),
    round = app.review.round(name, roundNumber);
  if (round.summary.sourceOnly) return { files: "", strips: [], unavailable: true };
  const unitSet = new Set(input.units),
    acceptedSet = new Set(input.accepted),
    variants = app.review.variants(name, round.number),
    edits = [...acceptedSet].sort().filter((id) => Object.hasOwn(variants, id)).map((id) => ({ unit: id, text: variants[id] }));
  if (!acceptedSet.size || acceptedSet.size >= unitSet.size) {
    throw new Error("Invalid mixed preview request.");
  }
  for (const id of acceptedSet) {
    if (!unitSet.has(id)) throw new Error("Accepted edits must belong to the block.");
  }
  const byId = new Map(round.units.map((u) => [u.id, u]));
  for (const id of unitSet) {
    if (!byId.has(id)) throw new Error("Unknown edit in mixed preview request.");
  }
  const acceptedUnits = [...acceptedSet].map((id) => byId.get(id)!);
  const renderedRound = readJson<RenderedRound | null>(
    path.join(roundFolder(app, task.name, round.number), "round.json"),
    null,
  );
  const block = findBlock(renderedRound, unitSet);
  const useBefore = Boolean(block?.before.length);
  const refRaw = useBefore ? (block?.before ?? []) : (block?.after ?? []);
  const refStrips = refRaw
    .filter((s) => s.top !== undefined)
    .map((s) => ({
      page: s.page,
      top: s.top!,
      height: s.height,
      ...(s.left !== undefined ? { left: s.left } : {}),
      width: s.width,
    }));
  if (!refStrips.length) return { files: "", strips: [], unavailable: true };

  const project = app.projectOf(name),
    date = round.summary.date ?? buildDate(new Date(round.created * 1000), {});
  let targets = round.summary.targets.length ? round.summary.targets : ["full"];
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        3,
        round.before,
        round.after,
        [...unitSet].sort(),
        [...acceptedSet].sort(),
        edits,
        useBefore ? "before" : "after",
        refStrips,
        project,
        targets,
        date,
      ]),
    )
    .digest("hex");
  const output = path.join(
    app.state,
    "cache/mixed-previews",
    task.name,
    String(round.number),
    key,
  );
  const cached = readJson<MixedPreviewResult | null>(
    path.join(output, "preview.json"),
    null,
  );
  if (cached) return cached;
  const existing = pending.get(output);
  if (existing) return existing;

  const priority: () => BuildPriority = () => "background";
  const work = (async (): Promise<MixedPreviewResult> => {
    try {
      const files: Record<string, Buffer | null> = {},
        option = edits.length ? optionCandidate(round.units, edits, (file) => app.repo.blob(round.after, file)!.toString("utf8")) : null;
      for (const file of new Set(acceptedUnits.map((u) => u.file))) {
        // An accepted option's wording takes the place of the round's.
        const worded = option && Object.hasOwn(option.files, file),
          before = app.repo.blob(round.before, file),
          after = worded ? option.files[file] : app.repo.blob(round.after, file),
          group = worded ? option.units.filter((u) => u.file === file && acceptedSet.has(u.id)) : acceptedUnits.filter((u) => u.file === file);
        files[file] = applyUnits(before, after, group);
      }
      const mixedCommit = await app.repo.commitWithAsync(
        round.before,
        files,
        "Preview mixed decision",
      );

      const builder = new Builder(project, app.repo),
        keys = round.summary.builds;
      let seed = targets.includes("full")
        ? null
        : (keys.length > 2 ? await builder.completed(keys[0]) : null) ??
          (await builder.buildSeed(task.base, { priority }));
      const expanded = Boolean(seed?.errors?.length);
      if (expanded) {
        targets = ["full"];
        seed = null;
      }
      const refRev = useBefore ? round.before : round.after;
      const cachedRefKey = !expanded && keys.length >= 2 ? (useBefore ? keys.at(-2)! : keys.at(-1)!) : null;
      const cachedRef = cachedRefKey ? await builder.completed(cachedRefKey) : null;
      const [refBuild, next] = await Promise.all([
        cachedRef ?? builder.build(refRev, targets, seed, { date, priority }),
        builder.build(mixedCommit, targets, seed, { date, priority }),
      ]);
      if (next.errors?.length || refBuild.errors?.length) {
        return { files: "", strips: [], unavailable: true };
      }

      fs.mkdirSync(output, { recursive: true });
      await renderMixed(
        output,
        {
          main: project.main,
          source_dir: project.source_dir,
          figures: project.figures,
          old: refBuild,
          new: next,
          mixed: refStrips,
        },
        priority,
      );
      const rendered = readJson<{ strips?: Strip[] }>(
        path.join(output, "mixed.json"),
        { strips: [] },
      );
      const strips: Strip[] = (rendered.strips ?? []).map((strip) => {
        const cleanSrc = strip.clean || strip.src;
        return {
          ...strip,
          src: cleanSrc,
          clean: cleanSrc,
          marks: undefined,
        };
      });
      const result: MixedPreviewResult = {
        files: `/mixed-files/${task.name}/${round.number}/${key}/`,
        strips,
        ...(strips.length ? {} : { unavailable: true }),
      };
      writeJson(path.join(output, "preview.json"), result);
      return result;
    } catch {
      fs.rmSync(output, { recursive: true, force: true });
      return { files: "", strips: [], unavailable: true };
    } finally {
      pending.delete(output);
    }
  })();

  pending.set(output, work);
  return work;
}
