import {
  UNIVERSAL_AGENT_PROFILES,
  buildUniversalLauncher,
  loadCustomAgents,
  resolveUniversalAgent,
} from './universal-agents.js';

const AGENTS = {
  opencode: {
    supported: true,
    binary: 'opencode',
    sessionFlag: '--session',
    promptFlag: '--prompt',
    reason: null,
  },
  kilo: {
    supported: true,
    binary: 'kilo',
    sessionFlag: '--session',
    promptFlag: '--prompt',
    reason: null,
  },
  claude: {
    supported: false,
    binary: 'claude',
    reason: 'Session contract not verified on this machine (claude is not installed).',
  },
  codex: {
    supported: false,
    binary: 'codex',
    reason: 'Session contract not verified on this machine (codex is not installed).',
  },
};

export function agentInfo(name, options = {}) {
  const key = String(name || 'opencode').trim().toLowerCase();
  const cwd = options.cwd || process.cwd();

  // 1. Verificar si es un agente personalizado registrado en contextbase/agents.json
  const custom = loadCustomAgents(cwd);
  if (custom[key]) {
    return {
      name: key,
      supported: true,
      universal: true,
      custom: true,
      binary: custom[key].binary || key,
      commandTemplate: custom[key].commandTemplate,
      reason: null,
    };
  }

  // 2. Modo adaptador universal explícito (--universal o commandTemplate personalizado)
  if (options.universal || options.agentCmd) {
    const profile = resolveUniversalAgent(key, cwd);
    return {
      name: profile ? profile.id : key,
      supported: true,
      universal: true,
      binary: (profile && profile.binary) || key,
      commandTemplate: options.agentCmd || (profile && profile.commandTemplate) || `${key} "{instruction}"`,
      reason: null,
    };
  }

  // 3. Contrato estricto por defecto (preserva compatibilidad con tests base)
  const known = AGENTS[key];
  if (!known) {
    return { name: key, supported: false, reason: `Unknown agent "${key}": no verified session contract.` };
  }
  return { name: key, ...known };
}

export function mintSessionId(run, workerId) {
  const clean = `${run}_${workerId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ses_cb_${clean}`;
}

export function buildLauncher({
  agent = 'opencode',
  session,
  taskPath,
  outDir,
  subagentsPath,
  universal = false,
  agentCmd,
  cwd,
  platform = process.platform,
}) {
  const info = agentInfo(agent, { universal, agentCmd, cwd });
  if (!info.supported) {
    throw new Error(`Agent "${info.name}" is not supported for swarm launch: ${info.reason}`);
  }
  if (info.universal || universal || agentCmd) {
    return buildUniversalLauncher({
      agent: info.name,
      session,
      taskPath,
      outDir,
      subagentsPath,
      commandTemplate: info.commandTemplate,
      projectDir: cwd,
      platform,
    });
  }
  const out = outDir || taskPath.replace(/[/\\][^/\\]+$/, '');
  const subRef = subagentsPath || `${out}/subagents.json`;
  const instruction =
    `Lee '${taskPath}' y '${subRef}' (y '${out}/refix.md' si existe), ejecuta en orden los 3 subagentes secuenciales dentro de tu hilo sin romper otros hilos. ` +
    `Al terminar escribe '${out}/result.md' y '${out}/status.json'.`;
  const line = `${info.binary} ${info.sessionFlag} ${session} ${info.promptFlag} "${instruction}"`;
  return platform === 'win32'
    ? `@echo off\r\n${line}\r\n`
    : `#!/bin/sh\n${line}\n`;
}

export { UNIVERSAL_AGENT_PROFILES };
