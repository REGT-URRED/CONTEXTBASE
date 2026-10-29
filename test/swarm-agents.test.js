import test from 'node:test';
import assert from 'node:assert/strict';
import { agentInfo, buildLauncher, mintSessionId } from '../src/swarm-agents.js';

test('mintSessionId produce un id con prefijo ses y solo [a-z0-9_]', () => {
  const id = mintSessionId('2026-10-29-a1b2', 'W1');
  assert.match(id, /^ses_[a-z0-9_]+$/);
  assert.ok(id.includes('w1'));
});

test('agentInfo declara no soportado a un cli sin contrato verificado', () => {
  assert.equal(agentInfo('opencode').supported, true);
  const claude = agentInfo('claude');
  assert.equal(claude.supported, false);
  assert.match(claude.reason, /not verified/i);
  assert.equal(agentInfo('noexiste').supported, false);
});

test('buildLauncher no incluye el texto de la tarea', () => {
  const out = buildLauncher({ agent: 'opencode', session: 'ses_cb_x_w1', taskPath: 'contextbase/swarm/x/w1/task.md', platform: 'win32' });
  assert.ok(out.includes('ses_cb_x_w1'));
  assert.ok(out.includes('task.md'));
  assert.ok(out.includes('result.md'));
  assert.ok(!out.includes('multi\nline'));
});

test('buildLauncher rechaza agentes no soportados', () => {
  assert.throws(() => buildLauncher({ agent: 'claude', session: 'ses_x', taskPath: 't.md' }), /not supported/i);
});
