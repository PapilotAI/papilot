import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';
import { VIEW_STORAGE, type ReviewView } from '../../engine/src/web/view-preferences.ts';

// Open on the whole paper so revisions retain the manuscript's context.
// An explicit preference for changed sections, or a task's own view, still wins.
export { VIEW_EVENT, type ReviewView } from '../../engine/src/web/view-preferences.ts';
const read = (): ReviewView => browserStorage.getItem(VIEW_STORAGE) === 'changes' ? 'changes' : 'paper';
let view = read();
const listeners = new Set<() => void>();
function apply(value: ReviewView) { view = value; listeners.forEach(listener => listener()); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === VIEW_STORAGE || event.key === null) apply(read());
});
export function saveDefaultReviewView(value: ReviewView) {
  browserStorage.setItem(VIEW_STORAGE, value); apply(value);
}
export function useDefaultReviewView() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => view);
}
