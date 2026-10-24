import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectAgentRules, CONTEXTBASE_VERSION } from '../src/rules.js';

test('inyecta el bloque con marca de version y preserva texto manual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-rules-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Mi manual\n\nNotas propias.\n');
  const injected = injectAgentRules(dir);
  assert.ok(injected.includes('AGENTS.md'));
  const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(content.includes('Notas propias.'));
  assert.ok(content.includes('<!-- CONTEXTBASE:v' + CONTEXTBASE_VERSION + ' -->'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), content + '\nagregado a mano\n');
  injectAgentRules(dir);
  const again = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(again.includes('agregado a mano'));
  assert.equal((again.match(/CONTEXTBASE:START/g) || []).length, 1, 'sin bloques duplicados');
  fs.rmSync(dir, { recursive: true, force: true });
});
