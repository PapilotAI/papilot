import fs from 'node:fs';
import path from 'node:path';
import type { CollaborationRole, CollaborationRoute, CollaborationStrategy, NoteSummary } from '../shared.ts';
import type { GroupInstructions } from '../note-groups.ts';
import { canonicalGroup } from '../note-groups.ts';
import { realPath } from './real-path.ts';

export interface CurrentTurnNote {
  /** 1-based index into the current run's `meta.notes` (matches `PreparedNoteOptions.note`). */
  noteNumber: number;
  id: string;
  note: NoteSummary;
  instruction?: string;
}

export interface LocatedNote extends CurrentTurnNote {
  file: string | null;
  /** 1-based inclusive source line range in `file`. */
  lines: [number, number] | null;
  /** 1-based inclusive paragraph window around `lines`. */
  window: [number, number] | null;
}

export interface NoteCluster {
  id: string;
  file: string;
  /** 1-based inclusive union of note lines. */
  lines: [number, number];
  /** 1-based inclusive passage window sent to workers. */
  window: [number, number];
  notes: LocatedNote[];
  excerpt: string;
}

export interface RoutedUnit {
  clusterId: string;
  mode: 'assign' | 'race' | 'answer';
  role: CollaborationRole;
  instruction: string;
}

export interface RoutingPlan {
  units: RoutedUnit[];
  fallback: boolean;
  reason?: string;
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function safeReadText(root: string, file: string): string | null {
  const parts = file.split(/[\\/]/);
  if (!file || path.isAbsolute(file) || parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return null;
  try {
    const base = realPath(root);
    let target = base;
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) return null;
    }
    const relative = path.relative(base, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    const bytes = fs.readFileSync(target);
    if (bytes.includes(0) || bytes.length > 2 * 1024 * 1024) return null;
    return bytes.toString('utf8');
  } catch {
    return null;
  }
}

function listTexFiles(root: string, maxFiles = 80): string[] {
  const results: string[] = [];
  const walk = (dir: string, rel: string) => {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, nextRel);
      else if (entry.isFile() && /\.(tex|bib|sty|cls)$/i.test(entry.name)) results.push(nextRel);
    }
  };
  walk(root, '');
  return results;
}

function paragraphWindow(lines: string[], start: number, end: number): [number, number] {
  const clamp = (n: number) => Math.max(1, Math.min(lines.length, n));
  let lo = clamp(start), hi = clamp(end);
  const boundary = (line: string) => !line.trim() || /^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph|begin\{document\}|end\{document\})\b/.test(line);
  while (lo > 1 && !boundary(lines[lo - 2]) && start - lo < 16) lo--;
  while (hi < lines.length && !boundary(lines[hi]) && hi - end < 16) hi++;
  return [lo, hi];
}

function stripPdfNumbers(text: string): string {
  return text.replace(/\b(theorem|lemma|proposition|corollary|definition|remark|example|section|subsection|figure|table|algorithm|appendix)\s+\d+(?:\.\d+)*\b/gi, '$1');
}

function findQuoteLinesInSlice(lines: string[], quote: string, offsetLine = 0): [number, number] | null {
  const clean = quote.trim();
  if (!clean) return null;
  const content = lines.join('\n');
  const exact = content.indexOf(clean);
  if (exact >= 0) {
    const before = content.slice(0, exact).split('\n').length;
    const span = clean.split('\n').length - 1;
    return [offsetLine + before, offsetLine + before + span];
  }
  const normLines = lines.map(normalize);
  const needles = [...new Set([
    normalize(clean),
    normalize(stripPdfNumbers(clean)),
    normalize(clean).slice(0, 64).trim(),
    normalize(stripPdfNumbers(clean)).slice(0, 64).trim(),
  ])].filter(n => n.length >= 4);

  for (const needle of needles) {
    for (let i = 0; i < lines.length; i++) {
      if (!normLines[i]) continue;
      let acc = '';
      for (let j = i; j < Math.min(lines.length, i + 12); j++) {
        if (normLines[j]) acc = acc ? `${acc} ${normLines[j]}` : normLines[j];
        if (acc.includes(needle)) {
          // Tighten the start line forward so we return the minimal span containing the quote.
          let lo = i;
          while (lo < j) {
            const tighter = normLines.slice(lo + 1, j + 1).filter(Boolean).join(' ');
            if (tighter.includes(needle)) lo++;
            else break;
          }
          return [offsetLine + lo + 1, offsetLine + j + 1];
        }
        if (acc.length > needle.length * 3 + 120) break;
      }
    }
  }
  return null;
}

