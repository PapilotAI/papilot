import { useSyncExternalStore } from 'react';
import { browserStorage } from './storage.ts';
import { zhCN } from './zh-CN.ts';

// The interface reads in English or Simplified Chinese. The English text is
// the message key, so a string without a translation still reads correctly.
// Text the agent receives (prompts, note locations) stays in English.
export type Language = 'en' | 'zh-CN';
export type LanguageChoice = Language | 'system';
export const LANGUAGES: { id: Language; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'zh-CN', name: '简体中文' }];
const key = 'papilot:language';
const messages: Record<Language, Record<string, string>> = { en: {}, 'zh-CN': zhCN };

// The first browser language Papilot speaks wins; outside a browser (tests) it is English.
export function browserLanguage(languages: readonly string[] = typeof window === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Language {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}
function savedChoice(): LanguageChoice {
  const value = browserStorage.getItem(key);
  return value === 'en' || value === 'zh-CN' ? value : 'system';
}

let state = { choice: savedChoice(), language: 'en' as Language };
state.language = state.choice === 'system' ? browserLanguage() : state.choice;
const listeners = new Set<() => void>();
function apply(choice: LanguageChoice) {
  const language = choice === 'system' ? browserLanguage() : choice;
  if (choice !== state.choice || language !== state.language) { state = { choice, language }; listeners.forEach(listener => listener()); }
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
apply(state.choice);
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => apply(state.choice));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(savedChoice()); });
}

export function setLanguage(choice: LanguageChoice) {
  if (choice === 'system') browserStorage.removeItem(key); else browserStorage.setItem(key, choice);
  apply(choice);
}
export const language = () => state.language;
// Dates and numbers follow the interface language.
export const locale = () => state.language === 'zh-CN' ? 'zh-CN' : 'en-US';
export function useLanguage() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}

// t('Delete {name}?', { name }) fills {placeholders} after translating.
export function t(text: string, values?: Record<string, string | number>) {
  const template = messages[state.language][text] ?? text;
  return values ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match) : template;
}
// English picks between one and other by count; {n} is the count.
export function tn(count: number, one: string, other: string, values?: Record<string, string | number>) {
  return t(count === 1 ? one : other, { n: count, ...values });
}
