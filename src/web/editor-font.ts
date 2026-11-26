import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';

// The LaTeX source editor's font size, separate from the interface size so
// the editor can grow without scaling the PDF, sidebars or dialogs.
export const EDITOR_FONT_KEY = 'papilot:editor-font-size';
export const EDITOR_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24] as const;
export const DEFAULT_EDITOR_FONT_SIZE = 12;

export function parseEditorFontSize(value: string | null) {
  return EDITOR_FONT_SIZES.find(size => String(size) === value) ?? DEFAULT_EDITOR_FONT_SIZE;
}
export function stepEditorFontSize(size: number, direction: 'in' | 'out' | 'reset') {
  if (direction === 'reset') return DEFAULT_EDITOR_FONT_SIZE;
  const index = EDITOR_FONT_SIZES.findIndex(value => value >= size);
  const current = index < 0 ? EDITOR_FONT_SIZES.length - 1 : index;
  return EDITOR_FONT_SIZES[Math.max(0, Math.min(EDITOR_FONT_SIZES.length - 1, current + (direction === 'in' ? 1 : -1)))];
}

let size: number = parseEditorFontSize(browserStorage.getItem(EDITOR_FONT_KEY));
const listeners = new Set<(size: number) => void>();
function apply(value: number) {
  if (value === size) return;
  size = value;
  for (const listener of listeners) listener(size);
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === EDITOR_FONT_KEY || event.key === null) apply(parseEditorFontSize(browserStorage.getItem(EDITOR_FONT_KEY)));
});

export const editorFontSize = () => size;
export function setEditorFontSize(value: number) {
  const next = parseEditorFontSize(String(value));
  browserStorage.setItem(EDITOR_FONT_KEY, String(next));
  apply(next);
}
export function onEditorFontSize(listener: (size: number) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useEditorFontSize = () => useSyncExternalStore(onEditorFontSize, editorFontSize);
