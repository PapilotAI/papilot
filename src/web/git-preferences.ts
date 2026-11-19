import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';
import { isPlayground } from './playground-mode.ts';
import { isCommitMessageLanguage, type CommitMessageLanguage } from '../commit.ts';

const KEY = 'papilot:advanced-git';
const readAdvanced = () => (browserStorage.getItem(KEY) ?? (isPlayground ? 'on' : 'off')) === 'on';
let advanced = readAdvanced();
const listeners = new Set<() => void>();
function apply(value: boolean) { advanced = value; listeners.forEach(listener => listener()); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === KEY || event.key === null) apply(readAdvanced());
});
export function saveAdvancedGit(value: boolean) {
  browserStorage.setItem(KEY, value ? 'on' : 'off'); apply(value);
}
export function useAdvancedGit() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => advanced);
}

const LANGUAGE_KEY = 'papilot:commit-message-language';
function readCommitLanguage(): CommitMessageLanguage {
  const value = browserStorage.getItem(LANGUAGE_KEY);
  return isCommitMessageLanguage(value) ? value : 'auto';
}
let commitLanguage = readCommitLanguage();
const languageListeners = new Set<() => void>();
function applyCommitLanguage(value: CommitMessageLanguage) {
  if (value === commitLanguage) return;
  commitLanguage = value;
  languageListeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === LANGUAGE_KEY || event.key === null) applyCommitLanguage(readCommitLanguage());
});
export function saveCommitMessageLanguage(value: CommitMessageLanguage) {
  if (value === 'auto') browserStorage.removeItem(LANGUAGE_KEY); else browserStorage.setItem(LANGUAGE_KEY, value);
  applyCommitLanguage(value);
}
export const commitMessageLanguage = () => commitLanguage;
export function useCommitMessageLanguage() {
  return useSyncExternalStore(listener => { languageListeners.add(listener); return () => { languageListeners.delete(listener); }; }, commitMessageLanguage);
}
