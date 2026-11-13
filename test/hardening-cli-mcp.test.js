import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'contextbase.js');

function tmp(prefix = 'cb-hard-mcp-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function cli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_TEST_CONTEXT: '1' },
  });
}

function mcpRoundtrip(dir, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = [];
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) responses.push(JSON.parse(line));
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    for (const request of requests) child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
    const started = Date.now();
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout MCP')); }, 15000);
    timer.unref();
    child.on('close', (code) => { clearTimeout(timer); resolve({ responses, code, stderr, elapsedMs: Date.now() - started }); });
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// CLI: uso incorrecto -> exit 2 (no ejecuto nada)
// ---------------------------------------------------------------------------

test('export con formato invalido es uso incorrecto (exit 2)', () => {
  const dir = seedProject(tmp());
  const res = cli(['export', 'estado', 'xml'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| export/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web start sin presa es uso incorrecto (exit 2)', () => {
  const dir = seedProject(tmp());
  const res = cli(['web', 'start'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| web start/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web start con --spiders 0 es uso incorrecto (exit 2)', () => {
  const dir = seedProject(tmp());
  const res = cli(['web', 'start', '--prey', 'algo', '--spiders', '0'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| web start/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web start con --spiders abc es uso incorrecto (exit 2)', () => {
  const dir = seedProject(tmp());
  const res = cli(['web', 'start', '--prey', 'algo', '--spiders', 'abc'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| web start/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web arbitrate con --retries abc es uso incorrecto (exit 2, nunca NaN)', () => {
  const dir = seedProject(tmp());
  const res = cli(['web', 'arbitrate', '--retries', 'abc'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| web arbitrate/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web start con --ttl -5 es uso incorrecto (exit 2, nunca todo stale)', () => {
  const dir = seedProject(tmp());
  const res = cli(['web', 'start', '--prey', 'algo', '--ttl', '-5'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| web start/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hook delete no instala el hook y sale 2', () => {
  const dir = seedProject(tmp());
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  const res = cli(['hook', 'delete'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| hook/);
  assert.equal(fs.existsSync(path.join(dir, '.git', 'hooks', 'post-commit')), false, 'hook delete no debe instalar nada');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hook-run con evento desconocido sale 2 en vez de devolver el digest', () => {
  const dir = seedProject(tmp());
  const res = cli(['hook-run', 'whatever'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| hook-run/);
  assert.equal(res.stdout.includes('# ContextBase'), false, 'no debe emitir el digest');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watch bogus sale 2 y no arranca el daemon', () => {
  const dir = seedProject(tmp());
  const res = cli(['watch', 'bogus'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| watch/);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', '.watcher.pid')), false, 'no debe quedar daemon vivo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify --rounds abc sale 2 en vez de ignorarse en silencio', () => {
  const dir = seedProject(tmp());
  const res = cli(['verify', '--rounds', 'abc'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| verify/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tools enable con id inexistente sale 2 y no crea la entrada', () => {
  const dir = seedProject(tmp());
  const res = cli(['tools', 'enable', 'no-existe'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_TOOL_UNKNOWN \| tools enable/);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'tools.json')), false, 'no debe registrar un id inexistente');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CLI: --scope con espacio y task done ambiguo
// ---------------------------------------------------------------------------

test('log acepta --scope con espacio y el mensaje no se contamina', () => {
  const dir = seedProject(tmp());
  const res = cli(['log', 'fix', '--scope', 'main'], dir);
  assert.equal(res.status, 0, res.stderr);
  const changelog = fs.readFileSync(path.join(dir, 'contextbase', 'main', 'changelog.md'), 'utf8');
  assert.match(changelog, /^- \[\d{4}-\d{2}-\d{2}\] fix$/m, 'la entrada debe ser exactamente "fix"');
  assert.equal(/^- .*fix main$/m.test(changelog), false, 'el valor de --scope no debe entrar al mensaje');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task done con coincidencia multiple sale 2 y no completa ninguna', () => {
  const dir = seedProject(tmp());
  const tasklist = path.join(dir, 'contextbase', 'tasklist.md');
  const original = '# Tasklist\n\n## Tareas Completadas\n\n## Tareas Pendientes / En Progreso\n- [ ] login auth\n- [ ] auth token\n';
  fs.writeFileSync(tasklist, original);
  const res = cli(['task', 'done', 'auth'], dir);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /CB_USAGE \| task done/);
  assert.equal(fs.readFileSync(tasklist, 'utf8'), original, 'la tasklist debe quedar intacta');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task done sin coincidencias sale 1 (se ejecuto y no encontro)', () => {
  const dir = seedProject(tmp());
  const res = cli(['task', 'done', 'inexistente-total'], dir);
  assert.equal(res.status, 1, res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// MCP: enums, params y ciclo de vida
// ---------------------------------------------------------------------------

test('MCP: accion invalida en task y formato invalido en export devuelven isError', async () => {
  const dir = seedProject(tmp());
  const res = await mcpRoundtrip(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'contextbase_task', arguments: { action: 'explode' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'contextbase_export', arguments: { format: 'xml' } } },
  ]);
  assert.equal(res.code, 0, res.stderr);
  const task = res.responses.find(r => r.id === 2);
  assert.equal(task.result.isError, true, 'task action=explode debe ser isError');
  assert.match(task.result.content[0].text, /CB_MCP_ACTION/);
  const exp = res.responses.find(r => r.id === 3);
  assert.equal(exp.result.isError, true, 'export format=xml debe ser isError');
  assert.match(exp.result.content[0].text, /CB_MCP_ACTION/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP: params.arguments no-objeto y tool inexistente responden -32602', async () => {
  const dir = seedProject(tmp());
  const res = await mcpRoundtrip(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'contextbase_context', arguments: 'no-es-objeto' } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'contextbase_no_existe', arguments: {} } },
  ]);
  assert.equal(res.code, 0, res.stderr);
  const badArgs = res.responses.find(r => r.id === 2);
  assert.equal(badArgs.error && badArgs.error.code, -32602, 'arguments string debe responder -32602');
  assert.match(badArgs.error.message, /CB_MCP_PARAMS/);
  const unknown = res.responses.find(r => r.id === 3);
  assert.equal(unknown.error && unknown.error.code, -32602, 'tool inexistente debe responder -32602');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP: cerrar stdin sale con 0 en menos de 1 s y sin dejar proceso vivo', async () => {
  const dir = seedProject(tmp());
  const res = await mcpRoundtrip(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  ]);
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.elapsedMs < 1000, `el cierre debe ser rapido (tardo ${res.elapsedMs} ms)`);
  assert.equal(res.responses.length, 1, 'la respuesta en vuelo no debe truncarse');
  fs.rmSync(dir, { recursive: true, force: true });
});
