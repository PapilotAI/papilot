import path from "node:path";
import { deepestNode } from "./outline.ts";
import { compact, doiOf, plain } from "./verify.ts";
import type {
  Bibliography,
  BibliographyEntry,
  Heading,
  MissingCitation,
  ReferenceCitation,
  ReferenceEntry,
  ReferenceField,
  ReferenceProblem,
  References,
  Span,
  Unit,
} from "../types.ts";

// BibTeX entries as they are written, so that a review can show a .bib
// change entry by entry and check it. The reader follows BibTeX: text
// outside entries and @comment are ignored, @string macros resolve, and a
// value is {braced}, "quoted", a number or a macro name, joined with #.

interface BibSource {
  file: string;
  lines: Span;
}
type Macros = Map<string, { resolved: string; dependencies: BibSource[] }>;
export interface BibField {
  name: string;
  /** The value as written, without its outer braces or quotes. */
  value: string;
  /** The value with macros expanded and parts joined. */
  resolved: string;
  /** Source lines of @string definitions used here, including nested macros. */
  dependencies?: BibSource[];
}
export interface BibEntry {
  key: string;
  type: string;
  fields: BibField[];
  /** First and last line of the entry, counted from 1. */
  lines: Span;
  /** Why the entry could not be read to its end. */
  error?: string;
}

const MONTHS: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};
// Line breaks and indentation inside a value are one space when typeset.
export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

class Unreadable extends Error {}

const defaultMacros = (): Macros => new Map(Object.entries(MONTHS).map(([name, resolved]) =>
  [name, { resolved, dependencies: [] }],
));

