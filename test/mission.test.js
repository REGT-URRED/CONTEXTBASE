import test from 'node:test';
import assert from 'node:assert/strict';
import { missionText } from '../src/mission.js';

test('missionText returns orchestration mission', () => {
  const text = missionText();
  assert.ok(text.includes('Lead Orchestrator'));
  assert.ok(text.includes('Happy Path'));
  assert.ok(text.includes('Fail-Over'));
});
