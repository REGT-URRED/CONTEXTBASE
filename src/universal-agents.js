import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './fsutil.js';
import { CONTEXTBASE_RULE_BLOCK } from './rules.js';

export const PHILOSOPHY = 'No es la IA, es quien controla a la IA';
const CUSTOM_AGENTS_FILE = 'contextbase/agents.json';

/**
 * Catálogo universal de perfiles de agentes de código.
 * Permite que ContextBase controle, configure y despliegue Arañas en cualquier agente del mercado
 * o en agentes futuros definidos por el usuario.
 */
export const UNIVERSAL_AGENT_PROFILES = {
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    binary: 'opencode',
    nativeSwarmVerified: true,
    sessionFlag: '--session',
    promptFlag: '--prompt',
    commandTemplate: 'opencode --session {session} --prompt "{instruction}"',
    headlessTemplate: 'opencode run --session {session} --format json "{instruction}"',
    configFiles: ['opencode.json', '.opencode/plugins/contextbase-auto.js', '.opencode/plugin/contextbase-auto.js', 'AGENTS.md'],
    capabilities: ['mcp', 'lifecycle-plugin', 'session-resume', 'worktree-spider'],
  },
  kilo: {
    id: 'kilo',
    displayName: 'Kilo Code',
    binary: 'kilo',
    nativeSwarmVerified: true,
    sessionFlag: '--session',
    promptFlag: '--prompt',
    commandTemplate: 'kilo --session {session} --prompt "{instruction}"',
    headlessTemplate: 'kilo run --session {session} --format json "{instruction}"',
    configFiles: ['kilo.json', '.kilo/plugins/contextbase-auto.js', '.kilo/rules/contextbase.md', '.kilocode/mcp.json', '.kilocode/rules/contextbase.md'],
    capabilities: ['mcp', 'lifecycle-plugin', 'session-resume', 'worktree-spider'],
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    binary: 'claude',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'claude --permission-mode acceptEdits -p "{instruction}"',
    headlessTemplate: 'claude --permission-mode acceptEdits -p "{instruction}"',
    configFiles: ['.mcp.json', '.claude/settings.json', 'CLAUDE.md'],
    capabilities: ['mcp', 'lifecycle-hooks', 'universal-spider'],
  },
  codex: {
    id: 'codex',
    displayName: 'OpenAI Codex CLI',
    binary: 'codex',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'codex --approval-mode full-auto "{instruction}"',
    headlessTemplate: 'codex --approval-mode full-auto "{instruction}"',
    configFiles: ['AGENTS.md', '.mcp.json'],
    capabilities: ['mcp', 'rules-injection', 'universal-spider'],
  },
  aider: {
    id: 'aider',
    displayName: 'Aider',
    binary: 'aider',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'aider --yes-always --message "{instruction}"',
    headlessTemplate: 'aider --yes-always --message "{instruction}"',
    configFiles: ['.aider.conf.yml', 'AGENTS.md'],
    capabilities: ['auto-read-memory', 'git-commits', 'universal-spider'],
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI / Antigravity',
    binary: 'gemini',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'gemini -p "{instruction}"',
    headlessTemplate: 'gemini -p "{instruction}"',
    configFiles: ['.gemini/settings.json', '.gemini/rules/contextbase.md', 'AGENTS.md'],
    capabilities: ['mcp', 'rules-injection', 'skills', 'universal-spider'],
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor Agent',
    binary: 'cursor',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'cursor agent "{instruction}"',
    headlessTemplate: 'cursor agent "{instruction}"',
    configFiles: ['.cursor/mcp.json', '.cursor/rules/contextbase.mdc', '.cursorrules'],
    capabilities: ['mcp', 'always-apply-mdc', 'universal-spider'],
  },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf / Cascade',
    binary: 'windsurf',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'windsurf "{instruction}"',
    headlessTemplate: 'windsurf "{instruction}"',
    configFiles: ['.windsurf/mcp.json', '.windsurf/rules/contextbase.md', '.windsurfrules'],
    capabilities: ['mcp', 'rules-injection', 'universal-spider'],
  },
  cline: {
    id: 'cline',
    displayName: 'Cline / Roo Code',
    binary: 'cline',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'cline "{instruction}"',
    headlessTemplate: 'cline "{instruction}"',
    configFiles: ['.clinerules', '.roorules', '.roo/mcp.json'],
    capabilities: ['mcp', 'rules-injection', 'universal-spider'],
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot Agent',
    binary: 'gh',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'gh copilot suggest "{instruction}"',
    headlessTemplate: 'gh copilot suggest "{instruction}"',
    configFiles: ['.github/copilot-instructions.md', '.vscode/mcp.json'],
    capabilities: ['mcp', 'instructions-md', 'universal-spider'],
  },
  continue: {
    id: 'continue',
    displayName: 'Continue.dev',
    binary: 'cn',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'cn -p "{instruction}"',
    headlessTemplate: 'cn -p "{instruction}"',
    configFiles: ['.continue/rules/contextbase.md', '.continue/mcpServers/contextbase.json'],
    capabilities: ['mcp', 'rules-injection', 'universal-spider'],
  },
  goose: {
    id: 'goose',
    displayName: 'Block Goose CLI',
    binary: 'goose',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'goose run --text "{instruction}"',
    headlessTemplate: 'goose run --text "{instruction}"',
    configFiles: ['AGENTS.md', '.mcp.json'],
    capabilities: ['mcp', 'universal-spider'],
  },
  amp: {
    id: 'amp',
    displayName: 'Sourcegraph Amp',
    binary: 'amp',
    nativeSwarmVerified: false,
    universalSupported: true,
    commandTemplate: 'amp --prompt "{instruction}"',
    headlessTemplate: 'amp --prompt "{instruction}"',
    configFiles: ['AGENTS.md', '.mcp.json'],
    capabilities: ['mcp', 'universal-spider'],
  },
};

