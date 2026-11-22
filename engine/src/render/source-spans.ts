import type { Mark, Pair, Position, Rect, Unit } from "../types.ts";
import type { Build } from "./locate.ts";
import { extract, normalize, wordMarks } from "./pdfdiff.ts";
import { containsCenter, union } from "./pdf.ts";

const compact = (text: string) => normalize(text).replace(/\s/gu, "");

// SyncTeX identifies a source line, not a word. Locate a plain source span
// within those crops using its unchanged neighbours. Ambiguous/TeX-generated
// text falls back to the existing aligned renderer instead of guessing.
function locate(
  build: Build,
  source: string,
  start: number,
  end: number,
  crops: Position[],
  kind: "removed" | "added",
) {
  if (/[\\{}$%]/.test(source.slice(start, end))) return null;
  const [glyphs] = extract(build.document, crops),
    printed = glyphs.map((g) => g.text).join("");
  const prefix = Math.max(0, start - 120),
    low = prefix + source.slice(prefix, start).search(/[^\\{}$%]*$/),
    stop = source.slice(end).search(/[\\{}$%]/),
    high = stop < 0 ? source.length : end + stop;
  for (const context of [120, 60, 24, 8, 0]) {
    const left = Math.max(low, start - context),
      right = Math.min(high, end + context),
      needle = compact(source.slice(left, right));
    if (!needle) continue;
    const at = printed.indexOf(needle);
    if (at < 0 || printed.indexOf(needle, at + 1) >= 0) continue;
    const offset = Array.from(printed.slice(0, at)).length,
      i = offset + Array.from(compact(source.slice(left, start))).length,
      j = offset + Array.from(compact(source.slice(left, end))).length,
      changed = glyphs.slice(i, j),
      nearby = changed.length
        ? changed
        : glyphs.slice(
            Math.max(offset, i - 1),
            Math.min(offset + Array.from(needle).length, i + 1),
          );
    const positions: { at: Position; marks: Mark[] }[] = [];
    for (const page of new Set(nearby.map((g) => g.page))) {
      const onPage = nearby.filter((g) => g.page === page),
        pageObj = build.document.page(page),
        linesHit = pageObj.lines.filter((line) =>
          onPage.some((g) => containsCenter(line.rect, g.rect)),
        ),
        rect = (
          linesHit.length ? linesHit.map((l) => l.rect) : onPage.map((g) => g.rect)
        ).reduce(union),
        crop = crops.find(
          (p) =>
            p.page === page && p.clip[0] <= rect[0] && p.clip[2] >= rect[2],
        );
      if (!crop) return null;
      const clip: Rect = [crop.clip[0], rect[1] - 1, crop.clip[2], rect[3] + 1];
      positions.push({
        at: {
          ...crop,
          clip,
        },
        marks: wordMarks(
          pageObj.words,
          clip,
          changed.filter((g) => g.page === page).map((g) => g.rect),
          kind,
        ),
      });
    }
    if (positions.length) return positions;
  }
  return null;
}

export function sourcePairs(
  old: Build,
  next: Build,
  unit: Unit,
  left: Position[],
  right: Position[],
): Pair[] | null {
  if (unit.text_ops?.length !== 1) return null;
  let [, i, j, x, y] = unit.text_ops[0];
  const a = old.read(unit.file),
    b = next.read(unit.file);
  if (a == null || b == null) return null;
  // Only when a word-diff span absorbed adjacent unchanged TeX markup (such as
  // a trailing " $L$"), trim unchanged whitespace-bounded segments so plain-text
  // edits stay locatable without slicing mid-word characters or trimming inside
  // unclosed commands, braces, math or comments.
  const balancedTeX = (text: string) => {
    let depth = 0, dollars = 0;
    for (let k = 0; k < text.length; k++) {
      if (text[k] === "\\") { k++; continue; }
      if (text[k] === "%") return false;
      if (text[k] === "{") depth++;
      else if (text[k] === "}") { depth--; if (depth < 0) return false; }
      else if (text[k] === "$") dollars++;
    }
    return depth === 0 && dollars % 2 === 0;
  };
  const insideComment = (text: string, pos: number) => {
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    for (let k = lineStart; k < pos; k++) {
      if (text[k] === "\\") { k++; continue; }
      if (text[k] === "%") return true;
    }
    return false;
  };
  if (
    (/[\\{}$%]/.test(a.slice(i, j)) || /[\\{}$%]/.test(b.slice(x, y))) &&
    !insideComment(a, i) &&
    !insideComment(b, x)
  ) {
    let pi = i, px = x;
    while (pi < j && px < y && a[pi] === b[px]) {
      pi++;
      px++;
      if (/\s/.test(a[pi - 1]) && balancedTeX(a.slice(i, pi))) {
        i = pi;
        x = px;
      }
    }
    let sj = j, sy = y;
    while (sj > i && sy > x && a[sj - 1] === b[sy - 1]) {
      sj--;
      sy--;
      if (/\s/.test(a[sj]) && balancedTeX(a.slice(sj, j))) {
        j = sj;
        y = sy;
      }
    }
  }
  if (compact(a.slice(i, j)) === compact(b.slice(x, y))) return null;
  const before = locate(old, a, i, j, left, "removed"),
    after = locate(next, b, x, y, right, "added");
  if (!before || !after) return null;
  return Array.from(
    { length: Math.max(before.length, after.length) },
    (_, k) => ({
      old: before[k]?.at ?? null,
      new: after[k]?.at ?? null,
      before_marks: before[k]?.marks ?? [],
      after_marks: after[k]?.marks ?? [],
      group: 0,
    }),
  );
}
