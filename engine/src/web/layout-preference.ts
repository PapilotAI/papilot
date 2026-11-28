// How a change's before and after are arranged: stacked, old lines above new,
// or side by side in two aligned columns. Each viewer remembers it, and other
// open reviews follow a change through storage.
export type ReviewLayout = "stacked" | "side-by-side";
export const LAYOUT_STORAGE = "papilot:review:layout";
export function readLayout(): ReviewLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE) === "side-by-side" ? "side-by-side" : "stacked";
  } catch {
    return "stacked";
  }
}
export function saveLayout(layout: ReviewLayout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE, layout);
  } catch {
    /* Optional storage: the choice lasts for this page. */
  }
}
