import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { readPdfAnchors, savePdfAnchors, type PdfAnchor, type PdfPosition } from './pdf-anchors.ts';
import './pdf-anchors.css';

// LAN HTTP does not expose randomUUID, but still supports getRandomValues.
const anchorId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export interface PdfAnchorsHandle { add: () => void; focus: () => void; travel: (direction: -1 | 1) => void }
export const PdfAnchors = forwardRef<PdfAnchorsHandle, {
  place: string; pages: number; ready: boolean; title?: string;
  capture: () => Promise<Omit<PdfAnchor, 'id' | 'name'> | null>; jump: (position: PdfPosition) => void;
  prepare: () => void; buildKey?: string;
  resolve?: (anchors: PdfAnchor[]) => Promise<{ id: string; position: PdfPosition | null }[]>;
}>(function PdfAnchors({ place, pages, ready, title, capture, jump, prepare, buildKey, resolve }, ref) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const native = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
  const [open, setOpen] = useState(false), [anchors, setAnchors] = useState(() => readPdfAnchors(place));
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const resolveFailed = useRef(false);
  const savingRef = useRef(false), currentAnchor = useRef<string | null>(null);
  const [tabAnchor, setTabAnchor] = useState<string | null>(null);
  const nativeFocus = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
  const mobile = () => window.matchMedia('(max-width: 680px)').matches;
  const [resolved, setResolved] = useState<{ key?: string; positions: Record<string, PdfPosition | null> }>({ positions: {} });
  const resolver = useRef(resolve); resolver.current = resolve;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sources = JSON.stringify(anchors.map(({ id, source, key, page, left, top }) => ({ id, source, key, page, left, top })));
  useEffect(() => {
    if (!resolver.current || !ready) return;
    let cancelled = false;
    const current = JSON.parse(sources) as PdfAnchor[];
    const positions: Record<string, PdfPosition | null> = Object.create(null);
    for (const anchor of current) if (!anchor.source || anchor.key === buildKey) positions[anchor.id] = anchor.source ? anchor : null;
    setResolved({ key: buildKey, positions });
    const pending = current.filter(anchor => anchor.source && anchor.key !== buildKey);
    if (pending.length) void resolver.current(pending).then(results => {
      if (!cancelled) { for (const result of results) positions[result.id] = result.position; setResolved({ key: buildKey, positions: { ...positions } }); setError(''); }
    }).catch(failure => { if (!cancelled) { resolveFailed.current = true; setError(failure instanceof Error ? failure.message : String(failure)); } });
    return () => { cancelled = true; };
  }, [buildKey, sources, ready, retry, Boolean(resolve)]);
  const draft = useRef(editing); draft.current = editing;
  const focus = useRef<string | null>(null);
  const targetOf = (anchor: PdfAnchor) => resolve ? resolved.key === buildKey ? resolved.positions[anchor.id] : undefined : anchor;
  const available = (anchor: PdfAnchor) => { const target = targetOf(anchor); return ready && target && target.page <= pages ? target : null; };
  function visit(anchor: PdfAnchor) {
    const target = available(anchor);
    if (!target) return;
    currentAnchor.current = anchor.id; setTabAnchor(anchor.id); close(); jump(target);
  }
  useImperativeHandle(ref, () => ({
    add: () => { prepare(); void add(); },
    focus: () => {
      if (mobile()) { prepare(); show(); }
      else document.getElementById(anchors.length ? id + '-slot-' + (anchors.find(anchor => anchor.id === tabAnchor)?.id || anchors[0].id) : id + '-quick-add')?.focus();
    },
    travel: direction => {
      const destinations = anchors.filter(anchor => available(anchor));
      if (!destinations.length) return;
      const current = destinations.findIndex(anchor => anchor.id === currentAnchor.current);
      const index = current < 0 ? direction === 1 ? 0 : destinations.length - 1 : (current + direction + destinations.length) % destinations.length;
      visit(destinations[index]);
    },
  }));
  function update(change: (current: PdfAnchor[]) => PdfAnchor[]) {
    const next = change(readPdfAnchors(place));
    savePdfAnchors(place, next); setAnchors(next);
  }
  function finishRename(save = true, restoreFocus = false) {
    const value = draft.current;
    if (!value) return;
    draft.current = null;
    if (save && value.name.trim()) update(current => current.map(anchor => anchor.id === value.id ? { ...anchor, name: value.name.trim() } : anchor));
    if (restoreFocus) focus.current = id + '-' + value.id;
    setEditing(null);
  }
  function close(restoreFocus = false) {
    finishRename();
    if (restoreFocus) focus.current = id + '-trigger';
    if (native && panel.current?.matches(':popover-open')) panel.current.hidePopover();
    setOpen(false);
  }
  function position() {
    const element = panel.current;
    if (!element) return;
    const viewport = window.visualViewport;
    element.style.maxHeight = `${Math.max(0, (viewport?.height ?? window.innerHeight) - 16)}px`;
    element.style.setProperty('--anchor-keyboard-inset', `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    if (window.matchMedia('(max-width: 680px)').matches) { element.style.left = ''; element.style.top = ''; return; }
    const rect = trigger.current!.getBoundingClientRect(), right = rect.right + 6, left = rect.left - element.offsetWidth - 6;
    element.style.left = `${right + element.offsetWidth <= window.innerWidth - 8 || left < 8 ? Math.max(8, Math.min(right, window.innerWidth - element.offsetWidth - 8)) : left}px`;
    element.style.top = `${Math.max(8, Math.min(rect.top - 5, window.innerHeight - element.offsetHeight - 8))}px`;
  }
  function show() {
    if (open) { position(); focusControl(id + '-add'); return; }
    if (native) panel.current?.showPopover();
    focus.current = id + '-add'; setOpen(true);
  }
  function focusControl(targetId: string) {
    const target = document.getElementById(targetId);
    const available = target instanceof HTMLButtonElement && target.disabled
      ? target.closest('li')?.querySelector<HTMLButtonElement>('button:not(:disabled)') || panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') || panel.current
      : target;
    available?.focus();
  }
  useLayoutEffect(() => {
    if (open) position();
    if (focus.current) { focusControl(focus.current); focus.current = null; }
  }, [open, anchors, editing]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && !event.key.endsWith('papilot:pdf-anchors:' + place)) return;
      const next = readPdfAnchors(place); setAnchors(next);
      if (draft.current && !next.some(anchor => anchor.id === draft.current!.id)) { draft.current = null; setEditing(null); focus.current = id + '-add'; }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [place, id]);
  useEffect(() => {
    if (!open) return;
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || panel.current?.contains(event.target)) return;
      if (event.target.contains(trigger.current)) close();
    };
    const outside = (event: PointerEvent) => { if (!native && event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(); };
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
    document.addEventListener('scroll', scroll, true); document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position); window.visualViewport?.removeEventListener('scroll', position);
      document.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', outside);
    };
  }, [open, native]);
  async function add() {
    if (!ready || savingRef.current) return;
    const initiator = document.activeElement;
    const mayFocus = () => document.activeElement === initiator && Boolean(trigger.current?.closest('.pdf-view')?.getClientRects().length);
    savingRef.current = true;
    setSaving(true); setError('');
    try {
      const position = await capture();
      if (!position || !alive.current) return;
      const anchor = { ...position, id: anchorId(), name: title || t('Page {page}', { page: position.page }) };
      currentAnchor.current = anchor.id; setTabAnchor(anchor.id);
      if (mayFocus()) {
        if (open) focus.current = id + '-' + anchor.id;
        else if (mobile()) { show(); focus.current = id + '-' + anchor.id; }
        else focus.current = id + '-slot-' + anchor.id;
      }
      update(current => [...current, anchor]);
    } catch (failure) { if (alive.current) { resolveFailed.current = false; setError(failure instanceof Error ? failure.message : String(failure)); if (mayFocus()) show(); } }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  }
  function remove(anchor: PdfAnchor) {
    if (draft.current?.id === anchor.id) { draft.current = null; setEditing(null); }
    const index = anchors.findIndex(item => item.id === anchor.id), next = anchors[index + 1] || anchors[index - 1];
    focus.current = id + '-' + (next?.id ?? 'add');
    update(current => current.filter(item => item.id !== anchor.id));
  }
  const contents = <div ref={panel} id={id} popover={native ? 'auto' : undefined} hidden={!native && !open} role="dialog" aria-label={t('Anchors')} tabIndex={-1} className="action-menu pdf-anchors-menu" data-open={open || undefined}
      onToggle={event => { const shown = (event.nativeEvent as ToggleEvent).newState === 'open'; if (!shown) finishRename(); setOpen(shown); }}
      onKeyDown={event => {
        event.stopPropagation();
        if ((event.target as Element).closest('input')) return;
        if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); close(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[index]?.focus();
        }
      }}>
      <div className="pdf-anchors-heading">{t('Anchors')}</div>
      {anchors.length ? <ul className="pdf-anchor-list">{anchors.map(anchor => {
        const target = targetOf(anchor);
        const unavailable = ready && (target === null || Boolean(target && target.page > pages)), renaming = editing?.id === anchor.id;
        const unavailableText = resolve ? t('Source unavailable') : t('Page unavailable');
        return <li key={anchor.id} className="pdf-anchor-row" onBlur={event => { if (draft.current?.id === anchor.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) finishRename(); }}>
          <span className="pdf-anchor-page" aria-hidden="true">{target?.page ?? '—'}</span>
          {renaming ? <input autoFocus className="pdf-anchor-name" aria-label={t('Edit anchor: {name}', { name: anchor.name })} value={editing.name}
            onFocus={event => event.currentTarget.select()} onChange={event => setEditing({ id: anchor.id, name: event.target.value })} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishRename(event.key === 'Enter', true); }
            }}/>
            : <button id={id + '-' + anchor.id} className="pdf-anchor-jump" type="button" aria-label={anchor.name} aria-description={unavailable ? unavailableText : undefined} disabled={!ready || !target || unavailable} onClick={() => visit(anchor)}>
              <span>{anchor.name}</span>{unavailable ? <small>{unavailableText}</small> : target === undefined ? <small>{t('Finding the source…')}</small> : anchor.source && <small>{anchor.source.file}</small>}
            </button>}
          <button type="button" className="pdf-anchor-action" aria-label={renaming ? t('Save') : t('Edit anchor: {name}', { name: anchor.name })} title={renaming ? t('Save') : t('Edit anchor: {name}', { name: anchor.name })}
            onClick={() => { if (renaming) finishRename(true, true); else setEditing({ id: anchor.id, name: anchor.name }); }}><Icon name={renaming ? 'check' : 'pencil'} size={15}/></button>
          <button type="button" className="pdf-anchor-action pdf-anchor-remove" aria-label={t('Delete') + ': ' + anchor.name} title={t('Delete')} onClick={() => remove(anchor)}><Icon name="trash" size={15}/></button>
        </li>;
      })}</ul> : <p className="pdf-anchors-empty">{t('Save a place to return to later.')}</p>}
      {error && <p className="inline-error" role="alert">{error} <button type="button" onClick={() => { setError(''); if (resolveFailed.current) setRetry(value => value + 1); else void add(); }}>{t('Retry')}</button></p>}
      <button id={id + '-add'} type="button" className="pdf-anchor-add" disabled={!ready || saving} onClick={() => void add()}><Icon name="plus" size={16}/>{saving ? t('Finding the source…') : t('Add anchor')}</button>
    </div>;
  return <div className="pdf-anchor-tools" role="group" aria-label={t('Anchors')}>
    <span className="menu-anchor">
    <button ref={trigger} id={id + '-trigger'} type="button" className="rail-tool pdf-anchors-trigger" aria-label={t('Anchors')} title={t('Anchors')} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={native ? id : undefined}
      onPointerDown={() => { if (!open) prepare(); }} onClick={event => { event.preventDefault(); if (open) close(); else show(); }} onKeyDown={event => {
        if (!open) prepare();
        if (['ArrowDown', 'ArrowUp', 'ArrowRight'].includes(event.key)) { event.preventDefault(); show(); }
      }}>
      <Icon name={anchors.length ? 'bookmarkFilled' : 'bookmark'} size={18}/>
      <span className="rail-tip" popover="manual" aria-hidden="true"><span className="rail-tip-title">{t('Anchors')}<kbd>B</kbd></span></span>
    </button>
    {native ? contents : createPortal(contents, document.body)}
    </span>
    <div className="pdf-anchor-slots" role="group" aria-label={t('Saved anchors')} {...{ focusgroup: 'toolbar wrap block' }} onKeyDown={event => {
      if (nativeFocus || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.pdf-anchor-slot'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }}>
      {anchors.map((anchor, index) => {
        const target = available(anchor), label = `${index + 1}. ${anchor.name}`;
        const description = !ready || targetOf(anchor) === undefined ? t('Finding the source…') : !target ? resolve ? t('Source unavailable') : t('Page unavailable') : t('Page {page}', { page: target.page });
        return <button key={anchor.id} id={id + '-slot-' + anchor.id} type="button" className="rail-tool pdf-anchor-slot" aria-label={label} aria-description={description} aria-disabled={!target} title={label + ' · ' + description}
          tabIndex={nativeFocus ? undefined : (anchors.some(item => item.id === tabAnchor) ? anchor.id === tabAnchor : index === 0) ? 0 : -1}
          onFocus={() => setTabAnchor(anchor.id)} onClick={() => visit(anchor)}>
          <span>{index + 1}</span><span className="rail-tip" popover="manual" aria-hidden="true"><span className="rail-tip-title">{anchor.name}</span><span>{description}</span></span>
        </button>;
      })}
    </div>
    <button id={id + '-quick-add'} type="button" className="rail-tool pdf-anchor-quick-add" aria-label={t('Add anchor')} aria-keyshortcuts="Shift+B" title={t('Add anchor') + ' (Shift+B)'} disabled={!ready || saving}
      onPointerDown={prepare} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') prepare(); }} onClick={() => void add()}><Icon name="plus" size={17}/><span className="rail-tip" popover="manual" aria-hidden="true"><span className="rail-tip-title">{t('Add anchor')}<kbd>Shift+B</kbd></span></span></button>
  </div>;
});
