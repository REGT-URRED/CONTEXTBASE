import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic, withLock } from '../src/fsutil.js';

test('writeAtomic escribe y no deja temporales', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fs-'));
  const file = path.join(dir, 'x.md');
  writeAtomic(file, 'hola');
  assert.equal(fs.readFileSync(file, 'utf8'), 'hola');
  assert.deepEqual(fs.readdirSync(dir), ['x.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('withLock libera el bloqueo y detecta contencion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-lock-'));
  const file = path.join(dir, 'x.md');
  const out = withLock(file, () => 'ok');
  assert.equal(out, 'ok');
  assert.equal(fs.existsSync(file + '.lock'), false);
  assert.throws(() => withLock(file, () => withLock(file, () => 'nunca', 40)), /Bloqueo ocupado/);
  fs.rmSync(dir, { recursive: true, force: true });
});
