import { opcodesWithin } from "./diff.ts";
import type { Op } from "../types.ts";

// Keep TeX arguments, math and comments atomic. Plain prose is compared by
// words (by character for CJK), with punctuation and spacing preserved exactly.
export function textTokens(text: string): string[] {
  const result: string[] = [];
  const groupEnd = (start: number, open: string, close: string) => {
    let depth = 1,
      i = start + 1;
    for (; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return i + 1;
    }
    return text.length;
  };
  const delimited = (start: number, delimiter: string) => {
    for (let i = start; i < text.length; i++) {
      if (text.startsWith(delimiter, i)) return i + delimiter.length;
      if (text[i] === "\\") i++;
    }
    return text.length;
  };
  for (let i = 0; i < text.length;) {
    const start = i;
    if (text[i] === "%") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (text[i] === "$") {
      const delimiter = text.startsWith("$$", i) ? "$$" : "$";
      i = delimited(i + delimiter.length, delimiter);
    } else if (text.startsWith("\\(", i) || text.startsWith("\\[", i))
      i = delimited(i + 2, text[i + 1] === "(" ? "\\)" : "\\]");
    else if (text[i] === "{") i = groupEnd(i, "{", "}");
    else if (text[i] === "\\") {
      const environment = text
        .slice(i)
        .match(
          /^\\begin\{((?:equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math|array|tabular|verbatim|Verbatim|lstlisting|minted|tikzpicture)\*?)\}/,
        );
      if (environment) {
        const delimiter = `\\end{${environment[1]}}`,
          end = text.indexOf(delimiter, i + environment[0].length);
        i = end < 0 ? text.length : end + delimiter.length;
        result.push(text.slice(start, i));
        continue;
      }
      const command =
        text.slice(i).match(/^\\(?:[a-zA-Z@]+\*?|[^])/u)?.[0] ?? "\\";
      i += command.length;
      if (
        /^\\(?:verb|lstinline)\*?$/.test(command) &&
        text[i] &&
        !/\s/.test(text[i])
      )
        i = delimited(i + 1, text[i]);
      else
        for (;;) {
          const next = i + (text.slice(i).match(/^\s*/)?.[0].length ?? 0);
          if (text[next] !== "{" && text[next] !== "[") break;
          i = groupEnd(next, text[next], text[next] === "{" ? "}" : "]");
        }
    } else {
      const token = text
        .slice(i)
        .match(
          /^(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*|\s+|[^])/u,
        )![0];
      i += token.length;
    }
    result.push(text.slice(start, i));
  }
  return result;
}

const offsets = (parts: string[]) => {
  const result = [0];
  for (const part of parts) result.push(result.at(-1)! + part.length);
  return result;
};

/** Exact UTF-16 ranges. An unchanged word separates independent decisions;
 * unchanged spaces inside a rewritten phrase do not. Bounded for large edits. */
export function textEdits(before: string, after: string): Op[] {
  // Anchor on unchanged logical lines first, without cutting a multiline TeX
  // token. A very large rewrite then falls back only for that passage.
  const chunks = (text: string) => {
    const result: string[] = [];
    let current = "";
    for (const token of textTokens(text)) {
      current += token;
      if (token.includes("\n")) {
        result.push(current);
        current = "";
      }
    }
    if (current) result.push(current);
    return result;
  };
  const a = chunks(before),
    b = chunks(after),
    left = offsets(a),
    right = offsets(b),
    ops = opcodesWithin(a, b, 100);
  if (!ops) return [["replace", 0, before.length, 0, after.length]];
  return ops.flatMap(([tag, i, j, x, y]) =>
    tag === "equal"
      ? []
      : wordEdits(a.slice(i, j).join(""), b.slice(x, y).join("")).map(
          ([kind, s, e, u, v]): Op => [
            kind,
            left[i] + s,
            left[i] + e,
            right[x] + u,
            right[x] + v,
          ],
        ),
  );
}

