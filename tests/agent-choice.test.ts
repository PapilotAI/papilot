import test from 'node:test';
import assert from 'node:assert/strict';
import { agentOff, agentsSettled, chosenAgent, defaultOfferedModel, noAgent, offeredAgents, shownModels } from '../src/web/agent-choice.ts';
import { AGENT_IDS, type RuntimeStatus } from '../src/shared.ts';

const runtime = (installed?: boolean): RuntimeStatus => ({ connected: false, authenticated: false, account: null, error: null, models: [], ...(installed === undefined ? {} : { installed }) });

test('a desktop host without Codex offers and picks the agents it has', () => {
  assert.deepEqual(offeredAgents({}), [], 'agents are offered only after the host reports on them');
  assert.deepEqual(offeredAgents({ codex: runtime() }), ['codex'], 'older servers report only the Codex runtime');
  for (const id of AGENT_IDS) assert.deepEqual(offeredAgents({ [id]: { ...runtime(), hidden: false } }), [id]);
  assert.deepEqual(offeredAgents({ codex: runtime(), claude: runtime(false) }), ['codex']);
  const runtimes = { codex: runtime(false), claude: runtime(true), kimi: runtime(false) };
  const noCodex = offeredAgents(runtimes);
  assert.deepEqual(noCodex, ['claude']);
  assert.equal(chosenAgent('codex', noCodex, runtimes), 'claude', 'a first task does not go to a missing Codex');
  const onlyCodex = { codex: runtime(true), kimi: runtime(false) };
  assert.equal(chosenAgent('kimi', offeredAgents(onlyCodex), onlyCodex), 'codex');
  assert.equal(chosenAgent('claude', ['codex', 'claude'], runtimes), 'claude');
  assert.equal(chosenAgent('claude', [], runtimes), 'codex', 'the internal fallback does not overwrite the saved choice');
});

test('automatic agent choice waits for every reported runtime to settle', () => {
  const ready = { ...runtime(true), connected: true, authenticated: true };
  const runtimes = { codex: runtime(true), claude: ready, kimi: runtime(false) };
  const offered = offeredAgents(runtimes);
  assert.equal(agentsSettled({}), false);
  assert.equal(agentsSettled(runtimes), false);
  assert.equal(chosenAgent(null, offered, runtimes), 'codex', 'another ready agent does not change the choice during startup');
  assert.equal(chosenAgent(null, ['claude', 'codex'], runtimes), 'claude', 'startup follows the offered order');
  assert.equal(chosenAgent(null, [], {}), 'codex');
  assert.equal(chosenAgent('claude', offered, runtimes), 'claude', 'a saved choice wins during startup');
  assert.equal(agentsSettled({ codex: runtime(false) }), true, 'missing installations have settled');
  assert.equal(agentsSettled({ codex: { ...runtime(true), connected: true } }), true, 'authentication is not required to settle');
});

test('once settled, the first connected and authenticated agent is chosen unless a choice is saved', () => {
  const ready = { ...runtime(true), connected: true, authenticated: true };
  const runtimes = { codex: { ...runtime(true), error: 'Failed to start' }, claude: ready, kimi: ready };
  const offered = offeredAgents(runtimes);
  assert.equal(agentsSettled(runtimes), true);
  assert.equal(chosenAgent(null, offered, runtimes), 'claude', 'a fresh install skips a broken Codex');
  assert.equal(chosenAgent('codex', offered, runtimes), 'codex', 'an explicit choice wins even when it is not ready');
  assert.equal(chosenAgent('grok', offered, runtimes), 'claude', 'a missing saved agent falls back to a ready one');
  const notReady = { codex: runtimes.codex, claude: { ...ready, authenticated: false } };
  assert.equal(agentsSettled(notReady), true);
  assert.equal(chosenAgent(null, ['codex', 'claude'], notReady), 'codex', 'nothing ready falls back to the first offered');
  assert.equal(chosenAgent(null, ['claude', 'codex'], notReady), 'claude', 'fallback respects the offered order');
  assert.equal(chosenAgent(null, [], runtimes), 'codex', 'only offered agents can be chosen');
  const initial = { codex: ready, claude: ready };
  const saved = chosenAgent(null, offeredAgents(initial), initial);
  assert.equal(saved, 'codex');
  assert.equal(chosenAgent(saved, offered, runtimes), 'codex', 'saving the automatic choice preserves it after a crash');
});

test('the automatic choice prefers a checked sign-in and still lets authors use ZCode', () => {
  const ready = { ...runtime(true), connected: true, authenticated: true };
  const zcode = { ...ready, authenticationUnchecked: true as const };
  const runtimes = { zcode, qwen: ready };
  const offered = offeredAgents(runtimes);
  assert.deepEqual(offered, ['zcode', 'qwen']);
  assert.equal(chosenAgent(null, offered, runtimes), 'qwen');
  assert.equal(chosenAgent('zcode', offered, runtimes), 'zcode');
  assert.equal(chosenAgent(null, ['zcode'], { zcode }), 'zcode');
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
  assert.equal(noAgent({ papilot: runtime(false) }, ['papilot']), true, 'restricted hosts report no agent once all allowed agents are missing');
  assert.equal(noAgent({ papilot: runtime(true) }, ['papilot']), false);
});

test('agents turned off are not offered, and hidden models leave the pickers except the current choice', () => {
  const ready = { ...runtime(true), connected: true, authenticated: true };
  const runtimes = { codex: { ...ready, hidden: true }, claude: ready, collaboration: { ...ready, hidden: false } };
  assert.equal(agentOff('codex', runtimes), true);
  assert.equal(agentOff('claude', runtimes), false);
  assert.equal(agentOff('collaboration', {}), true, 'collaboration mode stays opt-in');
  assert.deepEqual(offeredAgents(runtimes), ['claude', 'collaboration']);
  assert.equal(chosenAgent('codex', offeredAgents(runtimes), runtimes), 'claude', 'a saved agent that is off falls back to one that is on');
  const missing = Object.fromEntries(AGENT_IDS.map(id => [id, runtime(false)]));
  assert.equal(noAgent({ ...missing, codex: { ...ready, hidden: true } }), true, 'nothing to offer when every agent is off or missing');
  assert.equal(noAgent({ ...missing, codex: ready }), false);
  const model = (id: string, isDefault = false) => ({ id, name: id, isDefault, efforts: [], defaultEffort: null });
  const codex = { ...ready, models: [model('sol', true), model('luna'), model('nova')], hiddenModels: ['sol', 'luna'] };
  assert.deepEqual(shownModels(codex).map(item => item.id), ['nova'], 'the default model can be hidden too');
  assert.equal(defaultOfferedModel(codex)?.id, 'nova', 'a hidden default falls back to the first shown model');
  assert.equal(defaultOfferedModel({ ...codex, hiddenModels: undefined })?.id, 'sol', 'an unhidden default is kept');
  assert.equal(defaultOfferedModel({ ...ready, models: [model('sol'), model('luna')] }), undefined, 'an unknown host default is not guessed');
  assert.deepEqual(shownModels(codex, 'luna').map(item => item.id), ['luna', 'nova'], 'a model already chosen stays selectable');
  assert.deepEqual(shownModels({ ...codex, hiddenModels: ['sol', 'luna', 'nova'] }), []);
  assert.deepEqual(shownModels({ ...codex, hiddenModels: undefined }).map(item => item.id), ['sol', 'luna', 'nova']);
  assert.deepEqual(shownModels(undefined), []);
});
