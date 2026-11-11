import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listTerminals, closeTerminals, sendToTerminal } from '../src/terminals.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const me = process.pid;

function fakeDeps(procs, sent) {
  return {
    listProcesses: () => procs,
    kill(pid, force) { const t = procs.find(p => p.pid === pid); if (t) t.killed = { force }; },
    sendAgent(sessionId, message, o = {}) { if (sent) sent.push({ sessionId, message, cwd: o.cwd }); return { status: 0, stdout: '{"ok":true}' }; },
  };
}

test('terminals list identifica agentes, marca scope y extrae sessionId', () => {
  const deps = fakeDeps([
    { pid: 111, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --cwd "' + REPO + '" --session ses_abc12345', createdAt: 'x' },
    { pid: 222, ppid: 1, exe: 'kilo.exe', commandLine: 'C:\\tools\\kilo.exe', createdAt: 'x' },
    { pid: 333, ppid: 1, exe: 'chrome.exe', commandLine: 'chrome --type=renderer', createdAt: 'x' },
  ]);
  const out = listTerminals(REPO, deps);
  assert.equal(out.length, 2);
  const mine = out.find(t => t.pid === 111);
  assert.equal(mine.scope, 'project');
  assert.equal(mine.sessionId, 'ses_abc12345');
  assert.equal(mine.agent, 'OpenCode');
  const other = out.find(t => t.pid === 222);
  assert.equal(other.scope, 'unknown');
  assert.equal(out.some(t => t.pid === 333), false);
});

test('terminals list marca el proceso actual como protegido', () => {
  const deps = fakeDeps([
    { pid: me, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --cwd "' + REPO + '"', createdAt: null },
  ]);
  const out = listTerminals(REPO, deps);
  assert.equal(out.length, 1);
  assert.equal(out[0].protected, true);
});

test('terminals close es dry-run por defecto y nunca cierra el proceso actual', () => {
  const procs = [
    { pid: me, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode', createdAt: null },
    { pid: 9001, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --cwd "' + REPO + '"', createdAt: null },
  ];
  const deps = fakeDeps(procs);
  const dry = closeTerminals(['all'], { cwd: REPO }, deps);
  assert.equal(dry.dryRun, true);
  assert.equal(procs.find(p => p.pid === 9001).killed, undefined, 'dry-run no cierra nada');
  const dryAll = closeTerminals(['all'], { cwd: REPO, yes: true, force: true }, deps);
  assert.ok(!dryAll.results.some(r => r.pid === me), "all solo cierra agentes con scope=project");
  const yes = closeTerminals([String(me), '9001'], { cwd: REPO, yes: true, force: true }, deps);
  assert.equal(yes.results.find(r => r.pid === 9001).ok, true);
  assert.equal(procs.find(p => p.pid === 9001).killed.force, true);
  assert.equal(yes.results.find(r => r.pid === me).ok, false, 'el proceso actual nunca se cierra');
});

test('terminals close rechaza pids que no son agentes identificados', () => {
  const deps = fakeDeps([
    { pid: 7777, ppid: 1, exe: 'chrome.exe', commandLine: 'chrome', createdAt: null },
  ]);
  const res = closeTerminals(['7777'], { cwd: REPO, yes: true }, deps);
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].reason, /no identificado/);
});

test('terminals send enruta por contrato nativo opencode run --session', () => {
  const sent = [];
  const deps = fakeDeps([
    { pid: 9100, ppid: 1, exe: 'opencode.exe', commandLine: 'opencode --cwd "' + REPO + '" --session ses_native_9', createdAt: null },
  ], sent);
  const r = sendToTerminal(9100, 'compila el modulo', { cwd: REPO }, deps);
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionId, 'ses_native_9');
  assert.equal(sent[0].message, 'compila el modulo');
});

test('terminals send falla con mensaje claro si no hay sesion nativa', () => {
  const deps = fakeDeps([
    { pid: 9101, ppid: 1, exe: 'kilo.exe', commandLine: 'kilo --cwd "' + REPO + '"', createdAt: null },
  ]);
  assert.throws(() => sendToTerminal(9101, 'hola', { cwd: REPO }, deps), /no expone una sesi/);
});

test('terminals list --json se ejecuta en vivo contra la maquina', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-term-'));
  const out = execFileSync(process.execPath, [path.join(REPO, 'bin', 'contextbase.js'), 'terminals', 'list', '--json'], { cwd: dir, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  fs.rmSync(dir, { recursive: true, force: true });
});
