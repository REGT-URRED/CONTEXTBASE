import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as snapshot from '../src/snapshot.js';
import { baseline } from '../src/guard.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-')); }

test('snapshot create/list/restore roundtrip', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'original', 'utf8');
  baseline(dir);
  const id = await snapshot.create(dir, 'test');
  assert.ok(id);
  const list = snapshot.list(dir);
  assert.ok(list.length >= 1);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'tampered', 'utf8');
  const r = await snapshot.restore(dir, id);
  assert.equal(r.ok, true);
  assert.ok(r.restored.includes('AGENTS.md'));
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'original');
});
