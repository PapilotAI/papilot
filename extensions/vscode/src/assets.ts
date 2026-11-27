/** Rendered strips name their resources explicitly; source filenames and text are not assets. */
export function reviewAssets(value: unknown): string[] {
  const names = new Set<string>();
  function collect(part: unknown) {
    if (!part || typeof part !== 'object') return;
    if (Array.isArray(part)) { part.forEach(collect); return; }
    const strip = part as Record<string, unknown>;
    if (typeof strip.width === 'number' && typeof strip.height === 'number') {
      for (const key of ['src', 'clean']) {
        const name = strip[key];
        if (typeof name === 'string' && /^[a-zA-Z0-9_.-]+\.(?:png|svg|webp|jpg)$/.test(name)) names.add(name);
      }
    }
    Object.values(strip).forEach(collect);
  }
  collect(value);
  return [...names];
}
