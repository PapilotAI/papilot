import { type CSSProperties, Fragment, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVITY_CALENDAR_DAYS,
  ACTIVITY_RANGES,
  type ActivityAgentSummary,
  type ActivityCalendarDay,
  type ActivityDay,
  type ActivityMetrics,
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
    calendar: Array.isArray(raw?.calendar) ? raw.calendar.filter(day => day && typeof day.date === 'string').map(day => ({
      date: day.date,
      tokens: Number(day.tokens) || 0,
      costUsd: typeof day.costUsd === 'number' && Number.isFinite(day.costUsd) ? day.costUsd : null,
      reportedCostUsd: Number(day.reportedCostUsd) || 0,
      estimatedCostUsd: Number(day.estimatedCostUsd) || 0,
      turns: Number(day.turns) || 0,
      accepted: Number(day.accepted) || 0,
      rejected: Number(day.rejected) || 0,
      commented: Number(day.commented) || 0,
      annotationsCreated: Number(day.annotationsCreated) || 0,
    })) : [],
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

function spendPrefix(figures: Pick<ActivityMetrics, 'costUsd' | 'reportedCostUsd' | 'estimatedCostUsd'>): string {
  return figures.costUsd !== null && figures.reportedCostUsd === 0 && figures.estimatedCostUsd > 0 ? '~' : '';
}

function metricValue(day: ActivityCalendarDay, metric: TrendMetric): number {
  if (metric === 'tokens') return day.tokens;
  if (metric === 'spend') return day.costUsd ?? 0;
  if (metric === 'turns') return day.turns;
  return day.accepted + day.rejected + day.commented + day.annotationsCreated;
}

function metricParts(day: ActivityCalendarDay, metric: TrendMetric): string[] {
  if (metric === 'tokens') return [t('{tokens} tokens', { tokens: formatCompactTokens(day.tokens) })];
  if (metric === 'spend') return [formatUsd(day.costUsd, spendPrefix(day))];
  if (metric === 'turns') return [tn(day.turns, '{n} run', '{n} runs')];
  return [
    `+${formatExactNumber(day.accepted)} / −${formatExactNumber(day.rejected)}`,
    ...(day.commented > 0 ? [tn(day.commented, '{n} comment', '{n} comments')] : []),
    tn(day.annotationsCreated, '{n} annotation', '{n} annotations'),
  ];
}

// Calendar dates are plain YYYY-MM-DD days, counted in whole UTC days so no
// time zone or daylight saving shift can move a cell.
const DAY_MS = 86_400_000;
const WEEKS = ACTIVITY_CALENDAR_DAYS / 7;
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const dayDate = (day: number) => new Date(day * DAY_MS);
const weekday = (day: number) => dayDate(day).getUTCDay();

function blankCalendarDay(date: string): ActivityCalendarDay {
  return { date, tokens: 0, costUsd: null, reportedCostUsd: 0, estimatedCostUsd: 0, turns: 0, accepted: 0, rejected: 0, commented: 0, annotationsCreated: 0 };
}

// The locale's first day of the week (0 = Sunday). Intl.Locale week info is
// not in every browser yet, so weeks start on Monday without it.
function firstDayOfWeek(language: string): number {
  try {
    const tag = new Intl.Locale(language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const firstDay = (tag.getWeekInfo?.() ?? tag.weekInfo)?.firstDay;
    if (firstDay) return firstDay % 7;
  } catch {
    // An unknown language tag keeps the default.
  }
  return 1;
}

function weekdayName(dow: number): string {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dow)));
}

// Shades rank the distinct nonzero values, like GitHub's quartiles, so one very
// large day does not wash every other day out to the palest shade, equal days
// share a shade, and a lone active day gets the darkest.
function heatLevels(values: number[]): (value: number) => number {
  const sorted = [...new Set(values.filter(value => value > 0))].sort((a, b) => a - b);
  return value => {
    if (value <= 0 || !sorted.length) return 0;
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, Math.ceil((4 * lo) / sorted.length));
  };
}

