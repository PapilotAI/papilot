import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { browserStorage } from './storage.ts';
import { t } from './i18n.ts';

// Keep a preferred width even when a smaller window temporarily clamps it.
export function usePanelWidth(key: string, property: string, panel: string, label: string, enabled: boolean) {
  const [width, setWidth] = useState(() => {
    const saved = Number(browserStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  });
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [size, setSize] = useState({ current: 300, max: 300 });
  const stop = () => { drag.current = null; document.body.classList.remove('resizing'); };
  useEffect(() => {
    if (width) browserStorage.setItem(key, String(width)); else browserStorage.removeItem(key);
  }, [key, width]);
  useLayoutEffect(() => {
    const grid = handle.current?.parentElement, side = grid?.querySelector<HTMLElement>(panel);
    if (!enabled || !grid || !side) return;
    const observer = new ResizeObserver(() => setSize({ current: Math.round(side.getBoundingClientRect().width), max: Math.max(300, Math.floor(grid.getBoundingClientRect().width - 360)) }));
    observer.observe(grid); observer.observe(side);
    return () => { observer.disconnect(); stop(); };
  }, [enabled, panel]);
  const clamp = (next: number) => Math.round(Math.max(300, Math.min(next, size.max)));
  return {
    style: width ? { [property]: `${width}px` } as CSSProperties : undefined,
    resizer: enabled && <div ref={handle} className="panel-resizer manuscript-resizer" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={size.current} aria-valuemin={300} aria-valuemax={size.max} tabIndex={0}
      title={t('Drag to resize · Double-click to reset')}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { x: event.clientX, width: size.current };
        event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add('resizing');
      }}
      onPointerMove={event => { if (drag.current) setWidth(clamp(drag.current.width + drag.current.x - event.clientX)); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); stop(); }}
      onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={() => setWidth(0)}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); setWidth(0); return; }
        const next = event.key === 'ArrowLeft' ? size.current + 24 : event.key === 'ArrowRight' ? size.current - 24 : event.key === 'Home' ? size.max : event.key === 'End' ? 300 : null;
        if (next !== null) { event.preventDefault(); setWidth(clamp(next)); }
      }}/>,
  };
}
