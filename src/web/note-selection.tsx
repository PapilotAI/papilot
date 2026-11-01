import { useEffect, useState } from 'react';
import type { Annotation } from '../shared.ts';
import { browserStorage } from './storage.ts';

const storageKey = 'papilot:excluded-notes';
function savedSelections(): Record<string, string[]> {
  try {
    const value = JSON.parse(browserStorage.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(id => typeof id === 'string')));
  } catch { return {}; }
}

// Human notes start checked; AI suggestions require an explicit selection. Keep exclusions per paper across polling, builds,
// navigation and reloads; a successful send starts a fresh selection.
export function useNoteSelection(projectId: string, notes: Annotation[]) {
  const [excluded, setExcluded] = useState(savedSelections);
  const [includedAi, setIncludedAi] = useState<string[]>(() => {
    try { const value = JSON.parse(browserStorage.getItem('papilot:selected-ai-notes') || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; }
  });
  useEffect(() => { browserStorage.setItem('papilot:selected-ai-notes', JSON.stringify(includedAi)); }, [includedAi]);
  useEffect(() => {
    if (Object.keys(excluded).length) browserStorage.setItem(storageKey, JSON.stringify(excluded));
    else browserStorage.removeItem(storageKey);
  }, [excluded]);
  const omitted = new Set(excluded[projectId] || []);
  const aiIds = new Set(notes.filter(note => note.aiReview).map(note => note.id));
  const has = (id: string) => !omitted.has(id) && (!aiIds.has(id) || includedAi.includes(id));
  return {
    selected: notes.filter(note => has(note.id)),
    has,
    set(ids: string[], checked: boolean) {
      setIncludedAi(current => checked ? [...new Set([...current, ...ids.filter(id => aiIds.has(id))])] : current.filter(id => !ids.includes(id)));
      setExcluded(current => {
        const next = new Set(current[projectId] || []);
        for (const id of ids) { if (checked) next.delete(id); else next.add(id); }
        const updated = { ...current };
        if (next.size) updated[projectId] = [...next]; else delete updated[projectId];
        return updated;
      });
    },
    reset(target: string) { setExcluded(current => { const next = { ...current }; delete next[target]; return next; }); },
  };
}
