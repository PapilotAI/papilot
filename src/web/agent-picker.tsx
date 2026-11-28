import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { modelServiceTier, type AgentId, type RuntimeStatus, type TaskPermissions } from '../shared.ts';
import { Icon } from './icons.tsx';
import { BrandIcon } from './brand-icon.tsx';
import { errorText, t } from './i18n.ts';
import { browserStorage } from './storage.ts';
import { EffortSlider, effortName } from './effort-slider.tsx';
import { permissionText } from './task-permissions.tsx';
import { PickerUsage, type RefreshUsage } from './usage.tsx';
import { shownModels } from './agent-choice.ts';

function SpeedBolts({ tier, size }: { tier: string; size: number }) {
  return <span className="agent-speed-bolts" aria-hidden="true">
    <Icon name="bolt" size={size}/>
    {tier === 'ultrafast' && <Icon name="bolt" size={size}/>}
  </span>;
}

// The picker and an existing conversation use the same compact model label.
function ModelLabel({ model, effort, speed }: { model: string; effort?: string | null; speed?: string }) {
  return <span className="agent-model-label"><span className="agent-model-name">{model}</span>{effort && <small>{effortName(effort)}</small>}{speed && <SpeedBolts tier={speed} size={13}/>}</span>;
}

export function AgentConnectionNotice({ name, runtime, reconnecting, onReconnect }: { name: string; runtime?: RuntimeStatus; reconnecting: boolean; onReconnect: () => void }) {
  if (!runtime || (runtime.connected && runtime.authenticated)) return null;
  const error = runtime.error ? errorText(runtime.error) : '', first = error.split(/:\s|\.\s/)[0];
  const connecting = runtime.installed !== false && !error && !runtime.connected;
  // An agent that was not found is not connecting: say so until it is installed and Reconnect finds it.
  const message = runtime.installed === false ? t('{agent} was not found on this computer. Install or set it up, then select Reconnect.', { agent: name })
    : error ? (first.length <= 120 ? first : t('{agent} is unavailable', { agent: name })) : runtime.connected ? t('Sign-in required') : t('Connecting to {agent}…', { agent: name });
  // A running agent without a sign-in reloads the host's current one (see connectAgent).
  const signedOut = runtime.connected && !runtime.authenticated;
  return <div className="agent-connection" data-state={connecting ? 'connecting' : 'error'}>
    <div className="agent-connection-message" role="status">{connecting ? <span className="spinner" aria-hidden="true"/> : <Icon name="alert" size={14}/>}<span>{message}</span></div>
    {error && error !== message && <details><summary>{t('Connection details')}</summary><p>{error}</p></details>}
    <button type="button" disabled={reconnecting} title={signedOut ? t('Use the current {agent} sign-in on the Papilot host', { agent: name }) : undefined} onClick={onReconnect}><Icon name="refresh" size={12}/>{reconnecting ? signedOut ? t('Refreshing…') : t('Connecting…') : signedOut ? t('Refresh') : t('Reconnect')}</button>
  </div>;
}

// Adding an agent is the way forward, so it is the main action; Reconnect
// checks again once one is installed.
export function NoAgentNotice({ message, reconnecting, onReconnect, onAdd, hosted = false }: { message?: string; reconnecting: boolean; onReconnect: () => void; onAdd: () => void; hosted?: boolean }) {
  return <div className="agent-connection no-agent" data-state="error">
    <div className="agent-connection-message" role="status"><Icon name="alert" size={14}/><span>{message || (hosted ? t('Unavailable') : t('No agent is set up on this computer yet. Add one, such as Codex or Claude Code, then select Reconnect.'))}</span></div>
    <div className="agent-connection-actions">
      {!hosted && <button type="button" className="button primary compact" onClick={onAdd}>{t('Add an agent')}</button>}
      <button type="button" className="button secondary compact" disabled={reconnecting} onClick={onReconnect}><Icon name="refresh" size={13}/>{reconnecting ? t('Connecting…') : t('Reconnect')}</button>
    </div>
  </div>;
}

// Shown to authors who chose another agent before Papilot Writer existed:
// their choice stays, and this suggests trying the built-in agent once.
export function WriterSuggestion({ ready, onUse, onSetUp, onDismiss }: { ready: boolean; onUse: () => void; onSetUp: () => void; onDismiss: () => void }) {
  return <div className="agent-connection writer-suggestion" data-state="info">
    <div className="agent-connection-message" role="note"><BrandIcon name="papilot" size={16}/><span>{t('Try Papilot Writer, the paper-writing agent built into Papilot. Your current agent stays the default until you switch.')}</span></div>
    <div className="agent-connection-actions">
      {ready ? <button type="button" className="button primary compact" onClick={onUse}>{t('Use Papilot Writer')}</button>
        : <button type="button" className="button primary compact" onClick={onSetUp}>{t('Set up Papilot Writer')}</button>}
      <button type="button" className="button secondary compact" onClick={onDismiss}>{t('Not now')}</button>
    </div>
  </div>;
}