export function parseBib(text: string, file = "", macros = defaultMacros()): BibEntry[] {
  const lineAt = lines(text),
    entries: BibEntry[] = [];
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  // From an opening brace to just after its matching close.
  const braced = () => {
    const start = at;
    let depth = 0;
    // BibTeX counts every brace, \{ included.
    for (; at < text.length; at++) {
      if (text[at] === "{") depth++;
      else if (text[at] === "}" && --depth === 0) {
        at++;
        return text.slice(start + 1, at - 1);
      }
    }
    throw new Unreadable("A brace is not closed.");
  };
  const quoted = () => {
    const start = ++at;
    let depth = 0;
    for (; at < text.length; at++) {
      if (text[at] === "{") depth++;
      else if (text[at] === "}") depth--;
      else if (text[at] === '"' && depth === 0) {
        at++;
        return text.slice(start, at - 1);
      }
    }
    throw new Unreadable("A quotation mark is not closed.");
  };
  const name = () => {
    const match = /^[^\s=,{}()"#%]+/.exec(text.slice(at, at + 200));
    if (!match) return "";
    at += match[0].length;
    return match[0];
  };
  const value = (): Omit<BibField, "name"> => {
    const start = at,
      parts: { text: string; resolved: string }[] = [],
      dependencies: BibSource[] = [];
    for (;;) {
      space();
      const c = text[at];
      if (c === "{") {
        const inner = braced();
        parts.push({ text: inner, resolved: inner });
      } else if (c === '"') {
        const inner = quoted();
        parts.push({ text: inner, resolved: inner });
      } else {
        const word = name();
        if (!word) throw new Unreadable("A field has no value.");
        const macro = /^\d+$/.test(word) ? undefined : macros.get(word.toLowerCase());
        if (macro) dependencies.push(...macro.dependencies);
        parts.push({
          text: word,
          resolved: macro?.resolved ?? word,
        });
      }
      space();
      if (text[at] !== "#") break;
      at++;
    }
    return {
      value: collapse(parts.length === 1 ? parts[0].text : text.slice(start, at)),
      resolved: collapse(parts.map((p) => p.resolved).join("")),
      ...(dependencies.length ? { dependencies: uniqueSources(dependencies) } : {}),
    };
  };
  // `name = value` pairs up to the closing delimiter.
  const fields = (close: string) => {
    const result: BibField[] = [];
    for (;;) {
      space();
      if (text[at] === close) {
        at++;
        return result;
      }
      if (text[at] === ",") {
        at++;
        continue;
      }
      const field = name().toLowerCase();
      if (!field) {
        if (at >= text.length) throw new Unreadable("The entry is not closed.");
        throw new Unreadable(`Unexpected “${text[at]}” in the entry.`);
      }
      space();
      if (text[at] !== "=")
        throw new Unreadable(`The field “${field}” has no “=”.`);
      at++;
      result.push({ name: field, ...value() });
      space();
      if (text[at] !== "," && text[at] !== close)
        throw new Unreadable(`A comma is missing after the field “${field}”.`);
    }
  };
  for (;;) {
    const sign = text.indexOf("@", at);
    if (sign < 0) break;
    at = sign + 1;
    space();
    const type = /^[A-Za-z]+/.exec(text.slice(at, at + 40))?.[0].toLowerCase();
    if (!type) continue;
    at += type.length;
    space();
    const open = text[at];
    if (open !== "{" && open !== "(") continue;
    const close = open === "{" ? "}" : ")";
    if (type === "comment" || type === "preamble") {
      try {
        if (open === "{") braced();
        else at = Math.max(text.indexOf(")", at), at) + 1;
      } catch {
        at = text.length;
      }
      continue;
    }
    at++;
    if (type === "string") {
      try {
        for (const field of fields(close)) macros.set(field.name, {
          resolved: field.resolved,
          dependencies: uniqueSources([{ file, lines: [lineAt(sign), lineAt(at - 1)] }, ...(field.dependencies ?? [])]),
        });
      } catch {
        /* A broken macro leaves its uses unresolved. */
      }
      continue;
    }
    space();
    const keyStart = at;
    while (at < text.length && !/[,\s]/.test(text[at]) && text[at] !== close) at++;
    const entry: BibEntry = {
      key: text.slice(keyStart, at),
      type,
      fields: [],
      lines: [lineAt(sign), lineAt(sign)],
    };
    try {
      entry.fields = fields(close);
      entry.lines[1] = lineAt(at - 1);
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
      entry.error = error.message;
      // Read on from the next line that starts an entry.
      const next = /\n[ \t]*@/g;
      next.lastIndex = sign + 1;
      const found = next.exec(text);
      at = found ? found.index + 1 : text.length;
      entry.lines[1] = lineAt(Math.max(at - 1, sign));
    }
    entries.push(entry);
  }
  return entries;
}

export interface EntryChange {
  key: string;
  oldKey?: string;
  type: string;
  oldType?: string;
  status: "added" | "removed" | "modified";
  fields: ReferenceField[];
  /** Lines in the new file, or in the old one for a removed entry. */
  lines: Span;
  oldLines?: Span;
  /** Entry and macro definition lines that can change its effective values. */
  sources: BibSource[];
  oldSources?: BibSource[];
  error?: string;
}
const fieldMap = (entry: BibEntry) =>
  new Map(entry.fields.map((f) => [f.name, f]));
// Every field of an entry pair, those of the new entry in its order first.
function fieldChanges(old: BibEntry | null, next: BibEntry | null) {
  const before = old ? fieldMap(old) : new Map<string, BibField>(),
    after = next ? fieldMap(next) : new Map<string, BibField>(),
    names = [...after.keys(), ...[...before.keys()].filter((n) => !after.has(n))];
  return names.map((name): ReferenceField => {
    const a = before.get(name),
      b = after.get(name);
    return {
      name,
      old: a?.value ?? null,
      new: b?.value ?? null,
      ...(a && a.resolved !== a.value ? { oldResolved: a.resolved } : {}),
      ...(b && b.resolved !== b.value ? { resolved: b.resolved } : {}),
    };
  });
}
const plainTitle = (entry: BibEntry) =>
  (fieldMap(entry).get("title")?.resolved ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// The entries a change of one .bib file adds, removes or modifies. Entries
// pair by key; an added and a removed entry with the same title are one
// entry under a new key.
export function entryChanges(oldText: string, newText: string): EntryChange[] {
  return compareEntries(parseBib(oldText), parseBib(newText), "");
}
function compareEntries(before: BibEntry[], after: BibEntry[], file: string): EntryChange[] {
  const unpaired = new Map<string, BibEntry[]>();
  for (const entry of before)
    unpaired.set(entry.key, [...(unpaired.get(entry.key) ?? []), entry]);
  const pairs: [BibEntry | null, BibEntry | null][] = [];
  for (const entry of after) {
    const old = unpaired.get(entry.key)?.shift() ?? null;
    pairs.push([old, entry]);
  }
  const removed = [...unpaired.values()].flat();
  for (const pair of pairs) {
    if (pair[0]) continue;
    const title = plainTitle(pair[1]!),
      index = title
        ? removed.findIndex(
            (old) => plainTitle(old) === title && old.type === pair[1]!.type,
          )
        : -1;
    if (index >= 0) pair[0] = removed.splice(index, 1)[0];
  }
  for (const old of removed) pairs.push([old, null]);
  const changes: EntryChange[] = [];
  for (const [old, next] of pairs) {
    const fields = fieldChanges(old, next),
      entry = (next ?? old)!;
    if (
      old &&
      next &&
      old.key === next.key &&
      old.type === next.type &&
      old.error === next.error &&
      fields.every((f) => f.old === f.new && (f.oldResolved ?? f.old) === (f.resolved ?? f.new))
    )
      continue;
    changes.push({
      key: entry.key,
      ...(old && next && old.key !== next.key ? { oldKey: old.key } : {}),
      type: entry.type,
      ...(old && next && old.type !== next.type ? { oldType: old.type } : {}),
      status: !old ? "added" : !next ? "removed" : "modified",
      fields,
      lines: entry.lines,
      ...(old && next ? { oldLines: old.lines } : {}),
      sources: entrySources(entry, file),
      ...(old && next ? { oldSources: entrySources(old, file) } : {}),
      ...(next?.error ? { error: next.error } : {}),
    });
  }
  return changes.sort(
    (a, b) =>
      (a.status === "removed" ? 1 : 0) - (b.status === "removed" ? 1 : 0) ||
      a.lines[0] - b.lines[0],
  );
}

// Line ranges [start, end) of each entry, counted from 0, for grouping a
// .bib diff's hunks by entry.
const uniqueSources = (sources: BibSource[]): BibSource[] =>
  [...new Map(sources.map((source) => [JSON.stringify([source.file, source.lines]), source])).values()];
const entrySources = (entry: BibEntry, file: string) =>
  uniqueSources([{ file, lines: entry.lines }, ...entry.fields.flatMap((f) => f.dependencies ?? [])]);
export function entrySpans(text: string) {
  return parseBib(text).flatMap((e) => entrySources(e, "").map(({ lines: span }) => ({
    key: e.key,
    span: [span[0] - 1, span[1]] as Span,
  })));
}

// TeX comments, blanked so offsets and line numbers stay.
export function uncomment(text: string) {
  return text.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (match, before, slashes) =>
    before + slashes + " ".repeat(match.length - before.length - slashes.length),
  );
}
// Ignore comments and literal examples in one pass: a percent sign inside
// \verb is data, not the start of a comment. Preserve offsets and newlines.
function texSource(text: string) {
  const parts: string[] = [],
    tokens = /\\([A-Za-z]+)\*?|\\[^A-Za-z]|%[^\n]*/g,
    literal = /^(?:verbatim\*?|Verbatim\*?|BVerbatim|LVerbatim|SaveVerbatim|lstlisting|minted|comment)$/;
  let from = 0;
  for (let token; (token = tokens.exec(text)); ) {
    let end = tokens.lastIndex;
    const command = token[1];
    if (token[0].startsWith("%")) {
      // The whole comment is already consumed.
    } else if (command === "begin") {
      const env = /^\s*\{([^}]+)\}/.exec(text.slice(end));
      if (!env || !literal.test(env[1])) continue;
      const close = new RegExp(String.raw`\\end\s*\{${env[1].replace("*", "\\*")}\}`, "g");
      close.lastIndex = end + env[0].length;
      const found = close.exec(text);
      end = found ? close.lastIndex : text.length;
    } else if (command === "verb" || command === "Verb" || command === "lstinline" || command === "mintinline") {
      if (command !== "verb") end += /^\s*(?:\[[^\]]*\])?/.exec(text.slice(end))![0].length;
      if (command === "mintinline") {
        const language = /^\s*\{[^}]*\}\s*/.exec(text.slice(end));
        if (!language) continue;
        end += language[0].length;
      }
      const delimiter = text[end];
      if (!delimiter || /\s/.test(delimiter)) continue;
      if (delimiter === "{" && (command === "lstinline" || command === "mintinline")) {
        let depth = 1;
        while (++end < text.length && depth) {
          if (text[end] === "{") depth++;
          else if (text[end] === "}") depth--;
        }
        end = Math.min(end, text.length);
      } else {
        const close = text.indexOf(delimiter, end + 1), newline = text.indexOf("\n", end + 1);
        end = close >= 0 && (newline < 0 || close < newline)
          ? close + 1 : newline >= 0 ? newline : text.length;
      }
    } else if (token[0] !== "\\\\") {
      continue;
    }
    parts.push(text.slice(from, token.index), text.slice(token.index, end).replace(/[^\n\r]/g, " "));
    from = end;
    tokens.lastIndex = end;
  }
  return parts.join("") + text.slice(from);
}
// The line of each offset, counted from 1.
function lines(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset: number) => {
    let low = 0,
      high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}
