import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './fsutil.js';
import { CONTEXTBASE_RULE_BLOCK } from './rules.js';
import { readJsonc } from './redundancy.js';
import { appendJsoncArray, setJsoncPath } from './jsonc.js';
import { configureUniversalBridges } from './universal-agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_SUFFIX = '.bak-contextbase';

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
 * Copia de seguridad del archivo antes de escribir sobre el.
 * Se usa el sufijo .bak-contextbase (precedente ya existente en el ecosistema).
 */
export function backupConfig(file) {
  if (!fs.existsSync(file)) return null;
  const backup = file + BACKUP_SUFFIX;
  try {
    fs.copyFileSync(file, backup);
    return backup;
  } catch (err) {
    return reportConfigError('CONFIG_BACKUP_FAILED', 'backupConfig', err.message, { file });
  }
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
function stripContextbasePluginFiles(arr) {
  return (Array.isArray(arr) ? arr : []).filter(p => !isContextbasePluginFile(p));
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
 * Inserta `item` en el array JSONC de la ruta indicada sin destruir comentarios.
 * Complementa a appendJsoncArray (que devuelve null si el array no existe): crea el array.
 */
function ensureJsoncArrayItem(raw, parsed, path, item) {
  const src = path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), parsed);
  if (Array.isArray(src) && src.includes(item)) return raw;
  const appended = appendJsoncArray(raw, path, item);
  if (appended !== null) return appended;
  return setJsoncPath(raw, path, [...(Array.isArray(src) ? src : []), item]);
}

/**
 * Verifica si algún archivo de configuración de agentes tiene rutas rotas o desactualizadas
 * (por ejemplo, tras mover el proyecto o descomprimirlo en otra máquina).
 */
export function hasStaleAgentConfig(projectDir) {
  const root = path.resolve(projectDir || process.cwd());
  const opencodeFile = path.join(root, 'opencode.json');
  const kiloFile = path.join(root, 'kilo.json');
  const pluginFile = path.join(root, '.opencode', 'plugins', 'contextbase-auto.js');
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
 * Genera el codigo del plugin automatico para OpenCode y Kilo Code.
 * Compatible con la firma de funcion V1 y objeto de plugin V2, con auto-resolución
 * de binario, aislamiento de hilo de Araña y pulso automático de Telaraña.
 */
export function buildOpenCodePluginSource(binPath = getBinPath(), nodePath = getNodePath()) {
  const safeBin = JSON.stringify(binPath);
  const safeNode = JSON.stringify(nodePath);
  return [
    '// Generado por ContextBase - Plugin de automatizacion de ciclo de vida y Telarana para OpenCode y Kilo Code',
    "import { execFileSync, spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    '',
    `const DEFAULT_NODE_BIN = ${safeNode};`,
    `const DEFAULT_CB_BIN = ${safeBin};`,
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
    '// OpenCode v2 exige un default export con id y setup/effect; una funcion suelta se descarta en silencio.',
    'async function setupContextBaseAuto(ctx = {}) {',
    '  const dir = (ctx && ctx.location && ctx.location.directory) || process.cwd();',
    '  const plugin = await ContextBaseAutoPlugin({ directory: dir, worktree: dir });',
    '  // v2 ignora los hooks que devuelve la factory v1: el pulso periodico mantiene vivo el digest y la sincronizacion.',
    '  if (plugin && typeof plugin === "object") {',
    '    const timer = setInterval(() => {',
    '      try { runSyncHook("web-pulse", dir); } catch {}',
    '    }, 30000);',
    '    if (typeof timer.unref === "function") timer.unref();',
    '  }',
    '  return plugin;',
    '}',
    '',
    'export default { id: "contextbase-auto", server: ContextBaseAutoPlugin, setup: setupContextBaseAuto };',
    ''
  ].join('\n');
}

/**
 * Registra rutas autogeneradas en .git/info/exclude sin ensuciar .gitignore del repositorio.
 */
export function ensureGitExclude(projectDir) {
  const excludeFile = path.join(projectDir, '.git', 'info', 'exclude');
  if (!fs.existsSync(path.join(projectDir, '.git'))) return false;
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
    'contextbase/web/',
    'contextbase/control/',
    'contextbase/agents.json',
    'contextbase/*.lock',
    'contextbase/.auto-session.json',
    'contextbase/.spider-context.json',
    'contextbase/.watcher.pid'
  ];
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
  } catch {
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

  const kiloPluginSingular = path.join(projectDir, '.kilo', 'plugin', 'contextbase-auto.js');
  writeAtomic(kiloPluginSingular, pluginCode);
  written.push('.kilo/plugin/contextbase-auto.js');

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

  const kiloFile = path.join(projectDir, 'kilo.json');
  const cfg = readJsonSafe(kiloFile);
  if (cfg === null && fs.existsSync(kiloFile)) {
    // Config corrupta: no se pisa. Se deja backup y el fallo se reporta.
    backupConfig(kiloFile);
    reportConfigError('CONFIG_INVALID_JSON', 'configureKilo', 'kilo.json no es JSON valido; no se modifico.', { file: kiloFile });
    throw new Error('kilo.json no es JSON valido; no se modifico.');
  }
  const kiloCfg = cfg || {};
  kiloCfg.instructions = ensureArrayItem(ensureArrayItem(kiloCfg.instructions, 'AGENTS.md'), '.kilo/rules/contextbase.md');
  kiloCfg.plugin = ensureArrayItem(kiloCfg.plugin, './.kilo/plugins/contextbase-auto.js');
  kiloCfg.permission = {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    ...(kiloCfg.permission && typeof kiloCfg.permission === 'object' ? kiloCfg.permission : {}),
    'contextbase_*': 'allow'
  };
  if (!kiloCfg.mcp || typeof kiloCfg.mcp !== 'object') kiloCfg.mcp = {};
  kiloCfg.mcp.contextbase = {
    type: 'local',
    command: [nodePath, binPath, 'mcp'],
    enabled: true
  };
  if (fs.existsSync(kiloFile)) backupConfig(kiloFile);
  writeAtomic(kiloFile, JSON.stringify(kiloCfg, null, 2) + '\n');
  written.push('kilo.json');

  return written;
}

