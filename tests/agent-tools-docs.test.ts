import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAPER_TOOLS } from '../src/server/paper-tools.ts';

test('the agent tools page documents every tool agents receive', () => {
  const page = fs.readFileSync('docs/agent-tools.md', 'utf8');
  const missing = PAPER_TOOLS.map(tool => tool.name).filter(name => !page.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});
