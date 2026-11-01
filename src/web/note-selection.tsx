import { useEffect, useState } from 'react';
import type { Annotation } from '../shared.ts';
import { browserStorage } from './storage.ts';

const storageKey = 'papilot:selected-notes';
function savedSelections(): Record<string, string[]> {
  try {
    const value = JSON.parse(browserStorage.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(id => typeof id === 'string')));
  } catch { return {}; }
}

// A note is reading material until the author explicitly adds it to a task.
// Persist only positive selections per paper; legacy exclusions never implied consent.
export function useNoteSelection(projectId: string, notes: Annotation[]) {
  const [included, setIncluded] = useState(savedSelections);
  useEffect(() => {
    if (Object.keys(included).length) browserStorage.setItem(storageKey, JSON.stringify(included));
    else browserStorage.removeItem(storageKey);
  }, [included]);
  const selected = new Set(included[projectId] || []);
  const has = (id: string) => selected.has(id);
  return {
    selected: notes.filter(note => has(note.id)),
    has,
    set(ids: string[], checked: boolean) {
      setIncluded(current => {
        const next = new Set(current[projectId] || []);
        for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
        const updated = { ...current };
        if (next.size) updated[projectId] = [...next]; else delete updated[projectId];
        return updated;
      });
    },
    reset(target: string) { setIncluded(current => { const next = { ...current }; delete next[target]; return next; }); },
  };
}
