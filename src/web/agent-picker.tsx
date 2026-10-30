import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { AgentId, AgentModel, RuntimeStatus } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

const names = (): Record<string, string> => ({ none: t('None'), minimal: t('Minimal'), low: t('Low'), medium: t('Medium'), high: t('High'), xhigh: t('Extra high'), max: t('Max'), ultra: t('Ultra') });
export const effortName = (id: string) => names()[id] || id[0].toUpperCase() + id.slice(1);

// The picker and an existing conversation use the same compact model label.
export function ModelLabel({ model, effort, fast }: { model: string; effort?: string | null; fast?: boolean }) {
  return <span className="agent-model-label"><span className="agent-model-name">{model}</span>{effort && <small>{effortName(effort)}</small>}{fast && <Icon name="bolt" size={13}/>}</span>;
}

export function AgentConnectionNotice({ name, runtime, reconnecting, onReconnect }: { name: string; runtime?: RuntimeStatus; reconnecting: boolean; onReconnect: () => void }) {
  if (!runtime || (runtime.connected && runtime.authenticated)) return null;
  const error = runtime.error || '', first = error.split(/:\s|\.\s/)[0];
  const message = error ? (first.length <= 120 ? first : t('{agent} is unavailable', { agent: name })) : t('Connecting to {agent}…', { agent: name });
  return <div className="agent-connection">
    <div className="agent-connection-message" role="status"><Icon name="alert" size={15}/><span>{message}</span></div>
    {error && error !== message && <details><summary>{t('Connection details')}</summary><p>{error}</p></details>}
    <button type="button" disabled={reconnecting} onClick={onReconnect}><Icon name="refresh" size={12}/>{reconnecting ? t('Connecting…') : t('Reconnect')}</button>
  </div>;
}

// Keep the stepped slider in the shared settings menu, including an explicit
// way to hand effort back to the model's default.
function EffortSlider({ efforts, value, fallback, onChange }: { efforts: string[]; value: string; fallback: string | null; onChange: (value: string) => void }) {
  const current = efforts.find(item => item === value) || efforts.find(item => item === fallback);
  const index = current ? efforts.indexOf(current) : Math.floor((efforts.length - 1) / 2), share = efforts.length > 1 ? index / (efforts.length - 1) : 1;
  const label = current ? effortName(current) : t('Model default');
  const centre = (step: number) => `calc(15px + ${efforts.length > 1 ? step / (efforts.length - 1) : 1} * (100% - 30px))`;
  return <div className="agent-effort">
    <div className="effort-head"><span>{t('Reasoning effort')}</span><strong>{label}</strong></div>
    <div className={'effort-track' + (current ? '' : ' unset')}>
      <span className="effort-fill" style={{ width: `calc(30px + ${share} * (100% - 30px))` }}/>
      {efforts.map((item, step) => step !== index && <span key={item} className={'effort-stop' + (current && step < index ? ' on' : '')} style={{ left: centre(step) }}/>)}
      <input type="range" min={0} max={efforts.length - 1} step={1} value={index} aria-label={t('Reasoning effort')} aria-valuetext={label} disabled={efforts.length < 2}
        onChange={event => onChange(efforts[Number(event.target.value)])}/>
    </div>
    <div className="effort-scale"><span>{effortName(efforts[0])}</span><button type="button" onClick={() => onChange('')} disabled={!value}>{t('Model default')}</button><span>{effortName(efforts[efforts.length - 1])}</span></div>
  </div>;
}

