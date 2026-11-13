import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureUniversalBridges } from '../src/universal-agents.js';

function tmp(prefix = 'cb-hard-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('P0.2 puentes universales: los archivos del usuario sobreviven y ContextBase se agrega', () => {
  const dir = tmp();
  write(dir, '.clinerules', '# Reglas propias\n\nSiempre responder en espanol.\n');
  write(dir, '.github/copilot-instructions.md', '# Instrucciones de la empresa\n\nUsar el estilo del repo.\n');
  write(dir, '.vscode/mcp.json', JSON.stringify({ servers: { miServidor: { command: 'mi-binario' } }, inputs: [] }, null, 2) + '\n');
  write(dir, '.gemini/settings.json', JSON.stringify({ theme: 'dark' }, null, 2) + '\n');

  const written = configureUniversalBridges(dir, { includeAll: true });

  assert.ok(written.includes('.clinerules'));
  assert.ok(written.includes('.github/copilot-instructions.md'));
  assert.ok(written.includes('.vscode/mcp.json'));
  assert.ok(written.includes('.gemini/settings.json'));

  const clinerules = fs.readFileSync(path.join(dir, '.clinerules'), 'utf8');
  assert.ok(clinerules.includes('Siempre responder en espanol'), 'el texto del usuario debe sobrevivir en .clinerules');
  assert.ok(clinerules.includes('<!-- CONTEXTBASE:START -->'), 'falta el bloque de ContextBase en .clinerules');

  const copilot = fs.readFileSync(path.join(dir, '.github/copilot-instructions.md'), 'utf8');
  assert.ok(copilot.includes('Instrucciones de la empresa'), 'el texto del usuario debe sobrevivir en copilot-instructions.md');
  assert.ok(copilot.includes('<!-- CONTEXTBASE:START -->'), 'falta el bloque de ContextBase en copilot-instructions.md');

  const vscode = JSON.parse(fs.readFileSync(path.join(dir, '.vscode/mcp.json'), 'utf8'));
  assert.ok(vscode.servers.miServidor, 'el servidor MCP del usuario debe sobrevivir en .vscode/mcp.json');
  assert.ok(vscode.servers.contextbase, 'falta el servidor MCP de ContextBase en .vscode/mcp.json');
  assert.deepEqual(vscode.inputs, [], 'las claves del usuario deben sobrevivir');

  const gemini = JSON.parse(fs.readFileSync(path.join(dir, '.gemini/settings.json'), 'utf8'));
  assert.equal(gemini.theme, 'dark', 'el theme del usuario debe sobrevivir en .gemini/settings.json');
  assert.ok(gemini.mcpServers.contextbase, 'falta el servidor MCP de ContextBase en .gemini/settings.json');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.2 un JSON de usuario corrupto no se pisa: backup .bak-contextbase y fallo reportado', () => {
  const dir = tmp();
  const broken = write(dir, '.vscode/mcp.json', '{ roto');

  const failures = [];
  configureUniversalBridges(dir, { includeAll: true, failures });

  assert.equal(fs.readFileSync(broken, 'utf8'), '{ roto', 'el archivo corrupto no debe modificarse');
  const backup = fs.readFileSync(broken + '.bak-contextbase', 'utf8');
  assert.equal(backup, '{ roto', 'el backup debe conservar el contenido original');
  assert.equal(failures.length, 1, 'debe reportarse exactamente un fallo');
  assert.equal(failures[0].code, 'CONFIG_INVALID_JSON');
  assert.equal(failures[0].file, broken);

  // Sin sink de fallos, el llamador recibe la excepcion (ruta autoConfigureProject).
  assert.throws(() => configureUniversalBridges(dir, { includeAll: true }), /CONFIG_INVALID_JSON/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.2 idempotencia: dos ejecuciones no duplican el bloque de ContextBase en .clinerules', () => {
  const dir = tmp();
  const clinerules = write(dir, '.clinerules', 'texto propio del usuario\n');

  configureUniversalBridges(dir, { includeAll: true });
  const first = fs.readFileSync(clinerules, 'utf8');
  configureUniversalBridges(dir, { includeAll: true });
  const second = fs.readFileSync(clinerules, 'utf8');

  assert.equal(second, first, 'la segunda ejecucion no debe cambiar el archivo');
  assert.equal(first.split('<!-- CONTEXTBASE:START -->').length - 1, 1, 'el bloque START debe aparecer una sola vez');
  assert.equal(first.split('<!-- CONTEXTBASE:END -->').length - 1, 1, 'el bloque END debe aparecer una sola vez');
  assert.ok(first.includes('texto propio del usuario'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.2 Aider: conserva los read del usuario, agrega solo los faltantes y es idempotente', () => {
  const dir = tmp();
  const aider = write(dir, '.aider.conf.yml', 'model: gpt-5\nread:\n  - README.md\n  - AGENTS.md\n');

  configureUniversalBridges(dir, { includeAll: true });
  const once = fs.readFileSync(aider, 'utf8');

  assert.ok(once.includes('model: gpt-5'), 'la config del usuario debe sobrevivir');
  assert.ok(once.includes('  - README.md'), 'los read del usuario deben sobrevivir');
  assert.equal(once.split('- AGENTS.md').length - 1, 1, 'AGENTS.md no debe duplicarse');
  assert.equal(once.split('- contextbase/fundamentos.md').length - 1, 1, 'el read faltante debe agregarse una vez');
  assert.equal(once.split('auto-commits: true').length - 1, 1, 'auto-commits debe agregarse una vez');

  configureUniversalBridges(dir, { includeAll: true });
  assert.equal(fs.readFileSync(aider, 'utf8'), once, 'la segunda ejecucion no debe cambiar el archivo');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('P0.2 Aider: con read inline agrega los faltantes dentro de los corchetes', () => {
  const dir = tmp();
  const aider = write(dir, '.aider.conf.yml', 'read: [README.md]\n');

  configureUniversalBridges(dir, { includeAll: true });
  const once = fs.readFileSync(aider, 'utf8');

  assert.ok(once.includes('read: [README.md, AGENTS.md'), 'los items deben agregarse dentro de los corchetes');
  assert.equal(once.split('read: [').length - 1, 1, 'no debe duplicarse la clave read');
  assert.equal(once.split('- AGENTS.md').length - 1, 0, 'no deben agregarse items en formato bloque');
  assert.equal(once.split('contextbase/fundamentos.md').length - 1, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
