import type { TimelineItem, ToolPlace } from '../shared.ts';
import { t, tn } from './i18n.ts';

// How tool calls read in the chat. An agent that says what a call did (its
// kind and target, as Papilot Writer does) gets a sentence and an icon for
// it, and a run of calls folds into one line that says what happened, such
// as "Listed files, read 15 files, searched 2 times". Other calls show the
// agent's own text.

const ICONS: Record<string, string> = {
  read: 'paper', list: 'folder', outline: 'list', search: 'search', references: 'link', build: 'compile',
  lookup: 'library', web: 'globe', ask: 'question', chore: 'checklist', 'chore-end': 'checklist',
  workflow_route: 'workflow', workflow_race: 'sparkles', workflow_racer: 'bolt', workflow_judge: 'scale', workflow_delegate: 'workflow',
};

export function workflowKind(item: TimelineItem): string | null {
  if (item.type !== 'tool' || !item.text) return null;
  for (const prefix of ['workflow_route', 'workflow_race', 'workflow_racer', 'workflow_judge', 'workflow_delegate']) {
    if (item.text === prefix || item.text.startsWith(`${prefix} `)) return prefix;
  }
  return null;
}

const workflowSuffix = (text: string, prefix: string) => {
  const rest = text.slice(prefix.length).trim();
  return rest.startsWith('·') ? rest.slice(1).trim() : rest;
};

const kindOf = (item: TimelineItem) => {
  if (item.type !== 'tool') return item.type;
  if (item.tool?.kind) return item.tool.kind;
  const wf = workflowKind(item);
  // Keep workflow_delegate grouped under generic tool summary for legacy worker timeline layout.
  return wf && wf !== 'workflow_delegate' ? wf : 'tool';
};
const range = (lines: string) => lines.replace('-', '–');
const pagesText = (pages?: number[]) => !pages?.length ? '' : pages[0] === pages[pages.length - 1] ? t('page {page}', { page: pages[0] }) : t('pages {first}–{last}', { first: pages[0], last: pages[pages.length - 1] });
function sectionsText(place: ToolPlace) {
  const names = place.sections.map(section => section.number ? t('§{number} {title}', { number: section.number, title: section.title }) : section.title).join(t(', '));
  return place.more ? t('{sections} and {n} more', { sections: names, n: place.more }) : names;
}
const fileLines = (file: string, lines?: string) => lines ? t('{file}, lines {lines}', { file, lines: range(lines) }) : file;

