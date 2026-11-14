import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './fsutil.js';
import { CONTEXTBASE_RULE_BLOCK } from './rules.js';
import { readJsonc } from './redundancy.js';
import { setJsoncPath } from './jsonc.js';
import { configureUniversalBridges } from './universal-agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_SUFFIX = '.bak-contextbase';
/** Cuantos respaldos con marca temporal se conservan por archivo (el legado no cuenta). */
const BACKUP_RETENTION = 5;

let traceCounter = 0;

function nextTraceId() {
  traceCounter += 1;
  return `cfg-${Date.now().toString(36)}-${traceCounter.toString(36)}`;
}

/**
 * Emite un error de configuracion visible por stderr con el formato del proyecto.
 * @param {string} code  codigo estable del fallo
 * @param {string} op    operacion que fallo
 * @param {string} msg   detalle legible
 */
export function reportConfigError(code, op, msg, extra = {}) {
  const traceId = extra.trace_id || nextTraceId();
  const parts = [`[ContextBase Error] code=${code}`, `op=${op}`, `trace_id=${traceId}`];
  if (extra.file) parts.push(`file=${extra.file}`);
  console.error(`${parts.join(' ')} msg=${String(msg).replace(/\s+/g, ' ').trim()}`);
  return { code, op, message: String(msg), trace_id: traceId, file: extra.file || null };
}

/**
 * Emite un error de hardening con el formato compacto del proyecto:
 * `[ContextBase Error] <CODE> | <op> | <path> | <detalle accionable>`
 * No lanza ni aborta: el llamador decide como continuar.
 */
function reportAutoconfigError(code, op, filePath, detail) {
  const target = filePath ? String(filePath) : '-';
  const msg = String(detail == null ? '' : detail).replace(/\s+/g, ' ').trim() || 'sin detalle';
  console.error(`[ContextBase Error] ${code} | ${op} | ${target} | ${msg}`);
  return { code, op, message: msg, trace_id: nextTraceId(), file: filePath || null };
}

/** Marca temporal ordenable YYYYMMDD-HHmmss para nombres de respaldo. */
function backupTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Siguiente nombre de respaldo libre: `<archivo>.bak-contextbase-YYYYMMDD-HHmmss`
 * y, si ya se uso ese nombre dentro del mismo segundo, `.N` con N incremental.
 *
 * El indice se calcula sobre lo que hay en disco, asi que tras una rotacion NUNCA
 * se reutiliza un indice menor: los nombres siguen siendo cronologicamente ordenables.
 */
function nextBackupName(file) {
  const base = `${file}${BACKUP_SUFFIX}-${backupTimestamp()}`;
  const baseName = path.basename(base);
  const prefix = `${baseName}.`;
  let maxIndex = -1;
  try {
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (name === baseName) {
        if (maxIndex < 0) maxIndex = 0;
        continue;
      }
      if (!name.startsWith(prefix)) continue;
      const n = Number.parseInt(name.slice(prefix.length), 10);
      if (Number.isInteger(n) && n > maxIndex) maxIndex = n;
    }
  } catch {
    // Sin lectura del directorio: se usa el nombre base y COPYFILE_EXCL evita pisar.
  }
  return maxIndex < 0 ? base : `${base}.${maxIndex + 1}`;
}

/** Orden cronologico de respaldos: marca temporal y, dentro del mismo segundo, indice numerico. */
function compareBackups(a, b) {
  const parse = (name) => {
    const m = /-(\d{8}-\d{6})(?:\.(\d+))?$/.exec(name);
    return m ? { stamp: m[1], index: m[2] ? Number(m[2]) : 0 } : { stamp: name, index: 0 };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.stamp !== pb.stamp) return pa.stamp < pb.stamp ? -1 : 1;
  return pa.index - pb.index;
}

/**
 * Conserva solo los ultimos BACKUP_RETENTION respaldos con marca temporal de `file`.
 * Solo toca nombres que empiezan con el prefijo de ese archivo, asi que el respaldo
 * legado `.bak-contextbase` y los respaldos de otros archivos quedan intactos.
 */
