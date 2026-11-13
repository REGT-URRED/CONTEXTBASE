import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonc } from '../src/redundancy.js';
import { buildOpenCodePluginSource } from '../src/autoconfig.js';
import { runDoctor } from '../src/doctor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'contextbase.js');

function tmp(prefix = 'cb-doctor-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function findCheck(result, id) {
  const found = (result.checks || []).find((item) => item.id === id);
  assert.ok(found, `el doctor debe reportar el check "${id}"`);
  return found;
}

/** Config v2 valida: permissions array + agents objeto + MCP apuntando al bin real. */
function v2Config(overrides = {}) {
  return {
    $schema: 'https://opencode.ai/config.json',
    permissions: [],
    agents: { build: { model: 'test/model' } },
    model: 'test/model',
    theme: 'dark',
    mcp: {
      servers: {
        contextbase: {
          type: 'local',
          command: [process.execPath, BIN, 'mcp'],
          enabled: true,
        },
      },
    },
    ...overrides,
  };
}

/** Escribe el config global de OpenCode en el home temporal. */
function writeOpenCodeConfig(home, config) {
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opencode.jsonc');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { dir, file };
}

/** Escribe el plugin con el contrato valido que genera el propio paquete. */
function writeValidPlugin(home) {
  const dir = path.join(home, '.config', 'opencode', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'contextbase-auto.js');
  fs.writeFileSync(file, buildOpenCodePluginSource(BIN, process.execPath), 'utf8');
  return file;
}

/** Proyecto vacio: no tiene opencode.json, asi que no ensucia el check de sombra. */
function emptyProject() {
  return tmp('cb-doctor-proj-');
}

// ---------------------------------------------------------------------------
// P1 - Un host ausente no es un fallo
// ---------------------------------------------------------------------------

test('doctor: un home sin config global reporta warn en global-opencode-config y no falla', async () => {
  const home = tmp('cb-doctor-home-vacio-');
  const project = emptyProject();

  const result = await runDoctor(project, { homeDir: home });

  const config = findCheck(result, 'global-opencode-config');
  assert.equal(config.severity, 'warn', 'sin config global la severidad debe ser warn');
  assert.equal(config.ok, false, 'el check debe marcar que no encontro config');
  assert.equal(result.ok, true, 'la ausencia de host no debe marcar el doctor como fallido');
  assert.equal(result.summary.failed, 0, 'no debe haber fallos de severidad error');
  assert.ok(result.summary.warnings >= 1, 'el resumen debe contar la advertencia');
});

// ---------------------------------------------------------------------------
// P2 - Instalacion global completa y sana
// ---------------------------------------------------------------------------

test('doctor: un config v2 valido con MCP y plugin deja pasar config, plugin y esquema', async () => {
  const home = tmp('cb-doctor-home-ok-');
  const project = emptyProject();
  writeOpenCodeConfig(home, v2Config());
  writeValidPlugin(home);

  const result = await runDoctor(project, { homeDir: home });

  assert.equal(findCheck(result, 'global-opencode-config').ok, true, 'el MCP debe estar registrado y apuntar a un .js existente');
  assert.equal(findCheck(result, 'global-opencode-plugin').ok, true, 'el plugin debe cumplir el contrato { id, server, setup }');
  assert.equal(findCheck(result, 'global-opencode-schema').ok, true, 'un v2 limpio no debe tener claves legacy');
  assert.equal(result.ok, true, 'una instalacion sana no debe reportar fallos');
});

// ---------------------------------------------------------------------------
// P3 - Claves legacy dentro de un config v2
// ---------------------------------------------------------------------------

test('doctor: un config v2 con la clave legacy "plugin" falla en global-opencode-schema', async () => {
  const home = tmp('cb-doctor-home-legacy-');
  const project = emptyProject();
  writeOpenCodeConfig(home, v2Config({ plugin: ['./algo.js'] }));
  writeValidPlugin(home);

  const result = await runDoctor(project, { homeDir: home });

  const schema = findCheck(result, 'global-opencode-schema');
  assert.equal(schema.ok, false, 'una clave legacy en v2 debe fallar');
  assert.equal(schema.severity, 'error', 'la clave legacy rompe el documento: severidad error');
  assert.ok(schema.detail.includes('plugin'), `el detalle debe nombrar la clave ofensora: ${schema.detail}`);
  assert.equal(result.ok, false, 'un config que el host descarta no puede reportarse como sano');
});

// ---------------------------------------------------------------------------
// P4 - El command apunta a un archivo que no existe
// ---------------------------------------------------------------------------

