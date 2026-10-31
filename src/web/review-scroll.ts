// Keep wheel scrolling inside the review even after a decision changes the
// iframe's scroll layers. Resolve the scroller at the pointer, not at the
// element the browser retained from an earlier wheel gesture.
export function installReviewScroll(frame: HTMLIFrameElement, doc: Document) {
  const scroll = (event: WheelEvent, x: number, y: number) => {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey) return;
    const paper = doc.getElementById('paper'), hit = doc.elementFromPoint(x, y);
    if (!paper || !hit || !paper.contains(hit) || hit.closest('select')) return;
    const view = doc.defaultView!;
    const line = parseFloat(view.getComputedStyle(hit).lineHeight) || 16;
    const factorX = event.deltaMode === 1 ? line : event.deltaMode === 2 ? paper.clientWidth : 1;
    const factorY = event.deltaMode === 1 ? line : event.deltaMode === 2 ? paper.clientHeight : 1;
    const dx = event.shiftKey && !event.deltaX ? event.deltaY * factorX : event.deltaX * factorX;
    const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY * factorY;
    if (!dx && !dy) return;
    event.preventDefault();
    paper.scrollTo({ top: paper.scrollTop, left: paper.scrollLeft, behavior: 'instant' });
    // Textareas and source excerpts keep their own scrolling. Once they reach
    // an edge, only the paper can take over; never the surrounding workspace.
    for (const [axis, delta] of [['x', dx], ['y', dy]] as const) {
      if (!delta) continue;
      for (let element: Element | null = hit; element; element = element.parentElement) {
        const style = view.getComputedStyle(element);
        const overflow = axis === 'x' ? style.overflowX : style.overflowY;
        const position = axis === 'x' ? element.scrollLeft : element.scrollTop;
        const extent = axis === 'x' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
        if (/^(auto|scroll)$/.test(overflow) && extent > 0) {
          if (delta < 0 ? position > 0 : position < extent - 1) {
            element.scrollBy({ [axis === 'x' ? 'left' : 'top']: delta, behavior: 'instant' });
            break;
          }
          if (['contain', 'none'].includes(axis === 'x' ? style.overscrollBehaviorX : style.overscrollBehaviorY)) break;
        }
        if (element === paper) break;
      }
    }
  };
  const inside = (event: WheelEvent) => scroll(event, event.clientX, event.clientY);
  const outside = (event: WheelEvent) => {
    // A wheel gesture can still target Chat after the pointer enters the
    // iframe. Only forward it if the iframe is actually under the pointer;
    // toolbars, popovers and dialogs must keep their normal behavior.
    if (frame.ownerDocument.elementFromPoint(event.clientX, event.clientY) !== frame) return;
    const box = frame.getBoundingClientRect();
    scroll(event, (event.clientX - box.left) * frame.clientWidth / box.width, (event.clientY - box.top) * frame.clientHeight / box.height);
  };
  doc.addEventListener('wheel', inside, { passive: false });
  frame.ownerDocument.addEventListener('wheel', outside, { passive: false, capture: true });
  return () => {
    doc.removeEventListener('wheel', inside);
    frame.ownerDocument.removeEventListener('wheel', outside, true);
  };
}
