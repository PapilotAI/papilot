import React from "react";

// Shared with the workspace's Icon component, so source editing uses the
// same glyphs and stroke weight as the surrounding Papilot controls. The set
// follows Apple's symbol language (rounded, compact, closed shapes) in our own
// drawings.
export const editorIcons = {
  code: <path d="M8 7.5 3.5 12 8 16.5m8-9 4.5 4.5-4.5 4.5M13.75 4.5l-3.5 15"/>,
  pencil: <><path className="icon-fill" d="M16.2 4a2.3 2.3 0 0 1 3.25 0l.55.55a2.3 2.3 0 0 1 0 3.25L8.45 19.35l-4.95 1.15 1.15-4.95Z"/><path d="m14.3 5.9 3.8 3.8"/></>,
  check: <path d="m4.75 12.75 4.75 4.75 9.75-11"/>,
  close: <path d="m6.5 6.5 11 11m0-11-11 11"/>,
  undo: <path d="M8.5 4.5 4 9l4.5 4.5M4 9h10.5a5.5 5.5 0 0 1 0 11h-3"/>,
  refresh: <path d="M19.75 12a7.75 7.75 0 1 1-2.27-5.48L20 9m0-4.75V9h-4.75"/>,
};
export function EditorIcon({ name }: { name: keyof typeof editorIcons }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{editorIcons[name]}</svg>;
}
