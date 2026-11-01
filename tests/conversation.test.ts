import test from 'node:test';
import assert from 'node:assert/strict';
import { aiReviewSummary, isFeedbackPrompt, reviewInstructions, skillPrompt, summarizeFeedback } from '../src/conversation.ts';

test('review feedback is summarized as the author gave it', () => {
  const summary = summarizeFeedback({ feedback: [
    { kind: 'accept', round: 2, changes: ['a', 'b'] },
    { kind: 'reject', round: 2, changes: ['c'] },
    { kind: 'comment', round: 2, text: ' Clarify this. ', changes: [{ file: 'main.tex', lines: [4, 6] }, { file: 'main.tex', lines: [9, 9] }] },
    { kind: 'note', round: 2, text: 'Check the figure caption too.' },
    { kind: 'undo', round: 2 },
  ] });
  assert.deepEqual(summary, { round: 2, accepted: 2, rejected: 1, undone: 1, comments: [{ where: 'main.tex:4 +1', text: 'Clarify this.' }, { where: 'Note on the review', text: 'Check the figure caption too.' }] });
  assert.equal(summarizeFeedback({ feedback: [] }), undefined);
  assert.equal(summarizeFeedback({ feedback: [], build_error: { error: 'Undefined control sequence' } })?.buildError, true);
});

test('a skill prompt carries its instructions and the request, or says there was none', () => {
  const prompt = skillPrompt({ name: 'Proofread', body: 'Fix typos.\n' }, '  Section 2 only. ');
  assert.match(prompt, /^Use the "Proofread" skill below/);
  assert.match(prompt, /<skill name="Proofread">\nFix typos.\n<\/skill>/);
  assert.match(prompt, /Request: Section 2 only.$/);
  assert.match(skillPrompt({ name: 'Polish', body: 'Polish.', folder: '/skills/polish' }, ''), /in \/skills\/polish\.[\s\S]*apply the skill to the whole paper\.$/);
});

test('feedback prompts from this and earlier versions are recognized', () => {
  assert.equal(isFeedbackPrompt(reviewInstructions), true);
  assert.equal(isFeedbackPrompt('Address the comments from this review round. Preserve accepted changes and do not reintroduce rejected edits.'), true);
  assert.equal(isFeedbackPrompt('Address the comments.'), false);
});

test('AI review chat keeps its summary while legacy PDF findings stay out of the conversation', () => {
  const summary = 'Clarify the assumptions.\n\nThe main theorem needs a narrower claim.';
  const old = summary + '\n\n1. **Page 9** — Explain the assumptions.\n\n2. **Page 10** — State the boundary case.';
  assert.equal(aiReviewSummary(old), summary);
  assert.equal(aiReviewSummary(summary), summary);
  assert.equal(aiReviewSummary('1. A summary point\n2. Another point'), '1. A summary point\n2. Another point');
});
