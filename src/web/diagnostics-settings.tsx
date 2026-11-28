import { useEffect, useState } from 'react';
import type { AgentId, AgentSettingsChange, CompilerChoice, LatexInstallation, DiagnosticReport, Project, RuntimeStatus, WriterAuth } from '../shared.ts';
import { RuntimeAgents } from './runtime-agents.tsx';

export interface DiagnosticsSettingsProps {
  online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  project?: Pick<Project, 'id' | 'name'>;
  check: (projectId: string | undefined, signal: AbortSignal) => Promise<DiagnosticReport>;
  reconnect: () => Promise<void>;
  latex: (signal: AbortSignal) => Promise<LatexInstallation | null>;
  /** The compiler for this host: GET with no choice, POST with one. */
  compiler?: (choice?: CompilerChoice['compiler']) => Promise<CompilerChoice>;
  /** Papilot Writer's providers: GET with no body, POST with one. */
  writer?: (route: string, body?: unknown) => Promise<WriterAuth>;
  /** Saves a change to which agents and models are offered. */
  agentSettings?: (change: AgentSettingsChange) => Promise<void>;
  /** When set, restricts the agents shown to this host allowlist. */
  allowedAgents?: AgentId[];
}

export function DiagnosticsSettings({ online, runtimes, project, check, reconnect, writer, agentSettings, allowedAgents }: DiagnosticsSettingsProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setFailed(false); setReport(null);
    void check(project?.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setReport(result);
    }, () => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [attempt, project?.id, check]);
  return <div className="diagnostics-settings settings-page">
    <RuntimeAgents online={online} runtimes={runtimes} allowedAgents={allowedAgents} report={report} busy={busy} checkFailed={failed} checkAgain={() => setAttempt(value => value + 1)} reconnect={async () => { await reconnect(); setAttempt(value => value + 1); }} writer={writer} save={agentSettings}/>
  </div>;
}
