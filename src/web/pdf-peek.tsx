import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { pdfPeekRegion, resolvePdfDestination } from './pdf-destination.ts';
import { t } from './i18n.ts';
import './pdf-peek.css';

type Target = { link: HTMLAnchorElement; document: PDFDocumentProxy };
const internalLink = (target: EventTarget | null) => target instanceof Element
  ? target.closest<HTMLAnchorElement>('.linkAnnotation[data-internal-link] a[href*="#"]') : null;

// PDF.js owns the links. Delegate gestures so lazily rendered/replaced
// annotation layers need no per-link handlers and ordinary clicks keep working.
export function PdfPeek({ container, document: pdf, disabled }: {
  container: RefObject<HTMLDivElement | null>; document: PDFDocumentProxy; disabled: boolean;
}) {
  const id = useId(), panel = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const native = typeof HTMLElement.prototype.showPopover === 'function';
  useEffect(() => {
    setTarget(null);
    const box = container.current;
    if (!box || disabled) return;
    let active: HTMLAnchorElement | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let leaving: ReturnType<typeof setTimeout> | undefined, opened = false, keyboard = false;
    const close = () => { clearTimeout(timer); clearTimeout(leaving); active = null; opened = false; keyboard = false; setTarget(null); };
    const open = (link: HTMLAnchorElement, immediate = false, fromKeyboard = false) => {
      clearTimeout(leaving);
      if (link === active && opened) return;
      close(); active = link; keyboard = fromKeyboard;
      const show = () => {
        const rect = link.getBoundingClientRect(), view = box.getBoundingClientRect();
        if (active === link && link.isConnected && box.clientHeight
          && rect.bottom > Math.max(0, view.top) && rect.top < Math.min(window.innerHeight, view.bottom)
          && rect.right > Math.max(0, view.left) && rect.left < Math.min(window.innerWidth, view.right)) {
          opened = true; setTarget({ link, document: pdf });
        }
      };
      if (immediate) show(); else timer = setTimeout(show, 400);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      const link = internalLink(event.target);
      if (link) open(link);
    };
    const within = (node: EventTarget | null) => node instanceof Node && (active?.contains(node) || panel.current?.contains(node));
    const out = (event: PointerEvent) => {
      if (!active || !within(event.target) || within(event.relatedTarget)) return;
      clearTimeout(timer); clearTimeout(leaving);
      // A small bridge lets the pointer enter the preview without flicker.
      leaving = setTimeout(close, 100);
    };
    const focus = (event: FocusEvent) => {
      const link = internalLink(event.target);
      if (link?.matches(':focus-visible')) open(link, false, true);
    };
    const blur = (event: FocusEvent) => { if (!within(event.relatedTarget)) close(); };
    const click = (event: MouseEvent) => {
      const link = internalLink(event.target);
      if (link && event.button === 0 && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); open(link, true);
      } else close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const popup = panel.current!;
    const abort = new AbortController(), signal = abort.signal;
    box.addEventListener('pointerover', over, { signal });
    box.addEventListener('pointerout', out, { signal });
    box.addEventListener('focusin', focus, { signal });
    box.addEventListener('focusout', blur, { signal });
    box.addEventListener('click', click, { capture: true, signal });
    popup.addEventListener('pointerenter', () => clearTimeout(leaving), { signal });
    popup.addEventListener('pointerleave', out, { signal });
    document.addEventListener('keydown', key, { capture: true, signal });
    document.addEventListener('pointerdown', event => { if (!within(event.target)) close(); }, { capture: true, signal });
    document.addEventListener('scroll', () => {
      // WebKit scrolls a newly focused PDF link after focusin. Keep its
      // pending preview; show() verifies it is still visible after scrolling.
      if (keyboard && !opened && active === document.activeElement) return;
      close();
    }, { capture: true, signal });
    window.addEventListener('blur', close, { signal });
    window.addEventListener('resize', close, { signal });
    window.visualViewport?.addEventListener('resize', close, { signal });
    const resize = new ResizeObserver(close); resize.observe(box);
    return () => { abort.abort(); resize.disconnect(); clearTimeout(timer); clearTimeout(leaving); };
  }, [container, pdf, disabled]);

  const shown = !disabled && target?.document === pdf ? target : null;
  useLayoutEffect(() => {
    const element = panel.current!;
    if (!shown) { if (native && element.matches(':popover-open')) element.hidePopover(); return; }
    const rect = shown.link.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight);
    const below = bottom - rect.bottom - 16, above = rect.top - top - 16;
    const height = Math.min(360, Math.max(above, below));
    element.style.width = `${Math.min(560, right - left - 16)}px`;
    element.style.height = `${Math.max(48, height)}px`;
    element.style.left = `${Math.max(left + 8, Math.min(rect.left, right - parseFloat(element.style.width) - 8))}px`;
    element.style.top = `${below >= height ? rect.bottom + 8 : Math.max(top + 8, rect.top - height - 8)}px`;
    if (native) element.showPopover();
    const previous = shown.link.getAttribute('aria-describedby');
    shown.link.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    return () => {
      if (previous === null) shown.link.removeAttribute('aria-describedby'); else shown.link.setAttribute('aria-describedby', previous);
      if (native && element.matches(':popover-open')) element.hidePopover();
    };
  }, [shown, native, id]);

  return <div ref={panel} id={id} className="pdf-peek" popover={native ? 'manual' : undefined} hidden={!shown} role="tooltip">
    {shown && <PeekContent key={shown.link.href + ':' + shown.link.dataset.elementId} target={shown} panel={panel}/>}
  </div>;
}

