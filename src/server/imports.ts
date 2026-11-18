import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import tar from 'tar-stream';
import { gunzip } from 'node:zlib';
import { downloadPaperSource } from './paper-link.ts';
import { DATA, ENGINE } from './paths.ts';
import { realPath } from './real-path.ts';
import type { PaperImport, Project } from '../shared.ts';
import type { Manuscripts } from './manuscript.ts';

const execute = promisify(execFile);
// Downloads and in-memory template previews remain bounded. Local uploads stream to disk.
const MAX_BYTES = 64 * 1024 * 1024, MAX_FILES = 5000;
const skip = (name: string) => ['.git', '__macosx', '.ds_store', 'node_modules', '.papilot'].includes(name.toLowerCase()) || name.startsWith('._');
const git = async (root: string, ...args: string[]) => (await execute('git', ['-C', root, ...args], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
function safeName(name: unknown): string {
  if (typeof name !== 'string' || !name || name.length > 4000 || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path in upload.');
  return name;
}
function bytes(value: unknown) {
  if (typeof value !== 'string' || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value) || /=/.test(value.slice(0, -2)) || /=[^=]$/.test(value)) throw new Error('Invalid upload data.');
  return Buffer.from(value, 'base64');
}
type Config = typeof import('../../engine/src/core/config.ts');
type LegacyState = typeof import('../../engine/src/core/legacy-state.ts');
const configModule = (): Promise<Config> => import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href);
// The settings Papilot saved for a paper in its Git directory. A folder that
// is not its own repository yet has only those an earlier version kept in
// the folder itself.
async function config(root: string): Promise<Record<string, unknown>> {
  let top: string | undefined;
  try { top = await git(root, 'rev-parse', '--show-toplevel'); } catch { /* Not a repository yet. */ }
  if (top && realPath(top) === realPath(root)) return (await configModule()).readSettings(root);
  const { legacySettings } = await import(pathToFileURL(path.join(ENGINE, 'src/core/legacy-state.ts')).href) as LegacyState;
  return legacySettings(root) ?? {};
}
export function texFiles(root: string) {
  const files: string[] = [], folders = [''];
  while (folders.length) {
    const folder = folders.pop()!;
    for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (skip(item.name) || ['build', 'out', 'output'].includes(item.name)) continue;
      const file = path.posix.join(folder, item.name);
      if (item.isDirectory()) folders.push(file);
      else if (item.isFile() && /\.tex$/i.test(file)) files.push(file);
    }
  }
  return files.sort();
}
export function existingTex(root: string, file: unknown): file is string {
  if (typeof file !== 'string' || !/\.tex$/i.test(file)) return false;
  try {
    safeName(file);
    let current = root;
    for (const part of file.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    }
    return fs.statSync(current).isFile();
  } catch { return false; }
}
function sourceHead(file: string) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(300000);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8');
  } finally { fs.closeSync(fd); }
}
/** Whether a TeX file of the folder is a root document: one that declares its
 *  class and begins the document, outside comments. */
