import fs from "node:fs";
import path from "node:path";
import { opcodes } from "./diff.ts";
import { splitLines, textOf, withHashesAsync } from "./changes.ts";
import { isFigure } from "./config.ts";
import { atomicWriteAsync, readJson } from "./files.ts";
import { bodyFiles, structuralSource } from "./tex-source.ts";
import { revisionReaderAsync } from "./tasks.ts";
import type { App } from "../server.ts";
import type { ChangeBlock, PlaceView, RenderedRound, Round, Strip, Unit } from "../types.ts";

// A round is inserted before its PDF comparison is rendered. Until it is,
// a change whose exact version an earlier round already rendered can show
// that comparison, when nothing else the new round changed can have moved it.
// The round's own render replaces every carried comparison when it arrives.

export const roundFolder = (app: App, name: string, number: number) =>
  path.join(app.state, "rounds", name, String(number).padStart(3, "0"));

const empty = (): RenderedRound => ({ units: {}, sections: [], loose: [] });
// Strips saved by older releases as a single object.
const list = (value: Strip[] | Strip | undefined | null): Strip[] =>
  Array.isArray(value) ? value : value ? [value] : [];

// Page polls read a rendering round's comparisons every few seconds: keep
// each parsed round.json until the file is replaced. Callers must not modify it.
const cache = new Map<string, { stamp: string; value: RenderedRound }>();
export function rendered(app: App, name: string, number: number): RenderedRound {
  const file = path.join(roundFolder(app, name, number), "round.json");
  let stamp: string;
  try {
    const stat = fs.statSync(file);
    stamp = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return empty();
  }
  const hit = cache.get(file);
  if (hit?.stamp === stamp) return hit.value;
  const value = readJson<RenderedRound>(file, empty());
  cache.set(file, { stamp, value });
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return value;
}

function changeBlocks(round: RenderedRound) {
  return [
    ...round.sections.flatMap((section, index) =>
      section.blocks.flatMap((block) => (block.kind === "change" ? [{ block, section: index }] : [])),
    ),
    ...round.loose.map((block) => ({ block, section: -1 })),
  ];
}

/** Whether a change of this round has a PDF comparison to decide with: its
 *  round is rendered, or it shows an earlier round's comparison meanwhile. */
export function comparable(round: Pick<Round, "visuals">, shown: RenderedRound, id: string) {
  return (round.visuals ?? "ready") === "ready" || Boolean(shown.carried?.[id]);
}

/** The round and change that rendered the comparison a change shows. */
export function origin(round: Pick<Round, "number" | "visuals">, shown: RenderedRound, id: string) {
  if ((round.visuals ?? "ready") === "ready") return { round: round.number, change: id };
  return shown.carried?.[id] ?? null;
}

type Pages = { before: Set<number>; after: Set<number> };
// The physical pages of each change's strips and places, on each side.
function unitPages(round: RenderedRound) {
  const pages = new Map<string, Pages>(),
    add = (id: string, before: Strip[], after: Strip[]) => {
      const entry = pages.get(id) ?? { before: new Set<number>(), after: new Set<number>() };
      for (const strip of before) entry.before.add(strip.page);
      for (const strip of after) entry.after.add(strip.page);
      if (entry.before.size || entry.after.size) pages.set(id, entry);
    };
  for (const { block } of changeBlocks(round))
    if (!block.waiting) for (const id of block.units) add(id, list(block.before), list(block.after));
  for (const [id, unit] of Object.entries(round.units))
    for (const place of unit.effects?.shown ?? []) add(id, list(place.before), list(place.after));
  return pages;
}

const half = (value: number) => Math.round(value * 2) / 2;
// What a strip shows: its size, its words where they are, and its marks.
// Rendering the same region twice can number glyphs differently in the image,
// so the image itself counts only for strips without text, such as figures.
function stripPrint(strip: Strip) {
  const text = (strip.text ?? []).map((line) => line.chars.map((char) => [char.text, ...char.rect.map(half)]));
  return [
    half(strip.width),
    half(strip.height),
    text,
    (strip.marks ?? []).map((mark) => [mark.kind, ...mark.rect.map(half)]),
    text.length ? null : strip.src.replace(/^s\d+-/, ""),
  ];
}
/** What the comparison of a change shows, to tell whether a later render of
 *  the same change looks different. Null when the round shows none. */
export function fingerprint(round: RenderedRound, id: string): string | null {
  const blocks = changeBlocks(round).filter(({ block }) => !block.waiting && block.units.includes(id)),
    unit = round.units[id];
  if (!blocks.length && !unit) return null;
  return JSON.stringify([
    unit?.visual ?? null,
    blocks.map(({ block }) => [
      Boolean(block.identical),
      Boolean(block.reflow),
      Boolean(block.moved),
      block.units.length,
      list(block.before).map(stripPrint),
      list(block.after).map(stripPrint),
    ]),
    (unit?.effects?.shown ?? []).map((place) => [place.page, list(place.before).map(stripPrint), list(place.after).map(stripPrint)]),
  ]);
}