/** The quieter second half of a call's line: for a read placed in the paper, its pages and the file it came from. */
export function toolNote(item: TimelineItem): string | null {
  const tool = item.type === 'tool' ? item.tool : undefined;
  if (tool?.kind !== 'read' || !tool.place) return null;
  const parts = [pagesText(tool.place.pages), tool.place.sections.length && tool.target ? fileLines(tool.target, tool.lines) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function toolIcon(item: TimelineItem) {
  if (item.type === 'command') return 'terminal';
  if (item.type === 'files') return 'diff';
  if (item.type === 'pdf') return 'pdf';
  const wf = workflowKind(item);
  if (wf) return ICONS[wf];
  return ICONS[kindOf(item)] || 'tool';
}

/** One call as a sentence, or null when the agent did not say what it did. */
export function toolSentence(item: TimelineItem): string | null {
  const wf = workflowKind(item);
  if (wf && wf !== 'workflow_delegate') {
    const suffix = workflowSuffix(item.text, wf);
    switch (wf) {
      case 'workflow_route': return suffix ? t('Planned annotation routing · {target}', { target: suffix }) : t('Planned annotation routing');
      case 'workflow_race': return suffix ? t('Raced models · {target}', { target: suffix }) : t('Raced models');
      case 'workflow_racer': return suffix ? t('Candidate · {target}', { target: suffix }) : t('Race candidate');
      case 'workflow_judge': return suffix ? t('Blind judge · {target}', { target: suffix }) : t('Blind judge');
    }
  }
  const tool = item.type === 'tool' ? item.tool : undefined;
  if (!tool) return null;
  const target = tool.target || '';
  switch (tool.kind) {
    case 'read':
      // Placed in the outline, a read says what part of the paper it was.
      if (tool.place?.sections.length) return tool.place.partial ? t('Read part of {sections}', { sections: sectionsText(tool.place) }) : t('Read {sections}', { sections: sectionsText(tool.place) });
      return !target ? t('Read a file') : tool.lines ? t('Read {file}, lines {lines}', { file: target, lines: range(tool.lines) }) : t('Read {file}', { file: target });
    case 'list': return target && target !== '.' ? t('Listed the files in {folder}', { folder: target }) : t('Listed the files');
    case 'outline': return target ? t('Read the outline of {section}', { section: target }) : t('Read the outline');
    case 'search': return target ? t('Searched for “{query}”', { query: target }) : t('Searched the paper');
    case 'references': return target ? t('Found where {name} is used', { name: target }) : t('Found references');
    case 'build': return t('Compiled the paper');
    case 'lookup': return target ? t('Looked up “{query}”', { query: target }) : t('Looked up a reference');
    case 'web': return target ? t('Read {url}', { url: target }) : t('Read a webpage');
    case 'ask': return t('Asked you a question');
    case 'chore': return target ? t('Started chore mode: {chore}', { chore: target }) : t('Started chore mode');
    case 'chore-end': return t('Ended chore mode');
    default: return null;
  }
}

/** What a run of calls did, in the order it first did each thing. */
export function toolSummary(items: TimelineItem[], editedFiles: (item: TimelineItem) => string[]) {
  const order: string[] = [], byKind = new Map<string, TimelineItem[]>();
  for (const item of items) {
    // A chore's start and end are one thing.
    const kind = kindOf(item) === 'chore-end' ? 'chore' : kindOf(item);
    if (!byKind.has(kind)) { byKind.set(kind, []); order.push(kind); }
    byKind.get(kind)!.push(item);
  }
  const phrase = (kind: string, group: TimelineItem[]) => {
    const n = group.length, targets = [...new Set(group.map(item => item.tool?.target).filter(Boolean))] as string[];
    switch (kind) {
      case 'command': return tn(n, 'ran {n} command', 'ran {n} commands');
      case 'files': { const files = [...new Set(group.flatMap(editedFiles))]; return files.length === 1 ? t('edited {file}', { file: files[0] }) : t('edited {n} files', { n: files.length }); }
      case 'pdf': return t('viewed the PDF');
      case 'read': {
        const pages = group.flatMap(item => item.tool?.place?.pages || []), where = pages.length ? pagesText([Math.min(...pages), Math.max(...pages)]) : '';
        if (targets.length === 1) return where ? t('read {file} on {pages}', { file: targets[0], pages: where }) : t('read {file}', { file: targets[0] });
        return where ? tn(targets.length || n, 'read {n} file on {pages}', 'read {n} files on {pages}', { pages: where }) : tn(targets.length || n, 'read {n} file', 'read {n} files');
      }
      case 'list': return t('listed the files');
      case 'outline': return t('read the outline');
      case 'search': return tn(n, 'searched {n} time', 'searched {n} times');
      case 'references': return tn(n, 'traced {n} reference', 'traced {n} references');
      case 'build': return t('compiled the paper');
      case 'lookup': return tn(n, 'looked up {n} reference', 'looked up {n} references');
      case 'web': return tn(n, 'read {n} webpage', 'read {n} webpages');
      case 'ask': return t('asked you a question');
      case 'chore': return t('used chore mode');
      case 'workflow_route': return t('routed annotations');
      case 'workflow_race': return tn(n, 'raced {n} annotation', 'raced {n} annotations');
      case 'workflow_racer': return tn(n, 'ran {n} candidate', 'ran {n} candidates');
      case 'workflow_judge': return tn(n, 'judged {n} race', 'judged {n} races');
      default: return tn(n, 'used {n} tool', 'used {n} tools');
    }
  };
  const text = order.map(kind => phrase(kind, byKind.get(kind)!)).join(t(', '));
  // The icon of what the run did most.
  const main = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[1][0];
  return { text: text.charAt(0).toUpperCase() + text.slice(1), icon: main ? toolIcon(main) : 'tool' };
}
