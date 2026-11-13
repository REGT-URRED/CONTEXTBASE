import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseJsonc, setJsoncPath } from './jsonc.js';
import { readJsonc } from './redundancy.js';
import { validateOpenCodePluginSource, autoConfigureGlobal } from './autoconfig.js';
import { installSkill } from './installer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Minimo de tools que un servidor MCP de ContextBase sano debe exponer. */
const MIN_MCP_TOOLS = 26;

/** Tiempo maximo del handshake MCP completo (initialize + tools/list + salida limpia). */
const DEFAULT_TIMEOUT_MS = 12000;

/** Skills que el bucle EGM necesita; el tool funciona sin ellas, por eso faltantes = warn. */
const REQUIRED_SKILLS = ['contextbase', 'contextbase-egm'];

/**
 * Hogares de agente que se revisan para las skills globales.
 * Solo se auditan los que existen: un agente no instalado no es un fallo.
 */
const AGENT_HOMES = [
  '.agents',
  '.config/opencode',
  '.kilo',
  '.config/kilo',
  '.gemini/config',
  '.claude',
];

/** Claves de la raiz que delatan un config del esquema legacy (v1). */
const LEGACY_ROOT_KEYS = ['plugin', 'permission'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

/** Primer archivo existente de la lista, o null. Orden = precedencia del host. */
function findFirst(files) {
  for (const file of files) if (exists(file)) return file;
  return null;
}

function buildCheck(id, title, severity, ok, detail, fixable = false) {
  const item = { id, title, severity, ok, detail };
  if (fixable) item.fixable = true;
  return item;
}

/**
 * Lee un config JSON/JSONC con el parser del repo.
 * Devuelve { value, error }: `error` es null cuando parseo bien.
 */
function readConfig(file) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    return { value: null, error: err.message };
  }
  try {
    return { value: parseJsonc(raw).value, error: null };
  } catch (errParse) {
    // Fallback tolerante (comas finales) con el lector ya usado por autoconfig.
    const fallback = readJsonc(file);
    if (isPlainObject(fallback)) return { value: fallback, error: null };
    return { value: null, error: errParse.message };
  }
}

/**
 * Detecta la forma del esquema: v2 usa `permissions` (array) y `agents` (objeto).
 * Cualquier otra cosa se trata como legacy para no inventar fallos.
 */
function detectSchema(cfg) {
  if (!isPlainObject(cfg)) return 'unknown';
  if (Array.isArray(cfg.permissions) || isPlainObject(cfg.agents)) return 'v2';
  return 'legacy';
}

/** Entrada MCP de ContextBase, aceptando v2 (`mcp.servers.x`) y legacy (`mcp.x`). */
function mcpEntry(cfg) {
  if (!isPlainObject(cfg)) return null;
  const mcp = isPlainObject(cfg.mcp) ? cfg.mcp : null;
  if (!mcp) return null;
  if (isPlainObject(mcp.servers) && isPlainObject(mcp.servers.contextbase)) return mcp.servers.contextbase;
  if (isPlainObject(mcp.contextbase)) return mcp.contextbase;
  return null;
}

/** Normaliza `command` (array o string) a un array de strings, o null. */
function commandArray(entry) {
  if (!isPlainObject(entry)) return null;
  const cmd = entry.command;
  if (Array.isArray(cmd) && cmd.length > 0) return cmd.map((part) => String(part));
  if (typeof cmd === 'string' && cmd.trim()) return [cmd.trim()];
  return null;
}

/** Archivos .js/.mjs/.cjs declarados dentro de un command. */
function scriptEntries(command) {
  return command.filter((part) => /\.(cjs|mjs|js)$/i.test(part));
}

function globalBinPath() {
  return path.resolve(__dirname, '..', 'bin', 'contextbase.js');
}

