import { parse } from '@unified-latex/unified-latex-util-parse';
import { attachMacroArgs } from '@unified-latex/unified-latex-util-arguments';
import type * as Ast from '@unified-latex/unified-latex-types';

// The paper's text as a reader sees it, with a way back to the source. A
// phrase in the PDF is often broken up in the LaTeX: by line breaks, ~, \emph,
// a macro standing for a name (\method), a comment or a citation. Searching
// this projection finds the phrase anyway, and each character remembers the
// source offset it came from, so a match is reported as file:line.
//
// The source is read by unified-latex's parser, which knows LaTeX's syntax:
// escaped % signs, verbatim, math, environments and the arguments of the
// common macros. Each node keeps its place in the source.

/** Macros whose arguments are not running text: dropped with their arguments. */
const DROP = new Set(['label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'Vref', 'nameref', 'cpageref', 'Cpageref', 'labelcref',
  'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite', 'Cite', 'Citep', 'Citet',
  'input', 'include', 'includegraphics', 'includepdf', 'usepackage', 'RequirePackage', 'documentclass', 'bibliography', 'bibliographystyle', 'addbibresource',
  'vspace', 'hspace', 'vskip', 'hskip', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'color', 'pagecolor', 'linespread', 'fontsize', 'newcommand', 'renewcommand',
  'providecommand', 'DeclareMathOperator', 'newenvironment', 'renewenvironment', 'def', 'let', 'graphicspath', 'pagestyle', 'thispagestyle', 'hypersetup', 'definecolor', 'url']);
/** Macros whose first argument is dropped and the rest kept (\textcolor{red}{text}, \href{url}{text}). */
const DROP_FIRST = new Set(['textcolor', 'href', 'colorbox']);
/** Placeholders for references and citations, so "Figure~\ref{x} shows" reads "Figure [ref] shows". */
const STAND_IN: Record<string, string> = { ref: '[ref]', eqref: '([ref])', autoref: '[ref]', cref: '[ref]', Cref: '[ref]', cite: '[cite]', citep: '[cite]', citet: '[cite]', parencite: '[cite]', textcite: '[cite]', autocite: '[cite]' };
const SYMBOLS: Record<string, string> = { '&': '&', '%': '%', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '/': '', '-': '', '@': '', '\\': ' ' };
const WORDS: Record<string, string> = { LaTeX: 'LaTeX', TeX: 'TeX', ldots: '...', dots: '...', textendash: '–', textemdash: '—', S: '§', ie: 'i.e.', eg: 'e.g.', etal: 'et al.' };
/** Arguments of macros the parser does not know, so they are dropped whole. */
const SIGNATURES: Record<string, { signature: string }> = Object.fromEntries(Object.entries({
  's m': ['vspace', 'hspace', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'Vref', 'nameref', 'cpageref', 'Cpageref', 'labelcref'], 'm m': ['setlength', 'addtolength', 'setcounter', 'addtocounter', 'fontsize'], 'm m m': ['definecolor', 'NewDocumentCommand', 'RenewDocumentCommand'], 's m m': ['DeclareMathOperator'],
  'o m': ['color', 'pagecolor', 'includegraphics', 'includepdf', 'usepackage', 'RequirePackage', 'documentclass', 'addbibresource'],
  'm': ['numberline', 'linespread', 'graphicspath', 'pagestyle', 'thispagestyle', 'hypersetup', 'url', 'input', 'include', 'bibliography', 'bibliographystyle', 'nocite', 'label'],
  's o o m': ['cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar', 'parencite', 'textcite', 'autocite', 'footcite', 'Cite', 'Citep', 'Citet'],
  'o m m': ['textcolor', 'colorbox', 'href'], 's m o o m': ['DeclareRobustCommand'],
} as Record<string, string[]>).flatMap(([signature, names]) => names.map(name => [name, { signature }])));

