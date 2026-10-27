import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recommend, preview } from '../src/bootstrap.js';

test('recommend includes oh-my for claude', () => {
  const ids = recommend('Claude Code');
  assert.ok(ids.includes('oh-my-openclaude'));
});

test('preview returns main and dangerous', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbb-'));
  const pv = await preview(dir, 'OpenCode', ['gentle-ai']);
  assert.ok(Array.isArray(pv.main));
  assert.ok(Array.isArray(pv.dangerous));
});
