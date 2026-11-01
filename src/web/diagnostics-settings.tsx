import { useEffect, useState } from 'react';
import type { AgentId, LatexInstallation, DiagnosticReport, Project, RuntimeStatus } from '../shared.ts';
import { RuntimeAgents } from './runtime-agents.tsx';

export interface DiagnosticsSettingsProps {
  online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  project?: Pick<Project, 'id' | 'name'>;
  check: (projectId: string | undefined, signal: AbortSignal) => Promise<DiagnosticReport>;
  reconnect: () => Promise<void>;
  latex: (signal: AbortSignal) => Promise<LatexInstallation | null>;
}

export function DiagnosticsSettings({ online, runtimes, project, check, reconnect }: DiagnosticsSettingsProps) {
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
    <RuntimeAgents online={online} runtimes={runtimes} report={report} busy={busy} checkFailed={failed} checkAgain={() => setAttempt(value => value + 1)} reconnect={async () => { await reconnect(); setAttempt(value => value + 1); }}/>
  </div>;
}
