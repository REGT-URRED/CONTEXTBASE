import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../src/doctor.js';
import { collectState, buildDigest } from '../src/context.js';
import { runMaintenance } from '../src/maintenance.js';
import { isRelevantPath } from '../src/watcher.js';
import { buildOpenCodePluginSource } from '../src/autoconfig.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(path.resolve(__dirname, '..'), 'bin', 'contextbase.js');

/**
 * Contrato de las 26 tools del servidor MCP. Lista independiente a proposito: si el
 * server renombra o pierde una tool, este test debe notarlo sin leer src/mcp.js.
 */
const EXPECTED_TOOLS = [
  'contextbase_status',
  'contextbase_context',
  'contextbase_log',
  'contextbase_task',
  'contextbase_audit',
  'contextbase_sync',
  'contextbase_bootstrap',
  'contextbase_guard',
  'contextbase_snapshot',
  'contextbase_restore',
  'contextbase_tools',
  'contextbase_review',
  'contextbase_redundancy',
  'contextbase_slop',
  'contextbase_export',
  'contextbase_strands_prepare',
  'contextbase_init',
  'contextbase_hook',
  'contextbase_mission',
  'contextbase_egm_review',
  'contextbase_swarm_start',
  'contextbase_swarm_status',
  'contextbase_swarm_send',
  'contextbase_swarm_collect',
  'contextbase_swarm_stop',
  'contextbase_terminals',
];

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function findCheck(result, id) {
  const found = (result.checks || []).find((item) => item.id === id);
  assert.ok(found, `el doctor debe reportar el check "${id}" (ids: ${(result.checks || []).map((c) => c.id).join(', ')})`);
  return found;
}

/**
 * Servidor MCP de prueba: responde initialize y tools/list por stdio. `tools` es la
 * lista de nombres; el fixture los publica como objetos { name, inputSchema } porque
 * el protocolo no admite strings sueltos. `strayLine` simula un console.log que
 * contamina stdout (el bug real de contextbase_hook).
 */
function writeMcpFixture({ tools, strayLine = null }) {
  const dir = tmp('cb-hard-fixture-');
  const file = path.join(dir, 'server.mjs');
  const stray = strayLine ? `process.stdout.write(${JSON.stringify(strayLine)} + '\\n');\n` : '';
  const source = `import readline from 'node:readline';
const TOOLS = ${JSON.stringify(tools)}.map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } }));
${stray}const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg && msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '0.0.0' } } }) + '\\n');
  } else if (msg && msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\\n');
  }
});
rl.on('close', () => process.exit(0));
// Red de seguridad: si stdin nunca cierra, el fixture no debe colgar el test.
setTimeout(() => process.exit(0), 15000).unref();
`;
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function writeOpenCodeConfig(home, config) {
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opencode.jsonc');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return file;
}

function writeValidPlugin(home) {
  const dir = path.join(home, '.config', 'opencode', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'contextbase-auto.js'), buildOpenCodePluginSource(BIN, process.execPath), 'utf8');
}

/** Home temporal completo: config v2 + plugin valido, para aislar el check bajo prueba. */
function homeWith({ agents, binPath }) {
  const home = tmp('cb-hard-home-');
  writeOpenCodeConfig(home, {
    $schema: 'https://opencode.ai/config.json',
    permissions: [],
    agents,
    model: 'test/model',
    mcp: {
      servers: {
        contextbase: { type: 'local', command: [process.execPath, binPath, 'mcp'], enabled: true },
      },
    },
  });
  writeValidPlugin(home);
  return home;
}

// ---------------------------------------------------------------------------
// 1. Contrato de agentes: claves v1 silenciosamente descartadas por el host v2
// ---------------------------------------------------------------------------

