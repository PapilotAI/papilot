import { opcodes } from "../core/diff.ts";
import type { Mark, Position, Rect } from "../types.ts";
import { containsCenter, PdfDocument, union, type Raster } from "./pdf.ts";
export const normalize = (text: string) =>
  text.normalize("NFKC").replaceAll("\u00ad", "");
export interface Glyph {
  text: string;
  rect: Rect;
  pair: number;
  page: number;
  space: boolean;
  appearance?: string;
  origin?: [number, number];
}
interface Word {
  text: string;
  rect: Rect;
  pair: number;
  page: number;
}
export function extract(
  document: PdfDocument,
  positions: Position[],
): [Glyph[], Word[]] {
  const glyphs: Glyph[] = [],
    words: Word[] = [];
  positions.forEach((position, pair) => {
    const page = document.page(position.page),
      clip = position.clip;
    for (const line of page.lines) {
      let space = true;
      for (const char of line.chars) {
        if (!containsCenter(clip, char.rect)) {
          space = true;
          continue;
        }
        for (const value of normalize(char.text)) {
          if (/\s/u.test(value)) space = true;
          else {
            glyphs.push({
              text: value,
              rect: char.rect,
              space,
              pair,
              page: position.page,
              appearance: char.appearance,
              origin: char.origin,
            });
            space = false;
          }
        }
      }
    }
    for (const word of page.words)
      if (containsCenter(clip, word.rect))
        words.push({
          text: normalize(word.text),
          rect: word.rect,
          pair,
          page: position.page,
        });
  });
  // A hyphen that breaks a word across lines is not a glyph of the word.
  // Its neighbours are letters, so no two such hyphens touch, and one pass
  // drops them all.
  const joined = glyphs.filter((b, i) => {
    const a = glyphs[i - 1],
      c = glyphs[i + 1];
    if (
      b.text === "-" &&
      a &&
      c &&
      /\p{L}/u.test(a.text) &&
      /\p{Ll}/u.test(c.text) &&
      (b.pair !== c.pair || c.rect[1] > b.rect[1] + 3)
    ) {
      c.space = false;
      return false;
    }
    return true;
  });
  return [joined, words];
}
export interface Token {
  text: string;
  start: number;
  end: number;
  /** Explicit footprint for a word joined across intervening page furniture. */
  glyphs?: number[];
  semanticGlyphs?: number[];
  flow?: "body" | "edge";
  /** Physical line-break boundaries within or immediately after this word. */
  breaks?: number[];
  /** A physical line-end hyphen not joined during document extraction. */
  hyphen?: boolean;
  /** First lexical fragment following a physical line-end hyphen. */
  afterHyphen?: boolean;
  /** Shared segmentation preserves the original word and its pieces. */
  part?: { word: number; index: number; total: number };
}
export const tokenGlyphs = (t: Token, semantic = false): number[] =>
  (semantic ? t.semanticGlyphs : t.glyphs) ??
  t.glyphs ??
  Array.from({ length: t.end - t.start }, (_, k) => t.start + k);
