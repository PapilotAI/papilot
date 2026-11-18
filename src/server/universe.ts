import { createHash } from 'node:crypto';
import { readZip } from './imports.ts';

// Papilot Universe publishes LaTeX templates as a static site: v1/index.json lists
// them, and each version is an immutable ZIP with a SHA-256 in the index.
const DEFAULT_BASE = 'https://papilot.ai/universe/';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, VERSION = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.]+)?$/;
const CATEGORIES = new Set(['thesis', 'conference', 'journal', 'article', 'report', 'cv', 'slides', 'poster', 'book', 'letter']);
const ENGINES = new Set(['pdflatex', 'xelatex', 'lualatex']);
const MAX_INDEX = 4 * 1024 * 1024, MAX_ARCHIVE = 64 * 1024 * 1024, FRESH = 5 * 60_000;

export type UniverseTemplate = {
  id: string; version: string; name: string; description: string;
  zh?: { name?: string; description?: string };
  category: string; tags: string[]; languages: string[];
  organization?: string; venue?: { name: string; year?: number; ccf?: 'A' | 'B' | 'C'; area?: string; full?: string };
  // A conference that reuses another template's files names that template.
  template?: string;
  license: string; main: string; engine: string;
  thumbnail?: string; page: string;
  archive: { url: string; sha256: string; size: number };
};
export type TemplateChoice = { id: string; version: string };

export function universeBase(value = process.env.PAPILOT_UNIVERSE_URL) {
  const url = new URL((value || DEFAULT_BASE).trim().replace(/\/?$/, '/'));
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('PAPILOT_UNIVERSE_URL must be an https URL.');
  return url.href;
}

export function templateChoice(value: unknown): TemplateChoice | undefined {
  if (value === undefined || value === null) return undefined;
  const choice = value as Record<string, unknown>;
  if (typeof choice !== 'object' || typeof choice.id !== 'string' || !ID.test(choice.id) || choice.id.length > 80 || typeof choice.version !== 'string' || !VERSION.test(choice.version) || choice.version.length > 40) throw new Error('Choose a template from the list.');
  return { id: choice.id, version: choice.version };
}

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
// Only files under the Universe base are fetched, whatever the index says.
function inside(base: string, value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 1000) return undefined;
  try { const url = new URL(value, base); return url.href.startsWith(base) && !url.search && !url.hash ? url.href : undefined; } catch { return undefined; }
}
function template(raw: Record<string, any>, base: string): UniverseTemplate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : undefined, version = typeof raw.version === 'string' && VERSION.test(raw.version) ? raw.version : undefined;
  const name = text(raw.name, 80), description = text(raw.description, 200) ?? '';
  const main = typeof raw.main === 'string' && /^[^/\\][^\\]*\.tex$/.test(raw.main) && !raw.main.split('/').includes('..') ? raw.main : undefined;
  const archive = raw.archive ?? {}, url = inside(base, archive.url), page = inside(base, raw.page);
  if (!id || !version || !name || !main || !url || !page || !ENGINES.has(raw.engine) || !CATEGORIES.has(raw.category)) return undefined;
  if (typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256) || !Number.isInteger(archive.size) || archive.size <= 0 || archive.size > MAX_ARCHIVE) return undefined;
  const zh = raw.i18n?.['zh-CN'], venue = raw.venue;
  return {
    id, version, name, description,
    ...(zh && (text(zh.name, 80) || text(zh.description, 200)) ? { zh: { name: text(zh.name, 80), description: text(zh.description, 200) } } : {}),
    category: raw.category,
    tags: Array.isArray(raw.tags) ? raw.tags.map(tag => text(tag, 40)).filter((tag): tag is string => !!tag).slice(0, 12) : [],
    languages: Array.isArray(raw.languages) ? raw.languages.filter((language: unknown) => typeof language === 'string' && /^[a-z]{2}(?:-[A-Z][a-z]{3})?$/.test(language)) : [],
    ...(text(raw.organization, 80) ? { organization: text(raw.organization, 80) } : {}),
    ...(venue && text(venue.name, 40) ? { venue: {
      name: text(venue.name, 40)!,
      ...(Number.isInteger(venue.year) ? { year: venue.year } : {}),
      ...(['A', 'B', 'C'].includes(venue.ccf) ? { ccf: venue.ccf } : {}),
      ...(typeof venue.area === 'string' && ID.test(venue.area) && venue.area.length <= 20 ? { area: venue.area } : {}),
      ...(text(venue.full, 200) ? { full: text(venue.full, 200) } : {}),
    } } : {}),
    ...(typeof raw.template === 'string' && ID.test(raw.template) && raw.template.length <= 80 ? { template: raw.template } : {}),
    license: text(raw.license, 120) ?? 'unknown', main, engine: raw.engine,
    ...(inside(base, raw.thumbnail) ? { thumbnail: inside(base, raw.thumbnail) } : {}),
    page,
    archive: { url, sha256: archive.sha256, size: archive.size },
  };
}

async function body(response: Response, limit: number) {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('too large');
  const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > limit) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class Universe {
  private cached?: { at: number; templates: UniverseTemplate[] };
  private loading?: Promise<UniverseTemplate[]>;
  constructor(readonly base = universeBase(), private fetcher: typeof fetch = fetch, private now = Date.now) {}

  async templates(fresh = false): Promise<UniverseTemplate[]> {
    if (!fresh && this.cached && this.now() - this.cached.at < FRESH) return this.cached.templates;
    this.loading ??= (async () => {
      try {
        const response = await this.fetcher(this.base + 'v1/index.json', { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const index = JSON.parse((await body(response, MAX_INDEX)).toString('utf8'));
        if (index?.schema !== 1 || !Array.isArray(index.templates)) throw new Error('unsupported index');
        const seen = new Set<string>(), templates = index.templates.map((raw: Record<string, any>) => template(raw, this.base)).filter((value: UniverseTemplate | undefined): value is UniverseTemplate => !!value && !seen.has(value.id) && !!seen.add(value.id));
        this.cached = { at: this.now(), templates };
        return templates;
      } catch { throw new Error('Could not load templates. Check the internet connection and try again.'); }
      finally { this.loading = undefined; }
    })();
    return this.loading;
  }

  // Resolves the exact version the author chose and verifies its archive.
  async download(choice: TemplateChoice, expected?: string) {
    let found = (await this.templates()).find(item => item.id === choice.id);
    if (found?.version !== choice.version) found = (await this.templates(true)).find(item => item.id === choice.id);
    if (!found || found.version !== choice.version) throw new Error('This template version is no longer available. Choose the template again.');
    if (expected && found.archive.sha256 !== expected) throw new Error('This template changed after creation started. Choose another name to start again.');
    let data: Buffer;
    try {
      const response = await this.fetcher(found.archive.url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await body(response, MAX_ARCHIVE);
    } catch { throw new Error('Could not download the template. Check the internet connection and try again.'); }
    if (createHash('sha256').update(data).digest('hex') !== found.archive.sha256) throw new Error('The downloaded template did not match its checksum. Try again later.');
    let files: Map<string, Buffer>;
    try { files = await readZip(data); } catch { throw new Error('The template archive could not be read. Choose another template.'); }
    if (!files.has(found.main)) throw new Error('The template is missing its main file. Choose another template.');
    return { template: found, files };
  }
}