export function isRootDocument(root: string, file: unknown): file is string {
  if (!existingTex(root, file)) return false;
  const text = sourceHead(path.join(root, file)).replace(/(?<!\\)%[^\n]*/g, '');
  return /\\documentclass\b/.test(text) && /\\begin\s*\{document\}/.test(text);
}
export async function inspectPaper(root: string) {
  let settings: Record<string, unknown> = {}, error: string | undefined;
  try { settings = await config(root); } catch (failure) { error = (failure as Error).message; }
  let main = existingTex(root, settings.main) ? settings.main : '', engine = '';
  // Most papers already declare their main file or keep it near the root.
  // Do not enumerate caches, assets and supporting papers just to open them.
  if (!main) {
    try {
      const detected = (await configModule()).detectMain(root);
      if (existingTex(root, detected)) main = detected;
    } catch { /* Unusual layouts fall back to a deeper search. */ }
  }
  let candidates = main ? [main] : [];
  if (!main) {
    const files = texFiles(root), roots = files.filter(file => isRootDocument(root, file));
    main = roots.length === 1 ? roots[0] : '';
    const found = new Set(roots);
    candidates = [...roots, ...files.filter(file => !found.has(file))];
  }
  try { if (main) engine = await engineFor(root, main, settings); } catch (failure) { error = (failure as Error).message; }
  return { candidates, main, engine: engine || 'pdflatex', error };
}
// Engine detection also works before Git initialization by reading the source hints.
async function engineFor(root: string, main: string, settings: Record<string, unknown>) {
  if (typeof settings.engine === 'string' && settings.engine) return settings.engine;
  const text = sourceHead(path.join(root, main));
  const rc = [path.join(path.dirname(main), '.latexmkrc'), path.join(path.dirname(main), 'latexmkrc'), '.latexmkrc', 'latexmkrc'].find(file => fs.existsSync(path.join(root, file)));
  const mode = rc ? fs.readFileSync(path.join(root, rc), 'utf8').match(/^\s*\$pdf_mode\s*=\s*(\d)/m)?.[1] : undefined;
  return text.match(/^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)/im)?.[1].toLowerCase() || ({ '1': 'pdflatex', '4': 'lualatex', '5': 'xelatex' } as Record<string, string>)[mode || ''] || ((await configModule()).hasUnicodeEngineHint(text) ? 'xelatex' : 'pdflatex');
}
// Keep the author's settings, including a source folder that still contains
// the main file; without one, the whole folder compiles.
export async function rememberMain(root: string, main: string, engine: string) {
  const { readSettings, writeSettings } = await configModule();
  const settings = readSettings(root), folder = typeof settings.source_dir === 'string' ? settings.source_dir.replace(/\/+$/, '') : null;
  const contains = folder === '' || (folder !== null && main.startsWith(folder + '/'));
  const next = { ...settings, main, engine, ...(contains ? {} : { source_dir: '' }) };
  if (JSON.stringify(next) !== JSON.stringify(settings)) writeSettings(root, next);
}
async function repositoryRoot(root: string) {
  let top: string | undefined;
  try { top = await git(root, 'rev-parse', '--show-toplevel'); } catch { /* A plain folder needs Git. */ }
  if (top && realPath(top) !== realPath(root)) throw new Error('This folder belongs to a parent Git repository. Select its root folder, or upload a copy.');
  return top;
}
export async function prepareRepository(root: string, message = 'Import paper into Papilot') {
  const top = await repositoryRoot(root);
  if (!top) await git(root, 'init', '-q');
  try { await git(root, 'rev-parse', '--verify', 'HEAD'); return; } catch { /* Empty repositories need their first snapshot. */ }
  // Do not change the author's global identity or overwrite their ignore rules.
  if (!fs.existsSync(path.join(root, '.gitignore'))) fs.writeFileSync(path.join(root, '.gitignore'), '*.aux\n*.log\n*.fls\n*.fdb_latexmk\n*.synctex.gz\n*.toc\n*.out\n.DS_Store\n');
  await git(root, 'add', '--all');
  await git(root, '-c', 'user.name=Papilot', '-c', 'user.email=papilot@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', message);
}
// The desktop app opens a folder the way an editor does. A paper already in
// Papilot opens again; any other folder with a clear main file is added as it
// is and compiles in its own view. Only a folder with several possible main
// files returns them, so the author can pick one.
export async function openFolder(input: { path?: unknown; main?: unknown }, known: (root: string) => Project | undefined, register: (root: string, name: string) => Promise<Project>): Promise<{ project: Project } | { name: string; candidates: string[] }> {
  if (typeof input.path !== 'string' || !input.path.trim()) throw new Error('Enter a folder path.');
  const root = realPath(input.path);
  if (!fs.statSync(root).isDirectory()) throw new Error('Select a folder containing the paper.');
  const project = known(root);
  if (project) return { project };
  await repositoryRoot(root);
  const detected = await inspectPaper(root);
  if (detected.error) throw new Error(detected.error);
  if (input.main === undefined && !detected.main) {
    if (!detected.candidates.length) throw new Error('Select a folder containing the paper.');
    return { name: path.basename(root), candidates: detected.candidates };
  }
  const main = input.main ?? detected.main;
  if (!existingTex(root, main)) throw new Error('Choose an existing TeX main file.');
  await prepareRepository(root);
  await rememberMain(root, main, await engineFor(root, main, (await configModule()).readSettings(root)));
  return { project: await register(root, path.basename(root)) };
}
// Uploaded ZIPs and Universe templates share path and file-type validation.
async function zipEntries(buffer: Buffer | string, visit: (name: string, stream: NodeJS.ReadableStream) => Promise<void>, bounded = false, signal?: AbortSignal) {
  if (bounded && typeof buffer !== 'string' && buffer.length > MAX_BYTES) throw new Error('Choose a ZIP smaller than 64 MB.');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    const options = { lazyEntries: true, strictFileNames: true, validateEntrySizes: true };
    const ready = (error: Error | null, value: yauzl.ZipFile) => error ? reject(error) : resolve(value);
    if (typeof buffer === 'string') yauzl.open(buffer, options, ready);
    else yauzl.fromBuffer(buffer, options, ready);
  });
  // A file-backed ZIP releases its descriptor asynchronously; callers may delete it next.
  const closed = typeof buffer === 'string' ? new Promise<void>(resolve => zip.once('close', resolve)) : undefined;
  try { await new Promise<void>((resolve, reject) => {
    let count = 0, total = 0;
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => { void (async () => {
      signal?.throwIfAborted();
      if (bounded && (++count > MAX_FILES || (total += entry.uncompressedSize) > MAX_BYTES)) throw new Error('The ZIP expands beyond 64 MB or 5,000 files.');
      const name = safeName(entry.fileName.replace(/\/$/, ''));
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode && mode !== 0o100000 && mode !== 0o040000) throw new Error('ZIP links and special files are not supported.');
      if (name.split('/').some(skip) || entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
      // An unconsumed entry stream keeps the ZIP open, so release it if the visitor fails before piping it.
      try { await visit(name, stream); } catch (error) { (stream as NodeJS.ReadableStream & { destroy(): void }).destroy(); throw error; }
      zip.readEntry();
    })().catch(fail); });
    zip.readEntry();
  }); } finally { zip.close(); await closed; }
}
export function extractZip(buffer: Buffer | string, root: string, bounded = false, signal?: AbortSignal) {
  return zipEntries(buffer, async (name, stream) => {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  }, bounded, signal);
}
export async function readZip(buffer: Buffer) {
  const files = new Map<string, Buffer>(), seen = new Set<string>();
  await zipEntries(buffer, async (name, stream) => {
    // Case-insensitive file systems would merge these into one file.
    if (seen.has(name.toLowerCase())) throw new Error('The ZIP contains the same file twice.');
    seen.add(name.toLowerCase());
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    files.set(name, Buffer.concat(chunks));
  }, true);
  return files;
}

