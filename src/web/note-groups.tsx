import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { canonicalGroup, GROUP_COLORS, GROUP_NAMES, NOTE_GROUPS, type NoteGroup } from '../note-groups.ts';
import { Icon } from './icons.tsx';
import { t, tn } from './i18n.ts';
import './note-groups.css';

export const groupName = (group: NoteGroup) => t(GROUP_NAMES[group]);
export const groupStyle = (group?: NoteGroup): CSSProperties => group ? { '--note-color': GROUP_COLORS[group], '--note-ink': canonicalGroup(group) === 'yellow' ? '#422f00' : '#fff' } as CSSProperties : {};
export function GroupAction({ group }: { group?: NoteGroup | null }) {
  return group ? <><span className="group-dot" style={groupStyle(group)} aria-hidden="true"/>{t('Add to group')}</> : t('Add note');
}
export function GroupPicker({ value, onChange, disabled }: { value: NoteGroup | null; onChange: (value: NoteGroup | null) => void; disabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) menu.current?.hidePopover(); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => menu.current?.hidePopover();
    const scroll = (event: Event) => { if (event.target instanceof Node && event.target.contains(trigger.current)) dismiss(); };
    window.addEventListener('resize', dismiss); document.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', scroll, true); };
  }, [open]);
  function choices() { return Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')); }
  function show() {
    const panel = menu.current!, rect = trigger.current!.getBoundingClientRect();
    panel.showPopover();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8))}px`;
    (choices().find(item => item.getAttribute('aria-checked') === 'true') || choices()[0])?.focus();
  }
  function choose(next: NoteGroup | null) {
    menu.current?.hidePopover(); trigger.current?.focus(); onChange(next);
  }
  return <div className="group-picker" style={groupStyle(value || undefined)}>
    <button ref={trigger} type="button" className="icon-button group-select" data-group={value || undefined} aria-label={t('Annotation group color')} title={t('Annotation groups')} aria-haspopup="menu" aria-expanded={open} popoverTarget={id} disabled={disabled} onClick={event => {
      event.preventDefault(); if (menu.current?.matches(':popover-open')) menu.current.hidePopover(); else show();
    }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
    }}>
      <span className="group-highlight" aria-hidden="true"><Icon name="highlight" size={16}/></span>
    </button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={t('Annotation group color')} className="group-palette" onToggle={event => setOpen((event.nativeEvent as ToggleEvent).newState === 'open')} onKeyDown={event => {
      if (event.key === 'Tab') { menu.current?.hidePopover(); trigger.current?.focus(); return; }
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); menu.current?.hidePopover(); trigger.current?.focus(); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = choices(), index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <div className="group-palette-label">{t('Color')}</div>
      <div className="group-swatches">
        {NOTE_GROUPS.map(group => <button key={group} type="button" className="group-swatch" role="menuitemradio" aria-label={groupName(group)} aria-checked={Boolean(value && canonicalGroup(value) === group)} style={groupStyle(group)} onClick={() => choose(group)}><span aria-hidden="true"/></button>)}
      </div>
      <button type="button" className="group-individual" role="menuitemradio" aria-checked={!value} onClick={() => choose(null)}><Icon name="notes" size={16}/><span>{t('Individual notes')}</span>{!value && <Icon name="check" size={14}/>}</button>
    </div>
  </div>;
}
export function GroupCard({ group, count, active, children }: { group: NoteGroup; count: number; active?: boolean; children: ReactNode }) {
  return <details className={'annotation-group' + (active ? ' active' : '')} style={groupStyle(group)} open={active || undefined}>
    <summary aria-label={`${groupName(group)} · ${tn(count, '{n} location', '{n} locations')}`}><span className="group-dot" aria-hidden="true"/><strong>{tn(count, '{n} location', '{n} locations')}</strong><Icon name="chevronDown" size={12}/></summary>
    <div className="group-locations">{children}</div>
  </details>;
}
