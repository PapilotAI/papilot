import { useEffect, useId, useRef, useState } from 'react';

export interface MenuAction { label: string; select?: () => void; href?: string; disabled?: boolean; danger?: boolean }

// Native popovers escape scrolling containers and handle outside clicks without
// making the rest of the workspace modal. Each menu keeps its own task identity.
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
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
    panel.style.left = `${Math.max(8, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  function choices() { return Array.from(menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')); }
  function close() { menu.current?.hidePopover(); }
  function show(last = false) {
    menu.current?.showPopover(); position(); setOpen(true);
    const items = choices(); items[last ? items.length - 1 : 0]?.focus();
  }
  return <span className="menu-anchor">
    <button ref={trigger} className="icon-button more-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} popoverTarget={id} onClick={event => {
      event.preventDefault(); if (menu.current?.matches(':popover-open')) close(); else show();
    }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp'); }
    }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>
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
      {actions.map(action => action.href ? <a key={action.label} role="menuitem" href={action.href} target="_blank" rel="noreferrer" onClick={close}>{action.label}</a> : <button key={action.label} role="menuitem" disabled={action.disabled} className={action.danger ? 'danger-text' : undefined} onClick={() => { close(); trigger.current?.focus(); action.select?.(); }}>{action.label}</button>)}
    </div>
  </span>;
}
