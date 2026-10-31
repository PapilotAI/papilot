import test from 'node:test';
import assert from 'node:assert/strict';
import { taskEffort } from '../src/web/agent-picker.tsx';

const model = (efforts: string[]) => ({ id: 'm', name: 'M', isDefault: true, efforts, defaultEffort: 'low' });

test('a task reasons at high effort unless an effort was chosen', () => {
  assert.equal(taskEffort(null, model(['low', 'medium', 'high', 'xhigh'])), 'high', 'not the catalog default "low"');
  assert.equal(taskEffort('xhigh', model(['low', 'medium', 'high', 'xhigh'])), 'xhigh');
  assert.equal(taskEffort('', model(['low', 'high'])), '', 'an explicit model default is kept');
  assert.equal(taskEffort('xhigh', model(['low', 'medium', 'high'])), 'high', 'an effort the model lacks falls back to high');
  assert.equal(taskEffort(null, model(['low', 'medium'])), '', 'a model without high keeps its own default');
  assert.equal(taskEffort(null, model([])), '');
  assert.equal(taskEffort(null), '', 'nothing is assumed before models are known');
  assert.equal(taskEffort('max'), 'max');
});
