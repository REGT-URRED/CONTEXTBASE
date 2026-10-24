import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncFundamentos, buildSyncBlock } from '../src/generator.js';

const analysis = {
  metadata: { name: 'demo', version: '2.0.0', type: 'Node.js', frameworks: ['React'], dependencies: ['react'], scripts: { test: 'node --test' } },
  directories: ['src', 'test'],
  languages: { JavaScript: 4 }
};

test('syncFundamentos inserta el bloque y conserva notas manuales', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-'));
  fs.mkdirSync(path.join(dir, 'contextbase'));
  const file = path.join(dir, 'contextbase', 'fundamentos.md');
  fs.writeFileSync(file, '# F\n\nNota manual importante.\n\n---\n*Generado automáticamente por ContextBase CLI el 1/1/2026.*\n');
  syncFundamentos(dir, analysis);
  let content = fs.readFileSync(file, 'utf8');
  assert.ok(content.includes('Nota manual importante.'));
  assert.ok(content.includes('<!-- CONTEXTBASE:SYNC:START -->'));
  assert.ok(content.includes('**Dependencias:** react'));
  const first = content;
  syncFundamentos(dir, { ...analysis, metadata: { ...analysis.metadata, dependencies: ['vue'] } });
  content = fs.readFileSync(file, 'utf8');
  assert.equal((content.match(/SYNC:START/g) || []).length, 1, 'no duplica el bloque');
  assert.ok(content.includes('vue'));
  assert.ok(!content.includes('**Dependencias:** react'));
  assert.notEqual(content, first);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSyncBlock contiene datos clave', () => {
  const block = buildSyncBlock(analysis);
  assert.ok(block.includes('**Ecosistema:** Node.js'));
  assert.ok(block.includes('**Scripts:** test'));
});