function nodeBinPath() {
  return String(process.execPath).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Check 1-3: config y plugin global de OpenCode
// ---------------------------------------------------------------------------

/**
 * Resuelve el estado del OpenCode global una sola vez para que los checks 1-3
 * y el reporte de sombra (check 7) lean exactamente el mismo archivo.
 */
function inspectOpenCodeGlobal(homeDir) {
  const dir = path.join(homeDir, '.config', 'opencode');
  const file = findFirst([path.join(dir, 'opencode.jsonc'), path.join(dir, 'opencode.json')]);
  const info = { dir, dirExists: exists(dir), file, cfg: null, parseError: null, schema: 'unknown', entry: null, command: null };
  if (!file) return info;
  const read = readConfig(file);
  info.parseError = read.error;
  info.cfg = read.value;
  if (isPlainObject(info.cfg)) {
    info.schema = detectSchema(info.cfg);
    info.entry = mcpEntry(info.cfg);
    info.command = commandArray(info.entry);
  }
  return info;
}

function checkGlobalOpenCodeConfig(info) {
  const id = 'global-opencode-config';
  const title = 'Config global de OpenCode';

  if (!info.file) {
    const where = info.dirExists ? `${info.dir} no tiene opencode.jsonc ni opencode.json` : `no existe ${info.dir}`;
    return buildCheck(id, title, 'warn', false, `OpenCode no esta configurado globalmente: ${where}.`, true);
  }
  if (info.parseError) {
    return buildCheck(id, title, 'error', false, `${info.file} no se puede parsear: ${info.parseError}`);
  }
  if (!isPlainObject(info.cfg)) {
    return buildCheck(id, title, 'error', false, `${info.file} no contiene un objeto de configuracion.`);
  }
  if (!info.entry) {
    return buildCheck(
      id, title, 'error', false,
      `Falta la entrada MCP de ContextBase en ${info.file} (se esperaba mcp.servers.contextbase en v2 o mcp.contextbase en legacy).`,
      true
    );
  }
  if (!info.command) {
    return buildCheck(id, title, 'error', false, `La entrada MCP en ${info.file} no declara command como array.`, true);
  }

  const scripts = scriptEntries(info.command);
  if (scripts.length === 0) {
    return buildCheck(id, title, 'error', false, `El command de ${info.file} no apunta a un archivo .js: ${info.command.join(' ')}`, true);
  }
  const dead = scripts.filter((script) => !exists(script));
  if (dead.length > 0) {
    return buildCheck(id, title, 'error', false, `El command apunta a rutas inexistentes: ${dead.join(', ')}`, true);
  }

  return buildCheck(id, title, 'info', true, `MCP registrado en ${info.file} -> ${scripts.join(', ')}`);
}

function checkGlobalOpenCodePlugin(info) {
  const id = 'global-opencode-plugin';
  const title = 'Plugin global de OpenCode';
  const candidates = [
    path.join(info.dir, 'plugins', 'contextbase-auto.js'),
    path.join(info.dir, 'plugin', 'contextbase-auto.js'),
  ];
  const file = findFirst(candidates);
  if (!file) {
    // Sin OpenCode instalado no hay fallo: el host no esta, no falta el plugin.
    if (!info.dirExists && !info.file) {
      return buildCheck(id, title, 'warn', false, `OpenCode no instalado: no existe ${info.dir} y no hay plugin que revisar.`, true);
    }
    return buildCheck(id, title, 'error', false, `Falta el plugin: no existe ${candidates[0]} (ni ${candidates[1]}).`, true);
  }

  let source = '';
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return buildCheck(id, title, 'error', false, `No se puede leer ${file}: ${err.message}`, true);
  }

  const verdict = validateOpenCodePluginSource(source);
  if (!verdict.ok) {
    return buildCheck(
      id, title, 'error', false,
      `${file} no cumple el contrato { id, server, setup }: ${verdict.problems.join(', ')}`,
      true
    );
  }
  return buildCheck(id, title, 'info', true, `${file} cumple el contrato { id, server, setup } (sin effect).`);
}

