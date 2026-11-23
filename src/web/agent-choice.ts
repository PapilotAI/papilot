import { AGENT_IDS, AGENT_NAMES, type AgentId, type RuntimeStatus } from '../shared.ts';
import { t } from './i18n.ts';

export const agentLabel = (id: AgentId) => id === 'collaboration' ? t('Collaboration mode') : AGENT_NAMES[id];

// Whether an agent is turned off: collaboration mode is opt-in, every other
// agent is on until the author turns it off in Settings → Agents.
export const agentOff = (id: AgentId, runtimes: Partial<Record<AgentId, RuntimeStatus>>) => id === 'collaboration' ? runtimes.collaboration?.hidden !== false : Boolean(runtimes[id]?.hidden);
// Offer only reported runtimes that are on and not known to be missing.
export function offeredAgents(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.filter(id => !agentOff(id, runtimes) && Boolean(runtimes[id] && runtimes[id]!.installed !== false));
}
// Wait for the host's report before treating an unknown installation as absent.
export function noAgent(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.every(id => agentOff(id, runtimes) || runtimes[id]?.installed === false);
}
// The models an agent offers in the pickers: those the author did not hide,
// its default model, and the one already chosen.
export function shownModels(runtime: RuntimeStatus | undefined, chosen?: string) {
  const hidden = runtime?.hiddenModels || [];
  return (runtime?.models || []).filter(model => model.isDefault || model.id === chosen || !hidden.includes(model.id));
}
export function agentsSettled(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  const reported = Object.values(runtimes).filter(runtime => runtime && !runtime.hidden);
  return reported.length > 0 && reported.every(runtime => runtime.connected || Boolean(runtime.error) || runtime.installed === false);
}
// Wait for startup to settle before preferring an agent ready for the first task.
export function chosenAgent(saved: AgentId | null, offered: AgentId[], runtimes: Partial<Record<AgentId, RuntimeStatus>>): AgentId {
  return saved && offered.includes(saved) ? saved
    : (agentsSettled(runtimes) && offered.find(id => runtimes[id]?.connected && runtimes[id]?.authenticated)) || offered[0] || 'codex';
}