// Commands that print a citation or add one to the bibliography, in the
// forms of LaTeX, natbib and biblatex, including \cites{a}{b}.
const CITE = /\\([A-Za-z]*[cC]ite[A-Za-z]*|nocite)\*?(?![A-Za-z])/g;
const NOT_CITES = new Set(["citestyle", "citesetup", "citeindextrue", "citeindexfalse", "citename"]);
// Each citation command in comment-free source: its name, where it starts
// and ends, each key with where its braces open, and its notes, such as
// "see" and "p. 3" in \citep[see][p.~3]{key}.
function citeCommands(source: string) {
  const found: { name: string; start: number; end: number; keys: { key: string; at: number }[]; notes: string[] }[] = [],
    options = /\s*(?:\([^)]*\)\s*)*((?:\[[^\]]*\]\s*)*)/y,
    body = /\{([^{}]*)\}/y;
  for (const match of source.matchAll(CITE)) {
    if (NOT_CITES.has(match[1])) continue;
    let at = match.index + match[0].length;
    const keys: { key: string; at: number }[] = [],
      notes: string[] = [],
      groups = match[1].endsWith("cites") ? Infinity : 1;
    for (let taken = 0; taken < groups; ) {
      options.lastIndex = at;
      const option = options.exec(source)!;
      body.lastIndex = at + option[0].length;
      const group = body.exec(source);
      if (!group) break;
      for (const note of option[1].matchAll(/\[([^\]]*)\]/g)) notes.push(note[1]);
      for (const key of group[1].split(",").map((k) => k.trim()).filter((k) => k && !/[\\#\s]/.test(k)))
        keys.push({ key, at: at + option[0].length });
      at = body.lastIndex;
      taken++;
    }
    if (keys.length) found.push({ name: match[1], start: match.index, end: at, keys, notes });
  }
  return found;
}
export function citations(text: string, file: string) {
  const source = texSource(text),
    lineAt = lines(source);
  return citeCommands(source).flatMap((command) => command.keys.map(({ key, at }) => ({ key, file, line: lineAt(at) })));
}

type Command = ReturnType<typeof citeCommands>[number];
// What bounds a sentence besides its punctuation: a blank line, a heading,
// an item, the edge of an environment, the start of a caption, and in a
// table a cell or a row.
const BLOCK = /\n[ \t]*\n|\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}|\\item\b(?:\s*\[[^\]]*\])?|\\(?:begin|end)\s*\{[^{}]*\}|\\caption\s*(?:\[[^\]]*\]\s*)?\{|(?<!\\)&/g;
// A full stop after one of these, or after an initial, does not end a sentence.
const ABBREVIATION = /(?:^|[^A-Za-z])(?:e\.g|i\.e|et al|al|cf|vs|etc|viz|resp|approx|Fig|Figs|Sec|Secs|Eq|Eqs|Tab|Thm|Def|Lem|Prop|Cor|Ch|Chap|App|No|Nos|pp|vol|Dr|Prof|[A-Za-z])$/;
const MATH = /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
// A full stop ends a sentence before a space, or before a footnote, which
// is a sentence of its own.
const PUNCTUATION = /[.!?](?=["'’”)\]}]*(?:\s|$|\\footnote\b))/g;
// A textual citation names the work in the sentence, often as its subject.
const TEXTUAL = /^(?:[cC]ite(?:t|alt|author|title|year|yearpar|date)|[tT]extcite)$/;
// Where each sentence of a file may start and end, found once per file:
// footnotes are sentences of their own, and a full stop in math or a
// footnote does not end the sentence around it.
function layout(text: string, source: string) {
  const inside = (ranges: [number, number][], at: number) => {
    let low = 0, high = ranges.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (ranges[mid][1] <= at) low = mid + 1;
      else if (ranges[mid][0] > at) high = mid - 1;
      else return ranges[mid];
    }
    return undefined;
  };
  const notes: [number, number][] = [];
  for (const match of source.matchAll(/\\footnote\s*(?:\[[^\]]*\]\s*)?\{/g)) {
    const open = match.index + match[0].length;
    if (notes.length && open < notes.at(-1)![1]) continue;
    let depth = 1, at = open;
    for (; at < source.length && depth; at++) depth += source[at] === "{" ? 1 : source[at] === "}" ? -1 : 0;
    notes.push([open, depth ? source.length : at - 1]);
  }
  const math = [...source.matchAll(MATH)].map((m): [number, number] => [m.index, m.index + m[0].length]);
  const ends = (from: number, to: number, top: boolean) => {
    const found: number[] = [];
    PUNCTUATION.lastIndex = from;
    for (let match; (match = PUNCTUATION.exec(source)) && match.index < to; ) {
      if (inside(math, match.index) || (top && inside(notes, match.index))) continue;
      if (match[0] === "." && ABBREVIATION.test(source.slice(Math.max(from, match.index - 12), match.index))) continue;
      found.push(match.index + 1);
    }
    return found;
  };
  const bounds = [...source.matchAll(BLOCK)].map((m): [number, number] => [m.index, m.index + m[0].length])
    .concat([...text.matchAll(/\\\\(?![A-Za-z])/g)].map((m): [number, number] => [m.index, m.index + 2]))
    .filter(([at]) => !inside(notes, at) && !inside(math, at))
    .sort((a, b) => a[0] - b[0]);
  return { notes, bounds, ends: ends(0, source.length, true), endsIn: (from: number, to: number) => ends(from, to, false), note: (at: number) => inside(notes, at) };
}
type Layout = ReturnType<typeof layout>;
// Whether a citation is part of the sentence after it rather than the end
// of the one before: a textual citation, or one followed by a lowercase
// word or a possessive, as in "\citet{x} proposed" or "\citeauthor{x}'s".
const opensSentence = (source: string, command: Command) =>
  TEXTUAL.test(command.name) || /^\s*[a-z'’]/.test(source.slice(command.end, command.end + 8));
// The sentence a citation belongs to: the one it stands in, or, for a
// citation right after a full stop, the one it follows, which the next
// sentence then starts after.
function sentenceAround(source: string, map: Layout, command: Command, commands: Command[]) {
  const { start, end } = command,
    note = map.note(start);
  let blockStart = 0,
    blockEnd = source.length,
    ends: number[];
  if (note) {
    [blockStart, blockEnd] = note;
    ends = map.endsIn(blockStart, blockEnd);
  } else {
    for (const [at, after] of map.bounds) {
      if (after <= start) blockStart = after;
      else if (at >= end) { blockEnd = at; break; }
    }
    ends = map.ends.filter((at) => at > blockStart && at <= blockEnd);
  }
  const before = ends.filter((at) => at <= start),
    after = ends.find((at) => at >= end);
  let from = before.at(-1) ?? blockStart,
    to = after ?? blockEnd;
  if (before.length && !opensSentence(source, command) && !source.slice(from, start).trim().replace(/^~/, "")) {
    to = Math.max(from, end);
    from = before.at(-2) ?? blockStart;
  }
  for (let next; (next = commands.find((c) => c.start >= from && c.start < start && !opensSentence(source, c) && !source.slice(from, c.start).trim().replace(/^~/, ""))); ) from = next.end;
  return [from, to] as const;
}
// Commands that only format or space their text: their names go and their
// text stays. Other commands, such as a paper's own macros, keep their name.
const FORMATTING = new Set(["emph", "textbf", "textit", "texttt", "textsc", "textsf", "textrm", "textup", "textsl", "textnormal", "textmd", "mathrm", "mathit", "mathbf", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "mathscr", "boldsymbol", "bm", "text", "mbox", "hbox", "makebox", "fbox", "underline", "uline", "sout", "ensuremath", "operatorname", "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "itshape", "ttfamily", "rmfamily", "sffamily", "scshape", "upshape", "mdseries", "noindent", "xspace", "quad", "qquad", "enspace", "thinspace", "nobreak", "relax", "left", "right", "big", "Big", "bigl", "bigr", "Bigl", "Bigr", "displaystyle", "textstyle", "protect", "null", "centering", "raggedright", "par", "toprule", "midrule", "bottomrule", "hline", "newline", "linebreak"]);
const WORDS: Record<string, string> = { ldots: "…", dots: "…", cdots: "⋯", BibTeX: "BibTeX", eg: "e.g.", ie: "i.e.", etal: "et al." };
// Math as it reads, for claims about types and logic.
const SYMBOLS: Record<string, string> = Object.fromEntries(
  "forall ∀ exists ∃ to → rightarrow → Rightarrow ⇒ leftarrow ← Leftarrow ⇐ leftrightarrow ↔ mapsto ↦ leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ in ∈ notin ∉ subseteq ⊆ subset ⊂ supseteq ⊇ cup ∪ cap ∩ times × vdash ⊢ dashv ⊣ models ⊨ infty ∞ langle ⟨ rangle ⟩ wedge ∧ land ∧ vee ∨ lor ∨ neg ¬ lnot ¬ top ⊤ bot ⊥ equiv ≡ approx ≈ sim ∼ simeq ≃ cong ≅ circ ∘ oplus ⊕ otimes ⊗ emptyset ∅ varnothing ∅ ell ℓ partial ∂ sum ∑ prod ∏ int ∫ cdot ⋅ star ⋆ sqsubseteq ⊑ sqcup ⊔ sqcap ⊓ uparrow ↑ downarrow ↓ hookrightarrow ↪ leadsto ⇝ triangleq ≜"
    .split(" ")
    .flatMap((word, i, all) => (i % 2 ? [] : [[word, all[i + 1]]])),
);
// A sentence of source as it reads: citations as [key, …] with their notes,
// references as [ref], footnotes left to their own sentences, formatting
// commands and braces gone.
function prose(source: string, from: number, to: number, commands: Command[], map: Layout) {
  const own = map.note(from);
  const cuts: { start: number; end: number; text: string }[] = [];
  for (const command of commands) {
    if (command.end <= from || command.start >= to) continue;
    const keys = [...new Set(command.keys.map((k) => k.key))].join(", "),
      [pre, post] = command.notes.length > 1 ? command.notes : ["", command.notes[0] ?? ""];
    cuts.push({ start: command.start, end: command.end, text: `\u0000${pre.trim() ? pre.trim() + " " : ""}${keys}${post.trim() ? ", " + post.trim() : ""}\u0001` });
  }
  for (const [open, close] of map.notes) {
    if (open > from && close < to && (!own || own[0] !== open)) {
      const command = source.lastIndexOf("\\footnote", open);
      cuts.push({ start: command, end: close + 1, text: "" });
    }
  }
  cuts.sort((a, b) => a.start - b.start);
  let text = "",
    at = from;
  for (const cut of cuts) {
    if (cut.end <= at) continue;
    text += source.slice(at, Math.max(at, cut.start)) + cut.text;
    at = Math.max(at, cut.end);
  }
  text += source.slice(at, to);
  return plain(
    text
      // A displayed formula stands as one; inline math is kept, as types and terms are claims too.
      .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, " [formula] ")
      .replace(/\\(?:ref|eqref|cref|Cref|autoref|pageref|nameref|vref)\*?\s*\{[^{}]*\}/g, "[ref]")
      // Boxes and table rules keep their text and lose their sizes.
      .replace(/\\(?:raisebox|scalebox)\s*\{[^{}]*\}(?:\s*\[[^\]]*\])*|\\resizebox\*?\s*\{[^{}]*\}\s*\{[^{}]*\}|\\(?:makebox|framebox|parbox)\s*(?:\[[^\]]*\]\s*)*(?:\{[^{}]*\}(?=\s*\{))?|\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}|\\(?:cmidrule|cline)\s*(?:\([^)]*\))?\s*\{[^{}]*\}/g, "")
      .replace(/\\(?:label|index|hypertarget|hspace|vspace|includegraphics|rule|phantom|hphantom|vphantom|setlength|addtolength)\*?\s*(?:\[[^\]]*\]\s*)?(?:\{[^{}]*\}\s*){0,2}/g, "")
      // Names plain() knows, such as Greek letters, stay for it to write.
      .replace(/\\([A-Za-z]{2,})\*?(?![A-Za-z])/g, (match, name: string) => SYMBOLS[name] ?? WORDS[name] ?? (FORMATTING.has(name) ? "" : plain(match) ? match : name)),
  )
    .replace(/[{}$]/g, "")
    .replace(/~/g, " ")
    .replace(/\u0000/g, "[")
    .replace(/\u0001/g, "]")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A place the document cites works, with the sentence that makes the claim. */
export interface CitingSentence { keys: string[]; file: string; line: number; section: string | null; sentence: string }
/** Every sentence that cites works, in reading order, with all the works it
 * cites, for checking what they say against it. \nocite adds to the
 * bibliography without a claim, so it is left out. */
export function citingSentences(doc: Document): CitingSentence[] {
  const { files } = documentFiles((f) => doc.read(f), doc.main),
    found: CitingSentence[] = [];
  for (const file of files) {
    const text = doc.read(file);
    if (text == null) continue;
    const source = texSource(text),
      lineAt = lines(source),
      commands = citeCommands(source),
      map = layout(text, source),
      sentences = new Map<string, CitingSentence>();
    for (const command of commands) {
      const keys = [...new Set(command.keys.map((k) => k.key))].filter((key) => key !== "*");
      if (command.name === "nocite" || !keys.length) continue;
      const [from, to] = sentenceAround(source, map, command, commands),
        known = sentences.get(`${from}:${to}`);
      if (known) {
        known.keys = [...new Set([...known.keys, ...keys])];
        continue;
      }
      const line = lineAt(command.keys[0].at),
        sentence: CitingSentence = { keys, file, line, section: sectionOf(doc, file, line), sentence: prose(source, from, to, commands, map) };
      sentences.set(`${from}:${to}`, sentence);
      found.push(sentence);
    }
  }
  return found;
}

// The document's files in reading order, from the main file through
// \input, \include, \subfile and \import, and the .bib files it names.
export function documentFiles(read: (file: string) => string | null, main: string) {
  const base = path.posix.dirname(main),
    files: string[] = [],
    bibs: string[] = [];
  const resolve = (name: string, dir = base, extension = ".tex") => {
    name = name.trim();
    if (!name || /[\\#]/.test(name)) return null;
    const file = path.posix.normalize(path.posix.join(dir, name));
    if (file.startsWith("../") || path.posix.isAbsolute(name)) return null;
    return path.posix.extname(file) ? file : file + extension;
  };
  const walk = (file: string) => {
    if (files.includes(file)) return;
    const text = read(file);
    if (text == null) return;
    files.push(file);
    const source = texSource(text),
      here = path.posix.dirname(file);
    for (const m of source.matchAll(
      /\\(?:input|include|subfile|InputIfFileExists)\s*\{([^}]+)\}|\\(sub)?(?:import|inputfrom|includefrom)\*?\s*\{([^}]*)\}\s*\{([^}]+)\}|\\bibliography\s*\{([^}]+)\}|\\add(?:bibresource|globalbib|sectionbib)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
    )) {
      if (m[5] || m[6]) {
        for (const name of m[5] ? m[5].split(",") : [m[6]]) {
          const bib = resolve(name, base, ".bib");
          if (bib && !bibs.includes(bib)) bibs.push(bib);
        }
        continue;
      }
      const target = m[1]
        ? resolve(m[1])
        : resolve(m[4], path.posix.join(m[2] ? here : base, m[3]));
      if (target) walk(target);
    }
  };
  walk(main);
  return { files, bibs };
}