function checkGlobalOpenCodeSchema(info) {
  const id = 'global-opencode-schema';
  const title = 'Esquema del config global de OpenCode';

  if (!info.file || !isPlainObject(info.cfg)) {
    return buildCheck(id, title, 'info', true, 'Sin config global legible: no hay esquema que validar.');
  }
  if (info.schema !== 'v2') {
    return buildCheck(id, title, 'info', true, `${info.file} usa el esquema legacy (v1): no aplica la validacion v2.`);
  }

  const offenders = LEGACY_ROOT_KEYS.filter((key) => key in info.cfg);
  const mcp = isPlainObject(info.cfg.mcp) ? info.cfg.mcp : {};
  for (const key of Object.keys(mcp)) {
    if (key !== 'servers') offenders.push(`mcp.${key}`);
  }

  if (offenders.length > 0) {
    return buildCheck(
      id, title, 'error', false,
      `El config v2 de ${info.file} contiene claves legacy (${offenders.join(', ')}): OpenCode rechaza el documento y lo recupera como .recovered-*, perdiendo agentes y MCP.`
    );
  }
  return buildCheck(id, title, 'info', true, `${info.file} es v2 limpio (permissions array + agents, sin claves legacy).`);
}

// ---------------------------------------------------------------------------
// Check 4: Kilo Code global
// ---------------------------------------------------------------------------

function inspectKiloGlobal(homeDir) {
  const dirs = [path.join(homeDir, '.config', 'kilo'), path.join(homeDir, '.kilo')].filter((dir) => exists(dir));
  return dirs.map((dir) => {
    const file = findFirst([path.join(dir, 'kilo.json'), path.join(dir, 'kilo.jsonc')]);
    const plugin = findFirst([path.join(dir, 'plugins', 'contextbase-auto.js'), path.join(dir, 'plugin', 'contextbase-auto.js')]);
    const info = { dir, file, plugin, cfg: null, parseError: null, entry: null, command: null };
    if (file) {
      const read = readConfig(file);
      info.parseError = read.error;
      info.cfg = read.value;
      if (isPlainObject(info.cfg)) {
        info.entry = mcpEntry(info.cfg);
        info.command = commandArray(info.entry);
      }
    }
    return info;
  });
}