function streaks(activeDays: number[], today: number): { longest: number; current: number } {
  const active = new Set(activeDays);
  let longest = 0, run = 0;
  for (const day of activeDays) {
    run = active.has(day - 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  // A streak that reached yesterday still counts until today is over.
  let day = active.has(today) ? today : today - 1, current = 0;
  while (active.has(day)) { current++; day--; }
  return { longest, current };
}

type HeatTip = { x: number; y: number; align: 'start' | 'center' | 'end'; title: string[]; detail: string };

function placeTip(card: HTMLElement | null, cell: Element, title: string[], detail: string): HeatTip | null {
  if (!card) return null;
  const box = card.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - box.left;
  return { x, y: rect.top - box.top, align: x < box.width * 0.2 ? 'start' : x > box.width * 0.8 ? 'end' : 'center', title, detail };
}

function HeatTooltip({ tip }: { tip: HeatTip | null }) {
  if (!tip) return null;
  return <div className="activity-heat-tip" data-align={tip.align} aria-hidden="true" style={{ '--tip-x': `${tip.x}px`, '--tip-y': `${tip.y}px` } as CSSProperties}>
    <strong>{tip.title.map((part, index) => <span key={index}>{part}</span>)}</strong>
    <span>{tip.detail}</span>
  </div>;
}

function HeatLegend() {
  return <div className="activity-heat-legend" aria-hidden="true">
    {/* i18n: Heatmap legend, read as "Less [five shades] More" (paler cells mean less activity); pair it with the existing "More". */}
    <span>{t('Less')}</span>
    {[0, 1, 2, 3, 4].map(level => <i key={level} className="activity-heat-swatch" data-level={level}/>)}
    <span>{t('More')}</span>
  </div>;
}

function YearHeatmap({ calendar, today, metric, selectedDate, onSelect, children }: {
  calendar: ActivityCalendarDay[];
  today: string;
  metric: TrendMetric;
  selectedDate: string | null;
  onSelect: (date: string) => void;
  children?: ReactNode;
}) {
  const language = locale();
  const weekStart = useMemo(() => firstDayOfWeek(language), [language]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<HeatTip | null>(null);

  const end = dayNumber(today);
  const first = end - ((weekday(end) - weekStart + 7) % 7) - 7 * (WEEKS - 1);
  const byDay = useMemo(() => new Map(calendar.map(day => [dayNumber(day.date), day])), [calendar]);
  const visible = useMemo(() => [...byDay.keys()].filter(day => day >= first && day <= end).sort((a, b) => a - b), [byDay, end, first]);
  const level = useMemo(() => heatLevels(visible.map(day => metricValue(byDay.get(day)!, metric))), [byDay, metric, visible]);
  const { longest, current } = useMemo(() => streaks(visible, end), [end, visible]);
  const selected = selectedDate ? dayNumber(selectedDate) : null;
  const tabStop = selected !== null && selected >= first && selected <= end ? selected : end;

  // Month labels head the first week column that starts in a new month; a
  // label with less than three columns of room before the next is left out.
  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
    const starts: { column: number; label: string }[] = [];
    let previous = -1;
    for (let column = 0; column < WEEKS; column++) {
      const month = dayDate(first + column * 7).getUTCMonth();
      if (month !== previous) starts.push({ column, label: format.format(dayDate(first + column * 7)) });
      previous = month;
    }
    return starts.map((start, index) => {
      const span = (starts[index + 1]?.column ?? WEEKS) - start.column;
      return { ...start, span, label: span >= 3 ? start.label : '' };
    });
  }, [first, language]);

  const dayOf = (day: number) => byDay.get(day) ?? blankCalendarDay(dayDate(day).toISOString().slice(0, 10));
  const cellLabel = (day: number) => `${formatDateLabel(dayOf(day).date)}: ${metricParts(dayOf(day), metric).join(', ')}`;
  const showTip = (cell: Element | null) => {
    const date = cell instanceof HTMLElement ? cell.dataset.date : undefined;
    if (!cell || !date) return setTip(null);
    const entry = dayOf(dayNumber(date));
    setTip(placeTip(cardRef.current, cell, metricParts(entry, metric), formatDateLabel(entry.date)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.key === 'Escape' && tip) {
      event.preventDefault();
      event.stopPropagation();
      setTip(null);
      return;
    }
    const focused = event.target instanceof HTMLElement ? event.target.dataset.date : undefined;
    if (!focused || event.altKey || event.ctrlKey || event.metaKey) return;
    const day = dayNumber(focused);
    const row = (day - first) % 7;
    const lastInRow = first + row + 7 * Math.floor((end - first - row) / 7);
    const target = event.key === 'ArrowUp' ? (row > 0 ? day - 1 : null)
      : event.key === 'ArrowDown' ? (row < 6 && day < end ? day + 1 : null)
      : event.key === 'ArrowLeft' ? (day - 7 >= first ? day - 7 : null)
      : event.key === 'ArrowRight' ? (day + 7 <= end ? day + 7 : null)
      : event.key === 'Home' ? first + row
      : event.key === 'End' ? lastInRow
      : null;
    // Leave keys with nowhere to go to the browser, so it can still scroll.
    if (target === null || target === day) return;
    event.preventDefault();
    const date = dayDate(target).toISOString().slice(0, 10);
    onSelect(date);
    const cell = event.currentTarget.querySelector<HTMLElement>(`[data-date="${date}"]`);
    cell?.focus();
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    showTip(cell);
  };

  return <div ref={cardRef} className="activity-chart-box activity-year">
    <div className="activity-heatmap-scroll">
      <table
        className="activity-heatmap"
        role="grid"
        aria-label={t('Past year')}
        aria-readonly="true"
        onKeyDown={onKeyDown}
        onPointerOver={(event: PointerEvent<HTMLTableElement>) => { if (event.pointerType === 'mouse') showTip((event.target as Element).closest('[data-date]')); }}
        onPointerLeave={() => setTip(null)}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTip(null); }}
      >
        <colgroup>
          <col className="activity-heatmap-label-column"/>
          {Array.from({ length: WEEKS }, (_, column) => <col key={column}/>)}
        </colgroup>
        <thead>
          <tr>
            <td/>
            {months.map(month => <th key={month.column} scope="colgroup" colSpan={month.span}><span>{month.label}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 7 }, (_, row) => {
            const dow = (weekStart + row) % 7;
            return <tr key={row}>
              <th scope="row"><span className={dow === 1 || dow === 3 || dow === 5 ? undefined : 'sr-only'}>{weekdayName(dow)}</span></th>
              {Array.from({ length: WEEKS }, (_, column) => {
                const day = first + column * 7 + row;
                if (day > end) return <td key={column} className="activity-heat-future"/>;
                const entry = dayOf(day);
                return <td
                  key={column}
                  className="activity-heat-cell"
                  data-date={entry.date}
                  data-level={level(metricValue(entry, metric))}
                  tabIndex={day === tabStop ? 0 : -1}
                  aria-selected={day === selected}
                  aria-label={cellLabel(day)}
                  onClick={() => onSelect(entry.date)}
                  onFocus={event => { if (event.currentTarget.matches(':focus-visible')) showTip(event.currentTarget); }}
                />;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className="activity-year-footer">
      <dl className="activity-streaks">
        {/* i18n: The most consecutive active days in the past year, shown above a length such as "12 days". */}
        <div><dt>{t('Longest streak')}</dt><dd>{tn(longest, '{n} day', '{n} days')}</dd></div>
        {/* i18n: Consecutive active days up to today or yesterday, shown above a length such as "3 days". */}
        <div><dt>{t('Current streak')}</dt><dd>{tn(current, '{n} day', '{n} days')}</dd></div>
      </dl>
      <HeatLegend/>
    </div>
    {children}
    <HeatTooltip tip={tip}/>
  </div>;
}

// Weekday by hour of the selected range, in local time: when the author
// works, folded over every week of the range.
function HourHeatmap({ days, summary }: { days: ActivityDay[]; summary: string }) {
  const language = locale();
  const weekStart = useMemo(() => firstDayOfWeek(language), [language]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<HeatTip | null>(null);
  const grid = useMemo(() => {
    const blank = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const events = blank(), turns = blank(), tokens = blank();
    for (const day of days) {
      const dow = weekday(dayNumber(day.date));
      for (let hour = 0; hour < 24; hour++) {
        events[dow][hour] += day.hours[hour];
        turns[dow][hour] += day.turnHours[hour];
        tokens[dow][hour] += day.tokenHours[hour];
      }
    }
    return { events, turns, tokens, level: heatLevels(events.flat()) };
  }, [days]);

  const showTip = (cell: Element | null) => {
    const dow = cell instanceof HTMLElement ? Number(cell.dataset.dow) : NaN;
    const hour = cell instanceof HTMLElement ? Number(cell.dataset.hour) : NaN;
    if (!cell || Number.isNaN(dow) || Number.isNaN(hour)) return setTip(null);
    setTip(placeTip(
      cardRef.current,
      cell,
      [
        // i18n: Things done in one hour of the week: agent runs, review decisions, your annotations, saved tasks and commits.
        tn(grid.events[dow][hour], '{n} action', '{n} actions'),
        tn(grid.turns[dow][hour], '{n} run', '{n} runs'),
        t('{tokens} tokens', { tokens: formatCompactTokens(grid.tokens[dow][hour]) }),
      ],
      `${weekdayName(dow)} ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`,
    ));
  };

  return <div ref={cardRef} className="activity-chart-box activity-hours">
    <div
      className="activity-hour-grid"
      role="img"
      aria-label={summary}
      onPointerOver={event => { if (event.pointerType === 'mouse') showTip((event.target as Element).closest('[data-hour]')); }}
      onPointerLeave={() => setTip(null)}
    >
      {Array.from({ length: 7 }, (_, row) => {
        const dow = (weekStart + row) % 7;
        return <Fragment key={dow}>
          <span className="activity-hour-day">{weekdayName(dow)}</span>
          {grid.events[dow].map((count, hour) => <span key={hour} className="activity-heat-cell" data-dow={dow} data-hour={hour} data-level={grid.level(count)}/>)}
        </Fragment>;
      })}
      <span/>
      {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => <span key={hour} className="activity-hour-tick">{hourLabel(hour)}</span>)}
    </div>
    <HeatTooltip tip={tip}/>
  </div>;
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
          {formatUsd(day.costUsd, spendPrefix(day))}
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

  const spendEstimateOnly = spendPrefix(totals) === '~';
  const spendMixed = totals.reportedCostUsd > 0 && totals.estimatedCostUsd > 0;
  const decisionTotal = totals.accepted + totals.rejected;
  const acceptRate = decisionTotal > 0 ? Math.round((totals.accepted / decisionTotal) * 100) : null;
  const emptyWorkspace = totals.activeDays === 0 && totals.tokens.total === 0 && totals.turns === 0 && decisionTotal === 0 && totals.annotationsCreated === 0;
  // The day readout under the heatmap: the chosen day, else the latest active one.
  const shownDate = selectedDate ?? current.calendar.at(-1)?.date ?? null;
  const shownDay = shownDate ? current.calendar.find(day => day.date === shownDate) ?? blankCalendarDay(shownDate) : null;
  const peakWindow = peakHour !== null ? `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` : null;
  const calendarActiveDays = current.calendar.filter(day => dayNumber(day.date) > dayNumber(current.today) - 365).length;

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
            onClick={() => setRange(option)}
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
          <h3>{t('Past year')}</h3>
          <p className="activity-section-subtitle">
            {tn(calendarActiveDays, '{n} active day', '{n} active days')}
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

      <YearHeatmap
        calendar={current.calendar}
        today={current.today}
        metric={metric}
        selectedDate={shownDate}
        onSelect={setSelectedDate}
      >
        {shownDay && (
          <div className="activity-selected-day">
            <strong>{formatDateLabel(shownDay.date)}</strong>
            <div className="activity-selected-metrics">
              <span>{t('Tokens')}: {formatCompactTokens(shownDay.tokens)}</span>
              <span>{t('Spend')}: {formatUsd(shownDay.costUsd, spendPrefix(shownDay))}</span>
              <span>{t('Agent runs')}: {formatExactNumber(shownDay.turns)}</span>
              <span>{t('Accept / Reject')}: +{formatExactNumber(shownDay.accepted)} / −{formatExactNumber(shownDay.rejected)}</span>
              <span>{t('Annotations')}: {formatExactNumber(shownDay.annotationsCreated)}</span>
            </div>
          </div>
        )}
      </YearHeatmap>
    </section>

    <section className="activity-section">
      <div className="activity-section-head">
        <div className="activity-section-title-group">
          <h3>{t('Active hours')}</h3>
          <p className="activity-section-subtitle">
            {[
              t('Local time ({timezone})', { timezone: current.timezone }),
              peakWindow ? t('Peak {window}', { window: peakWindow }) : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <HourHeatmap
        days={current.days}
        summary={peakWindow ? t('Active hours, peak {window}', { window: peakWindow }) : t('Active hours')}
      />
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