export function tokens(glyphs: Glyph[]) {
  const result: Token[] = [];
  let previousWord = false;
  glyphs.forEach((glyph, i) => {
    const word = /[\p{L}\p{N}_]/u.test(glyph.text);
    if (result.length && word && previousWord && !glyph.space) {
      result.at(-1)!.text += glyph.text;
      result.at(-1)!.end = i + 1;
    } else result.push({ text: glyph.text, start: i, end: i + 1 });
    previousWord = word;
  });
  return result;
}
export function mergeRects(rects: Rect[]): Rect[] {
  const canMerge = (a: Rect, b: Rect) => {
    const overlapsX = a[0] < b[2] && b[0] < a[2],
      verticalOverlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]),
      sameBand =
        (Math.abs(a[1] - b[1]) < 1.7 && Math.abs(a[3] - b[3]) < 2) ||
        (overlapsX &&
          verticalOverlap > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]));
    return sameBand && a[0] <= b[2] + 4 && b[0] <= a[2] + 4;
  };
  const result: Rect[] = [];
  for (const rect of [...rects].sort(
    (a, b) => Math.round((a[1] + a[3]) / 4) - Math.round((b[1] + b[3]) / 4) || a[0] - b[0],
  )) {
    let current: Rect = [...rect];
    for (let dirty = true; dirty;) {
      dirty = false;
      for (let i = result.length - 1; i >= 0; i--) {
        if (!canMerge(result[i], current)) continue;
        current = union(result[i], current);
        result.splice(i, 1);
        dirty = true;
      }
    }
    result.push(current);
  }
  return result.sort(
    (a, b) => Math.round((a[1] + a[3]) / 4) - Math.round((b[1] + b[3]) / 4) || a[0] - b[0],
  );
}
/** Snap changed glyph rects to uniform word height over each changed glyph's
 *  horizontal span so punctuation-only or delimiter edits do not highlight an
 *  unchanged neighbouring word. */
export function wordMarks(
  words: { rect: Rect }[],
  clip: Rect,
  glyphRects: Rect[],
  kind: Mark["kind"],
): Mark[] {
  if (!glyphRects.length) return [];
  const covered = new Set<number>(),
    boxes: Rect[] = [];
  for (const word of words) {
    if (!containsCenter(clip, word.rect)) continue;
    glyphRects.forEach((rect, index) => {
      if (!containsCenter(word.rect, rect)) return;
      covered.add(index);
      boxes.push([rect[0], word.rect[1], rect[2], word.rect[3]]);
    });
  }
  glyphRects.forEach((rect, index) => {
    if (!covered.has(index)) boxes.push(rect);
  });
  return mergeRects(boxes).map((rect) => ({ kind, rect }));
}
/** Merge overlapping/adjacent marks of the same kind so translucent overlays
 *  never double-darken when multiple edits share one rendered strip. */
