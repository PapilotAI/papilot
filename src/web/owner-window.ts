/** The window an element is shown in: a part of the workspace may have
 *  moved to a window of its own (popout-window.ts). */
export const viewOf = (node?: Node | null): Window => node?.ownerDocument?.defaultView ?? window;

/** Whether a value is a node of any window: `instanceof Node` is false for
 *  the nodes of a window of their own, whose Node is another constructor. */
export const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && 'nodeType' in value && typeof (value as Node).contains === 'function';

/** Copies text with the clipboard of the window `from` is shown in, since an
 *  unfocused window's clipboard refuses. Clipboard access needs a secure
 *  context; plain HTTP (as over Tailscale) falls back to a hidden selection. */
export async function copyText(text: string, from?: Node | null) {
  const view = viewOf(from);
  try { await view.navigator.clipboard.writeText(text); return true; }
  catch {
    const doc = view.document, field = doc.createElement('textarea');
    field.value = text; field.readOnly = true; field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
    doc.body.append(field); field.select();
    try { return doc.execCommand('copy'); } catch { return false; } finally { field.remove(); }
  }
}