test('doctor: agentes con claves v1 en un config v2 fallan con el mapeo exacto', async () => {
  const fixture = writeMcpFixture({ tools: EXPECTED_TOOLS });
  const project = tmp('cb-hard-proj-');
  const home = homeWith({
    binPath: fixture,
    agents: {
      build: { model: 'test/model', prompt: 'eres build', permission: { edit: 'ask' } },
      explore: { model: 'test/model', variant: 'medium' },
      sano: { model: 'test/model', system: 'ok', permissions: [] },
    },
  });

  const result = await runDoctor(project, { homeDir: home, binPath: fixture, timeoutMs: 8000 });

  const check = findCheck(result, 'global-opencode-agents');
  assert.equal(check.ok, false, 'un agente con claves v1 no puede pasar como v2 limpio');
  assert.equal(check.severity, 'error', 'la perdida silenciosa de system prompt es error, no advertencia');
  assert.ok(check.detail.includes('CB_DOCTOR_AGENT_SCHEMA'), `el detalle debe llevar el codigo: ${check.detail}`);
  assert.ok(check.detail.includes('2 de 3 agentes'), `el detalle debe contar los agentes afectados: ${check.detail}`);
  for (const key of ['prompt', 'permission', 'variant']) {
    assert.ok(check.detail.includes(key), `el detalle debe nombrar la clave ${key}: ${check.detail}`);
  }
  assert.ok(check.detail.includes('prompt -> system'), `mapeo prompt -> system: ${check.detail}`);
  assert.ok(check.detail.includes('permission -> permissions'), `mapeo permission -> permissions: ${check.detail}`);
  assert.ok(check.detail.includes('variant -> model.variant'), `mapeo variant -> model.variant: ${check.detail}`);
  assert.equal(result.ok, false, 'el doctor no puede declarar sano un config que el host recorta');
});

test('doctor: un config v2 con agentes en claves v2 pasa el chequeo y el doctor entero', async () => {
  const fixture = writeMcpFixture({ tools: EXPECTED_TOOLS });
  const project = tmp('cb-hard-proj-');
  const home = homeWith({
    binPath: fixture,
    agents: {
      build: { model: 'test/model', system: 'eres build', permissions: [], mode: 'primary', steps: 20 },
      explore: { model: 'test/model', description: 'explora', hidden: true, color: '#fff', disabled: false },
    },
  });

  const result = await runDoctor(project, { homeDir: home, binPath: fixture, timeoutMs: 8000 });

  const check = findCheck(result, 'global-opencode-agents');
  assert.equal(check.ok, true, `un contrato v2 correcto no debe fallar: ${check.detail}`);
  assert.equal(check.severity, 'info');
  assert.ok(check.detail.includes('2 agente(s)'), `el detalle debe informar cuantos agentes valido: ${check.detail}`);
  assert.equal(result.ok, true, `una instalacion sana no debe fallar: ${JSON.stringify(result.summary)}`);
});

// ---------------------------------------------------------------------------
// 2. Handshake estricto: stdout contaminado y tools faltantes por nombre
// ---------------------------------------------------------------------------

test('doctor: una linea no-JSON en stdout falla el handshake con "stdout contaminado"', async () => {
  const fixture = writeMcpFixture({ tools: EXPECTED_TOOLS, strayLine: 'contextbase_hook: depurando' });
  const project = tmp('cb-hard-proj-');
  const home = homeWith({ binPath: fixture, agents: { build: { model: 'test/model' } } });

  const result = await runDoctor(project, { homeDir: home, binPath: fixture, timeoutMs: 8000 });

  const handshake = findCheck(result, 'mcp-handshake');
  assert.equal(handshake.ok, false, 'un stdout sucio invalida el handshake');
  assert.equal(handshake.severity, 'error');
  assert.ok(handshake.detail.includes('stdout contaminado'), `el detalle debe decir stdout contaminado: ${handshake.detail}`);
  assert.ok(handshake.detail.includes('CB_DOCTOR_STDOUT'), `el detalle debe llevar el codigo: ${handshake.detail}`);
  assert.ok(handshake.detail.includes('contextbase_hook: depurando'), `el detalle debe citar la linea ofensora: ${handshake.detail}`);
});

