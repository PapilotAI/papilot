import type { Annotation, NoteSection, PageReadingLayout } from '../shared.ts';

export interface SectionHeading {
  id: string; title: string; level: number;
  ranges?: Record<string, [number, number][]>;
  /** PDF coordinates normalized from the top of a zero-based page. */
  position?: { page: number; top: number; left?: number };
}
/** Normalized gutter and full-width bands on a page with two columns. */
export type SectionPageLayout = PageReadingLayout;
export interface NoteSections { sections: NoteSection[]; contexts: Record<string, string[]>; unplaced: number; pageLayouts?: Record<number, PageReadingLayout> }

/** Source ranges are authoritative (including columns and included files).
 * Without a source anchor, use exact bookmark destinations, never page-only
 * guesses between headings on the same page. Stale marks are not selected. */
export function groupSectionNotes(notes: Annotation[], key: string, headings: SectionHeading[], layouts: Map<number, SectionPageLayout> = new Map()): NoteSections {
  const sections = headings.map(({ id, title, level }) => ({ id, title, level, notes: [] as string[] }));
  const paths: number[][] = [], stack: number[] = [];
  headings.forEach((heading, index) => {
    while (stack.length && headings[stack.at(-1)!].level >= heading.level) stack.pop();
    stack.push(index); paths.push([...stack]);
  });
  // Within each full-width band, read vertically. Between bands, finish the
  // left column before entering the right one, regardless of their y values.
  // This also handles a full-width title followed by two-column prose.
  const order = (page: number, top: number, left?: number, right = left): number[] | null => {
    const layout = layouts.get(page);
    if (!layout) return [top];
    if (left === undefined || right === undefined) return null;
    let band = 0;
    for (const [start, end] of layout.spanning) {
      if (top < start - 0.002) break;
      if (top <= end + 0.002) return [band + 1, 0, top];
      band += 2;
    }
    if (left < layout.gutter && right > layout.gutter) return null;
    return [band, left >= layout.gutter ? 1 : 0, top];
  };
  const before = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (i === a.length - 1) return a[i] <= b[i] + 0.002;
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return true;
  };
  const sectionAt = (page: number, at: number[]) => {
    let chosen = -1;
    for (let index = 0; index < headings.length; index++) {
      const position = headings[index].position;
      if (!position) continue;
      const heading = order(position.page, position.top, position.left);
      if (position.page < page || (position.page === page && heading && before(heading, at))) chosen = index;
    }
    const next = headings[chosen + 1]?.position;
    if (chosen >= 0 && chosen + 1 < headings.length && (!next || (next.page === page && !order(next.page, next.top, next.left)))) return -1;
    return chosen;
  };
  const contexts: Record<string, string[]> = {};
  let unplaced = 0;
  for (const note of notes) {
    if (note.key !== key) { unplaced++; continue; }
    let chosen = -1;
    if (note.source) {
      // Require the whole source range: a mark crossing sibling sections
      // belongs to their shared parent, not arbitrarily to the last sibling.
      headings.forEach((heading, index) => {
        if (heading.ranges?.[note.source!.file]?.some(([start, end]) => start <= note.source!.lines[0] && end >= note.source!.lines[1])
          && (chosen < 0 || heading.level > headings[chosen].level)) chosen = index;
      });
    }
    if (chosen < 0) {
      // Every rectangle contributes both ends. A selection crossing sibling
      // sections belongs only to their common parent, never its first line.
      let shared: number[] | undefined;
      for (const rect of note.rects?.length ? note.rects : [note.rect]) {
        for (const top of [rect[1], rect[3]]) {
          const at = order(note.page, top, rect[0], rect[2]);
          const section = at && sectionAt(note.page, at);
          const ancestry = section !== null && section >= 0 ? paths[section] : [];
          shared = shared === undefined ? ancestry : shared.filter((id, index) => ancestry[index] === id);
        }
      }
      chosen = shared?.at(-1) ?? -1;
    }
    if (chosen < 0) { unplaced++; continue; }
    for (const index of paths[chosen]) sections[index].notes.push(note.id);
    contexts[note.id] = ['Section: ' + paths[chosen].map(index => headings[index].title).join(' > ')];
  }
  return { sections, contexts, unplaced };
}
