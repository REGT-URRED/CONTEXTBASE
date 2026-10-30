import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSwarmCommand } from '../src/cli_extra.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-swarm-cli-'));
}

function quiet(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('swarm status sin runs informa y no explota', () => {
  const dir = tmp();
  let ok;
  const out = quiet(() => {
    ok = runSwarmCommand(['swarm', 'status'], dir);
  });
  assert.equal(ok, true);
  assert.match(out, /No hay runs/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swarm start rechaza agente no soportado y tarea vacia', () => {
  const dir = tmp();
  assert.throws(() => quiet(() => runSwarmCommand(['swarm', 'start', '--agent', 'claude', '--task', 'x'], dir)), /not supported/i);
  assert.throws(() => quiet(() => runSwarmCommand(['swarm', 'start'], dir)), /tarea/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swarm help lista subcomandos reales', () => {
  const dir = tmp();
  const out = quiet(() => runSwarmCommand(['swarm', 'help'], dir));
  for (const sub of ['start', 'status', 'send', 'collect', 'stop']) {
    assert.ok(out.includes(sub));
  }
  assert.ok(!out.includes('not implemented'));
  fs.rmSync(dir, { recursive: true, force: true });
});
