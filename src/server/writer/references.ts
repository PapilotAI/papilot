import { engine } from '../references.ts';
import { toolError } from './policy.ts';
import type { ReferenceCheck } from '../../shared.ts';

// Finding and checking references for Papilot Writer. Search asks Crossref
// and DBLP; BibTeX for a DOI comes from doi.org and for an arXiv ID from
// arXiv, so an entry built from an identifier is the published record. A
// hand-written entry is checked the way Papilot checks every bibliography,
// and only an entry the record confirms is added without asking.

export interface Candidate { title: string; authors: string[]; year: number | null; venue: string | null; doi: string | null; arxiv: string | null; source: 'crossref' | 'dblp' }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
interface BibField { name: string; value: string; resolved?: string }
interface BibEntry { key: string; type: string; fields: BibField[]; error?: string }
interface Verify {
  parseBib(text: string, file?: string): BibEntry[];
  entryInputs(entries: { id: string; type: string; fields: BibField[]; error?: string }[]): { id: string; type: string; fields: Record<string, string> }[];
  checkEntry(input: { id: string; type: string; fields: Record<string, string> }, http: unknown): Promise<ReferenceCheck>;
  Http: new (fetcher?: Fetch) => unknown;
}
const verify = async () => (await engine()) as unknown as Verify;
const AGENT = 'Papilot (https://papilot.ai)';
const TIMEOUT = 20000;

async function json(fetcher: Fetch, url: string): Promise<any> {
  const response = await fetcher(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw toolError(`${new URL(url).hostname} answered ${response.status}.`);
  return response.json();
}
const arxivId = (value: string | undefined | null) => /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:|^)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i.exec(value || '')?.[1] || null;
const cleanDoi = (value: string) => value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');

/** Works matching a free-text query (title, authors, year…). */
export async function searchReferences(query: string, limit = 5, fetcher: Fetch = fetch): Promise<{ candidates: Candidate[]; unavailable: string[] }> {
  const q = encodeURIComponent(query.trim().slice(0, 300)), unavailable: string[] = [];
  const [crossref, dblp] = await Promise.allSettled([
    json(fetcher, `https://api.crossref.org/works?query.bibliographic=${q}&rows=${limit}&select=DOI,title,author,issued,container-title,type`),
    json(fetcher, `https://dblp.org/search/publ/api?q=${q}&format=json&h=${limit}`),
  ]);
  const candidates: Candidate[] = [];
  if (crossref.status === 'fulfilled') for (const item of crossref.value?.message?.items || []) candidates.push({
    title: String(item.title?.[0] || '').replace(/\s+/g, ' '), source: 'crossref',
    authors: (item.author || []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null, venue: item['container-title']?.[0] || null, doi: item.DOI || null, arxiv: null,
  });
  else unavailable.push('Crossref');
  if (dblp.status === 'fulfilled') for (const hit of [dblp.value?.result?.hits?.hit || []].flat()) {
    const info = hit.info || {}, authors = [info.authors?.author || []].flat().map((a: any) => String(a.text || a).replace(/\s\d{4}$/, ''));
    const doi = info.doi || null, arxiv = info.venue === 'CoRR' ? arxivId(info.ee) || arxivId(info.volume) : null;
    candidates.push({ title: String(info.title || '').replace(/\.$/, ''), source: 'dblp', authors, year: Number(info.year) || null, venue: info.venue || null, doi, arxiv });
  } else unavailable.push('DBLP');
  // One line per work: DBLP often lists the same DOI Crossref found.
  const seen = new Set<string>();
  return { unavailable, candidates: candidates.filter(c => { const key = (c.doi || c.arxiv || c.title).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }) };
}

/** The published BibTeX for a DOI or an arXiv ID, with the requested key. */
export async function fetchBibtex(id: { doi?: string; arxiv?: string }, key?: string, fetcher: Fetch = fetch) {
  let text: string;
  if (id.doi) {
    const response = await fetcher(`https://doi.org/${encodeURIComponent(cleanDoi(id.doi)).replace(/%2F/g, '/')}`, { headers: { 'User-Agent': AGENT, Accept: 'application/x-bibtex; charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) throw toolError(response.status === 404 ? `No work has the DOI ${id.doi}.` : `doi.org answered ${response.status} for ${id.doi}.`);
    text = await response.text();
  } else if (id.arxiv) {
    const arxiv = arxivId(id.arxiv);
    if (!arxiv) throw toolError(`${id.arxiv} is not an arXiv identifier.`);
    const response = await fetcher(`https://arxiv.org/bibtex/${arxiv}`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) throw toolError(`arXiv answered ${response.status} for ${arxiv}.`);
    text = await response.text();
  } else throw toolError('Give a DOI or an arXiv identifier.');
  if (!/^\s*@\w+\s*\{/.test(text)) throw toolError('The service did not return a BibTeX entry.');
  return formatBibtex(key ? text.replace(/^(\s*@\w+\s*\{)\s*[^,]*,/, `$1${key},`) : text);
}

// doi.org returns one long line; put each field on its own line.
export function formatBibtex(text: string) {
  text = text.trim();
  if (text.split('\n').length > 2) return text + '\n';
  return text.replace(/^(@\w+\s*\{[^,]+,)\s*/, '$1\n  ').replace(/,\s*(\w+)\s*=\s*/g, ',\n  $1 = ').replace(/\s*\}\s*$/, '\n}') + '\n';
}

/** Reads one BibTeX entry and checks it against Crossref, DBLP and arXiv. */
export async function checkBibtex(text: string, fetcher: Fetch = fetch) {
  const mods = await verify(), entries = mods.parseBib(text, 'new.bib');
  if (entries.length !== 1) throw toolError(entries.length ? 'Add one BibTeX entry at a time.' : 'This is not a BibTeX entry.');
  const [entry] = entries;
  if (entry.error) throw toolError(`The BibTeX entry could not be read: ${entry.error}`);
  const [input] = mods.entryInputs([{ id: entry.key, type: entry.type, fields: entry.fields }]);
  return { key: entry.key, check: await mods.checkEntry(input, new mods.Http(fetcher)) };
}

/** Keys already in a .bib text. */
export async function bibKeys(text: string) { return new Set((await verify()).parseBib(text).map(entry => entry.key)); }

export const describeCandidate = (c: Candidate, index: number) =>
  `${index + 1}. ${c.title || '(untitled)'} — ${c.authors.slice(0, 4).join(', ')}${c.authors.length > 4 ? ' et al.' : ''}${c.year ? ` (${c.year})` : ''}${c.venue ? `, ${c.venue}` : ''}${c.doi ? `, doi:${c.doi}` : ''}${c.arxiv ? `, arXiv:${c.arxiv}` : ''} [${c.source}]`;