// A file is parsed once for each version of its text, keeping the most
// recently read texts up to a few megabytes.
const parsed = new Map<string, Ast.Root>(), CACHE_CHARS = 4_000_000;
let cachedChars = 0;
/** The parse of a LaTeX source, with the arguments of the macros above attached. */
export function parseTex(source: string): Ast.Root {
  let root = parsed.get(source);
  if (root) { parsed.delete(source); parsed.set(source, root); return root; }
  root = parse(source);
  attachMacroArgs(root, SIGNATURES);
  parsed.set(source, root); cachedChars += source.length;
  while (cachedChars > CACHE_CHARS && parsed.size > 1) { const oldest = parsed.keys().next().value!; cachedChars -= oldest.length; parsed.delete(oldest); }
  return root;
}

const start = (node: Ast.Node) => node.position?.start.offset ?? 0;
const end = (node: Ast.Node) => node.position?.end.offset ?? start(node);
/** Calls `visit` on every node, depth first, arguments included. */
export function eachNode(nodes: Ast.Node[], visit: (node: Ast.Node, siblings: Ast.Node[], index: number) => void) {
  nodes.forEach((node, index) => {
    visit(node, nodes, index);
    if (node.type === 'macro' && node.args) for (const arg of node.args) eachNode(arg.content, visit);
    if (node.type === 'environment' || node.type === 'mathenv') { for (const arg of node.args || []) eachNode(arg.content, visit); eachNode(node.content, visit); }
    else if ('content' in node && Array.isArray(node.content)) eachNode(node.content, visit);
  });
}
/** A macro's mandatory arguments, in order. */
export const braced = (node: Ast.Macro) => (node.args || []).filter(arg => arg.openMark === '{');
/** A macro's arguments that read as text: not its options or star. A list's \item holds its text as an argument. */
const readArgs = (node: Ast.Macro) => (node.args || []).filter(arg => arg.openMark !== '[' && arg.openMark !== '<' && !(arg.content.length === 1 && arg.content[0].type === 'string' && arg.content[0].content === '*'));
/** The plain characters of nodes, without what they mean: a label's or a key's text. */
export const literal = (nodes: Ast.Node[]): string => nodes.map(node => node.type === 'string' ? node.content : node.type === 'whitespace' ? ' ' : node.type === 'group' ? literal(node.content) : node.type === 'macro' ? `\\${node.content}` : '').join('');

export interface Projection { text: string; offsets: number[] }

