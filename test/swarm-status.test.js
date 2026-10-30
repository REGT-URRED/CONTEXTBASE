import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
﻿import { readState, startSwarm, swarmCollect, swarmSend, swarmStatus, swarmStop, writeState } from '../src/swarm.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-swarm-st-'));
}

function key(dir) {
  return path.resolve(dir).replace(/\\/g, '/');
}

function deps2(opts = {}) {
  const calls = [];
  const commits = opts.commits || {};
  const porc = opts.porcelain || {};
  return {
    calls,
    exec(args, o = {}) {
      calls.push({ args, cwd: o.cwd });
      const k = o.cwd ? key(o.cwd) : '';
      if (args[0] === 'log') return String(commits[k] ?? 0);
      if (args[0] === 'status') return porc[k] || '';
      if (args[0] === 'merge-tree') {
        if (opts.conflict) throw new Error('conflict');
        return 'tree-id';
      }
      return '';
    },
    spawn() {
      return { pid: opts.pid ?? 111 };
    },
    alive() {
      return opts.alive !== false;
    },
    kill(pid) {
      calls.push({ kill: pid });
    },
    runAgent(args) {
      calls.push({ agent: args });
      if (opts.agentFails) throw new Error('agent fallo');
      return '{}';
    },
  };
}

function run1(dir, deps) {
  return startSwarm({ cwd: dir, base: 'main', agent: 'opencode', workers: 2, task: 'tarea x' }, deps);
}

test('swarmStatus: done con result, stale sin actividad, running recien creado', () => {
  const dir = tmp();
  const base = { commits: {}, porcelain: {} };
  const d = deps2(base);
  const out = run1(dir, d);
  const state = readState(dir, out.run);

  let st = swarmStatus({ cwd: dir, run: out.run }, deps2(base));
  assert.equal(st.workers[0].state, 'running');

  fs.writeFileSync(path.join(dir, state.workers[0].result), 'listo', 'utf8');
  st = swarmStatus({ cwd: dir, run: out.run }, deps2(base));
  assert.equal(st.workers[0].state, 'done');

  const old = Date.now() - 60 * 60 * 1000;
  state.createdAt = new Date(old).toISOString();
  writeState(dir, state);
  const staleDeps = deps2({ commits: { [key(path.join(dir, state.workers[1].worktree))]: Math.floor(old / 1000) } });
  st = swarmStatus({ cwd: dir, run: out.run }, staleDeps);
  assert.equal(st.workers[1].state, 'stale');
  assert.equal(st.workers[1].stale, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swarmSend entrega nativo en opencode y file en agente sin contrato', () => {
  const dir = tmp();
  const d = deps2({});
  const out = run1(dir, d);
  const native = swarmSend({ cwd: dir, run: out.run, worker: 'w1', message: 'dale' }, deps2({}));
  assert.equal(native.delivered, 'native');
  const inbox = path.join(dir, 'contextbase/swarm', out.run, 'w1', 'inbox.md');
  assert.ok(fs.readFileSync(inbox, 'utf8').includes('dale'));

  const state = readState(dir, out.run);
  state.agent = 'claude';
  writeState(dir, state);
  const fileOnly = swarmSend({ cwd: dir, run: out.run, worker: 'w1', message: 'otra' }, deps2({}));
  assert.equal(fileOnly.delivered, 'file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swarmCollect devuelve resultados y veredicto de merge', () => {
  const dir = tmp();
  const out = run1(dir, deps2({}));
  const state = readState(dir, out.run);
  fs.writeFileSync(path.join(dir, state.workers[0].result), 'hice A y B', 'utf8');
  const clean = swarmCollect({ cwd: dir, run: out.run }, deps2({}));
  assert.equal(clean.workers[0].result.includes('hice A'), true);
  assert.equal(clean.workers[0].merge, 'clean');
  const bad = swarmCollect({ cwd: dir, run: out.run }, deps2({ conflict: true }));
  assert.equal(bad.workers[0].merge, 'conflict');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swarmStop no falla con pid muerto y mata el vivo', () => {
  const dir = tmp();
  const out = run1(dir, deps2({ alive: false }));
  assert.deepEqual(swarmStop({ cwd: dir, run: out.run }, deps2({ alive: false })).stopped, []);
  const d = deps2({ alive: true });
  const stopped = swarmStop({ cwd: dir, run: out.run }, d);
  assert.deepEqual(stopped.stopped, ['w1', 'w2']);
  fs.rmSync(dir, { recursive: true, force: true });
});