function checkGlobalKilo(homeDir) {
  const id = 'global-kilo';
  const title = 'Configuracion global de Kilo Code';
  const dirs = inspectKiloGlobal(homeDir);
  if (dirs.length === 0) {
    return buildCheck(id, title, 'info', true, 'Kilo no instalado: no hay ~/.config/kilo ni ~/.kilo.');
  }

  const errors = [];
  const warnings = [];

  for (const info of dirs) {
    if (!info.file) {
      warnings.push(`${info.dir} existe pero no tiene kilo.json ni kilo.jsonc`);
    } else if (info.parseError) {
      errors.push(`${info.file} no se puede parsear: ${info.parseError}`);
    } else if (!info.entry) {
      errors.push(`${info.file} no registra el MCP contextbase`);
    } else if (!info.command) {
      errors.push(`${info.file} declara la entrada MCP sin command utilizable`);
    } else {
      const scripts = scriptEntries(info.command);
      if (scripts.length === 0) errors.push(`${info.file}: el command no apunta a un archivo .js`);
      const dead = scripts.filter((script) => !exists(script));
      if (dead.length > 0) errors.push(`${info.file} apunta a rutas inexistentes: ${dead.join(', ')}`);
    }

    if (!info.plugin) {
      warnings.push(`${info.dir} no tiene plugins/contextbase-auto.js`);
    } else {
      let source = '';
      try { source = fs.readFileSync(info.plugin, 'utf8'); } catch { source = ''; }
      const verdict = validateOpenCodePluginSource(source);
      if (!verdict.ok) errors.push(`${info.plugin} no cumple el contrato: ${verdict.problems.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    return buildCheck(id, title, 'error', false, [...errors, ...warnings].join('; '), true);
  }
  if (warnings.length > 0) {
    return buildCheck(id, title, 'warn', false, warnings.join('; '), true);
  }
  return buildCheck(id, title, 'info', true, `Kilo global correcto en ${dirs.map((info) => info.dir).join(', ')}.`);
}

// ---------------------------------------------------------------------------
// Check 5: skills globales
// ---------------------------------------------------------------------------

function checkGlobalSkills(homeDir) {
  const id = 'global-skills';
  const title = 'Skills globales';
  const homes = AGENT_HOMES
    .map((rel) => path.join(homeDir, ...rel.split('/')))
    .filter((dir) => exists(dir));

  if (homes.length === 0) {
    return buildCheck(id, title, 'info', true, 'Ningun hogar de agente detectado: no hay skills que auditar.');
  }

  const missing = [];
  for (const home of homes) {
    for (const skill of REQUIRED_SKILLS) {
      const file = path.join(home, 'skills', skill, 'SKILL.md');
      if (!exists(file)) missing.push(file);
    }
  }

  if (missing.length > 0) {
    return buildCheck(id, title, 'warn', false, `Faltan ${missing.length} skill(s): ${missing.join(', ')}`, true);
  }
  return buildCheck(id, title, 'info', true, `${homes.length} hogar(es) con ${REQUIRED_SKILLS.join(' y ')} instaladas.`);
}

// ---------------------------------------------------------------------------
// Check 6: handshake MCP real (async)
// ---------------------------------------------------------------------------

/**
 * Handshake real por stdio: initialize -> tools/list -> cierre de stdin.
 * Prueba que el MCP vive hoy, no que este escrito en un config.
 */
function runMcpHandshake({ binPath, cwd, timeoutMs }) {
  const id = 'mcp-handshake';
  const title = 'Handshake del servidor MCP';

  return new Promise((resolve) => {
    if (!binPath || !exists(binPath)) {
      resolve(buildCheck(id, title, 'error', false, `No existe el binario: ${binPath}`));
      return;
    }

    let child = null;
    let settled = false;
    let timer = null;
    let buffer = '';
    let stderr = '';
    let toolCount = 0;
    let initialized = false;

    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (child && !child.killed) child.kill(); } catch { /* el proceso ya termino */ }
      resolve(buildCheck(id, title, ok ? 'info' : 'error', ok, detail));
    };

    timer = setTimeout(() => {
      finish(false, `El servidor MCP no completo el handshake en ${timeoutMs} ms (posible cuelgue).`);
    }, timeoutMs);

    try {
      child = spawn(process.execPath, [binPath, 'mcp'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      finish(false, `No se pudo lanzar el MCP: ${err.message}`);
      return;
    }

    child.on('error', (err) => finish(false, `No se pudo lanzar el MCP: ${err.message}`));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += String(chunk);
    });

    child.on('exit', (code, signal) => {
      const tail = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 500)}` : '';
      if (!initialized) {
        finish(false, `El MCP termino antes de responder initialize (code=${code}${signal ? `, signal=${signal}` : ''}).${tail}`);
        return;
      }
      if (toolCount < MIN_MCP_TOOLS) {
        finish(false, `El MCP expone ${toolCount} tools; se esperaban al menos ${MIN_MCP_TOOLS}.${tail}`);
        return;
      }
      if (code !== 0) {
        finish(false, `El MCP respondio ${toolCount} tools pero salio con codigo ${code} al cerrar stdin.${tail}`);
        return;
      }
      finish(true, `initialize + tools/list OK: ${toolCount} tools y salida limpia (code 0).`);
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && message.result) {
          initialized = true;
          try {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
          } catch (err) {
            finish(false, `El stdin del MCP se cerro antes de tools/list: ${err.message}`);
            return;
          }
        } else if (message.id === 2 && message.result) {
          toolCount = Array.isArray(message.result.tools) ? message.result.tools.length : 0;
          try { child.stdin.end(); } catch { /* se cierra solo al salir */ }
        }
      }
    });

    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'contextbase-doctor', version: '0.0.0' },
      },
    };
    try {
      child.stdin.write(`${JSON.stringify(initialize)}\n`);
    } catch (err) {
      finish(false, `No se pudo enviar initialize al MCP: ${err.message}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 7: sombra del config del proyecto
// ---------------------------------------------------------------------------

function checkProjectShadow(root, globalInfo) {
  const id = 'project-shadow';
  const title = 'Sombra del config del proyecto';
  const file = findFirst([path.join(root, 'opencode.jsonc'), path.join(root, 'opencode.json')]);
  if (!file) {
    return buildCheck(id, title, 'info', true, 'El proyecto no define opencode.json propio: usa la config global.');
  }

  const read = readConfig(file);
  if (read.error) {
    return buildCheck(id, title, 'warn', false, `${file} no se puede parsear: ${read.error}`);
  }
  if (!isPlainObject(read.value)) {
    return buildCheck(id, title, 'warn', false, `${file} no contiene un objeto de configuracion.`);
  }

  const entry = mcpEntry(read.value);
  const command = commandArray(entry);
  if (!command) {
    return buildCheck(id, title, 'info', true, `${file} no registra el MCP contextbase.`);
  }
  if (!globalInfo || !globalInfo.command) {
    return buildCheck(id, title, 'info', true, `${file} registra el MCP contextbase; no hay comando global con el cual comparar.`);
  }

  const local = command.join(' ').toLowerCase();
  const global = globalInfo.command.join(' ').toLowerCase();
  if (local === global) {
    return buildCheck(id, title, 'info', true, `${file} duplica la entrada global identica: sin conflicto.`);
  }
  return buildCheck(
    id, title, 'warn', false,
    `${file} define su propio contextbase [${command.join(' ')}] y eclipsa al global [${globalInfo.command.join(' ')}]: el host usara el del proyecto.`
  );
}

// ---------------------------------------------------------------------------
// Orquestacion
// ---------------------------------------------------------------------------

async function collectChecks(state) {
  const info = inspectOpenCodeGlobal(state.homeDir);
  const checks = [
    checkGlobalOpenCodeConfig(info),
    checkGlobalOpenCodePlugin(info),
    checkGlobalOpenCodeSchema(info),
    checkGlobalKilo(state.homeDir),
    checkGlobalSkills(state.homeDir),
  ];
  // La sombra se mide ANTES del handshake: el propio MCP ejecuta autoEnsure y
  // escribiria/refrescaria la config del proyecto, falseando la lectura.
  checks.push(checkProjectShadow(state.root, info));
  checks.push(await runMcpHandshake({ binPath: state.binPath, cwd: state.root, timeoutMs: state.timeoutMs }));
  return checks;
}

/**
 * Normaliza SOLO la forma del MCP en un config v2: mueve `mcp.contextbase` a
 * `mcp.servers.contextbase`. autoConfigureGlobal escribe la forma legacy cuando
 * el config v2 todavia no tiene `mcp.servers`, y eso deja el documento invalido.
 * @returns {string|null} accion aplicada, o null cuando no hizo falta.
 */
function normalizeV2Mcp(state) {
  const info = inspectOpenCodeGlobal(state.homeDir);
  if (!info.file || !isPlainObject(info.cfg) || info.schema !== 'v2') return null;

  const mcp = isPlainObject(info.cfg.mcp) ? info.cfg.mcp : {};
  const legacyEntry = isPlainObject(mcp.contextbase) ? mcp.contextbase : null;
  const serversEntry = isPlainObject(mcp.servers) ? mcp.servers.contextbase : null;
  if (!legacyEntry && serversEntry) return null;

  const wanted = serversEntry || legacyEntry || {
    type: 'local',
    command: [nodeBinPath(), state.binPath.replace(/\\/g, '/'), 'mcp'],
    enabled: true,
  };
  const next = { ...mcp, servers: { ...(isPlainObject(mcp.servers) ? mcp.servers : {}), contextbase: wanted } };
  delete next.contextbase;

  try {
    const raw = fs.readFileSync(info.file, 'utf8');
    const merged = setJsoncPath(raw, ['mcp'], next);
    if (merged === raw) return null;
    fs.writeFileSync(info.file, merged, 'utf8');
    return `normalizado a v2: mcp.servers.contextbase en ${info.file}`;
  } catch (err) {
    return `fallo al normalizar el MCP v2 en ${info.file}: ${err.message}`;
  }
}

/** Ejecuta las reparaciones disponibles y devuelve la lista de acciones. */
function applyFixes(state) {
  const actions = [];

  try {
    const result = autoConfigureGlobal({
      homeDir: state.homeDir,
      forceGlobal: true,
      binPath: state.binPath,
      nodePath: nodeBinPath(),
    });
    for (const file of result.files || []) actions.push(`configurado: ${file}`);
    for (const failure of result.failures || []) {
      actions.push(`fallo: ${failure && failure.message ? failure.message : String(failure)}`);
    }
  } catch (err) {
    actions.push(`fallo autoConfigureGlobal: ${err.message}`);
  }

  try {
    const installed = installSkill('global', state.root, state.homeDir);
    actions.push(`skills instaladas: ${installed.length} archivo(s)`);
  } catch (err) {
    actions.push(`fallo installSkill: ${err.message}`);
  }

  const normalized = normalizeV2Mcp(state);
  if (normalized) actions.push(normalized);

  return actions;
}

function buildResult(checks, fix, startedAt) {
  const failed = checks.filter((item) => !item.ok && item.severity === 'error').length;
  const warnings = checks.filter((item) => !item.ok && item.severity === 'warn').length;
  const passed = checks.filter((item) => item.ok).length;
  const result = {
    ok: failed === 0,
    checks,
    summary: { total: checks.length, passed, failed, warnings },
    durationMs: Date.now() - startedAt,
  };
  if (fix) result.fix = fix;
  return result;
}

/**
 * Auto-diagnostico de la instalacion global de ContextBase.
 *
 * Responde en una sola corrida: el config global existe, el MCP esta registrado y
 * apunta a un archivo real, el plugin cumple el contrato, el esquema no esta roto,
 * las skills estan puestas y el servidor MCP responde hoy.
 *
 * Es asincronico por el handshake MCP (check `mcp-handshake`); el resto es lectura
 * sincronica de disco. Nunca lanza: cualquier error interno se devuelve como check
 * `doctor-internal`.
 *
 * @param {string} projectDir directorio del proyecto a auditar (sombra y cwd del MCP)
 * @param {{ homeDir?: string, binPath?: string, json?: boolean, fix?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, checks: Array<object>, summary: { total: number, passed: number, failed: number, warnings: number }, fix?: { attempted: boolean, actions: string[] }, durationMs: number }>}
 */
export async function runDoctor(projectDir, options = {}) {
  const startedAt = Date.now();
  const state = {
    root: path.resolve(projectDir || process.cwd()),
    homeDir: path.resolve(options.homeDir || os.homedir()),
    binPath: path.resolve(options.binPath || globalBinPath()),
    timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
  // `options.json` lo consume el CLI para elegir formato de salida; aca no cambia el resultado.
  let fix = null;

  try {
    let checks = await collectChecks(state);

    if (options.fix) {
      const pending = checks.filter((item) => item.fixable && !item.ok);
      if (pending.length > 0) {
        const actions = applyFixes(state);
        fix = { attempted: true, actions };
        checks = await collectChecks(state);
      } else {
        fix = { attempted: false, actions: [] };
      }
    }

    return buildResult(checks, fix, startedAt);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const item = buildCheck('doctor-internal', 'Fallo interno del doctor', 'error', false, message);
    return buildResult([item], fix, startedAt);
  }
}