export async function extractSource(buffer: Buffer, root: string, zipOnly = false) {
  if (buffer.length > MAX_BYTES) throw new Error('The source download exceeds 64 MB.');
  if (buffer.subarray(0, 2).toString() === 'PK') return extractZip(buffer, root, true);
  if (zipOnly) throw new Error('Overleaf did not return a source ZIP. Try a read-only sharing link or upload the ZIP.');
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try { buffer = await promisify(gunzip)(buffer, { maxOutputLength: MAX_BYTES }); }
    catch { throw new Error('The source archive is damaged or expands beyond 64 MB.'); }
  }
  const head = buffer.subarray(0, 300000).toString('utf8');
  if (/^\s*(?:<!doctype\s+html|<html|<\?xml)|^%PDF-/i.test(head)) throw new Error('This link returned a web page or PDF, not LaTeX source. Use an arXiv paper link, an Overleaf sharing link, or a source archive download.');
  // arXiv also serves single TeX submissions, with or without gzip.
  if (!buffer.includes(0) && /\\(?:documentclass|documentstyle|begin\s*\{document\})/.test(head)) {
    fs.writeFileSync(path.join(root, 'main.tex'), buffer, { flag: 'wx', mode: 0o600 }); return;
  }
  const archive = tar.extract(), seen = new Set<string>(); let count = 0, total = 0;
  await new Promise<void>((resolve, reject) => {
    archive.on('error', reject); archive.on('finish', resolve);
    archive.on('entry', (header, stream, next) => { void (async () => {
      if (++count > MAX_FILES || (total += header.size ?? 0) > MAX_BYTES) throw new Error('The source archive expands beyond 64 MB or 5,000 files.');
      if (header.type !== 'file' && header.type !== 'directory') throw new Error('Source archive links and special files are not supported.');
      // Conventional tar exports prefix names with ./ and may include ./ itself.
      const raw = header.name.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
      if (!raw && header.type === 'directory') { stream.resume(); next(); return; }
      const name = safeName(raw);
      if (header.type === 'directory' || name.split('/').some(skip)) { stream.resume(); next(); return; }
      if (seen.has(name.toLowerCase())) throw new Error('The source archive contains the same file twice.');
      seen.add(name.toLowerCase());
      const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true });
      await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 })); next();
    })().catch(error => archive.destroy(error)); });
    archive.end(buffer);
  });
}

