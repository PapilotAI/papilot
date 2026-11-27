import { AGENT_IDS, AGENT_NAMES, type AgentId, type RuntimeStatus } from '../shared.ts';
import { t } from './i18n.ts';

export const agentLabel = (id: AgentId) => id === 'collaboration' ? t('Collaboration mode') : id === 'chatgpt' ? t('ChatGPT Pro (web)') : AGENT_NAMES[id];

// Whether an agent is turned off: experimental modes are opt-in, every other
// agent is on until the author turns it off in Settings → Agents.
export const agentOff = (id: AgentId, runtimes: Partial<Record<AgentId, RuntimeStatus>>) => (id === 'collaboration' || id === 'chatgpt') ? runtimes[id]?.hidden !== false : Boolean(runtimes[id]?.hidden);
export const canReviewWith = (id: AgentId, runtime?: RuntimeStatus) => id !== 'collaboration' && id !== 'chatgpt' && runtime?.supportsReadOnlyTasks !== false;
// Offer only reported runtimes that are on and not known to be missing.
export function offeredAgents(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.filter(id => !agentOff(id, runtimes) && Boolean(runtimes[id] && runtimes[id]!.installed !== false));
}
// Wait for the host's report before treating an unknown installation as absent.
export function noAgent(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.every(id => agentOff(id, runtimes) || runtimes[id]?.installed === false);
}
// The models an agent offers in the pickers: those the author did not hide,
// and the one already chosen.
export function shownModels(runtime: RuntimeStatus | undefined, chosen?: string) {
  const hidden = runtime?.hiddenModels || [];
  return (runtime?.models || []).filter(model => model.id === chosen || !hidden.includes(model.id));
}
// The default model an agent uses when the author did not pick one: the host
// default, or the first shown model if the author hid that default. When the
// host default is unknown, return undefined instead of guessing.
export function defaultOfferedModel(runtime: RuntimeStatus | undefined) {
  const models = runtime?.models || [], fallback = models.find(model => model.isDefault);
  if (!fallback) return undefined;
  const hidden = runtime?.hiddenModels || [];
  return hidden.includes(fallback.id) ? models.find(model => !hidden.includes(model.id)) || fallback : fallback;
}
export function agentsSettled(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  const reported = Object.values(runtimes).filter(runtime => runtime && !runtime.hidden);
  return reported.length > 0 && reported.every(runtime => runtime.connected || Boolean(runtime.error) || runtime.installed === false);
}
// Wait for startup to settle before preferring an agent ready for the first task.
export function chosenAgent(saved: AgentId | null, offered: AgentId[], runtimes: Partial<Record<AgentId, RuntimeStatus>>): AgentId {
  if (saved && offered.includes(saved)) return saved;
  const available = agentsSettled(runtimes) ? offered.filter(id => runtimes[id]?.connected && runtimes[id]?.authenticated) : [];
  return available.find(id => !runtimes[id]?.authenticationUnchecked) || available[0] || offered[0] || 'codex';
}
