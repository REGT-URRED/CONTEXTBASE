import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMaintenance, generateComponentes } from '../src/maintenance.js';

test('runMaintenance genera componentes.md en proyecto vacio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-maint-'));
  const r = runMaintenance(dir);
  const content = fs.readFileSync(r.file, 'utf8');
  assert.ok(content.includes('## Inventario de Componentes'));
  assert.ok(content.includes('## Brechas de Seguridad Detectadas'));
  assert.ok(content.includes('Mantenimiento Automático'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateComponentes marca accion requerida con critical', () => {
  const inv = [{ eco: 'Node.js / npm', file: 'package.json', lastModified: '2026-01-01', deps: [{ name: 'x', installed: '1.0.0' }] }];
  const fresh = [{ eco: 'Node.js / npm', detail: 'ok' }];
  const sec = [{ eco: 'Node.js / npm', total: 2, counts: { critical: 2 }, detail: '- critical: 2' }];
  const md = generateComponentes(inv, fresh, sec);
  assert.ok(md.includes('Acción requerida'));
  assert.ok(md.includes('x (instalado 1.0.0)'));
});