const DEFINERS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'NewDocumentCommand', 'RenewDocumentCommand', 'DeclareMathOperator', 'def']);
export interface Definition { name: string; parameters: number; node: Ast.Macro; body: Ast.Node[] | null }
/** The macros a source defines: \newcommand and its kin, and \def. */
export function definitions(source: string) {
  const found: Definition[] = [];
  eachNode(parseTex(source).content, (node, siblings, index) => {
    if (node.type !== 'macro' || !DEFINERS.has(node.content)) return;
    if (node.content === 'def') {
      const name = siblings[index + 1], body = siblings[index + 2];
      if (name?.type === 'macro') found.push({ name: name.content, parameters: 0, node, body: body?.type === 'group' ? body.content : null });
      return;
    }
    const args = node.args || [], at = args.findIndex(arg => arg.content.some(item => item.type === 'macro'));
    const name = args[at]?.content.find(item => item.type === 'macro') as Ast.Macro | undefined;
    if (!name) return;
    // \newcommand{\name}[2]{...}: the first option after the name counts its parameters.
    const count = args.slice(at + 1, -1).find(arg => arg.openMark === '[' && arg.content.length);
    found.push({ name: name.content, parameters: Number(literal(count?.content || [])) || 0, node, body: args.length > at + 1 ? args.at(-1)!.content : null });
  });
  return found;
}
/** The text a macro's arguments hold, or the group after it when the parser does not know its arguments. */
export function argumentsOf(node: Ast.Macro, siblings: Ast.Node[], index: number) {
  const args = braced(node).map(arg => arg.content);
  const next = siblings[index + 1];
  return args.length ? args : next?.type === 'group' ? [next.content] : [];
}
/** Where the document's body starts, or 0 when the source has none. */
export function documentStart(source: string) {
  const body = parseTex(source).content.find(node => node.type === 'environment' && node.env === 'document');
  return body ? start(body) : 0;
}
/** Whether a line only leads into another file: \input{...} or \include{...}. */
export function onlyInput(line: string) {
  const nodes = parseTex(line).content.filter(node => node.type !== 'whitespace' && node.type !== 'comment');
  return nodes.length === 1 && nodes[0].type === 'macro' && (nodes[0].content === 'input' || nodes[0].content === 'include');
}
/** Text from TeX's contents and labels (.aux), read as plain text, with its \numberline apart. */
export function contentsEntry(text: string) {
  const nodes = parseTex(text).content, at = nodes.findIndex(node => node.type === 'macro' && node.content === 'numberline');
  if (at < 0) return { number: '', title: readingText(nodes) };
  const number = argumentsOf(nodes[at] as Ast.Macro, nodes, at)[0] || [], skip = (nodes[at] as Ast.Macro).args?.length ? 1 : 2;
  return { number: readingText(number), title: readingText([...nodes.slice(0, at), ...nodes.slice(at + skip)]) };
}
/** Nodes as the reader would read them. */
export const readingText = (nodes: Ast.Node[]) => projectNodes(nodes, new Map()).text.trim();
// A file's reading text and its words, worked out once for each version of it.
const reading = new WeakMap<Ast.Root, { text: Projection; words: number[]; lines: number[] }>();
/** How many words a reader would count in a source, or in its lines `from` to `to` (counted from 1). */
export function wordCount(source: string, from = 1, to = Infinity) {
  const root = parseTex(source);
  let read = reading.get(root);
  if (!read) {
    const text = projectNodes(root.content, new Map(), source), words: number[] = [], lines = [0];
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lines.push(i + 1);
    // Each word is counted where it starts in the source.
    for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.text)) if (part.isWordLike) words.push(text.offsets[part.index]);
    read = { text, words, lines }; reading.set(root, read);
  }
  const low = read.lines[from - 1] ?? source.length, high = read.lines[to] ?? Infinity;
  let count = 0;
  for (const at of read.words) if (at >= low && at < high) count++;
  return count;
}

/** Simple macros defined in the paper (no arguments, plain text body). */
export function simpleMacros(sources: string[]) {
  const macros = new Map<string, string>();
  // A body with # takes arguments; one with math or structure is not plain text.
  const plain = (body: Ast.Node[]) => {
    let simple = true;
    eachNode(body, node => {
      if (node.type === 'inlinemath' || node.type === 'displaymath' || node.type === 'environment' || node.type === 'mathenv' || (node.type === 'string' && node.content.includes('#'))
        || (node.type === 'macro' && ['ensuremath', 'mathrm', 'mathbf', 'operatorname', '#', '$'].includes(node.content))) simple = false;
    });
    return simple;
  };
  for (const source of sources) for (const definition of definitions(source)) {
    if (!['newcommand', 'renewcommand', 'def'].includes(definition.node.content) || definition.parameters || !definition.body || !plain(definition.body)) continue;
    macros.set(definition.name, readingText(definition.body));
  }
  return macros;
}

/** Projects LaTeX source onto reading text. */
export function project(source: string, macros: Map<string, string>): Projection {
  return projectNodes(parseTex(source).content, macros, source);
}