// Recent agent and model choices, newest first, shown above the full list.
const RECENT = 'papilot:recent-models';
function readRecent(): { agent: AgentId; model: string }[] {
  try { const value = JSON.parse(browserStorage.getItem(RECENT) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.agent === 'string' && typeof item.model === 'string').slice(0, 3) : []; } catch { return []; }
}
function remember(agent: AgentId, model: string) {
  const next = [{ agent, model }, ...readRecent().filter(item => item.agent !== agent || item.model !== model)].slice(0, 3);
  browserStorage.setItem(RECENT, JSON.stringify(next));
}

export interface AgentOption { value: AgentId; label: string; runtime?: RuntimeStatus; allowUnknownDefault?: boolean }
// An agent's models in runs of the same source, in list order; models without one stay ungrouped.
function bySource(items: Choice[]) {
  const parts: { source?: string; items: Choice[] }[] = [];
  for (const item of items) {
    const last = parts.at(-1);
    if (last && last.source === item.source) last.items.push(item); else parts.push({ source: item.source, items: [item] });
  }
  return parts;
}
interface Choice { key: string; agent: AgentOption; model: string; name: string; source?: string; isDefault: boolean; recent: boolean }

function speedName(tier: string) {
  if (tier === 'default') return t('Standard');
  return tier === 'ultrafast' ? t('Ultrafast') : t('Fast');
}

// An agent's state when it cannot be used yet, shown beside its name.
function agentState(runtime?: RuntimeStatus) {
  if (runtime?.installed === false) return t('Not found');
  if (!runtime || (!runtime.connected && !runtime.error)) return t('Connecting…');
  if (!runtime.connected) return t('Unavailable');
  return runtime.authenticated ? '' : t('Sign-in required');
}

