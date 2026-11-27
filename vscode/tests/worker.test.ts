import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function startWorker(t: TestContext, args: string[] = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-worker-close-'));
  const outfile = path.join(directory, 'worker.mjs');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stubs = {
    'runtime.ts': `
      import { writeFile } from 'node:fs/promises';
      import { writeFileSync } from 'node:fs';
      import { setTimeout } from 'node:timers/promises';
      export const RUNTIME_SHUTDOWN_TIMEOUT_MS = 1000;
      export const resumeTasks = () => writeFileSync('tasks-resumed', 'done');
      export const createRuntime = () => ({
        store: { tasks: () => [], recover() {}, close() {} },
        workspace: { connect() { writeFileSync('agents-connected', 'done'); }, async close() {
          await setTimeout(50);
          await writeFile('agents-closed', 'done');
        } },
        manuscripts: { async stop() {} }, changes: {},
      });`,
    'app.ts': `
      import { once } from 'node:events';
      export const gitQueue = () => {};
      export const buildApp = () => ({
        async ready() {
          if (process.argv.includes('--disconnect-during-startup')) {
            const disconnected = once(process, 'disconnect');
            process.send({ type: 'startup-waiting' });
            await disconnected;
          }
        },
        async close() {},
        async inject() {
          const disconnected = once(process, 'disconnect');
          process.send({ type: 'request-started' });
          await disconnected;
          return { statusCode: 200, headers: {}, rawPayload: Buffer.from('{}') };
        },
      });`,
    'paths.ts': 'export const DATA = process.cwd(), VERSION = "test";',
    'review.ts': 'export const reviewClient = () => {};',
  };
  await build({
    entryPoints: [fileURLToPath(new URL('../src/worker.ts', import.meta.url))],
    outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'worker-fixture', setup(bundle) {
      bundle.onResolve({ filter: /\/src\/server\/(runtime|app|paths|review)\.ts$/ }, ({ path: file }) => ({ path: path.basename(file), namespace: 'fixture' }));
      bundle.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: file }) => ({ contents: stubs[file as keyof typeof stubs] }));
    } }],
  });
  const child = fork(outfile, args, { cwd: directory, execArgv: [] });
  t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill(); });
  return { child, directory };
}

test('disconnecting the extension worker waits for agent shutdown with a request in flight', { timeout: 5000 }, async t => {
  const { child, directory } = await startWorker(t);
  const stopped = once(child, 'exit', { signal: t.signal });
  const [ready] = await once(child, 'message', { signal: t.signal });
  assert.deepEqual(ready, { type: 'ready' });
  const started = once(child, 'message', { signal: t.signal });
  child.send({ type: 'request', id: 1, method: 'GET', route: '/api/state' });
  assert.deepEqual((await started)[0], { type: 'request-started' });
  child.disconnect();
  assert.deepEqual(await stopped, [0, null]);
  assert.equal(await fs.readFile(path.join(directory, 'agents-closed'), 'utf8'), 'done');
});

test('disconnecting during startup closes services without resuming tasks or connecting agents', { timeout: 5000 }, async t => {
  const { child, directory } = await startWorker(t, ['--disconnect-during-startup']);
  const stopped = once(child, 'exit', { signal: t.signal });
  assert.deepEqual((await once(child, 'message', { signal: t.signal }))[0], { type: 'startup-waiting' });
  child.disconnect();
  assert.deepEqual(await stopped, [0, null]);
  await assert.rejects(fs.access(path.join(directory, 'tasks-resumed')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(directory, 'agents-connected')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(directory, 'agents-closed'), 'utf8'), 'done');
});
