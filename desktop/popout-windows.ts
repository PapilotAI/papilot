import fs from 'node:fs';
import path from 'node:path';

// The workspace opens part of itself, such as the source editor, in a blank
// window of its own named with this prefix (src/web/popout-window.ts), to
// put on another display. The app gives it a normal frame and opens it where
// it was last closed, on a display that is still connected.
export const POPOUT_PREFIX = 'papilot-popout-';
export type Bounds = { x: number; y: number; width: number; height: number };

export const isPopout = (url: string, frameName: string) => url === 'about:blank' && frameName.startsWith(POPOUT_PREFIX) && frameName.length <= 200;

// An interface size the workspace chose (INTERFACE_SIZES in src/web/appearance.ts).
export const isZoom = (value: unknown): value is number => typeof value === 'number' && value >= 1 && value <= 2;

const valid = (value: unknown): value is Bounds => Boolean(value) && typeof value === 'object'
  && ['x', 'y', 'width', 'height'].every(key => Number.isFinite((value as Record<string, unknown>)[key]))
  && (value as Bounds).width > 0 && (value as Bounds).height > 0;

// The saved place, when enough of it is on a display's work area to grab its
// title bar, no larger than that display; otherwise the window opens where
// the system puts it.
export function placeOnDisplays(saved: unknown, areas: Bounds[]): Bounds | undefined {
  if (!valid(saved)) return undefined;
  const area = areas.find(area => {
    const width = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const top = saved.y >= area.y && saved.y < area.y + area.height - 40;
    return width >= 120 && top;
  });
  if (!area) return undefined;
  return { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(Math.min(saved.width, area.width)), height: Math.round(Math.min(saved.height, area.height)) };
}

// Each kind of pop-out, by its window name, keeps its own place.
export function popoutPlaces(data: string) {
  const file = path.join(data, 'popout-windows.json');
  const all = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch { return {}; }
  };
  return {
    read: (name: string): unknown => all()[name],
    save(name: string, bounds: Bounds) {
      try { fs.writeFileSync(file, JSON.stringify({ ...all(), [name]: bounds })); } catch (error) { console.warn('Could not remember the window place:', error); }
    },
  };
}
