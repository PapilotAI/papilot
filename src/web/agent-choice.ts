import { AGENT_IDS, type AgentId, type RuntimeStatus } from '../shared.ts';

// Only agents found on the host are offered (the desktop app does not include
// Codex). Codex is offered until the host says it is missing.
export function offeredAgents(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  return AGENT_IDS.filter(id => id === 'codex' ? runtimes.codex?.installed !== false : Boolean(runtimes[id] && runtimes[id]!.installed !== false));
}
// A remembered agent that is not found falls back to the first one offered,
// Codex when it is there, without forgetting the choice.
export function chosenAgent(saved: AgentId, offered: AgentId[]): AgentId {
  return offered.includes(saved) ? saved : offered[0] || 'codex';
}