// One compact trigger for the agent's settings. Native popovers keep the menu
// above the PDF and scrolling panels, with outside-click and Escape dismissal.
export function AgentPicker({ agents, agent, models, model, effort, fast, runtime, reconnecting, onReconnect, onAgent, onChange, disabled }: {
  agents: { value: AgentId; label: string; unavailable?: boolean }[]; agent: AgentId; models: AgentModel[]; model: string; effort: string; fast: boolean;
  runtime?: RuntimeStatus; reconnecting: boolean; onReconnect: () => void;
  onAgent: (agent: AgentId) => void; onChange: (change: Partial<{ model: string; effort: string; fast: boolean }>) => void; disabled?: boolean;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = models.find(item => item.id === model) || models.find(item => item.isDefault);
  const modelName = selected?.name || model || agents.find(item => item.value === agent)?.label || t('Default model');
  const currentEffort = effort || selected?.defaultEffort;
  const fastMode = agent === 'codex' ? selected?.fastMode : undefined;
  const disconnected = runtime && (!runtime.connected || !runtime.authenticated);
  const agentName = agents.find(item => item.value === agent)?.label || agent;
  const summary = [modelName, currentEffort ? effortName(currentEffort) : '', fastMode && fast ? t('Fast') : ''].filter(Boolean).join(' · ');
  function position() {
    const box = panel.current!, rect = trigger.current!.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8))}px`;
    const below = rect.bottom + 6, above = rect.top - box.offsetHeight - 6;
    box.style.top = `${Math.max(8, Math.min(below + box.offsetHeight > window.innerHeight - 8 && above >= 8 ? above : below, window.innerHeight - box.offsetHeight - 8))}px`;
  }
  useLayoutEffect(() => { if (open) position(); }, [open, agent, model, selected]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => panel.current?.hidePopover();
    const scroll = (event: Event) => { if (event.target instanceof Node && event.target.contains(trigger.current) && !panel.current?.contains(event.target)) dismiss(); };
    const observer = new ResizeObserver(() => { if (panel.current?.matches(':popover-open')) position(); });
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', dismiss); document.addEventListener('scroll', scroll, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useEffect(() => { if (disabled) panel.current?.hidePopover(); }, [disabled]);
  function show() { panel.current?.showPopover(); position(); setOpen(true); panel.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus(); }
  return <span className="agent-picker">
    <button ref={trigger} type="button" className="agent-picker-trigger" aria-label={t('Agent settings')} title={summary + (disconnected ? ` · ${t('{agent} is unavailable', { agent: agentName })}` : '')} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => panel.current?.matches(':popover-open') ? panel.current.hidePopover() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>
      <ModelLabel model={modelName} effort={currentEffort} fast={Boolean(fastMode && fast)}/><Icon name="chevronDown" size={13}/>{disconnected && <span className="agent-status-mark"><Icon name="alert" size={13}/></span>}
    </button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={t('Agent settings')} className="agent-picker-panel" onToggle={event => {
      const shown = (event.nativeEvent as ToggleEvent).newState === 'open'; setOpen(shown);
      if (!shown && (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))) trigger.current?.focus();
    }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.current?.hidePopover(); trigger.current?.focus(); } }}>
      <div className="agent-choices-label">{t('Agent')}</div>
      <div className="agent-choices" role="radiogroup" aria-label={t('Agent')} onKeyDown={event => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!step && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? agents.length - 1 : (agents.findIndex(item => item.value === agent) + step + agents.length) % agents.length;
        onAgent(agents[index].value); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
      }}>{agents.map(item => <button key={item.value} type="button" role="radio" aria-checked={item.value === agent} tabIndex={item.value === agent ? 0 : -1} title={item.label + (item.unavailable ? t(' · unavailable') : '')} onClick={() => onAgent(item.value)}>{item.label}{item.unavailable && <i aria-hidden="true"/>}</button>)}</div>
      <AgentConnectionNotice key={agent} name={agentName} runtime={runtime} reconnecting={reconnecting} onReconnect={onReconnect}/>
      <label className="agent-setting"><span>{t('Model')}</span><select aria-label={t('Model')} value={model} onChange={event => onChange({ model: event.target.value })}><option value="">{t('Default model')}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {selected?.efforts.length ? <EffortSlider efforts={selected.efforts} value={effort} fallback={selected.defaultEffort} onChange={value => onChange({ effort: value })}/> : null}
      {fastMode && <label className="agent-fast"><span><strong><Icon name="bolt" size={14}/>{t('Fast mode')}</strong><small>{fastMode.description || t('Faster responses; may use more of your limit.')}</small></span><input type="checkbox" role="switch" aria-label={t('Fast mode')} checked={fast} onChange={event => onChange({ fast: event.target.checked })}/></label>}
    </div>
  </span>;
}
