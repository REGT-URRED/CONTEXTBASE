import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectState, buildDigest, evaluateHealth } from '../src/context.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ctx-'));
  const cb = path.join(dir, 'contextbase');
  fs.mkdirSync(cb);
  fs.writeFileSync(path.join(cb, 'fundamentos.md'), '# F');
  fs.writeFileSync(path.join(cb, 'changelog.md'), '# C');
  fs.writeFileSync(path.join(cb, 'tasklist.md'), '# T\n\n## Tareas Completadas\n\n- [x] hecha\n\n## Tareas Pendientes / En Progreso\n\n- [ ] pendiente uno\n- [ ] pendiente dos\n');
  fs.writeFileSync(path.join(cb, 'componentes.md'), '# Componentes\n\n- **Node.js / npm**: total 3\n- critical: 2\n- high: 1\n');
  return dir;
}

test('collectState cuenta tareas y brechas', () => {
  const dir = fixture();
  const st = collectState(dir);
  assert.equal(st.tasks.pending.length, 2);
  assert.equal(st.tasks.done.length, 1);
  assert.equal(st.security.critical, 2);
  assert.equal(st.security.high, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evaluateHealth bloquea con brechas critical', () => {
  const dir = fixture();
  const st = collectState(dir);
  const health = evaluateHealth(st, '9.9.9');
  assert.equal(health.ok, false);
  assert.ok(health.problems.some(p => p.includes('critical')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildDigest sugiere corregir brechas primero', () => {
  const dir = fixture();
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.ok(digest.includes('Corregir brechas'));
  assert.ok(digest.length < 4000);
  fs.rmSync(dir, { recursive: true, force: true });
});
