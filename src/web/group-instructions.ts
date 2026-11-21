import { useEffect, useState } from 'react';
import { canonicalGroup, NOTE_GROUPS, noteGroups, parseGroupInstructions, type GroupInstructions, type NoteGroup } from '../note-groups.ts';
import type { Annotation } from '../shared.ts';
import { browserStorage } from './storage.ts';

const key = 'papilot:group-instructions';
function saved(): Record<string, GroupInstructions> {
  const result: Record<string, GroupInstructions> = {};
  try {
    const value = JSON.parse(browserStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [project, groups] of Object.entries(value)) {
      try {
        const parsed = parseGroupInstructions(groups);
        // Keep an author's explicitly cleared instruction for returned notes.
        for (const group of NOTE_GROUPS) if ((groups as GroupInstructions)[group] === '') parsed[group] = '';
        result[project] = parsed;
      } catch { /* Ignore an invalid paper's draft. */ }
    }
  } catch { /* A missing or invalid draft starts empty. */ }
  return result;
}

// A project-wide color draft may describe other marks. Keep edits to
// returned instructions with the exact set of marks the author selected.
function groupDraftScope(projectId: string, selected: Annotation[]) {
  return selected.some(note => note.groupInstruction)
    ? 'returned:' + JSON.stringify([projectId, ...selected.map(note => note.id).sort()])
    : projectId;
}

export interface GroupDraftChange { scope: string; group: keyof GroupInstructions; before?: string; after: string }
export function useGroupInstructions(projectId: string) {
  const [drafts, setDrafts] = useState(saved);
  useEffect(() => {
    if (Object.keys(drafts).length) browserStorage.setItem(key, JSON.stringify(drafts));
    else browserStorage.removeItem(key);
  }, [drafts]);
  function get(group: NoteGroup, selected: Annotation[]) {
    const draft = drafts[groupDraftScope(projectId, selected)]?.[canonicalGroup(group)];
    if (draft !== undefined) return draft;
    const inherited = new Set(selected.map(note => note.groupInstruction));
    // A group instruction applies to every selected mark. Inherit it only
    // when all selected marks already agree on it.
    return inherited.size === 1 ? selected[0].groupInstruction || '' : '';
  }
  function apply(change: GroupDraftChange, direction: 'undo' | 'redo') {
    const value = direction === 'redo' ? change.after : change.before;
    setDrafts(current => {
      const expected = direction === 'undo' ? change.after : change.before;
      if (current[change.scope]?.[change.group] !== expected) return current;
      const groups = { ...current[change.scope] };
      if (value === undefined) delete groups[change.group]; else groups[change.group] = value;
      return { ...current, [change.scope]: groups };
    });
  }
  return {
    get, apply,
    regroup(group: NoteGroup, text: string, selected: Annotation[]) {
      const scope = groupDraftScope(projectId, selected), name = canonicalGroup(group);
      const change = { scope, group: name, before: drafts[scope]?.[name], after: text };
      if (change.before === text) return;
      apply(change, 'redo');
      return change;
    },
    set(group: NoteGroup, text: string, selected: Annotation[]) {
      const scope = groupDraftScope(projectId, selected);
      setDrafts(current => ({ ...current, [scope]: { ...current[scope], [canonicalGroup(group)]: text } }));
    },
    forNotes(notes: Annotation[]): GroupInstructions {
      return Object.fromEntries(noteGroups(notes).flatMap(({ group, entries }) => {
        const text = get(group, entries.map(({ note }) => note)).trim();
        return text ? [[group, text]] : [];
      }));
    },
    sent(target: string, sent: Annotation[], pending: Annotation[]) {
      setDrafts(current => {
        const next = { ...current }, groups = { ...next[target] }, ids = new Set(sent.map(note => note.id));
        for (const { group, entries } of noteGroups(sent)) {
          const scope = groupDraftScope(target, entries.map(({ note }) => note));
          if (scope !== target) { delete next[scope]; continue; }
          if (!pending.some(note => !ids.has(note.id) && note.group && canonicalGroup(note.group) === group)) delete groups[group];
        }
        if (Object.keys(groups).length) next[target] = groups; else delete next[target];
        return next;
      });
    },
  };
}
