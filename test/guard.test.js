import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseline, check, scanSuspicious, hashFile } from '../src/guard.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cbg-')); }

test('baseline creates and check ok', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'hello', 'utf8');
  const b = baseline(dir);
  assert.ok(b.files['AGENTS.md']);
  const r = check(dir);
  assert.equal(r.status, 'ok');
});

test('tampered file reports modified', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'hello', 'utf8');
  baseline(dir);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'changed', 'utf8');
  const r = check(dir);
  assert.equal(r.status, 'drift');
  assert.ok(r.drifts.some(d => d.kind === 'modified'));
});

test('missing file reports missing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'hello', 'utf8');
  baseline(dir);
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  const r = check(dir);
  assert.equal(r.status, 'drift');
  assert.ok(r.drifts.some(d => d.kind === 'missing'));
});

test('suspicious content detected', () => {
  const r = scanSuspicious('token sk-abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(r.suspicious, true);
});

test('hashFile returns null for missing', () => {
  assert.equal(hashFile('/no/such/file'), null);
});