export function mergeMarks(list: Mark[]): Mark[] {
  const byKind = new Map<Mark["kind"], Rect[]>();
  for (const mark of list) {
    const rects = byKind.get(mark.kind) ?? [];
    rects.push(mark.rect);
    byKind.set(mark.kind, rects);
  }
  return [...byKind].flatMap(([kind, rects]) =>
    mergeRects(rects).map((rect): Mark => ({ kind, rect })),
  );
}
function marks(
  glyphs: Glyph[],
  indices: number[],
  words: Word[],
  kind: Mark["kind"],
): Record<number, Mark[]> {
  const selected = new Map<number, Rect[]>();
  for (const i of new Set(indices)) {
    const g = glyphs[i];
    if (!selected.has(g.pair)) selected.set(g.pair, []);
    selected.get(g.pair)!.push(g.rect);
  }
  return Object.fromEntries(
    [...selected].map(([pair, rects]) => {
      const boxes = words
        .filter(
          (w) =>
            w.pair === pair && rects.some((r) => containsCenter(w.rect, r)),
        )
        .map((w) => w.rect);
      return [
        pair,
        mergeRects(boxes.length ? boxes : rects).map((rect) => ({
          kind,
          rect,
        })),
      ];
    }),
  );
}
export function joined(words: Word[]) {
  const result: string[] = [];
  let previous: Word | null = null;
  for (const word of words) {
    const last = result.at(-1) ?? "";
    if (
      previous &&
      /\p{L}-$/u.test(last) &&
      /^\p{Ll}/u.test(word.text) &&
      (word.pair !== previous.pair || word.rect[1] > previous.rect[3] - 2)
    )
      result[result.length - 1] = last.slice(0, -1) + word.text;
    else result.push(word.text);
    previous = word;
  }
  return result;
}
export function textChanges(
  oldDocument: PdfDocument | null,
  newDocument: PdfDocument | null,
  left: Position[],
  right: Position[],
) {
  const [a, aw] = left.length
      ? extract(oldDocument!, left)
      : ([[], []] as [Glyph[], Word[]]),
    [b, bw] = right.length
      ? extract(newDocument!, right)
      : ([[], []] as [Glyph[], Word[]]),
    at = tokens(a),
    bt = tokens(b);
  const removed: number[] = [],
    added: number[] = [],
    movedA: number[] = [],
    movedB: number[] = [];
  const indices = (t: ReturnType<typeof tokens>, i: number, j: number) =>
    t
      .slice(i, j)
      .flatMap((t) =>
        Array.from({ length: t.end - t.start }, (_, k) => t.start + k),
      );
  for (const [tag, i, j, x, y] of opcodes(
    at.map((t) => t.text),
    bt.map((t) => t.text),
  )) {
    const ai = indices(at, i, j),
      bi = indices(bt, x, y);
    if (tag !== "equal") {
      removed.push(...ai);
      added.push(...bi);
      continue;
    }
    ai.forEach((u, index) => {
      const v = bi[index],
        old = a[u],
        next = b[v],
        p = left[old.pair],
        q = right[next.pair],
        r = old.rect,
        s = next.rect;
      if (
        old.pair !== next.pair ||
        [
          r[0] - p.clip[0] - s[0] + q.clip[0],
          r[1] - p.clip[1] - s[1] + q.clip[1],
          r[2] - r[0] - s[2] + s[0],
          r[3] - r[1] - s[3] + s[1],
        ].some((d) => Math.abs(d) > 0.65)
      ) {
        movedA.push(u);
        movedB.push(v);
      }
    });
  }
  const changed = Boolean(removed.length || added.length),
    oldWords = joined(aw),
    newWords = joined(bw),
    edits = changed
      ? opcodes(oldWords, newWords)
          .filter((o) => o[0] !== "equal")
          .map(([, i, j, x, y]) => {
            const old = oldWords.slice(i, j).join(" "),
              next = newWords.slice(x, y).join(" ");
            return {
              old: old.slice(0, 180),
              new: next.slice(0, 180),
              truncated: old.length > 180 || next.length > 180,
            };
          })
      : [];
  return {
    old_marks: marks(
      a,
      changed ? removed : movedA,
      aw,
      changed ? "removed" : "moved",
    ),
    new_marks: marks(
      b,
      changed ? added : movedB,
      bw,
      changed ? "added" : "moved",
    ),
    text_changed: changed,
    moved: Boolean(movedA.length || movedB.length),
    text_available: Boolean(a.length || b.length),
    edits,
  };
}
// The pixels whose luminance-weighted color differs by 24 or more, white
// standing in outside an image. With `stop`, counting ends at that many.
export function pixelDifference(
  old: Raster | null,
  next: Raster | null,
  stop = Infinity,
  threshold = 24,
) {
  const width = Math.max(old?.width ?? 0, next?.width ?? 0),
    height = Math.max(old?.height ?? 0, next?.height ?? 0),
    weights = [0.299, 0.587, 0.114];
  let count = 0;
  for (let y = 0; y < height; y++) {
    const a = old && y < old.height ? y * old.stride : -1,
      b = next && y < next.height ? y * next.stride : -1;
    for (let x = 0; x < width; x++) {
      let difference = 0;
      for (let c = 0; c < 3; c++) {
        const u =
            a >= 0 && x < old!.width
              ? old!.pixels[
                  a + x * old!.channels + Math.min(c, old!.channels - 1)
                ]
              : 255,
          v =
            b >= 0 && x < next!.width
              ? next!.pixels[
                  b + x * next!.channels + Math.min(c, next!.channels - 1)
                ]
              : 255;
        difference += Math.abs(u - v) * weights[c];
      }
      if (difference > 0 && difference >= threshold && ++count >= stop)
        return count;
    }
  }
  return count;
}
