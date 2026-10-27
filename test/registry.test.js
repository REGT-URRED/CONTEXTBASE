import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRegistry, loadToolsState, saveToolsState, setEnabled, getTool } from '../src/registry.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cbr-')); }

test('getRegistry returns tools', () => {
  const dir = tmp();
  const reg = getRegistry(dir);
  assert.ok(Array.isArray(reg));
  assert.ok(reg.some(t => t.id === 'gentle-ai'));
});

test('loadToolsState default', () => {
  const dir = tmp();
  const st = loadToolsState(dir);
  assert.equal(st.version, 1);
  assert.ok(st.tools);
});

test('setEnabled persists', () => {
  const dir = tmp();
  setEnabled('gentle-ai', false, dir);
  const st = loadToolsState(dir);
  assert.equal(st.tools['gentle-ai'].enabled, false);
  const reg = getRegistry(dir);
  const t = reg.find(x => x.id === 'gentle-ai');
  assert.equal(t.enabled, false);
});
