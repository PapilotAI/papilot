import { useEffect, useId, useRef, useState } from 'react';
import type { Effort } from '../shared.ts';

const names: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };
export const effortName = (id: string) => names[id] || id[0].toUpperCase() + id.slice(1);

// Four bars, lit up to the chosen share of the model's range.
function Level({ step, steps }: { step: number; steps: number }) {
  const lit = steps > 1 ? 1 + Math.round(step / (steps - 1) * 3) : 4;
  return <svg className="effort-level" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    {[0, 1, 2, 3].map(bar => <rect key={bar} x={2.5 + bar * 5.5} y={20 - (5 + bar * 4.5)} width="3.5" height={5 + bar * 4.5} rx="1.4" fill="currentColor" opacity={bar < lit ? 1 : 0.22}/>)}
  </svg>;
}

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
  const index = efforts.indexOf(current), share = efforts.length > 1 ? index / (efforts.length - 1) : 1;
  // The 26px thumb travels 2px inside the track; the fill wraps it.
  const centre = (step: number) => `calc(15px + ${efforts.length > 1 ? step / (efforts.length - 1) : 1} * (100% - 30px))`;
  function show() {
    const box = panel.current!, rect = trigger.current!.getBoundingClientRect();
    box.showPopover();
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`;
    const below = rect.bottom + 8, above = rect.top - box.offsetHeight - 8;
    box.style.top = `${below + box.offsetHeight > window.innerHeight - 8 && above >= 8 ? above : below}px`;
    range.current?.focus();
  }
  return <span className="menu-anchor">
    <button ref={trigger} type="button" className="chip-select effort-chip" title="Reasoning effort" aria-label={`Reasoning effort: ${effortName(current.id)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => { if (panel.current?.matches(':popover-open')) panel.current.hidePopover(); else show(); }}>
      <Level step={index} steps={efforts.length}/><span className="chip-value">{effortName(current.id)}</span>
    </button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label="Reasoning effort" className="effort-panel" onToggle={event => {
      const shown = (event.nativeEvent as ToggleEvent).newState === 'open';
      setOpen(shown);
      if (!shown && (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))) trigger.current?.focus();
    }}>
      <div className="effort-caption"><span>Reasoning effort</span>{current.id === fallback && <span className="effort-default">Default</span>}</div>
      <p className="effort-name">{effortName(current.id)}</p>
      {/* Two lines are kept for every description, so the slider stays put while dragging. */}
      <p className="effort-description">{current.description}</p>
      <div className="effort-track">
        <span className="effort-fill" style={{ width: `calc(30px + ${share} * (100% - 30px))` }}/>
        {efforts.map((effort, step) => step !== index && <span key={effort.id} className={'effort-stop' + (step < index ? ' on' : '')} style={{ left: centre(step) }}/>)}
        <input ref={range} type="range" min={0} max={efforts.length - 1} step={1} value={index} aria-label="Reasoning effort" aria-valuetext={effortName(current.id)}
          onChange={event => onChange(efforts[Number(event.target.value)].id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); panel.current?.hidePopover(); } }}/>
      </div>
      <div className="effort-scale" aria-hidden="true"><span>Faster</span><span>Deeper</span></div>
    </div>
  </span>;
}