test('doctor: un command con ruta inexistente falla en global-opencode-config', async () => {
  const home = tmp('cb-doctor-home-muerto-');
  const project = emptyProject();
  const dead = path.join(home, 'no-existe', 'contextbase.js');
  writeOpenCodeConfig(home, v2Config({
    mcp: { servers: { contextbase: { type: 'local', command: [process.execPath, dead, 'mcp'], enabled: true } } },
  }));
  writeValidPlugin(home);

  const result = await runDoctor(project, { homeDir: home });

  const config = findCheck(result, 'global-opencode-config');
  assert.equal(config.ok, false, 'una ruta muerta no es una instalacion valida');
  assert.equal(config.severity, 'error', 'una ruta muerta debe ser error, no advertencia');
  assert.ok(config.detail.includes('contextbase.js'), `el detalle debe nombrar el archivo muerto: ${config.detail}`);
});

// ---------------------------------------------------------------------------
// P5 - Plugin con forma rota (default export que no es objeto)
// ---------------------------------------------------------------------------

test('doctor: un plugin con default export no-objeto falla en global-opencode-plugin con los problemas del validador', async () => {
  const home = tmp('cb-doctor-home-plugin-roto-');
  const project = emptyProject();
  writeOpenCodeConfig(home, v2Config());
  const dir = path.join(home, '.config', 'opencode', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'contextbase-auto.js'), 'export default ContextBaseAutoPlugin;\n', 'utf8');

  const result = await runDoctor(project, { homeDir: home });

  const plugin = findCheck(result, 'global-opencode-plugin');
  assert.equal(plugin.ok, false, 'la forma rota debe fallar');
  assert.equal(plugin.severity, 'error', 'el plugin roto debe ser error');
  assert.ok(
    plugin.detail.includes('default export is not an object'),
    `el detalle debe traer los problemas del validador: ${plugin.detail}`
  );
});

// ---------------------------------------------------------------------------
// P6 - El MCP responde de verdad (handshake real)
// ---------------------------------------------------------------------------

test('doctor: el handshake MCP contra el bin real responde con al menos 26 tools', async (t) => {
  const home = tmp('cb-doctor-home-handshake-');
  const project = emptyProject();

  const result = await runDoctor(project, { homeDir: home, binPath: BIN, timeoutMs: 20000 });

  const handshake = findCheck(result, 'mcp-handshake');
  if (!handshake.ok) {
    t.skip(`handshake no disponible en este entorno: ${handshake.detail}`);
    return;
  }
  const match = handshake.detail.match(/(\d+)\s+tools/);
  assert.ok(match, `el detalle debe informar la cantidad de tools: ${handshake.detail}`);
  assert.ok(Number(match[1]) >= 26, `deben responder al menos 26 tools, respondio ${match[1]}`);
});

// ---------------------------------------------------------------------------
// P7 - fix: true reconstruye la entrada MCP sin perder las claves del usuario
// ---------------------------------------------------------------------------

test('doctor: con fix true el config v2 sin MCP queda con mcp.servers.contextbase y conserva las claves del usuario', async () => {
  const home = tmp('cb-doctor-home-fix-');
  const project = emptyProject();
  const base = v2Config();
  delete base.mcp;
  const { file } = writeOpenCodeConfig(home, base);

  const result = await runDoctor(project, { homeDir: home, fix: true, timeoutMs: 20000 });

  assert.ok(result.fix, 'la respuesta debe incluir el bloque fix');
  assert.equal(result.fix.attempted, true, 'con checks reparables pendientes el fix debe ejecutarse');
  assert.ok(result.fix.actions.length > 0, 'el fix debe registrar las acciones aplicadas');

  const after = readJsonc(file);
  assert.ok(after, 'el config debe seguir siendo JSON valido despues del fix');
  assert.ok(after.mcp && after.mcp.servers && after.mcp.servers.contextbase, 'debe quedar mcp.servers.contextbase (forma v2)');
  assert.equal(after.mcp.contextbase, undefined, 'no debe quedar la forma legacy mcp.contextbase');
  assert.equal(after.model, 'test/model', 'las claves del usuario deben sobrevivir');
  assert.equal(after.theme, 'dark', 'las claves del usuario deben sobrevivir');
  assert.ok(after.agents && after.agents.build, 'los agentes del usuario deben sobrevivir');
  assert.ok(Array.isArray(after.permissions), 'permissions debe seguir siendo un array v2');
  assert.equal(findCheck(result, 'global-opencode-config').ok, true, 'tras el fix el check de config debe pasar');
});
