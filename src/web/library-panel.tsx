import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import type { OutlineItem, PdfHandle, PdfPassage } from './pdf-view.tsx';
import type { BibliographyEntry, CitationEvidence, CitationFinding, CitationSuggestion, CitationVerdict, CitingSentence, LibraryEntry, LibraryReport, ReferenceCheck } from '../shared.ts';
import { Icon } from './icons.tsx';
import { ActionMenu } from './action-menu.tsx';
import { language, t, tn } from './i18n.ts';
import { browserStorage } from './storage.ts';
import { readPlace, savePlace, useScrollPlace } from './places.ts';
import { SourceEvidence, sourceUses, VerdictLabel, type SourceUse } from './evidence-marks.tsx';
import './library-panel.css';

const PdfView = lazy(() => import('./pdf-view.tsx').then(module => ({ default: module.PdfView })));
const PdfThumbnail = lazy(() => import('./pdf-view.tsx').then(module => ({ default: module.PdfThumbnail })));

// The Library: every work the paper cites, with its PDF and what it says of
// the sentences that cite it. PDFs come from the author's Zotero library,
// from arXiv and open-access copies, from the author, who drops a PDF on its
// entry, or from an agent the author asks to find open copies of the rest.
// An agent the author asks to check the citations records, for each citing
// sentence and work, whether the work supports it, quoting the PDF's lines. The bibliography's own problems
// stay here too: citations without an entry, keys used twice, the same work
// under two keys, entries nobody cites, and what Crossref, DBLP and arXiv
// know of each entry. Problems go to an agent as a new task that finds out
// what happened; the author decides the edits.

