import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';

const key = 'papilot:note-alternatives';
type Api = <T>(route: string, body?: unknown) => Promise<T>;
let request: Api | null = null, version = 0, enabled = browserStorage.getItem(key) !== 'off';
const listeners = new Set<() => void>();
function apply(value: boolean, keep = true) {
  if (keep) browserStorage.setItem(key, value ? 'on' : 'off');
  if (enabled === value) return;
  enabled = value;
  listeners.forEach(listener => listener());
}
export function loadNoteAlternatives() {
  if (!request) return;
  const asked = version;
  void request<{ noteAlternatives: boolean }>('/note-alternatives').then(value => {
    if (asked === version && typeof value.noteAlternatives === 'boolean') apply(value.noteAlternatives);
  }, () => {});
}
export function connectNoteAlternatives(api: Api) { request = api; loadNoteAlternatives(); }
if (typeof window !== 'undefined') {
  window.addEventListener('focus', loadNoteAlternatives);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(browserStorage.getItem(key) !== 'off', false);
  });
}
export async function saveNoteAlternatives(value: boolean) {
  const before = enabled, asked = ++version;
  apply(value);
  if (!request) return;
  try {
    const result = await request<{ noteAlternatives: boolean }>('/note-alternatives', { noteAlternatives: value });
    if (typeof result.noteAlternatives !== 'boolean') throw new Error('Invalid preference response.');
    if (version === asked) apply(result.noteAlternatives);
  } catch {
    if (version === asked) { apply(before); version++; loadNoteAlternatives(); }
  }
}
export function useNoteAlternatives() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => enabled);
}
