import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { runAgentProcess } from '../src/swarm.js';
import { autoPulseWeb, autoFinalizeSpiderWorktree, startWeb } from '../src/web.js';
import { autoEnsure } from '../src/auto.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'contextbase.js');

function tmp(prefix = 'cb-qa-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeDeps(calls = [], root = '') {
  return {
    calls,
    exec(args, o = {}) {
      calls.push({ exec: args, cwd: o.cwd });
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(path.join(root, args[2]), { recursive: true });
        return '';
      }
      if (args[0] === 'merge-tree') return 'tree';
      if (args[0] === 'log') return String(Math.floor(Date.now() / 1000));
      return '';
    },
    spawn(launcher, cwd) {
      calls.push({ spawn: launcher, cwd });
      return { pid: 4242 };
    },
    runAgent(args, o = {}) {
      calls.push({ runAgent: args, cwd: o.cwd });
      return '{}';
    },
    alive() {
      return true;
    },
    kill(pid) {
      calls.push({ kill: pid });
    },
  };
}

function seedProject(dir) {
  const cb = path.join(dir, 'contextbase');
  fs.mkdirSync(cb, { recursive: true });
  fs.writeFileSync(path.join(cb, 'fundamentos.md'), '# Fundamentos\n');
  fs.writeFileSync(path.join(cb, 'changelog.md'), '# Changelog\n## Cambios Realizados\n');
  fs.writeFileSync(path.join(cb, 'tasklist.md'), '# Tasklist\n## Tareas Completadas\n\n## Tareas Pendientes / En Progreso\n');
  fs.writeFileSync(path.join(cb, 'componentes.md'), '# Componentes\n- critical: 0\n- high: 0\n');
  return dir;
}

function cli(args, cwd, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    timeout: 30000,
  });
}

// ---------------------------------------------------------------------------
// P0.1 - node --test no debe colgarse ni dejar procesos huerfanos
// ---------------------------------------------------------------------------

