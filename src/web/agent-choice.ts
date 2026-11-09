import { AGENT_IDS, type AgentId, type RuntimeStatus } from '../shared.ts';

// Offer only reported runtimes whose installation is not known to be missing.
export function offeredAgents(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.filter(id => Boolean(runtimes[id] && runtimes[id]!.installed !== false));
}
// Wait for the host's report before treating an unknown installation as absent.
export function noAgent(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.every(id => runtimes[id]?.installed === false);
}
// A remembered agent that is not found falls back to the first one offered,
// Codex when it is there, without forgetting the choice.
export function chosenAgent(saved: AgentId, offered: AgentId[]): AgentId {
  return offered.includes(saved) ? saved : offered[0] || 'codex';
}
