import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareStrandsContext, isReady } from '../src/strands.js';

test('isReady activo en fase 2', () => {
  assert.equal(isReady(), true);
});

test('prepareStrandsContext genera contexto Python y strands_runner.py', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-strands-'));
  const result = prepareStrandsContext(dir);
  assert.equal(result.files.length, 6);
  for (const name of ['context.json', 'project_context.py', 'strands_config.py', 'tasks.py', 'strands_runner.py', 'README.md']) {
    assert.ok(fs.existsSync(path.join(dir, 'contextbase', 'strands', name)), 'falta ' + name);
  }
  const runner = fs.readFileSync(path.join(dir, 'contextbase', 'strands', 'strands_runner.py'), 'utf8');
  assert.ok(runner.includes('ESCALATE_TO_HUMAN = SECURITY_HAS_ISSUES or GUARD_HAS_DRIFT'));
  assert.ok(runner.includes('from strands import Agent'));
  assert.ok(runner.includes('raise SystemExit(main())'));
  const readme = fs.readFileSync(path.join(dir, 'contextbase', 'strands', 'README.md'), 'utf8');
  assert.ok(readme.includes('strands_runner.py'));
  fs.rmSync(dir, { recursive: true, force: true });
});
