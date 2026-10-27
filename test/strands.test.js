import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareObjective, isReady } from '../src/strands.js';

test('isReady false', () => {
  assert.equal(isReady(), false);
});

test('prepareObjective shape', () => {
  const r = prepareObjective({ project: 'x', tasks: { pending: ['a'] } });
  assert.equal(r.ready, false);
  assert.equal(r.objective.project, 'x');
  assert.deepEqual(r.objective.pendingTasks, ['a']);
});