function findQuoteLines(content: string, quote: string): [number, number] | null {
  return findQuoteLinesInSlice(content.split('\n'), quote, 0);
}

function candidateFileFromWhere(where: string, texFiles: string[]): string | null {
  const trimmed = where.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/([^\s:,()]+\.(?:tex|bib|sty|cls))/i);
  if (match) {
    const found = match[1].replaceAll('\\', '/').replace(/^\.\//, '');
    if (texFiles.includes(found)) return found;
    const suffix = texFiles.find(file => file.endsWith('/' + found) || file === found);
    if (suffix) return suffix;
  }
  return null;
}

export function currentTurnNotes(notes: NoteSummary[], runId: string, groupInstructions?: GroupInstructions): CurrentTurnNote[] {
  return notes.map((note, index) => {
    const instruction = note.group && groupInstructions?.[canonicalGroup(note.group)]?.trim();
    return {
      noteNumber: index + 1,
      id: `${runId}:${index + 1}`,
      note,
      ...(instruction ? { instruction } : {}),
    };
  });
}

/** Locate current-turn notes in the worktree and cluster overlapping/same-paragraph notes. */
export function clusterCurrentNotes(worktree: string, notes: CurrentTurnNote[]): { clusters: NoteCluster[]; unanchored: LocatedNote[] } {
  if (!notes.length) return { clusters: [], unanchored: [] };
  const texFiles = listTexFiles(worktree);
  const cache = new Map<string, { text: string; lines: string[] }>();
  const read = (file: string) => {
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!cache.has(normalized)) {
      const text = safeReadText(worktree, normalized);
      if (text !== null) cache.set(normalized, { text, lines: text.split('\n') });
    }
    return cache.get(normalized) || null;
  };

  const located: LocatedNote[] = notes.map(entry => {
    const sources = entry.note.anchor?.sources || [];
    for (const src of sources) {
      const file = src.file.replaceAll('\\', '/').replace(/^\.\//, '');
      const doc = read(file);
      if (!doc || !doc.lines.length) continue;
      // SyncTeX anchors can be off by a few lines across paragraph breaks or
      // theorem headers. Verify the quote actually lives inside this paragraph
      // window; if not, relocate near the anchor first, then across the file.
      const start = Math.max(1, Math.min(doc.lines.length, src.lines[0] || 1));
      const end = Math.max(start, Math.min(doc.lines.length, src.lines[1] || start));
      const win = paragraphWindow(doc.lines, start, end);
      if (entry.note.quote?.trim()) {
        const inWindow = doc.lines.slice(win[0] - 1, win[1]).join('\n');
        const quotePrefix = normalize(stripPdfNumbers(entry.note.quote)).slice(0, 40).trim();
        if (quotePrefix.length >= 4 && !normalize(inWindow).includes(quotePrefix)) {
          const nearLo = Math.max(0, start - 16), nearHi = Math.min(doc.lines.length, end + 16);
          const relocated = findQuoteLinesInSlice(doc.lines.slice(nearLo, nearHi), entry.note.quote, nearLo)
            || findQuoteLines(doc.text, entry.note.quote);
          if (relocated) return { ...entry, file, lines: relocated, window: paragraphWindow(doc.lines, relocated[0], relocated[1]) };
        }
      }
      return { ...entry, file, lines: [start, end], window: win };
    }
    // Fallback: match `where` filename or search across `.tex` files by quote.
    const hint = candidateFileFromWhere(entry.note.where || '', texFiles);
    const searchOrder = hint ? [hint, ...texFiles.filter(f => f !== hint)] : texFiles;
    if (entry.note.quote?.trim()) {
      for (const file of searchOrder) {
        const doc = read(file);
        if (!doc) continue;
        const found = findQuoteLines(doc.text, entry.note.quote);
        if (found) return { ...entry, file, lines: found, window: paragraphWindow(doc.lines, found[0], found[1]) };
      }
    }
    if (hint) {
      const doc = read(hint);
      if (doc && doc.lines.length && doc.lines.length <= 60) return { ...entry, file: hint, lines: [1, doc.lines.length], window: [1, doc.lines.length] };
    }
    return { ...entry, file: null, lines: null, window: null };
  });

  const anchored = located.filter((n): n is LocatedNote & { file: string; lines: [number, number]; window: [number, number] } => Boolean(n.file && n.lines && n.window));
  const unanchored = located.filter(n => !n.file || !n.lines || !n.window);

  // Cluster notes in the same file whose paragraph windows or 4-line proximity margins overlap.
  const byFile = new Map<string, (LocatedNote & { file: string; lines: [number, number]; window: [number, number] })[]>();
  for (const note of anchored) (byFile.get(note.file) || (byFile.set(note.file, []), byFile.get(note.file)!)).push(note);

  const clusters: NoteCluster[] = [];
  let seq = 0;
  for (const [file, fileNotes] of byFile) {
    fileNotes.sort((a, b) => a.lines[0] - b.lines[0] || a.noteNumber - b.noteNumber);
    const doc = read(file)!;
    let current: { lines: [number, number]; window: [number, number]; notes: LocatedNote[] } | null = null;
    for (const note of fileNotes) {
      if (current && note.window[0] <= current.window[1]) {
        current.lines = [Math.min(current.lines[0], note.lines[0]), Math.max(current.lines[1], note.lines[1])];
        current.window = [Math.min(current.window[0], note.window[0]), Math.max(current.window[1], note.window[1])];
        current.notes.push(note);
      } else {
        if (current) {
          clusters.push({
            id: `c${++seq}`,
            file,
            lines: current.lines,
            window: current.window,
            notes: current.notes,
            excerpt: doc.lines.slice(current.window[0] - 1, current.window[1]).join('\n'),
          });
        }
        current = { lines: [...note.lines], window: [...note.window], notes: [note] };
      }
    }
    if (current) {
      clusters.push({
        id: `c${++seq}`,
        file,
        lines: current.lines,
        window: current.window,
        notes: current.notes,
        excerpt: doc.lines.slice(current.window[0] - 1, current.window[1]).join('\n'),
      });
    }
  }
  clusters.sort((a, b) => a.notes[0].noteNumber - b.notes[0].noteNumber);
  return { clusters, unanchored };
}