function preamble(text: string) {
  const opening = /\\begin\s*\{document\}/.exec(structuralSource(text));
  return opening ? text.slice(0, opening.index) : text;
}

export interface Provisional {
  rendered: RenderedRound;
  /** Strip images to bring over from the earlier round's folder. */
  files: string[];
  from: string | null;
}

/** The comparisons a new round shows until its own render arrives: those it
 *  carries from the previous round, and a waiting placeholder for each other
 *  change. `relaxed` carries every exactly matching change regardless of what
 *  else changed, for a round whose own render failed. */
export async function provisional(
  app: App,
  name: string,
  previous: Round | null,
  next: { before: string; after: string; units: Unit[] },
  relaxed = false,
): Promise<Provisional> {
  const result: RenderedRound = { units: {}, sections: [], loose: [], carried: {} },
    prior = previous ? rendered(app, name, previous.number) : null,
    project = app.project,
    order = new Map(next.units.map((unit, index) => [unit.id, index])),
    // Earlier change → the new change showing its comparison.
    back = new Map<string, string>(),
    sectionOf = new Map<string, number>();
  let earlier: Unit[] = [];
  const unique = (units: Unit[]) => {
    const counts = new Map<string, number>();
    for (const unit of units) counts.set(unit.hash!, (counts.get(unit.hash!) ?? 0) + 1);
    return counts;
  };
  if (previous && prior) {
    for (const { block, section } of changeBlocks(prior))
      for (const id of block.units) if (!sectionOf.has(id)) sectionOf.set(id, section);
    earlier = await withHashesAsync(app.repo, previous.before, previous.after, previous.units);
  }
  const older = unique(earlier),
    newer = unique(next.units),
    byHash = new Map(earlier.map((unit) => [unit.hash!, unit])),
    match = (unit: Unit) =>
      older.get(unit.hash!) === 1 && newer.get(unit.hash!) === 1 ? byHash.get(unit.hash!)! : null;
  if (previous && prior && Object.keys(prior.units).length) {
    const pages = unitPages(prior);
    let local: (file: string) => boolean = () => true,
      touched: Set<number> | null = null;
    if (!relaxed) {
      const [now, then] = await Promise.all([next.after, previous.after].map((rev) => revisionReaderAsync(app.repo, rev, project.doc_dir))),
        body = new Set([...bodyFiles(now, project.main), ...bodyFiles(then, project.main)]);
      // Other files, such as packages, macros read in the preamble and
      // bibliographies, can change any page.
      local = (file) => isFigure(project, file) || (file.endsWith(".tex") && body.has(file));
      touched = await touchedPages(app, previous, earlier, pages, next, local);
    }
    for (const unit of next.units) {
      const found = match(unit),
        at = found && pages.get(found.id);
      if (!found || !at || !prior.units[found.id] || !local(unit.file)) continue;
      if (!relaxed && (!touched || [...at.before, ...at.after].some((page) => touched!.has(page)))) continue;
      back.set(found.id, unit.id);
    }
    // A comparison drawn for several changes together is carried only with
    // all of them.
    for (let changed = true; changed; ) {
      changed = false;
      for (const { block } of changeBlocks(prior))
        if (!block.waiting && block.units.some((id) => back.has(id)) && !block.units.every((id) => back.has(id)))
          for (const id of block.units) changed = back.delete(id) || changed;
    }
  }
  const files = new Set<string>(),
    remap = (id: string) => back.get(id) ?? id,
    from = (id: string) => prior!.carried?.[id] ?? { round: previous!.number, change: id },
    strip = (value: Strip): Strip => {
      files.add(value.src);
      files.add(value.clean);
      return value.marks ? { ...value, marks: value.marks.map((mark) => ({ ...mark, unit: remap(mark.unit) })) } : value;
    },
    place = (value: PlaceView): PlaceView => ({
      ...value,
      before: list(value.before).map(strip),
      after: list(value.after).map(strip),
      ...(value.with ? { with: value.with.map(remap) } : {}),
    });
  for (const [id, unit] of back) {
    const visual = prior!.units[id],
      shown = (visual.effects?.shown ?? []).filter((p) => (p.with ?? []).every((other) => back.has(other))).map(place);
    // Places past those shown render from the earlier round's builds; the
    // carried comparison offers only the shown ones.
    result.units[unit] = { ...visual, ...(visual.effects ? { effects: { ...visual.effects, shown, total: shown.length } } : {}) };
    result.carried![unit] = from(id);
  }
  const sections = (prior?.sections ?? []).map((section) => ({ node: section.node, number: section.number, title: section.title, blocks: [] as ChangeBlock[] })),
    loose: ChangeBlock[] = [];
  for (const { block, section } of prior ? changeBlocks(prior) : [])
    if (!block.waiting && block.units.length && block.units.every((id) => back.has(id)))
      (section < 0 ? loose : sections[section].blocks).push({
        ...block,
        units: block.units.map(remap),
        before: list(block.before).map(strip),
        after: list(block.after).map(strip),
        carried: from(block.units[0]).round,
      });
  const carried = new Set(back.values());
  for (const unit of next.units) {
    if (carried.has(unit.id)) continue;
    // Each other change waits in the section its earlier version, or the
    // nearest earlier change of its file, was shown in.
    const found = match(unit);
    let section = found && sectionOf.has(found.id) ? sectionOf.get(found.id)! : -1;
    if (!found || !sectionOf.has(found.id)) {
      let nearest = Infinity;
      for (const other of earlier)
        if (other.file === unit.file && sectionOf.has(other.id) && Math.abs(other.new_start - unit.new_start) < nearest) {
          nearest = Math.abs(other.new_start - unit.new_start);
          section = sectionOf.get(other.id)!;
        }
    }
    const block: ChangeBlock = { kind: "change", units: [unit.id], identical: false, before: [], after: [], waiting: true };
    (section >= 0 ? sections[section].blocks : loose).push(block);
  }
  const first = (block: ChangeBlock) => Math.min(...block.units.map((id) => order.get(id) ?? Infinity));
  for (const section of sections) section.blocks.sort((a, b) => first(a as ChangeBlock) - first(b as ChangeBlock));
  loose.sort((a, b) => first(a) - first(b));
  result.sections = sections.filter((section) => section.blocks.length);
  result.loose = loose;
  if (prior?.references) {
    const entries = prior.references.entries
        .filter((entry) => (entry.units ?? [entry.unit]).every((id) => back.has(id)))
        .map((entry) => ({ ...entry, unit: remap(entry.unit), ...(entry.units ? { units: entry.units.map(remap) } : {}) })),
      missing = prior.references.missing
        .filter((entry) => entry.unit && back.has(entry.unit))
        .map((entry) => ({ ...entry, unit: remap(entry.unit!) }));
    if (entries.length || missing.length) result.references = { entries, missing };
  }
  return { rendered: result, files: [...files], from: previous ? roundFolder(app, name, previous.number) : null };
}

