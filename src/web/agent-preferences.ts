import { useSyncExternalStore } from 'react';
import { AGENT_IDS, type AgentId, type AgentModel, type RuntimeStatus, type TaskPermissions } from '../shared.ts';
import { browserStorage } from './storage.ts';

type Storage = Pick<typeof browserStorage, 'getItem' | 'setItem' | 'removeItem'>;
export interface ModelPreferences { effort: string | null; serviceTier: string }
const modelKey = (agent: AgentId, model: string) => 'papilot:model-preferences:' + JSON.stringify([agent, model]);
const permissionKey = (agent: AgentId) => 'papilot:permissions:' + agent;

// Older versions kept one effort/Fast choice per agent. Keep it with the
// selected model (or the host default), before another model is selected.
export function migrateAgentPreferences(storage: Storage) {
  for (const agent of AGENT_IDS) {
    const effort = storage.getItem(`papilot:effort:${agent}`), fast = storage.getItem(`papilot:fast:${agent}`);
    if (effort === null && fast === null) continue;
    const key = modelKey(agent, storage.getItem(`papilot:model:${agent}`) || '');
    if (storage.getItem(key) === null) storage.setItem(key, JSON.stringify({ effort, fast: fast === 'true' }));
    storage.removeItem(`papilot:effort:${agent}`); storage.removeItem(`papilot:fast:${agent}`);
  }
}
migrateAgentPreferences(browserStorage);

export function readModelPreferences(agent: AgentId, id: string, model?: AgentModel, storage: Storage = browserStorage): ModelPreferences | null {
  const value = storage.getItem(modelKey(agent, model?.id || id))
    ?? (model?.isDefault ? storage.getItem(modelKey(agent, '')) : null);
  try {
    const saved = JSON.parse(value || 'null');
    if (saved && (saved.effort === null || typeof saved.effort === 'string')) {
      if (typeof saved.serviceTier === 'string') return { effort: saved.effort, serviceTier: saved.serviceTier };
      if (typeof saved.fast === 'boolean') {
        const fastTier = model?.serviceTiers?.find(tier => tier !== 'ultrafast') || 'priority';
        return { effort: saved.effort, serviceTier: saved.fast ? fastTier : 'default' };
      }
    }
  } catch { /* A damaged preference uses the normal model defaults. */ }
  return null;
}

let revision = 0;
const listeners = new Set<() => void>();
const changed = () => { revision++; listeners.forEach(listener => listener()); };
export function saveModelPreferences(agent: AgentId, model: string, value: ModelPreferences, storage: Storage = browserStorage) {
  storage.setItem(modelKey(agent, model), JSON.stringify(value)); changed();
}
export function readPermissionPreference(agent: AgentId, runtime?: RuntimeStatus, storage: Storage = browserStorage): TaskPermissions {
  const value = storage.getItem(permissionKey(agent));
  return value && runtime?.permissionOptions?.some(option => option.value === value) ? value : 'workspace';
}
export function savePermissionPreference(agent: AgentId, value: TaskPermissions, storage: Storage = browserStorage) {
  storage.setItem(permissionKey(agent), value); changed();
}
export function useAgentPreferenceChanges() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision);
}
