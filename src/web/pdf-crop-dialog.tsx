import { useEffect, useId, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { CROP_STEP, FULL_PAGE, fullPageViewport, moveCropEdge, type PdfCrop } from './pdf-crop.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './pdf-crop.css';

export function PdfCropDialog({ document, page, crop, onApply, onClose }: {
  document: PDFDocumentProxy; page: number; crop: PdfCrop; onApply: (crop: PdfCrop) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLDivElement>(null), preview = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const title = useId(), hint = useId();
  const [draft, setDraft] = useState<PdfCrop>(crop), [number, setNumber] = useState(page), [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(false);
  const drag = useRef<{ id: number; edge: number; start: number; value: number; size: number } | null>(null);
  const labels = [t('Left margin'), t('Top margin'), t('Right margin'), t('Bottom margin')];
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let disposed = false, frame = 0, generation = 0, render: RenderTask | undefined;
    const draw = async () => {
      const own = ++generation;
      setReady(false); setError(false);
      render?.cancel();
      try {
        // A cancelled render must release its canvas before the next one starts.
        await render?.promise.catch(() => {});
        const pdfPage = await document.getPage(number);
        if (disposed || own !== generation) return;
        const area = stage.current!, modal = dialog.current!, full = fullPageViewport(pdfPage, { scale: 1 });
        const style = getComputedStyle(modal), border = modal.offsetHeight - modal.clientHeight;
        // Fit the page to the viewport, reserving the actual height of the
        // controls and 24px on each edge for the 44px drag targets.
        const controls = modal.scrollHeight - area.clientHeight + border;
        const scale = Math.min((parseFloat(style.maxWidth) - border - 48) / full.width, (parseFloat(style.maxHeight) - controls - 48) / full.height);
        if (scale <= 0) return;
        const viewport = fullPageViewport(pdfPage, { scale }), pixelRatio = Math.min(window.devicePixelRatio || 1, 2), target = canvas.current!;
        area.style.width = `${viewport.width + 48}px`; area.style.height = `${viewport.height + 48}px`;
        target.width = Math.ceil(viewport.width * pixelRatio); target.height = Math.ceil(viewport.height * pixelRatio);
        preview.current!.style.width = `${viewport.width}px`; preview.current!.style.height = `${viewport.height}px`;
        render = pdfPage.render({ canvas: target, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        await render.promise;
        if (!disposed && own === generation) setReady(true);
      } catch {
        if (!disposed && own === generation) setError(true);
      }
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => void draw()); };
    const observer = new ResizeObserver(resize);
    for (const element of dialog.current!.children) if (element !== stage.current) observer.observe(element);
    window.addEventListener('resize', resize);
    return () => { disposed = true; generation++; observer.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(frame); render?.cancel(); };
  }, [document, number, retry]);
  return <dialog ref={dialog} className="pdf-crop-dialog" aria-labelledby={title} onClose={onClose}>
    <header>
      <button type="button" className="icon-button" aria-label={t('Cancel')} title={t('Cancel')} autoFocus onClick={() => dialog.current!.close()}><Icon name="close" size={18}/></button>
      <h2 id={title}>{t('Crop margins')}</h2>
      <div className="pdf-crop-actions">
        <button type="button" className="icon-button" aria-label={t('Reset')} title={t('Reset')} onClick={() => { onApply(FULL_PAGE); dialog.current!.close(); }}><Icon name="undo" size={18}/></button>
        <button type="button" className="icon-button pdf-crop-apply" aria-label={t('Apply')} title={t('Apply')} disabled={!ready} onClick={() => { onApply(draft); dialog.current!.close(); }}><Icon name="check" size={20}/></button>
      </div>
    </header>
    <p id={hint}>{t('Drag the edges to crop.')}</p>
    <div className="pdf-crop-stage" ref={stage}>
      <div className="pdf-crop-preview" ref={preview} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} aria-label={t('Page {page}', { page: number })}/>
        <div className="pdf-crop-shade" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${draft[0] * 100}% ${draft[1] * 100}%,${draft[0] * 100}% ${draft[3] * 100}%,${draft[2] * 100}% ${draft[3] * 100}%,${draft[2] * 100}% ${draft[1] * 100}%,${draft[0] * 100}% ${draft[1] * 100}%)` }}/>
        <div className="pdf-crop-outline" style={{ left: `${draft[0] * 100}%`, top: `${draft[1] * 100}%`, width: `${(draft[2] - draft[0]) * 100}%`, height: `${(draft[3] - draft[1]) * 100}%` }}/>
        {labels.map((label, edge) => <button key={edge} type="button" className={'pdf-crop-handle ' + (edge % 2 ? 'horizontal' : 'vertical')} aria-label={`${label} (${Math.round((edge < 2 ? draft[edge] : 1 - draft[edge]) * 100)}%)`} aria-describedby={hint}
          style={{ left: `${(edge % 2 ? (draft[0] + draft[2]) / 2 : draft[edge]) * 100}%`, top: `${(edge % 2 ? draft[edge] : (draft[1] + draft[3]) / 2) * 100}%` }}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            const box = preview.current!.getBoundingClientRect();
            drag.current = { id: event.pointerId, edge, start: edge % 2 ? event.clientY : event.clientX, value: draft[edge], size: edge % 2 ? box.height : box.width };
          }} onPointerMove={event => {
            const current = drag.current;
            if (!current || current.id !== event.pointerId) return;
            const delta = ((current.edge % 2 ? event.clientY : event.clientX) - current.start) / current.size;
            setDraft(value => moveCropEdge(value, current.edge, current.value + delta));
          }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => {
            const direction = edge % 2 ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 };
            const step = direction[event.key as keyof typeof direction];
            if (!step) return;
            event.preventDefault(); setDraft(value => moveCropEdge(value, edge, value[edge] + step * CROP_STEP));
          }}><span/></button>)}
      </div>
      {!ready && <div className="pdf-crop-status">{error ? <><p role="alert">{t('The page preview could not be loaded.')}</p><button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></> : <span className="spinner" aria-label={t('Loading…')}/>}</div>}
    </div>
    <div className="pdf-crop-page"><button type="button" className="icon-button" aria-label={t('Previous page')} disabled={number <= 1} onClick={() => setNumber(value => value - 1)}><Icon name="chevronLeft"/></button><span>{t('Page {page} of {pages}', { page: number, pages: document.numPages })}</span><button type="button" className="icon-button" aria-label={t('Next page')} disabled={number >= document.numPages} onClick={() => setNumber(value => value + 1)}><Icon name="chevronRight"/></button></div>
  </dialog>;
}