function rotateBackups(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}${BACKUP_SUFFIX}-`;
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
  } catch (err) {
    reportAutoconfigError('CB_BACKUP_ROTATE', 'backupConfig.rotate', dir,
      `No se pudo listar respaldos (${err.code || err.message}); revisa permisos del directorio.`);
    return 0;
  }
  if (names.length <= BACKUP_RETENTION) return 0;
  // Orden cronologico real: marca temporal y, dentro del mismo segundo, indice numerico.
  names.sort(compareBackups);
  const stale = names.slice(0, names.length - BACKUP_RETENTION);
  let removed = 0;
  for (const name of stale) {
    const target = path.join(dir, name);
    try {
      fs.unlinkSync(target);
      removed += 1;
    } catch (err) {
      reportAutoconfigError('CB_BACKUP_ROTATE', 'backupConfig.rotate', target,
        `No se pudo borrar el respaldo viejo (${err.code || err.message}); borralo a mano si necesitas espacio.`);
    }
  }
  return removed;
}

/**
 * Copia de seguridad del archivo antes de escribir sobre el.
 *
 * El respaldo usa nombre unico y ordenable (`<archivo>.bak-contextbase-YYYYMMDD-HHmmss`),
 * asi que una segunda migracion NUNCA pisa el respaldo de la configuracion original.
 * Se conservan los ultimos BACKUP_RETENTION respaldos de ese archivo.
 *
 * Compatibilidad: si todavia no existe el respaldo legado `.bak-contextbase` se crea
 * una sola vez (copia del estado actual); si ya existe no se borra ni se sobrescribe.
 *
 * @returns {string|null|object} ruta del respaldo nuevo, null si el archivo no existe,
 *                               o el error reportado si la copia fallo.
 */
export function backupConfig(file) {
  if (!fs.existsSync(file)) return null;
  let backup = null;
  for (let attempt = 0; attempt < 5 && !backup; attempt += 1) {
    const candidate = nextBackupName(file);
    try {
      // COPYFILE_EXCL: nunca sobrescribir un respaldo existente (falla con EEXIST en vez de pisar).
      fs.copyFileSync(file, candidate, fs.constants.COPYFILE_EXCL);
      backup = candidate;
    } catch (err) {
      if (err && err.code === 'EEXIST') continue; // carrera con otro proceso: se recalcula el nombre
      return reportConfigError('CONFIG_BACKUP_FAILED', 'backupConfig', err.message, { file });
    }
  }
  if (!backup) {
    return reportConfigError('CONFIG_BACKUP_FAILED', 'backupConfig',
      'no se pudo reservar un nombre de respaldo unico; revisa respaldos concurrentes en el directorio', { file });
  }
  const legacy = file + BACKUP_SUFFIX;
  try {
    if (!fs.existsSync(legacy)) fs.copyFileSync(file, legacy, fs.constants.COPYFILE_EXCL);
  } catch {
    // El respaldo con marca temporal ya existe; el legado es solo compatibilidad.
  }
  rotateBackups(file);
  return backup;
}

export function getBinPath() {
  return path.resolve(__dirname, '..', 'bin', 'contextbase.js').replace(/\\/g, '/');
}

export function getNodePath() {
  return process.execPath.replace(/\\/g, '/');
}

/**
 * Lee un archivo JSON/JSONC de configuracion.
 * Devuelve `null` si el archivo existe pero NO parsea (config corrupto).
 * Devuelve `undefined` si el archivo no existe.
 */
function readJsonSafe(file) {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = readJsonc(file);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

/**
 * OpenCode v2 autoscanea los directorios `plugin/` y `plugins/` y exige directorios
 * en la entrada `plugin`: registrar la ruta de un archivo solo dispara el aviso
 * "configured plugin path must be a directory" y no aporta nada.
 */
function isContextbasePluginFile(entry) {
  return typeof entry === 'string' && /contextbase-auto\.js$/i.test(entry);
}

/**
 * OpenCode v2 rechaza con "configured plugin path must be a directory" cualquier
 * entrada de plugin que sea un ARCHIVO (.js/.ts/.mjs/...). El plugin de ContextBase
 * se autodescubre desde el directorio plugins/, asi que las rutas de archivo se
 * eliminan; las entradas de paquete o directorio se conservan.
 */
function isPluginFilePath(entry) {
  if (typeof entry !== 'string') return false;
  const limpio = entry.split('?')[0].trim();
  return /\.(js|mjs|cjs|ts|mts|cts)$/i.test(limpio);
}

function stripPluginFilePaths(arr) {
  return (Array.isArray(arr) ? arr : []).filter((p) => !isPluginFilePath(p));
}

function stripContextbasePluginFiles(arr) {
  return stripPluginFilePaths(arr);
}

function removeFileIfExists(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function ensureArrayItem(arr, item) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (!list.includes(item)) list.push(item);
  return list;
}

/** Compara dos valores de config normalizando el orden de claves (para detectar no-ops). */
function configEq(a, b) {
  const norm = v => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]));
    }
    if (Array.isArray(v)) return v.map(norm);
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * Verifica si algún archivo de configuración de agentes tiene rutas rotas o desactualizadas
 * (por ejemplo, tras mover el proyecto o descomprimirlo en otra máquina).
 */
export function hasStaleAgentConfig(projectDir, options = {}) {
  const root = path.resolve(projectDir || process.cwd());
  const opencodeFile = pickOpenCodeConfigPath(root).file;
  const kiloFile = pickKiloConfigPath(root).file;
  // Un solo plugin por host: el global cubre todas las sesiones, asi que la copia
  // local solo es necesaria cuando no hay global valido.
  const localPluginFile = path.join(root, '.opencode', 'plugins', 'contextbase-auto.js');
  const globalPluginFile = path.join(
    options.homeDir || os.homedir(),
    '.config',
    'opencode',
    'plugins',
    'contextbase-auto.js'
  );
  const pluginFile = fs.existsSync(localPluginFile) ? localPluginFile : globalPluginFile;
  if (!fs.existsSync(opencodeFile) || !fs.existsSync(kiloFile) || !fs.existsSync(pluginFile)) {
    return true;
  }
  try {
    const oc = readJsonSafe(opencodeFile);
    const cmd = oc && oc.mcp && oc.mcp.contextbase && oc.mcp.contextbase.command;
    if (!Array.isArray(cmd) || cmd.length < 2) return true;
    const nodeBin = cmd[0];
    const cbBin = cmd[1];
    if (!fs.existsSync(nodeBin) || !fs.existsSync(cbBin)) return true;
    const pluginSrc = fs.readFileSync(pluginFile, 'utf8');
    if (!pluginSrc.includes('resolveCbCommand') || !pluginSrc.includes(getBinPath())) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Verifica estaticamente el source generado del plugin antes de escribirlo a disco.
 *
 * OpenCode v2 espera un default export objeto con `id` y `setup` (API Promise).
 * Incluir `effect` cuelga la activacion del plugin: el runtime lo prefiere sobre
 * `setup` y espera hooks de ctx que nunca resuelven. Esta validacion existe para
 * que un generador roto nunca llegue al disco.
 *
 * Reglas:
 * - sin `export default` -> "no default export object"
 * - el default export no es un objeto literal `{...}` -> "default export is not an object"
 * - al objeto le falta la clave `id` o `setup` -> "missing <clave>"
 * - el objeto declara `effect` -> "effect is not allowed"
 *
 * @param {string} source codigo JS generado
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateOpenCodePluginSource(source) {
  const problems = [];
  const text = String(source == null ? '' : source);

  // Ultimo `export default` real (ignora menciones dentro de comentarios o strings de linea).
  const re = /^[ \t]*export\s+default\b/gm;
  let at = -1;
  let match;
  while ((match = re.exec(text)) !== null) at = match.index + match[0].length;
  if (at < 0) return { ok: false, problems: ['no default export object'] };

  if (!text.slice(at).trimStart().startsWith('{')) {
    return { ok: false, problems: ['default export is not an object'] };
  }

  // Extrae el objeto balanceado, saltando llaves dentro de strings.
  const start = text.indexOf('{', at);
  let depth = 0;
  let quote = '';
  let end = text.length;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const block = text.slice(start, end);

  for (const key of ['id', 'setup']) {
    if (!new RegExp(`[{,\\s]${key}\\s*:`).test(block)) problems.push(`missing ${key}`);
  }
  if (/[{,\s]effect\s*:/.test(block)) problems.push('effect is not allowed');

  return { ok: problems.length === 0, problems };
}

/**
 * Valida el source del plugin y, si no cumple el contrato, lo reporta y lanza.
 * Nunca deja que un plugin roto se escriba a disco.
 */
function ensureValidPluginSource(source, op, file) {
  const { ok, problems } = validateOpenCodePluginSource(source);
  if (ok) return source;
  const msg = `Plugin OpenCode invalido (${problems.join(', ')}); no se escribio.`;
  reportConfigError('CONFIG_PLUGIN_INVALID', op, msg, { file });
  throw new Error(msg);
}

/**
 * Genera el codigo del plugin automatico para OpenCode y Kilo Code.
 * Compatible con la firma de funcion V1 y objeto de plugin V2, con auto-resolución
 * de binario, aislamiento de hilo de Araña y pulso automático de Telaraña.
 *
 * El source se autovalida antes de devolverse. No incluye `effect` a proposito:
 * OpenCode v2 lo prefiere sobre `setup` y la activacion del plugin queda colgada.
 */
export function buildOpenCodePluginSource(binPath = getBinPath(), nodePath = getNodePath()) {
  const safeBin = JSON.stringify(binPath);
  const safeNode = JSON.stringify(nodePath);
  const source = [
    '// Generado por ContextBase - Plugin de automatizacion de ciclo de vida y Telarana para OpenCode y Kilo Code',
    "import { execFile, execFileSync, spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    '',
    `const DEFAULT_NODE_BIN = ${safeNode};`,
    `const DEFAULT_CB_BIN = ${safeBin};`,
    '',
    '// El host puede cargar el plugin DOS veces (global y proyecto) en el mismo proceso.',
    '// Solo la primera instancia registra hooks: la segunda devuelve un plugin vacio para',
    '// no duplicar tareas, hooks de ciclo de vida ni inyecciones del digest.',
    'const CONTEXTBASE_PLUGIN_KEY = "__contextbaseAutoPluginActive";',
    'function claimPluginSlot() {',
    '  try {',
    '    if (globalThis[CONTEXTBASE_PLUGIN_KEY]) return false;',
    '    globalThis[CONTEXTBASE_PLUGIN_KEY] = true;',
    '    return true;',
    '  } catch {',
    '    return true;',
    '  }',
    '}',
    '',
    'function resolveWorkdir(ctx) {',
    '  return (ctx && (ctx.directory || ctx.worktree)) || process.cwd();',
    '}',
    '',
    'function resolveCbCommand(cwd) {',
    '  const nodeBin = fs.existsSync(DEFAULT_NODE_BIN) ? DEFAULT_NODE_BIN : (process.execPath || "node");',
    '  const candidates = [',
    '    DEFAULT_CB_BIN,',
    '    path.join(cwd, "bin", "contextbase.js"),',
    '    path.join(cwd, "..", "..", "bin", "contextbase.js"),',
    '    path.join(cwd, "node_modules", "contextbase", "bin", "contextbase.js")',
    '  ];',
    '  for (const cand of candidates) {',
    '    if (cand && fs.existsSync(cand)) return { bin: nodeBin, prefix: [cand] };',
    '  }',
    '  // Sin binario de ContextBase no inventamos un comando: en Windows fallaba con ENOENT/EINVAL y abortaba el host.',
    '  return null;',
    '}',
    '',
    'function readSpiderContext(cwd) {',
    '  try {',
    '    const p = path.join(cwd, "contextbase", ".spider-context.json");',
    '    if (!fs.existsSync(p)) return null;',
    '    return JSON.parse(fs.readFileSync(p, "utf8"));',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
    '',
    'function runSyncHook(event, cwd, extra = []) {',
    '  try {',
    '    const resolved = resolveCbCommand(cwd);',
    '    if (!resolved) return "";',
    '    return execFileSync(resolved.bin, [...resolved.prefix, "hook-run", event, ...extra], {',
    '      cwd,',
    '      encoding: "utf8",',
    '      timeout: 8000,',
    '      windowsHide: true,',
    '      stdio: ["ignore", "pipe", "ignore"]',
    '    }).trim();',
    '  } catch {',
    '    return "";',
    '  }',
    '}',
    '',
    'function runAsyncHook(event, cwd, extra = []) {',
    '  try {',
    '    const resolved = resolveCbCommand(cwd);',
    '    if (!resolved) return;',
    '    const child = spawn(resolved.bin, [...resolved.prefix, "hook-run", event, ...extra], {',
    '      cwd,',
    '      detached: true,',
    '      windowsHide: true,',
    '      stdio: "ignore"',
    '    });',
    '    child.on("error", () => {});',
    '    child.unref();',
    '  } catch {}',
    '}',
    '',
    'const MUTATING_TOOLS = new Set([',
    '  "edit", "write", "patch", "apply_patch", "multi_edit", "multiedit",',
    '  "create_file", "write_to_file", "replace_in_file", "bash", "todowrite"',
    ']);',
    '',
    'export const ContextBaseAutoPlugin = async (ctx = {}) => {',
    '  if (!claimPluginSlot()) return {};',
    '  const workDir = resolveWorkdir(ctx);',
    '  const touchedFiles = new Set();',
    '  const spiderMeta = readSpiderContext(workDir);',
    '  let digestCache = "";',
    '  let lastDigestAt = 0;',
    '',
    '  function getDigest() {',
    '    const now = Date.now();',
    '    if (!digestCache || (now - lastDigestAt) > 12000) {',
    '      const out = runSyncHook("session-start", workDir);',
    '      if (out) {',
    '        digestCache = out;',
    '        lastDigestAt = now;',
    '      }',
    '    }',
    '    return digestCache;',
    '  }',
    '',
    '  getDigest();',
    '',
    '  return {',
    '    "experimental.chat.system.transform": async (_input, output) => {',
    '      try {',
    '        const digest = getDigest();',
    '        if (!digest || !output) return;',
    '        const marker = "<!-- CONTEXTBASE:LIVE_DIGEST -->";',
    '        const block = `${marker}\\n${digest}\\n<!-- /CONTEXTBASE:LIVE_DIGEST -->`;',
    '        const END = "<!-- /CONTEXTBASE:LIVE_DIGEST -->";',
    '        if (Array.isArray(output.system)) {',
    '          const idx = output.system.findIndex(s => typeof s === "string" && s.includes(marker));',
    '          if (idx >= 0) {',
    '            const current = output.system[idx];',
    '            const end = current.indexOf(END);',
    '            const head = end >= 0 ? current.slice(0, current.indexOf(marker)) : current;',
    '            const tail = end >= 0 ? current.slice(end + END.length) : "";',
    '            output.system[idx] = head + block + tail;',
    '          } else {',
    '            output.system.push(block);',
    '          }',
    '        } else if (typeof output.system === "string") {',
    '          const end = output.system.indexOf(END);',
    '          if (output.system.includes(marker) && end >= 0) {',
    '            const head = output.system.slice(0, output.system.indexOf(marker));',
    '            const tail = output.system.slice(end + END.length);',
    '            output.system = head + block + tail;',
    '          } else if (!output.system.includes(marker)) {',
    '            output.system = `${output.system}\\n\\n${block}`;',
    '          }',
    '        } else {',
    '          output.system = block;',
    '        }',
    '      } catch {}',
    '    },',
    '    "chat.message": async () => {',
    '      try { getDigest(); } catch {}',
    '    },',
    '    "tool.execute.before": async (input) => {',
    '      try {',
    '        if (!spiderMeta || !Array.isArray(spiderMeta.forbiddenFiles)) return;',
    '        const toolName = String((input && input.tool) || "").toLowerCase();',
    '        if (!MUTATING_TOOLS.has(toolName) || toolName === "bash" || toolName === "todowrite") return;',
    '        const args = (input && input.args) || {};',
    '        const rawTarget = args.filePath || args.path || args.file || "";',
    '        if (!rawTarget) return;',
    '        const relTarget = path.isAbsolute(rawTarget) ? path.relative(workDir, rawTarget) : String(rawTarget);',
    '        const normTarget = path.resolve(workDir, relTarget).toLowerCase();',
    '        const forbidden = spiderMeta.forbiddenFiles.map(f => path.resolve(workDir, String(f)).toLowerCase());',
    '        if (forbidden.includes(normTarget)) {',
    '          throw new Error(`[ContextBase Telaraña] Aislamiento de hilo activo: el archivo "${relTarget}" pertenece a otra Araña. Modifica solo tus archivos asignados: ${(spiderMeta.assignedFiles || []).join(", ")}`);',
    '        }',
    '      } catch (err) {',
    '        if (err && String(err.message || "").includes("[ContextBase Telaraña]")) throw err;',
    '      }',
    '    },',
    '    "tool.execute.after": async (input, output) => {',
    '      try {',
    '        const toolName = String((input && input.tool) || "").toLowerCase();',
    '        if (!MUTATING_TOOLS.has(toolName) && !toolName.startsWith("contextbase_")) return;',
    '        const args = (input && input.args) || (output && output.args) || {};',
    '        const target = args.filePath || args.path || args.file || (output && output.metadata && output.metadata.filePath) || "";',
    '        if (target) touchedFiles.add(String(target));',
    '        else if (toolName !== "bash") touchedFiles.add(toolName);',
    '        if (toolName === "todowrite" && Array.isArray(args.todos)) {',
    '          for (const t of args.todos) {',
    '            const content = t && (t.content || t.text || t.description);',
    '            const status = t && t.status;',
    '            if (content && status === "completed") runAsyncHook("task-done", workDir, [String(content)]);',
    '            else if (content && (status === "pending" || status === "in_progress")) runAsyncHook("task-add", workDir, [String(content)]);',
    '          }',
    '        }',
    '        lastDigestAt = 0;',
    '      } catch {}',
    '    },',
    '    event: async ({ event }) => {',
    '      try {',
    '        const type = event && event.type;',
    '        if (type === "session.created") {',
    '          getDigest();',
    '        } else if (type === "file.edited" || type === "file.watcher.updated") {',
    '          const p = (event.data && event.data.path) || (event.properties && event.properties.file);',
    '          if (p) touchedFiles.add(String(p));',
    '        } else if (type === "session.idle") {',
    '          if (touchedFiles.size > 0) {',
    '            const list = Array.from(touchedFiles).slice(0, 15);',
    '            touchedFiles.clear();',
    '            runAsyncHook("session-stop", workDir, list);',
    '            lastDigestAt = 0;',
    '          }',
    '        }',
    '      } catch {}',
    '    },',
    '    stop: async () => {',
    '      try {',
    '        if (touchedFiles.size > 0) {',
    '          const list = Array.from(touchedFiles).slice(0, 15);',
    '          touchedFiles.clear();',
    '          runSyncHook("session-stop", workDir, list);',
    '        }',
    '      } catch {}',
    '    }',
    '  };',
    '};',
    '',
    '// OpenCode V2 (Promise API): setup(ctx) registra hooks via ctx. V1 usa el export nombrado.',
    'async function setupContextBaseAuto(ctx = {}) {',
    '  try {',
    '    if (!claimPluginSlot()) return;',
    '    const hasSessionHook = ctx && ctx.session && typeof ctx.session.hook === "function";',
    '    const hasToolHook = ctx && ctx.tool && typeof ctx.tool.hook === "function";',
    '    if (!hasSessionHook && !hasToolHook) return;',
    '',
    '    const workDir = (ctx.location && ctx.location.directory) || ctx.directory || ctx.worktree || process.cwd();',
    '    const spiderMeta = readSpiderContext(workDir);',
    '    const touchedFiles = new Set();',
    '    const registrations = [];',
    '    let digest = "";',
    '    let digestAt = 0;',
    '    let refreshing = null;',
    '',
    '    const runHookPromise = (event, extra = []) => new Promise((resolve) => {',
    '      try {',
    '        const resolved = resolveCbCommand(workDir);',
    '        if (!resolved) return resolve("");',
    '        execFile(resolved.bin, [...resolved.prefix, "hook-run", event, ...extra], {',
    '          cwd: workDir, encoding: "utf8", timeout: 8000, windowsHide: true, maxBuffer: 1048576',
    '        }, (err, stdout) => resolve(err ? "" : String(stdout || "").trim()));',
    '      } catch { resolve(""); }',
    '    });',
    '',
    '    const refreshDigest = (force = false) => {',
    '      const now = Date.now();',
    '      if (!force && digest && now - digestAt < 60000) return Promise.resolve();',
    '      if (refreshing) return refreshing;',
    '      refreshing = runHookPromise("session-start")',
    '        .then((out) => { if (out) { digest = out; digestAt = Date.now(); } })',
    '        .catch(() => {})',
    '        .finally(() => { refreshing = null; });',
    '      return refreshing;',
    '    };',
    '',
    '    const pushSystem = (event) => {',
    '      if (!event || !Array.isArray(event.system) || !digest) return;',
    '      const marker = "<!-- CONTEXTBASE:LIVE_DIGEST -->";',
    '      const endMarker = "<!-- /CONTEXTBASE:LIVE_DIGEST -->";',
    '      const block = `${marker}\\n${digest}\\n${endMarker}`;',
    '      const existing = event.system.find((part) => part && typeof part.text === "string" && part.text.includes(marker));',
    '      if (!existing) { event.system.push({ type: "text", text: block }); return; }',
    '      const current = String(existing.text);',
    '      const start = current.indexOf(marker);',
    '      const end = current.indexOf(endMarker);',
    '      const tail = end >= 0 ? current.slice(end + endMarker.length) : "";',
    '      existing.text = current.slice(0, start) + block + tail;',
    '    };',
    '',
    '    const toolInput = (event) => (event && (event.input || event.args)) || {};',
    '    const toolTarget = (input) => (input && typeof input === "object" && (input.filePath || input.path || input.file)) || "";',
    '',
    '    const checkIsolation = (event) => {',
    '      if (!spiderMeta || !Array.isArray(spiderMeta.forbiddenFiles)) return;',
    '      const toolName = String((event && event.tool) || "").toLowerCase();',
    '      if (!MUTATING_TOOLS.has(toolName) || toolName === "bash" || toolName === "todowrite") return;',
    '      const rawTarget = toolTarget(toolInput(event));',
    '      if (!rawTarget) return;',
    '      const relTarget = path.isAbsolute(rawTarget) ? path.relative(workDir, rawTarget) : String(rawTarget);',
    '      const normTarget = path.resolve(workDir, relTarget).toLowerCase();',
    '      const forbidden = spiderMeta.forbiddenFiles.map((f) => path.resolve(workDir, String(f)).toLowerCase());',
    '      if (forbidden.includes(normTarget)) {',
    '        throw new Error(`[ContextBase Telarana] Aislamiento de hilo activo: el archivo "${relTarget}" pertenece a otra Arana. Modifica solo tus archivos asignados: ${(spiderMeta.assignedFiles || []).join(", ")}`);',
    '      }',
    '    };',
    '',
    '    const trackResult = (event) => {',
    '      const toolName = String((event && event.tool) || "").toLowerCase();',
    '      if (!MUTATING_TOOLS.has(toolName) && !toolName.startsWith("contextbase_")) return;',
    '      const input = toolInput(event);',
    '      const target = toolTarget(input) || (event && event.result && event.result.metadata && event.result.metadata.filePath) || "";',
    '      if (target) touchedFiles.add(String(target));',
    '      if (toolName === "todowrite" && Array.isArray(input.todos)) {',
    '        for (const todo of input.todos) {',
    '          const content = todo && (todo.content || todo.text || todo.description);',
    '          if (!content) continue;',
    '          if (todo.status === "completed") runAsyncHook("task-done", workDir, [String(content)]);',
    '          else if (todo.status === "pending" || todo.status === "in_progress") runAsyncHook("task-add", workDir, [String(content)]);',
    '        }',
    '      }',
    '      digestAt = 0;',
    '    };',
    '',
    '    void refreshDigest(true);',
    '',
    '    if (hasSessionHook) {',
    '      try {',
    '        const reg = await ctx.session.hook("context", (event) => { try { pushSystem(event); } catch {} });',
    '        if (reg) registrations.push(reg);',
    '      } catch {}',
    '    }',
    '',
    '    if (hasToolHook) {',
    '      try {',
    '        const reg = await ctx.tool.hook("execute.before", (event) => {',
    '          try { checkIsolation(event); } catch (err) {',
    '            if (err && String(err.message || "").includes("[ContextBase Telarana]")) throw err;',
    '          }',
    '        });',
    '        if (reg) registrations.push(reg);',
    '      } catch {}',
    '      try {',
    '        const reg = await ctx.tool.hook("execute.after", (event) => { try { trackResult(event); } catch {} });',
    '        if (reg) registrations.push(reg);',
    '      } catch {}',
    '    }',
    '',
    '    const timer = setInterval(() => {',
    '      void runHookPromise("web-pulse");',
    '      void refreshDigest(true);',
    '    }, 60000);',
    '    if (typeof timer.unref === "function") timer.unref();',
    '',
    '    return async () => {',
    '      clearInterval(timer);',
    '      if (touchedFiles.size > 0) {',
    '        const list = Array.from(touchedFiles).slice(0, 15);',
    '        touchedFiles.clear();',
    '        await runHookPromise("session-stop", list);',
    '      }',
    '      for (const registration of registrations) {',
    '        try { await registration.dispose?.(); } catch {}',
    '      }',
    '    };',
    '  } catch {',
    '    return;',
    '  }',
    '}',
    '',
    '// Contrato OpenCode v2: default export objeto con id + setup (API Promise).',
    '// No incluir effect: si existe, el runtime lo prefiere y la activacion del',
    '// plugin queda colgada esperando hooks de ctx. setup es el contrato soportado.',
    'export default {',
    '  id: "contextbase-auto",',
    '  server: ContextBaseAutoPlugin,',
    '  setup: setupContextBaseAuto',
    '};',
    ''
  ].join('\n');

  const check = validateOpenCodePluginSource(source);
  if (!check.ok) {
    throw new Error(`Plugin de ContextBase generado invalido: ${check.problems.join(', ')}`);
  }
  return source;
}

/**
 * Resuelve el directorio git real de un proyecto.
 *
 * En un repositorio normal `<dir>/.git` es un DIRECTORIO. Dentro de un worktree de
 * git `<dir>/.git` es un ARCHIVO con la linea `gitdir: <ruta>`: escribir el exclude
 * en `<dir>/.git/info/exclude` falla con ENOTDIR (y el catch lo escondia).
 *
 * @returns {string|null} ruta del gitdir, o null si no hay `.git`
 * @throws si el `.git` es un archivo ilegible o sin linea `gitdir:`
 */
function resolveGitDir(projectDir) {
  const dotGit = path.join(projectDir, '.git');
  const stat = fs.statSync(dotGit); // ENOENT -> el llamador devuelve false
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;
  const raw = fs.readFileSync(dotGit, 'utf8');
  const match = /^[ \t]*gitdir:[ \t]*(.+?)[ \t]*$/mi.exec(raw);
  if (!match) throw new Error('el archivo .git no tiene la linea "gitdir:"');
  const value = match[1].trim();
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectDir, value);
}

/**
 * Directorio git COMUN del repositorio. En un worktree, `--git-common-dir` apunta al
 * `.git` del repositorio principal, que es donde vive el `info/exclude` efectivo.
 * Si git no esta disponible (o el comando falla) se usa el gitdir resuelto.
 */
function resolveGitCommonDir(projectDir, gitDir) {
  try {
    const out = execFileSync('git', ['--no-optional-locks', 'rev-parse', '--git-common-dir'], {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (out) return path.isAbsolute(out) ? path.normalize(out) : path.resolve(projectDir, out);
  } catch {
    // Sin git en PATH, repo ilegible o git viejo: se usa el gitdir resuelto.
  }
  return gitDir;
}

/**
 * Registra rutas autogeneradas en el `info/exclude` del repositorio git sin ensuciar
 * el `.gitignore` versionado. Funciona en repos normales y en worktrees (donde
 * `.git` es un archivo y el exclude efectivo es el del repositorio comun).
 *
 * Nunca lanza: devuelve false y deja rastro accionable en stderr con CB_GIT_EXCLUDE.
 */
export function ensureGitExclude(projectDir) {
  const root = path.resolve(projectDir || process.cwd());
  const entries = [
    'kilo.json',
    'kilo.jsonc',
    'opencode.json',
    'opencode.jsonc',
    '.mcp.json',
    '.opencode/',
    '.kilo/',
    '.kilocode/',
    '.worktrees/',
    '.claude/settings.local.json',
    '.cursor/mcp.json',
    '.cursor/rules/contextbase.mdc',
    '.windsurf/mcp.json',
    '.clinerules',
    '.roorules',
    '.roo/',
    '.aider.conf.yml',
    '.continue/',
    '.vscode/mcp.json',
    '.github/copilot-instructions.md',
    'contextbase/strands/',
    'contextbase/snapshot/',
    'contextbase/swarm/',
    'contextbase/egm/',
    'contextbase/web/',
    'contextbase/control/',
    'contextbase/agents.json',
    'contextbase/*.lock',
    'contextbase/.auto-session.json',
    'contextbase/.spider-context.json',
    'contextbase/.watcher.pid'
  ];

  let gitDir;
  try {
    gitDir = resolveGitDir(root);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false; // no es un repositorio git: nada que excluir
    reportAutoconfigError('CB_GIT_EXCLUDE', 'ensureGitExclude', path.join(root, '.git'),
      `No se pudo leer el gitdir (${err.code || err.message}); revisa el worktree o ejecuta "git worktree repair".`);
    return false;
  }
  if (!gitDir) return false;

  const commonDir = resolveGitCommonDir(root, gitDir);
  if (!fs.existsSync(commonDir)) {
    reportAutoconfigError('CB_GIT_EXCLUDE', 'ensureGitExclude', commonDir,
      `El gitdir resuelto no existe (${gitDir}); el worktree esta roto, ejecuta "git worktree repair".`);
    return false;
  }

  const excludeFile = path.join(commonDir, 'info', 'exclude');
  try {
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    const lines = existing.split(/\r?\n/);
    const missing = entries.filter(e => !lines.includes(e));
    if (missing.length === 0) return true;
    const block = (existing.endsWith('\n') || !existing ? '' : '\n') +
      '# ContextBase auto-generated agent files\n' +
      missing.join('\n') + '\n';
    fs.writeFileSync(excludeFile, existing + block, 'utf8');
    return true;
  } catch (err) {
    reportAutoconfigError('CB_GIT_EXCLUDE', 'ensureGitExclude', excludeFile,
      `No se pudo escribir el exclude (${err.code || err.message}); verifica permisos sobre ${commonDir}.`);
    return false;
  }
}

/**
 * Configura kilo.json, .kilo/ y .kilocode/ para ejecucion 100% automatica en Kilo Code.
 */
export function configureKilo(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];
  const pluginCode = buildOpenCodePluginSource(binPath, nodePath);

  const kiloRuleFile = path.join(projectDir, '.kilo', 'rules', 'contextbase.md');
  writeAtomic(kiloRuleFile, CONTEXTBASE_RULE_BLOCK + '\n');
  written.push('.kilo/rules/contextbase.md');

  const kilocodeRuleFile = path.join(projectDir, '.kilocode', 'rules', 'contextbase.md');
  writeAtomic(kilocodeRuleFile, CONTEXTBASE_RULE_BLOCK + '\n');
  written.push('.kilocode/rules/contextbase.md');

  const kiloPluginFile = path.join(projectDir, '.kilo', 'plugins', 'contextbase-auto.js');
  writeAtomic(kiloPluginFile, pluginCode);
  written.push('.kilo/plugins/contextbase-auto.js');

  // V2 descubre .kilo/plugins; la copia singular duplicaba todos los hooks.
  removeFileIfExists(path.join(projectDir, '.kilo', 'plugin', 'contextbase-auto.js'));

  const kilocodeMcpFile = path.join(projectDir, '.kilocode', 'mcp.json');
  const kcMcpParsed = readJsonSafe(kilocodeMcpFile);
  if (kcMcpParsed === null && fs.existsSync(kilocodeMcpFile)) {
    backupConfig(kilocodeMcpFile);
    throw new Error('.kilocode/mcp.json no es JSON valido; no se modifico.');
  }
  const kcMcp = kcMcpParsed || {};
  if (!kcMcp.mcpServers || typeof kcMcp.mcpServers !== 'object') kcMcp.mcpServers = {};
  kcMcp.mcpServers.contextbase = {
    command: nodePath,
    args: [binPath, 'mcp'],
    alwaysAllow: ['contextbase_status', 'contextbase_context', 'contextbase_log', 'contextbase_task', 'contextbase_sync', 'contextbase_audit', 'contextbase_swarm_start', 'contextbase_swarm_status', 'contextbase_swarm_send', 'contextbase_swarm_collect', 'contextbase_swarm_stop']
  };
  if (fs.existsSync(kilocodeMcpFile)) backupConfig(kilocodeMcpFile);
  writeAtomic(kilocodeMcpFile, JSON.stringify(kcMcp, null, 2) + '\n');
  written.push('.kilocode/mcp.json');

  const target = pickKiloConfigPath(projectDir);
  const mergeFailures = [];
  const res = mergeUserConfig(
    target,
    {},
    [
      {
        value(cfg) {
          cfg.instructions = ensureArrayItem(ensureArrayItem(cfg.instructions, 'AGENTS.md'), '.kilo/rules/contextbase.md');
          cfg.plugin = ensureArrayItem(cfg.plugin, './.kilo/plugins/contextbase-auto.js');
          cfg.permission = {
            read: 'allow',
            glob: 'allow',
            grep: 'allow',
            ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
            'contextbase_*': 'allow'
          };
          if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
          cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
        },
        jsonc(raw, parsed) {
          let out = raw;
          const instructions = ensureArrayItem(ensureArrayItem(parsed.instructions, 'AGENTS.md'), '.kilo/rules/contextbase.md');
          if (!configEq(parsed.instructions, instructions)) out = setJsoncPath(out, ['instructions'], instructions);
          const plugins = ensureArrayItem(parsed.plugin, './.kilo/plugins/contextbase-auto.js');
          if (!configEq(parsed.plugin, plugins)) out = setJsoncPath(out, ['plugin'], plugins);
          const wantPerm = {
            read: 'allow',
            glob: 'allow',
            grep: 'allow',
            ...(parsed.permission && typeof parsed.permission === 'object' ? parsed.permission : {}),
            'contextbase_*': 'allow'
          };
          if (!configEq(parsed.permission, wantPerm)) out = setJsoncPath(out, ['permission'], wantPerm);
          const want = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
          const have = parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp.contextbase : undefined;
          if (!configEq(have, want)) {
            const mcpBase = parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp : {};
            out = setJsoncPath(out, ['mcp'], { ...mcpBase, contextbase: want });
          }
          return out;
        }
      }
    ],
    mergeFailures,
    'configureKilo'
  );
  if (!res.written) {
    // Config corrupta: mergeUserConfig ya dejo backup y reporto el fallo; no se pisa.
    throw new Error(`${path.basename(res.file)} no es JSON valido; no se modifico.`);
  }
  written.push(path.basename(res.file));

  return written;
}

/**
 * Configura opencode.json y .opencode/ (plugins + plugin + skills) para ejecucion 100% automatica en OpenCode.
 */
export function configureOpenCode(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];
  const pluginFile = path.join(projectDir, '.opencode', 'plugins', 'contextbase-auto.js');

  // Un solo plugin por host: OpenCode carga el global y el del proyecto en el
  // mismo proceso. Si el global ya cumple el contrato, cubre todas las sesiones
  // y la copia local solo duplica la instancia (y, si queda vieja en algun
  // proyecto, rompe el arranque). Con global valido no se escribe copia local.
  const globalPluginFile = path.join(
    options.homeDir || os.homedir(),
    '.config',
    'opencode',
    'plugins',
    'contextbase-auto.js'
  );
  let globalPluginOk = false;
  try {
    globalPluginOk = validateOpenCodePluginSource(fs.readFileSync(globalPluginFile, 'utf8')).ok;
  } catch {
    globalPluginOk = false;
  }

  if (globalPluginOk) {
    removeFileIfExists(pluginFile);
  } else {
    const pluginCode = ensureValidPluginSource(
      buildOpenCodePluginSource(binPath, nodePath),
      'configureOpenCode',
      pluginFile
    );
    writeAtomic(pluginFile, pluginCode);
    written.push('.opencode/plugins/contextbase-auto.js');
  }

  // V2 descubre .opencode/plugins; la copia singular duplicaba todos los hooks.
  removeFileIfExists(path.join(projectDir, '.opencode', 'plugin', 'contextbase-auto.js'));

  const skillSource = path.resolve(__dirname, '..', 'skills', 'contextbase', 'SKILL.md');
  if (fs.existsSync(skillSource)) {
    const skillDest = path.join(projectDir, '.opencode', 'skills', 'contextbase', 'SKILL.md');
    writeAtomic(skillDest, fs.readFileSync(skillSource, 'utf8'));
    written.push('.opencode/skills/contextbase/SKILL.md');
  }

  const target = pickOpenCodeConfigPath(projectDir);
  const mergeFailures = [];
  const want = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
  const res = mergeUserConfig(
    target,
    {},
    [
      {
        value(cfg) {
          cfg.instructions = ensureArrayItem(cfg.instructions, 'AGENTS.md');
          // El esquema del host manda: v2 usa plugins/permissions/mcp.servers;
          // v1 usaba plugin/permission/mcp.<nombre>. Mezclarlos invalida el config.
          const esV2 = hostSchemaIsV2() || Array.isArray(cfg.permissions) || Array.isArray(cfg.plugins)
            || (cfg.agents && typeof cfg.agents === 'object')
            || Boolean(cfg.mcp && typeof cfg.mcp === 'object' && cfg.mcp.servers);
          cfg.plugins = stripPluginFilePaths(cfg.plugins);
          // Las rutas de archivo son invalidas en ambos esquemas: una entrada legacy en
          // `plugin` hace que el host intente cargar el .js por ruta y descarte el plugin.
          cfg.plugin = stripPluginFilePaths(cfg.plugin);
          if (esV2) {
            const permisos = Array.isArray(cfg.permissions) ? cfg.permissions.slice() : [];
            if (!permisos.some((p) => p && p.action === 'contextbase_*')) {
              permisos.push({ action: 'contextbase_*', resource: '*', effect: 'allow' });
            }
            cfg.permissions = permisos;
          } else {
            cfg.permission = {
              ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
              'contextbase_*': 'allow'
            };
          }
          if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
          if (esV2) {
            cfg.mcp.servers = { ...(cfg.mcp.servers && typeof cfg.mcp.servers === 'object' ? cfg.mcp.servers : {}), contextbase: want };
            // Limpieza del dialecto v1 SOLO cuando la clave es vacia o propiedad de
            // ContextBase: el host v2 ignora estas claves y su presencia confunde.
            if (Array.isArray(cfg.plugin) && cfg.plugin.length === 0) delete cfg.plugin;
            if (cfg.permission && typeof cfg.permission === 'object'
              && Object.keys(cfg.permission).every((k) => k === 'contextbase_*')) delete cfg.permission;
            if (cfg.mcp.contextbase) delete cfg.mcp.contextbase;
          } else {
            cfg.mcp.contextbase = want;
          }
        },
        jsonc(raw, parsed) {
          let out = raw;
          const instructions = ensureArrayItem(parsed.instructions, 'AGENTS.md');
          if (!configEq(parsed.instructions, instructions)) out = setJsoncPath(out, ['instructions'], instructions);
          for (const key of ['plugin', 'plugins']) {
            if (Array.isArray(parsed[key]) && parsed[key].some(isPluginFilePath)) {
              out = setJsoncPath(out, [key], stripPluginFilePaths(parsed[key]));
            }
          }
          const esV2 = hostSchemaIsV2() || Array.isArray(parsed.permissions) || Array.isArray(parsed.plugins)
            || (parsed.agents && typeof parsed.agents === 'object')
            || Boolean(parsed.mcp && typeof parsed.mcp === 'object' && parsed.mcp.servers);
          if (esV2) {
            const permisos = Array.isArray(parsed.permissions) ? parsed.permissions.slice() : [];
            if (!permisos.some((p) => p && p.action === 'contextbase_*')) {
              out = setJsoncPath(out, ['permissions'], [...permisos, { action: 'contextbase_*', resource: '*', effect: 'allow' }]);
            }
          } else {
            const existingPerm = parsed.permission && typeof parsed.permission === 'object' ? parsed.permission['contextbase_*'] : undefined;
            if (existingPerm !== 'allow') {
              out = setJsoncPath(out, ['permission'], {
                ...(parsed.permission && typeof parsed.permission === 'object' ? parsed.permission : {}),
                'contextbase_*': 'allow'
              });
            }
          }
          const mcpServers = parsed.mcp && typeof parsed.mcp === 'object' && parsed.mcp.servers && typeof parsed.mcp.servers === 'object';
          const have = mcpServers
            ? parsed.mcp.servers.contextbase
            : (parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp.contextbase : undefined);
          if (!configEq(have, want)) {
            const mcpBase = parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp : {};
            out = setJsoncPath(out, ['mcp'], mcpServers || esV2
              ? { ...mcpBase, servers: { ...(mcpBase.servers || {}), contextbase: want } }
              : { ...mcpBase, contextbase: want });
          }
          return out;
        }
      }
    ],
    mergeFailures,
    'configureOpenCode'
  );
  if (!res.written) {
    // Config corrupta: mergeUserConfig ya dejo backup y reporto el fallo; no se pisa.
    throw new Error(`${path.basename(res.file)} no es JSON valido; no se modifico.`);
  }
  written.push(path.basename(res.file));

  return written;
}

/**
 * Configura .mcp.json y hooks de ciclo de vida en .claude/settings.json para Claude Code.
 */
export function configureClaude(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];

  const mcpFile = path.join(projectDir, '.mcp.json');
  const mcpParsed = readJsonSafe(mcpFile);
  if (mcpParsed === null && fs.existsSync(mcpFile)) {
    backupConfig(mcpFile);
    throw new Error('.mcp.json no es JSON valido; no se modifico.');
  }
  const mcpCfg = mcpParsed || {};
  if (fs.existsSync(mcpFile)) backupConfig(mcpFile);
  if (!mcpCfg.mcpServers || typeof mcpCfg.mcpServers !== 'object') mcpCfg.mcpServers = {};
  mcpCfg.mcpServers.contextbase = {
    command: nodePath,
    args: [binPath, 'mcp']
  };
  writeAtomic(mcpFile, JSON.stringify(mcpCfg, null, 2) + '\n');
  written.push('.mcp.json');

  const claudeDir = path.join(projectDir, '.claude');
  if (fs.existsSync(claudeDir) || options.includeAll) {
    const settingsFile = path.join(claudeDir, 'settings.json');
    const settingsParsed = readJsonSafe(settingsFile);
    if (settingsParsed === null && fs.existsSync(settingsFile)) {
      backupConfig(settingsFile);
      throw new Error('.claude/settings.json no es JSON valido; no se modifico.');
    }
    const settings = settingsParsed || {};
    if (fs.existsSync(settingsFile)) backupConfig(settingsFile);
    if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
    settings.permissions.allow = ensureArrayItem(settings.permissions.allow, 'mcp__contextbase__*');

    if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
    const cmdStart = `"${nodePath}" "${binPath}" hook-run session-start`;
    const cmdPost = `"${nodePath}" "${binPath}" hook-run post-tool`;
    const cmdStop = `"${nodePath}" "${binPath}" hook-run session-stop`;

    const hasHook = (list, sub) => Array.isArray(list) && JSON.stringify(list).includes(sub);
    if (!hasHook(settings.hooks.SessionStart, 'hook-run session-start')) {
      settings.hooks.SessionStart = [
        ...(Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : []),
        { matcher: '', hooks: [{ type: 'command', command: cmdStart }] }
      ];
    }
    if (!hasHook(settings.hooks.PostToolUse, 'hook-run post-tool')) {
      settings.hooks.PostToolUse = [
        ...(Array.isArray(settings.hooks.PostToolUse) ? settings.hooks.PostToolUse : []),
        { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: cmdPost }] }
      ];
    }
    if (!hasHook(settings.hooks.Stop, 'hook-run session-stop')) {
      settings.hooks.Stop = [
        ...(Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : []),
        { matcher: '', hooks: [{ type: 'command', command: cmdStop }] }
      ];
    }
    writeAtomic(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    written.push('.claude/settings.json');
  }

  return written;
}

/**
 * Configura Cursor (.cursor/mcp.json y .cursor/rules/contextbase.mdc) y Windsurf.
 */
export function configureCursorAndIde(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];

  if (fs.existsSync(path.join(projectDir, '.cursor')) || options.includeAll) {
    const cursorMcp = path.join(projectDir, '.cursor', 'mcp.json');
    const cursorParsed = readJsonSafe(cursorMcp);
    if (cursorParsed === null && fs.existsSync(cursorMcp)) {
      backupConfig(cursorMcp);
      throw new Error('.cursor/mcp.json no es JSON valido; no se modifico.');
    }
    const cfg = cursorParsed || {};
    if (fs.existsSync(cursorMcp)) backupConfig(cursorMcp);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    cfg.mcpServers.contextbase = { command: nodePath, args: [binPath, 'mcp'] };
    writeAtomic(cursorMcp, JSON.stringify(cfg, null, 2) + '\n');
    written.push('.cursor/mcp.json');

    const mdcFile = path.join(projectDir, '.cursor', 'rules', 'contextbase.mdc');
    const mdcBody = [
      '---',
      'description: Memoria persistente, Telarana de Agentes y bitacora automatica ContextBase',
      'globs: *',
      'alwaysApply: true',
      '---',
      '',
      CONTEXTBASE_RULE_BLOCK,
      ''
    ].join('\n');
    writeAtomic(mdcFile, mdcBody);
    written.push('.cursor/rules/contextbase.mdc');
  }

  if (fs.existsSync(path.join(projectDir, '.windsurf')) || options.includeAll) {
    const wsMcp = path.join(projectDir, '.windsurf', 'mcp.json');
    const wsParsed = readJsonSafe(wsMcp);
    if (wsParsed === null && fs.existsSync(wsMcp)) {
      backupConfig(wsMcp);
      throw new Error('.windsurf/mcp.json no es JSON valido; no se modifico.');
    }
    const cfg = wsParsed || {};
    if (fs.existsSync(wsMcp)) backupConfig(wsMcp);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    cfg.mcpServers.contextbase = { command: nodePath, args: [binPath, 'mcp'] };
    writeAtomic(wsMcp, JSON.stringify(cfg, null, 2) + '\n');
    written.push('.windsurf/mcp.json');
  }

  return written;
}

/**
 * Configura todos los agentes en el proyecto actual (OpenCode, Kilo, Claude, Cursor, Windsurf y puentes universales).
 */
/**
 * El directorio personal no es un proyecto: escribir ./opencode.json, kilo.json,
 * AGENTS.md... ahi genera un residuo que Kilo re-normaliza con su propio schema y
 * que OpenCode carga como "proyecto". Se salta el scaffold de proyecto; la config
 * global de ~/.config/ sigue operando con normalidad.
 */
function isHomeProjectDir(projectDir) {
  const root = path.resolve(projectDir);
  const home = path.resolve(os.homedir());
  return process.platform === 'win32' ? root.toLowerCase() === home.toLowerCase() : root === home;
}
export { isHomeProjectDir };

export function autoConfigureProject(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  if (isHomeProjectDir(root)) {
    return { projectDir: root, files: [], failures: [], skipped: 'home-directory' };
  }
  const files = [];
  const failures = [];

  try { files.push(...configureKilo(root, options)); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'configureKilo', err.message));
  }
  try { files.push(...configureOpenCode(root, options)); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'configureOpenCode', err.message));
  }
  try { files.push(...configureClaude(root, options)); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'configureClaude', err.message));
  }
  try { files.push(...configureCursorAndIde(root, options)); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'configureCursorAndIde', err.message));
  }
  try { files.push(...configureUniversalBridges(root, options)); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'configureUniversalBridges', err.message));
  }
  try { ensureGitExclude(root); } catch (err) {
    failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'ensureGitExclude', err.message));
  }
  return { projectDir: root, files, failures };
}

/**
 * Elige el archivo de configuracion destino de Kilo Code.
 *
 * Precedencia: si existe `kilo.json` se usa ese; si solo existe `kilo.jsonc` se fusiona
 * sobre el (nunca se crea un `kilo.json` que lo eclipse, porque Kilo Code lee el `.jsonc`).
 */
export function pickKiloConfigPath(kiloDir) {
  const jsonPath = path.join(kiloDir, 'kilo.json');
  const jsoncPath = path.join(kiloDir, 'kilo.jsonc');
  if (fs.existsSync(jsonPath)) return { file: jsonPath, format: 'json' };
  if (fs.existsSync(jsoncPath)) return { file: jsoncPath, format: 'jsonc' };
  return { file: jsonPath, format: 'json' };
}

/**
 * Elige el archivo de configuracion destino de OpenCode.
 *
 * Precedencia: si existe `opencode.jsonc` se fusiona sobre el (es el formato real en uso);
 * si no, se usa `opencode.json`.
 */
export function pickOpenCodeConfigPath(ocDir) {
  const jsoncPath = path.join(ocDir, 'opencode.jsonc');
  const jsonPath = path.join(ocDir, 'opencode.json');
  if (fs.existsSync(jsoncPath)) return { file: jsoncPath, format: 'jsonc' };
  return { file: jsonPath, format: 'json' };
}

/**
 * Fusiona claves sobre un archivo JSON/JSONC de usuario sin destruir su contenido.
 *
 * - Si el archivo no existe: se crea con el objeto base.
 * - Si existe y no parsea: NO se pisa. Se deja backup .bak-contextbase y se reporta el fallo.
 * - Si existe y parsea: se hace backup previo y se fusiona preservando comentarios (JSONC).
 */
function mergeUserConfig(target, base, mutations, failures, op) {
  const { file, format } = target;
  const exists = fs.existsSync(file);

  if (!exists) {
    const cfg = { ...base };
    for (const m of mutations) m.value(cfg);
    writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n');
    return { file, written: true };
  }

  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    failures.push(reportConfigError('CONFIG_READ_FAILED', op, err.message, { file }));
    return { file, written: false };
  }

  let parsed;
  try { parsed = format === 'jsonc' ? readJsonc(file) : safeJsonParse(raw); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Archivo corrupto: se conserva intacto y se deja copia de seguridad.
    backupConfig(file);
    failures.push(
      reportConfigError('CONFIG_INVALID_JSON', op, `El archivo de configuracion no es JSON valido; no se modifico.`, { file })
    );
    return { file, written: false };
  }

  if (format === 'jsonc') {
    let merged = raw;
    try {
      for (const m of mutations) {
        if (m.jsonc) merged = m.jsonc(merged, parsed);
        else m.value(parsed);
      }
    } catch (err) {
      failures.push(reportConfigError('CONFIG_MERGE_FAILED', op, err.message, { file }));
      return { file, written: false };
    }
    // Sin cambios reales no se toca el archivo: reescribirlo dispara la recarga del
    // vigilante del host y provoca churn (OpenCode puede recargar y perder el estado).
    if (merged === raw) return { file, written: false };
    backupConfig(file);
    writeAtomic(file, merged);
    return { file, written: true };
  }

  backupConfig(file);

  const cfg = { ...parsed };
  for (const m of mutations) m.value(cfg);
  writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n');
  return { file, written: true };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Configura los directorios globales del usuario para que cualquier proyecto nuevo
 * tenga el plugin y el servidor MCP de ContextBase activos sin ejecucion manual.
 */
/**
 * Detecta el esquema del host leyendo la config GLOBAL de OpenCode: v2 usa
 * `permissions`/`agents`/`plugins`/`mcp.servers`; v1 usaba `permission`/`mcp.<nombre>`.
 * El config de PROYECTO debe hablar el mismo dialecto o el host ignora sus claves.
 */
function hostSchemaIsV2(homeDir = os.homedir()) {
  // Bajo node --test no se inspecciona el home real (resultado determinista).
  if (process.env.NODE_TEST_CONTEXT && process.env.CONTEXTBASE_HOST_SCHEMA !== 'v2') return false;
  if (process.env.CONTEXTBASE_HOST_SCHEMA === 'v1') return false;
  if (process.env.CONTEXTBASE_HOST_SCHEMA === 'v2') return true;
  try {
    const dir = path.join(homeDir, '.config', 'opencode');
    const target = pickOpenCodeConfigPath(dir);
    if (!target || !target.file || !fs.existsSync(target.file)) return false;
    const cfg = target.format === 'jsonc' ? readJsonc(target.file) : safeJsonParse(fs.readFileSync(target.file, 'utf8'));
    if (!cfg || typeof cfg !== 'object') return false;
    return Boolean(
      Array.isArray(cfg.permissions) ||
      Array.isArray(cfg.plugins) ||
      (cfg.agents && typeof cfg.agents === 'object') ||
      (cfg.mcp && typeof cfg.mcp === 'object' && cfg.mcp.servers)
    );
  } catch {
    return false;
  }
}

export function autoConfigureGlobal(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const configured = [];
  const failures = [];
  let pluginCode = '';
  try {
    pluginCode = buildOpenCodePluginSource(binPath, nodePath);
    const check = validateOpenCodePluginSource(pluginCode);
    if (!check.ok) {
      throw new Error(`Plugin OpenCode invalido (${check.problems.join(', ')}); no se escribio.`);
    }
  } catch (err) {
    // Sin plugin valido no se escribe nada (un default export roto hace que OpenCode descarte
    // el plugin y pierda los agentes custom); la config MCP/permisos global sigue aplicandose.
    failures.push(reportConfigError('CONFIG_PLUGIN_INVALID', 'autoConfigureGlobal', err.message));
    pluginCode = '';
  }

  // 1. OpenCode global plugin y config
  const opencodeGlobalDir = path.join(homeDir, '.config', 'opencode');
  if (fs.existsSync(opencodeGlobalDir) || options.forceGlobal) {
    const pluginPath = path.join(opencodeGlobalDir, 'plugins', 'contextbase-auto.js');
    if (pluginCode) {
      try {
        writeAtomic(pluginPath, pluginCode);
        configured.push(pluginPath);
        removeFileIfExists(path.join(opencodeGlobalDir, 'plugin', 'contextbase-auto.js'));
      } catch (err) {
        failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'autoConfigureGlobal', err.message, { file: pluginPath }));
      }
    }

    const target = pickOpenCodeConfigPath(opencodeGlobalDir);
    const res = mergeUserConfig(
      target,
      {},
      [
        {
          value(cfg) {
            cfg.plugins = stripPluginFilePaths(cfg.plugins);
            if (!Array.isArray(cfg.permissions)) cfg.plugin = stripPluginFilePaths(cfg.plugin);
            if (Array.isArray(cfg.permissions)) {
              const already = cfg.permissions.some((p) => p && p.action === 'contextbase_*');
              if (!already) cfg.permissions = [...cfg.permissions, { action: 'contextbase_*', resource: '*', effect: 'allow' }];
            } else {
              cfg.permission = {
                ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
                'contextbase_*': 'allow',
              };
            }
            if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
            if (cfg.mcp.servers && typeof cfg.mcp.servers === 'object') {
              cfg.mcp.servers.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            } else {
              cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            }
          },
          jsonc(raw, parsed) {
            let out = raw;
            for (const key of ['plugin', 'plugins']) {
              if (Array.isArray(parsed[key]) && parsed[key].some(isPluginFilePath)) {
                out = setJsoncPath(out, [key], stripPluginFilePaths(parsed[key]));
              }
            }
            // El esquema v2 usa `permissions` (array de {action,resource,effect}); v1 usaba
            // `permission` (objeto). Escribir la clave legacy en un config v2 lo invalida y el
            // host lo descarta (los agentes pierden color y los MCP dejan de cargar).
            if (Array.isArray(parsed.permissions)) {
              const already = parsed.permissions.some(
                (p) => p && p.action === 'contextbase_*' && (p.effect === 'allow' || p.effect === undefined)
              );
              if (!already) {
                out = setJsoncPath(out, ['permissions'], [
                  ...parsed.permissions,
                  { action: 'contextbase_*', resource: '*', effect: 'allow' },
                ]);
              }
            } else {
              const existingPerm = parsed.permission && typeof parsed.permission === 'object' ? parsed.permission['contextbase_*'] : undefined;
              if (existingPerm !== 'allow') {
                const perm = {
                  ...(parsed.permission && typeof parsed.permission === 'object' ? parsed.permission : {}),
                  'contextbase_*': 'allow',
                };
                out = setJsoncPath(out, ['permission'], perm);
              }
            }
            const mcpServers =
              parsed.mcp && typeof parsed.mcp === 'object' && parsed.mcp.servers && typeof parsed.mcp.servers === 'object';
            const want = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            const have = mcpServers
              ? parsed.mcp.servers.contextbase
              : (parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp.contextbase : undefined);
            if (!configEq(have, want)) {
              const mcpBase = parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp : {};
              const mcpNext = mcpServers
                ? { ...mcpBase, servers: { ...mcpBase.servers, contextbase: want } }
                : { ...mcpBase, contextbase: want };
              out = setJsoncPath(out, ['mcp'], mcpNext);
            }
            return out;
          },
        },
      ],
      failures,
      'autoConfigureGlobal.opencode'
    );
    if (res.written) configured.push(res.file);
  }

  // 2. Kilo Code global plugin y config
  const kiloGlobalDir = path.join(homeDir, '.config', 'kilo');
  if (fs.existsSync(kiloGlobalDir) || options.forceGlobal) {
    const pluginPath = path.join(kiloGlobalDir, 'plugins', 'contextbase-auto.js');
    if (pluginCode) {
      try {
        writeAtomic(pluginPath, pluginCode);
        configured.push(pluginPath);
        removeFileIfExists(path.join(kiloGlobalDir, 'plugin', 'contextbase-auto.js'));
      } catch (err) {
        failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'autoConfigureGlobal', err.message, { file: pluginPath }));
      }
    }

    const target = pickKiloConfigPath(kiloGlobalDir);
    const res = mergeUserConfig(
      target,
      {},
      [
        {
          value(cfg) {
            cfg.plugin = stripContextbasePluginFiles(cfg.plugin);
            cfg.plugins = stripPluginFilePaths(cfg.plugins);
            cfg.permission = {
              ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
              'contextbase_*': 'allow',
            };
            if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
            cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
          },
          jsonc(raw, parsed) {
            let out = raw;
            for (const key of ['plugin', 'plugins']) {
              if (Array.isArray(parsed[key]) && parsed[key].some(isPluginFilePath)) {
                out = setJsoncPath(out, [key], stripPluginFilePaths(parsed[key]));
              }
            }
            const existingPerm = parsed.permission && typeof parsed.permission === 'object' ? parsed.permission['contextbase_*'] : undefined;
            if (existingPerm !== 'allow') {
              const perm = {
                ...(parsed.permission && typeof parsed.permission === 'object' ? parsed.permission : {}),
                'contextbase_*': 'allow',
              };
              out = setJsoncPath(out, ['permission'], perm);
            }
            const mcpBase = parsed.mcp && typeof parsed.mcp === 'object' ? parsed.mcp : {};
            const want = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            if (!configEq(mcpBase.contextbase, want)) {
              out = setJsoncPath(out, ['mcp'], { ...mcpBase, contextbase: want });
            }
            return out;
          },
        },
      ],
      failures,
      'autoConfigureGlobal.kilo'
    );
    if (res.written) configured.push(res.file);
  }

  return { files: configured, failures };
}
