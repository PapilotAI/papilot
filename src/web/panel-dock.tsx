import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { openPopout, type Popout } from './popout-window.ts';
import { browserStorage } from './storage.ts';
import { ActionMenu } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

// A side panel, such as the manuscript's New task or a task's chat, docks on
// the right (the default), the left or the bottom of its area, or floats
// over it, like a panel in a code editor. Its header's position button opens
// a menu of these places; dragging that button, or the header's empty space,
// moves the panel, which docks when dropped on an edge and floats elsewhere.
// It also opens in a window of its own, to put on another display, from the
// menu or by dropping it outside the window; closing that window docks it
// again where it was. Each area remembers its place and sizes in this
// browser; a smaller window fits them without forgetting them. Narrow windows
// keep their own layout.
export type Dock = 'right' | 'left' | 'bottom' | 'float';
export type Position = Dock | 'window' | 'fill';
export interface Rect { x: number; y: number; width: number; height: number }
interface Place { dock: Dock; height?: number; float?: Rect }

export const DOCKS: Dock[] = ['right', 'left', 'bottom', 'float'];
const MIN_WIDTH = 300, MIN_HEIGHT = 200, MAIN_WIDTH = 360, MAIN_HEIGHT = 200;
// How near an edge a dragged panel docks on it.
const EDGE = 56;
const STEP = 24;

const parse = (value: string | null): Place => {
  try {
    const place = JSON.parse(value || '') as Partial<Place>;
    const float = place.float && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(place.float![key as keyof Rect])) ? place.float : undefined;
    const height = Number.isFinite(place.height) && place.height! > 0 ? place.height : undefined;
    return { dock: DOCKS.includes(place.dock as Dock) ? place.dock as Dock : 'right', height, float };
  } catch { return { dock: 'right' }; }
};
const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, Math.max(min, max))));

/** The floating rectangle fitted inside the window, which it may cross
 *  anywhere, over the sidebar and toolbars too. */
export function fitFloat(rect: Rect | undefined, area: { width: number; height: number }): Rect {
  // A new floating panel starts at the right, below the page's toolbar.
  const width = clamp(rect?.width ?? 380, MIN_WIDTH, area.width - 16), height = clamp(rect?.height ?? Math.min(560, area.height - 72), MIN_HEIGHT, area.height - 16);
  const x = clamp(rect?.x ?? area.width - width - 16, 0, area.width - width), y = clamp(rect?.y ?? 56, 0, area.height - height);
  return { x, y, width, height };
}

/** Where a panel dragged to this point of its area lands: near the area's
 *  own edges it docks; anywhere else in the window it floats. */
export function dropZone(point: { x: number; y: number }, area: { width: number; height: number }): Dock {
  if (point.x < 0 || point.y < 0 || point.x > area.width || point.y > area.height) return 'float';
  if (point.x < EDGE) return 'left';
  if (point.x > area.width - EDGE) return 'right';
  if (point.y > area.height - EDGE) return 'bottom';
  return 'float';
}

