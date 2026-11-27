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

export function assetExtension(headers: Record<string, string>) {
  const mime = headers['content-type']?.split(';')[0];
  if (mime === 'application/pdf') return '.pdf';
  const image = /^image\/(png|jpeg|gif|webp)$/.exec(mime ?? '');
  if (image) return '.' + image[1];
  const name = /filename\*=UTF-8''([^;]+)/i.exec(headers['content-disposition'] ?? '')?.[1];
  if (name) {
    try { return /\.[a-z\d]{1,16}$/i.exec(decodeURIComponent(name))?.[0] ?? '.bin'; }
    catch { /* Fall back when the filename is malformed. */ }
  }
  return '.bin';
}
