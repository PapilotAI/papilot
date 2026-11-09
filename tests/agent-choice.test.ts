import test from 'node:test';
import assert from 'node:assert/strict';
import { chosenAgent, noAgent, offeredAgents } from '../src/web/agent-choice.ts';
import { AGENT_IDS, type RuntimeStatus } from '../src/shared.ts';

const runtime = (installed?: boolean): RuntimeStatus => ({ connected: false, authenticated: false, account: null, error: null, models: [], ...(installed === undefined ? {} : { installed }) });

test('a desktop host without Codex offers and picks the agents it has', () => {
  assert.deepEqual(offeredAgents({}), ['codex'], 'Codex is offered until the host reports on it');
  assert.deepEqual(offeredAgents({ codex: runtime(), claude: runtime(false) }), ['codex']);
  const noCodex = offeredAgents({ codex: runtime(false), claude: runtime(true), kimi: runtime(false) });
  assert.deepEqual(noCodex, ['claude']);
  assert.equal(chosenAgent('codex', noCodex), 'claude', 'a first task does not go to a missing Codex');
  assert.equal(chosenAgent('kimi', offeredAgents({ codex: runtime(true), kimi: runtime(false) })), 'codex');
  assert.equal(chosenAgent('claude', ['codex', 'claude']), 'claude');
  assert.equal(chosenAgent('claude', []), 'codex', 'the internal fallback does not overwrite the saved choice');
});

test('no agent is reported only after every runtime is known to be missing', () => {
  assert.equal(noAgent({}), false);
  assert.equal(noAgent({ codex: runtime(false) }), false, 'unreported runtimes are still unknown');
  const runtimes = Object.fromEntries(AGENT_IDS.map(id => [id, runtime(false)]));
  assert.deepEqual(offeredAgents(runtimes), []);
  assert.equal(noAgent(runtimes), true);
  assert.equal(noAgent({ ...runtimes, claude: runtime() }), false, 'an unknown installation is not absent');
  assert.equal(noAgent({ ...runtimes, claude: runtime(true) }), false);
  assert.deepEqual(offeredAgents({ ...runtimes, claude: runtime(true) }), ['claude']);
});
