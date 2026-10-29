const AGENTS = {
  opencode: {
    supported: true,
    binary: 'opencode',
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

export function agentInfo(name) {
  const key = String(name || 'opencode').trim().toLowerCase();
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

export function buildLauncher({ agent = 'opencode', session, taskPath, outDir, platform = process.platform }) {
  const info = agentInfo(agent);
  if (!info.supported) {
    throw new Error(`Agent "${info.name}" is not supported for swarm launch: ${info.reason}`);
  }
  const out = outDir || taskPath.replace(/[/\\][^/\\]+$/, '');
  const instruction =
    `Lee '${taskPath}' y ejecuta lo que indica. ` +
    `Al terminar escribe '${out}/result.md' y '${out}/status.json'.`;
  const line = `${info.binary} ${info.sessionFlag} ${session} ${info.promptFlag} "${instruction}"`;
  return platform === 'win32' ? `@echo off\r
${line}\r
` : `#!/bin/sh
${line}
`;
}
