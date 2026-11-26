import { useSyncExternalStore } from 'react';
import { browserStorage, storageKey } from './storage.ts';

// The LaTeX source editor's font size, separate from the interface size so
// the editor can grow without scaling the PDF, sidebars or dialogs.
export const EDITOR_FONT_KEY = 'papilot:editor-font-size';
export const EDITOR_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24] as const;
export const DEFAULT_EDITOR_FONT_SIZE = 12;

export function parseEditorFontSize(value: string | null) {
  return EDITOR_FONT_SIZES.find(size => String(size) === value) ?? DEFAULT_EDITOR_FONT_SIZE;
}

let size: number = parseEditorFontSize(browserStorage.getItem(EDITOR_FONT_KEY));
const listeners = new Set<(size: number) => void>();
function apply(value: number) {
  if (value === size) return;
  size = value;
  for (const listener of listeners) listener(size);
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  // The playground keeps its preferences under a prefix.
  if (event.key === storageKey(EDITOR_FONT_KEY) || event.key === null) apply(parseEditorFontSize(browserStorage.getItem(EDITOR_FONT_KEY)));
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
