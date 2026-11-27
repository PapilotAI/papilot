import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateAgentPreferences, readModelPreferences, readPermissionPreference, saveModelPreferences, savePermissionPreference } from '../src/web/agent-preferences.ts';
import type { AgentModel, RuntimeStatus } from '../src/shared.ts';

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const model: AgentModel = { id: 'deep', name: 'Deep', isDefault: true, efforts: ['low', 'high', 'xhigh'], defaultEffort: 'high' };

test('model preferences preserve explicit defaults and isolate agent/model identities', () => {
  const store = storage();
  saveModelPreferences('codex', 'deep', { effort: 'xhigh', serviceTier: 'ultrafast' }, store);
  saveModelPreferences('codex', 'fast', { effort: 'low', serviceTier: 'default' }, store);
  saveModelPreferences('claude', 'deep', { effort: '', serviceTier: 'default' }, store);
  assert.deepEqual(readModelPreferences('codex', 'deep', model, store), { effort: 'xhigh', serviceTier: 'ultrafast' });
  assert.deepEqual(readModelPreferences('codex', 'fast', undefined, store), { effort: 'low', serviceTier: 'default' });
  assert.deepEqual(readModelPreferences('claude', 'deep', model, store), { effort: '', serviceTier: 'default' });
  assert.equal(readModelPreferences('codex', 'unknown', undefined, store), null);
  store.setItem('papilot:model-preferences:["codex","deep"]', '{broken');
  assert.equal(readModelPreferences('codex', 'deep', model, store), null);
});

test('legacy choices migrate once to the selected model or resolved host default', () => {
  for (const id of ['deep', '']) {
    const store = storage();
    store.setItem('papilot:model:codex', id);
    store.setItem('papilot:effort:codex', '');
    store.setItem('papilot:fast:codex', 'true');
    migrateAgentPreferences(store);
    assert.deepEqual(readModelPreferences('codex', 'deep', model, store), { effort: '', serviceTier: 'priority' });
    assert.deepEqual(readModelPreferences('codex', 'deep', { ...model, serviceTiers: ['fast', 'ultrafast'] }, store), { effort: '', serviceTier: 'fast' });
    assert.equal(readModelPreferences('codex', 'fast', { ...model, id: 'fast', isDefault: false }, store), null);
    saveModelPreferences('codex', 'deep', { effort: 'low', serviceTier: 'default' }, store);
    migrateAgentPreferences(store);
    assert.deepEqual(readModelPreferences('codex', 'deep', model, store), { effort: 'low', serviceTier: 'default' });
  }
});

test('permissions are restored only for the matching agent and available modes', () => {
  const store = storage();
  const runtime: RuntimeStatus = { connected: true, authenticated: true, account: null, error: null, models: [], permissionOptions: [{ value: 'full', label: 'Full access', detail: '' }] };
  savePermissionPreference('codex', 'full', store);
  assert.equal(readPermissionPreference('codex', runtime, store), 'full');
  assert.equal(readPermissionPreference('claude', runtime, store), 'workspace');
  assert.equal(readPermissionPreference('codex', undefined, store), 'workspace');
  assert.equal(readPermissionPreference('codex', { ...runtime, permissionOptions: [] }, store), 'workspace');
  assert.equal(readPermissionPreference('codex', runtime, store), 'full', 'a temporary missing capability does not erase the choice');
});
