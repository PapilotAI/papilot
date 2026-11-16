import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA } from './paths.ts';
import { prepareRepository, rememberMain } from './imports.ts';
import { realPath } from './real-path.ts';
import type { Project } from '../shared.ts';
import { templateChoice, type TemplateChoice, type Universe, type UniverseTemplate } from './universe.ts';

// Keep the starter independent of the display name: names may contain Unicode
// or TeX commands, while this document compiles with a minimal pdfLaTeX setup.
export const NEW_PAPER_SOURCE = String.raw`\documentclass[11pt]{article}

\title{Your paper title}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Write a short summary of your paper here.
\end{abstract}

\section{Introduction}
Start writing here. You can edit this source in Papilot or ask an agent to help draft your paper.

\section{Conclusion}
Summarize your findings and next steps here.

\end{document}
`;
const ignores = '*.aux\n*.log\n*.fls\n*.fdb_latexmk\n*.synctex.gz\n*.toc\n*.out\nmain.pdf\n.DS_Store\n';
type Input = { id?: unknown; name?: unknown; parent?: unknown; template?: unknown };
type Receipt = { id: string; name: string; parent: string; root: string; dev: number; ino: number; prepared: boolean; template?: TemplateChoice & { sha256: string } };
const blank = () => new Map<string, string | Buffer>([['main.tex', NEW_PAPER_SOURCE], ['.gitignore', ignores]]);
// Every file in the folder is a starter file nobody has edited since it was written.
function untouched(root: string, starter: Map<string, string | Buffer>) {
  const walk = (relative: string): boolean => fs.readdirSync(path.join(root, relative), { withFileTypes: true }).every(entry => {
    const file = relative ? relative + '/' + entry.name : entry.name, target = path.join(root, file);
    if (entry.isDirectory()) return file !== '.git' && walk(file);
    const expected = starter.get(file);
    return expected !== undefined && entry.isFile() && fs.readFileSync(target).equals(Buffer.from(expected));
  });
  return walk('');
}

export function newPaperName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('Enter a paper name under 120 characters.');
  const name = value.trim();
  // The name is also a directory name. Keep projects portable between native
  // Windows, WSL and Unix, including Windows device names with extensions.
  if (/[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('Choose a paper name that is a valid folder name.');
  return name;
}
export class PaperCreations {
  private pending = new Map<string, { key: string; work: Promise<Project> }>();
  get busy() { return this.pending.size > 0; }
  constructor(private directory = DATA, private universe?: Universe) {}
  defaults() { return { parent: os.homedir() }; }
  async create(input: Input, register: (root: string, name: string) => Promise<Project>) {
    if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) throw new Error('Invalid paper creation ID.');
    const id = input.id, name = newPaperName(input.name), template = templateChoice(input.template);
    if (template && !this.universe) throw new Error('Templates are not available here.');
    if (typeof input.parent !== 'string' || !input.parent.trim() || input.parent.length > 4000 || /[\x00-\x1f]/.test(input.parent)) throw new Error('Choose an existing folder to save the paper in.');
    const expanded = input.parent.trim().replace(/^~(?=$|[\/\\])/, os.homedir());
    if (!path.isAbsolute(expanded)) throw new Error('Enter an absolute folder path on the computer running Papilot.');
    let parent: string;
    try { parent = realPath(expanded); if (!fs.statSync(parent).isDirectory()) throw new Error(); }
    catch { throw new Error('Choose an existing folder to save the paper in.'); }
    const key = JSON.stringify([name, parent, template ? template.id + '@' + template.version : '']), running = this.pending.get(id);
    if (running) {
      if (running.key !== key) throw new Error('This creation request already belongs to another paper.');
      return running.work;
    }
    const work = this.prepare(id, name, parent, template, register);
    this.pending.set(id, { key, work });
    try { return await work; } finally { this.pending.delete(id); }
  }
  private async prepare(id: string, name: string, parent: string, template: TemplateChoice | undefined, register: (root: string, name: string) => Promise<Project>) {
    const folder = path.join(this.directory, 'paper-creations'), receiptFile = path.join(folder, id + '.json'), root = path.join(parent, name);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    let receipt: Receipt;
    const save = () => { fs.writeFileSync(receiptFile + '.tmp', JSON.stringify(receipt), { mode: 0o600 }); fs.renameSync(receiptFile + '.tmp', receiptFile); };
    const saved = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) as Receipt : undefined;
    if (saved && (saved.name !== name || saved.parent !== parent || saved.root !== root || saved.template?.id !== template?.id || saved.template?.version !== template?.version)) throw new Error('This creation request already belongs to another paper.');
    // Download before touching the disk, so an offline attempt leaves nothing behind.
    let starter = blank(), chosen: UniverseTemplate | undefined;
    if (template && !saved?.prepared) {
      const downloaded = await this.universe!.download(template, saved?.template?.sha256);
      chosen = downloaded.template;
      starter = new Map<string, string | Buffer>(downloaded.files);
      if (!starter.has('.gitignore')) starter.set('.gitignore', ignores);
    }
    if (saved) {
      receipt = saved;
      if (!owned()) throw new Error('The created folder has moved or changed. Open it as an existing paper, or choose another name.');
    } else {
      try { fs.mkdirSync(root, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A file or folder with this paper name already exists. Choose another name.');
        throw new Error('Could not create the paper folder. Check the save location and its permissions.');
      }
      const stat = fs.lstatSync(root);
      receipt = { id, name, parent, root, dev: stat.dev, ino: stat.ino, prepared: false, ...(chosen ? { template: { id: chosen.id, version: chosen.version, sha256: chosen.archive.sha256 } } : {}) };
      try { save(); } catch (error) { fs.rmdirSync(root); throw error; }
    }
    function owned() {
      try { const stat = fs.lstatSync(root); return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === receipt.dev && stat.ino === receipt.ino; } catch { return false; }
    }
    if (!receipt.prepared) {
      try {
        // A restart can resume its own partially prepared folder, but never
        // replace files. Only a receipt matching this directory allows resume.
        for (const [file, contents] of starter) {
          const target = path.join(root, file);
          fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
          try { fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o600 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        await prepareRepository(root, chosen ? `Create paper from ${chosen.name} (${chosen.id} ${chosen.version}) in Papilot` : 'Create paper in Papilot');
        if (chosen) await rememberMain(root, chosen.main, chosen.engine);
        receipt.prepared = true; save();
      } catch (error) {
        // Directory ownership does not imply ownership of everything inside:
        // the author may have edited a file after an interrupted attempt. Only
        // undo untouched starter files before Git initialized; keep all other
        // partial repositories and the receipt so retry resumes them in place.
        let removed = false;
        if (owned() && untouched(root, starter)) {
          fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(receiptFile, { force: true }); removed = true;
        }
        const missingGit = (error as NodeJS.ErrnoException).code === 'ENOENT' && (error as NodeJS.ErrnoException).syscall?.includes('spawn');
        if (removed && missingGit) throw new Error('Install Git on the computer running Papilot, then retry creating the paper.');
        const message = missingGit
          ? 'Install Git on the computer running Papilot, then retry creating the paper.' : (error as Error).message;
        throw new Error(removed ? message : `${message} Paper files were kept at ${root}. Retry creation to continue.`);
      }
    }
    // Keep the prepared receipt on registration failure, a lost response or a
    // server restart. Retrying registers this same repository without rewriting
    // the author's source, and addProject returns an existing registration.
    return register(root, name);
  }
}
