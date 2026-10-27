import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DATA, ENGINE } from './paths.ts';
import type { GitStatus, ManuscriptBuild } from '../shared.ts';

const exec = promisify(execFile);
async function git(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return (await exec('git', args, { cwd: root, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 })).stdout;
}

// Porcelain v2 keeps paths with spaces intact under -z and reports branch,
// upstream and ahead/behind counts without a second command.
export function parseStatus(output: string, numstat: string): Omit<GitStatus, 'head'> {
  const lines = new Map<string, [number, number]>();
  const stats = numstat.split('\0');
  for (let i = 0; i < stats.length; i++) {
    const [added, deleted, file] = stats[i].split('\t');
    if (!added) continue;
    // A rename lists an empty path followed by the old and new paths.
    const target = file || (i += 2, stats[i]);
    if (target && added !== '-') lines.set(target, [Number(added), Number(deleted)]);
  }
  const status: Omit<GitStatus, 'head'> = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.startsWith('# branch.head ')) status.branch = field.slice(14) === '(detached)' ? null : field.slice(14);
    else if (field.startsWith('# branch.upstream ')) status.upstream = field.slice(18);
    else if (field.startsWith('# branch.ab ')) { const [ahead, behind] = field.slice(12).split(' '); status.ahead = Number(ahead); status.behind = -Number(behind); }
    else if (field.startsWith('? ')) status.files.push({ path: field.slice(2), status: '?', staged: false });
    else if (/^[12u] /.test(field)) {
      const parts = field.split(' '), xy = parts[1], kind = field[0];
      const file = parts.slice(kind === '1' ? 8 : kind === '2' ? 9 : 10).join(' ');
      if (kind === '2') i++;
      const code = kind === 'u' ? 'U' : xy[1] !== '.' ? xy[1] : xy[0];
      status.files.push({ path: file, status: code, staged: xy[0] !== '.', lines: lines.get(file) });
    }
  }
  return status;
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const [status, numstat, head] = await Promise.all([
    git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
    git(root, ['diff', '--numstat', '-z', 'HEAD']).catch(() => ''),
    git(root, ['log', '-1', '--format=%h%x00%s%x00%ct']).catch(() => ''),
  ]);
  const [hash, subject, time] = head.trim().split('\0');
  return { ...parseStatus(status, numstat), head: hash ? { hash, subject, date: Number(time) * 1000 } : null };
}

// The preview shows the manuscript as it is on disk, including accepted but
// uncommitted review changes. A temporary index records it as a Git tree
// without touching the real index, branches or files.
export async function workingTree(root: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-index-')), env = { GIT_INDEX_FILE: path.join(folder, 'index') };
  try {
    await git(root, ['read-tree', 'HEAD'], env);
    await git(root, ['add', '-A'], env);
    return (await git(root, ['write-tree'], env)).trim();
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

async function engine() {
  const [{ Builder }, { Repo }, { loadProject }, { mupdf }] = await Promise.all([
    import(pathToFileURL(path.join(ENGINE, 'src/core/build.ts')).href),
    import(pathToFileURL(path.join(ENGINE, 'src/core/git.ts')).href),
    import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href),
    import(pathToFileURL(path.join(ENGINE, 'src/render/pdf.ts')).href),
  ]);
  return { Builder, Repo, loadProject, mupdf };
}

interface Build { tree: string; status: ManuscriptBuild['status']; key?: string; pdf?: string; pages?: [number, number][]; builtAt?: number; error?: string }

export class Manuscripts extends EventEmitter {
  private builds = new Map<string, Build>();
  private documents = new Map<string, { key: string; document: any }>();

  async state(projectId: string, root: string, rebuild = false): Promise<{ git: GitStatus; build: ManuscriptBuild }> {
    const [status, tree] = await Promise.all([gitStatus(root), workingTree(root)]);
    let build = this.builds.get(projectId);
    if (!build || (build.status !== 'building' && (build.tree !== tree || (rebuild && build.status === 'failed')))) build = this.start(projectId, root, tree, build);
    const { status: state, key, pages, builtAt, error } = build;
    return { git: status, build: { status: state, key, pages, builtAt, error, current: build.tree === tree && state === 'ready' } };
  }

  // Keep the previous pages visible while a newer working tree compiles.
  private start(projectId: string, root: string, tree: string, previous?: Build) {
    const build: Build = { tree, status: 'building', key: previous?.key, pdf: previous?.pdf, pages: previous?.pages, builtAt: previous?.builtAt };
    this.builds.set(projectId, build);
    void (async () => {
      try {
        const { Builder, Repo, loadProject, mupdf } = await engine();
        const result = await new Builder(loadProject(root), new Repo(root)).build(tree, ['full']);
        const document = mupdf.Document.openDocument(fs.readFileSync(result.pdf), 'application/pdf');
        const pages: [number, number][] = [];
        for (let i = 0; i < document.countPages(); i++) { const [x0, y0, x1, y1] = document.loadPage(i).getBounds(); pages.push([Math.round(x1 - x0), Math.round(y1 - y0)]); }
        const key = createHash('sha256').update(result.key + result.pdf).digest('hex').slice(0, 16);
        if (this.builds.get(projectId) !== build) return;
        this.documents.set(projectId, { key, document });
        Object.assign(build, { status: 'ready', key, pdf: result.pdf, pages, builtAt: Date.now(), error: undefined });
      } catch (error) {
        if (this.builds.get(projectId) !== build) return;
        const detail = error as { message?: string; details?: string[] };
        Object.assign(build, { status: 'failed', error: [detail.message, ...(detail.details || [])].filter(Boolean).join('\n') || 'The manuscript could not be compiled.' });
      }
      this.emit('change', projectId);
    })();
    return build;
  }

  pdf(projectId: string, key: string) {
    const build = this.builds.get(projectId);
    if (!build?.pdf || build.key !== key) throw Object.assign(new Error('This manuscript preview is out of date. Refresh it and try again.'), { statusCode: 404 });
    return build.pdf;
  }

  // Pages render on demand at twice the PDF resolution and stay cached per build.
  async page(projectId: string, key: string, number: number) {
    const file = path.join(DATA, 'manuscripts', projectId, key, `${number}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const build = this.builds.get(projectId), open = this.documents.get(projectId);
    if (!build?.pages || build.key !== key || open?.key !== key || !Number.isInteger(number) || number < 0 || number >= build.pages.length)
      throw Object.assign(new Error('This page is not part of the current manuscript preview.'), { statusCode: 404 });
    const { mupdf } = await engine();
    const pixmap = open.document.loadPage(number).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    const png = Buffer.from(pixmap.asPNG());
    pixmap.destroy?.();
    const folder = path.dirname(file);
    if (!fs.existsSync(folder)) {
      // Only the latest preview of each paper keeps rendered pages on disk.
      fs.rmSync(path.dirname(folder), { recursive: true, force: true });
      fs.mkdirSync(folder, { recursive: true });
    }
    fs.writeFileSync(file, png);
    return png;
  }
}
