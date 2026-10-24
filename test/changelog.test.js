import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEntry } from '../src/changelog.js';

const base = '# Bitacora\n\n## Cambios Realizados\n\n- [2026-01-01] uno\n- [2026-01-02] dos\n\n---\n\n## Cambios por Hacer\n\n- nada\n';

test('inserta la entrada al inicio del bloque', () => {
  const r = appendEntry(base, '- [2026-01-03] tres', 500);
  const idxNew = r.content.indexOf('tres');
  const idxOld = r.content.indexOf('uno');
  assert.ok(idxNew !== -1 && idxNew < idxOld);
  assert.equal(r.rotated.length, 0);
});

test('rota entradas al superar el limite', () => {
  const r = appendEntry(base, '- [2026-01-03] tres', 2);
  assert.equal(r.rotated.length, 1);
  assert.ok(!r.content.includes('- [2026-01-02] dos'), 'la mas vieja sale del archivo activo');
  assert.ok(r.content.includes('tres') && r.content.includes('uno'));
});

test('crea el bloque si no existe', () => {
  const r = appendEntry('# Bitacora\n', '- [2026-01-03] tres', 10);
  assert.ok(r.content.startsWith('## Cambios Realizados'));
  assert.ok(r.content.includes('tres'));
});