/**
 * Configura opencode.json y .opencode/ (plugins + plugin + skills) para ejecucion 100% automatica en OpenCode.
 */
export function configureOpenCode(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];
  const pluginCode = buildOpenCodePluginSource(binPath, nodePath);

  const pluginFile = path.join(projectDir, '.opencode', 'plugins', 'contextbase-auto.js');
  writeAtomic(pluginFile, pluginCode);
  written.push('.opencode/plugins/contextbase-auto.js');

  const pluginSingularFile = path.join(projectDir, '.opencode', 'plugin', 'contextbase-auto.js');
  writeAtomic(pluginSingularFile, pluginCode);
  written.push('.opencode/plugin/contextbase-auto.js');

  const skillSource = path.resolve(__dirname, '..', 'skills', 'contextbase', 'SKILL.md');
  if (fs.existsSync(skillSource)) {
    const skillDest = path.join(projectDir, '.opencode', 'skills', 'contextbase', 'SKILL.md');
    writeAtomic(skillDest, fs.readFileSync(skillSource, 'utf8'));
    written.push('.opencode/skills/contextbase/SKILL.md');
  }

  const opencodeFile = path.join(projectDir, 'opencode.json');
  const parsed = readJsonSafe(opencodeFile);
  if (parsed === null && fs.existsSync(opencodeFile)) {
    // Config corrupta: no se pisa. Se deja backup y el fallo se reporta.
    backupConfig(opencodeFile);
    reportConfigError('CONFIG_INVALID_JSON', 'configureOpenCode', 'opencode.json no es JSON valido; no se modifico.', {
      file: opencodeFile,
    });
    throw new Error('opencode.json no es JSON valido; no se modifico.');
  }
  const cfg = parsed || {};
  cfg.instructions = ensureArrayItem(cfg.instructions, 'AGENTS.md');
  cfg.plugin = stripContextbasePluginFiles(cfg.plugin);
  cfg.permission = {
    ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
    'contextbase_*': 'allow'
  };
  if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
  cfg.mcp.contextbase = {
    type: 'local',
    command: [nodePath, binPath, 'mcp'],
    enabled: true
  };
  if (fs.existsSync(opencodeFile)) backupConfig(opencodeFile);
  writeAtomic(opencodeFile, JSON.stringify(cfg, null, 2) + '\n');
  written.push('opencode.json');

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
export function autoConfigureProject(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
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

  backupConfig(file);

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
    writeAtomic(file, merged);
    return { file, written: true };
  }

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
export function autoConfigureGlobal(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const configured = [];
  const failures = [];
  const pluginCode = buildOpenCodePluginSource(binPath, nodePath);

  // 1. OpenCode global plugin y config
  const opencodeGlobalDir = path.join(homeDir, '.config', 'opencode');
  if (fs.existsSync(opencodeGlobalDir) || options.forceGlobal) {
    const pluginPath = path.join(opencodeGlobalDir, 'plugins', 'contextbase-auto.js');
    const pluginSingularPath = path.join(opencodeGlobalDir, 'plugin', 'contextbase-auto.js');
    try {
      writeAtomic(pluginPath, pluginCode);
      configured.push(pluginPath);
      writeAtomic(pluginSingularPath, pluginCode);
      configured.push(pluginSingularPath);
    } catch (err) {
      failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'autoConfigureGlobal', err.message, { file: pluginPath }));
    }

    const target = pickOpenCodeConfigPath(opencodeGlobalDir);
    const res = mergeUserConfig(
      target,
      {},
      [
        {
          value(cfg) {
            cfg.plugin = stripContextbasePluginFiles(cfg.plugin);
            cfg.permission = {
              ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
              'contextbase_*': 'allow',
            };
            if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
            if (cfg.mcp.servers && typeof cfg.mcp.servers === 'object') {
              cfg.mcp.servers.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            } else {
              cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
            }
          },
          jsonc(raw, parsed) {
            let out = raw;
            if (!Array.isArray(parsed.plugin) || !parsed.plugin.includes(pluginPath.replace(/\\/g, '/'))) {
              out = ensureJsoncArrayItem(out, parsed, ['plugin'], pluginPath.replace(/\\/g, '/'));
            }
            const existingPerm = parsed.permission && typeof parsed.permission === 'object' ? parsed.permission['contextbase_*'] : undefined;
            if (existingPerm !== 'allow') {
              const perm = {
                ...(parsed.permission && typeof parsed.permission === 'object' ? parsed.permission : {}),
                'contextbase_*': 'allow',
              };
              out = setJsoncPath(out, ['permission'], perm);
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
    const pluginSingularPath = path.join(kiloGlobalDir, 'plugin', 'contextbase-auto.js');
    try {
      writeAtomic(pluginPath, pluginCode);
      configured.push(pluginPath);
      writeAtomic(pluginSingularPath, pluginCode);
      configured.push(pluginSingularPath);
    } catch (err) {
      failures.push(reportConfigError('CONFIG_WRITE_FAILED', 'autoConfigureGlobal', err.message, { file: pluginPath }));
    }

    const target = pickKiloConfigPath(kiloGlobalDir);
    const res = mergeUserConfig(
      target,
      {},
      [
        {
          value(cfg) {
            cfg.plugin = stripContextbasePluginFiles(cfg.plugin);
            cfg.permission = {
              ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
              'contextbase_*': 'allow',
            };
            if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
            cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
          },
          jsonc(raw, parsed) {
            let out = raw;
            if (!Array.isArray(parsed.plugin) || !parsed.plugin.includes(pluginPath.replace(/\\/g, '/'))) {
              out = ensureJsoncArrayItem(out, parsed, ['plugin'], pluginPath.replace(/\\/g, '/'));
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