test('P0.1 runAgentProcess aborta con error controlado al superar el timeout', () => {
  const dir = tmp('cb-qa-timeout-');
  const started = Date.now();
  assert.throws(
    () =>
      runAgentProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        cwd: dir,
        timeout: 700,
        shell: false,
      }),
    /Timeout/i
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 10000, `el timeout no debe colgar el proceso (tardo ${elapsed} ms)`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.1 autoPulseWeb usa los deps inyectados y no lanza agentes reales', () => {
  const dir = seedProject(tmp('cb-qa-pulse-'));
  const calls = [];
  const deps = fakeDeps(calls, dir);
  const started = startWeb({ cwd: dir, prey: 'Verificar deps', spiders: 1, agent: 'opencode', base: 'main' }, deps);

  const t0 = Date.now();
  const arb = autoPulseWeb(dir, deps);
  assert.ok(Date.now() - t0 < 10000, 'autoPulseWeb no debe lanzar sesiones reales de agente');
  assert.ok(arb && arb.run === started.run);
  assert.ok(calls.some((c) => c.exec), 'los deps inyectados deben llegar a arbitrateWeb');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.1 autoFinalizeSpiderWorktree acepta deps inyectados', () => {
  const dir = seedProject(tmp('cb-qa-final-'));
  const calls = [];
  const deps = fakeDeps(calls, dir);
  const started = startWeb({ cwd: dir, prey: 'Finalizar trabajo', spiders: 1, agent: 'opencode', base: 'main' }, deps);

  const t0 = Date.now();
  const out = autoFinalizeSpiderWorktree(path.join(dir, started.workers[0].worktree), ['src/app.js'], deps);
  assert.ok(Date.now() - t0 < 10000, 'autoFinalizeSpiderWorktree no debe lanzar sesiones reales de agente');
  assert.ok(out);
  assert.ok(calls.some((c) => c.exec), 'los deps inyectados deben llegar a arbitrateWeb');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.1 autoEnsure con una corrida activa no se cuelga ni lanza agentes reales', () => {
  const dir = seedProject(tmp('cb-qa-ensure-'));
  const calls = [];
  const started = startWeb({ cwd: dir, prey: 'Auto ensure', spiders: 1, agent: 'opencode', base: 'main' }, fakeDeps(calls, dir));

  const t0 = Date.now();
  autoEnsure(dir, { autoConfig: true });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 15000, `autoEnsure no debe lanzar opencode real (tardo ${elapsed} ms)`);
  assert.ok(fs.existsSync(path.join(dir, 'contextbase', 'changelog.md')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.1 el CLI con un subcomando valido pero con errores de ejecucion no queda colgado', () => {
  const dir = seedProject(tmp('cb-qa-cli-hang-'));
  const res = cli(['web', 'status', '--json'], dir);
  assert.ok(res.status !== null, 'el proceso debe terminar por si mismo');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P0.2 / P1 / DoD - config conservado, MCP, slop, web json, concurrencia, exit codes
// ---------------------------------------------------------------------------

test('P0.2 config corrupto no se pisa y conserva backup', async () => {
  const dir = tmp('cb-qa-corrupt-');
  const corrupt = '{ "mcp": { broken,,, "';
  fs.writeFileSync(path.join(dir, 'opencode.json'), corrupt);
  const { autoConfigureProject } = await import('../src/autoconfig.js');
  const res = autoConfigureProject(dir, {});
  assert.equal(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'), corrupt, 'el archivo corrupto debe quedar intacto');
  assert.ok(fs.existsSync(path.join(dir, 'opencode.json.bak-contextbase')), 'debe existir el backup .bak-contextbase');
  assert.ok((res.failures || []).length >= 1, 'el fallo debe quedar reportado');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P1.3 MCP resources/read con strands/context.json corrupto responde -32602', async () => {
  const dir = seedProject(tmp('cb-qa-mcp-'));
  fs.mkdirSync(path.join(dir, 'contextbase', 'strands'), { recursive: true });
  const ctxPath = path.join(dir, 'contextbase', 'strands', 'context.json');
  fs.writeFileSync(ctxPath, '{ corrupt json');
  fs.chmodSync(ctxPath, 0o444);
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });
  const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'contextbase://strands/context' } });
  child.stdin.end();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout MCP')), 15000);
    timer.unref();
    child.on('close', () => { clearTimeout(timer); resolve(); });
    child.on('error', reject);
  });
  const read = responses.find(r => r.id === 2);
  assert.ok(read, 'debe llegar respuesta al resources/read');
  assert.equal(read.error && read.error.code, -32602, 'JSON corrupto debe responder -32602, nunca contenido corrupto');
  fs.chmodSync(ctxPath, 0o666);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P1.5 slop no reporta archivos generados por contextbase', async () => {
  const dir = tmp('cb-qa-slop-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents\nSeamless tapestry de delve robusto.\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'const x = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', 'commit', '-q', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents\nUna tapestry robusta de delve y seamless leverage.\n');
  fs.writeFileSync(path.join(dir, 'notas.md'), 'Una tapestry robusta de delve.\n');
  const { scan } = await import('../src/slop.js');
  const res = scan(dir, { base: 'HEAD' });
  assert.equal(res.findings.filter(f => /AGENTS\.md$/i.test(f.file)).length, 0, 'el gate no debe bloquear archivos generados por contextbase');
  assert.ok(res.findings.some(f => f.file === 'notas.md'), 'el gate si debe reportar prosa con hallazgos en archivos normales');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P1.6 web status --json sin runs responde JSON con empty=true y exit 0', () => {
  const dir = seedProject(tmp('cb-qa-webjson-'));
  const res = cli(['web', 'status', '--json'], dir);
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.empty, true);
  assert.equal(res.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.3 dos log en paralelo sobre el mismo proyecto dejan el changelog integro', async () => {
  const dir = seedProject(tmp('cb-qa-2logs-'));
  const marker = 'qa-paralelo-' + Date.now();
  const run = (msg) => new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'log', msg], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('close', code => resolve({ code }));
    child.on('error', () => resolve({ code: -1 }));
  });
  const [a, b] = await Promise.all([run(marker + '-A'), run(marker + '-B')]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const content = fs.readFileSync(path.join(dir, 'contextbase', 'changelog.md'), 'utf8');
  const hits = content.split('\n').filter(l => l.includes(marker));
  assert.equal(hits.length, 2, 'deben registrarse ambas entradas sin perderse ninguna');
  for (const l of hits) assert.match(l, /^- \[\d{4}-\d{2}-\d{2}\] /, 'cada entrada debe ser una linea completa del changelog');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.3 uso incorrecto y errores de ejecucion devuelven exit no cero', () => {
  const dir = seedProject(tmp('cb-qa-exit-'));
  const r1 = cli(['subcomando-inexistente'], dir);
  assert.equal(r1.status, 2, 'subcomando desconocido -> exit 2 (uso)');
  const r2 = cli(['task', 'done'], dir);
  assert.equal(r2.status, 2, 'task done sin texto -> exit 2 (uso)');
  const r3 = cli(['log', ''], dir);
  assert.equal(r3.status, 2, 'log sin mensaje -> exit 2 (uso)');
  const r4 = cli(['restore', 'id-que-no-existe'], dir);
  assert.equal(r4.status, 1, 'restore de id inexistente -> exit 1 (ejecucion)');
  const r5 = cli(['export', 'estado', 'yaml'], dir);
  assert.equal(r5.status, 1, 'export con formato no soportado -> exit 1');
  fs.rmSync(dir, { recursive: true, force: true });
});