/** Extract compact read-only paper context (LaTeX macros and BibTeX keys) so isolated patch workers stay faithful to manuscript conventions. */
export function extractPaperContext(worktree: string): { macros: string[]; bibKeys: string[] } {
  const files = listTexFiles(worktree, 60);
  const macros: string[] = [];
  const bibKeys: string[] = [];
  const seenMacro = new Set<string>(), seenKey = new Set<string>();
  for (const file of files) {
    const text = safeReadText(worktree, file);
    if (!text) continue;
    if (file.endsWith('.bib')) {
      for (const match of text.matchAll(/@[a-zA-Z]+\s*\{\s*([^,\s]+)\s*,/g)) {
        const key = match[1];
        if (!seenKey.has(key)) { seenKey.add(key); bibKeys.push(key); }
        if (bibKeys.length >= 120) break;
      }
    } else if (/(?:preamble|macros|defs|main)\b/i.test(file) || text.includes('\\documentclass')) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (/^\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\{/.test(trimmed) && trimmed.length <= 160 && !seenMacro.has(trimmed)) {
          seenMacro.add(trimmed);
          macros.push(trimmed);
          if (macros.length >= 45) break;
        }
      }
    }
  }
  return { macros, bibKeys };
}

function balancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            results.push(text.slice(start, i + 1));
            start = i;
            break;
          }
        }
      }
    }
    if (results.length >= 8) break;
  }
  return results;
}

