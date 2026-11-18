import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FakeOverleaf } from './fixtures/overleaf-server.ts';
import { OverleafService, projectLink } from '../src/server/overleaf/service.ts';
import { PaperImports } from '../src/server/imports.ts';
import type { Manuscripts } from '../src/server/manuscript.ts';
import type { Project } from '../src/shared.ts';

async function until(check: () => boolean, what: string, timeout = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function setup(server: FakeOverleaf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-overleaf-service-')), root = path.join(dir, 'paper');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const projects: Project[] = [{ id: 'paper', name: 'Paper', path: root, createdAt: 1 }];
  let touched = 0;
  const service = new OverleafService(path.join(dir, 'overleaf'), { project: id => { const found = projects.find(item => item.id === id); if (!found) throw new Error('Paper project not found.'); return found; }, projects: () => projects }, () => { touched++; });
  return { dir, root, projects, service, touched: () => touched, close: async () => { await service.stop(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('Overleaf links name projects, invitations and token links on any server', () => {
  assert.deepEqual(projectLink('https://www.overleaf.com/project/0123456789ABCDEF01234567'), { origin: 'https://www.overleaf.com', overleafId: '0123456789abcdef01234567' });
  assert.deepEqual(projectLink('overleaf.com/project/0123456789abcdef01234567/share#tok'), { origin: 'https://www.overleaf.com', overleafId: '0123456789abcdef01234567', invite: 'tok' });
  assert.deepEqual(projectLink('https://latex.example.edu/project/0123456789abcdef01234567'), { origin: 'https://latex.example.edu', overleafId: '0123456789abcdef01234567' });
  assert.deepEqual(projectLink('http://localhost:8090/project/0123456789abcdef01234567'), { origin: 'http://localhost:8090', overleafId: '0123456789abcdef01234567' });
  assert.deepEqual(projectLink('https://www.overleaf.com/read/abcdefgh'), { origin: 'https://www.overleaf.com', token: '/read/abcdefgh' });
  assert.deepEqual(projectLink('https://www.overleaf.com/1234567890abcdefgh#xy'), { origin: 'https://www.overleaf.com', token: '/1234567890abcdefgh', hash: '#xy' });
  assert.deepEqual(projectLink('0123456789abcdef01234567'), { origin: 'https://www.overleaf.com', overleafId: '0123456789abcdef01234567' });
  assert.throws(() => projectLink('https://www.overleaf.com/project/0123456789abcdef01234567/share'), /incomplete/);
  assert.throws(() => projectLink('https://www.overleaf.com/learn/latex'), /link of an Overleaf project/);
  assert.throws(() => projectLink(''), /link of an Overleaf project/);
});

test('signing in checks the session, lists projects, and signing out ends only Papilot’s own session', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  try {
    await assert.rejects(t.service.signIn(server.origin, 'overleaf_session2=wrong'), /did not accept/);
    // A pasted cookie is the browser's session: signing out leaves it.
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    const pasted = server.session;
    await t.service.signOut(server.origin);
    assert.equal(server.session, pasted, 'the browser the cookie came from stays signed in');
    // The desktop window's session is Papilot's own.
    assert.deepEqual(await t.service.signIn(server.origin, `overleaf_session2=${server.session}`, true), { origin: server.origin, email: 'author@example.com' });
    assert.deepEqual(t.service.state().accounts, [{ origin: server.origin, email: 'author@example.com' }]);
    const stat = fs.statSync(path.join(t.dir, 'overleaf', 'accounts.json'));
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o077, 0, 'only the user can read the sessions');
    assert.deepEqual((await t.service.projects(server.origin)).map(item => item.name), ['Fake paper']);
    const session = server.session;
    await t.service.signOut(server.origin);
    assert.notEqual(server.session, session, 'the session ended on Overleaf');
    assert.deepEqual(t.service.state().accounts, []);
    await assert.rejects(t.service.projects(server.origin), (error: Error & { signIn?: string }) => error.signIn === server.origin);
  } finally { await t.close(); }
});

test('linking compares first, keeps the chosen version, saves the other, and joins through an invitation', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  server.addDoc('main.tex', 'Overleaf main\n');
  server.addDoc('shared.tex', 'Same\n');
  server.addFile('figs/plot.png', Buffer.from([1, 2, 3]));
  server.member = false;
  fs.writeFileSync(path.join(t.root, 'main.tex'), 'Local main\n');
  fs.writeFileSync(path.join(t.root, 'shared.tex'), 'Same\n');
  fs.writeFileSync(path.join(t.root, 'notes.tex'), 'Local only\n');
  fs.writeFileSync(path.join(t.root, 'main.pdf'), '%PDF');
  try {
    await assert.rejects(t.service.compare('paper', `${server.origin}/project/${server.projectId}`), (error: Error & { signIn?: string }) => error.signIn === server.origin);
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    const invitation = `${server.origin}/project/${server.projectId}/share#${server.invite}`;
    const comparison = await t.service.compare('paper', invitation);
    assert.equal(server.member, true, 'the invitation joined the project');
    assert.deepEqual({ ...comparison, origin: undefined, overleafId: undefined }, { name: 'Fake paper', same: 1, overleaf: ['figs/plot.png'], local: ['notes.tex'], different: ['main.tex'], origin: undefined, overleafId: undefined });
    await t.service.link('paper', invitation, 'overleaf');
    await until(() => t.service.state().syncs[0]?.state === 'synced', 'the sync');
    assert.equal(fs.readFileSync(path.join(t.root, 'main.tex'), 'utf8'), 'Overleaf main\n');
    assert.deepEqual(fs.readFileSync(path.join(t.root, 'figs/plot.png')), Buffer.from([1, 2, 3]));
    await until(() => server.text('notes.tex') === 'Local only\n', 'the upload');
    assert.ok(!server.paths().includes('main.pdf'));
    const [saved] = t.service.state().syncs[0].conflicts;
    assert.deepEqual({ path: saved.path, kind: saved.kind }, { path: 'main.tex', kind: 'file' });
    await t.service.useMine('paper', saved.id);
    await until(() => server.text('main.tex') === 'Local main\n', 'the restored version on Overleaf');
    await assert.rejects(t.service.link('paper', invitation, 'overleaf'), /already synced/);
    // A synced paper moves to another project in one step, compared first.
    const other = await new FakeOverleaf().start();
    try {
      other.addDoc('main.tex', 'Other main\n');
      await t.service.signIn(other.origin, `overleaf_session2=${other.session}`);
      const elsewhere = `${other.origin}/project/${other.projectId}`;
      await assert.rejects(t.service.compare('paper', elsewhere), /already synced/);
      await assert.rejects(t.service.compare('paper', invitation, true), /already syncs with this/);
      assert.deepEqual((await t.service.compare('paper', elsewhere, true)).different, ['main.tex']);
      await t.service.link('paper', elsewhere, 'local', true);
      await until(() => t.service.state().syncs[0]?.overleafId === other.projectId && t.service.state().syncs[0].state === 'synced', 'the sync with the other project');
      assert.equal(t.service.state().syncs.length, 1);
      await until(() => server.clients.size === 0, 'the first project left');
      await until(() => other.text('main.tex') === 'Local main\n' && other.text('notes.tex') === 'Local only\n', 'the paper on the other project');
      t.service.unlink('paper');
    } finally { await other.stop(); }
    assert.deepEqual(t.service.state().syncs, []);
    assert.equal(fs.readFileSync(path.join(t.root, 'main.tex'), 'utf8'), 'Local main\n', 'unlinking leaves the files');
  } finally { await t.close(); }
});

test('signing in as another account reconnects active syncs with that account’s access', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  server.addDoc('main.tex', 'Shared main\n');
  fs.writeFileSync(path.join(t.root, 'main.tex'), 'Shared main\n');
  try {
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    await t.service.link('paper', `${server.origin}/project/${server.projectId}`, 'local');
    await until(() => t.service.state().syncs[0]?.state === 'synced', 'the original account’s sync');
    const [previousClient] = server.clients;
    assert.ok(previousClient);

    // The second account can sign in, but is not a member of this project.
    // A connection opened under the first account is still authorized until
    // Papilot closes it, as an existing browser tab would be.
    server.userId = '0123456789abcdef01234567';
    server.session = 'second-account-session';
    server.member = false;
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    await until(() => !server.clients.has(previousClient), 'the previous account’s connection to close');
    await until(() => t.service.state().syncs[0]?.state === 'no-access', 'the new account’s project access');
    assert.equal(t.service.store.account(server.origin)?.userId, server.userId);
    assert.equal(server.text('main.tex'), 'Shared main\n');
    assert.equal(fs.readFileSync(path.join(t.root, 'main.tex'), 'utf8'), 'Shared main\n');

    // Granting the new account access resumes the existing link and files.
    server.member = true;
    t.service.retry('paper');
    await until(() => t.service.state().syncs[0]?.state === 'synced', 'the new account’s sync');
    fs.writeFileSync(path.join(t.root, 'main.tex'), 'Second account edit\n');
    await until(() => server.text('main.tex') === 'Second account edit\n', 'the new account’s edit');
  } finally { await t.close(); }
});

test('prepared imports can be abandoned or resumed but only one can start a sync', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  server.addDoc('main.tex', 'Shared main\n');
  const other = path.join(t.dir, 'other');
  fs.mkdirSync(other);
  t.projects.push({ id: 'other', name: 'Other paper', path: other, createdAt: 1 });
  try {
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    const url = `${server.origin}/project/${server.projectId}`;
    const imported = await t.service.download(url, t.root);
    // Choosing different files leaves a resumable receipt. It must not
    // permanently reserve a project that is not synced to any paper yet.
    const another = await t.service.download(url, other);
    t.service.attach(imported.linkId, 'paper');
    await until(() => t.service.state().syncs[0]?.state === 'synced', 'the imported paper’s sync');
    const sync = t.service.sync('paper');
    t.service.attach(imported.linkId, 'paper');
    assert.equal(t.service.sync('paper'), sync, 'a retried finalize receipt keeps the active sync');
    assert.throws(() => t.service.attach(another.linkId, 'other'), /Another paper is already synced/);
    await assert.rejects(t.service.download(url, other), /Another paper is already synced/);
    await assert.rejects(t.service.link('other', url, 'local'), /Another paper is already synced/);
    t.service.discard(another.linkId);
    assert.equal(t.service.store.links().length, 1);
    assert.equal(t.service.state().syncs.length, 1);
  } finally { await t.close(); }
});

