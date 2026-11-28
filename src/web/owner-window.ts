/** The window an element is shown in: a part of the workspace may have
 *  moved to a window of its own (popout-window.ts). */
export const viewOf = (node?: Node | null): Window => node?.ownerDocument?.defaultView ?? window;