export function usePanelDock({ key, widthKey, property, panel, label, title, enabled, fill, onResize }: {
  /** Saves this area's place, as papilot:dock:<key>. */
  key: string;
  /** Saves the docked width, under the name it always had. */
  widthKey: string;
  /** The CSS property that carries the docked width. */
  property: string;
  /** A selector for the panel within the area. */
  panel: string;
  label: string;
  /** The title of the panel's own window. */
  title: string;
  /** Off where the area keeps its own layout: narrow windows, a hidden panel. */
  enabled: boolean;
  /** The panel fills its area instead, as a task's chat can. */
  fill?: { on: boolean; set: (on: boolean) => void };
  /** The panel moved or changed size. */
  onResize?: () => void;
}) {
  const [width, setWidth] = useState(() => {
    const saved = Number(browserStorage.getItem(widthKey));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  });
  const [place, setPlace] = useState(() => parse(browserStorage.getItem('papilot:dock:' + key)));
  const [area, setArea] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, left: 0, top: 0, panelWidth: MIN_WIDTH, panelHeight: MIN_HEIGHT });
  // A floating panel lives in the window's coordinates.
  const [view, setView] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resize = () => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [drag, setDrag] = useState<{ zone: Dock | 'window'; rect: Rect } | null>(null);
  const [popout, setPopout] = useState<Popout | null>(null);
  // Says where the panel went, for screen readers.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => { if (!announcement) return; const timer = setTimeout(() => setAnnouncement(''), 1000); return () => clearTimeout(timer); }, [announcement]);
  const moving = useRef<{ pointer: number; element: Element; x: number; y: number; dx: number; dy: number; width: number; height: number; started: boolean } | null>(null);
  const resizing = useRef<{ x: number; y: number; width: number; height: number; float?: Rect } | null>(null);
  const moved = useRef(false);
  const changed = useRef(onResize);
  changed.current = onResize;

  useEffect(() => { if (width) browserStorage.setItem(widthKey, String(width)); else browserStorage.removeItem(widthKey); }, [widthKey, width]);
  useEffect(() => {
    if (place.dock === 'right' && !place.height && !place.float) browserStorage.removeItem('papilot:dock:' + key);
    else browserStorage.setItem('papilot:dock:' + key, JSON.stringify(place));
  }, [key, place]);
  // The panel as it is now: a task's chat is a new element for each task.
  const current = () => area?.querySelector<HTMLElement>(panel)?.getBoundingClientRect();
  useLayoutEffect(() => {
    if (!enabled || !area) return;
    const measure = () => {
      const box = area.getBoundingClientRect(), panelBox = area.querySelector<HTMLElement>(panel)?.getBoundingClientRect();
      setSize({ width: Math.round(box.width), height: Math.round(box.height), left: Math.round(box.left), top: Math.round(box.top), panelWidth: Math.round(panelBox?.width ?? MIN_WIDTH), panelHeight: Math.round(panelBox?.height ?? MIN_HEIGHT) });
    };
    const observer = new ResizeObserver(measure);
    let side: HTMLElement | null = null;
    const watch = () => {
      const next = area.querySelector<HTMLElement>(panel);
      if (next === side) return;
      if (side) observer.unobserve(side);
      side = next;
      if (side) observer.observe(side);
      measure();
    };
    const children = new MutationObserver(watch);
    children.observe(area, { childList: true });
    observer.observe(area);
    // Before the first paint, so a floating panel opens where it was.
    watch();
    return () => { observer.disconnect(); children.disconnect(); };
  }, [enabled, area, panel]);
  // The panel's content refits once the layout has moved it.
  const dock: Dock | 'window' = popout ? 'window' : enabled ? place.dock : 'right';
  const settled = useRef(dock);
  useEffect(() => { if (settled.current !== dock) { settled.current = dock; changed.current?.(); } }, [dock]);
  useEffect(() => () => document.body.classList.remove('resizing', 'resizing-rows', 'moving-panel'), []);

  const maxWidth = Math.max(MIN_WIDTH, size.width - MAIN_WIDTH), maxHeight = Math.max(MIN_HEIGHT, size.height - MAIN_HEIGHT);
  const float = fitFloat(drag?.zone === 'float' && place.dock === 'float' ? drag.rect : place.float, view);
  const where: Record<Position, string> = { right: t('Docked on the right'), left: t('Docked on the left'), bottom: t('Docked at the bottom'), float: t('Floating over the page'), window: t('In a separate window'), fill: t('Filling the window') };
  // The window: its content stays this page's, portaled there (popout-window.ts).
  const dockedAt = useRef(place.dock);
  dockedAt.current = place.dock;
  // From the menu it opens at the panel's size; dropped, where it was dropped.
  const openWindow = (dropped?: { left: number; top: number; width: number; height: number }) => {
    const box = current();
    const opened = openPopout('dock-' + key, title, () => { setPopout(null); setAnnouncement(where[dockedAt.current]); }, dropped ?? (box && { width: Math.max(box.width, 360), height: Math.max(box.height, 420) }));
    if (!opened) { setAnnouncement(t('Allow pop-ups for Papilot to open a window.')); return; }
    fill?.set(false);
    setPopout(opened); setAnnouncement(where.window);
  };
  const closeWindow = () => { if (!popout) return; popout.dispose(); setPopout(null); };
  useEffect(() => () => popout?.dispose(), [popout]);
  // Filling the window brings the panel back to it.
  useEffect(() => { if (popout && fill?.on) closeWindow(); }, [fill?.on]);
  // A window whose panel is no longer shown, as when the author leaves the
  // task, closes.
  const placed = useRef(false);
  placed.current = false;
  useEffect(() => { if (popout && !placed.current) closeWindow(); });
  useEffect(() => { popout?.setTitle(title); }, [popout, title]);
  const moveTo = (next: Position, rect?: Rect) => {
    if (next === 'window') { if (!popout) openWindow(); return; }
    closeWindow();
    if (next === 'fill') { fill?.set(true); setAnnouncement(where.fill); return; }
    if (fill?.on) fill.set(false);
    setPlace(current => ({ ...current, dock: next, ...rect ? { float: rect } : {} }));
    setAnnouncement(where[next]);
  };
  const reset = () => { closeWindow(); if (fill?.on) fill.set(false); setPlace({ dock: 'right' }); setWidth(0); setAnnouncement(where.right); onResize?.(); };
  const resizeTo = (next: { width?: number; height?: number; float?: Rect }) => {
    if (next.width !== undefined) setWidth(next.width);
    if (next.height !== undefined || next.float) setPlace(current => ({ ...current, ...next.height !== undefined ? { height: next.height || undefined } : {}, ...next.float ? { float: next.float } : {} }));
    // A floating panel leaves the page's size alone, and its zoom with it.
    if (!next.float) onResize?.();
  };

  // Moving: a press on the position button or the header's empty space that
  // travels a few pixels picks the panel up; Escape puts it back.
  const local = (event: { clientX: number; clientY: number }) => {
    const box = area!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  // Where the panel would go, in the window's coordinates.
  const target = (zone: Dock, pointer: { clientX: number; clientY: number }): Rect => {
    const side = { width: clamp(width || size.panelWidth, MIN_WIDTH, maxWidth), height: clamp(place.height || Math.min(size.height * 0.4, 300), MIN_HEIGHT, maxHeight) };
    const { left, top } = size;
    if (zone === 'left') return { x: left, y: top, width: side.width, height: size.height };
    if (zone === 'right') return { x: left + size.width - side.width, y: top, width: side.width, height: size.height };
    if (zone === 'bottom') return { x: left, y: top + size.height - side.height, width: size.width, height: side.height };
    const shape = fitFloat(place.float, view);
    return fitFloat({ ...shape, x: pointer.clientX - moving.current!.dx, y: pointer.clientY - moving.current!.dy }, view);
  };
  const cancelMove = () => {
    const move = moving.current;
    if (move?.element.hasPointerCapture(move.pointer)) move.element.releasePointerCapture(move.pointer);
    moving.current = null; listening.current?.abort(); listening.current = null; setDrag(null);
    document.body.classList.remove('resizing', 'moving-panel');
    // The click that ends a drag comes next, if at all.
    setTimeout(() => { moved.current = false; });
  };
  useEffect(() => {
    if (!drag) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelMove(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [Boolean(drag)]);
  // The window follows the pointer, so a press that never travels still
  // clicks what it pressed; the handlers see this render's sizes.
  const dragged = useRef(drag);
  dragged.current = drag;
  const live = useRef({ move: (_event: PointerEvent) => {}, end: (_event: PointerEvent) => {} });
  live.current.move = event => {
    const move = moving.current;
    if (!move || move.pointer !== event.pointerId || !area) return;
    // The button came up where this page could not see it.
    if (!event.buttons) { cancelMove(); return; }
    if (!move.started) {
      if (Math.hypot(event.clientX - move.x, event.clientY - move.y) < 5) return;
      move.started = moved.current = true;
      // Held from here on, the pointer still reports beyond the window's edge.
      try { move.element.setPointerCapture(move.pointer); } catch { /* the press already ended */ }
    }
    // Beyond the window, it is dropped into a window of its own.
    if (event.clientX < 0 || event.clientY < 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
      setDrag({ zone: 'window', rect: { x: size.left, y: size.top, width: size.width, height: size.height } });
      return;
    }
    const zone = dropZone(local(event), size);
    setDrag({ zone, rect: target(zone, event) });
  };
  live.current.end = event => {
    const move = moving.current, drop = dragged.current;
    if (!move || move.pointer !== event.pointerId) return;
    if (event.type === 'pointerup' && move.started && drop) {
      if (drop.zone === 'window') openWindow({ left: event.screenX - move.dx, top: event.screenY - move.dy, width: Math.max(move.width, 360), height: Math.max(move.height, 420) });
      else moveTo(drop.zone, drop.zone === 'float' ? drop.rect : undefined);
    }
    cancelMove();
  };
  const listening = useRef<AbortController | null>(null);
  useEffect(() => () => listening.current?.abort(), []);
  const startMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || popout || !area || event.button !== 0 || moving.current) return;
    const box = area.querySelector<HTMLElement>(panel)?.getBoundingClientRect();
    if (!box) return;
    // A floating panel stays where the pointer holds it; a docked one is
    // held near its header's corner.
    const holdsFloat = place.dock === 'float';
    moving.current = { pointer: event.pointerId, element: event.currentTarget, x: event.clientX, y: event.clientY, dx: holdsFloat ? event.clientX - box.left : 24, dy: holdsFloat ? event.clientY - box.top : 16, width: box.width, height: box.height, started: false };
    moved.current = false;
    // Frames, such as the review's, stop taking the pointer from the press on,
    // so the page sees the whole drag.
    document.body.classList.add('resizing', 'moving-panel');
    listening.current?.abort();
    const controller = listening.current = new AbortController(), signal = controller.signal;
    window.addEventListener('pointermove', event => live.current.move(event), { signal });
    for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, event => live.current.end(event), { signal });
  };

  // Resizing: the edge between a docked panel and the rest of its area, or a
  // floating panel's corner.
  const stopResize = () => { resizing.current = null; document.body.classList.remove('resizing', 'resizing-rows'); };
  // A gesture ends when its area stops docking, as when the window narrows.
  useEffect(() => { if (!enabled) { stopResize(); if (moving.current) cancelMove(); } }, [enabled]);
  const resizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizing.current) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    const box = current();
    resizing.current = { x: event.clientX, y: event.clientY, width: box?.width ?? size.panelWidth, height: box?.height ?? size.panelHeight, float };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing', ...dock === 'bottom' ? ['resizing-rows'] : []);
  };
  const resizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizing.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (dock === 'float' && start.float) resizeTo({ float: fitFloat({ ...start.float, width: start.float.width + dx, height: start.float.height + dy }, view) });
    else if (dock === 'bottom') resizeTo({ height: clamp(start.height - dy, MIN_HEIGHT, maxHeight) });
    else resizeTo({ width: clamp(start.width + (dock === 'left' ? dx : -dx), MIN_WIDTH, maxWidth) });
  };
  const resizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); resizeTo(dock === 'float' ? { float: fitFloat(undefined, view) } : dock === 'bottom' ? { height: 0 } : { width: 0 }); return; }
    if (dock === 'float') {
      const grow = { ArrowRight: [STEP, 0], ArrowLeft: [-STEP, 0], ArrowDown: [0, STEP], ArrowUp: [0, -STEP] }[event.key];
      if (!grow) return;
      event.preventDefault(); resizeTo({ float: fitFloat({ ...float, width: float.width + grow[0], height: float.height + grow[1] }, view) });
      return;
    }
    const box = current(), bottom = dock === 'bottom', now = (bottom ? box?.height : box?.width) ?? (bottom ? size.panelHeight : size.panelWidth), max = bottom ? maxHeight : maxWidth, min = bottom ? MIN_HEIGHT : MIN_WIDTH;
    const grow = bottom ? 'ArrowUp' : dock === 'left' ? 'ArrowRight' : 'ArrowLeft', shrink = bottom ? 'ArrowDown' : dock === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const next = event.key === grow ? now + STEP : event.key === shrink ? now - STEP : event.key === 'Home' ? max : event.key === 'End' ? min : null;
    if (next === null) return;
    event.preventDefault(); resizeTo(bottom ? { height: clamp(next, min, max) } : { width: clamp(next, min, max) });
  };
  const resizerProps = {
    tabIndex: 0, onPointerDown: resizeStart, onPointerMove: resizeMove,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); stopResize(); },
    onPointerCancel: stopResize, onLostPointerCapture: stopResize, onKeyDown: resizeKey,
    onDoubleClick: () => resizeTo(dock === 'float' ? { float: fitFloat(undefined, view) } : dock === 'bottom' ? { height: 0 } : { width: 0 }),
    title: t('Drag to resize · Double-click to reset'),
  };
  const docked = dock === 'bottom' ? place.height : width;
  const resizer = !enabled || popout ? null : dock === 'float'
    ? <div className="panel-corner" role="separator" aria-label={label} aria-valuenow={float.width} aria-valuemin={MIN_WIDTH} aria-valuemax={view.width} aria-valuetext={`${float.width} × ${float.height}`} {...resizerProps}/>
    : <div className="panel-resizer" role="separator" aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'} aria-label={label}
      aria-valuenow={dock === 'bottom' ? size.panelHeight : size.panelWidth} aria-valuemin={dock === 'bottom' ? MIN_HEIGHT : MIN_WIDTH} aria-valuemax={dock === 'bottom' ? maxHeight : maxWidth} {...resizerProps}/>;

  const style = {
    ...width ? { [property]: `${width}px` } : {},
    ...enabled && dock === 'bottom' && docked ? { '--dock-height': `${docked}px` } : {},
    ...enabled && dock === 'float' ? { '--float-x': `${float.x}px`, '--float-y': `${float.y}px`, '--float-width': `${float.width}px`, '--float-height': `${float.height}px` } : {},
  } as CSSProperties;
  const position: Position = fill?.on ? 'fill' : dock;
  const names: Record<Position, string> = { right: t('Dock on the right'), left: t('Dock on the left'), bottom: t('Dock at the bottom'), float: t('Float over the page'), fill: t('Fill the window'), window: t('Open in a new window') };
  const icons: Record<Position, string> = { right: 'dockRight', left: 'dockLeft', bottom: 'dockBottom', float: 'dockFloat', fill: 'expand', window: 'external' };
  const choices: Position[] = [...DOCKS, ...fill ? ['fill' as const] : [], 'window'];
  const menuLabel = t('Panel position');
  return {
    dock: position,
    /** Attributes for the area that holds the panel. */
    area: { ref: setArea, 'data-dock': popout ? 'window' : enabled ? dock : undefined, style: Object.keys(style).length ? style : undefined },
    resizer,
    /** Where a dragged panel would land, and where it went. */
    preview: <>
      {drag && !(drag.zone === 'float' && place.dock === 'float') && <div className="dock-preview" data-zone={drag.zone} aria-hidden="true" style={{ left: drag.rect.x, top: drag.rect.y, width: drag.rect.width, height: drag.rect.height }}>
        {drag.zone === 'window' && <span>{t('Release to open in a new window')}</span>}
      </div>}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </>,
    /** The panel, in place or in its own window. */
    place: (node: ReactNode) => { placed.current = true; return popout ? createPortal(<div className="popout-panel">{node}</div>, popout.root) : node; },
    /** The panel is in its own window: this brings it to the front. */
    away: popout ? () => popout.window.focus() : undefined,
    /** Takes the panel back from its own window. */
    closeWindow,
    /** For the panel's header: its empty space moves the panel. */
    header: enabled && !popout ? {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // A control in the header keeps its press; the page around the panel
        // may have roles of its own, which do not count.
        const control = (event.target as Element).closest(':is(button, a, input, textarea, select, label, summary, [tabindex], [contenteditable], [role]:not([role=tablist]), .menu-anchor)');
        if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return;
        startMove(event);
      },
    } : undefined,
    /** The position button: a menu of places, or a handle to drag. */
    control: enabled || popout || fill?.on ? <span className="dock-handle" onPointerDown={event => { event.stopPropagation(); startMove(event); }}
      // A drag ends without opening the menu.
      onClickCapture={event => { if (moved.current && event.detail > 0) { moved.current = false; event.preventDefault(); event.stopPropagation(); } }}>
      <ActionMenu label={`${menuLabel} · ${where[position]}`} className="icon-button dock-button" actions={[
        ...choices.map(value => ({ id: value, label: names[value], icon: icons[value], checked: position === value, divider: value === 'window', select: () => moveTo(value) })),
        { id: 'reset', label: t('Reset panel layout'), divider: true, select: reset },
      ]}><Icon name={icons[position]} size={16}/></ActionMenu>
    </span> : null,
  };
}