export function extractJsonObject(text: string): any {
  const trimmed = text.trim();
  const tryParse = (candidate: string) => {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Try next candidate. */ }
    return null;
  };
  const fences = [...trimmed.matchAll(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g)];
  const jsonFences = fences.filter(m => m[1].toLowerCase() === 'json').map(m => m[2].trim());
  const otherFences = fences.filter(m => m[1].toLowerCase() !== 'json').map(m => m[2].trim());
  for (const candidate of [...jsonFences, ...otherFences, trimmed, ...balancedJsonObjects(trimmed)]) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function buildRouterPrompt(options: {
  clusters: NoteCluster[];
  request: string;
  strategy: CollaborationStrategy;
  racerCount: number;
  roles: Record<CollaborationRole, CollaborationRoute | null>;
  memory?: string;
}): string {
  const { clusters, request, strategy, racerCount, memory } = options;
  const payload = {
    strategy,
    canRace: racerCount >= 2,
    overallRequest: request,
    ...(memory ? { authorMemory: memory } : {}),
    clusters: clusters.map(cluster => ({
      clusterId: cluster.id,
      file: cluster.file,
      lines: cluster.lines,
      excerpt: cluster.excerpt.slice(0, 1200),
      notes: cluster.notes.map(n => ({
        noteNumber: n.noteNumber,
        kind: n.note.kind || 'note',
        group: n.note.group || null,
        stamp: n.note.stamp || null,
        quote: n.note.quote.slice(0, 300),
        comment: n.note.comment,
        ...(n.instruction ? { groupInstruction: n.instruction } : {}),
        ...(n.note.context?.length ? { context: n.note.context } : {}),
      })),
    })),
  };
  return [
    'You are the fast dispatcher for Papilot Collaboration Mode. Classify each annotation cluster cleanly and return ONLY JSON.',
    'Do NOT edit any files or write prose explanations outside JSON.',
    'Modes:',
    '- "assign": send to one role worker. Roles:',
    '  * "quick": purely mechanical, unambiguous edits (typos, punctuation, formatting, macro cleanup, straightforward deletions).',
    '  * "polish": light prose clarity/flow edits when racing is off.',
    '  * "rigorous": factual checks, mathematical/PL proofs, typing rules, citations, or technical correctness fixes where one exact answer is needed.',
    '- "race": send to multiple competing models in parallel (then judged rigorously) when wording, clarity, conciseness, argument framing, or balancing natural prose with technical rigor matters. Only use "race" when canRace is true and strategy is not "fast".',
    '- "answer": use ONLY when the cluster asks a pure question or verification check without requesting any manuscript edit.',
    'Strategy guidance:',
    '- "fast": never use "race"; assign every editing cluster to quick, polish, or rigorous.',
    '- "balanced": use "assign" with "quick" for mechanical typos/formatting, "assign" with "rigorous" for unambiguous technical/math fixes, and "race" for prose polishing, rewriting, shortening, strengthening arguments, or technical passages that also need clearer prose.',
    '- "thorough": use "race" for every editing cluster (except pure questions -> "answer").',
    'Return ONLY JSON matching:',
    '{"units":[{"clusterId":"c1","mode":"assign"|"race"|"answer","role":"quick"|"polish"|"rigorous","instruction":"concise concrete direction for the worker"}]}',
    JSON.stringify(payload),
  ].join('\n');
}

const QUESTION_ONLY = /^(?:why|what|does|is|are|can|could|should|check if|verify whether|explain)\b.+\?\s*$/i;
const MECHANICAL_HINT = /\b(typo|spelling|spell|punctuation|comma|period|hyphen|capitalize|capitalization|delete|remove this|macro|spacing|indent|whitespace|italic|bold)\b/i;
const RIGOR_HINT = /\b(proof|lemma|theorem|proposition|equation|formula|typing|rule|judgment|inference|soundness|completeness|citation|cite|ref|bound|quantifier|assumption|notation|symbol|rigor|correctness|bug|wrong)\b/i;

