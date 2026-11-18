import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { browserStorage } from './storage.ts';

// Fractions of the displayed, uncropped page, including its intrinsic rotation.
// The original PDF and annotation coordinates never change.
export type PdfCrop = [left: number, top: number, right: number, bottom: number];
export const FULL_PAGE: PdfCrop = [0, 0, 1, 1];
// Leave a positive viewport even when opposite handles meet (1% precision).
export const CROP_STEP = 0.01;
export function isCropped(crop: PdfCrop) { return crop.some((value, index) => value !== FULL_PAGE[index]); }
export function validCrop(value: unknown): value is PdfCrop {
  return Array.isArray(value) && value.length === 4 && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
    && value[2] - value[0] >= CROP_STEP - 1e-9 && value[3] - value[1] >= CROP_STEP - 1e-9;
}
export function moveCropEdge(crop: PdfCrop, edge: number, value: number): PdfCrop {
  const next: PdfCrop = [...crop];
  const min = edge < 2 ? 0 : crop[edge - 2] + CROP_STEP;
  const max = edge < 2 ? crop[edge + 2] - CROP_STEP : 1;
  next[edge] = Math.max(min, Math.min(max, value));
  return next;
}
const storageKey = (place: string) => 'papilot:pdf-crop:' + place;
export function readPdfCrop(place?: string): PdfCrop {
  try {
    const value: unknown = place && JSON.parse(browserStorage.getItem(storageKey(place)) || 'null');
    if (validCrop(value)) return value;
  } catch { /* An old or malformed preference opens the full page. */ }
  return FULL_PAGE;
}
export function savePdfCrop(place: string | undefined, crop: PdfCrop) {
  if (!place) return;
  if (isCropped(crop)) browserStorage.setItem(storageKey(place), JSON.stringify(crop));
  else browserStorage.removeItem(storageKey(place));
}

type ViewportOptions = Parameters<PDFPageProxy['getViewport']>[0];
const originalViewports = new WeakMap<PDFPageProxy, PDFPageProxy['getViewport']>();
export function fullPageViewport(page: PDFPageProxy, options: ViewportOptions) {
  return (originalViewports.get(page) ?? page.getViewport.bind(page))(options);
}

// PDF.js uses this viewport for its canvas, text, links, fitting and scrolling.
// Recomputing a cloned viewport keeps its PDF-to-screen transform consistent,
// including nonzero CropBox origins, UserUnit and rotated pages.
export function croppedViewport(full: ReturnType<PDFPageProxy['getViewport']>, crop: PdfCrop) {
  const [x0, y0] = full.convertToPdfPoint(full.width * crop[0], full.height * crop[1]);
  const [x1, y1] = full.convertToPdfPoint(full.width * crop[2], full.height * crop[3]);
  const copy = full.clone();
  copy.viewBox = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  return copy.clone();
}
export function cropDocument(document: PDFDocumentProxy, crop: () => PdfCrop) {
  const getPage = document.getPage.bind(document);
  document.getPage = async number => {
    const page = await getPage(number);
    if (!originalViewports.has(page)) {
      const original = page.getViewport.bind(page);
      originalViewports.set(page, original);
      page.getViewport = (options = { scale: 1 }) => {
        const full = original(options), current = crop();
        if (!isCropped(current)) return full;
        const cropped = croppedViewport(original({ ...options, dontFlip: false }), current);
        return options.dontFlip ? cropped.clone({ dontFlip: true }) : cropped;
      };
    }
    return page;
  };
}

// The note layer keeps the original page dimensions and origin inside the
// cropped page. All existing normalized marks and gesture calculations use it.
export function cropLayerStyle([left, top, right, bottom]: PdfCrop) {
  return { left: `${-left / (right - left) * 100}%`, top: `${-top / (bottom - top) * 100}%`,
    width: `${100 / (right - left)}%`, height: `${100 / (bottom - top)}%`, right: 'auto', bottom: 'auto' };
}
export function originalPageRect(page: HTMLElement, crop = FULL_PAGE) {
  const layer = page.querySelector<HTMLElement>('.note-layer');
  if (layer) return layer.getBoundingClientRect();
  const box = page.getBoundingClientRect(), width = box.width / (crop[2] - crop[0]), height = box.height / (crop[3] - crop[1]);
  return new DOMRect(box.left - crop[0] * width, box.top - crop[1] * height, width, height);
}
