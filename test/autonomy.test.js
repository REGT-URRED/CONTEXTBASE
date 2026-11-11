import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { autoCloseFinished } from '../src/terminals.js';
import { ensureStrandsSdk } from '../src/strands.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'contextbase.js');

function tmp(prefix = 'cb-auto-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedRun(dir, run, workers) {
  const runDir = path.join(dir, 'contextbase', 'swarm', run);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
    run, agent: 'opencode', prey: 'prueba', flowState: 'EN_ZONA', createdAt: new Date().toISOString(), ttlMinutes: 10, workers,
  }, null, 2));
}

function fakeDeps(procs) {
  return {
    listProcesses: () => procs,
    kill(pid, force) { const t = procs.find(p => p.pid === pid); if (t) t.killed = { force }; },
    sendAgent() { return { status: 0, stdout: '' }; },
  };
}

test('autogestion: sin corridas activas no cierra nada', async () => {
  const dir = tmp('cb-auto-none-');
  const res = await autoCloseFinished(dir, {}, fakeDeps([]));
  assert.equal(res.closed.length, 0);
  assert.ok(res.reason);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: cierra la terminal del worker terminado y respeta el dry-run', async () => {
  const dir = tmp('cb-auto-done-');
  const resultFile = path.join(dir, 'contextbase', 'swarm', 'r1', 'w1', 'result.md');
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, '# resultado\n');
  seedRun(dir, 'r1', [{ id: 'w1', session: 'ses_w1_aaa', pid: 4242, worktree: 'contextbase/swarm/r1/w1', result: 'contextbase/swarm/r1/w1/result.md', branch: 'swarm/r1/w1' }]);
  const procs = [{ pid: 4242, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --session ses_w1_aaa', createdAt: null }];
  const deps = fakeDeps(procs);

  const dry = await autoCloseFinished(dir, { dryRun: true }, deps);
  assert.equal(dry.candidates.length, 1);
  assert.equal(dry.closed.length, 0);
  assert.equal(procs[0].killed, undefined, 'dry-run no cierra');

  const real = await autoCloseFinished(dir, {}, deps);
  assert.equal(real.closed.length, 1);
  assert.equal(real.closed[0].pid, 4242);
  assert.ok(procs[0].killed);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: no toca workers en curso ni terminales ajenas al proyecto', async () => {
  const dir = tmp('cb-auto-run-');
  const resultFile = path.join(dir, 'contextbase', 'swarm', 'r1', 'w2', 'result.md');
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, '# r\n');
  seedRun(dir, 'r1', [
    { id: 'w1', session: 'ses_run_bbb', pid: 5151, worktree: 'contextbase/swarm/r1/w1', result: 'contextbase/swarm/r1/w1/result.md', branch: 'b1' },
    { id: 'w2', session: 'ses_w2_ccc', pid: 6262, worktree: 'contextbase/swarm/r1/w2', result: 'contextbase/swarm/r1/w2/result.md', branch: 'b2' },
  ]);
  const procs = [
    { pid: 5151, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --session ses_run_bbb', createdAt: null },
    { pid: 6262, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --session ses_w2_ccc', createdAt: null },
    { pid: 7373, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --session ses_ajena_999', createdAt: null },
  ];
  const deps = fakeDeps(procs);
  const res = await autoCloseFinished(dir, {}, deps);
  assert.equal(res.closed.length, 1);
  assert.equal(res.closed[0].pid, 6262, 'solo se cierra el worker terminado');
  assert.equal(procs.find(p => p.pid === 5151).killed, undefined, 'un worker en curso no se cierra');
  assert.equal(procs.find(p => p.pid === 7373).killed, undefined, 'una terminal ajena no se cierra');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: el SDK de Strands se informa sin instalar nada en modo status', () => {
  const dir = tmp('cb-sdk-status-');
  const res = ensureStrandsSdk(dir, { mode: 'status', python: 'python-inexistente-xyz' });
  assert.equal(res.installed, false);
  assert.equal(res.action, 'none');
  assert.ok(res.reason);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: la autoinstalacion del SDK se puede desactivar por entorno', () => {
  const dir = tmp('cb-sdk-off-');
  const prev = process.env.CONTEXTBASE_STRANDS_AUTOINSTALL;
  process.env.CONTEXTBASE_STRANDS_AUTOINSTALL = '0';
  const res = ensureStrandsSdk(dir, { mode: 'auto', python: 'python-inexistente-xyz' });
  if (prev === undefined) delete process.env.CONTEXTBASE_STRANDS_AUTOINSTALL;
  else process.env.CONTEXTBASE_STRANDS_AUTOINSTALL = prev;
  assert.equal(res.action, 'disabled');
  assert.equal(res.installed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: el modo auto deja la instalacion del SDK programada y registrada', () => {
  const dir = tmp('cb-sdk-auto-');
  const res = ensureStrandsSdk(dir, { mode: 'auto', python: 'python-inexistente-xyz' });
  assert.equal(res.action, 'scheduled');
  assert.ok(res.log && res.log.endsWith('sdk-install.log'));
  assert.ok(fs.existsSync(res.log), 'debe existir el log de instalacion');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autogestion: CLI strands sdk --status y terminals auto responden en vivo', () => {
  const dir = tmp('cb-cli-auto-');
  const r1 = spawnSync(process.execPath, [BIN, 'strands', 'sdk', '--status', '--json'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(r1.status, 0, r1.stderr);
  const sdk = JSON.parse(r1.stdout);
  assert.equal(typeof sdk.installed, 'boolean');
  const r2 = spawnSync(process.execPath, [BIN, 'terminals', 'auto', '--json'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(r2.status, 0, r2.stderr);
  const auto = JSON.parse(r2.stdout);
  assert.ok(Array.isArray(auto.closed));
  assert.ok(Array.isArray(auto.skipped));
  fs.rmSync(dir, { recursive: true, force: true });
});
