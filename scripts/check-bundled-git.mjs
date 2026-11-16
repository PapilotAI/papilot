import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Called by every native packaged smoke check, including the relocated
// AppImage/deb. No host Git or user Git configuration can satisfy this check.
export async function checkBundledGit(resources) {
  const { withBundledGit } = await import(pathToFileURL(path.resolve('.desktop/app/git.js')).href);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-bundled-git-'));
  const root = path.join(resources, 'server'), git = path.join(resources, 'runtime/git');
  const node = path.join(resources, 'runtime/bin', process.platform === 'win32' ? 'node.exe' : 'node');
  try {
    const inherited = { ...process.env, PATH: '', HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory,
      PAPILOT_DATA: path.join(directory, 'data'), PAPILOT_UPDATE_PROBE: '1' };
    for (const key of Object.keys(inherited)) if ((key.toLowerCase() === 'path' && key !== 'PATH') || /^(GIT_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)) delete inherited[key];
    inherited.GIT_CONFIG_GLOBAL = path.join(directory, 'empty-config');
    // The POSIX distribution includes /etc/gitconfig so users keep their
    // system settings. Redirect only that include in this disposable copy.
    inherited.GIT_CONFIG_SYSTEM = path.join(directory, 'system-config');
    fs.writeFileSync(inherited.GIT_CONFIG_SYSTEM, fs.readFileSync(path.join(git, 'etc/gitconfig'), 'utf8')
      .replace(/^\s*path=\/etc\/gitconfig$/m, '  path=' + JSON.stringify(path.join(directory, 'host-config'))));
    assert.throws(() => execFileSync('git', ['--version'], { env: inherited, stdio: 'pipe' }), 'The fixture has no host Git');
    const env = await withBundledGit(inherited, git);
    assert.notEqual(env, inherited, 'The installer must contain Git');
    assert.match(execFileSync('git', ['--version'], { env, encoding: 'utf8' }), /^git version /);
    assert.ok(execFileSync('git', ['--exec-path'], { env, encoding: 'utf8' }).trim().startsWith(git));
    const result = execFileSync(node, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
      '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { PaperCreations } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/server/create-paper.ts')).href)};
      import { Repo } from ${JSON.stringify(pathToFileURL(path.join(root, 'engine/src/core/git.ts')).href)};
      import { gitCommit } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/server/manuscript.ts')).href)};
      const parent = ${JSON.stringify(directory)};
      const paper = await new PaperCreations(path.join(parent, 'data')).create({ id: crypto.randomUUID(), name: '论文 draft', parent },
        async (root, name) => ({ id: crypto.randomUUID(), name, path: root, createdAt: Date.now() }));
      const repo = new Repo(paper.path), before = repo.rev('HEAD');
      const file = path.join(paper.path, 'main.tex');
      fs.appendFileSync(file, '\\n% snapshot from bundled Git\\n');
      const snapshot = repo.snapshot();
      assert.notEqual(snapshot, before);
      assert.equal(repo.rev('HEAD'), before, 'A snapshot leaves the manuscript history alone');
      await repo.export(snapshot, '', path.join(parent, 'export'));
      assert.equal(fs.readFileSync(path.join(parent, 'export/main.tex'), 'utf8'), fs.readFileSync(file, 'utf8'));
      const task = path.join(parent, 'task');
      repo.run(['worktree', 'add', '--detach', task, snapshot]);
      assert.equal(new Repo(task).rev('HEAD'), snapshot);
      repo.run(['worktree', 'remove', '--force', task]);
      // This transport spawns git-upload-pack through the relocated exec path.
      repo.run(['clone', '--no-local', paper.path, path.join(parent, 'clone')]);
      assert.equal(new Repo(path.join(parent, 'clone')).rev('HEAD'), before);
      await gitCommit(paper.path, 'Save with default identity', ['main.tex']);
      assert.equal(repo.text(['log', '-1', '--format=%an <%ae>']), 'Papilot <papilot@localhost>');
      repo.run(['config', '--global', 'user.name', 'Global Author']);
      repo.run(['config', '--global', 'user.email', 'global@example.test']);
      fs.appendFileSync(file, '\\n% global author\\n');
      await gitCommit(paper.path, 'Save with global identity', ['main.tex']);
      assert.equal(repo.text(['log', '-1', '--format=%an <%ae>']), 'Global Author <global@example.test>');
      repo.run(['config', 'user.name', 'Manuscript Author']);
      repo.run(['config', 'user.email', 'author@example.test']);
      fs.appendFileSync(file, '\\n% configured author\\n');
      await gitCommit(paper.path, 'Save with configured identity', ['main.tex']);
      assert.equal(repo.text(['log', '-1', '--format=%an <%ae>']), 'Manuscript Author <author@example.test>');
      console.log('Bundled Git: new paper, snapshot, export, worktree, clone and default/configured authors passed.');
    `], { env, cwd: directory, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    console.log(result.trim());
  } finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); }
}
