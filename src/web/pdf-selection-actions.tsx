import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PdfCrop } from './pdf-crop.ts';
import { isCropped } from './pdf-crop.ts';

// Selection actions may extend past a tightly cropped page. Keep them above
// the scrolling pages, while marks and text stay clipped to their page bounds.
export function PdfSelectionActions({ layer, crop, rect, touch, children }: {
  layer: HTMLElement; crop: PdfCrop; rect: number[]; touch: boolean; children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null), clipped = isCropped(crop);
  const viewport = layer.closest<HTMLElement>('.pdf-container'), host = viewport?.parentElement;
  useLayoutEffect(() => {
    if (!clipped || !viewport || !host || !menu.current) return;
    const element = menu.current;
    let frame = 0;
    const place = () => {
      const pageElement = layer.closest('.page');
      if (!layer.isConnected || !pageElement) { element.style.visibility = 'hidden'; return; }
      const page = layer.getBoundingClientRect(), visible = pageElement.getBoundingClientRect(), view = viewport.getBoundingClientRect(), origin = host.getBoundingClientRect();
      const anchor = { left: page.left + rect[0] * page.width, top: page.top + rect[1] * page.height, right: page.left + rect[2] * page.width, bottom: page.top + rect[3] * page.height };
      element.style.visibility = anchor.bottom < Math.max(view.top, visible.top) || anchor.top > Math.min(view.bottom, visible.bottom) ? 'hidden' : 'visible';
      element.style.maxWidth = `${Math.max(0, view.width - 16)}px`;
      const size = element.getBoundingClientRect(), first = element.firstElementChild?.getBoundingClientRect();
      const x = Math.max(view.left + 8, Math.min(anchor.right - (first?.width || size.width), view.right - size.width - 8));
      const below = Math.min(anchor.bottom, visible.bottom) + (touch ? 22 : 8);
      const y = below + size.height <= view.bottom - 8 ? below : Math.max(view.top + 8, Math.min(anchor.top - size.height - 8, view.bottom - size.height - 8));
      element.style.left = `${x - origin.left}px`; element.style.top = `${y - origin.top}px`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    const observer = new ResizeObserver(schedule);
    observer.observe(layer); observer.observe(viewport); observer.observe(element);
    viewport.addEventListener('scroll', schedule); place();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); viewport.removeEventListener('scroll', schedule); };
  }, [clipped, layer, viewport, host, rect[0], rect[1], rect[2], rect[3], touch]);
  return clipped && host ? createPortal(<div ref={menu} className="pdf-crop-selection-actions">{children}</div>, host) : children;
}
