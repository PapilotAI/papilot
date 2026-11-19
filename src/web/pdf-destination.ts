import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { fullPageViewport } from './pdf-crop.ts';

export async function resolvePdfDestination(document: PDFDocumentProxy, destination: string | unknown[]) {
  const explicit = typeof destination === 'string' ? await document.getDestination(destination) : destination;
  if (!Array.isArray(explicit)) return null;
  const [target] = explicit;
  let pageNumber: number | null = null;
  if (target && typeof target === 'object') {
    const ref = target as { num: number; gen: number };
    pageNumber = document.cachedPageNumber(ref) ?? await document.getPageIndex(ref).then(index => index + 1, () => null);
  } else if (Number.isInteger(target)) pageNumber = (target as number) + 1;
  return pageNumber && pageNumber >= 1 && pageNumber <= document.numPages ? { pageNumber, explicit } : null;
}

// Use the original viewport: reader margin crops must not hide a reference.
export function pdfPeekRegion(page: PDFPageProxy, destination: unknown[], width: number, height: number, text?: Awaited<ReturnType<PDFPageProxy['getTextContent']>> | null) {
  const full = fullPageViewport(page, { scale: 1 });
  // Keep ordinary PDF text at least at its 96-dpi reading size. Shrinking an
  // entire page into a small card makes equations and references unreadable.
  const viewport = fullPageViewport(page, { scale: Math.max(96 / 72, width / full.width) });
  const [x0, , , y1] = page.view;
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const kind = (destination[1] as { name?: string } | undefined)?.name;
  let x = x0, y = y1;
  if (kind === 'XYZ') { x = number(destination[2], x); y = number(destination[3], y); }
  else if (kind === 'FitH' || kind === 'FitBH') y = number(destination[2], y);
  else if (kind === 'FitV' || kind === 'FitBV') x = number(destination[2], x);
  else if (kind === 'FitR') { x = number(destination[2], x); y = number(destination[5], y); }
  const [targetX, targetY] = viewport.convertToViewportPoint(x, y);
  const clipWidth = Math.min(width, viewport.width);
  const clipHeight = Math.min(height, viewport.height);
  // Include context above caption destinations as well as the lines below.
  const top = Math.max(0, Math.min(targetY - clipHeight * 0.4, viewport.height - clipHeight));
  // Captions can anchor at the middle of a table. When its local text fits,
  // center the excerpt on that content rather than cutting off its left side.
  const boxes = text?.items.flatMap(item => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [left, bottom] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const [right, itemTop] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] + item.height);
    return Math.max(itemTop, bottom) >= top && Math.min(itemTop, bottom) <= top + clipHeight ? [[Math.min(left, right), Math.max(left, right)]] : [];
  });
  const low = boxes?.length ? Math.min(...boxes.map(box => box[0])) : targetX;
  const high = boxes?.length ? Math.max(...boxes.map(box => box[1])) : targetX;
  const horizontal = high - low <= clipWidth - 16 ? (low + high - clipWidth) / 2 : targetX - 32;
  const left = Math.max(0, Math.min(horizontal, viewport.width - clipWidth));
  return { viewport, left, top, width: clipWidth, height: clipHeight };
}