/**
 * Lee los agentes personalizados registrados por el usuario en contextbase/agents.json.
 */
export function loadCustomAgents(projectDir = process.cwd()) {
  const file = path.join(path.resolve(projectDir), CUSTOM_AGENTS_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Registra o actualiza un agente de código personalizado en contextbase/agents.json
 * para que ContextBase pueda controlarlo y desplegarlo en la Telaraña sin tocar el código fuente.
 */
export function registerCustomAgent(projectDir = process.cwd(), { id, displayName, binary, commandTemplate, headlessTemplate, configFiles = [] }) {
  const root = path.resolve(projectDir);
  const key = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!key) throw new Error('Debe especificar un id válido para el agente (--name <id>).');
  const bin = String(binary || key).trim();
  const tpl = String(commandTemplate || `${bin} "{instruction}"`).trim();

  const current = loadCustomAgents(root);
  current[key] = {
    id: key,
    displayName: displayName || key,
    binary: bin,
    nativeSwarmVerified: true,
    universalSupported: true,
    custom: true,
    commandTemplate: tpl,
    headlessTemplate: headlessTemplate || tpl,
    configFiles: Array.isArray(configFiles) ? configFiles : [],
    capabilities: ['custom-adapter', 'universal-spider', 'worktree-spider'],
    registeredAt: new Date().toISOString(),
  };

  const file = path.join(root, CUSTOM_AGENTS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(current, null, 2) + '\n');
  return current[key];
}

/**
 * Devuelve el catálogo completo combinando los perfiles integrados y los personalizados del proyecto.
 */
export function listUniversalAgents(projectDir = process.cwd()) {
  const custom = loadCustomAgents(projectDir);
  const merged = { ...UNIVERSAL_AGENT_PROFILES, ...custom };
  return Object.values(merged);
}

/**
 * Resuelve el perfil de cualquier agente por nombre o alias.
 */
export function resolveUniversalAgent(name, projectDir = process.cwd()) {
  const raw = String(name || 'opencode').trim().toLowerCase();
  const aliasMap = {
    kilocode: 'kilo',
    'claude-code': 'claude',
    'gemini-cli': 'gemini',
    antigravity: 'gemini',
    roo: 'cline',
    roocode: 'cline',
  };
  const key = aliasMap[raw] || raw;
  const custom = loadCustomAgents(projectDir);
  if (custom[key]) return custom[key];
  if (UNIVERSAL_AGENT_PROFILES[key]) return UNIVERSAL_AGENT_PROFILES[key];
  return null;
}

/**
 * Construye un script lanzador universal (launch.sh / launch.cmd) capaz de ejecutar
 * cualquier agente del catálogo (o comando personalizado con placeholders {session}, {taskPath}, {outDir}, {instruction})
 * y ejecutar el wrapper post-ejecución de ContextBase al terminar.
 */
export function buildUniversalLauncher({
  agent = 'opencode',
  session,
  taskPath,
  outDir,
  subagentsPath,
  commandTemplate,
  projectDir = process.cwd(),
  platform = process.platform,
}) {
  const profile = resolveUniversalAgent(agent, projectDir);
  const tpl =
    commandTemplate ||
    (profile && profile.commandTemplate) ||
    `${String(agent).trim()} "{instruction}"`;
  const out = outDir || taskPath.replace(/[/\\][^/\\]+$/, '');
  const subRef = subagentsPath || `${out}/subagents.json`;
  const instruction =
    `Lee '${taskPath}' y '${subRef}' (y '${out}/refix.md' si existe), ejecuta en orden los 3 subagentes secuenciales dentro de tu hilo sin romper otros hilos. ` +
    `Al terminar escribe '${out}/result.md' y '${out}/status.json'.`;

  const renderedLine = tpl
    .replace(/\{session\}/g, String(session || 'ses_cb_default'))
    .replace(/\{taskPath\}/g, String(taskPath))
    .replace(/\{outDir\}/g, String(out))
    .replace(/\{subagentsPath\}/g, String(subRef))
    .replace(/\{instruction\}/g, instruction);

  return platform === 'win32'
    ? `@echo off\r\n${renderedLine}\r\n`
    : `#!/bin/sh\n${renderedLine}\n`;
}

/**
 * Genera los archivos puente de configuración universal para agentes adicionales
 * (Aider, Cline/Roo, Copilot/VSCode, Gemini CLI, Continue, Windsurf) cuando se solicita
 * adaptabilidad universal o cuando sus directorios existen en el proyecto.
 */
export function configureUniversalBridges(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const binPath = (options.binPath || path.resolve(root, 'bin', 'contextbase.js')).replace(/\\/g, '/');
  const nodePath = (options.nodePath || process.execPath).replace(/\\/g, '/');
  const written = [];
  const includeAll = Boolean(options.includeAll || options.universal);

  // 1. Cline & Roo Code (.clinerules, .roorules, .roo/mcp.json)
  if (includeAll || fs.existsSync(path.join(root, '.clinerules')) || fs.existsSync(path.join(root, '.roo'))) {
    writeAtomic(path.join(root, '.clinerules'), CONTEXTBASE_RULE_BLOCK + '\n');
    written.push('.clinerules');
    writeAtomic(path.join(root, '.roorules'), CONTEXTBASE_RULE_BLOCK + '\n');
    written.push('.roorules');
    const rooMcp = path.join(root, '.roo', 'mcp.json');
    writeAtomic(
      rooMcp,
      JSON.stringify(
        {
          mcpServers: {
            contextbase: {
              command: nodePath,
              args: [binPath, 'mcp'],
              alwaysAllow: ['contextbase_status', 'contextbase_context', 'contextbase_log', 'contextbase_task', 'contextbase_sync'],
            },
          },
        },
        null,
        2
      ) + '\n'
    );
    written.push('.roo/mcp.json');
  }

  // 2. GitHub Copilot & VS Code (.github/copilot-instructions.md, .vscode/mcp.json)
  if (includeAll || fs.existsSync(path.join(root, '.github')) || fs.existsSync(path.join(root, '.vscode'))) {
    const copilotFile = path.join(root, '.github', 'copilot-instructions.md');
    writeAtomic(copilotFile, CONTEXTBASE_RULE_BLOCK + '\n');
    written.push('.github/copilot-instructions.md');

    const vscodeMcp = path.join(root, '.vscode', 'mcp.json');
    writeAtomic(
      vscodeMcp,
      JSON.stringify(
        {
          servers: {
            contextbase: {
              type: 'stdio',
              command: nodePath,
              args: [binPath, 'mcp'],
            },
          },
        },
        null,
        2
      ) + '\n'
    );
    written.push('.vscode/mcp.json');
  }

  // 3. Aider (.aider.conf.yml)
  if (includeAll || fs.existsSync(path.join(root, '.aider.conf.yml'))) {
    const aiderFile = path.join(root, '.aider.conf.yml');
    const aiderYaml = [
      '# Generado por ContextBase - Filosofia: "No es la IA, es quien controla a la IA"',
      'read:',
      '  - AGENTS.md',
      '  - contextbase/fundamentos.md',
      '  - contextbase/tasklist.md',
      '  - contextbase/componentes.md',
      'auto-commits: true',
      '',
    ].join('\n');
    writeAtomic(aiderFile, aiderYaml);
    written.push('.aider.conf.yml');
  }

  // 4. Gemini CLI / Antigravity (.gemini/settings.json + .gemini/rules/contextbase.md)
  if (includeAll || fs.existsSync(path.join(root, '.gemini'))) {
    const gemRule = path.join(root, '.gemini', 'rules', 'contextbase.md');
    writeAtomic(gemRule, CONTEXTBASE_RULE_BLOCK + '\n');
    written.push('.gemini/rules/contextbase.md');

    const gemSettings = path.join(root, '.gemini', 'settings.json');
    writeAtomic(
      gemSettings,
      JSON.stringify(
        {
          mcpServers: {
            contextbase: {
              command: nodePath,
              args: [binPath, 'mcp'],
              trust: true,
            },
          },
        },
        null,
        2
      ) + '\n'
    );
    written.push('.gemini/settings.json');
  }

  // 5. Continue.dev (.continue/rules/contextbase.md)
  if (includeAll || fs.existsSync(path.join(root, '.continue'))) {
    const contRule = path.join(root, '.continue', 'rules', 'contextbase.md');
    writeAtomic(contRule, CONTEXTBASE_RULE_BLOCK + '\n');
    written.push('.continue/rules/contextbase.md');
  }

  return written;
}
