import test from 'node:test';
import assert from 'node:assert/strict';
import { restartDraftText } from '../src/web/restart-draft.ts';

test('restart draft preserves text and review comments without treating old change IDs as replacement decisions', () => {
  assert.equal(restartDraftText('  A draft\n', '', []), '  A draft\n');
  const result = restartDraftText('Keep the numbers.', 'Use consistent notation.', [{ where: 'Round 2 · Results', quote: '4.2', comment: 'Explain this result.', group: 'purple', kind: 'point', anchor: { round: 2, sources: [{ file: 'results.tex', lines: [10, 14] }] }, paper: { page: 2, rects: [[0, 0, 1, 1]], round: 2 }, context: ['Section 3 Results'] }]);
  for (const text of ['Keep the numbers.', 'Use consistent notation.', 'Round 2 · Results', 'results.tex:10–14', 'PDF page 3', 'Section 3 Results', 'Explain this result.', 'Quoted text: 4.2', 'Color group: purple']) assert.ok(result.includes(text));
  assert.match(result, /original task/);
});
