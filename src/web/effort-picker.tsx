import { useEffect, useId, useRef, useState } from 'react';
import type { Effort } from '../shared.ts';
import { Icon } from './icons.tsx';

const names: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };
export const effortName = (id: string) => names[id] || id[0].toUpperCase() + id.slice(1);

// Reasoning effort as a stepped slider in a popover, from the least to the
// most thinking the model supports. An empty value means the model's default.
export function EffortPicker({ efforts, value, fallback, onChange, disabled }: { efforts: Effort[]; value: string; fallback: string | null; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), range = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => panel.current?.hidePopover();
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [open]);
  if (!efforts.length) return null;
  const current = efforts.find(e => e.id === value) || efforts.find(e => e.id === fallback) || efforts[0];
  const index = efforts.indexOf(current), last = Math.max(1, efforts.length - 1);
  // Stops sit where the 26px thumb's centre lands.
  const at = (step: number) => `calc(13px + ${step / last} * (100% - 26px))`;
  function show() {
    const box = panel.current!, rect = trigger.current!.getBoundingClientRect();
    box.showPopover();
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`;
    const below = rect.bottom + 6, above = rect.top - box.offsetHeight - 6;
    box.style.top = `${below + box.offsetHeight > window.innerHeight - 8 && above >= 8 ? above : below}px`;
    range.current?.focus();
  }
  return <span className="menu-anchor">
    <button ref={trigger} type="button" className="chip-select effort-chip" title="Reasoning effort" aria-label={`Reasoning effort: ${effortName(current.id)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); else show(); }}>
      <Icon name="effort" size={14}/><span className="chip-value">{effortName(current.id)}</span>
    </button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label="Reasoning effort" className="effort-panel" onToggle={event => {
      const shown = (event.nativeEvent as ToggleEvent).newState === 'open';
      setOpen(shown);
      if (!shown && (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))) trigger.current?.focus();
    }}>
      <p className="effort-name">{effortName(current.id)}</p>
      {current.description && <p className="effort-description">{current.description}</p>}
      <div className="effort-track" style={{ '--fill': at(index) } as React.CSSProperties}>
        {efforts.map((effort, step) => <span key={effort.id} className={'effort-stop' + (step <= index ? ' on' : '')} style={{ left: at(step) }}/>)}
        <input ref={range} type="range" min={0} max={efforts.length - 1} step={1} value={index} aria-label="Reasoning effort" aria-valuetext={effortName(current.id)}
          onChange={event => onChange(efforts[Number(event.target.value)].id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); panel.current?.hidePopover(); } }}/>
      </div>
      <div className="effort-scale" aria-hidden="true"><span>{effortName(efforts[0].id)}</span><span>{effortName(efforts[efforts.length - 1].id)}</span></div>
    </div>
  </span>;
}
