import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [script, ...args] = process.argv.slice(2);
const directory = mkdtempSync(path.join(tmpdir(), 'papilot-test-worktrees-'));
try {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script, '--', ...args], {
    // Tests never read or write the author's own writing memory.
    env: { ...process.env, PAPILOT_WORKTREES: directory, PAPILOT_MEMORY: path.join(directory, 'memory.md') },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
}
