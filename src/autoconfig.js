import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './fsutil.js';
import { CONTEXTBASE_RULE_BLOCK } from './rules.js';
import { readJsonc } from './redundancy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getBinPath() {
  return path.resolve(__dirname, '..', 'bin', 'contextbase.js').replace(/\\/g, '/');
}

export function getNodePath() {
  return process.execPath.replace(/\\/g, '/');
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = readJsonc(file);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

function ensureArrayItem(arr, item) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (!list.includes(item)) list.push(item);
  return list;
}

/**
 * Genera el codigo del plugin automatico para OpenCode y Kilo Code.
 * Compatible con la firma de funcion V1 y objeto de plugin V2.
 */
export function buildOpenCodePluginSource(binPath = getBinPath(), nodePath = getNodePath()) {
  const safeBin = JSON.stringify(binPath);
  const safeNode = JSON.stringify(nodePath);
  return [
    '// Generado por ContextBase - Plugin de automatizacion de ciclo de vida para OpenCode y Kilo Code',
    "import { execFileSync, spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    '',
    `const NODE_BIN = ${safeNode};`,
    `const CB_BIN = ${safeBin};`,
    '',
    'function resolveWorkdir(ctx) {',
    '  return (ctx && (ctx.directory || ctx.worktree)) || process.cwd();',
    '}',
    '',
    'function runSyncHook(event, cwd, extra = []) {',
    '  try {',
    '    if (!fs.existsSync(CB_BIN)) return "";',
    '    return execFileSync(NODE_BIN, [CB_BIN, "hook-run", event, ...extra], {',
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
    '    if (!fs.existsSync(CB_BIN)) return;',
    '    const child = spawn(NODE_BIN, [CB_BIN, "hook-run", event, ...extra], {',
    '      cwd,',
    '      detached: true,',
    '      windowsHide: true,',
    '      stdio: "ignore"',
    '    });',
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
    '  let digestCache = "";',
    '  let lastDigestAt = 0;',
    '',
    '  function getDigest() {',
    '    const now = Date.now();',
    '    if (!digestCache || (now - lastDigestAt) > 15000) {',
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
    '        if (Array.isArray(output.system)) {',
    '          const idx = output.system.findIndex(s => typeof s === "string" && s.includes(marker));',
    '          if (idx >= 0) output.system[idx] = block;',
    '          else output.system.push(block);',
    '        } else if (typeof output.system === "string" && !output.system.includes(marker)) {',
    '          output.system = `${output.system}\\n\\n${block}`;',
    '        }',
    '      } catch {}',
    '    },',
    '    "chat.message": async () => {',
    '      try { getDigest(); } catch {}',
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
    'export default ContextBaseAutoPlugin;',
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
    '.claude/settings.local.json',
    '.cursor/mcp.json',
    '.cursor/rules/contextbase.mdc',
    '.windsurf/mcp.json',
    'contextbase/strands/',
    'contextbase/snapshot/',
    'contextbase/swarm/',
    'contextbase/*.lock',
    'contextbase/.auto-session.json',
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
 * Configura kilo.json y .kilo/ para ejecucion 100% automatica en Kilo Code.
 */
export function configureKilo(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];

  const kiloRuleFile = path.join(projectDir, '.kilo', 'rules', 'contextbase.md');
  writeAtomic(kiloRuleFile, CONTEXTBASE_RULE_BLOCK + '\n');
  written.push('.kilo/rules/contextbase.md');

  const kiloPluginFile = path.join(projectDir, '.kilo', 'plugins', 'contextbase-auto.js');
  writeAtomic(kiloPluginFile, buildOpenCodePluginSource(binPath, nodePath));
  written.push('.kilo/plugins/contextbase-auto.js');

  const kiloFile = path.join(projectDir, 'kilo.json');
  const cfg = readJsonSafe(kiloFile) || {};
  cfg.instructions = ensureArrayItem(ensureArrayItem(cfg.instructions, 'AGENTS.md'), '.kilo/rules/contextbase.md');
  cfg.permission = {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
    'contextbase_*': 'allow'
  };
  if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
  cfg.mcp.contextbase = {
    type: 'local',
    command: [nodePath, binPath, 'mcp'],
    enabled: true
  };
  writeAtomic(kiloFile, JSON.stringify(cfg, null, 2) + '\n');
  written.push('kilo.json');

  return written;
}

/**
 * Configura opencode.json y .opencode/ para ejecucion 100% automatica en OpenCode.
 */
export function configureOpenCode(projectDir, options = {}) {
  const binPath = options.binPath || getBinPath();
  const nodePath = options.nodePath || getNodePath();
  const written = [];

  const pluginFile = path.join(projectDir, '.opencode', 'plugins', 'contextbase-auto.js');
  writeAtomic(pluginFile, buildOpenCodePluginSource(binPath, nodePath));
  written.push('.opencode/plugins/contextbase-auto.js');

  const skillSource = path.resolve(__dirname, '..', 'skills', 'contextbase', 'SKILL.md');
  if (fs.existsSync(skillSource)) {
    const skillDest = path.join(projectDir, '.opencode', 'skills', 'contextbase', 'SKILL.md');
    writeAtomic(skillDest, fs.readFileSync(skillSource, 'utf8'));
    written.push('.opencode/skills/contextbase/SKILL.md');
  }

  const opencodeFile = path.join(projectDir, 'opencode.json');
  const cfg = readJsonSafe(opencodeFile) || {};
  cfg.instructions = ensureArrayItem(cfg.instructions, 'AGENTS.md');
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
  const mcpCfg = readJsonSafe(mcpFile) || {};
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
    const settings = readJsonSafe(settingsFile) || {};
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
    const cfg = readJsonSafe(cursorMcp) || {};
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    cfg.mcpServers.contextbase = { command: nodePath, args: [binPath, 'mcp'] };
    writeAtomic(cursorMcp, JSON.stringify(cfg, null, 2) + '\n');
    written.push('.cursor/mcp.json');

    const mdcFile = path.join(projectDir, '.cursor', 'rules', 'contextbase.mdc');
    const mdcBody = [
      '---',
      'description: Memoria persistente y bitacora automatica ContextBase',
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
    const cfg = readJsonSafe(wsMcp) || {};
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    cfg.mcpServers.contextbase = { command: nodePath, args: [binPath, 'mcp'] };
    writeAtomic(wsMcp, JSON.stringify(cfg, null, 2) + '\n');
    written.push('.windsurf/mcp.json');
  }

  return written;
}

/**
 * Configura todos los agentes en el proyecto actual (OpenCode, Kilo, Claude, Cursor, Windsurf).
 */
export function autoConfigureProject(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const files = [];
  try { files.push(...configureKilo(root, options)); } catch {}
  try { files.push(...configureOpenCode(root, options)); } catch {}
  try { files.push(...configureClaude(root, options)); } catch {}
  try { files.push(...configureCursorAndIde(root, options)); } catch {}
  try { ensureGitExclude(root); } catch {}
  return { projectDir: root, files };
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

  // 1. OpenCode global plugin y config
  const opencodeGlobalDir = path.join(homeDir, '.config', 'opencode');
  if (fs.existsSync(opencodeGlobalDir) || options.forceGlobal) {
    try {
      const pluginPath = path.join(opencodeGlobalDir, 'plugins', 'contextbase-auto.js');
      writeAtomic(pluginPath, buildOpenCodePluginSource(binPath, nodePath));
      configured.push(pluginPath);

      const jsoncPath = path.join(opencodeGlobalDir, 'opencode.jsonc');
      const jsonPath = path.join(opencodeGlobalDir, 'opencode.json');
      const targetCfgPath = fs.existsSync(jsoncPath) ? null : jsonPath;
      if (targetCfgPath) {
        const cfg = readJsonSafe(targetCfgPath) || {};
        cfg.permission = {
          ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
          'contextbase_*': 'allow'
        };
        if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
        if (cfg.mcp.servers && typeof cfg.mcp.servers === 'object') {
          cfg.mcp.servers.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
        } else {
          cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
        }
        writeAtomic(targetCfgPath, JSON.stringify(cfg, null, 2) + '\n');
        configured.push(targetCfgPath);
      }
    } catch {}
  }

  // 2. Kilo Code global plugin y config
  const kiloGlobalDir = path.join(homeDir, '.config', 'kilo');
  if (fs.existsSync(kiloGlobalDir) || options.forceGlobal) {
    try {
      const pluginPath = path.join(kiloGlobalDir, 'plugins', 'contextbase-auto.js');
      writeAtomic(pluginPath, buildOpenCodePluginSource(binPath, nodePath));
      configured.push(pluginPath);

      const kiloJson = path.join(kiloGlobalDir, 'kilo.json');
      const cfg = readJsonSafe(kiloJson) || {};
      cfg.permission = {
        ...(cfg.permission && typeof cfg.permission === 'object' ? cfg.permission : {}),
        'contextbase_*': 'allow'
      };
      if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = {};
      cfg.mcp.contextbase = { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
      writeAtomic(kiloJson, JSON.stringify(cfg, null, 2) + '\n');
      configured.push(kiloJson);
    } catch {}
  }

  return configured;
}
