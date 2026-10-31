import { useEffect, useState } from 'react';
import { canonicalGroup, noteGroups, parseGroupInstructions, type GroupInstructions, type NoteGroup } from '../note-groups.ts';
import type { Annotation } from '../shared.ts';
import { browserStorage } from './storage.ts';

const key = 'papilot:group-instructions';
function saved(): Record<string, GroupInstructions> {
  const result: Record<string, GroupInstructions> = {};
  try {
    const value = JSON.parse(browserStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [project, groups] of Object.entries(value)) {
      try { result[project] = parseGroupInstructions(groups); } catch { /* Ignore an invalid paper's draft. */ }
    }
  } catch { /* A missing or invalid draft starts empty. */ }
  return result;
}

export function useGroupInstructions(projectId: string) {
  const [drafts, setDrafts] = useState(saved);
  useEffect(() => {
    if (Object.keys(drafts).length) browserStorage.setItem(key, JSON.stringify(drafts));
    else browserStorage.removeItem(key);
  }, [drafts]);
  return {
    get: (group: NoteGroup) => drafts[projectId]?.[canonicalGroup(group)] || '',
    set(group: NoteGroup, text: string) { setDrafts(current => ({ ...current, [projectId]: { ...current[projectId], [canonicalGroup(group)]: text } })); },
    forNotes(notes: Annotation[]): GroupInstructions {
      return Object.fromEntries(noteGroups(notes).flatMap(({ group }) => drafts[projectId]?.[group]?.trim() ? [[group, drafts[projectId][group]!.trim()]] : []));
    },
    sent(target: string, sent: Annotation[], pending: Annotation[]) {
      setDrafts(current => {
        const next = { ...current }, groups = { ...next[target] }, ids = new Set(sent.map(note => note.id));
        for (const { group } of noteGroups(sent)) {
          if (!pending.some(note => !ids.has(note.id) && note.group && canonicalGroup(note.group) === group)) delete groups[group];
        }
        if (Object.keys(groups).length) next[target] = groups; else delete next[target];
        return next;
      });
    },
  };
}
