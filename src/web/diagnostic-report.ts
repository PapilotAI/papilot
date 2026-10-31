import { AGENT_IDS, type AgentId, type DiagnosticReport, type RuntimeStatus } from '../shared.ts';

// Share only explicit diagnostic fields. Paths, account names, tool output and
// paper contents stay out of reports copied into public issue trackers.
export function diagnosticSummary(report: DiagnosticReport, online: boolean, runtimes: Partial<Record<AgentId, RuntimeStatus>>): string {
  return JSON.stringify({
    app: 'Papilot', version: report.version, checkedAt: new Date(report.checkedAt).toISOString(),
    platform: report.platform, arch: report.arch, node: report.node, serverConnected: online,
    agents: Object.fromEntries(AGENT_IDS.map(id => [id, runtimes[id] ? {
      installed: runtimes[id]!.installed !== false, connected: runtimes[id]!.connected, authenticated: runtimes[id]!.authenticated, models: runtimes[id]!.models.length,
    } : null])),
    ok: report.ok, checks: report.checks.map(({ id, ok, severity }) => ({ id, ok, severity })),
  }, null, 2);
}
