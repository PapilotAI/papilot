import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVITY_RANGES,
  type ActivityAgentSummary,
  type ActivityDay,
  type ActivityModelSummary,
  type ActivityProjectSummary,
  type ActivityRange,
  type ActivityReport,
  type ActivityTokenTotals,
  type ActivityTotals,
  type AgentId,
} from '../shared.ts';
import { agentLabel } from './agent-choice.ts';
import { BrandIcon } from './brand-icon.tsx';
import { ChipSelect } from './chip-select.tsx';
import { errorText, locale, t, tn } from './i18n.ts';
import { Icon } from './icons.tsx';
import { PapilotMark } from './papilot-mark.tsx';
import './activity-settings.css';

export type LoadActivity = (params: { tz: string; range: ActivityRange; projectId?: string }, signal: AbortSignal) => Promise<ActivityReport>;

type TrendMetric = 'tokens' | 'spend' | 'turns' | 'reviews';

const EMPTY_TOKENS: ActivityTokenTotals = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };

const EMPTY_TOTALS: ActivityTotals = {
  tokens: EMPTY_TOKENS,
  costUsd: null,
  reportedCostUsd: 0,
  estimatedCostUsd: 0,
  pricedTokens: 0,
  unpricedTokens: 0,
  tasksStarted: 0,
  editTasksStarted: 0,
  reviewTasksStarted: 0,
  turns: 0,
  completedTurns: 0,
  failedTurns: 0,
  interruptedTurns: 0,
  turnsByRole: { edit: 0, review: 0, worker: 0, helper: 0 },
  accepted: 0,
  rejected: 0,
  commented: 0,
  undone: 0,
  tasksApplied: 0,
  tasksCommitted: 0,
  gitCommits: 0,
  annotationsCreated: 0,
  authorAnnotations: 0,
  agentAnnotations: 0,
  aiReviewAnnotations: 0,
  annotationsSent: 0,
  activeDays: 0,
};

function safeTokens(raw: Partial<ActivityTokenTotals> | undefined | null): ActivityTokenTotals {
  return {
    input: Number(raw?.input) || 0,
    cached: Number(raw?.cached) || 0,
    cacheWrite: Number(raw?.cacheWrite) || 0,
    output: Number(raw?.output) || 0,
    reasoning: Number(raw?.reasoning) || 0,
    total: Number(raw?.total) || 0,
  };
}

function safeHours(raw: unknown): number[] {
  return Array.isArray(raw) && raw.length === 24 ? raw.map(value => Number(value) || 0) : Array<number>(24).fill(0);
}

function normalizeReport(raw: Partial<ActivityReport> | undefined | null, fallbackTz: string, range: ActivityRange): ActivityReport {
  const today = typeof raw?.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.today)
    ? raw.today
    : new Date().toISOString().slice(0, 10);
  const rawTotals = raw?.totals;
  const totals: ActivityTotals = rawTotals && typeof rawTotals === 'object' ? {
    ...EMPTY_TOTALS,
    ...rawTotals,
    tokens: safeTokens(rawTotals.tokens),
    costUsd: typeof rawTotals.costUsd === 'number' && Number.isFinite(rawTotals.costUsd) ? rawTotals.costUsd : null,
    turnsByRole: {
      edit: Number(rawTotals.turnsByRole?.edit) || 0,
      review: Number(rawTotals.turnsByRole?.review) || 0,
      worker: Number(rawTotals.turnsByRole?.worker) || 0,
      helper: Number(rawTotals.turnsByRole?.helper) || 0,
    },
  } : EMPTY_TOTALS;
  const days: ActivityDay[] = Array.isArray(raw?.days) ? raw.days.filter(day => day && typeof day.date === 'string').map(day => ({
    ...EMPTY_TOTALS,
    ...day,
    date: day.date,
    tokens: safeTokens(day.tokens),
    costUsd: typeof day.costUsd === 'number' && Number.isFinite(day.costUsd) ? day.costUsd : null,
    turnsByRole: {
      edit: Number(day.turnsByRole?.edit) || 0,
      review: Number(day.turnsByRole?.review) || 0,
      worker: Number(day.turnsByRole?.worker) || 0,
      helper: Number(day.turnsByRole?.helper) || 0,
    },
    hours: safeHours(day.hours),
    turnHours: safeHours(day.turnHours),
    tokenHours: safeHours(day.tokenHours),
  })) : [];
  return {
    timezone: typeof raw?.timezone === 'string' && raw.timezone ? raw.timezone : fallbackTz,
    today,
    range: raw?.range && ACTIVITY_RANGES.includes(raw.range) ? raw.range : range,
    generatedAt: Number(raw?.generatedAt) || Date.now(),
    projectId: typeof raw?.projectId === 'string' ? raw.projectId : null,
    projects: Array.isArray(raw?.projects) ? raw.projects : [],
    totals,
    hours: safeHours(raw?.hours),
    turnHours: safeHours(raw?.turnHours),
    tokenHours: safeHours(raw?.tokenHours),
    days,
    agents: Array.isArray(raw?.agents) ? raw.agents.map(entry => ({ ...entry, tokens: safeTokens(entry.tokens) })) : [],
    models: Array.isArray(raw?.models) ? raw.models.map(entry => ({ ...entry, tokens: safeTokens(entry.tokens) })) : [],
  };
}

