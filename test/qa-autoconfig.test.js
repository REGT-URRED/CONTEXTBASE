import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { autoConfigureGlobal, autoConfigureProject } from '../src/autoconfig.js';

function tmp(prefix = 'cb-ac2-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// P0.2 - Configuracion de usuario: no perder ni pisar configs existentes
// ---------------------------------------------------------------------------

test('P0.2 global Kilo: si existe kilo.jsonc se mergea ahi y NO se crea kilo.json que lo eclipse', () => {
  const home = tmp('cb-home-kilo-');
  const kiloDir = path.join(home, '.config', 'kilo');
  fs.mkdirSync(kiloDir, { recursive: true });
  const jsonc = path.join(kiloDir, 'kilo.jsonc');
  fs.writeFileSync(jsonc, '{\n  // configuracion del usuario\n  "$schema": "https://app.kilo.ai/config.json",\n  "mcp": { "otro": { "type": "local" } }\n}\n', 'utf8');

  autoConfigureGlobal({ homeDir: home, forceGlobal: true });

  assert.equal(fs.existsSync(path.join(kiloDir, 'kilo.json')), false, 'kilo.json no debe crearse y eclipsar kilo.jsonc');
  const after = fs.readFileSync(jsonc, 'utf8');
  assert.ok(after.includes('// configuracion del usuario'), 'los comentarios del usuario deben sobrevivir');
  assert.ok(after.includes('"otro"'), 'las claves ajenas del usuario deben sobrevivir');
  assert.ok(after.includes('contextbase'), 'el MCP de contextbase debe registrarse en kilo.jsonc');
});

test('P0.2 global Kilo: sin kilo.jsonc previo se crea kilo.json con MCP y permisos', () => {
  const home = tmp('cb-home-kilo2-');
  autoConfigureGlobal({ homeDir: home, forceGlobal: true });
  const kiloJson = path.join(home, '.config', 'kilo', 'kilo.json');
  assert.equal(fs.existsSync(kiloJson), true, 'debe crearse kilo.json cuando no hay kilo.jsonc');
  const cfg = JSON.parse(fs.readFileSync(kiloJson, 'utf8'));
  assert.equal(cfg.mcp.contextbase.enabled, true);
  assert.equal(cfg.permission['contextbase_*'], 'allow');
});

test('P0.2 global OpenCode: si existe opencode.jsonc se mergea ahi (permisos + MCP)', () => {
  const home = tmp('cb-home-oc-');
  const ocDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocDir, { recursive: true });
  const jsonc = path.join(ocDir, 'opencode.jsonc');
  fs.writeFileSync(jsonc, '{\n  // ajustes del usuario\n  "model": "gpt-5",\n  "mcp": { "otro": { "type": "local" } }\n}\n', 'utf8');

  autoConfigureGlobal({ homeDir: home, forceGlobal: true });

  assert.equal(fs.existsSync(path.join(ocDir, 'opencode.json')), false, 'no debe crearse opencode.json que eclipse opencode.jsonc');
  const after = fs.readFileSync(jsonc, 'utf8');
  assert.ok(after.includes('// ajustes del usuario'), 'los comentarios deben sobrevivir');
  assert.ok(after.includes('"model"'), 'las claves ajenas deben sobrevivir');
  assert.ok(after.includes('contextbase'), 'el MCP de contextbase debe registrarse');
  assert.ok(after.includes('contextbase_*'), 'los permisos contextbase_* deben registrarse');
});

test('P0.2 un config corrupto no se pisa: deja backup .bak-contextbase y reporta el fallo', () => {
  const home = tmp('cb-home-corrupt-');
  const ocDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocDir, { recursive: true });
  const jsonc = path.join(ocDir, 'opencode.jsonc');
  const roto = '{ esto no es json valido ';
  fs.writeFileSync(jsonc, roto, 'utf8');

  const res = autoConfigureGlobal({ homeDir: home, forceGlobal: true });

  assert.equal(fs.readFileSync(jsonc, 'utf8'), roto, 'el config corrupto no debe pisarse');
  assert.equal(fs.existsSync(jsonc + '.bak-contextbase'), true, 'debe existir el backup .bak-contextbase');
  assert.equal(fs.readFileSync(jsonc + '.bak-contextbase', 'utf8'), roto, 'el backup debe contener el contenido original');
  assert.ok(Array.isArray(res.failures) && res.failures.length > 0, 'debe reportar la lista de fallos');
  assert.ok(res.failures.some((f) => /json|parse|corrupt/i.test(String(f.message || f.error || ''))), 'el fallo debe ser visible');
});

test('P0.2 proyecto: un opencode.json corrupto no se pisa y el fallo es visible', () => {
  const dir = tmp('cb-proj-corrupt-');
  const roto = '{ roto ';
  fs.writeFileSync(path.join(dir, 'opencode.json'), roto, 'utf8');

  const res = autoConfigureProject(dir);

  assert.equal(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'), roto, 'el config corrupto del proyecto no debe pisarse');
  assert.ok(Array.isArray(res.failures) && res.failures.length > 0, 'debe reportar la lista de fallos');
});

test('P0.2 el CLI auto con opencode.json corrupto falla con codigo != 0 y deja backup', () => {
  const dir = tmp('cb-cli-corrupt-');
  fs.mkdirSync(path.join(dir, 'contextbase'), { recursive: true });
  for (const f of ['fundamentos.md', 'changelog.md', 'tasklist.md']) {
    fs.writeFileSync(path.join(dir, 'contextbase', f), '# x\n', 'utf8');
  }
  const roto = '{ roto ';
  fs.writeFileSync(path.join(dir, 'opencode.json'), roto, 'utf8');

  let status = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'bin', 'contextbase.js'), 'auto'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr || '');
  }
  assert.notEqual(status, 0, 'un fallo de configuracion no debe reportarse como exito');
  assert.ok(/ContextBase Error/i.test(stderr), 'el error debe ser visible en stderr: ' + stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'), roto, 'el config corrupto no debe pisarse');
});
