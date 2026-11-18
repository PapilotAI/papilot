import { useSyncExternalStore } from 'react';
import type { OverleafCursor, OverleafPerson } from '../shared.ts';
import { t } from './i18n.ts';

// Where coauthors' cursors are on Overleaf, by paper, as the host's event
// stream reports them while they move.

let cursors: Record<string, OverleafCursor[]> = {};
const listeners = new Set<() => void>();
const NONE: OverleafCursor[] = [];

export function setPresence(value: unknown) {
  cursors = value && typeof value === 'object' ? value as Record<string, OverleafCursor[]> : {};
  for (const listener of listeners) listener();
}
export function usePresence(projectId: string | undefined): OverleafCursor[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => (projectId && cursors[projectId]) || NONE);
}

/** Each person keeps a hue, for their face, cursor and words. */
export const personHue = (id: string) => Math.round(([...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) * 137.508) % 360);
/** How a person is named: this account as the author, someone not signed in as anonymous. */
export const personName = (person: Pick<OverleafPerson, 'name' | 'you'>) => person.you ? (person.name ? t('{name} (you)', { name: person.name }) : t('You')) : person.name || t('Anonymous');