/** A built document as the reference check reads it. */
export interface Document {
  read(file: string): string | null;
  main: string;
  outline: Heading[];
}
function citationsOf(doc: Document) {
  const { files, bibs } = documentFiles((f) => doc.read(f), doc.main),
    cites = files.flatMap((file) => citations(doc.read(file) ?? "", file)),
    entries = bibliographyEntries(doc.read.bind(doc), bibs),
    keys = new Map<string, number>();
  for (const values of entries.values())
    for (const entry of values)
      keys.set(entry.key, (keys.get(entry.key) ?? 0) + 1);
  return { cites, bibs, entries, keys, all: cites.some((c) => c.key === "*") };
}
// BibTeX reads databases in declaration order, retaining @string definitions
// for subsequent files. Keep the defining file with every dependency.
export function bibliographyEntries(read: (file: string) => string | null, bibs: string[]) {
  const macros = defaultMacros();
  return new Map(bibs.map((file) => [file, parseBib(read(file) ?? "", file, macros)]));
}
const sectionOf = (doc: Document, file: string, line: number) => {
  const node = deepestNode(doc.outline, file, line, line);
  return node ? `${node.number} ${node.title}`.trim() : null;
};
const meets = (a: Span, b: Span) => a[0] <= b[1] && b[0] <= a[1];
// A grouped macro edit can span unrelated entries. Match its actual edits,
// not the envelope between the first and last hunk.
function changesSources(unit: Unit, sources: BibSource[], side: "old" | "new") {
  const own = sources.filter((source) => source.file === unit.file);
  if (unit.whole_file) return own.length > 0;
  const ranges: Span[] = unit.ops.length
    ? unit.ops.map((op) => side === "old" ? [op[1], op[2]] : [op[3], op[4]])
    : [side === "old" ? [unit.old_start - 1, unit.old_end] : [unit.new_start - 1, unit.new_end]];
  return own.some(({ lines: [start, end] }) => ranges.some(([a, b]) =>
    a === b ? start - 1 < a && a < end : a < end && start - 1 < b,
  ));
}

