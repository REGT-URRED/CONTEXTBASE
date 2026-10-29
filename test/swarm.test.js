import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listRuns, readState, startSwarm } from '../src/swarm.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-swarm-'));
}

function fakeDeps(log = [], failOn = -1) {
  let calls = 0;
  return {
    log,
    exec(args) {
      calls += 1;
      if (failOn === calls) throw new Error('git fallo simulado');
      log.push(['exec', ...args]);
      return '';
    },
    spawn(file, cwd) {
      log.push(['spawn', file, cwd]);
      return { pid: 111 };
    },
  };
}

test('startSwarm crea state, task, launcher y devuelve sesiones', () => {
  const dir = tmp();
  const deps = fakeDeps();
  const out = startSwarm({ cwd: dir, base: 'main', agent: 'opencode', workers: 2, task: 'arreglar el fork' }, deps);
  assert.equal(out.workers.length, 2);
  for (const w of out.workers) {
    assert.match(w.session, /^ses_[a-z0-9_]+$/);
    assert.equal(w.pid, 111);
  }
  const state = readState(dir, out.run);
  assert.equal(state.workers.length, 2);
  const taskFile = path.join(dir, state.workers[0].task);
  assert.ok(fs.readFileSync(taskFile, 'utf8').includes('arreglar el fork'));
  const launchFile = path.join(dir, state.workers[0].launcher);
  assert.ok(fs.readFileSync(launchFile, 'utf8').includes(state.workers[0].session));
  assert.deepEqual(listRuns(dir), [out.run]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('startSwarm no deja state si un worktree falla', () => {
  const dir = tmp();
  const deps = fakeDeps([], 2);
  assert.throws(() => startSwarm({ cwd: dir, base: 'main', agent: 'opencode', workers: 2, task: 'x' }, deps), /simulado/);
  assert.deepEqual(listRuns(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('startSwarm rechaza agente no soportado y tarea vacia', () => {
  const dir = tmp();
  assert.throws(() => startSwarm({ cwd: dir, agent: 'claude', workers: 1, task: 'x' }, fakeDeps()), /not supported/i);
  assert.throws(() => startSwarm({ cwd: dir, agent: 'opencode', workers: 1, task: '  ' }, fakeDeps()), /tarea/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
