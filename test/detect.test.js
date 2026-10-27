import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, readMcpConfig, detectCli } from '../src/detect.js';

test('findOnPath finds node', () => {
  assert.equal(findOnPath('node'), true);
});

test('readMcpConfig returns null when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'));
  assert.equal(readMcpConfig('opencode'), null); // may or may not exist globally; at least no throw
});

test('detectCli returns primary', () => {
  const r = detectCli();
  assert.ok(r.primary);
  assert.ok(Array.isArray(r.all));
});