test('concurrent links and imports cannot claim the same Overleaf project twice', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  server.addDoc('main.tex', 'Shared main\n');
  const other = path.join(t.dir, 'other');
  fs.mkdirSync(other);
  t.projects.push({ id: 'other', name: 'Other paper', path: other, createdAt: 1 });
  try {
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    const url = `${server.origin}/project/${server.projectId}`;
    const imports = await Promise.allSettled([t.service.download(url, t.root), t.service.download(url, other)]);
    assert.equal(imports.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(imports.filter(result => result.status === 'rejected').length, 1);
    for (const result of imports) if (result.status === 'fulfilled') t.service.discard(result.value.linkId);
    assert.equal(t.service.store.links().length, 0, 'discarding releases the import’s reservation');

    const links = await Promise.allSettled([t.service.link('paper', url, 'overleaf'), t.service.link('other', url, 'overleaf')]);
    assert.equal(links.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(links.filter(result => result.status === 'rejected').length, 1);
    assert.equal(t.service.store.links().length, 1);
    assert.equal(t.service.state().syncs.length, 1);
  } finally { await t.close(); }
});

test('finalizing an import reserves the project before registration and releases failed attempts', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  server.addDoc('main.tex', 'Shared main\n');
  const other = path.join(t.dir, 'other');
  fs.mkdirSync(other);
  t.projects.push({ id: 'other', name: 'Other paper', path: other, createdAt: 1 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
    const url = `${server.origin}/project/${server.projectId}`;
    const first = await t.service.download(url, t.root), second = await t.service.download(url, other);
    await assert.rejects(t.service.finishImport(first.linkId, async () => { throw new Error('Registration failed'); }), /Registration failed/);
    let registrations = 0, competingRegistrations = 0;
    const finish = t.service.finishImport(first.linkId, async () => { registrations++; await gate; return t.projects[0]; });
    const retry = t.service.finishImport(first.linkId, async () => { registrations++; return t.projects[0]; });
    await assert.rejects(t.service.finishImport(second.linkId, async () => { competingRegistrations++; return t.projects[1]; }), /Another paper is already synced/);
    assert.equal(competingRegistrations, 0, 'the competing paper is never registered');
    release();
    assert.equal(await finish, await retry);
    assert.equal(registrations, 1, 'a duplicate in-flight receipt shares registration');
    await until(() => t.service.state().syncs[0]?.state === 'synced', 'the finalized sync');
    const sync = t.service.sync('paper');
    assert.equal(await t.service.finishImport(first.linkId, async () => t.projects[0]), t.projects[0]);
    assert.equal(t.service.sync('paper'), sync, 'a retried completed receipt keeps its sync');
  } finally { release(); await t.close(); }
});

test('an import downloads the project at its own paths and syncs once the paper is added', async () => {
  const server = await new FakeOverleaf().start(), t = setup(server);
  // A project with a single top folder stays as it is: paths must match.
  server.addDoc('paper/main.tex', '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n');
  server.addDoc('paper/appendix.tex', '\\documentclass{article}\n\\begin{document}\nMore\n\\end{document}\n');
  server.rootDoc = 'paper/main.tex'; server.compiler = 'xelatex';
  await t.service.signIn(server.origin, `overleaf_session2=${server.session}`);
  const manuscripts = { forgetProject() {}, state: async () => ({ build: { status: 'ready' } }) } as unknown as Manuscripts;
  const imports = new PaperImports(manuscripts, path.join(t.dir, 'data'), root => t.projects.some(project => project.path === root));
  imports.overleaf = { download: (url, root) => t.service.download(url, root), finish: (link, register) => t.service.finishImport(link, register), discard: link => t.service.discard(link) };
  try {
    const draft = await imports.create({ url: `${server.origin}/project/${server.projectId}`, sync: true });
    assert.ok(draft.overleaf);
    assert.equal(draft.name, 'Fake paper');
    assert.ok(fs.existsSync(path.join(draft.path, 'paper/main.tex')));
    assert.deepEqual({ main: draft.main, engine: draft.engine }, { main: 'paper/main.tex', engine: 'xelatex' }, 'Overleaf’s main document and compiler');
    assert.equal(imports.holdsLink(draft.overleaf!), true);
    await imports.build(draft.id, {});
    await until(() => !imports.busy, 'the imported repository to be prepared');
    assert.equal(imports.get(draft.id).phase, 'ready', imports.get(draft.id).error);
    const register = async (root: string, name: string) => {
      const existing = t.projects.find(project => project.path === root);
      if (existing) return existing;
      const project = { id: 'imported', name, path: root, createdAt: 2 };
      t.projects.push(project);
      return project;
    };
    const imported = await imports.finish(draft.id, register);
    await until(() => t.service.state().syncs.some(sync => sync.projectId === 'imported' && sync.state === 'synced'), 'the attached sync');
    const sync = t.service.sync(imported.id);
    assert.equal(await imports.finish(draft.id, register), imported, 'a lost finalize response can retry its receipt');
    assert.equal(t.service.sync(imported.id), sync);
    assert.equal(imports.holdsLink(draft.overleaf!), false);
    fs.writeFileSync(path.join(draft.path, 'paper/main.tex'), '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n');
    await until(() => server.text('paper/main.tex')!.includes('Hello'), 'the edit after import');
    // A failed download leaves no link behind.
    await assert.rejects(imports.create({ url: `${server.origin}/project/${'f'.repeat(24)}`, sync: true }));
    assert.equal(t.service.store.links().filter(link => !link.projectId).length, 0);
  } finally { await t.close(); }
});
