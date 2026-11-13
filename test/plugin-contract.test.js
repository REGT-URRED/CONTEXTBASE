import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOpenCodePluginSource, validateOpenCodePluginSource } from '../src/autoconfig.js';

function tmp(prefix = 'cb-plugin-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const DEFAULT_MARKER = 'export default {';

/**
 * Reemplaza el bloque `export default {...}` del source generado.
 * Se corta en el marcador para no depender del contenido exacto del objeto.
 */
function withDefault(source, replacement) {
  const at = source.indexOf(DEFAULT_MARKER);
  assert.ok(at > 0, 'el source generado debe tener un default export objeto');
  return source.slice(0, at) + replacement + '\n';
}

// Contrato que funciona en OpenCode v2: id + server + setup, sin effect.
const GOOD_BLOCK = [
  'export default {',
  '  id: "contextbase-auto",',
  '  server: ContextBaseAutoPlugin,',
  '  setup: setupContextBaseAuto',
  '};'
].join('\n');

// Regresion: con effect, OpenCode v2 lo prefiere sobre setup y la activacion cuelga.
const BLOCK_WITH_EFFECT = [
  'export default {',
  '  id: "contextbase-auto",',
  '  server: ContextBaseAutoPlugin,',
  '  effect: async (ctx = {}) => ContextBaseAutoPlugin(ctx),',
  '  setup: setupContextBaseAuto',
  '};'
].join('\n');

const BLOCK_WITHOUT_SETUP = [
  'export default {',
  '  id: "contextbase-auto",',
  '  server: ContextBaseAutoPlugin,',
  '  effect: async (ctx = {}) => ContextBaseAutoPlugin(ctx)',
  '};'
].join('\n');

const BLOCK_WITHOUT_ID = [
  'export default {',
  '  server: ContextBaseAutoPlugin,',
  '  setup: setupContextBaseAuto',
  '};'
].join('\n');

test('plugin: el source generado cumple el contrato de OpenCode v2', () => {
  const source = buildOpenCodePluginSource();
  const result = validateOpenCodePluginSource(source);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true, 'el generador no debe emitir un plugin invalido');
  assert.ok(source.includes('export const ContextBaseAutoPlugin'), 'debe conservar la factory V1');
  assert.ok(source.includes('function setupContextBaseAuto'), 'debe conservar el setup V2');
  assert.doesNotMatch(source, /^\s*effect\s*:/m, 'no debe declarar effect: cuelga la activacion en OpenCode v2');
});

test('plugin: el source generado se importa y expone id, setup y server', async () => {
  const dir = tmp('cb-plugin-import-');
  const file = path.join(dir, 'plugin.mjs');
  fs.writeFileSync(file, buildOpenCodePluginSource(), 'utf8');
  const mod = await import(pathToFileURL(file).href + '?v=' + Date.now());
  const def = mod.default;

  assert.equal(typeof def, 'object');
  assert.equal(typeof def.id, 'string');
  assert.equal(def.id, 'contextbase-auto');
  assert.equal(typeof def.setup, 'function');
  assert.equal(typeof def.server, 'function');
  assert.equal(def.effect, undefined, 'no debe exponer effect');
  assert.equal(typeof mod.ContextBaseAutoPlugin, 'function');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin: el validador rechaza un default export que es una funcion suelta', () => {
  const broken = withDefault(buildOpenCodePluginSource(), 'export default ContextBaseAutoPlugin;');
  const result = validateOpenCodePluginSource(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.ok(result.problems.some((p) => /not an object/i.test(p)), 'debe avisar que no es un objeto: ' + result.problems);
});

test('plugin: el validador rechaza un effect (regresion de activacion colgada)', () => {
  const broken = withDefault(buildOpenCodePluginSource(), BLOCK_WITH_EFFECT);
  const result = validateOpenCodePluginSource(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes('effect is not allowed'), 'debe rechazar effect: ' + result.problems);
});

test('plugin: el validador rechaza un default export sin setup', () => {
  const broken = withDefault(buildOpenCodePluginSource(), BLOCK_WITHOUT_SETUP);
  const result = validateOpenCodePluginSource(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes('missing setup'), 'debe mencionar la clave faltante: ' + result.problems);
});

test('plugin: el validador rechaza un default export sin id y un modulo sin default export objeto', () => {
  const resSinId = validateOpenCodePluginSource(withDefault(buildOpenCodePluginSource(), BLOCK_WITHOUT_ID));
  assert.equal(resSinId.ok, false);
  assert.ok(resSinId.problems.includes('missing id'), 'debe mencionar la clave faltante: ' + resSinId.problems);

  const resSinDefault = validateOpenCodePluginSource('export const ContextBaseAutoPlugin = async () => ({});\n');
  assert.equal(resSinDefault.ok, false);
  assert.deepEqual(resSinDefault.problems, ['no default export object']);
});

test('plugin: el bloque id + server + setup sin effect es valido', () => {
  const good = withDefault(buildOpenCodePluginSource(), GOOD_BLOCK);
  const result = validateOpenCodePluginSource(good);
  assert.equal(result.ok, true, 'el contrato sin effect debe pasar: ' + result.problems);
});

test('plugin: una segunda instancia en el mismo proceso no registra hooks', async () => {
  const dir = tmp('cb-plugin-dup-');
  const src = buildOpenCodePluginSource();
  const a = path.join(dir, 'a.mjs');
  const b = path.join(dir, 'b.mjs');
  fs.writeFileSync(a, src, 'utf8');
  fs.writeFileSync(b, src, 'utf8');

  // El host carga el global y el del proyecto como modulos distintos en el mismo proceso.
  const modA = await import(pathToFileURL(a).href + '?v=' + Date.now());
  const modB = await import(pathToFileURL(b).href + '?v=' + Date.now());

  const hooksA = await modA.ContextBaseAutoPlugin({ directory: dir });
  const hooksB = await modB.ContextBaseAutoPlugin({ directory: dir });

  assert.equal(typeof hooksA, 'object', 'la primera instancia debe devolver hooks');
  assert.ok(Object.keys(hooksA).length > 0, 'la primera instancia registra al menos un hook');
  assert.deepEqual(hooksB, {}, 'la segunda instancia no debe registrar hooks (evita duplicados)');

  fs.rmSync(dir, { recursive: true, force: true });
});
