import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTask } from '../src/cli.js';

test('task add y task done actualizan tasklist sin residuos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-task-'));
  fs.mkdirSync(path.join(dir, 'contextbase'));
  fs.writeFileSync(path.join(dir, 'contextbase', 'tasklist.md'), '# T\n\n## Tareas Completadas\n\n## Tareas Pendientes / En Progreso\n\n');
  runTask('add', 'tarea de prueba unica', dir);
  let content = fs.readFileSync(path.join(dir, 'contextbase', 'tasklist.md'), 'utf8');
  assert.ok(content.includes('- [ ] tarea de prueba unica'));
  runTask('done', 'unica', dir);
  content = fs.readFileSync(path.join(dir, 'contextbase', 'tasklist.md'), 'utf8');
  assert.ok(content.includes('- [x] tarea de prueba unica'));
  assert.ok(!content.includes('- [ ] tarea de prueba unica'));
  const leftovers = fs.readdirSync(path.join(dir, 'contextbase')).filter(f => f !== 'tasklist.md');
  assert.deepEqual(leftovers, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