// The pages of the previous round that what changed since then falls on, or
// null when some change cannot be placed or can move any page: the preamble,
// a file outside the document body, or a passage no earlier change covers.
async function touchedPages(
  app: App,
  previous: Round,
  earlier: Unit[],
  pages: Map<string, Pages>,
  next: { before: string; after: string },
  local: (file: string) => boolean,
) {
  const result = new Set<number>(),
    project = app.project;
  for (const [side, from, to] of [
    ["before", previous.before, next.before],
    ["after", previous.after, next.after],
  ] as const) {
    const files = await app.repo.changedFilesAsync(from, to);
    if (!files.length) continue;
    const [old, fresh] = await Promise.all([app.repo.blobsAsync(from, files), app.repo.blobsAsync(to, files)]);
    for (const file of files) {
      if (!local(file)) return null;
      const a = textOf(old[file] ?? null),
        b = textOf(fresh[file] ?? null);
      if (file === project.main && (a === null || b === null || preamble(a) !== preamble(b))) return null;
      const regions: [number, number][] =
        a === null || b === null || !old[file] || !fresh[file] || isFigure(project, file)
          ? [[0, Infinity]]
          : opcodes(splitLines(a), splitLines(b))
              .filter((op) => op[0] !== "equal")
              .map((op) => [op[1], op[2]]);
      for (const [i, j] of regions) {
        // Line ranges of the earlier round's changes in this version.
        const found = earlier
          .filter((unit) => {
            if (unit.file !== file) return false;
            const [start, end] = side === "before" ? [unit.old_start - 1, unit.old_end] : [unit.new_start - 1, unit.new_end];
            return i <= end && start <= j;
          })
          .flatMap((unit) => {
            const at = pages.get(unit.id);
            return at ? [...at.before, ...at.after] : [];
          });
        if (!found.length) return null;
        for (const page of found) result.add(page);
      }
    }
  }
  return result;
}

/** Writes a round's provisional comparisons into `folder`. */
export async function writeProvisional(folder: string, value: Provisional) {
  await fs.promises.mkdir(folder, { recursive: true });
  if (value.from)
    for (const file of value.files) {
      const source = path.join(value.from, file),
        target = path.join(folder, file);
      if (fs.existsSync(target) || !fs.existsSync(source)) continue;
      try {
        await fs.promises.link(source, target);
      } catch {
        await fs.promises.copyFile(source, target);
      }
    }
  await atomicWriteAsync(path.join(folder, "round.json"), JSON.stringify(value.rendered));
}
