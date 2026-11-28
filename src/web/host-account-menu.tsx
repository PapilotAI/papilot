import { useEffect, useId, useRef, useState } from 'react';
import type { HostChrome } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

function initialsFor(name?: string, email?: string) {
  const source = (name || email || '').trim();
  if (!source) return 'P';
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const supportsFocusGroup = () => typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
const supportsAnchorPositioning = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-area: block-start');

/**
 * Replaces the plain bottom-left settings button when an embedding host supplies
 * navigation or user identity chrome. Uses native Popover API + focusgroup with
 * progressive fallbacks for browsers without anchor positioning or focusgroup.
 */
export function HostAccountMenu({ host, onOpenSettings }: { host: HostChrome; onOpenSettings: () => void }) {
  const triggerId = useId();
  const menuId = useId();
  const anchorName = `--host-account-${triggerId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const focusTargetOnOpen = useRef<'first' | 'last' | null>(null);
  const pointerPressed = useRef(false);
  const wasOpenOnPointerDown = useRef(false);
  const [open, setOpen] = useState(false);

  const user = host.user;
  const displayName = user?.name || user?.email || host.name || t('Account');
  const initials = initialsFor(user?.name, user?.email);
  const usagePct = typeof user?.usagePercent === 'number' && Number.isFinite(user.usagePercent)
    ? Math.min(100, Math.max(0, Math.round(user.usagePercent)))
    : undefined;
  const usageTone = usagePct !== undefined && usagePct >= 95 ? 'danger' : usagePct !== undefined && usagePct >= 80 ? 'warn' : undefined;
  const nativeFocusGroup = supportsFocusGroup();

  function menuItems(): HTMLElement[] {
    if (!groupRef.current) return [];
    return Array.from(groupRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
  }

  function positionFallback() {
    const panel = popoverRef.current, trigger = triggerRef.current;
    if (!panel || !trigger) return;
    if (window.matchMedia('(max-width: 680px)').matches || supportsAnchorPositioning()) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.minWidth = '';
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(panel.offsetWidth, Math.min(260, Math.max(rect.width, 224)));
    panel.style.minWidth = `${Math.max(rect.width, 224)}px`;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const above = rect.top - panel.offsetHeight - 6;
    const below = rect.bottom + 6;
    const top = above >= 8 ? above : Math.max(8, Math.min(below, window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function focusTrigger(fromPointer = false) {
    const trigger = triggerRef.current;
    if (!trigger) return;
    try {
      trigger.focus({ preventScroll: true, ...(fromPointer ? { focusVisible: false } as FocusOptions : {}) });
    } catch {
      trigger.focus({ preventScroll: true });
    }
  }

  function closeAndRestore(fromPointer = false) {
    focusTrigger(fromPointer);
    if (popoverRef.current?.matches(':popover-open')) popoverRef.current.hidePopover();
  }

  function openMenu(target: 'first' | 'last' | null) {
    const panel = popoverRef.current, trigger = triggerRef.current;
    if (!panel || !trigger) return;
    focusTargetOnOpen.current = target;
    try {
      (panel as HTMLElement & { showPopover: (options?: { source?: HTMLElement }) => void }).showPopover({ source: trigger });
    } catch {
      panel.showPopover();
    }
    positionFallback();
    if (target) {
      focusTargetOnOpen.current = null;
      const items = menuItems();
      (target === 'last' ? items.at(-1) : items[0])?.focus({ preventScroll: true });
    } else {
      focusTrigger(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = () => { if (popoverRef.current?.matches(':popover-open')) popoverRef.current.hidePopover(); };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss();
    };
    window.addEventListener('resize', dismiss);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  const itemRole = nativeFocusGroup ? undefined : 'menuitem';

  return (
    <div className="host-account">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="host-account-trigger"
        style={{ anchorName } as React.CSSProperties}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onPointerDown={event => {
          pointerPressed.current = true;
          wasOpenOnPointerDown.current = Boolean(popoverRef.current?.matches(':popover-open'));
          event.preventDefault();
        }}
        onClick={event => {
          const fromPointer = pointerPressed.current && event.detail > 0;
          const wasOpen = wasOpenOnPointerDown.current;
          pointerPressed.current = false;
          wasOpenOnPointerDown.current = false;
          if (popoverRef.current?.matches(':popover-open') || (fromPointer && wasOpen)) {
            closeAndRestore(fromPointer);
          } else {
            openMenu(fromPointer ? null : 'first');
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && popoverRef.current?.matches(':popover-open')) {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestore(false);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const target = event.key === 'ArrowUp' ? 'last' : 'first';
            if (!popoverRef.current?.matches(':popover-open')) {
              openMenu(target);
            } else {
              const items = menuItems();
              (target === 'last' ? items.at(-1) : items[0])?.focus({ preventScroll: true });
            }
          }
        }}
      >
        <span className="host-account-avatar" aria-hidden="true">{initials}</span>
        <span className="host-account-meta">
          <span className="host-account-name">{displayName}</span>
          {user?.plan && <span className="host-account-plan">{user.plan}</span>}
        </span>
        {usagePct !== undefined && (
          <span className={'host-account-usage-pill' + (usageTone ? ` is-${usageTone}` : '')}>
            <span className="sr-only">{t('Usage & limits')}: </span>
            {usagePct}%
          </span>
        )}
        <Icon name="updown" size={13}/>
      </button>
      <div
        ref={popoverRef}
        id={menuId}
        popover="auto"
        className="host-account-popover"
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        onToggle={event => {
          const shown = (event.nativeEvent as ToggleEvent).newState === 'open';
          setOpen(shown);
          if (shown) {
            positionFallback();
            const target = focusTargetOnOpen.current;
            focusTargetOnOpen.current = null;
            if (target) {
              const items = menuItems();
              (target === 'last' ? items.at(-1) : items[0])?.focus({ preventScroll: true });
            } else if (!popoverRef.current?.contains(document.activeElement)) {
              focusTrigger(true);
            }
          } else if (!document.activeElement || document.activeElement === document.body || popoverRef.current?.contains(document.activeElement)) {
            focusTrigger(false);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestore(false);
            return;
          }
          if (event.key === 'Tab') {
            closeAndRestore(false);
            return;
          }
          if (!nativeFocusGroup && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            const items = menuItems();
            if (!items.length) return;
            const current = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : current < 0 ? 0 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            event.preventDefault();
            event.stopPropagation();
            items[next]?.focus({ preventScroll: true });
          }
        }}
      >
        {(user?.name || user?.email || usagePct !== undefined) && (
          <>
            <div className="host-account-header">
              <div className="host-account-identity">
                <strong className="host-account-title">{displayName}</strong>
                {user?.email && user.email !== displayName && <span className="host-account-email">{user.email}</span>}
              </div>
              {usagePct !== undefined && (
                <div className={'host-account-usage' + (usageTone ? ` is-${usageTone}` : '')}>
                  <div className="host-account-usage-row">
                    <span>{t('Usage & limits')}</span>
                    <strong>{usagePct}%</strong>
                  </div>
                  <progress className="host-account-progress" value={usagePct} max={100} aria-label={t('Usage & limits')}/>
                </div>
              )}
            </div>
            <hr className="host-account-sep"/>
          </>
        )}
        <div
          ref={groupRef}
          {...({ focusgroup: 'menu nomemory' } as Record<string, string>)}
          role={nativeFocusGroup ? undefined : 'menu'}
          aria-labelledby={triggerId}
          className="host-account-menu"
        >
          <button
            type="button"
            role={itemRole}
            onClick={event => {
              closeAndRestore(event.detail > 0);
              onOpenSettings();
            }}
          >
            <Icon name="settings" size={16}/>
            <span className="menu-label">{t('Settings')}</span>
          </button>
          {host.homeUrl && (
            <a href={host.homeUrl} role={itemRole} onClick={() => popoverRef.current?.hidePopover()}>
              <Icon name="folder" size={16}/>
              <span className="menu-label">{t('All projects')}</span>
            </a>
          )}
          {host.billingUrl && (
            <a href={host.billingUrl} role={itemRole} onClick={() => popoverRef.current?.hidePopover()}>
              <Icon name="chart" size={16}/>
              <span className="menu-label">{t('Usage & limits')}</span>
            </a>
          )}
          {host.accountUrl && (
            <a href={host.accountUrl} role={itemRole} onClick={() => popoverRef.current?.hidePopover()}>
              <Icon name="people" size={16}/>
              <span className="menu-label">{t('Account')}</span>
            </a>
          )}
          {host.logoutUrl && (
            <>
              <hr className="host-account-sep"/>
              <a href={host.logoutUrl} role={itemRole} className="danger-text" onClick={() => popoverRef.current?.hidePopover()}>
                <Icon name="arrowLeft" size={16}/>
                <span className="menu-label">{t('Sign out')}</span>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
