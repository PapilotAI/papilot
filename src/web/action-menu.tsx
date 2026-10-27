import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons.tsx';

export interface MenuAction { id?: string; label: string; select?: () => void; href?: string; disabled?: boolean; danger?: boolean; checked?: boolean; icon?: string; divider?: boolean }

// Native popovers escape scrolling containers and handle outside clicks without
// making the rest of the workspace modal. Each menu keeps its own task identity.
// The trigger defaults to a "more" button; pass children for a labelled trigger.
export function ActionMenu({ label, actions, children, className = 'icon-button more-button', align = 'end' }: { label: string; actions: MenuAction[]; children?: ReactNode; className?: string; align?: 'start' | 'end' }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => menu.current?.hidePopover();
    window.addEventListener('resize', dismiss); document.addEventListener('scroll', dismiss, true);
    return () => { window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', dismiss, true); };
  }, [open]);
  function position() {
    const panel = menu.current!, rect = trigger.current!.getBoundingClientRect();
    if (align === 'start') panel.style.minWidth = `${rect.width}px`;
    const left = align === 'start' ? rect.left : rect.right - panel.offsetWidth;
    panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - panel.offsetWidth - 8))}px`;
    const below = rect.bottom + 6, above = rect.top - panel.offsetHeight - 6;
    panel.style.top = `${below + panel.offsetHeight > window.innerHeight - 8 && above >= 8 ? above : Math.max(8, Math.min(below, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  function choices() { return Array.from(menu.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')); }
  function close() { menu.current?.hidePopover(); }
  function show(last = false) {
    menu.current?.showPopover(); position(); setOpen(true);
    const items = choices();
    (last ? items[items.length - 1] : items.find(item => item.getAttribute('aria-checked') === 'true') || items[0])?.focus();
  }
  const radio = actions.some(action => action.checked !== undefined);
  return <span className="menu-anchor">
    <button ref={trigger} type="button" className={className} aria-label={label} title={children ? undefined : label} aria-haspopup="menu" aria-expanded={open} popoverTarget={id} onClick={event => {
      event.preventDefault(); if (menu.current?.matches(':popover-open')) close(); else show();
    }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp'); }
    }}>{children || <Icon name="more" size={18}/>}</button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={label} className="action-menu" onToggle={event => {
      const shown = (event.nativeEvent as ToggleEvent).newState === 'open'; setOpen(shown);
    }} onKeyDown={event => {
      // Continue normal tab order from the trigger. A surrounding mobile drawer
      // must receive Tab so its focus boundary can wrap the final row safely.
      if (event.key === 'Tab') { close(); trigger.current?.focus(); return; }
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = choices(), current = items.indexOf(document.activeElement as HTMLElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }
    }}>
      {actions.map(action => {
        const content = <>{action.icon ? <Icon name={action.icon} size={16}/> : radio && <span className="menu-check">{action.checked && <Icon name="check" size={16}/>}</span>}<span className="menu-label">{action.label}</span></>;
        const item = action.href
          ? <a key={action.id || action.label} role="menuitem" href={action.href} target="_blank" rel="noreferrer" onClick={close}>{content}</a>
          : <button key={action.id || action.label} type="button" role={action.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={action.checked} disabled={action.disabled} className={action.danger ? 'danger-text' : undefined} onClick={() => { close(); trigger.current?.focus(); action.select?.(); }}>{content}</button>;
        return action.divider ? [<div key={action.label + '-divider'} role="separator" className="menu-separator"/>, item] : item;
      })}
    </div>
  </span>;
}
