import { PDF_READER_STATE } from './pdf-reader.ts';

// Switching between the full paper and the side-by-side pages hands the
// workspace's controls from one reader to the next: a reader that goes clears
// them only when no other view holds them meanwhile, so they do not flicker.
// Kept apart from the reader, so the review can hold them while a view's code
// loads.
let clearing: ReturnType<typeof setTimeout> | undefined;
export function clearSoon(view: Window) {
  clearTimeout(clearing);
  clearing = setTimeout(() => view.dispatchEvent(new CustomEvent(PDF_READER_STATE, { detail: null })), 0);
}
/** A view whose reader is coming keeps the controls as they are until it
 *  announces its own; the returned release clears them if it never does. */
export function holdReader(view: Window) {
  clearTimeout(clearing);
  return () => clearSoon(view);
}
/** A reader announced its own state: nothing is cleared. */
export function keepControls() {
  clearTimeout(clearing);
}