// What a round changes in the bibliography: each added, removed or modified
// entry under the edit it belongs to, where the revised document cites it,
// and the keys it newly cites without an entry.
export function referenceChanges(
  units: Unit[],
  old: Document,
  next: Document,
): References | undefined {
  const bibUnits = units.filter((u) => u.file.endsWith(".bib") && u.kind === "text");
  const before = citationsOf(old),
    after = citationsOf(next),
    entries: ReferenceEntry[] = [];
  for (const file of new Set([...bibUnits.map((u) => u.file), ...before.bibs, ...after.bibs])) {
    const counts = new Map<string, number>(),
      a = before.entries.get(file) ?? parseBib(old.read(file) ?? "", file),
      b = after.entries.get(file) ?? parseBib(next.read(file) ?? "", file);
    for (const change of compareEntries(a, b, file)) {
      const affected = bibUnits.filter((u) =>
        change.status === "removed"
          ? changesSources(u, change.sources, "old")
          : changesSources(u, change.sources, "new") ||
            (change.oldSources !== undefined && changesSources(u, change.oldSources, "old")),
      );
      if (!affected.length) continue;
      const n = (counts.get(change.key) ?? 0) + 1;
      counts.set(change.key, n);
      const cited = (key: string) =>
          after.cites
            .filter((c) => c.key === key)
            .map(
              (c): ReferenceCitation => ({
                file: c.file,
                line: c.line,
                section: sectionOf(next, c.file, c.line),
              }),
            ),
        problems: ReferenceProblem[] = [];
      if (change.error) problems.push("unreadable");
      if (change.status !== "removed" && (after.keys.get(change.key) ?? 0) > 1)
        problems.push("duplicate-key");
      const gone = change.status === "removed" ? change.key : change.oldKey;
      if (gone && !after.keys.has(gone) && cited(gone).length)
        problems.push("still-cited");
      if (after.bibs.length && !after.bibs.includes(file))
        problems.push("not-in-bibliography");
      entries.push({
        id: `${file}#${change.key}${n > 1 ? `#${n}` : ""}`,
        unit: affected[0].id,
        ...(affected.length > 1 ? { units: affected.map((u) => u.id) } : {}),
        file,
        key: change.key,
        ...(change.oldKey ? { old_key: change.oldKey } : {}),
        type: change.type,
        ...(change.oldType ? { old_type: change.oldType } : {}),
        status: change.status,
        fields: change.fields,
        lines: change.lines,
        cited: cited(change.key),
        ...(gone && gone !== change.key ? { old_cited: cited(gone) } : {}),
        problems,
        ...(change.error ? { error: change.error } : {}),
      });
    }
  }
  // Keys the revised document cites with no entry in its bibliography, if
  // it names one and did not already lack them.
  const missing: MissingCitation[] = [];
  if (after.bibs.length) {
    // A key whose entry this round removes or renames is shown with it.
    const lacking = new Set([
      ...before.cites.filter((c) => !before.keys.has(c.key)).map((c) => c.key),
      ...entries.flatMap((e) => (e.status === "removed" ? [e.key] : e.old_key ? [e.old_key] : [])),
    ]);
    for (const cite of after.cites) {
      if (cite.key === "*" || after.keys.has(cite.key) || lacking.has(cite.key))
        continue;
      const unit = units.find(
        (u) =>
          u.file === cite.file &&
          u.status !== "deleted" &&
          meets([cite.line, cite.line], [u.new_start, u.new_end]),
      );
      missing.push({
        key: cite.key,
        file: cite.file,
        line: cite.line,
        unit: unit?.id ?? null,
        section: sectionOf(next, cite.file, cite.line),
      });
    }
  }
  if (!entries.length && !missing.length) return undefined;
  return { entries, missing };
}