// One compact trigger opens a searchable list of every agent's models,
// grouped by agent with recent choices first, so one choice sets both. The
// selected model's reasoning effort, speed and permissions sit below the list. Native
// popovers keep the menu above the PDF and scrolling panels, with
// outside-click and Escape dismissal.
export function AgentPicker({ label, agents, agent, model, effort, serviceTier, reconnecting, onReconnect, onSelect, onChange, disabled, description, permissions, permissionMode, allowUnknownDefault = true, noAgent = false, singleAgent = false, refreshUsage }: {
  label?: string; agents: AgentOption[]; agent: AgentId; model: string; effort: string; serviceTier?: string;
  reconnecting: boolean; onReconnect: () => void;
  onSelect: (agent: AgentId, model: string) => void; onChange: (change: Partial<{ effort: string; serviceTier: string }>) => void; disabled?: boolean; description?: string; allowUnknownDefault?: boolean;
  permissions?: ReactNode; permissionMode?: TaskPermissions; noAgent?: boolean; singleAgent?: boolean;
  refreshUsage?: RefreshUsage;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(''), [recent, setRecent] = useState(readRecent);
  const single = singleAgent && agents.length === 1;
  const current = agents.find(item => item.value === agent) || agents[0];
  const runtime = current?.runtime, models = runtime?.models || [];
  const selected = model ? models.find(item => item.id === model) : models.find(item => item.isDefault);
  const agentName = current?.label || agent;
  const modelDisplayName = (agentId: AgentId, item?: { id: string; name: string }, label?: string) => agentId === 'chatgpt' && item?.id === 'chatgpt-pro' && label ? label : item?.name;
  const modelName = modelDisplayName(agent, selected, agentName) || model || t('Default model');
  const currentEffort = effort || selected?.defaultEffort;
  const tiers = agent === 'codex' && serviceTier !== undefined ? selected?.serviceTiers : undefined;
  const speed = modelServiceTier(selected, serviceTier);
  const accelerated = Boolean(tiers?.includes(speed));
  const permission = runtime?.permissionOptions?.find(option => option.value === permissionMode);
  const disconnected = runtime && (!runtime.connected || !runtime.authenticated);
  const summary = noAgent ? t('No agent') : [single ? '' : agentName, modelName, currentEffort ? effortName(currentEffort) : '', accelerated ? speedName(speed) : '', permission ? permissionText(permission.label) : ''].filter((part, index, all) => part && all.indexOf(part) === index).join(' · ');
  // Every model of every agent that the author did not hide; an agent without a model list offers its default.
  const choices = (option: AgentOption): Choice[] => {
    const list = option.runtime?.models || [];
    return [
      ...((option.allowUnknownDefault ?? allowUnknownDefault) && !list.some(item => item.isDefault) ? [{ key: `${option.value}\n`, agent: option, model: '', name: t('Default model'), isDefault: false, recent: false }] : []),
      ...shownModels(option.runtime, option.value === agent ? model : undefined).map(item => ({ key: `${option.value}\n${item.id}`, agent: option, model: item.id, name: modelDisplayName(option.value, item, option.label) || item.name, source: item.source, isDefault: item.isDefault, recent: false })),
    ];
  };
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (choice: Choice) => terms.every(term => `${choice.agent.label} ${choice.source || ''} ${choice.name} ${choice.model}`.toLocaleLowerCase().includes(term));
  const groups = agents.map(option => ({ option, items: choices(option).filter(matches) })).filter(group => group.items.length);
  const recentItems = terms.length ? [] : recent.flatMap(item => {
    const option = agents.find(candidate => candidate.value === item.agent);
    const found = option && choices(option).find(choice => choice.model === item.model);
    return found ? [{ ...found, key: `recent\n${found.key}`, recent: true }] : [];
  });
  const visible = [...recentItems, ...groups.flatMap(group => group.items)];
  const isSelected = (choice: Choice) => choice.agent.value === agent && (choice.model === model || (!model && (choice.isDefault || choice.model === '')));
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
  useEffect(() => { if (disabled || noAgent) panel.current?.hidePopover(); }, [disabled, noAgent]);
  function revealOption(option: HTMLElement | null | undefined) {
    const container = list.current;
    if (!container || !option) return;
    const bounds = container.getBoundingClientRect(), item = option.getBoundingClientRect();
    // scrollIntoView can also scroll the containing modal. That dismisses
    // the picker as soon as it opens inside a scrollable dialog.
    if (item.top < bounds.top) container.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }
  // Keep the active option in view while moving through the list with the keyboard.
  useEffect(() => { if (open && active) revealOption(list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`)); }, [active, open]);
  function show() {
    setQuery(''); setRecent(readRecent());
    panel.current?.showPopover(); position(); setOpen(true);
    const chosen = visible.find(isSelected);
    setActive(chosen?.key || visible[0]?.key || '');
    requestAnimationFrame(() => revealOption(list.current?.querySelector<HTMLElement>('[aria-selected="true"]')));
    // Typing filters right away; on a touch screen the keyboard would cover the list, so search waits for a tap.
    if (!window.matchMedia('(pointer: coarse)').matches) search.current?.focus({ preventScroll: true });
  }
  function choose(choice: Choice) {
    if (disabled) return;
    onSelect(choice.agent.value, choice.model);
    remember(choice.agent.value, choice.model);
    setActive(choice.key);
  }
  function move(step: number) {
    if (!visible.length) return;
    const index = visible.findIndex(choice => choice.key === active);
    setActive(visible[(index + step + visible.length) % visible.length].key);
  }
  const renderChoice = (choice: Choice) => {
    const chosen = isSelected(choice), state = agentState(choice.agent.runtime);
    const optionLabel = [choice.name, choice.source, single ? '' : choice.agent.label].filter((part, index, all) => part && all.indexOf(part) === index).join(' · ');
    const recentMeta = [single ? '' : choice.agent.label, choice.source].filter(Boolean).join(' · ');
    return <div key={choice.key} id={`${id}-${choice.key.replace(/\W/g, '_')}`} data-key={choice.key} role="option" aria-selected={chosen} aria-label={optionLabel}
      className={'model-option' + (choice.key === active ? ' active' : '')} onPointerMove={() => setActive(choice.key)} onClick={() => choose(choice)}>
      {choice.recent && !single && <BrandIcon name={choice.agent.value} size={15}/>}<span className="model-option-name">{choice.name}</span>
      {choice.isDefault && !choice.recent && <small className="model-option-tag">{t('Default')}</small>}
      {((choice.recent && recentMeta) || state) && <small className={'model-option-agent' + (state ? ' warn' : '')}>{choice.recent ? recentMeta : state}</small>}
      {chosen && <Icon name="check" size={14}/>}
    </div>;
  };
  const activeChoice = visible.find(choice => choice.key === active);
  return <span className="agent-picker">
    <button ref={trigger} type="button" className="agent-picker-trigger" aria-label={label || t('Agent settings')} aria-description={summary} title={summary + (disconnected ? ` · ${t('{agent} is unavailable', { agent: agentName })}` : '')} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled || noAgent}
      onClick={() => panel.current?.matches(':popover-open') ? panel.current.hidePopover() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>
      {noAgent ? <span className="agent-picker-selection">{t('No agent')}</span> : <><BrandIcon name={agent} size={15}/>{!permission && !single && modelName !== agentName && <span className="agent-picker-agent">{agentName}</span>}
      <span className="agent-picker-selection">
        <ModelLabel model={modelName} effort={permission ? undefined : currentEffort} speed={accelerated ? speed : undefined}/>
        {permission && <small className="agent-permission-label" data-mode={permission.value}>{permissionText(permission.label)}</small>}
      </span>
      <Icon name="chevronDown" size={13}/>{disconnected && <span className="agent-status-mark"><Icon name="alert" size={13}/></span>}</>}
    </button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={label || t('Agent settings')} className={'agent-picker-panel' + (permission ? ' has-permissions' : '')} onToggle={event => {
      const shown = (event.nativeEvent as ToggleEvent).newState === 'open'; setOpen(shown);
      if (!shown && (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))) trigger.current?.focus();
    }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.current?.hidePopover(); trigger.current?.focus(); } }}>
      <label className="model-search"><Icon name="search" size={14}/>
        <input ref={search} type="search" value={query} placeholder={t('Search models')} aria-label={t('Search models')} role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={activeChoice ? `${id}-${activeChoice.key.replace(/\W/g, '_')}` : undefined}
          onChange={event => { setQuery(event.target.value); const terms = event.target.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean); const first = agents.flatMap(choices).find(choice => terms.every(term => `${choice.agent.label} ${choice.source || ''} ${choice.name} ${choice.model}`.toLocaleLowerCase().includes(term))); setActive(first?.key || ''); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
            else if (event.key === 'Enter' && activeChoice) { event.preventDefault(); choose(activeChoice); }
          }}/>
      </label>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={t('Models')} className="model-list">
        {recentItems.length > 0 && <div role="group" aria-label={t('Recent')} className="model-group"><div className="model-group-head" aria-hidden="true">{t('Recent')}</div>{recentItems.map(renderChoice)}</div>}
        {groups.map(group => <div key={group.option.value} role="group" aria-label={group.option.label} className="model-group">
          {!single && <div className="model-group-head" aria-hidden="true"><BrandIcon name={group.option.value} size={15}/>{group.option.label}</div>}
          {bySource(group.items).map(part => part.source
            ? <div key={part.source} role="group" aria-label={single ? part.source : `${group.option.label}, ${part.source}`} className="model-subgroup"><div className="model-subgroup-head" aria-hidden="true">{part.source}</div>{part.items.map(renderChoice)}</div>
            : <Fragment key="">{part.items.map(renderChoice)}</Fragment>)}
        </div>)}
        {!visible.length && <p className="model-empty">{t('No models match “{query}”', { query: query.trim() })}</p>}
      </div>
      <AgentConnectionNotice key={agent} name={agentName} runtime={runtime} reconnecting={reconnecting} onReconnect={onReconnect}/>
      {open && runtime?.connected && runtime.authenticated && (agent === 'antigravity' || runtime.usage) && <PickerUsage key={agent} agent={agent} name={agentName} runtime={runtime} refresh={agent === 'antigravity' ? refreshUsage : undefined}/>}
      {description && <p className="effort-description">{description}</p>}
      {selected?.efforts.length ? <EffortSlider efforts={selected.efforts} value={effort} fallback={selected.defaultEffort} onChange={value => onChange({ effort: value })}/> : null}
      {tiers?.includes('ultrafast') ? <fieldset className="agent-speed" aria-describedby={`${id}-speed-detail`}>
        <legend>{t('Speed')}</legend>
        <small id={`${id}-speed-detail`}>{t('Faster, higher usage')}</small>
        <div className="agent-speed-options">
          {['default', ...tiers].map(tier => <label key={tier} className="agent-speed-option" htmlFor={`${id}-speed-${tier}`}>
            <input type="radio" id={`${id}-speed-${tier}`} name={`${id}-speed`} value={tier} checked={speed === tier} onChange={() => onChange({ serviceTier: tier })}/>
            {tier !== 'default' && <SpeedBolts tier={tier} size={14}/>}
            <span>{speedName(tier)}</span>
          </label>)}
        </div>
      </fieldset> : tiers?.length ? <label className="agent-fast">
        <span><strong><Icon name="bolt" size={14}/>{t('Fast mode')}</strong><small>{t('Faster, higher usage')}</small></span>
        <input type="checkbox" role="switch" aria-label={t('Fast mode')} checked={accelerated} onChange={event => onChange({ serviceTier: event.target.checked ? tiers[0] : 'default' })}/>
      </label> : null}
      {permissions}
    </div>
  </span>;
}
