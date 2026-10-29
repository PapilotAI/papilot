import { nearestGlyph, wordAround, type Rect } from './note-geometry.ts';

// A touch selection: a run of a text block's units (glyphs or words).
export type Picked<T> = { target: T; units: HTMLElement[]; from: number; to: number };
type Run<T> = Picked<T> & { words: { text: string; line: unknown }[]; boxes: (Rect | null)[]; anchor: [number, number] };

// Touch screens select PDF text with Papilot's own highlight, handles and
// menu instead of the system's, which callers turn off with user-select. A
// long press picks a word and dragging on extends it word by word; each
// .select-handle (data-end "from" or "to") moves its end, and a tap elsewhere
// clears it. The page does not scroll while a selection is dragged.
export function touchSelection<T>(root: Document | HTMLElement, options: {
  // The text block under a touch, such as a review strip or a PDF page.
  target: (element: Element) => T | undefined;
  // Its units in reading order; neighbouring units of one line form a word.
  units: (target: T) => { units: HTMLElement[]; line: (unit: HTMLElement, index: number) => unknown };
  blocked: () => boolean;
  // Taps on the menu keep the selection.
  menu: string;
  onSelect: (picked: Picked<T>) => void;
  onClear: () => void;
}) {
  // A review frame's document comes from another window, so it is not instanceof Document.
  const view = (root.ownerDocument ?? root as Document).defaultView!;
  const coarse = () => view.matchMedia('(pointer: coarse)').matches;
  const elementAt = (node: EventTarget | null) => node instanceof view.Element ? node : (node as Node | null)?.parentElement;
  let picked: Run<T> | null = null, drag: 'extend' | 'from' | 'to' | null = null;
  let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  function measure(target: T) {
    const { units, line } = options.units(target);
    const words = units.map((unit, i) => ({ text: unit.textContent || '', line: line(unit, i) }));
    const boxes = units.map((unit, i): Rect | null => {
      const r = unit.getBoundingClientRect();
      return /\S/u.test(words[i].text) && (r.width || r.height) ? [r.left, r.top, r.right, r.bottom] : null;
    });
    return { units, words, boxes };
  }
  const emit = () => { if (picked) options.onSelect({ target: picked.target, units: picked.units, from: picked.from, to: picked.to }); };
  const clear = () => { picked = null; options.onClear(); };
  const start = (e: TouchEvent) => {
    clearTimeout(press?.timer); press = null; drag = null;
    if (e.touches.length !== 1 || options.blocked() || !coarse()) return;
    const element = elementAt(e.target), { clientX: x, clientY: y } = e.touches[0];
    const handle = element?.closest<HTMLElement>('.select-handle');
    // The page may have moved since the units were measured.
    if (handle && picked) { Object.assign(picked, measure(picked.target)); drag = handle.dataset.end as 'from' | 'to'; return; }
    if (element?.closest(options.menu)) return;
    const target = element ? options.target(element) : undefined;
    press = { x, y, timer: setTimeout(() => {
      press = null;
      if (target === undefined) return;
      const measured = measure(target), index = nearestGlyph(measured.boxes, x, y, 40);
      if (index < 0) return;
      const word = wordAround(measured.words, index);
      picked = { target, ...measured, anchor: word, from: word[0], to: word[1] };
      drag = 'extend'; emit();
    }, 450) };
  };
  const move = (e: TouchEvent) => {
    const point = e.touches[0]; if (!point) return;
    if (press && Math.hypot(point.clientX - press.x, point.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
    if (!drag || !picked) return;
    e.preventDefault();
    const index = nearestGlyph(picked.boxes, point.clientX, point.clientY); if (index < 0) return;
    const [from, to] = wordAround(picked.words, index);
    if (drag === 'extend') { picked.from = Math.min(picked.anchor[0], from); picked.to = Math.max(picked.anchor[1], to); }
    else if (drag === 'from') picked.from = Math.min(from, wordAround(picked.words, picked.to)[0]);
    else picked.to = Math.max(to, wordAround(picked.words, picked.from)[1]);
    emit();
  };
  const end = (e: TouchEvent) => {
    // A finished selection is not also a tap on what lies below it.
    if (drag) { drag = null; if (e.cancelable) e.preventDefault(); return; }
    if (!press) return;
    clearTimeout(press.timer); press = null;
    if (picked && !elementAt(e.target)?.closest(options.menu)) clear();
  };
  const cancel = () => { clearTimeout(press?.timer); press = null; drag = null; };
  const menu = (e: Event) => { const element = elementAt(e.target); if (coarse() && element && options.target(element) !== undefined) e.preventDefault(); };
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['touchstart', start as EventListener, { passive: true }], ['touchmove', move as EventListener, { passive: false }],
    ['touchend', end as EventListener, { passive: false }], ['touchcancel', cancel], ['contextmenu', menu],
  ];
  for (const [type, listener, settings] of listeners) root.addEventListener(type, listener, settings);
  return {
    active: () => Boolean(picked),
    // Forget the selection without reporting it, after the caller used or dropped it.
    reset: () => { picked = null; drag = null; },
    stop: () => { cancel(); picked = null; for (const [type, listener] of listeners) root.removeEventListener(type, listener); },
  };
}
