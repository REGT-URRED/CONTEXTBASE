import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJsonc } from './redundancy.js';

const CLI_ALIASES = {
  opencode: 'opencode',
  'claude-code': 'claude',
  claude: 'claude',
  kilo: 'kilo',
  kilocode: 'kilo',
  cursor: 'cursor',
  windsurf: 'windsurf',
  gemini: 'gemini'
};

function home() { return os.homedir(); }
function cwd() { return process.cwd(); }

export function findOnPath(bin) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        const full = path.join(dir, bin + ext);
        const st = fs.statSync(full);
        if (st.isFile()) return true;
      } catch {}
    }
  }
  return false;
}

export function mcpConfigPaths(cli, customCwd = cwd(), customHome = home()) {
  const h = customHome;
  const c = customCwd;
  const key = CLI_ALIASES[String(cli || '').toLowerCase()] || String(cli || '').toLowerCase();
  const paths = {
    opencode: [
      path.join(h, '.config', 'opencode', 'opencode.json'),
      path.join(h, '.config', 'opencode', 'opencode.jsonc'),
      path.join(h, '.config', 'opencode', 'config.json'),
      path.join(h, '.opencode', 'config.json'),
      path.join(c, '.opencode', 'opencode.json'),
      path.join(c, '.opencode', 'opencode.jsonc'),
      path.join(c, '.opencode', 'config.json'),
      path.join(c, 'opencode.json'),
      path.join(c, 'opencode.jsonc')
    ],
    claude: [
      path.join(h, '.claude.json'),
      path.join(h, '.claude', 'settings.json'),
      path.join(h, '.claude', 'mcp_servers.json'),
      path.join(c, '.mcp.json'),
      path.join(c, '.claude', 'settings.json')
    ],
    kilo: [
      path.join(h, '.config', 'kilo', 'kilo.json'),
      path.join(h, '.config', 'kilo', 'kilo.jsonc'),
      path.join(h, '.config', 'kilo', 'config.json'),
      path.join(h, '.kilocode', 'config.json'),
      path.join(c, '.kilo', 'kilo.json'),
      path.join(c, '.kilo', 'kilo.jsonc'),
      path.join(c, '.kilo', 'config.json'),
      path.join(c, '.kilocode', 'mcp.json'),
      path.join(c, 'kilo.json'),
      path.join(c, 'kilo.jsonc')
    ],
    cursor: [
      path.join(h, '.cursor', 'mcp.json'),
      path.join(c, '.cursor', 'mcp.json')
    ],
    windsurf: [
      path.join(h, '.codeium', 'windsurf', 'mcp_config.json'),
      path.join(c, '.windsurf', 'mcp.json')
    ],
    gemini: [
      path.join(h, '.gemini', 'settings.json'),
      path.join(c, '.gemini', 'settings.json')
    ]
  };
  return paths[key] || [];
}

export function readMcpConfig(cli, customCwd = cwd(), customHome = home()) {
  for (const full of mcpConfigPaths(cli, customCwd, customHome)) {
    try {
      if (!fs.existsSync(full)) continue;
      const parsed = readJsonc(full);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed)) return { items: parsed };
    } catch {}
  }
  return null;
}

export function detectCli(customCwd = cwd(), customHome = home()) {
  const specs = [
    { name: 'OpenCode', priority: 1, bins: ['opencode'], configCli: 'opencode' },
    { name: 'Claude Code', priority: 2, bins: ['claude'], configCli: 'claude' },
    { name: 'Kilo', priority: 3, bins: ['kilo', 'kilocode'], configCli: 'kilo' }
  ];
  const all = [];
  for (const s of specs) {
    const binaryFound = s.bins.some(findOnPath);
    const config = readMcpConfig(s.configCli, customCwd, customHome);
    all.push({ name: s.name, priority: s.priority, found: binaryFound || !!config });
  }
  const otherBins = ['cursor', 'windsurf', 'gemini', 'aider'];
  all.push({ name: 'Others', priority: 4, found: otherBins.some(findOnPath) });
  const found = all.filter(x => x.found).sort((a, b) => a.priority - b.priority);
  const primary = found.length ? found[0].name : all[0].name;
  return { primary, all };
}

export async function detectTools(registry) {
  const out = {};
  for (const tool of registry || []) {
    let res = null;
    try {
      if (typeof tool.detect === 'function') res = await tool.detect();
    } catch (e) {
      res = { installed: false, evidence: [String(e && e.message ? e.message : e)] };
    }
    if (typeof res === 'boolean') res = { installed: res, evidence: [] };
    if (!res || typeof res !== 'object') res = { installed: false, evidence: [] };
    out[tool.id || tool.name || 'unknown'] = {
      installed: !!res.installed,
      evidence: Array.isArray(res.evidence) ? res.evidence : []
    };
  }
  return out;
}