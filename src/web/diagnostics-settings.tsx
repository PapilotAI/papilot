import { useEffect, useRef, useState } from 'react';
import type { AgentId, DiagnosticReport, Project, RuntimeStatus } from '../shared.ts';
import { diagnosticSummary } from './diagnostic-report.ts';
import { Icon } from './icons.tsx';
import { locale, t } from './i18n.ts';

export interface DiagnosticsSettingsProps {
  online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  project?: Pick<Project, 'id' | 'name'>;
  check: (projectId: string | undefined, signal: AbortSignal) => Promise<DiagnosticReport>;
}

function checkNames(): Record<string, string> {
  return {
    node: 'Node.js', dependencies: t('Application dependencies'), frontend: t('Application interface'),
    'review-engine': t('Review engine'), data: t('Data folder'), git: 'Git', latexmk: 'latexmk', synctex: 'SyncTeX',
    'tex-engines': t('LaTeX engines'), 'agent.codex': t('Codex configuration'), 'agent.claude': t('Claude configuration'),
    'agent.antigravity': t('Antigravity configuration'), 'agent.kimi': t('Kimi configuration'), agents: t('Agent configuration'),
    project: t('Paper configuration'), 'project.git': t('Paper repository'), 'project.head': t('Initial commit'),
    'project.main': t('Main document'), 'project.engine': t('Paper compiler'), 'project.worktrees': t('Task folders'),
    remote: t('Remote access'), accounts: t('Collaborator access'), server: t('Local server'),
    service: t('Background service'), 'service.tools': t('Service tools'), 'service.data': t('Service data folder'),
  };
}

export function DiagnosticsSettings({ online, runtimes, project, check }: DiagnosticsSettingsProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0), [copied, setCopied] = useState(false), [manualCopy, setManualCopy] = useState(false);
  const copyArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setFailed(false); setReport(null); setCopied(false); setManualCopy(false);
    void check(project?.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setReport(result);
    }, () => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [attempt, project?.id, check]);
  useEffect(() => { if (manualCopy) { copyArea.current?.focus(); copyArea.current?.select(); } }, [manualCopy]);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); } }, [copied]);
  const summary = report ? diagnosticSummary(report, online, runtimes) : '';
  async function copy() {
    try { await navigator.clipboard.writeText(summary); setCopied(true); setManualCopy(false); }
    catch { setManualCopy(true); }
  }
  const errors = report?.checks.filter(item => !item.ok && item.severity === 'error').length || 0;
  const warnings = report?.checks.filter(item => !item.ok && item.severity === 'warn').length || 0;
  const names = checkNames();
  return <div className="diagnostics-settings">
    <p className="settings-about-intro">{t('Inspect agent connections and check the environment used to build your papers.')}</p>
    <h3 className="settings-section-title">{t('Live connections')}</h3>
    <div className="diagnostic-connections">
      <div className="diagnostic-connection"><span>{t('Papilot server')}</span><span className={`diagnostic-state ${online ? 'ok' : 'error'}`}><i/>{online ? t('Connected') : t('Disconnected')}</span></div>
      {(['codex', 'claude', 'antigravity', 'kimi'] as const).map(id => {
        const runtime = runtimes[id], ready = online && runtime?.connected && runtime.authenticated;
        return <div key={id} className="diagnostic-connection"><span>{id === 'codex' ? 'Codex' : id === 'claude' ? 'Claude' : id === 'kimi' ? 'Kimi' : 'Antigravity'}</span><span className={`diagnostic-state ${ready ? 'ok' : 'warn'}`}><i/>{!online || !runtime ? t('Unknown') : ready ? t('Ready') : runtime.connected ? t('Sign-in required') : t('Unavailable')}</span></div>;
      })}
    </div>
    <h3 className="settings-section-title">{t('Environment checks')}</h3>
    <p className="diagnostic-context">{project ? t('Includes the configuration for “{paper}”.', { paper: project.name }) : t('Open a paper to also check its repository and compiler configuration.')}</p>
    <div className="diagnostic-actions">
      <button type="button" className="button secondary compact" disabled={busy || !online} onClick={() => setAttempt(value => value + 1)}><Icon name="refresh" size={14}/>{busy ? t('Checking…') : t('Check again')}</button>
      <button type="button" className="button secondary compact" disabled={!report || busy} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={14}/>{copied ? t('Copied') : t('Copy diagnostic summary')}</button>
    </div>
    {busy && <p role="status" className="diagnostic-progress">{t('Checking tools and configuration. This may take a few seconds…')}</p>}
    {failed && <div className="diagnostic-failure" role="alert">{t('Could not complete the environment checks. Check the connection and try again.')}</div>}
    {report && <>
      <div role="status" className={`diagnostic-result ${errors ? 'error' : warnings ? 'warn' : 'ok'}`}>
        <Icon name={errors || warnings ? 'alert' : 'check'} size={17}/><span>{errors || warnings ? t('Errors: {errors} · Warnings: {warnings}', { errors, warnings }) : t('Environment checks passed')}</span>
      </div>
      <p className="diagnostic-metadata">Papilot {report.version} · {report.platform} {report.arch} · Node.js {report.node}<br/>{t('Checked at {time}', { time: new Date(report.checkedAt).toLocaleTimeString(locale()) })}</p>
      <p className="diagnostic-context">{t('Agent configuration checks do not send editing requests. Only the agents you use need to be configured.')}</p>
      <div className="diagnostic-checks">{report.checks.map(item => <details className="diagnostic-check" key={item.id} open={!item.ok}>
        <summary><Icon name={item.ok ? 'check' : 'alert'} size={15}/><span>{names[item.id] || item.id}</span><small className={`diagnostic-state ${item.ok ? 'ok' : item.severity === 'error' ? 'error' : 'warn'}`}>{item.ok ? t('Passed') : item.severity === 'error' ? t('Needs attention') : t('Warning')}</small><Icon name="chevronDown" size={14}/></summary>
        <div className="diagnostic-detail"><p>{item.detail}</p>{item.fix && <p className="diagnostic-fix"><strong>{t('Suggested fix')}</strong>{item.fix}</p>}</div>
      </details>)}</div>
      <p className="diagnostic-sharing">{t('The copied summary includes versions and check results, without account names, paths, or paper contents.')}</p>
    </>}
    {manualCopy && <label className="diagnostic-copy"><span role="status">{t('Automatic copy is unavailable. Copy the selected summary below.')}</span><textarea ref={copyArea} readOnly value={summary} aria-label={t('Diagnostic summary')}/></label>}
  </div>;
}