test('doctor: un servidor con 25 tools nombra la tool ausente en el detalle', async () => {
  const tools = EXPECTED_TOOLS.filter((name) => name !== 'contextbase_hook');
  const fixture = writeMcpFixture({ tools });
  const project = tmp('cb-hard-proj-');
  const home = homeWith({ binPath: fixture, agents: { build: { model: 'test/model' } } });

  const result = await runDoctor(project, { homeDir: home, binPath: fixture, timeoutMs: 8000 });

  const handshake = findCheck(result, 'mcp-handshake');
  assert.equal(handshake.ok, false, 'faltar una tool debe fallar el handshake');
  assert.ok(handshake.detail.includes('25 tools'), `el detalle debe informar el conteo: ${handshake.detail}`);
  assert.ok(
    handshake.detail.includes('contextbase_hook'),
    `el detalle debe listar la tool ausente por nombre: ${handshake.detail}`
  );
});

// ---------------------------------------------------------------------------
// 3. Digest: un archivo de reglas ilegible no tumba el estado
// ---------------------------------------------------------------------------

test('collectState y buildDigest sobreviven a un archivo de reglas ilegible', () => {
  const dir = tmp('cb-hard-ctx-');
  fs.mkdirSync(path.join(dir, 'contextbase'));
  fs.writeFileSync(path.join(dir, 'contextbase', 'tasklist.md'), '# T\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- CONTEXTBASE:v1.5.0 -->\n');
  // Un directorio donde se espera un archivo reproduce EISDIR (el caso real: antivirus
  // retiene el handle y readFileSync tira EPERM/EBUSY).
  fs.mkdirSync(path.join(dir, 'AGENTS.md'));

  const state = collectState(dir);

  assert.deepEqual(state.rules.present.sort(), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(state.rules.unreadable.length, 1, 'el archivo ilegible debe reportarse');
  assert.equal(state.rules.unreadable[0].file, 'AGENTS.md');
  assert.ok(state.rules.unreadable[0].code, 'el reporte debe incluir el codigo del error');

  const digest = buildDigest(state, '9.9.9');
  assert.ok(digest.includes('# ContextBase ::'), 'el digest debe generarse igual');
  assert.ok(digest.includes('CB_CONTEXT_READ'), `la salud debe citar el codigo del error: ${digest}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4. Presupuesto de red del mantenimiento
// ---------------------------------------------------------------------------

test('runMaintenance con NODE_TEST_CONTEXT no ejecuta red y termina en menos de 2 s', () => {
  const dir = tmp('cb-hard-maint-');
  const previous = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'hardening-observability';
  const startedAt = Date.now();
  try {
    const result = runMaintenance(dir);
    const elapsed = Date.now() - startedAt;

    assert.ok(result.network, 'runMaintenance debe informar el presupuesto de red');
    assert.equal(result.network.enabled, false, 'en contexto de test la red debe estar cerrada');
    assert.equal(result.network.reason, 'NODE_TEST_CONTEXT');
    assert.equal(result.network.timeouts, 0);
    assert.ok(elapsed < 2000, `sin red el mantenimiento debe ser inmediato, tardo ${elapsed} ms`);

    const content = fs.readFileSync(result.file, 'utf8');
    assert.ok(content.includes('## Inventario de Componentes'));
    assert.ok(content.includes('## Brechas de Seguridad Detectadas'));
  } finally {
    if (previous === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Watcher: rutas internas case-insensitive
// ---------------------------------------------------------------------------

test('isRelevantPath ignora prefijos internos sin distinguir mayusculas', () => {
  assert.equal(isRelevantPath('ContextBase/CHANGELOG.MD'), false, 'Windows no distingue mayusculas: realimentaria el changelog');
  assert.equal(isRelevantPath('ContextBase\\changelog.md'), false, 'separador Windows con mayusculas');
  assert.equal(isRelevantPath('contextbase/changelog.md'), false);
  assert.equal(isRelevantPath('NODE_MODULES/foo/index.js'), false);
  assert.equal(isRelevantPath('.GIT/config'), false);
  assert.equal(isRelevantPath('.Worktrees/swarm-1/task.md'), false);
  assert.equal(isRelevantPath('src/App.JS'), true, 'el codigo del proyecto sigue siendo relevante');
  assert.equal(isRelevantPath('Docs/Guia.MD'), true);
});
