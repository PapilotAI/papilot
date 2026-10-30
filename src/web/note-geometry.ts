export type Rect = [number, number, number, number];

// Text layers report one rectangle per span; join those on the same line so a
// selection is stored and highlighted line by line.
export function mergeLines(rects: Rect[]) {
  const lines: Rect[] = [];
  for (const r of [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const line = lines.find(l => Math.abs((l[1] + l[3]) / 2 - (r[1] + r[3]) / 2) < Math.min(l[3] - l[1], r[3] - r[1]) / 2 && r[0] <= l[2] + 0.02);
    if (line) { line[0] = Math.min(line[0], r[0]); line[1] = Math.min(line[1], r[1]); line[2] = Math.max(line[2], r[2]); line[3] = Math.max(line[3], r[3]); }
    else lines.push([...r]);
  }
  return lines;
}

// The glyph a finger points at: the nearest box, preferring the touched line.
// Boxes are null for spaces, and points farther than `reach` select nothing.
export function nearestGlyph(boxes: (Rect | null)[], x: number, y: number, reach = Infinity) {
  let best = -1, score = reach;
  boxes.forEach((box, i) => {
    if (!box) return;
    const [left, top, right, bottom] = box;
    const distance = 4 * Math.max(top - y, 0, y - bottom) + Math.max(left - x, 0, x - right);
    if (distance < score) { score = distance; best = i; }
  });
  return best;
}

// The word around a glyph: the run of non-space glyphs on its line.
export function wordAround(glyphs: { text: string; line: unknown }[], index: number): [number, number] {
  const line = glyphs[index].line, inWord = (i: number) => glyphs[i]?.line === line && !/\s/u.test(glyphs[i].text);
  let from = index, to = index;
  while (inWord(from - 1)) from--;
  while (inWord(to + 1)) to++;
  return [from, to];
}
