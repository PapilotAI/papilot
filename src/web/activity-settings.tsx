import { type CSSProperties, Fragment, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { ShareDialog, type ShareCard, type ShareFigure } from './activity-share.tsx';
import { agentLabel } from './agent-choice.ts';
import { BrandIcon } from './brand-icon.tsx';
import { ChipSelect } from './chip-select.tsx';
import { errorText, locale, t, tn } from './i18n.ts';
import { Icon } from './icons.tsx';
import { PapilotMark } from './papilot-mark.tsx';
import './activity-settings.css';

export type LoadActivity = (params: { tz: string; range: ActivityRange; projectId?: string }, signal: AbortSignal) => Promise<ActivityReport>;

// Time saved counts each accepted change as the minutes it would take by hand:
// finding the passage in the source, rewriting it, rebuilding and checking the PDF.
const MINUTES_PER_CHANGE = 2;

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
  agentMs: 0,
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
      actions: Number(day.actions) || 0,
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

// Counted phrases are translated whole ("162 days", "162 天") with a marker in
// place of the number, so the number can be set large in the language's order.
const MARK = '⁣';

function figure(value: string, phrase: string, label: string): ShareFigure {
  const [before = '', after = ''] = phrase.split(MARK);
  return { before: before.trim(), value, after: after.trim(), label };
}

const figureText = (shown: ShareFigure) => [shown.before, shown.value, shown.after].filter(Boolean).join(' ');

function daysFigure(count: number, label: string) {
  return figure(formatExactNumber(count), tn(count, '{n} day', '{n} days', { n: MARK }), label);
}

function changesFigure(count: number, label: string) {
  return figure(formatExactNumber(count), tn(count, '{n} change', '{n} changes', { n: MARK }), label);
}

// Minutes below an hour; hours with one decimal below ten, whole hours above.
function durationFigure(ms: number, label: string, estimate = false) {
  const minutes = ms / 60_000, prefix = estimate && ms > 0 ? '~' : '';
  if (minutes < 60) {
    const count = Math.round(minutes);
    return figure(prefix + formatExactNumber(count), tn(count, '{n} minute', '{n} minutes', { n: MARK }), label);
  }
  const hours = minutes / 60, count = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return figure(prefix + count.toLocaleString(locale()), tn(count, '{n} hour', '{n} hours', { n: MARK }), label);
}

function Figure({ shown }: { shown: ShareFigure }) {
  return <span className="activity-figure">
    {shown.before && <span className="activity-figure-unit">{shown.before}</span>}
    <strong>{shown.value}</strong>
    {shown.after && <span className="activity-figure-unit">{shown.after}</span>}
  </span>;
}

// The label comes first for screen readers; CSS sets the number above it.
function Stat({ shown, className }: { shown: ShareFigure; className?: string }) {
  return <div className={className ? `activity-stat ${className}` : 'activity-stat'}>
    <dt>{shown.label}</dt>
    <dd><Figure shown={shown}/></dd>
  </div>;
}

function Fact({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return <div className="activity-fact">
    <dt>{label}</dt>
    <dd>{children}{note && <span className="activity-fact-note">{note}</span>}</dd>
  </div>;
}

function dayParts(day: ActivityCalendarDay): string[] {
  return [
    tn(day.actions, '{n} action', '{n} actions'),
    ...(day.turns ? [tn(day.turns, '{n} run', '{n} runs')] : []),
    ...(day.accepted || day.rejected ? [`+${formatExactNumber(day.accepted)} / −${formatExactNumber(day.rejected)}`] : []),
    ...(day.tokens ? [t('{tokens} tokens', { tokens: formatCompactTokens(day.tokens) })] : []),
  ];
}

// Calendar dates are plain YYYY-MM-DD days, counted in whole UTC days so no
// time zone or daylight saving shift can move a cell.
const DAY_MS = 86_400_000;
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const dayDate = (day: number) => new Date(day * DAY_MS);
const weekday = (day: number) => dayDate(day).getUTCDay();

function blankCalendarDay(date: string): ActivityCalendarDay {
  return { date, actions: 0, tokens: 0, costUsd: null, reportedCostUsd: 0, estimatedCostUsd: 0, turns: 0, accepted: 0, rejected: 0, commented: 0, annotationsCreated: 0 };
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

function weekdayName(dow: number, width: 'short' | 'narrow' = 'short'): string {
  return new Intl.DateTimeFormat(locale(), { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dow)));
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

// Consecutive active days: the longest since the range starts, and the current
// streak, which still counts until today is over when it reached yesterday.
function streaks(days: number[], today: number, from: number | null): { longest: number; current: number } {
  const active = new Set(days);
  let longest = 0, run = 0;
  for (const day of days) {
    if (from !== null && day < from) continue;
    run = active.has(day - 1) && (from === null || day - 1 >= from) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let day = active.has(today) ? today : today - 1, current = 0;
  while (active.has(day)) { current++; day--; }
  return { longest, current };
}

// The week columns ending `page` pages before the current week.
function calendarWindow(today: string, weekStart: number, weeks: number, page: number) {
  const end = dayNumber(today);
  const first = end - ((weekday(end) - weekStart + 7) % 7) - 7 * (weeks - 1) - 7 * weeks * page;
  return { end, first, last: first + 7 * weeks - 1 };
}

// Month names head the first week column that starts in a new month; a name
// with less than three columns of room before the next is left out.
function monthLabels(first: number, weeks: number, language: string) {
  const format = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
  const starts: { column: number; label: string }[] = [];
  let previous = -1;
  for (let column = 0; column < weeks; column++) {
    const month = dayDate(first + column * 7).getUTCMonth();
    if (month !== previous) starts.push({ column, label: format.format(dayDate(first + column * 7)) });
    previous = month;
  }
  return starts.map((start, index) => {
    const span = (starts[index + 1]?.column ?? weeks) - start.column;
    return { ...start, span, label: span >= 3 ? start.label : '' };
  });
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

const CELL = 20, GAP = 4, LABEL = 22;

function ActivityCalendar({ calendar, today, from, children }: { calendar: ActivityCalendarDay[]; today: string; from: number | null; children: ReactNode }) {
  const language = locale();
  const weekStart = useMemo(() => firstDayOfWeek(language), [language]);
  const cardRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [tip, setTip] = useState<HeatTip | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setPage(0), [calendar]);

  // As many weeks as fit at about 20px squares: a quarter on a phone, half a
  // year in Settings. The arrows page back through earlier weeks.
  const weeks = width ? Math.max(8, Math.min(53, Math.floor((width - LABEL + GAP) / (CELL + GAP)))) : 24;
  const { end, first, last } = calendarWindow(today, weekStart, weeks, page);
  const shownEnd = Math.min(last, end);
  const byDay = useMemo(() => new Map(calendar.map(day => [dayNumber(day.date), day])), [calendar]);
  const level = useMemo(() => heatLevels(calendar.map(day => day.actions)), [calendar]);
  const earliest = calendar.length ? dayNumber(calendar[0].date) : end;
  const months = useMemo(() => monthLabels(first, weeks, language), [first, weeks, language]);
  const period = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', timeZone: 'UTC' }).formatRange(dayDate(first), dayDate(shownEnd));

  const dayOf = (day: number) => byDay.get(day) ?? blankCalendarDay(dayDate(day).toISOString().slice(0, 10));
  const showTip = (cell: Element | null) => {
    const date = cell instanceof HTMLElement ? cell.dataset.date : undefined;
    if (!cell || !date) return setTip(null);
    const entry = dayOf(dayNumber(date));
    setTip(placeTip(cardRef.current, cell, dayParts(entry), formatDateLabel(entry.date)));
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
    const lastInRow = first + row + 7 * Math.floor((shownEnd - first - row) / 7);
    const target = event.key === 'ArrowUp' ? (row > 0 ? day - 1 : null)
      : event.key === 'ArrowDown' ? (row < 6 && day < shownEnd ? day + 1 : null)
      : event.key === 'ArrowLeft' ? (day - 7 >= first ? day - 7 : null)
      : event.key === 'ArrowRight' ? (day + 7 <= shownEnd ? day + 7 : null)
      : event.key === 'Home' ? first + row
      : event.key === 'End' ? lastInRow
      : null;
    // Leave keys with nowhere to go to the browser, so it can still scroll.
    if (target === null || target === day) return;
    event.preventDefault();
    const cell = event.currentTarget.querySelector<HTMLElement>(`[data-date="${dayDate(target).toISOString().slice(0, 10)}"]`);
    cell?.focus();
    showTip(cell);
  };

  return <section ref={cardRef} className="activity-calendar" aria-label={t('Activity')}>
    {children}
    <div ref={gridRef} className="activity-calendar-grid">
      <table
        className="activity-heatmap"
        role="grid"
        aria-label={period}
        aria-readonly="true"
        style={{ '--weeks': weeks } as CSSProperties}
        onKeyDown={onKeyDown}
        onPointerOver={event => { if (event.pointerType === 'mouse') showTip((event.target as Element).closest('[data-date]')); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse') setTip(null); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTip(null); }}
      >
        <colgroup>
          <col className="activity-heatmap-label-column"/>
          {Array.from({ length: weeks }, (_, column) => <col key={column}/>)}
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
              <th scope="row"><abbr title={weekdayName(dow)}>{weekdayName(dow, 'narrow')}</abbr></th>
              {Array.from({ length: weeks }, (_, column) => {
                const day = first + column * 7 + row;
                if (day > end) return <td key={column} className="activity-heat-future"/>;
                const entry = dayOf(day);
                return <td
                  key={column}
                  className="activity-heat-cell"
                  data-date={entry.date}
                  data-level={level(entry.actions)}
                  data-outside={from !== null && day < from ? '' : undefined}
                  tabIndex={day === shownEnd ? 0 : -1}
                  aria-label={`${formatDateLabel(entry.date)}: ${dayParts(entry).join(', ')}`}
                  onClick={event => showTip(event.currentTarget)}
                  onFocus={event => { if (event.currentTarget.matches(':focus-visible')) showTip(event.currentTarget); }}
                />;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className="activity-calendar-footer">
      <HeatLegend/>
      <div className="activity-pager">
        <button type="button" className="icon-button" aria-label={t('Earlier weeks')} disabled={first <= earliest} onClick={() => { setTip(null); setPage(page + 1); }}><Icon name="chevronLeft" size={15}/></button>
        <span>{period}</span>
        <button type="button" className="icon-button" aria-label={t('Later weeks')} disabled={page === 0} onClick={() => { setTip(null); setPage(page - 1); }}><Icon name="chevronRight" size={15}/></button>
      </div>
    </div>
    <HeatTooltip tip={tip}/>
  </section>;
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

  return <div ref={cardRef} className="activity-hours">
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

function Detail({ title, headline, children }: { title: string; headline: ReactNode; children: ReactNode }) {
  return <details className="activity-detail">
    <summary>
      <Icon name="chevronRight" size={14}/>
      <span className="activity-detail-title">{title}</span>
      <span className="activity-detail-headline">{headline}</span>
    </summary>
    <div className="activity-detail-body">{children}</div>
  </details>;
}

function ShareBar({ value, max }: { value: number; max: number }) {
  return <span className="activity-share-bar" aria-hidden="true"><span style={{ '--share': `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` } as CSSProperties}/></span>;
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
  const [range, setRange] = useState<ActivityRange>('all');
  const [projectId, setProjectId] = useState<string>('all');
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const requestSeq = useRef(0);
  const pageRef = useRef<HTMLDivElement | null>(null);

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
  const language = locale();

  const activeDaysDesc = useMemo(() => [...current.days].filter(hasAnyActivity).reverse(), [current.days]);
  const peakHour = useMemo(() => peakHourIndex(current.hours), [current.hours]);
  const peakWindow = peakHour !== null ? `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` : null;

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

  const today = dayNumber(current.today);
  const rangeDays = current.range === '7d' ? 7 : current.range === '30d' ? 30 : current.range === '90d' ? 90 : 0;
  const from = rangeDays ? today - rangeDays + 1 : null;
  const activeDays = useMemo(() => current.calendar.map(day => dayNumber(day.date)), [current.calendar]);
  const streak = useMemo(() => streaks(activeDays, today, from), [activeDays, today, from]);

  const decisionTotal = totals.accepted + totals.rejected;
  const acceptRate = decisionTotal > 0 ? Math.round((totals.accepted / decisionTotal) * 100) : null;
  const emptyWorkspace = totals.activeDays === 0 && totals.tokens.total === 0 && totals.turns === 0 && decisionTotal === 0 && totals.annotationsCreated === 0;
  const savedMs = totals.accepted * MINUTES_PER_CHANGE * 60_000;

  const insights = [
    durationFigure(savedMs, t('Time saved'), true),
    changesFigure(totals.accepted, t('Accepted changes')),
    changesFigure(totals.rejected, t('Rejected changes')),
    durationFigure(totals.agentMs, t('Agent time')),
  ];
  const calendarStats = [
    daysFigure(totals.activeDays, t('Active days')),
    daysFigure(streak.current, t('Current streak')),
    daysFigure(streak.longest, t('Longest streak')),
  ];

  // The shared image: the same figures, and the latest 26 weeks of activity.
  const shareCard = useMemo<ShareCard>(() => {
    const weekStart = firstDayOfWeek(language), weeks = 26;
    const { end, first } = calendarWindow(current.today, weekStart, weeks, 0);
    const byDay = new Map(current.calendar.map(day => [dayNumber(day.date), day]));
    const level = heatLevels(current.calendar.map(day => day.actions));
    const [saved, ...figures] = insights;
    return {
      period: rangeLabels[current.range],
      date: formatDateLabel(current.today),
      hero: saved,
      figures: [...figures, calendarStats[0]],
      streaks: calendarStats.slice(1),
      weekdays: Array.from({ length: 7 }, (_, row) => weekdayName((weekStart + row) % 7, 'narrow')),
      months: monthLabels(first, weeks, language).filter(month => month.label),
      weeks: Array.from({ length: weeks }, (_, column) => Array.from({ length: 7 }, (_, row) => {
        const day = first + column * 7 + row;
        return day > end ? null : level(byDay.get(day)?.actions ?? 0);
      })),
      less: t('Less'),
      more: t('More'),
      alt: [saved, ...figures, ...calendarStats].map(shown => `${shown.label} ${figureText(shown)}`).join(', '),
      fileName: `papilot-${current.today}.png`,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, language]);

  const tokenParts = [
    { id: 'input', label: t('Input'), value: totals.tokens.input },
    { id: 'cached', label: t('Cached'), value: totals.tokens.cached },
    { id: 'cacheWrite', label: t('Cache write'), value: totals.tokens.cacheWrite },
    { id: 'output', label: t('Output'), value: totals.tokens.output },
  ].filter(part => part.value > 0);
  const topAgent = current.agents[0];
  const maxAgentTokens = Math.max(0, ...current.agents.map(entry => entry.tokens.total));
  const maxModelTokens = Math.max(0, ...current.models.map(entry => entry.tokens.total));
  const primaryDays = activeDaysDesc.slice(0, 14);
  const olderDays = activeDaysDesc.slice(14);
  const tableHead = <thead>
    <tr>
      <th scope="col">{t('Date')}</th>
      <th scope="col" className="num">{t('Tokens')}</th>
      <th scope="col" className="num">{t('Spend')}</th>
      <th scope="col" className="num">{t('Agent runs')}</th>
      <th scope="col" className="num">{t('Accept / Reject')}</th>
      <th scope="col" className="num">{t('Annotations')}</th>
      <th scope="col" className="num">{t('Peak hour')}</th>
    </tr>
  </thead>;

  return <div ref={pageRef} className="settings-page activity-settings">
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
            onChange={value => setProjectId(value)}
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
        <button type="button" className="activity-share-button" disabled={!report || emptyWorkspace} onClick={() => setSharing(true)}>
          <Icon name="share" size={14}/>{t('Share')}
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

    <dl className="activity-insights" aria-label={t('Summary metrics')}>
      {insights.map(shown => <Stat key={shown.label} shown={shown} className="activity-insight"/>)}
    </dl>

    <ActivityCalendar calendar={current.calendar} today={current.today} from={from}>
      <dl className="activity-calendar-stats">
        {calendarStats.map(shown => <Stat key={shown.label} shown={shown}/>)}
      </dl>
    </ActivityCalendar>

    <div className="activity-details">
      <Detail title={t('Reviews & notes')} headline={acceptRate !== null ? t('{rate}% accepted', { rate: acceptRate }) : t('No changes decided yet')}>
        <dl className="activity-facts">
          <Fact label={t('Accepted changes')}>{formatExactNumber(totals.accepted)}</Fact>
          <Fact label={t('Rejected changes')}>{formatExactNumber(totals.rejected)}</Fact>
          <Fact label={t('Review comments')}>{formatExactNumber(totals.commented)}</Fact>
          <Fact label={t('Undone')}>{formatExactNumber(totals.undone)}</Fact>
          <Fact label={t('Saved tasks')}>{formatExactNumber(totals.tasksApplied + totals.tasksCommitted)}</Fact>
          <Fact label={t('Git commits')}>{formatExactNumber(totals.gitCommits)}</Fact>
          <Fact label={t('Annotations')}>{formatExactNumber(totals.annotationsCreated)}</Fact>
          <Fact label={t('Sent to tasks')}>{formatExactNumber(totals.annotationsSent)}</Fact>
          <Fact label={t('Time saved')} note={t('{count} changes × {minutes} min', { count: formatExactNumber(totals.accepted), minutes: MINUTES_PER_CHANGE })}>{figureText(insights[0])}</Fact>
        </dl>
      </Detail>

      <Detail title={t('Tokens & spend')} headline={<>
        <span>{formatCompactTokens(totals.tokens.total)}</span>
        <span>{formatUsd(totals.costUsd, spendPrefix(totals))}</span>
      </>}>
        {tokenParts.length > 0 && <div className="activity-token-bar" aria-hidden="true">
          {tokenParts.map(part => <span key={part.id} data-part={part.id} style={{ flexGrow: part.value }}/>)}
        </div>}
        <dl className="activity-facts">
          {tokenParts.map(part => <Fact key={part.id} label={part.label}>
            <i className="activity-token-key" data-part={part.id} aria-hidden="true"/>{formatCompactTokens(part.value)}
          </Fact>)}
          {totals.tokens.reasoning > 0 && <Fact label={t('Reasoning')}>{formatCompactTokens(totals.tokens.reasoning)}</Fact>}
          <Fact label={t('Provider-reported spend')}>{formatUsd(totals.reportedCostUsd)}</Fact>
          <Fact label={t('API-equivalent model rates')} note={totals.unpricedTokens > 0 ? t('{tokens} unpriced', { tokens: formatCompactTokens(totals.unpricedTokens) }) : undefined}>
            {formatUsd(totals.estimatedCostUsd, totals.estimatedCostUsd > 0 ? '~' : '')}
          </Fact>
        </dl>
        <p className="activity-footnote">
          {t('Values marked with ~ are estimated from exact model API rates when an agent reports tokens without billing totals. Subscription plans may include this usage at no extra charge.')}
        </p>
      </Detail>

      {(current.agents.length > 0 || current.models.length > 0) && (
        <Detail title={t('Agents & models')} headline={topAgent ? <span className="activity-detail-agent"><AgentAvatar agent={topAgent.agent}/>{agentLabel(topAgent.agent)}</span> : null}>
          <div className="activity-breakdown-grid">
            {current.agents.length > 0 && (
              <div className="activity-list-card">
                <h4>{t('By agent')}</h4>
                <ul className="activity-breakdown-list" role="list">
                  {current.agents.map((entry: ActivityAgentSummary) => (
                    <li key={entry.agent} className="activity-breakdown-row">
                      <div className="activity-breakdown-name">
                        <AgentAvatar agent={entry.agent}/>
                        <span className="activity-truncate" title={agentLabel(entry.agent)}>{agentLabel(entry.agent)}</span>
                      </div>
                      <span className="activity-breakdown-stat">
                        {entry.tokens.total > 0 ? formatCompactTokens(entry.tokens.total) : tn(entry.turns, '{n} run', '{n} runs')}
                      </span>
                      <ShareBar value={entry.tokens.total} max={maxAgentTokens}/>
                      <span className="activity-breakdown-sub">
                        {[
                          tn(entry.turns, '{n} run', '{n} runs'),
                          entry.tasksStarted > 0 ? tn(entry.tasksStarted, '{n} task started', '{n} tasks started') : '',
                          entry.costUsd !== null ? formatUsd(entry.costUsd, spendPrefix(entry)) : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {current.models.length > 0 && (
              <div className="activity-list-card">
                <h4>{t('By model')}</h4>
                <ul className="activity-breakdown-list" role="list">
                  {current.models.map((entry: ActivityModelSummary) => (
                    <li key={`${entry.agent}:${entry.model}`} className="activity-breakdown-row">
                      <div className="activity-breakdown-name">
                        <AgentAvatar agent={entry.agent}/>
                        <span className="activity-truncate" title={entry.model}>{entry.model}</span>
                      </div>
                      <span className="activity-breakdown-stat">
                        {entry.tokens.total > 0 ? formatCompactTokens(entry.tokens.total) : tn(entry.turns, '{n} run', '{n} runs')}
                      </span>
                      <ShareBar value={entry.tokens.total} max={maxModelTokens}/>
                      <span className="activity-breakdown-sub">
                        {[
                          agentLabel(entry.agent),
                          tn(entry.turns, '{n} run', '{n} runs'),
                          entry.costUsd !== null ? formatUsd(entry.costUsd, entry.costSource === 'estimated' ? '~' : '') : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Detail>
      )}

      <Detail title={t('Active hours')} headline={peakWindow ? t('Peak {window}', { window: peakWindow }) : null}>
        <p className="activity-detail-caption">{t('Local time ({timezone})', { timezone: current.timezone })}</p>
        <HourHeatmap
          days={current.days}
          summary={peakWindow ? t('Active hours, peak {window}', { window: peakWindow }) : t('Active hours')}
        />
      </Detail>

      {activeDaysDesc.length > 0 && (
        <Detail title={t('Daily breakdown')} headline={tn(totals.activeDays, '{n} active day', '{n} active days')}>
          <div className="activity-table-container">
            <table className="activity-table">
              <caption className="sr-only">{t('Daily breakdown')}</caption>
              {tableHead}
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
                  {tableHead}
                  <tbody>
                    <DayRows days={olderDays}/>
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Detail>
      )}
    </div>

    {sharing && pageRef.current && <ShareDialog card={shareCard} source={pageRef.current} onClose={() => setSharing(false)}/>}
  </div>;
}