type Load = <T>(route: string, body?: unknown) => Promise<T>;
export const ONLINE_LOOKUPS = 'papilot:review:references';
const online = () => browserStorage.getItem(ONLINE_LOOKUPS) !== 'off';
const options = () => `online=${online() ? 1 : 0}`;
const SOURCE: Record<string, string> = { doi: 'doi.org', crossref: 'Crossref', dblp: 'DBLP', arxiv: 'arXiv' };
const fieldName = (field: string) => ({ title: t('Title'), author: t('Authors'), year: t('Year'), doi: 'DOI', arxiv: 'arXiv' } as Record<string, string>)[field] || field;
const gap = () => (language().startsWith('zh') ? '' : ' ');
const value = (entry: BibliographyEntry, name: string) => { const field = entry.fields.find(f => f.name === name); return field ? field.resolved ?? field.value : ''; };
// Titles and names as they read: TeX's accents as letters, without its
// commands and braces.
const ACCENTS: Record<string, string> = { "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328', r: '\u030a' };
const LETTERS: Record<string, string> = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı' };
const readable = (text: string) => text
  .replace(/\\([`'^"~=.])\s*(?:\{\s*(\\?[A-Za-z])\s*\}|(\\?[A-Za-z]))/g, (_, accent: string, braced?: string, bare?: string) => (braced ?? bare)!.replace('\\', '') + ACCENTS[accent])
  .replace(/\\([uvHckr])(?:\s*\{\s*(\\?[A-Za-z])\s*\}|\s+(\\?[A-Za-z]))/g, (_, accent: string, braced?: string, bare?: string) => (braced ?? bare)!.replace('\\', '') + ACCENTS[accent])
  .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i)(?![A-Za-z])\s*/g, (_, letter: string) => LETTERS[letter])
  .replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}$]/g, '').replace(/\s+/g, ' ').trim().normalize('NFC');
const pending = (report: LibraryReport | null) => Boolean(report && (report.pending || report.library.pending || report.quickCheck?.running));
const hasPdf = (report: LibraryReport, entry: BibliographyEntry) => Boolean(report.library.entries[entry.id]?.pdf);
const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** The library's data: read when the files change, and polled while PDFs
 * are being found or read. */
export function useLibrary(projectId: string, version: string, load: Load, enabled = true) {
  const [report, setReport] = useState<LibraryReport | null>(null), [error, setError] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]), [adding, setAdding] = useState(0);
  const retry = useRef(false), [round, setRound] = useState(0);
  useEffect(() => { setReport(null); setError(''); setUnmatched([]); }, [projectId]);
  // Back from the editor or from Zotero, the files may have changed.
  useEffect(() => {
    if (!enabled) return;
    const again = () => setRound(n => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [enabled]);
  useEffect(() => {
    if (!projectId || !enabled) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    // Follow-up polls say so: sources that could not be reached are asked
    // again on a fresh look, not on every poll.
    const poll = async (following = false) => {
      const again = retry.current; retry.current = false;
      try {
        const next = await load<LibraryReport>(`/projects/${projectId}/library?${options()}${again ? '&retry=1' : ''}${following ? '&poll=1' : ''}`);
        if (!live) return;
        setReport(next); setError('');
        if (pending(next)) timer = setTimeout(() => void poll(true), 1500);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, version, round, load, enabled]);
  const refresh = useCallback(() => setRound(n => n + 1), []);
  return {
    report, error, unmatched, adding, refresh, load,
    lookAgain() { retry.current = true; refresh(); },
    async confirm(id: string, on: boolean) {
      try { setReport(await load<LibraryReport>(`/projects/${projectId}/references/confirm?${options()}`, { id, confirmed: on })); refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    /** Add PDFs: to the entry they are dropped on, or each to the entry its
     * first page names. */
    async add(files: File[], entry?: string) {
      const pdfs = files.filter(isPdf), missed: string[] = files.filter(file => !isPdf(file)).map(file => file.name);
      setAdding(n => n + pdfs.length); setError('');
      try {
        for (const file of pdfs) {
          try {
            const added = await load<{ entry: string | null }>(`/projects/${projectId}/library/pdf${entry ? `?entry=${encodeURIComponent(entry)}` : ''}`, file);
            if (!added.entry) missed.push(file.name);
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setAdding(n => n - 1); }
        }
      } finally { setUnmatched(missed); refresh(); }
    },
    async remove(entry: string) {
      try { await load(`/projects/${projectId}/library/remove`, { entry }); refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    async forget(id: string, key: string) {
      try { setReport(await load<LibraryReport>(`/projects/${projectId}/citations/forget?${options()}`, { id, key })); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    /** Checks the citations, or finds sources for uncited sentences, with the quick model, in place; stop interrupts the batch it is answering. */
    async quickCheck(stop = false, kind: 'citations' | 'sources' = 'citations') {
      try { setReport(await load<LibraryReport>(`/projects/${projectId}/citations/quick-check?${options()}`, stop ? { stop: true } : { kind })); refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    async dismissSuggestion(id: string) {
      try { setReport(await load<LibraryReport>(`/projects/${projectId}/citations/suggestions/dismiss?${options()}`, { id })); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    async autoCheck(enabled: boolean) {
      try { setReport(await load<LibraryReport>(`/projects/${projectId}/citations/auto-check?${options()}`, { enabled })); refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
  };
}
export type LibraryData = ReturnType<typeof useLibrary>;
/** A task draft asking an agent to cite a library work for a sentence, with
 * the work's own words as the reason. */
export function citeRequest(suggestion: { key: string; file: string; line: number; sentence: string; evidence: CitationEvidence[] }) {
  return [t('Cite {key} for this sentence of the paper, at {place}:', { key: suggestion.key, place: `${suggestion.file}:${suggestion.line}` }), `> ${suggestion.sentence}`,
    ...suggestion.evidence.map(item => t('The library\'s PDF of {key} says on page {page}: “{quote}”', { key: suggestion.key, page: item.page, quote: item.quote })),
    t('Check the work with library_read first. Add the citation where the claim ends, with the citation command the paper already uses, and change nothing else.')].join('\n');
}

interface Item { id: string; key: string; label: string; entry?: BibliographyEntry; problems: string[]; soft: boolean; fix: string }
// Every problem of the bibliography, entry by entry, most pressing first.
function items(report: LibraryReport): Item[] {
  const list: Item[] = [], byId = new Map(report.entries.map(entry => [entry.id, entry]));
  // One item for each key cited without an entry, with every place.
  for (const key of [...new Set(report.missing.map(cite => cite.key))]) {
    const places = report.missing.filter(cite => cite.key === key).map(cite => `${cite.file}:${cite.line}`).join('; ');
    list.push({ id: `missing:${key}`, key, label: `\\cite{${key}}`, problems: [t('No entry has this key.') + gap() + places], soft: false,
      fix: t('{cite} ({places}) has no entry with this key.', { cite: `\\cite{${key}}`, places }) });
  }
  for (const entry of report.entries) {
    const check = report.checks[entry.id], mine = entry.id in report.confirmed, problems: string[] = [], fixes: string[] = [];
    if (entry.error) { problems.push(t('BibTeX cannot read it: {error}', { error: entry.error })); fixes.push(t('BibTeX cannot read it ({error}).', { error: entry.error })); }
    if (report.duplicates.some(ids => ids.includes(entry.id))) { problems.push(t('Another entry has the same key.')); fixes.push(t('another entry has the same key.')); }
    for (const group of report.similar.filter(g => g.ids.includes(entry.id))) {
      const others = group.ids.filter(id => id !== entry.id).map(id => byId.get(id)?.key).join(', ');
      problems.push(group.by === 'doi' ? t('Same DOI as {keys}.', { keys: others }) : t('Same title as {keys}.', { keys: others }));
      fixes.push(group.by === 'doi' ? t('the same work as {keys} (same DOI).', { keys: others }) : t('possibly the same work as {keys} (same title).', { keys: others }));
    }
    if (check && !mine && check.status === 'mismatch') {
      const major = check.differences.filter(d => !d.minor);
      problems.push(major.map(d => t('{field}: {bib} here, {record} in {source}', { field: fieldName(d.field), bib: d.bib, record: d.record || '—', source: SOURCE[check.record?.source || ''] || '' })).join('; '));
      fixes.push(t('{differences} (record: {url}).', { differences: major.map(d => t('{field} is {bib} but {source} has {record}', { field: fieldName(d.field), bib: d.bib, record: d.record || t('nothing'), source: SOURCE[check.record?.source || ''] || '' })).join('; '), url: check.record?.url || '' }));
    }
    if (check && !mine && check.status === 'unverified' && !hasPdf(report, entry)) { problems.push(t('No record in Crossref, DBLP or arXiv matches it.')); fixes.push(t('no record in Crossref, DBLP or arXiv matches it.')); }
    const soft = !problems.length && !report.all_cited && !entry.cited.length;
    if (soft) { problems.push(t('Not cited in the paper.')); fixes.push(t('it is not cited.')); }
    if (problems.length) list.push({ id: entry.id, key: entry.key, label: entry.key, entry, problems, soft,
      fix: t('{key} ({place}): {problems}', { key: entry.key, place: `${entry.file}:${entry.lines[0]}`, problems: fixes.join(gap()) }) });
  }
  return list;
}

/** How many problems the menu shows: those an author should act on. */
export const problemCount = (report: LibraryReport | null) => report ? items(report).filter(item => !item.soft).length : 0;

// An entry's PDF, or why it has none, in a few words.
function pdfState(state: LibraryEntry | undefined) {
  if (state?.pdf) {
    if (state.pdf.text === 'pending') return { key: 'reading', label: t('Reading…') };
    return { key: 'pdf', label: ({ zotero: t('Zotero'), arxiv: 'arXiv', 'open-access': t('Open access'), author: t('Added by you'), agent: t('Found by an agent') } as Record<string, string>)[state.pdf.source] };
  }
  return ({
    waiting: { key: 'finding', label: t('Finding…') }, searching: { key: 'finding', label: t('Finding…') },
    paywalled: { key: 'paywalled', label: t('Not open access') }, unidentified: { key: 'unidentified', label: t('No DOI or arXiv ID') },
    unreachable: { key: 'unreachable', label: t('Lookup failed') },
  } as Record<string, { key: string; label: string }>)[state?.find ?? ''] ?? { key: 'none', label: t('No PDF') };
}

type Filter = 'todo' | 'all' | 'missing' | 'flagged' | 'uncited' | 'problems';
type Tally = Record<CitationVerdict | 'unchecked', number>;
const VERDICTS: CitationVerdict[] = ['supported', 'partial', 'unsupported', 'unclear'];
const verdictIcon: Record<CitationVerdict, string> = { supported: 'check', partial: 'minus', unsupported: 'close', unclear: 'question' };
const verdictName = (verdict: CitationVerdict) => ({ supported: t('Supported'), partial: t('Partly supported'), unsupported: t('Not supported'), unclear: t('Cannot tell') })[verdict];
const current = (finding?: CitationFinding) => finding && !finding.stale ? finding : undefined;
const empty = (): Tally => ({ supported: 0, partial: 0, unsupported: 0, unclear: 0, unchecked: 0 });
const fold = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const authorsOf = (entry: BibliographyEntry) => readable(value(entry, 'author') || value(entry, 'editor')).split(/\s+and\s+/i).filter(Boolean);
// "Kaposi et al. 2019", as a reference manager names a work.
const byline = (entry: BibliographyEntry) => {
  const authors = authorsOf(entry), family = (name: string) => name.includes(',') ? name.split(',')[0].trim() : name.split(/\s+/).at(-1) ?? name;
  const who = !authors.length ? '' : authors.length === 1 ? family(authors[0]) : authors.length === 2 ? `${family(authors[0])} & ${family(authors[1])}` : t('{name} et al.', { name: family(authors[0]) });
  return [who, value(entry, 'year')].filter(Boolean).join(' ');
};
const venueOf = (entry: BibliographyEntry) => readable(value(entry, 'journal') || value(entry, 'booktitle') || value(entry, 'publisher') || value(entry, 'school') || value(entry, 'institution'));
function useNarrow() {
  const query = '(max-width: 760px)', [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return narrow;
}

/** Small counts of a work's verdicts, for its row in the list. */
function TallyDots({ tally, suggested = 0 }: { tally: Tally; suggested?: number }) {
  const shown = VERDICTS.filter(verdict => tally[verdict]);
  if (!shown.length && !suggested) return null;
  return <span className="library-dots" aria-label={[...shown.map(verdict => `${verdictName(verdict)} ${tally[verdict]}`), ...(suggested ? [`${t('Could cite')} ${suggested}`] : [])].join(', ')}>
    {shown.map(verdict => <span key={verdict} data-verdict={verdict} aria-hidden="true"><Icon name={verdictIcon[verdict]} size={10}/>{tally[verdict]}</span>)}
    {suggested > 0 && <span data-verdict="suggested" aria-hidden="true"><Icon name="plus" size={10}/>{suggested}</span>}
  </span>;
}
/** A passage with the searched words marked, as a search shows it. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const wanted = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase(), at = text.toLocaleLowerCase().indexOf(wanted);
  if (!wanted || at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + wanted.length)}</mark>{text.slice(at + wanted.length)}</>;
}
interface LibraryMatch { entry: string; key: string; hash: string; page: number; text: string; marks: { page: number; rect: [number, number, number, number] }[] }
/** The verdicts as one segmented bar, red to green, with what is left to check. */
function EvidenceBar({ tally }: { tally: Tally }) {
  const order: (CitationVerdict | 'unchecked')[] = ['unsupported', 'partial', 'unclear', 'supported', 'unchecked'];
  const total = order.reduce((sum, verdict) => sum + tally[verdict], 0);
  if (!total) return null;
  return <div className="library-bar" aria-hidden="true">{order.filter(verdict => tally[verdict]).map(verdict => <span key={verdict} data-verdict={verdict === 'unchecked' ? 'none' : verdict} style={{ flexGrow: tally[verdict] }}/>)}</div>;
}
// A sentence as it reads, its citations set apart and this work's marked.
function Sentence({ text, cited }: { text: string; cited: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    if (match[1] === 'ref') continue;
    parts.push(text.slice(at, match.index));
    const keys = match[1].split(', ');
    parts.push(<span key={match.index} className="library-cite">[{keys.map((key, i) => <span key={key}>{i > 0 && ', '}{key === cited ? <mark>{key}</mark> : key}</span>)}]</span>);
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** A cited work to show, from a citation check in the paper's PDF: at the quoted lines when one is given. */
export interface LibraryFocus { entry: string; hash: string; evidence?: CitationEvidence; at: number }
export function LibraryPanel({ projectId, data, onInvestigate, place, focus, onFocused, onShowInPaper }: { projectId: string; data: LibraryData; onInvestigate: (text: string) => void; place?: string; focus?: LibraryFocus | null; onFocused?: () => void; onShowInPaper?: (use: SourceUse) => void }) {
  const { report, error, unmatched, adding } = data;
  const [view, setView] = useState<{ filter: Filter | null; open: string }>(() => (place && readPlace<{ filter: Filter | null; open: string }>(place + ':view')) || { filter: null, open: '' });
  const show = (next: Partial<typeof view>) => setView(present => { const value = { ...present, ...next }; if (place) savePlace(place + ':view', value); return value; });
  const [reading, setReading] = useState<{ entry: BibliographyEntry; hash: string; passage?: PdfPassage } | null>(null);
  const [query, setQuery] = useState(''), [detail, setDetail] = useState(false);
  // Rows the author opened or closed, kept while a PDF is read in place of the list.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // Words or a phrase in the cited works' PDFs, as passages, read as the author types.
  const [found, setFound] = useState<{ query: string; matches: LibraryMatch[]; next: string | null; loading: boolean }>({ query: '', matches: [], next: null, loading: false });
  const findText = useCallback(async (text: string, cursor?: string) => {
    setFound(present => ({ ...present, query: text, loading: true, ...(cursor ? {} : { matches: [], next: null }) }));
    try {
      const result = await data.load<{ matches: LibraryMatch[]; nextCursor: string | null }>(`/projects/${projectId}/library/search?q=${encodeURIComponent(text)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setFound(present => present.query === text ? { query: text, matches: cursor ? [...present.matches, ...result.matches] : result.matches, next: result.nextCursor, loading: false } : present);
    } catch { setFound(present => present.query === text ? { ...present, loading: false } : present); }
  }, [data.load, projectId]);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setFound({ query: '', matches: [], next: null, loading: false }); return; }
    const timer = setTimeout(() => void findText(text), 300);
    return () => clearTimeout(timer);
  }, [query, findText]);
  const list = useRef<HTMLUListElement>(null), picker = useRef<HTMLInputElement>(null), target = useRef<string | undefined>(undefined), opener = useRef<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null), initial = useRef<Filter | null>(null);
  const progressId = useId(), searchId = useId();
  const narrow = useNarrow();
  useScrollPlace(list, place && !reading ? place + ':scroll' : null, Boolean(report?.bibs.length));
  // The author's own choices; by default every problem but an uncited entry goes to the agent.
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const all = useMemo(() => report ? items(report) : [], [report]);
  const included = (item: Item) => choices[item.id] ?? !item.soft;
  const toggle = useCallback((item: Item) => setChoices(present => ({ ...present, [item.id]: !(present[item.id] ?? !item.soft) })), []);
  // The sentences citing each work, and their verdicts.
  const citing = useMemo(() => {
    const map = new Map<string, CitingSentence[]>();
    for (const sentence of report?.citations ?? []) for (const key of sentence.keys) map.set(key, [...map.get(key) ?? [], sentence]);
    return map;
  }, [report]);
  // Back from a PDF, or from a work to the list, focus returns to the
  // control that showed it.
  useEffect(() => {
    const control = !reading && opener.current ? document.querySelector<HTMLElement>(`[data-opener="${CSS.escape(opener.current)}"]`) : null;
    if (control?.getClientRects().length) { control.focus(); opener.current = null; }
  }, [reading, detail]);
  // A quote opened from the paper's PDF: its work, and its PDF at the quoted lines.
  useEffect(() => {
    const entry = focus && report?.entries.find(item => item.id === focus.entry);
    if (!focus || !entry) return;
    show({ filter: 'all', open: entry.id });
    const first = focus.evidence?.marks[0];
    if (focus.evidence) setReading({ entry, hash: focus.hash, passage: first ? { page: first.page - 1, marks: focus.evidence.marks.filter(mark => mark.page === first.page).map(mark => mark.rect) } : undefined });
    onFocused?.();
  }, [focus, report]);
  if (reading) return <LibraryReader projectId={projectId} entry={reading.entry} hash={reading.hash} passage={reading.passage} onClose={() => setReading(null)}
    uses={report ? sourceUses(reading.entry.key, report.citations, report.suggestions ?? []) : []} onShow={onShowInPaper}/>;
  if (error && !report) return <section className="library-panel"><p className="inline-error" role="alert">{error}</p></section>;
  if (!report) return <section className="library-panel"><p className="library-empty">{t('Reading the bibliography…')}</p></section>;
  if (!report.bibs.length) return <section className="library-panel"><p className="library-empty">{t('This paper names no .bib file with {bibliography} or {addbibresource}.', { bibliography: '\\bibliography', addbibresource: '\\addbibresource' })}</p></section>;

  const entries = report.library.entries, hasPdfOf = (key: string) => report.entries.some(entry => entry.key === key && entries[entry.id]?.pdf);
  // An entry BibTeX cannot read has no PDF to find; Problems lists it.
  const missing = report.entries.filter(entry => !entry.error && !entries[entry.id]?.pdf);
  const withPdf = report.entries.filter(entry => entries[entry.id]?.pdf).length, busy = pending(report);
  const quick = report.quickCheck, checking = Boolean(quick?.running), suggestions = report.suggestions ?? [];
  const tallyOf = (key: string) => {
    const tally = empty(), pdf = hasPdfOf(key);
    for (const sentence of citing.get(key) ?? []) {
      const finding = current(sentence.findings[key]);
      if (finding) tally[finding.verdict]++; else if (pdf) tally.unchecked++;
    }
    return tally;
  };
  const totals = empty();
  for (const sentence of report.citations) for (const key of sentence.keys) {
    const finding = current(sentence.findings[key]);
    if (finding) totals[finding.verdict]++; else if (hasPdfOf(key)) totals.unchecked++;
  }
  const flagged = report.entries.filter(entry => { const tally = tallyOf(entry.key); return tally.partial + tally.unsupported + tally.unclear > 0; });
  const flaggedCount = totals.partial + totals.unsupported + totals.unclear;
  const suggestedWorks = report.entries.filter(entry => suggestions.some(item => item.key === entry.key));
  // What needs the author: works whose citations do not hold, works a sentence could cite, works without a PDF.
  const todo = report.entries.filter(entry => flagged.includes(entry) || suggestedWorks.includes(entry) || missing.includes(entry));
  const attention = flaggedCount + suggestions.length;
  // Until the author picks a tab, the library opens on the works without a
  // PDF, and stays there as they are added.
  initial.current ??= todo.length ? 'todo' : 'all';
  const filter: Filter = view.filter ?? initial.current;
  const chosen = all.filter(included);
  const lookAgain = missing.some(entry => ['paywalled', 'unreachable'].includes(entries[entry.id]?.find ?? ''));
  const pick = (entry?: string) => { target.current = entry; picker.current?.click(); };
  const files = (event: DragEvent) => [...event.dataTransfer.items].some(item => item.kind === 'file');
  const drop = (entry?: string) => ({
    onDragOver: (event: DragEvent) => { if (!files(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDropping(entry ?? ''); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(null); },
    onDrop: (event: DragEvent) => { if (!files(event)) return; event.preventDefault(); event.stopPropagation(); setDropping(null); void data.add([...event.dataTransfer.files], entry); },
  });

  // Works still being looked for are left to the library, and one without a
  // title gives an agent nothing to look for.
  const unfound = missing.filter(entry => !['waiting', 'searching'].includes(entries[entry.id]?.find ?? '') && readable(value(entry, 'title')));
  // An agent looks for open copies of the rest; the library keeps only those
  // that are visibly the work.
  const findPdfs = (only?: BibliographyEntry) => onInvestigate([t('Find openly available PDFs of these cited works and add each to Papilot\'s library with library_add. Use legal copies only: the authors\' or their institutions\' pages, preprint servers, repositories and publishers\' open-access pages; never shadow libraries such as Sci-Hub or LibGen. Papilot keeps a PDF only when its first page shows the work\'s full title or DOI. Do not edit any file. Report which works you added and where each copy came from, and which you could not find.'),
    ...(only ? [only] : unfound).map(entry => {
      const authors = authorsOf(entry), landing = entries[entry.id]?.landing;
      const about = [authors[0] && authors[0] + (authors.length > 1 ? ' et al.' : ''), value(entry, 'year')].filter(Boolean).join(', ');
      return `- ${entry.key}: ${readable(value(entry, 'title'))}${about ? ` (${about})` : ''}${landing ? ` ${landing}` : ''}`;
    })].join('\n'));
  // An agent checks what the cited works say against the sentences citing them.
  const checkCitations = (key?: string) => onInvestigate([t('Check that the works this paper cites support what it says about them. Go through the citing sentences with citations_list; unchecked: true lists those still to check. For each sentence and each work it cites that has a PDF, find what the work says with library_search and library_read, then record a verdict with citation_record, giving the lines that show it as evidence: supported, partial (it supports part of the claim, or a weaker or narrower one), unsupported (it does not say this, or says otherwise), or unclear (its text does not settle it). Do not edit any file. End with the unsupported and partial citations, and the works without a PDF that could not be checked.'),
    ...(key ? [t('Check only the sentences that cite {key}: pass key: {key} to citations_list.', { key })] : [])].join('\n'));
  // The agent finds out what happened; the author decides what to change.
  const investigate = () => onInvestigate([t('Find out what happened with these bibliography problems and report back. Do not edit any file. For each, check whether the work exists and what its published record says (authors, title, year, venue, DOI), find where the entry or citation came from in the Git history of the .bib and .tex files, and say what you would suggest. Mark which findings you confirmed in a source and which are guesses.'), ...chosen.map(item => '- ' + item.fix)].join('\n'));

  const search = fold(query.trim());
  const matches = (entry: BibliographyEntry) => !search || fold(`${entry.key} ${readable(value(entry, 'title'))} ${authorsOf(entry).join(' ')} ${value(entry, 'year')}`).includes(search);
  const shown: { id: string; entry?: BibliographyEntry; item?: Item }[] = filter === 'problems'
    ? all.filter(item => !item.entry || matches(item.entry)).map(item => ({ id: item.id, entry: item.entry, item }))
    : (filter === 'todo' ? todo : filter === 'missing' ? missing : filter === 'flagged' ? flagged : filter === 'uncited' ? suggestedWorks : report.entries).filter(matches).map(entry => ({ id: entry.id, entry }));
  const selected = shown.find(row => row.id === view.open) ?? (narrow ? undefined : shown[0]);
  const open = (id: string) => { show({ open: id }); if (narrow) setDetail(true); };
  const read = (entry: BibliographyEntry, hash: string, passage?: PdfPassage, from?: string) => { opener.current = from ?? null; setReading({ entry, hash, passage }); };

  const row = ({ id, entry, item }: typeof shown[number]) => {
    const state = entry && entries[entry.id], status = pdfState(state), tally = entry ? tallyOf(entry.key) : empty();
    return <li key={id} className={'library-item' + (item?.soft ? ' soft' : '')} data-selected={selected?.id === id} data-drop={entry && dropping === entry.id} {...(entry ? drop(entry.id) : {})}>
      {item && <input type="checkbox" aria-label={t('Include {key} in the task', { key: item.label })} checked={included(item)} onChange={() => toggle(item)}/>}
      <button type="button" className="library-row" aria-current={selected?.id === id ? 'true' : undefined} data-opener={'row:' + id} onClick={() => open(id)}>
        <span className="library-row-status" data-state={entry ? status.key : 'problem'} aria-hidden="true"><Icon name={entry ? (state?.pdf ? 'pdf' : 'paper') : 'alert'} size={16}/></span>
        <span className="library-row-text">
          <span className="library-row-top"><span className="library-byline">{entry ? byline(entry) || entry.key : item!.label}</span><TallyDots tally={tally} suggested={entry ? suggestions.filter(suggestion => suggestion.key === entry.key).length : 0}/></span>
          <span className="library-row-title">{entry ? readable(value(entry, 'title')) || entry.type : item!.problems.join(gap())}</span>
          <span className="library-row-meta"><code>{entry?.key ?? item!.key}</code>{(!entry || status.key !== 'pdf') && <span className={'library-state s-' + status.key}>{entry ? status.label : t('Problem')}</span>}</span>
          {item && entry && <span className="library-problems">{item.problems.join(gap())}</span>}
        </span>
      </button>
      {entry && !state?.pdf && !entry.error && <button type="button" className="icon-button library-row-add" aria-label={t('Add a PDF for {key}', { key: entry.key })} title={t('Add PDF')} onClick={() => pick(entry.id)}><Icon name="plus" size={15}/></button>}
    </li>;
  };
  // Two lists: what needs the author, and everything; bibliography problems only when there are some.
  const problemsCount = all.filter(item => !item.soft).length;
  const tabs: [Filter, string, number][] = [['todo', t('To do'), todo.length], ['all', t('All'), report.entries.length], ...(problemsCount || filter === 'problems' ? [['problems', t('Problems'), problemsCount] as [Filter, string, number]] : [])];

  return <div className="library-panel" data-drop={dropping === ''} data-detail={narrow && detail && selected ? 'true' : undefined} {...drop()}>
    <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden onChange={event => { const picked = [...event.target.files ?? []]; event.target.value = ''; if (picked.length) void data.add(picked, target.current); }}/>
    <header className="library-header">
      <div className="library-summary">
        <h2>{tn(report.entries.length, '{n} cited work', '{n} cited works')}</h2>
        <p className="library-summary-line">
          {missing.length ? <button type="button" className="library-chip" data-kind="missing" aria-pressed={filter === 'missing'} onClick={() => show({ filter: filter === 'missing' ? 'todo' : 'missing' })}><i aria-hidden="true"/>{tn(missing.length, '{n} without a PDF', '{n} without a PDF')}</button>
            : report.entries.length ? <span className="library-summary-ok"><Icon name="check" size={13}/>{t('Every work has a PDF')}</span> : null}
          {(busy && !checking) || adding ? <span className="library-progress-text" role="status"><span className="spinner"/>{adding ? tn(adding, 'Adding {n} PDF…', 'Adding {n} PDFs…') : t('Finding PDFs…')}</span> : null}
        </p>
      </div>
      <div className="library-actions">
        {checking
          ? <button type="button" className="button secondary compact" disabled={quick!.stopping} onClick={() => void data.quickCheck(true)}><Icon name="stop" size={14}/>{quick!.stopping ? t('Stopping…') : t('Stop')}</button>
          : report.citations.length > 0 && <button type="button" className="button primary compact" onClick={() => void data.quickCheck()}><Icon name="checklist" size={14}/>{t('Check citations')}</button>}
        <ActionMenu label={t('More library actions')} className="icon-button" actions={[
          ...((report.uncited ?? 0) > 0 && withPdf > 0 ? [{ label: t('Find sources for uncited sentences'), icon: 'search', disabled: checking, select: () => void data.quickCheck(false, 'sources') }] : []),
          ...(report.citations.length > 0 ? [{ label: t('Ask an agent to check citations…'), icon: 'spark', select: () => checkCitations() }] : []),
          ...(unfound.length > 0 ? [{ label: tn(unfound.length, 'Ask an agent to find {n} PDF…', 'Ask an agent to find {n} PDFs…'), icon: 'spark', select: () => findPdfs() }] : []),
          { label: t('Add PDFs…'), icon: 'plus', divider: report.citations.length > 0 || unfound.length > 0, select: () => pick() },
          ...(!busy && lookAgain && online() ? [{ label: t('Look for PDFs again'), icon: 'refresh', select: data.lookAgain }] : []),
          ...(report.citations.length > 0 ? [{ label: t('Check new citations automatically'), toggled: Boolean(report.autoCheck), divider: true, select: () => void data.autoCheck(!report.autoCheck) }] : []),
        ]}/>
      </div>
      {checking ? <p className="library-checking" role="status"><span className="spinner"/>{quick!.kind === 'sources'
          ? quick!.model ? t('Finding sources with {model}: {done} of {total}', { model: quick!.model, done: quick!.done, total: quick!.total }) : t('Finding sources: {done} of {total}', { done: quick!.done, total: quick!.total })
          : quick!.model ? t('Checking with {model}: {done} of {total}', { model: quick!.model, done: quick!.done, total: quick!.total }) : t('Checking citations: {done} of {total}', { done: quick!.done, total: quick!.total })}</p>
        : (attention > 0 || totals.supported > 0) && <div className="library-results">
          {/* What needs the author, each a way into the works concerned; what holds, quietly. */}
          {flaggedCount > 0 && <button type="button" className="library-chip" data-kind="flagged" aria-pressed={filter === 'flagged'} onClick={() => show({ filter: filter === 'flagged' ? 'todo' : 'flagged' })}><i aria-hidden="true"/>{tn(flaggedCount, '{n} citation to look at', '{n} citations to look at')}</button>}
          {suggestions.length > 0 && <button type="button" className="library-chip" data-kind="suggested" aria-pressed={filter === 'uncited'} onClick={() => show({ filter: filter === 'uncited' ? 'todo' : 'uncited' })}><i aria-hidden="true"/>{tn(suggestions.length, '{n} sentence could cite a work', '{n} sentences could cite a work')}</button>}
          {totals.supported > 0 && <span className="library-results-ok"><Icon name="check" size={13}/>{tn(totals.supported, '{n} supported', '{n} supported')}</span>}
          <EvidenceBar tally={totals}/>
        </div>}
      {quick && !quick.running && quick.error && <p className="inline-error" role="alert">{quick.error}</p>}
      {quick && !quick.running && !quick.error && quick.failed > 0 && <p className="library-note" role="status">{tn(quick.failed, '{n} citation could not be checked quickly. Ask an agent to check it.', '{n} citations could not be checked quickly. Ask an agent to check them.')}</p>}
      {report.absent.length > 0 && <p className="inline-error" role="alert">{t('Missing: {files}', { files: report.absent.join(', ') })}</p>}
      {!online() && <p className="library-note">{t('Online lookups are off in Settings: only PDFs from Zotero and the ones you add are used.')}</p>}
      {unmatched.length > 0 && <p className="library-note" role="status">{tn(unmatched.length, '{names} matches no entry. Drop it on its entry.', '{names} match no entry. Drop each on its entry.', { names: unmatched.join(', ') })}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </header>
    <div className="library-body">
      <section className="library-list-pane" aria-label={t('Works')}>
        <div className="library-search">
          <Icon name="search" size={15}/>
          <input id={searchId} type="search" aria-label={t('Search the library')} placeholder={t('Search works and their PDFs')} value={query} onChange={event => setQuery(event.target.value)}/>
        </div>
        {found.query && (found.matches.length > 0 || found.loading) && <section className="library-found" aria-label={t('In the PDFs')}>
          <h3>{t('In the PDFs')}<span className="count">{found.matches.length}{found.next ? '+' : ''}</span>{found.loading && <span className="spinner"/>}</h3>
          <div className="library-snippets">{[...new Set(found.matches.map(match => match.entry))].map(id => {
            const entry = report.entries.find(item => item.id === id);
            if (!entry) return null;
            const passages = found.matches.map((match, index) => ({ match, index })).filter(({ match }) => match.entry === id);
            return <section key={id} className="library-snippet-work" aria-label={byline(entry) || entry.key}>
              <h4><span>{byline(entry) || entry.key}</span><span className="library-snippet-title">{readable(value(entry, 'title'))}</span><span className="count">{passages.length}</span></h4>
              <ul>{passages.map(({ match, index }) => {
                const first = match.marks[0], passage = { page: first.page - 1, marks: match.marks.filter(mark => mark.page === first.page).map(mark => mark.rect) };
                return <li key={index}><button type="button" className="library-snippet" data-opener={`snippet:${index}`} onClick={() => read(entry, match.hash, passage, `snippet:${index}`)}>
                  <Suspense fallback={null}><PdfThumbnail url={`/api/projects/${projectId}/library/pdfs/${match.hash}`} width={52} page={first.page} marks={passage.marks} lazy/></Suspense>
                  <span className="library-snippet-quote"><Highlighted text={match.text} query={found.query}/></span>
                  <span className="library-snippet-page">{t('p. {page}', { page: match.page })}</span>
                </button></li>;
              })}</ul>
            </section>;
          })}</div>
          {found.next && !found.loading && <button type="button" className="button ghost compact" onClick={() => void findText(found.query, found.next!)}>{t('Show more')}</button>}
        </section>}
        <div className="library-filter" role="tablist" aria-label={t('Show')}>
          {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" id={`${progressId}-${id}`} aria-selected={filter === id} onClick={() => show({ filter: id })}>{label}<span className="count">{count}</span></button>)}
        </div>
        <div role="tabpanel" aria-labelledby={`${progressId}-${filter}`} className="library-list-scroll">
          {shown.length ? <ul ref={list} className="library-list" role="list">{shown.map(row)}</ul>
            : <p className="library-empty"><Icon name="check" size={15}/>{search ? t('No work matches.') : filter === 'todo' ? t('Nothing needs you here.') : filter === 'missing' ? t('Every cited work has a PDF.') : filter === 'flagged' ? t('No citation is flagged.') : filter === 'uncited' ? t('No uncited sentence matches a work in the library.') : filter === 'problems' ? t('No problems found.') : t('No works yet.')}</p>}
        </div>
        {filter === 'problems' && all.length > 0 && <div className="library-fix">
          <button type="button" className="button primary compact" disabled={!chosen.length} onClick={investigate}><Icon name="search" size={14}/>{tn(chosen.length, 'Ask an agent to look into {n} problem', 'Ask an agent to look into {n} problems')}</button>
          <span>{t('Opens a new task you can edit before sending. The agent reports what it finds and changes nothing.')}</span>
        </div>}
      </section>
      <section className="library-detail-pane" aria-label={t('Selected work')}>
        {narrow && <button type="button" className="button ghost compact library-back" onClick={() => { opener.current = selected ? 'row:' + selected.id : null; setDetail(false); }}><Icon name="chevronLeft" size={14}/>{t('All works')}</button>}
        {!selected ? <p className="library-empty">{t('Choose a work to see its PDF and the sentences that cite it.')}</p>
          : selected.entry ? <WorkDetail key={selected.entry.id} projectId={projectId} entry={selected.entry} state={entries[selected.entry.id]} report={report} sentences={citing.get(selected.entry.key) ?? []} item={all.find(item => item.entry?.id === selected.entry!.id)}
            opened={opened} onOpened={(id, on) => setOpened(present => ({ ...present, [id]: on }))}
            suggested={suggestions.filter(item => item.key === selected.entry!.key)} onCite={suggestion => onInvestigate(citeRequest(suggestion))} onDismissSuggestion={id => void data.dismissSuggestion(id)}
            onRead={read} onAdd={() => pick(selected.entry!.id)} onRemove={() => void data.remove(selected.entry!.id)} onConfirm={on => void data.confirm(selected.entry!.id, on)}
            onForget={(id, key) => void data.forget(id, key)} onCheck={() => checkCitations(selected.entry!.key)} onFind={() => findPdfs(selected.entry!)}/>
          : <div className="library-work"><h2 className="library-work-title">{selected.item!.label}</h2>{selected.item!.problems.map((problem, i) => <p key={i} className="library-problem">{problem}</p>)}</div>}
      </section>
    </div>
  </div>;
}

// The selected work: its first page, what it is, where its PDF came from,
// and each sentence of the paper citing it with what the work says.
function WorkDetail({ projectId, entry, state, report, sentences, item, opened, onOpened, suggested, onCite, onDismissSuggestion, onRead, onAdd, onRemove, onConfirm, onForget, onCheck, onFind }: {
  projectId: string; entry: BibliographyEntry; state?: LibraryEntry; report: LibraryReport; sentences: CitingSentence[]; item?: Item;
  opened: Record<string, boolean>; onOpened: (id: string, on: boolean) => void;
  suggested: CitationSuggestion[]; onCite: (suggestion: CitationSuggestion) => void; onDismissSuggestion: (id: string) => void;
  onRead: (entry: BibliographyEntry, hash: string, passage?: PdfPassage, from?: string) => void; onAdd: () => void; onRemove: () => void; onConfirm: (on: boolean) => void;
  onForget: (id: string, key: string) => void; onCheck: () => void; onFind: () => void;
}) {
  const pdf = state?.pdf, check: ReferenceCheck | undefined = report.checks[entry.id], confirmed = entry.id in report.confirmed;
  const status = pdfState(state), authors = authorsOf(entry), doi = value(entry, 'doi');
  // Every sentence of the paper this work bears on, what needs the author first:
  // citations it does not support, sentences that could cite it, then the rest.
  const RANK: Record<string, number> = { unsupported: 0, partial: 1, unclear: 2, suggested: 3, none: 4, supported: 5 };
  const claims = [
    ...suggested.map(suggestion => ({ id: suggestion.id, sentence: suggestion.sentence, file: suggestion.file, line: suggestion.line, verdict: 'suggested' as const, note: suggestion.note, evidence: suggestion.evidence, by: suggestion.by ?? '', stale: false, suggestion })),
    ...sentences.map(sentence => {
      const finding = sentence.findings[entry.key], held = current(finding);
      return { id: sentence.id, sentence: sentence.sentence, file: sentence.file, line: sentence.line, verdict: (held?.verdict ?? 'none') as CitationVerdict | 'none', note: finding?.note ?? '', evidence: finding?.evidence ?? [], by: finding ? finding.by ?? '' : undefined, stale: Boolean(finding?.stale), suggestion: undefined };
    }),
  ].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]).map((claim, index) => ({ ...claim, open: index === 0 && claim.verdict !== 'supported' && claim.verdict !== 'none' }));
  return <article className="library-work" aria-labelledby={`work-${entry.id}`}>
    <div className="library-work-head">
      {pdf ? <button type="button" className="library-cover" aria-label={t('Open the PDF of {key}', { key: entry.key })} data-opener={'cover:' + entry.id} onClick={() => onRead(entry, pdf.hash, undefined, 'cover:' + entry.id)}>
        <Suspense fallback={null}><PdfThumbnail key={pdf.hash} url={`/api/projects/${projectId}/library/pdfs/${pdf.hash}`} width={112}/></Suspense>
      </button> : <div className="library-cover library-cover-none" data-state={status.key}><Icon name="paper" size={22}/><span>{status.label}</span></div>}
      <div className="library-work-meta">
        <h2 id={`work-${entry.id}`} className="library-work-title">{readable(value(entry, 'title')) || entry.key}</h2>
        {authors.length > 0 && <p className="library-work-authors">{authors.join(', ')}</p>}
        <p className="library-work-venue">{[venueOf(entry), value(entry, 'year')].filter(Boolean).map((part, i) => <span key={i}>{part}</span>)}<code>{entry.key}</code></p>
        <p className="library-work-source">
          <span className={'library-state s-' + status.key}>{status.label}</span>
          {pdf?.pages ? <span>{tn(pdf.pages, '{n} page', '{n} pages')}</span> : null}
          {pdf?.text === 'none' && <span className="library-warning">{t('No selectable text: agents cannot read it.')}</span>}
        </p>
        <div className="library-work-actions">
          {pdf ? <button type="button" className="button secondary compact" data-opener={'open:' + entry.id} onClick={() => onRead(entry, pdf.hash, undefined, 'open:' + entry.id)}><Icon name="pdf" size={14}/>{t('Open PDF')}</button>
            : !entry.error && <button type="button" className="button secondary compact" aria-label={t('Add a PDF for {key}', { key: entry.key })} onClick={onAdd}><Icon name="plus" size={14}/>{t('Add PDF')}</button>}
          <ActionMenu label={t('More actions for {key}', { key: entry.key })} className="icon-button" actions={[
            ...(pdf && sentences.length ? [{ label: t('Ask an agent to check its citations…'), icon: 'spark', select: onCheck }] : []),
            ...(!pdf && !entry.error && readable(value(entry, 'title')) ? [{ label: t('Ask an agent to find it…'), icon: 'spark', select: onFind }] : []),
            ...(pdf?.url ? [{ label: t('Open where the PDF came from'), icon: 'external', href: pdf.url }] : []),
            ...(!pdf && state?.landing ? [{ label: t('Publisher page'), icon: 'external', href: state.landing }] : []),
            ...(doi ? [{ label: 'DOI', icon: 'external', href: `https://doi.org/${doi}` }] : []),
            ...(pdf ? [{ label: t('Not this work'), icon: 'close', divider: true, select: onRemove }] : []),
          ]}/>
        </div>
      </div>
    </div>
    <section className="library-claims" aria-labelledby={`claims-${entry.id}`}>
      <h3 id={`claims-${entry.id}`}>{t('In your paper')}<span className="count">{sentences.length + suggested.length}</span></h3>
      {!sentences.length && !suggested.length ? <p className="library-empty">{report.all_cited ? t('Listed with \\nocite{*}; no sentence cites it.') : t('Not cited in the paper.')}</p>
        : <ol className="library-claim-list">{claims.map(claim => {
          const evidence = claim.evidence.map((item, i) => {
            const first = item.marks[0], from = `evidence:${claim.id}:${i}`;
            return <button key={i} type="button" className="library-evidence" data-opener={from} disabled={!pdf || claim.stale}
              onClick={() => pdf && onRead(entry, pdf.hash, first ? { page: first.page - 1, marks: item.marks.filter(mark => mark.page === first.page).map(mark => mark.rect) } : undefined, from)}>
              <q>{item.quote}</q><span className="library-evidence-page">{t('p. {page}', { page: item.page })}</span>
            </button>;
          });
          return <li key={claim.id} className="library-claim" data-verdict={claim.verdict}>
            <details open={opened[`${entry.key}:${claim.id}`] ?? claim.open} onToggle={event => { const on = event.currentTarget.open; if (on !== (opened[`${entry.key}:${claim.id}`] ?? claim.open)) onOpened(`${entry.key}:${claim.id}`, on); }}>
              <summary>
                {claim.verdict === 'none' ? <span className="library-verdict" data-verdict="none">{t('Not checked')}</span> : <VerdictLabel verdict={claim.verdict}/>}
                <span className="library-claim-text">{claim.suggestion ? claim.sentence : <Sentence text={claim.sentence} cited={entry.key}/>}</span>
                <code className="library-claim-where">{claim.file}:{claim.line}</code>
              </summary>
              <div className="library-claim-body">
                {claim.stale && <p className="library-note">{t('Checked on an earlier PDF of this work; check again.')}</p>}
                {claim.note && <p className="library-claim-note">{claim.note}</p>}
                {evidence}
                <div className="library-claim-actions">
                  {claim.by !== undefined && <span className="library-claim-by">{claim.by ? t('Quick check by {model}', { model: claim.by }) : t('Checked by an agent')}</span>}
                  {claim.suggestion && <button type="button" className="button secondary compact" onClick={() => onCite(claim.suggestion!)}>{t('Ask an agent to cite it')}</button>}
                  {claim.verdict !== 'none' && <button type="button" className="button ghost compact" onClick={() => claim.suggestion ? onDismissSuggestion(claim.suggestion.id) : onForget(claim.id, entry.key)}>{t('Dismiss')}</button>}
                </div>
              </div>
            </details>
          </li>;
        })}</ol>}
    </section>
    <details className="library-entry">
      <summary><Icon name="chevronRight" size={13}/>{t('Bibliography entry')}{item && !item.soft && <span className="library-state s-mismatch">{tn(item.problems.length, '{n} problem', '{n} problems')}</span>}</summary>
      {item && item.problems.map((problem, i) => <p key={i} className="library-problem">{problem}</p>)}
      <table><tbody>{entry.fields.map(field => <tr key={field.name}><th scope="row">{field.name}</th><td>{field.value}{field.resolved && <span className="library-resolved"> = {field.resolved}</span>}</td></tr>)}</tbody></table>
      <p className="library-where">{entry.file}:{entry.lines[0]}–{entry.lines[1]}</p>
      {check?.record && <p className="library-record"><span>{check.status === 'unverified' ? t('Closest record') : t('Record')}{gap() || ' '}{SOURCE[check.record.source]}</span>
        <a href={check.record.url} target="_blank" rel="noopener noreferrer">{check.record.title}</a>{[check.record.authors.join(', '), check.record.venue, check.record.year, check.record.doi && `doi:${check.record.doi}`].filter(Boolean).map((part, i) => <span key={i}>{part}</span>)}</p>}
      {check && check.differences.length > 0 && <dl className="library-differences">{check.differences.map((d, i) => <div key={i}><dt>{fieldName(d.field)}{d.minor ? ` (${t('small')})` : ''}</dt><dd><span>{d.bib}</span><span>{SOURCE[check.record?.source || ''] || t('Record')}: {d.record || '—'}</span></dd></div>)}</dl>}
      {check?.unavailable.length ? <p className="library-note">{t('{sources} could not be reached.', { sources: check.unavailable.join(', ') })}</p> : null}
      {!entry.error && (confirmed
        ? <p className="library-confirmed">{t('You checked this entry yourself.')} <button type="button" className="button ghost compact" onClick={() => onConfirm(false)}>{t('Undo')}</button></p>
        : check?.status !== 'verified' && <button type="button" className="button ghost compact" onClick={() => onConfirm(true)}><Icon name="check" size={14}/>{t('I checked it myself')}</button>)}
    </details>
  </article>;
}

// A cited work's PDF, read in place of the library, at a passage when one is given.
function LibraryReader({ projectId, entry, hash, passage, uses, onShow, onClose }: { projectId: string; entry: BibliographyEntry; hash: string; passage?: PdfPassage; uses: SourceUse[]; onShow?: (use: SourceUse) => void; onClose: () => void }) {
  const [outline, setOutline] = useState<OutlineItem[]>([]), [section, setSection] = useState(-1);
  const nothing = () => {};
  // The back button appears with the lazily loaded reader; it takes focus then.
  const focused = useRef(false), shown = useRef(false);
  const back = useCallback((button: HTMLButtonElement | null) => { if (button && !focused.current) { focused.current = true; button.focus(); } }, []);
  // An evidence quote opens the PDF at its lines.
  const reader = useCallback((handle: PdfHandle | null) => {
    if (!handle || !passage?.marks.length || shown.current) return;
    shown.current = true;
    const rects = passage.marks;
    handle.showPlace(passage.page, [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))], { keep: true });
  }, [passage]);
  return <section className="library-reader" aria-label={t('PDF of {key}', { key: entry.key })}>
    <Suspense fallback={<p className="library-empty" role="status">{t('Opening the PDF…')}</p>}>
      <PdfView ref={reader} readOnly place={'pdf:library:' + hash} url={`/api/projects/${projectId}/library/pdfs/${hash}`} notes={[]} active="" region={false} setRegion={nothing} onCreate={async () => {}} onSelect={nothing}
        outline={outline} section={section} onOutline={setOutline} onSection={setSection} passage={passage}
        margin={uses.length ? page => <SourceEvidence uses={uses.filter(use => use.page === page)} onShow={onShow}/> : undefined}
        lead={<div className="library-reader-lead"><button ref={back} type="button" className="icon-button" aria-label={t('Back to the library')} title={t('Back to the library')} onClick={onClose}><Icon name="arrowLeft" size={16}/></button><code>{entry.key}</code><span>{readable(value(entry, 'title'))}</span></div>}/>
    </Suspense>
  </section>;
}
