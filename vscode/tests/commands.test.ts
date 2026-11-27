import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedCommand } from '../src/commands.ts';

test('task actions are limited to the current conversation', () => {
  for (const command of ['papilot.apply', 'papilot.review']) {
    assert.equal(allowedCommand('chat', command, 'current', 'current'), true);
    assert.equal(allowedCommand('chat', command, 'previous', 'current'), false);
    assert.equal(allowedCommand('chat', command), false);
    for (const kind of ['paper', 'review'] as const) assert.equal(allowedCommand(kind, command, 'current', 'current'), false);
  }
  assert.equal(allowedCommand('chat', 'workbench.action.closeWindow'), false);
  assert.equal(allowedCommand('paper', 'papilot.build'), true);
  assert.equal(allowedCommand('review', 'papilot.build'), false);
});