function projectNodes(nodes: Ast.Node[], macros: Map<string, string>, source = ''): Projection {
  let text = '';
  const offsets: number[] = [];
  const emit = (value: string, from: number, each = false) => {
    let i = 0;
    for (const ch of value) {
      const at = each ? from + i : from;
      i += ch.length;
      if (/\s/.test(ch)) { if (text && !text.endsWith(' ')) { text += ' '; offsets.push(at); } }
      else { text += ch; offsets.push(at); }
    }
  };
  const walk = (list: Ast.Node[]) => {
    for (let k = 0; k < list.length; k++) {
      const node = list[k], before = list[k - 1];
      // The parser folds the space after a macro or around an environment into
      // its neighbours; the source between two nodes still shows it.
      if (before && source && end(before) < start(node) && /\s/.test(source.slice(end(before), start(node)))) emit(' ', end(before));
      switch (node.type) {
        case 'string': if (node.content === '~') emit(' ', start(node)); else emit(node.content, start(node), true); break;
        case 'whitespace': case 'parbreak': emit(' ', start(node)); break;
        // "learns % note" and a line break before a comment line keep their
        // space; "learn%" joins the next line.
        case 'comment': if (node.leadingWhitespace || /\s/.test(source.slice(start(node), Math.max(start(node), source.indexOf('%', start(node)))))) emit(' ', start(node)); break;
        case 'group': case 'inlinemath': case 'displaymath': walk(node.content); break;
        case 'environment': case 'mathenv': emit(' ', start(node)); walk(node.content); emit(' ', end(node)); break;
        case 'verb': case 'verbatim': emit(node.content, start(node)); break;
        case 'macro': k += macro(node, list, k); break;
      }
    }
  };
  // Reads a macro; returns how many of the siblings after it it used up.
  const macro = (node: Ast.Macro, list: Ast.Node[], k: number) => {
    const name = node.content;
    if (name in SYMBOLS && !/^[a-zA-Z]/.test(name)) { emit(SYMBOLS[name], start(node)); return 0; }
    if (!/^[a-zA-Z@]/.test(name)) { for (const arg of node.args || []) walk(arg.content); return 0; } // An accent such as \'e: keep the letter.
    if (DROP.has(name)) {
      emit(STAND_IN[name] ? ` ${STAND_IN[name]}` : ' ', start(node));
      // \def\name{...} and \let\a\b keep their parts beside them.
      if (name === 'def') return list[k + 2]?.type === 'group' ? 2 : 1;
      if (name === 'let') return list[k + 1]?.type === 'macro' ? (literal(list.slice(k + 2, k + 3)) === '=' ? 3 : 2) : 0;
      return 0;
    }
    if (DROP_FIRST.has(name)) { for (const arg of braced(node).slice(1)) walk(arg.content); return 0; }
    const replacement = macros.get(name) ?? WORDS[name];
    if (replacement !== undefined) {
      emit(replacement, start(node));
      // \method{} and "\method " both end the macro name.
      const next = list[k + 1];
      return next?.type === 'group' && !next.content.length ? 1 : 0;
    }
    // Any other macro: its name and options disappear and its arguments read as text.
    if (node.args) { for (const arg of readArgs(node)) walk(arg.content); return 0; }
    const next = list[k + 1];
    if (next?.type !== 'string' || next.content !== '[') return 0;
    const close = list.findIndex((item, at) => at > k + 1 && item.type === 'string' && item.content === ']');
    return close < 0 ? 0 : close - k;
  };
  walk(nodes);
  return { text, offsets };
}

/** The line, counted from 1, of an offset in the source. */
export function lineAt(source: string, offset: number) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** The source with each comment blanked to spaces, so offsets and line numbers still point into the file. */
export function blankComments(source: string) {
  const comments: [number, number][] = [];
  eachNode(parseTex(source).content, node => { if (node.type === 'comment') comments.push([start(node), end(node)]); });
  if (!comments.length) return source;
  const chars = source.split('');
  for (const [from, to] of comments) {
    // The parser counts the space before a comment as part of it; only the % onwards is blanked.
    const percent = source.indexOf('%', from);
    for (let i = percent < 0 || percent >= to ? from : percent; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}
