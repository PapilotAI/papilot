import { expect, it } from 'vitest';
import { groupFormattingChanges } from '../../src/core/formatting-changes.ts';
import type { ChangeBlock, RoundDetail } from '../../src/types.ts';

function fixture(old: string, next: string, format: [number, number, string, string]): RoundDetail {
  const unit = (id: string, start: number, end: number, old_text: string, new_text: string) => ({ id, file: 'main.tex', status: 'modified' as const, kind: 'text' as const, whole_file: false, truncated: false, old_start: 1, old_end: 2, new_start: 1, new_end: 2, old_text, new_text, ops: [], text_ops: [['replace', start, end, start, start + new_text.length] as ["replace", number, number, number, number]] });
  const at = old.indexOf('fast');
  const block = (id: string, identical: boolean): ChangeBlock => ({ kind: 'change', units: [id], identical, before: [], after: [] });
  return { task: 'task', round: 1, before: old, after: next, files: '', warnings: [], units: [unit('word', at, at + 4, 'fast', 'efficient'), unit('space', ...format)],
    sections: [{ node: 'intro', number: '1', title: 'Intro', blocks: [block('word', false)] }], loose: [block('space', true)] };
}

it('folds existing invisible wrap cards into a nearby prose card without losing exact units or mutating the saved round', () => {
  const old = 'The model is fast and\nthe result is stable.\n', at = old.indexOf('\n');
  // Rewrap this one interior break; preserve the file's final newline.
  const next = old.slice(0, at).replace('fast', 'efficient') + ' ' + old.slice(at + 1);
  const detail = fixture(old, next, [at, at + 1, '\n', ' ']);
  const grouped = groupFormattingChanges(detail, () => old);
  expect(grouped.loose).toEqual([]);
  expect((grouped.sections[0].blocks[0] as ChangeBlock).units).toEqual(['word', 'space']);
  expect(grouped.units.map(({ formattingFor, ...unit }) => unit)).toEqual(detail.units);
  expect(grouped.units[1].formattingFor).toBe('word');
  expect(detail.loose).toHaveLength(1);
  expect((detail.sections[0].blocks[0] as ChangeBlock).units).toEqual(['word']);
});

it('retains paragraph changes, whitespace-sensitive source and formatting without a related edit', () => {
  for (const old of ['The model is fast.\n\nAnother\nparagraph.\n', '\\begin{verbatim}\nThe model is fast and\nthe result is stable.\n\\end{verbatim}\n']) {
    const at = old.indexOf('\n', old.indexOf('Another') >= 0 ? old.indexOf('Another') : old.indexOf('fast'));
    const detail = fixture(old, old, [at, at + 1, '\n', ' ']);
    expect(groupFormattingChanges(detail, () => old).loose).toHaveLength(1);
  }
  const old = 'The model is fast and\nthe result is stable.\n', at = old.indexOf('\n');
  expect(groupFormattingChanges(fixture(old, old, [at, at + 1, '\n', '\n\n']), () => old).loose).toHaveLength(1);
  const alone = fixture(old, old, [at, at + 1, '\n', ' ']); alone.sections = [];
  expect(groupFormattingChanges(alone, () => old).loose).toHaveLength(1);
});

it('folds located identical multi-unit whitespace blocks from sections into context while respecting \\item boundaries', () => {
  const old = '\\item The first\nword is fast and\nstable.\n\\item Second\nitem stays.\n';
  const wordAt = old.indexOf('fast'), s1 = old.indexOf('\n'), s2 = old.indexOf('\n', wordAt), s3 = old.indexOf('\n', old.indexOf('Second'));
  const makeUnit = (id: string, start: number, end: number, old_text: string, new_text: string) => ({
    id, file: 'main.tex', status: 'modified' as const, kind: 'text' as const, whole_file: false, truncated: false,
    old_start: 1, old_end: 2, new_start: 1, new_end: 2, old_text, new_text, ops: [],
    text_ops: [['replace', start, end, start, start + new_text.length] as ['replace', number, number, number, number]],
  });
  const strip = {
    src: 's1-marked.svg',
    clean: 's1.svg',
    width: 600,
    height: 20,
    page: 1,
    label: '1',
    top: 100,
    marks: [{ unit: 'w1', kind: 'moved' as const, rect: [0, 0, 10, 10] as [number, number, number, number] }],
  };
  const detail: RoundDetail = {
    task: 'task', round: 1, before: old, after: old, files: '', warnings: [],
    units: [
      makeUnit('word', wordAt, wordAt + 4, 'fast', 'efficient'),
      makeUnit('w1', s1, s1 + 1, '\n', ' '),
      makeUnit('w2', s2, s2 + 1, '\n', ' '),
      makeUnit('otherItem', s3, s3 + 1, '\n', ' '),
    ],
    sections: [{
      node: 'intro', number: '1', title: 'Intro',
      blocks: [
        { kind: 'change', units: ['w1', 'w2'], identical: true, before: [], after: [strip] },
        { kind: 'change', units: ['word'], identical: false, before: [], after: [] },
        { kind: 'change', units: ['otherItem'], identical: true, before: [], after: [] },
      ],
    }],
    loose: [],
  };
  const grouped = groupFormattingChanges(detail, () => old);
  expect(grouped.sections[0].blocks[0]).toEqual({
    kind: 'context',
    image: { ...strip, src: 's1.svg', marks: undefined },
  });
  expect((grouped.sections[0].blocks[1] as ChangeBlock).units).toEqual(['word', 'w1', 'w2']);
  // The wrap in the next \item stays separate instead of crossing an item boundary.
  expect((grouped.sections[0].blocks[2] as ChangeBlock).units).toEqual(['otherItem']);
});
