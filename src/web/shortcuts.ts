import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';
import { SHORTCUT_STORAGE, parseShortcuts, type Shortcuts } from '../../vendor/latex-review/src/web/shortcuts.ts';

export * from '../../vendor/latex-review/src/web/shortcuts.ts';
let state = parseShortcuts(browserStorage.getItem(SHORTCUT_STORAGE));
const listeners = new Set<() => void>();
function apply(value: Shortcuts) { state = value; listeners.forEach(listener => listener()); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === SHORTCUT_STORAGE || event.key === null) apply(parseShortcuts(browserStorage.getItem(SHORTCUT_STORAGE)));
});
export function saveShortcuts(value: Shortcuts) {
  browserStorage.setItem(SHORTCUT_STORAGE, JSON.stringify(value)); apply(value);
}
export function useShortcuts() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}