// The paper's whole bibliography as it is, for a panel that checks it
// rather than a round's changes.
export function bibliographyReport(doc: Document): Bibliography {
  const read = (file: string) => doc.read(file),
    { files, bibs } = documentFiles(read, doc.main),
    parsed = bibliographyEntries(read, bibs),
    cites = files.flatMap((file) => citations(read(file) ?? "", file)),
    place = (c: { file: string; line: number }): ReferenceCitation => ({
      file: c.file,
      line: c.line,
      section: sectionOf(doc, c.file, c.line),
    }),
    entries: BibliographyEntry[] = [],
    absent: string[] = [],
    counts = new Map<string, number>();
  for (const file of bibs) {
    const text = read(file);
    if (text == null) {
      absent.push(file);
      continue;
    }
    for (const entry of parsed.get(file)!) {
      const n = (counts.get(`${file}#${entry.key}`) ?? 0) + 1;
      counts.set(`${file}#${entry.key}`, n);
      entries.push({
        id: `${file}#${entry.key}${n > 1 ? `#${n}` : ""}`,
        file,
        key: entry.key,
        type: entry.type,
        fields: entry.fields.map((f) => ({
          name: f.name,
          value: f.value,
          ...(f.resolved !== f.value ? { resolved: f.resolved } : {}),
        })),
        lines: entry.lines,
        cited: cites.filter((c) => c.key === entry.key).map(place),
        ...(entry.error ? { error: entry.error } : {}),
      });
    }
  }
  const keys = new Set(entries.map((e) => e.key)),
    group = (value: (e: BibliographyEntry) => string) => {
      const groups = new Map<string, BibliographyEntry[]>();
      for (const entry of entries) {
        const v = value(entry);
        if (v) groups.set(v, [...(groups.get(v) ?? []), entry]);
      }
      return [...groups.values()].filter((list) => list.length > 1);
    },
    field = (e: BibliographyEntry, name: string) => {
      const f = e.fields.find((x) => x.name === name);
      return f ? (f.resolved ?? f.value) : "";
    },
    titled = (e: BibliographyEntry) => {
      const title = compact(field(e, "title"));
      return title.length >= 15 ? title : "";
    },
    distinct = (list: BibliographyEntry[]) => new Set(list.map((e) => e.key)).size > 1;
  return {
    bibs,
    absent,
    entries,
    missing: bibs.length
      ? cites.filter((c) => c.key !== "*" && !keys.has(c.key)).map((c) => ({ key: c.key, ...place(c) }))
      : [],
    duplicates: group((e) => e.key).map((list) => list.map((e) => e.id)),
    similar: [
      ...group((e) => (doiOf(Object.fromEntries(e.fields.map((f) => [f.name, f.resolved ?? f.value]))) ?? "").toLowerCase())
        .filter(distinct)
        .map((list) => ({ ids: list.map((e) => e.id), by: "doi" as const })),
      ...group(titled)
        .filter(distinct)
        .map((list) => ({ ids: list.map((e) => e.id), by: "title" as const })),
    ],
    all_cited: cites.some((c) => c.key === "*"),
  };
}