export function deterministicFallbackPlan(clusters: NoteCluster[], strategy: CollaborationStrategy, racerCount: number): RoutingPlan {
  const canRace = racerCount >= 2;
  const units: RoutedUnit[] = clusters.map(cluster => {
    const combined = cluster.notes.map(n => [n.note.comment, n.instruction, n.note.stamp].filter(Boolean).join(' ')).join(' ').trim();
    const isDelete = cluster.notes.every(n => n.note.kind === 'delete');
    if (!isDelete && combined && QUESTION_ONLY.test(combined) && !/\b(fix|change|rewrite|edit|update|polish|shorten|replace|add)\b/i.test(combined)) {
      return { clusterId: cluster.id, mode: 'answer', role: 'rigorous', instruction: combined };
    }
    if (isDelete || (MECHANICAL_HINT.test(combined) && !RIGOR_HINT.test(combined) && combined.length < 140)) {
      return {
        clusterId: cluster.id,
        mode: strategy === 'thorough' && canRace ? 'race' : 'assign',
        role: 'quick',
        instruction: combined || 'Apply the requested edit cleanly.',
      };
    }
    if (strategy === 'fast' || !canRace) {
      return {
        clusterId: cluster.id,
        mode: 'assign',
        role: RIGOR_HINT.test(combined) ? 'rigorous' : 'polish',
        instruction: combined || 'Address the annotations in this passage.',
      };
    }
    return {
      clusterId: cluster.id,
      mode: 'race',
      role: RIGOR_HINT.test(combined) ? 'rigorous' : 'polish',
      instruction: combined || 'Revise this passage to address the annotations while preserving technical rigor.',
    };
  });
  return { units, fallback: true, reason: 'Used deterministic routing.' };
}

/** Validate and normalize a router JSON response, guaranteeing 100% cluster coverage and strategy invariants. */
export function parseRouterPlan(reply: string, clusters: NoteCluster[], strategy: CollaborationStrategy, racerCount: number): RoutingPlan {
  const parsed = extractJsonObject(reply);
  if (!parsed || !Array.isArray(parsed.units)) return deterministicFallbackPlan(clusters, strategy, racerCount);
  const canRace = racerCount >= 2;
  const byId = new Map<string, any>();
  for (const entry of parsed.units) {
    if (typeof entry?.clusterId === 'string' && !byId.has(entry.clusterId)) byId.set(entry.clusterId, entry);
  }
  const fallback = deterministicFallbackPlan(clusters, strategy, racerCount);
  const fallbackById = new Map(fallback.units.map(u => [u.clusterId, u]));
  let usedFallback = false;
  const units: RoutedUnit[] = clusters.map(cluster => {
    const raw = byId.get(cluster.id);
    if (!raw) { usedFallback = true; return fallbackById.get(cluster.id)!; }
    const role: CollaborationRole = raw.role === 'quick' || raw.role === 'polish' || raw.role === 'rigorous' ? raw.role : fallbackById.get(cluster.id)!.role;
    let mode: RoutedUnit['mode'] = raw.mode === 'assign' || raw.mode === 'race' || raw.mode === 'answer' ? raw.mode : fallbackById.get(cluster.id)!.mode;
    if (strategy === 'fast' && mode === 'race') mode = 'assign';
    if (strategy === 'thorough' && mode === 'assign' && canRace) mode = 'race';
    if (mode === 'race' && !canRace) mode = 'assign';
    const instruction = typeof raw.instruction === 'string' && raw.instruction.trim() ? raw.instruction.trim().slice(0, 600) : fallbackById.get(cluster.id)!.instruction;
    return { clusterId: cluster.id, mode, role, instruction };
  });
  return { units, fallback: usedFallback };
}
