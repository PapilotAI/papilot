// A window of its own for part of the workspace, such as the source editor,
// to put on another display. The workspace keeps rendering that part: it
// stays in this page's React tree, portaled into the window, so it shares the
// page's state and needs nothing synchronized. The part mounts anew in the
// window, so what only its elements hold (a textarea's own undo, an open
// menu) starts afresh; the source editor carries its view across instead
// (SourceCodeEditor.attach). The window is same-origin and blank,
// and takes this page's stylesheets, theme and language as they change.
// The desktop app gives windows opened under POPOUT_PREFIX their own frame
// and remembers where they were.
export const POPOUT_PREFIX = 'papilot-popout-';

export interface Popout {
  window: Window;
  /** Where the window's content renders. */
  root: HTMLElement;
  setTitle: (title: string) => void;
  /** Closes the window; onClosed is not called. */
  dispose: () => void;
}

// Pop-outs open now, which notifications ask about: the author working in one
// is not away.
const open = new Set<Window>();
export const popoutFocused = () => [...open].some(win => { try { return !win.closed && win.document.hasFocus(); } catch { return false; } });
/** The document the author is working in: a pop-out's while it has focus. */
export const focusedDocument = (): Document => {
  for (const win of open) { try { if (!win.closed && win.document.hasFocus()) return win.document; } catch { /* closing */ } }
  return document;
};
/** The documents of the pop-outs open now, for listeners such as shortcuts. */
export const popoutDocuments = () => [...open].flatMap(win => { try { return win.closed ? [] : [win.document]; } catch { return []; } });
/** A pop-out shows the workspace even while this window is hidden. */
export const popoutVisible = () => [...open].some(win => { try { return !win.closed && !win.document.hidden; } catch { return false; } });
// Told on this document whenever popoutVisible may have changed.
export const POPOUT_VISIBILITY = 'papilot:popout-visibility';
const visibilityChanged = () => document.dispatchEvent(new Event(POPOUT_VISIBILITY));

// A pop-out opens only from a user's click, which a popup blocker allows;
// null when it is blocked anyway.
// A place on the screen, such as where a panel was dropped outside the
// window, opens it there at that size.
export function openPopout(name: string, title: string, onClosed: () => void, place?: { left?: number; top?: number; width: number; height: number }): Popout | null {
  const width = Math.round(Math.min(place?.width ?? 900, screen.availWidth)), height = Math.round(Math.min(place?.height ?? 1000, screen.availHeight));
  // Only a drop says where; otherwise the desktop app reopens it where it was.
  const where = place?.left !== undefined && place.top !== undefined ? `,left=${Math.round(place.left)},top=${Math.round(place.top)}` : '';
  const win = window.open('', POPOUT_PREFIX + name, `popup,width=${width},height=${height}${where}`);
  if (!win) return null;
  let doc: Document;
  try { doc = win.document; } catch { win.close(); return null; }
  // A blank window has no doctype; a window this page left open still holds
  // its old content. Both start afresh, in standards mode.
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  doc.title = title;
  const clones = new Map<Node, Element>();
  const copy = (node: Node) => {
    if (!(node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet'))) return;
    const clone = doc.importNode(node, true);
    if (node instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = node.href;
    clones.get(node)?.remove();
    clones.set(node, clone);
    doc.head.append(clone);
  };
  const mirror = (from: Element, to: Element) => {
    for (const attribute of [...to.attributes]) if (!from.hasAttribute(attribute.name)) to.removeAttribute(attribute.name);
    for (const attribute of from.attributes) to.setAttribute(attribute.name, attribute.value);
  };
  document.head.childNodes.forEach(copy);
  mirror(document.documentElement, doc.documentElement);
  const styles = new MutationObserver(records => {
    for (const record of records) {
      if (record.target === document.head) {
        record.removedNodes.forEach(node => { clones.get(node)?.remove(); clones.delete(node); });
        record.addedNodes.forEach(copy);
        continue;
      }
      // A style whose rules changed, as in development.
      const owner = record.target instanceof Element ? record.target : record.target.parentNode;
      if (owner?.parentNode === document.head) copy(owner);
    }
  });
  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  const theme = new MutationObserver(() => mirror(document.documentElement, doc.documentElement));
  theme.observe(document.documentElement, { attributes: true });
  const root = doc.createElement('div');
  root.className = 'popout-root';
  doc.body.append(root);
  let disposed = false;
  open.add(win);
  doc.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    open.delete(win);
    visibilityChanged();
    styles.disconnect(); theme.disconnect();
    window.removeEventListener('pagehide', closed);
    if (!win.closed) win.close();
  };
  // Closed by its own frame, or with the page that opened it, which may come
  // back from the back/forward cache with the editor in its tab.
  const closed = () => { if (!disposed) { dispose(); onClosed(); } };
  win.addEventListener('pagehide', closed);
  window.addEventListener('pagehide', closed);
  return { window: win, root, setTitle: value => { if (!win.closed) doc.title = value; }, dispose };
}
