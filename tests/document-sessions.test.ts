import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Manuscripts } from '../src/server/manuscript.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { PaperTools } from '../src/server/paper-tools.ts';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { readSettings, writeSettings } from '../engine/src/core/config.ts';
import { PdfDocument } from '../engine/src/render/pdf.ts';
import type { Manuscript, ManuscriptProblems, Task } from '../src/shared.ts';

const tex = (() => { try { for (const command of ['latexmk', 'pdflatex']) execFileSync(command, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('explicit documents compile independently without changing the standalone selection', { skip: !tex, timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-document-sessions-')), root = path.join(temp, 'paper');
  fs.mkdirSync(path.join(root, 'slides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\n\\input{body}\n');
  fs.writeFileSync(path.join(root, 'body.tex'), '\\begin{document}\nOriginal paper.\n\\end{document}\n');
  fs.writeFileSync(path.join(root, 'slides/main.tex'), '\\documentclass{article}\n\\begin{document}\nSeparate slides.\\undefinedcommand\n\\end{document}\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Initial');
  writeSettings(root, { main: 'main.tex', engine: 'pdflatex', halt_on_error: false });
  const settings = readSettings(root), head = git('rev-parse', 'HEAD');
  const store = new Store(path.join(temp, 'store.sqlite')), workspace = new Workspace(store), manuscripts = new Manuscripts();
  const app = await buildApp({ store, workspace, manuscripts, csrf: 'test', serialGit: gitQueue(), dist: null, version: 'test', listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' } });
  async function api<T = any>(url: string, payload?: unknown): Promise<T> {
    const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url, headers: { host: 'localhost:7274', 'x-papilot-token': 'test' }, ...(payload === undefined ? {} : { payload: payload as any }) });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  }
  try {
    const { project } = await api('/api/projects/register', { path: root });
    const base = `/api/projects/${project.id}`;
    const document = (main?: string) => base + '/manuscript' + (main ? '?document=' + encodeURIComponent(main) : '');
    const listing = await api(base + '/files');
    assert.equal(listing.document, 'main.tex');
    assert.deepEqual(listing.files.filter((file: { root?: boolean }) => file.root).map((file: { path: string }) => file.path), ['main.tex', 'slides/main.tex']);
    const settle = async (main?: string) => {
      for (let attempt = 0; attempt < 800; attempt++) {
        const state = await api<Manuscript>(document(main));
        if (state.build.status !== 'building') { assert.equal(state.build.status, 'ready', state.build.error); return state; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Compilation timed out');
    };
    const [paper, slides] = await Promise.all([settle('main.tex'), settle('slides/main.tex')]);
    assert.equal(paper.document, 'main.tex'); assert.equal(slides.document, 'slides/main.tex');
    assert.notEqual(paper.build.key, slides.build.key);
    const paperPdf = new PdfDocument(manuscripts.pdf(project.id, paper.build.key!));
    try { assert.ok(paperPdf.page(0).search('Original paper.').length); }
    finally { paperPdf.close(); }
    const pdfResponse = await app.inject({ url: base + '/manuscript.pdf?key=' + slides.build.key, headers: { host: 'localhost:7274' } });
    assert.equal(pdfResponse.statusCode, 200, pdfResponse.body.slice(0, 300));
    assert.equal(pdfResponse.rawPayload.subarray(0, 4).toString(), '%PDF');
    // Churn historical entries as repeated saves of the other paper would.
    // Every active document must remain usable through repository-scoped routes.
    const activePdf = manuscripts.pdf(project.id, paper.build.key!);
    const history = manuscripts as unknown as { remember(id: string, key: string, pdf: string): void };
    for (let i = 0; i < 220; i++) history.remember(manuscripts.session(project.id, 'slides/main.tex'), `history-${i}`, activePdf);
    assert.equal(manuscripts.pdf(project.id, paper.build.key!), activePdf);
    assert.equal(manuscripts.documentOf(project.id, paper.build.key!), 'main.tex');
    assert.equal(manuscripts.documentOf(project.id, slides.build.key!), 'slides/main.tex');
    assert.equal(manuscripts.paperBuild(project.id, 'slides/main.tex')?.pdf, manuscripts.pdf(project.id, slides.build.key!));
    assert.deepEqual(await manuscripts.sourcePages(project.id, 'slides/main.tex', [3], 'slides/main.tex'), [1]);
    const task: Task = { id: 'slides-task', projectId: project.id, name: 'slides-task', title: 'Read slides', instructions: '', document: 'slides/main.tex', worktree: root, threadId: null, turnId: null, model: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
    store.saveTask(task);
    const reading = await new PaperTools(store, manuscripts, () => false).call(task, 'paper_read', {}, () => true) as { key: string };
    assert.equal(reading.key, slides.build.key);
    assert.equal(paper.build.problems?.errors, 0); assert.ok(slides.build.problems?.errors);
    const problems = await api<ManuscriptProblems>(base + '/manuscript/problems?document=slides%2Fmain.tex');
    assert.ok(problems.problems.some(problem => problem.severity === 'error' && problem.file === 'slides/main.tex'));
    const pdf = new PdfDocument(manuscripts.pdf(project.id, slides.build.key!));
    let rect: [number, number, number, number];
    try {
      const page = pdf.page(0), [hit] = page.search('Separate slides.'); assert.ok(hit);
      rect = [hit[0] / page.width, hit[1] / page.height, hit[2] / page.width, hit[3] / page.height];
    } finally { pdf.close(); }
    const previous = fs.readFileSync(path.join(root, 'slides/main.tex'), 'utf8');
    fs.writeFileSync(path.join(root, 'slides/main.tex'), '% External editor inserted this line.\n' + previous);
    const note = await api(base + '/annotations', { key: slides.build.key, page: 0, rect, rects: [rect], quote: 'Separate slides.', comment: 'Explain this point.' });
    assert.equal(note.document, 'slides/main.tex');
    const located = await manuscripts.locate(project.id, slides.build.key!, 0, rect, [rect], 'Separate slides.');
    assert.ok((located.source?.lines[0] ?? 0) >= 4, JSON.stringify(located.source));
    assert.equal((await settle('main.tex')).annotations.length, 0);
    assert.equal((await settle('slides/main.tex')).annotations.length, 1);
    const source = await api(base + '/manuscript/source/locate', { key: slides.build.key, page: 0, rect, rects: [rect], quote: 'Separate slides.' });
    assert.equal(source.source?.file, 'slides/main.tex');
    store.saveAnnotation({ ...note, id: 'legacy', key: paper.build.key!, document: undefined });
    store.saveAnnotation({ ...note, id: 'removed-document', key: paper.build.key!, document: 'removed.tex' });
    assert.deepEqual((await settle('slides/main.tex')).annotations.map(note => note.id), [note.id]);
    assert.equal(store.annotation(project.id, 'legacy').document, undefined);
    assert.equal(store.annotation(project.id, 'removed-document').document, 'removed.tex');
    assert.equal((await settle()).document, 'main.tex');
    fs.appendFileSync(path.join(root, 'main.tex'), '% External editor saved this file.\n');
    await Promise.all([settle('main.tex'), settle('slides/main.tex')]);
    assert.deepEqual(readSettings(root), settings);
    assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('diff', '--cached', '--name-only'), '');
    for (const file of ['body.tex', '../outside.tex']) {
      const invalid = await app.inject({ url: document(file), headers: { host: 'localhost:7274' } });
      assert.equal(invalid.statusCode, 400, file);
    }
    manuscripts.forgetProject(project.id);
    assert.equal(manuscripts.busyForProject(project.id), false);
  } finally { workspace.close(); await app.close(); await manuscripts.stop(); store.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
