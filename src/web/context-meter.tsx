import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ContextUsage } from '../shared.ts';
import { locale, t } from './i18n.ts';
import { viewOf } from './owner-window.ts';

// How full the agent's context window is: a ring beside Send. Hovering it
// gives the exact counts; clicking opens what fills the window, when the
// agent can tell the parts apart (Papilot Writer names them; for Codex, the
// latest request's input, cached input and output).

const PARTS: Record<string, () => string> = {
  system: () => t('System prompt'), tools: () => t('Tools'), map: () => t('Paper maps'), messages: () => t('Your messages'),
  replies: () => t('Replies'), toolCalls: () => t('Tool calls'), toolResults: () => t('Tool results'), summaries: () => t('Summaries of earlier turns'),
  cached: () => t('Cached input'), input: () => t('New input'), output: () => t('Output'),
  reserve: () => t('Compaction reserve'), free: () => t('Free space'),
};
// Room that is not used yet is drawn quietly.
const EMPTY = new Set(['reserve', 'free']);

export function ContextMeter({ usage }: { usage?: ContextUsage | null }) {
  const id = useId(), panel = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return;
    // Above the ring, inside the window.
    const rect = button.current.getBoundingClientRect(), box = panel.current;
    box.style.left = `${Math.max(8, Math.min(rect.right - box.offsetWidth, viewOf(box).innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, rect.top - box.offsetHeight - 8)}px`;
  }, [open, usage]);
  if (!usage?.window) return null;
  const share = Math.min(1, usage.tokens / usage.window), percent = Math.round(share * 100);
  const exact = (n: number) => n.toLocaleString(locale()), compact = (n: number) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const summary = t('Context {percent}% full: {tokens} of {window} tokens', { percent, tokens: exact(usage.tokens), window: exact(usage.window) });
  const tone = share >= 0.9 ? ' critical' : share >= 0.75 ? ' warning' : '';
  const parts = (usage.breakdown || []).filter(part => part.tokens > 0);
  const r = 8, length = 2 * Math.PI * r;
  return <span className="context-meter-wrap">
    <button ref={button} type="button" className={'context-meter' + tone} aria-label={summary} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => panel.current?.matches(':popover-open') ? panel.current.hidePopover() : (panel.current?.showPopover(), setOpen(true))}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r={r}/><circle className="context-meter-fill" cx="10" cy="10" r={r} strokeDasharray={`${share * length} ${length}`} transform="rotate(-90 10 10)"/></svg>
      <span className="context-meter-value">{percent}%</span>
    </button>
    {!open && <span className="context-meter-tip" role="tooltip">{t('{tokens} of {window} tokens', { tokens: exact(usage.tokens), window: exact(usage.window) })}</span>}
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={t('Context')} className="context-panel" onToggle={event => setOpen((event.nativeEvent as ToggleEvent).newState === 'open')}>
      <div className="context-panel-head"><strong>{t('Context')}</strong></div>
      <div className="context-panel-total"><span>{t('{percent}% used', { percent })}</span><span>{compact(usage.tokens)} / {compact(usage.window)}</span></div>
      <div className="context-bar" aria-hidden="true">{(parts.length ? parts : [{ id: 'used', tokens: usage.tokens }, { id: 'free', tokens: usage.window - usage.tokens }]).map(part =>
        <span key={part.id} data-part={part.id} style={{ flexGrow: part.tokens }}/>)}</div>
      {parts.length > 0 && <table className="context-parts"><tbody>{parts.map(part => <tr key={part.id} data-part={part.id} className={EMPTY.has(part.id) ? 'empty' : ''}>
        <td><i aria-hidden="true"/>{PARTS[part.id]?.() || part.id}</td><td>{exact(part.tokens)}</td><td>{(part.tokens / usage.window * 100).toFixed(1)}%</td>
      </tr>)}</tbody></table>}
      <p className="context-panel-note">{usage.breakdown?.some(part => part.id === 'system')
        ? t('The total is what the model provider counted for the latest request; the parts are estimated from their text. Earlier turns are summarized when the context reaches the compaction reserve.')
        : t('The total is what the model provider counted for the latest request.')}</p>
    </div>
  </span>;
}
