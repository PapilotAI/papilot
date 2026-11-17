import { browserStorage } from './storage.ts';
import type { SourceAnchor } from '../shared.ts';

// Positions use PDF points, independent of zoom and viewport size.
export interface PdfPosition { page: number; left: number; top: number }
export interface PdfAnchor extends PdfPosition { id: string; name: string; source?: SourceAnchor; key?: string }
const key = (place: string) => 'papilot:pdf-anchors:' + place;

export function readPdfAnchors(place: string): PdfAnchor[] {
  try {
    const value: unknown = JSON.parse(browserStorage.getItem(key(place)) || '[]');
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.filter((item): item is PdfAnchor => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)
        || typeof item.name !== 'string' || !item.name.trim() || !Number.isInteger(item.page) || item.page < 1
        || !Number.isFinite(item.left) || !Number.isFinite(item.top)) return false;
      if (item.source !== undefined) {
        const source = item.source;
        if (!source || typeof source.file !== 'string' || !source.file || typeof source.revision !== 'string' || !/^[a-f0-9]{64}$/.test(source.revision)
          || !Array.isArray(source.lines) || source.lines.length !== 2 || !source.lines.every((line: unknown) => Number.isSafeInteger(line) && Number(line) > 0)
          || source.lines[1] < source.lines[0] || typeof item.key !== 'string') return false;
      }
      ids.add(item.id); return true;
    });
  } catch { return []; }
}

export function savePdfAnchors(place: string, anchors: PdfAnchor[]) {
  if (anchors.length) browserStorage.setItem(key(place), JSON.stringify(anchors));
  else browserStorage.removeItem(key(place));
}