export class PaperImports {
  private sessions = new Map<string, PaperImport>();
  private active = new Set<string>();
  get busy() { return this.active.size > 0; }
  constructor(private manuscripts: Manuscripts, private directory = DATA, private registered: (root: string) => boolean = () => false, private source = downloadPaperSource) {
    // Staged ZIPs belong to requests that ended with a previous server process.
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) if (name.startsWith('upload-')) fs.rmSync(path.join(directory, name), { recursive: true, force: true });
    const folder = path.join(directory, 'imports'), papers = path.join(directory, 'papers');
    // A copy is saved with its receipt only once complete and is never added to the workspace without one,
    // so a copy without a receipt was interrupted by a previous server process.
    if (fs.existsSync(papers)) for (const id of fs.readdirSync(papers)) {
      const root = path.join(papers, id);
      if (/^[a-f0-9-]{36}$/.test(id) && !fs.existsSync(path.join(folder, id + '.json')) && !registered(root)) fs.rmSync(root, { recursive: true, force: true });
    }
    if (fs.existsSync(folder)) for (const file of fs.readdirSync(folder)) {
      if (/^[a-f0-9-]{36}\.json$/.test(file)) try { this.get(file.slice(0, -5)); } catch { /* An unreadable receipt must not prevent other papers from opening. */ }
    }
  }
  private save(value: PaperImport) {
    fs.mkdirSync(path.join(this.directory, 'imports'), { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'imports', value.id + '.json');
    // Progress is live state; a restarted server fails a running import anyway.
    const { progress: _progress, ...stored } = value;
    fs.writeFileSync(file + '.tmp', JSON.stringify(stored), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    this.sessions.set(value.id, value); return { ...value };
  }
  get(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Import not found.');
    let value = this.sessions.get(id);
    if (!value) {
      value = JSON.parse(fs.readFileSync(path.join(this.directory, 'imports', id + '.json'), 'utf8')) as PaperImport;
      if (['building', 'repairing'].includes(value.phase)) Object.assign(value, { phase: 'failed', error: 'Papilot restarted. Retry compilation to continue this import.' });
      this.sessions.set(id, value);
    }
    return { ...value };
  }
  async upload(files: AsyncIterable<{ filename: string; file: NodeJS.ReadableStream }>, name: unknown, archive: boolean, signal?: AbortSignal) {
    return this.create({ name }, async root => {
      let count = 0;
      for await (const part of files) {
        signal?.throwIfAborted();
        count++;
        if (archive) {
          if (count !== 1) throw new Error('Drop one folder or LaTeX ZIP file.');
          const temporary = await fs.promises.mkdtemp(path.join(this.directory, 'upload-'));
          try {
            const file = path.join(temporary, 'source.zip');
            await pipeline(part.file, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
            await extractZip(file, root, false, signal);
          } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
        } else {
          let file: string;
          try { file = safeName(decodeURIComponent(part.filename)); } catch { throw new Error('Invalid file path in upload.'); }
          if (file.split('/').some(skip)) { for await (const _chunk of part.file) { /* Drain ignored files without buffering. */ } continue; }
          const target = path.join(root, file);
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          await pipeline(part.file, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
        }
      }
      if (!count) throw new Error('No files found in this folder.');
    }, signal);
  }
  async create(input: { path?: unknown; name?: unknown; zip?: unknown; files?: unknown; url?: unknown }, upload?: (root: string) => Promise<void>, signal?: AbortSignal) {
    const id = randomUUID(); let root = '', copied = false, sourceName = '';
    if ([input.path, input.zip, input.files, input.url, upload].filter(value => value !== undefined).length !== 1) throw new Error('Choose one folder, ZIP or paper link.');
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 120)) throw new Error('Paper name is too long.');
    this.active.add(id);
    try {
      if (input.path !== undefined) {
        if (typeof input.path !== 'string' || !input.path.trim()) throw new Error('Enter a folder path.');
        root = realPath(input.path.startsWith('~/') ? path.join(os.homedir(), input.path.slice(2)) : input.path);
        if (!fs.statSync(root).isDirectory()) throw new Error('Select a folder containing the paper.');
      } else {
        root = path.join(this.directory, 'papers', id); copied = true; fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        if (upload) await upload(root);
        else if (input.url !== undefined) {
          const source = await this.source(input.url); sourceName = source.name;
          await extractSource(source.data, root, source.zip);
        } else if (input.zip !== undefined) await extractZip(bytes(input.zip), root);
        else {
          if (!Array.isArray(input.files) || !input.files.length) throw new Error('No files found in this folder.');
          for (const file of input.files) {
            const name = safeName(file.path);
            if (name.split('/').some(skip)) continue;
            const data = bytes(file.data);
            const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data, { flag: 'wx', mode: 0o600 });
          }
        }
        // Unwrap export folders (Overleaf and GitHub ZIPs commonly have one).
        let children = fs.readdirSync(root).filter(name => !skip(name));
        while (children.length === 1 && fs.statSync(path.join(root, children[0])).isDirectory()) { root = path.join(root, children[0]); children = fs.readdirSync(root).filter(name => !skip(name)); }
      }
      if (this.registered(root)) throw new Error('This paper is already added. Open it from the paper list.');
      if (!copied && [...this.sessions.values()].some(item => item.path === root)) return this.get([...this.sessions.values()].find(item => item.path === root)!.id);
      const detected = await inspectPaper(root);
      signal?.throwIfAborted();
      if (input.url !== undefined && !detected.candidates.length) throw new Error('The download contains no TeX source files. This paper may only provide a PDF.');
      const existing = !copied && [...this.sessions.values()].find(item => item.path === root);
      if (existing) return this.get(existing.id);
      return this.save({ id, path: root, copied, name: (input.name as string)?.trim() || sourceName || path.basename(root), ...detected, phase: 'choose' });
    } catch (error) { if (copied) fs.rmSync(path.join(this.directory, 'papers', id), { recursive: true, force: true }); throw error; }
    finally { this.active.delete(id); }
  }
  async build(id: string, input: { main?: unknown; engine?: unknown; name?: unknown }, repair?: (root: string, error: string) => Promise<string>) {
    const value = this.get(id);
    if (this.active.has(id)) return value;
    if (this.registered(value.path)) throw new Error('This paper is already added. Open it from the paper list.');
    const main = input.main ?? value.main, engine = input.engine ?? value.engine;
    if (!existingTex(value.path, main)) throw new Error('Choose an existing TeX main file.');
    if (!['pdflatex', 'xelatex', 'lualatex'].includes(engine as string)) throw new Error('Choose a supported LaTeX engine.');
    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)) throw new Error('Enter a paper name under 120 characters.');
    this.active.add(id);
    const previousError = value.error || '';
    Object.assign(value, { main, engine, ...(input.name ? { name: input.name } : {}), phase: repair ? 'repairing' : 'building', error: undefined, startedAt: Date.now(), progress: undefined });
    this.save(value);
    void (async () => {
      try {
        await repositoryRoot(value.path);
        await prepareRepository(value.path); value.versioned = true;
        if (!repair) await rememberMain(value.path, main as string, engine as string);
        if (repair) { value.summary = await repair(value.path, previousError); Object.assign(value, await inspectPaper(value.path)); }
        value.phase = 'building'; this.save(value);
        // A retry starts a new build without forcing a clean one, so the
        // opened paper finds this PDF in the cache instead of compiling again.
        this.manuscripts.forgetProject('import-' + id);
        let result = await this.manuscripts.state('import-' + id, value.path);
        while (result.build.status === 'building') {
          value.progress = result.build.progress;
          await new Promise(resolve => setTimeout(resolve, 400)); result = await this.manuscripts.state('import-' + id, value.path);
        }
        value.phase = result.build.status === 'ready' ? 'ready' : 'failed'; value.error = result.build.error;
      } catch (error) { value.phase = 'failed'; value.error = (error as Error).message; }
      finally { this.active.delete(id); value.progress = undefined; this.save(value); }
    })();
    return this.get(id);
  }
  async finish(id: string, register: (root: string, name: string) => Promise<Project>) {
    const value = this.get(id);
    if (this.active.has(id) || !value.versioned) throw new Error('Wait for repository preparation to finish.');
    const project = await register(value.path, value.name);
    // Keep the receipt so a lost HTTP response can safely retry finalization.
    this.manuscripts.forgetProject('import-' + id); return project;
  }
}