function wordEdits(before: string, after: string): Op[] {
  const a = textTokens(before),
    b = textTokens(after),
    words = (tokens: string[]) => tokens.filter(token => !/^\s+$/.test(token)),
    oldWords = words(a), newWords = words(b);
  // Rewrapping prose moves spaces/newlines, not its words. A token LCS may
  // otherwise match the newline and expose a word as an independent deletion
  // plus insertion. Keep the formatting-only rewrite together so accepting a
  // subset cannot silently remove or duplicate that word.
  if (oldWords.length === newWords.length && oldWords.every((word, i) => word === newWords[i])) {
    let start = 0, end = before.length, nextEnd = after.length;
    while (start < end && start < nextEnd && before[start] === after[start]) start++;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
    if (start === end && start === nextEnd) return [];
    return [[start === end ? 'insert' : start === nextEnd ? 'delete' : 'replace', start, end, start, nextEnd]];
  }
  const left = offsets(a),
    right = offsets(b),
    hasInteriorNewline = (s: string) => /\S[\s\S]*\n[\s\S]*\S/.test(s),
    sharesWord = () => {
      const bSet = new Set(b.filter((t) => /[\p{L}\p{N}]/u.test(t)));
      return a.some((t) => /[\p{L}\p{N}]/u.test(t) && bSet.has(t));
    };
  let ops: Op[];
  if ((hasInteriorNewline(before) || hasInteriorNewline(after)) && sharesWord()) {
    // Keep blank-line paragraph breaks (\n\n / \r\n\r\n) anchored as non-space
    // tokens so edits in separate paragraphs or headings never merge across them.
    const isSpace = (token: string) =>
        /^\s+$/.test(token) && !/\r?\n[ \t]*\r?\n/.test(token),
      aWords: number[] = [],
      bWords: number[] = [];
    a.forEach((token, index) => { if (!isSpace(token)) aWords.push(index); });
    b.forEach((token, index) => { if (!isSpace(token)) bWords.push(index); });
    // Match non-whitespace tokens first when a changed region spans multiple
    // lines so prose line rewrapping (" " <-> "\n") alongside a real edit never
    // turns unchanged words into delete+insert pairs.
    const wordOps = opcodesWithin(
      aWords.map((index) => a[index]),
      bWords.map((index) => b[index]),
      100,
    );
    if (!wordOps) return [["replace", 0, before.length, 0, after.length]];
    ops = [];
    const pushOp = (tag: Op[0], i: number, j: number, x: number, y: number) => {
      if (i === j && x === y) return;
      const prev = ops.at(-1);
      if (tag === "equal" && prev?.[0] === "equal" && prev[2] === i && prev[4] === x) {
        prev[2] = j;
        prev[4] = y;
        return;
      }
      if (tag !== "equal" && prev && prev[0] !== "equal" && prev[2] === i && prev[4] === x) {
        prev[2] = j;
        prev[4] = y;
        prev[0] = prev[1] < prev[2] && prev[3] < prev[4] ? "replace" : prev[1] < prev[2] ? "delete" : "insert";
        return;
      }
      ops.push([tag, i, j, x, y]);
    };
    const emitSpan = (i: number, j: number, x: number, y: number) => {
      while (i < j && x < y && a[i] === b[x]) {
        pushOp("equal", i, i + 1, x, x + 1);
        i++;
        x++;
      }
      let tail = 0;
      while (j - tail > i && y - tail > x && a[j - 1 - tail] === b[y - 1 - tail]) tail++;
      const endI = j - tail,
        endY = y - tail;
      if (i < endI || x < endY)
        pushOp(i === endI ? "insert" : x === endY ? "delete" : "replace", i, endI, x, endY);
      if (tail) pushOp("equal", endI, j, endY, y);
    };
    let ai = 0,
      bi = 0;
    for (const [tag, wi, wj, wx, wy] of wordOps) {
      if (tag !== "equal") continue;
      for (let k = 0; k < wj - wi; k++) {
        const ta = aWords[wi + k],
          tb = bWords[wx + k];
        emitSpan(ai, ta, bi, tb);
        pushOp("equal", ta, ta + 1, tb, tb + 1);
        ai = ta + 1;
        bi = tb + 1;
      }
    }
    emitSpan(ai, a.length, bi, b.length);
  } else {
    const rawOps = opcodesWithin(a, b, 100);
    if (!rawOps) return [["replace", 0, before.length, 0, after.length]];
    ops = rawOps;
  }
  const meaningful = (tokens: string[], from: number, to: number) => {
    let count = 0;
    for (let k = from; k < to; k++) if (/[\p{L}\p{N}\\{}$]/u.test(tokens[k])) count++;
    return count;
  };
  const segments = ops.map(([tag, i, j, x, y]) => ({ equal: tag === "equal", i, j, x, y }));
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 1; k + 1 < segments.length; k++) {
      const eq = segments[k], prev = segments[k - 1], next = segments[k + 1];
      if (!eq.equal || prev.equal || next.equal) continue;
      const text = a.slice(eq.i, eq.j).join(""),
        q = meaningful(a, eq.i, eq.j),
        spanSize = Math.min(
          Math.max(meaningful(a, prev.i, prev.j), meaningful(b, prev.x, prev.y)),
          Math.max(meaningful(a, next.i, next.j), meaningful(b, next.x, next.y)),
        );
      const absorb =
        q === 0
          ? !/\r?\n[ \t]*\r?\n|[%\\{}$]|[.!?]\s*\r?\n/u.test(text) &&
            (!/\n/.test(text) || spanSize >= 2)
          : q <= 2 &&
            !/\r?\n[ \t]*\r?\n|[%\\{}$]|[.!?]\s*\r?\n/u.test(text) &&
            spanSize >= 2 * q;
      if (!absorb) continue;
      prev.j = next.j;
      prev.y = next.y;
      segments.splice(k, 2);
      changed = true;
      k--;
    }
  }
  return segments
    .filter((segment) => !segment.equal)
    .map((segment): Op => {
      const i = left[segment.i],
        j = left[segment.j],
        x = right[segment.x],
        y = right[segment.y];
      return [i === j ? "insert" : x === y ? "delete" : "replace", i, j, x, y];
    });
}

/** Merge disjoint word edits when Git's line merge cannot. A shared insertion
 * point or overlapping replacement remains a conflict; never pick a winner. */
export function mergeText(
  ours: Buffer,
  base: Buffer,
  theirs: Buffer,
): Buffer | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let a: string, b: string, c: string;
  try {
    [a, b, c] = [ours, base, theirs].map((data) => decoder.decode(data));
  } catch {
    return null;
  }
  const own = textEdits(b, a),
    incoming = textEdits(b, c);
  const changes = own.map((op) => ({
    start: op[1],
    end: op[2],
    text: a.slice(op[3], op[4]),
  }));
  for (const [, start, end, x, y] of incoming) {
    const text = c.slice(x, y);
    if (
      changes.some((e) => e.start === start && e.end === end && e.text === text)
    )
      continue;
    if (
      changes.some((e) =>
        start === end || e.start === e.end
          ? start <= e.end && e.start <= end
          : start < e.end && e.start < end,
      )
    )
      return null;
    changes.push({ start, end, text });
  }
  for (const edit of changes.sort((p, q) => q.start - p.start))
    b = b.slice(0, edit.start) + edit.text + b.slice(edit.end);
  return Buffer.from(b);
}