function PeekContent({ target, panel }: { target: Target; panel: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pageNumber, setPageNumber] = useState<number | null>(null), [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false, render: RenderTask | undefined;
    void (async () => {
      const source = Number(target.link.closest<HTMLElement>('.page')?.dataset.pageNumber);
      const page = await target.document.getPage(source);
      const annotations = await page.getAnnotations({ intent: 'display' });
      const destination = annotations.find(annotation => annotation.id === target.link.dataset.elementId)?.dest;
      if (!destination) throw new Error('Missing PDF destination');
      const resolved = await resolvePdfDestination(target.document, destination);
      if (!resolved) throw new Error('Invalid PDF destination');
      const preview = await target.document.getPage(resolved.pageNumber);
      const content = await preview.getTextContent().catch(() => null);
      if (cancelled) return;
      setPageNumber(resolved.pageNumber);
      const element = panel.current!, output = canvas.current!;
      const region = pdfPeekRegion(preview, resolved.explicit, element.clientWidth, element.clientHeight - 28, content);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      output.width = Math.ceil(region.width * ratio); output.height = Math.ceil(region.height * ratio);
      output.style.width = `${region.width}px`; output.style.height = `${region.height}px`;
      render = preview.render({ canvas: output, viewport: region.viewport, transform: [ratio, 0, 0, ratio, -region.left * ratio, -region.top * ratio] });
      await render.promise;
      if (cancelled) return;
      setStatus('ready');
      // Supply the excerpt to assistive technology without a live announcement
      // each time the pointer crosses a link.
      setText(content?.items.flatMap(item => {
        if (!('str' in item)) return [];
        const [x, y] = region.viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return x + item.width * region.viewport.scale >= region.left && x <= region.left + region.width && y >= region.top && y <= region.top + region.height ? [item.str] : [];
      }).join(' ') ?? '');
    })().catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [target, panel]);
  return <>
    <div className="pdf-peek-label">{pageNumber ? t('Page {page}', { page: pageNumber }) : t('Preview')}</div>
    <canvas ref={canvas} hidden={status !== 'ready'} role="img" aria-label={text || t('Preview')}/>
    {status !== 'ready' && <div className="pdf-peek-message">{status === 'error' ? t('Preview unavailable') : t('Loading…')}</div>}
  </>;
}