function formatCompactTokens(value: number): string {
  if (value <= 0) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.?0+$/, '')}K`;
  return value.toLocaleString(locale());
}

function formatExactNumber(value: number): string {
  return Math.round(value).toLocaleString(locale());
}

function formatUsd(value: number | null, prefix = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return `${prefix}$0.00`;
  if (value < 0.01) return `${prefix}$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  if (value < 1) return `${prefix}$${value.toFixed(3).replace(/0$/, '')}`;
  return `${prefix}$${value.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateLabel(date: string, short = false): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(locale(), short
    ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(utc);
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function peakHourIndex(hours: number[]): number | null {
  let best = -1, bestValue = 0;
  for (let h = 0; h < hours.length; h++) {
    if (hours[h] > bestValue) {
      bestValue = hours[h];
      best = h;
    }
  }
  return best >= 0 ? best : null;
}

function hasAnyActivity(day: ActivityDay): boolean {
  return day.tokens.total > 0 ||
    day.tasksStarted > 0 ||
    day.turns > 0 ||
    day.accepted > 0 ||
    day.rejected > 0 ||
    day.commented > 0 ||
    day.undone > 0 ||
    day.tasksApplied > 0 ||
    day.tasksCommitted > 0 ||
    day.gitCommits > 0 ||
    day.annotationsCreated > 0 ||
    day.annotationsSent > 0;
}

function metricValue(day: ActivityDay, metric: TrendMetric): number {
  if (metric === 'tokens') return day.tokens.total;
  if (metric === 'spend') return day.costUsd ?? 0;
  if (metric === 'turns') return day.turns;
  return day.accepted + day.rejected + day.commented + day.annotationsCreated;
}

function AgentAvatar({ agent }: { agent: AgentId }) {
  if (agent === 'papilot') return <PapilotMark size={15}/>;
  if (agent === 'collaboration') return <Icon name="workflow" size={15}/>;
  return <BrandIcon name={agent} size={15}/>;
}

function DayRows({ days }: { days: ActivityDay[] }) {
  return <>
    {days.map(day => {
      const peak = peakHourIndex(day.hours);
      const spendPrefix = day.costUsd !== null && day.reportedCostUsd === 0 && day.estimatedCostUsd > 0 ? '~' : '';
      return <tr key={day.date}>
        <th scope="row">
          {formatDateLabel(day.date, true)}
          <span className="activity-cell-sub">{day.date}</span>
        </th>
        <td className="num" data-label={t('Tokens')} title={formatExactNumber(day.tokens.total)}>
          {formatCompactTokens(day.tokens.total)}
          {day.tokens.total > 0 && <span className="activity-cell-sub">
            {t('{input} in · {cached} cached · {output} out', {
              input: formatCompactTokens(day.tokens.input),
              cached: formatCompactTokens(day.tokens.cached),
              output: formatCompactTokens(day.tokens.output),
            })}
            {day.tokens.cacheWrite > 0 ? ` · ${t('{tokens} cache write', { tokens: formatCompactTokens(day.tokens.cacheWrite) })}` : ''}
          </span>}
        </td>
        <td className="num" data-label={t('Spend')}>
          {formatUsd(day.costUsd, spendPrefix)}
          {day.unpricedTokens > 0 && <span className="activity-cell-sub">{t('{tokens} unpriced', { tokens: formatCompactTokens(day.unpricedTokens) })}</span>}
        </td>
        <td className="num" data-label={t('Agent runs')}>
          {formatExactNumber(day.turns)}
          {day.tasksStarted > 0 && <span className="activity-cell-sub">{tn(day.tasksStarted, '{n} task started', '{n} tasks started')}</span>}
        </td>
        <td className="num" data-label={t('Accept / Reject')}>
          <span className="activity-decision-pair">
            <span className="activity-kpi-accept">+{formatExactNumber(day.accepted)}</span>
            <span aria-hidden="true">/</span>
            <span className="activity-kpi-reject">−{formatExactNumber(day.rejected)}</span>
          </span>
          {(day.commented > 0 || day.tasksApplied + day.tasksCommitted > 0) && <span className="activity-cell-sub">
            {[
              day.commented > 0 ? tn(day.commented, '{n} comment', '{n} comments') : '',
              day.tasksApplied + day.tasksCommitted > 0 ? t('{count} saved', { count: day.tasksApplied + day.tasksCommitted }) : '',
            ].filter(Boolean).join(' · ')}
          </span>}
        </td>
        <td className="num" data-label={t('Annotations')}>
          {formatExactNumber(day.annotationsCreated)}
          {day.annotationsSent > 0 && <span className="activity-cell-sub">{t('{count} sent', { count: formatExactNumber(day.annotationsSent) })}</span>}
        </td>
        <td className="num activity-peak-cell" data-label={t('Peak hour')}>
          {peak !== null ? `${hourLabel(peak)}–${hourLabel((peak + 1) % 24)}` : '—'}
        </td>
      </tr>;
    })}
  </>;
}

export function ActivitySettings({ load, initialProjectId }: { load: LoadActivity; initialProjectId?: string }) {
  const clientTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [range, setRange] = useState<ActivityRange>('30d');
  const [projectId, setProjectId] = useState<string>('all');
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const barsRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback((chosenRange = range, chosenProject = projectId) => {
    const id = ++requestSeq.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void load(
      { tz: clientTz, range: chosenRange, ...(chosenProject !== 'all' ? { projectId: chosenProject } : {}) },
      controller.signal,
    ).then(
      raw => {
        if (requestSeq.current !== id) return;
        setReport(normalizeReport(raw, clientTz, chosenRange));
        setLoading(false);
      },
      err => {
        if (requestSeq.current !== id || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(errorText(message));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [clientTz, load, projectId, range]);

  useEffect(() => refresh(range, projectId), [range, projectId, refresh]);

  const current = report ?? normalizeReport(null, clientTz, range);
  const totals = current.totals;

  const activeDaysDesc = useMemo(
    () => [...current.days].filter(hasAnyActivity).reverse(),
    [current.days],
  );

  const focusedDay = useMemo(() => {
    if (selectedDate) {
      const exact = current.days.find(day => day.date === selectedDate);
      if (exact) return exact;
    }
    return activeDaysDesc[0] || current.days.at(-1) || null;
  }, [activeDaysDesc, current.days, selectedDate]);

  const maxTrend = useMemo(
    () => Math.max(0, ...current.days.map(day => metricValue(day, metric))),
    [current.days, metric],
  );

  const maxHour = useMemo(
    () => Math.max(0, ...current.hours),
    [current.hours],
  );
  const peakHour = useMemo(() => peakHourIndex(current.hours), [current.hours]);

  const rangeLabels: Record<ActivityRange, string> = {
    '7d': t('7 days'),
    '30d': t('30 days'),
    '90d': t('90 days'),
    all: t('All time'),
  };

  const paperOptions = useMemo(() => {
    const items = current.projects.map((paper: ActivityProjectSummary) => ({
      value: paper.id,
      label: paper.removed ? `${paper.name} (${t('Removed')})` : paper.name,
    }));
    return [{ value: 'all', label: t('All papers') }, ...items];
  }, [current.projects]);

  const spendEstimateOnly = totals.costUsd !== null && totals.reportedCostUsd === 0 && totals.estimatedCostUsd > 0;
  const spendMixed = totals.reportedCostUsd > 0 && totals.estimatedCostUsd > 0;
  const decisionTotal = totals.accepted + totals.rejected;
  const acceptRate = decisionTotal > 0 ? Math.round((totals.accepted / decisionTotal) * 100) : null;
  const emptyWorkspace = totals.activeDays === 0 && totals.tokens.total === 0 && totals.turns === 0 && decisionTotal === 0 && totals.annotationsCreated === 0;
  const activeSelection = emptyWorkspace && !selectedDate ? null : focusedDay;
  const tabStopDate = (activeSelection ?? current.days.at(-1))?.date ?? null;

  const onTrendKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!current.days.length) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, current.days.findIndex(day => day.date === tabStopDate));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? current.days.length - 1
      : event.key === 'ArrowLeft'
      ? Math.max(0, currentIndex - 1)
      : Math.min(current.days.length - 1, currentIndex + 1);
    const target = current.days[nextIndex];
    if (!target) return;
    setSelectedDate(target.date);
    barsRef.current?.querySelectorAll<HTMLButtonElement>('.activity-day-bar')[nextIndex]?.focus();
  };

  const primaryDays = activeDaysDesc.slice(0, 14);
  const olderDays = activeDaysDesc.slice(14);

  return <div className="settings-page activity-settings">
    <div className="activity-toolbar">
      <div className="activity-range-group" role="group" aria-label={t('Time range')}>
        {ACTIVITY_RANGES.map(option => (
          <button
            key={option}
            type="button"
            className="activity-range-button"
            data-range={option}
            aria-pressed={range === option}
            onClick={() => { setSelectedDate(null); setRange(option); }}
          >
            {rangeLabels[option]}
          </button>
        ))}
      </div>
      <div className="activity-filter-controls">
        {paperOptions.length > 2 && (
          <ChipSelect
            label={t('Paper filter')}
            value={projectId}
            onChange={value => { setSelectedDate(null); setProjectId(value); }}
            options={paperOptions}
          />
        )}
        <button
          type="button"
          className="activity-refresh"
          aria-label={t('Refresh')}
          title={t('Refresh')}
          disabled={loading}
          onClick={() => refresh(range, projectId)}
        >
          <Icon name="refresh" size={14}/>
        </button>
      </div>
    </div>

    {error && (
      <div className="activity-status-banner" role="alert">
        <span>{error}</span>
        <button type="button" className="button secondary" onClick={() => refresh(range, projectId)}>{t('Retry')}</button>
      </div>
    )}

    {!error && loading && !report && (
      <div className="activity-status-banner" role="status">
        <span>{t('Loading workspace statistics…')}</span>
      </div>
    )}

    {!error && report && emptyWorkspace && (
      <div className="activity-status-banner" role="status">
        <span>{t('No workspace activity recorded in this period yet. Token usage, agent runs, review decisions and PDF annotations appear here automatically.')}</span>
      </div>
    )}

    <section className="activity-kpis" aria-label={t('Summary metrics')}>
      <div className="activity-kpi" data-kpi="tokens">
        <span className="activity-kpi-label"><Icon name="bolt" size={13}/>{t('Tokens')}</span>
        <strong className="activity-kpi-value" title={formatExactNumber(totals.tokens.total)}>
          {formatCompactTokens(totals.tokens.total)}
        </strong>
        <p className="activity-kpi-detail">
          {t('{input} in · {cached} cached · {output} out', {
            input: formatCompactTokens(totals.tokens.input),
            cached: formatCompactTokens(totals.tokens.cached),
            output: formatCompactTokens(totals.tokens.output),
          })}
          {totals.tokens.cacheWrite > 0 ? ` · ${t('{tokens} cache write', { tokens: formatCompactTokens(totals.tokens.cacheWrite) })}` : ''}
          {totals.tokens.reasoning > 0 ? ` · ${t('{tokens} reasoning', { tokens: formatCompactTokens(totals.tokens.reasoning) })}` : ''}
        </p>
      </div>

      <div className="activity-kpi" data-kpi="spend">
        <span className="activity-kpi-label"><Icon name="calculator" size={13}/>{t('Spend')}</span>
        <strong className="activity-kpi-value">
          {formatUsd(totals.costUsd, spendEstimateOnly ? '~' : '')}
        </strong>
        <p className="activity-kpi-detail">
          {[
            spendMixed
              ? t('{reported} reported · {estimated} API equiv.', {
                  reported: formatUsd(totals.reportedCostUsd),
                  estimated: formatUsd(totals.estimatedCostUsd, '~'),
                })
              : spendEstimateOnly
              ? t('API-equivalent model rates')
              : totals.reportedCostUsd > 0
              ? t('Provider-reported spend')
              : totals.tokens.total > 0
              ? t('Cost not reported for these models')
              : t('Reported & API-equivalent USD'),
            totals.unpricedTokens > 0 && totals.costUsd !== null
              ? t('{tokens} unpriced', { tokens: formatCompactTokens(totals.unpricedTokens) })
              : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="activity-kpi" data-kpi="agents">
        <span className="activity-kpi-label"><Icon name="terminal" size={13}/>{t('Agent runs')}</span>
        <strong className="activity-kpi-value">{formatExactNumber(totals.turns)}</strong>
        <p className="activity-kpi-detail">
          {[
            tn(totals.tasksStarted, '{n} task started', '{n} tasks started'),
            totals.turnsByRole.review > 0 ? t('{count} review', { count: formatExactNumber(totals.turnsByRole.review) }) : '',
            totals.turnsByRole.worker > 0 ? t('{count} worker', { count: formatExactNumber(totals.turnsByRole.worker) }) : '',
            totals.turnsByRole.helper > 0 ? t('{count} helper', { count: formatExactNumber(totals.turnsByRole.helper) }) : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="activity-kpi" data-kpi="reviews">
        <span className="activity-kpi-label"><Icon name="diff" size={13}/>{t('Accept / Reject')}</span>
        <strong className="activity-kpi-value activity-kpi-decisions">
          <span className="activity-kpi-accept">+{formatExactNumber(totals.accepted)}</span>
          <span aria-hidden="true">/</span>
          <span className="activity-kpi-reject">−{formatExactNumber(totals.rejected)}</span>
        </strong>
        <p className="activity-kpi-detail">
          {[
            acceptRate !== null ? t('{rate}% accepted', { rate: acceptRate }) : t('No changes decided yet'),
            totals.commented > 0 ? tn(totals.commented, '{n} comment', '{n} comments') : '',
            totals.tasksApplied + totals.tasksCommitted > 0 ? t('{count} saved', { count: formatExactNumber(totals.tasksApplied + totals.tasksCommitted) }) : '',
            totals.undone > 0 ? t('{count} undone', { count: formatExactNumber(totals.undone) }) : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="activity-kpi" data-kpi="annotations">
        <span className="activity-kpi-label"><Icon name="notes" size={13}/>{t('Annotations')}</span>
        <strong className="activity-kpi-value">{formatExactNumber(totals.annotationsCreated)}</strong>
        <p className="activity-kpi-detail">
          {[
            t('{count} sent to tasks', { count: formatExactNumber(totals.annotationsSent) }),
            totals.authorAnnotations > 0 ? t('{count} yours', { count: formatExactNumber(totals.authorAnnotations) }) : '',
            totals.aiReviewAnnotations + totals.agentAnnotations > 0
              ? t('{count} by AI', { count: formatExactNumber(totals.aiReviewAnnotations + totals.agentAnnotations) })
              : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="activity-kpi" data-kpi="hours">
        <span className="activity-kpi-label"><Icon name="clock" size={13}/>{t('Active hours')}</span>
        <strong className="activity-kpi-value">
          {peakHour !== null ? `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` : '—'}
        </strong>
        <p className="activity-kpi-detail">
          {[
            tn(totals.activeDays, '{n} active day', '{n} active days'),
            current.timezone,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
    </section>

    <section className="activity-section">
      <div className="activity-section-head">
        <div className="activity-section-title-group">
          <h3>{t('Daily trend')}</h3>
          <p className="activity-section-subtitle">
            {tn(totals.activeDays, '{n} active day', '{n} active days')}
          </p>
        </div>
        <div className="activity-metric-tabs" role="group" aria-label={t('Chart metric')}>
          {([
            ['tokens', t('Tokens')],
            ['spend', t('Spend')],
            ['turns', t('Agent runs')],
            ['reviews', t('Reviews & notes')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="activity-metric-tab"
              data-metric={id}
              aria-pressed={metric === id}
              onClick={() => setMetric(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="activity-chart-box">
        <div
          ref={barsRef}
          className={'activity-bars' + (current.days.length > 35 ? ' dense' : '')}
          role="group"
          aria-label={t('Daily trend')}
          onKeyDown={onTrendKeyDown}
        >
          {current.days.map(day => {
            const value = metricValue(day, metric);
            const pct = maxTrend > 0 && value > 0 ? Math.max(8, Math.round((value / maxTrend) * 100)) : 3;
            const style = { '--bar-fill': `${pct}%` } as CSSProperties;
            const valueText = metric === 'tokens'
              ? `${formatCompactTokens(day.tokens.total)} ${t('Tokens')}`
              : metric === 'spend'
              ? formatUsd(day.costUsd, day.costUsd !== null && day.reportedCostUsd === 0 && day.estimatedCostUsd > 0 ? '~' : '')
              : metric === 'turns'
              ? `${formatExactNumber(day.turns)} ${t('Agent runs')}`
              : `+${day.accepted}/−${day.rejected}, ${day.annotationsCreated} ${t('Annotations')}`;
            const label = `${formatDateLabel(day.date, true)}: ${valueText}`;
            return (
              <button
                key={day.date}
                type="button"
                className="activity-day-bar"
                data-date={day.date}
                tabIndex={tabStopDate === day.date ? 0 : -1}
                aria-label={label}
                aria-pressed={activeSelection?.date === day.date}
                title={label}
                onClick={() => setSelectedDate(day.date)}
              >
                <span className={'activity-bar-fill' + (value > 0 ? ' nonzero' : '')} style={style}/>
              </button>
            );
          })}
        </div>
        {current.days.length > 0 && (
          <div className="activity-axis" aria-hidden="true">
            <span>{formatDateLabel(current.days[0].date, true)}</span>
            {current.days.length > 4 && <span>{formatDateLabel(current.days[Math.floor(current.days.length / 2)].date, true)}</span>}
            <span>{formatDateLabel(current.days.at(-1)!.date, true)}</span>
          </div>
        )}
        {activeSelection && (
          <div className="activity-selected-day">
            <strong>{formatDateLabel(activeSelection.date)}</strong>
            <div className="activity-selected-metrics">
              <span>{t('Tokens')}: {formatCompactTokens(activeSelection.tokens.total)}</span>
              <span>{t('Spend')}: {formatUsd(activeSelection.costUsd, activeSelection.costUsd !== null && activeSelection.reportedCostUsd === 0 && activeSelection.estimatedCostUsd > 0 ? '~' : '')}</span>
              <span>{t('Agent runs')}: {formatExactNumber(activeSelection.turns)}</span>
              <span>{t('Accept / Reject')}: +{formatExactNumber(activeSelection.accepted)} / −{formatExactNumber(activeSelection.rejected)}</span>
              <span>{t('Annotations')}: {formatExactNumber(activeSelection.annotationsCreated)}</span>
            </div>
          </div>
        )}
      </div>
    </section>

    <section className="activity-section">
      <div className="activity-section-head">
        <div className="activity-section-title-group">
          <h3>{t('Active hours')}</h3>
          <p className="activity-section-subtitle">
            {[
              t('Local time ({timezone})', { timezone: current.timezone }),
              peakHour !== null ? t('Peak {window}', { window: `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` }) : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div className="activity-chart-box">
        <div className="activity-bars" role="img" aria-label={peakHour !== null ? t('Active hours, peak {window}', { window: `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` }) : t('Active hours')}>
          {current.hours.map((count, hour) => {
            const pct = maxHour > 0 && count > 0 ? Math.max(8, Math.round((count / maxHour) * 100)) : 3;
            const style = { '--bar-fill': `${pct}%` } as CSSProperties;
            const detail = `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${formatExactNumber(current.turnHours[hour])} ${t('Agent runs')}, ${formatCompactTokens(current.tokenHours[hour])} ${t('Tokens')}`;
            return (
              <div
                key={hour}
                className={'activity-hour-slot' + (peakHour === hour ? ' peak' : '')}
                data-hour={hour}
                title={detail}
              >
                <span className={'activity-bar-fill' + (count > 0 ? ' nonzero' : '')} style={style}/>
              </div>
            );
          })}
        </div>
        <div className="activity-axis" aria-hidden="true">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </div>
    </section>

    {(current.agents.length > 0 || current.models.length > 0) && (
      <section className="activity-section">
        <div className="activity-section-head">
          <div className="activity-section-title-group">
            <h3>{t('Agents & models')}</h3>
            <p className="activity-section-subtitle">{t('Breakdown across editing tasks, AI reviews, collaboration workers and background helpers.')}</p>
          </div>
        </div>
        <div className="activity-breakdown-grid">
          {current.agents.length > 0 && (
            <div className="activity-list-card">
              <h4>{t('By agent')}</h4>
              <ul className="activity-breakdown-list" role="list">
                {current.agents.map((entry: ActivityAgentSummary) => {
                  const estOnly = entry.costUsd !== null && entry.reportedCostUsd === 0 && entry.estimatedCostUsd > 0;
                  return (
                    <li key={entry.agent} className="activity-breakdown-row">
                      <div className="activity-breakdown-name">
                        <AgentAvatar agent={entry.agent}/>
                        <span className="activity-truncate" title={agentLabel(entry.agent)}>{agentLabel(entry.agent)}</span>
                      </div>
                      <span className="activity-breakdown-stat">
                        {entry.tokens.total > 0 ? formatCompactTokens(entry.tokens.total) : tn(entry.turns, '{n} run', '{n} runs')}
                      </span>
                      <span className="activity-breakdown-sub">
                        {[
                          tn(entry.turns, '{n} run', '{n} runs'),
                          entry.tasksStarted > 0 ? tn(entry.tasksStarted, '{n} task started', '{n} tasks started') : '',
                          entry.costUsd !== null ? formatUsd(entry.costUsd, estOnly ? '~' : '') : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {current.models.length > 0 && (
            <div className="activity-list-card">
              <h4>{t('By model')}</h4>
              <ul className="activity-breakdown-list" role="list">
                {current.models.map((entry: ActivityModelSummary) => {
                  const estPrefix = entry.costSource === 'estimated' ? '~' : '';
                  return (
                    <li key={`${entry.agent}:${entry.model}`} className="activity-breakdown-row">
                      <div className="activity-breakdown-name">
                        <AgentAvatar agent={entry.agent}/>
                        <span className="activity-truncate" title={entry.model}>{entry.model}</span>
                      </div>
                      <span className="activity-breakdown-stat">
                        {entry.tokens.total > 0 ? formatCompactTokens(entry.tokens.total) : tn(entry.turns, '{n} run', '{n} runs')}
                      </span>
                      <span className="activity-breakdown-sub">
                        {[
                          agentLabel(entry.agent),
                          tn(entry.turns, '{n} run', '{n} runs'),
                          entry.costUsd !== null ? formatUsd(entry.costUsd, estPrefix) : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    )}

    {activeDaysDesc.length > 0 && (
      <section className="activity-section">
        <div className="activity-section-head">
          <div className="activity-section-title-group">
            <h3>{t('Daily breakdown')}</h3>
            <p className="activity-section-subtitle">{t('Recorded locally in your workspace database and kept even after tasks or papers are removed.')}</p>
          </div>
        </div>

        <div className="activity-table-container">
          <table className="activity-table">
            <caption className="sr-only">{t('Daily breakdown')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Date')}</th>
                <th scope="col" className="num">{t('Tokens')}</th>
                <th scope="col" className="num">{t('Spend')}</th>
                <th scope="col" className="num">{t('Agent runs')}</th>
                <th scope="col" className="num">{t('Accept / Reject')}</th>
                <th scope="col" className="num">{t('Annotations')}</th>
                <th scope="col" className="num">{t('Peak hour')}</th>
              </tr>
            </thead>
            <tbody>
              <DayRows days={primaryDays}/>
            </tbody>
          </table>
        </div>

        {olderDays.length > 0 && (
          <details className="activity-more-days">
            <summary>
              <Icon name="chevronDown" size={14}/>
              <span>{tn(olderDays.length, 'Show {n} earlier active day', 'Show {n} earlier active days')}</span>
            </summary>
            <div className="activity-table-container">
              <table className="activity-table">
                <caption className="sr-only">{t('Earlier active days')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Date')}</th>
                    <th scope="col" className="num">{t('Tokens')}</th>
                    <th scope="col" className="num">{t('Spend')}</th>
                    <th scope="col" className="num">{t('Agent runs')}</th>
                    <th scope="col" className="num">{t('Accept / Reject')}</th>
                    <th scope="col" className="num">{t('Annotations')}</th>
                    <th scope="col" className="num">{t('Peak hour')}</th>
                  </tr>
                </thead>
                <tbody>
                  <DayRows days={olderDays}/>
                </tbody>
              </table>
            </div>
          </details>
        )}

        <p className="activity-footnote">
          {t('Values marked with ~ are estimated from exact model API rates when an agent reports tokens without billing totals. Subscription plans may include this usage at no extra charge.')}
        </p>
      </section>
    )}
  </div>;
}
