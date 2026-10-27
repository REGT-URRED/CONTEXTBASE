import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { writeAtomic } from './fsutil.js';
import { findOnPath, readMcpConfig } from './detect.js';

function runCmd(cmd, timeout = 120000) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout });
    return { ok: true, output: String(out || '').trim() };
  } catch (e) {
    const err = (e && (e.stderr || e.message)) ? String(e.stderr || e.message).trim() : String(e);
    return { ok: false, error: err };
  }
}

function scanMcpFor(term) {
  const evidence = [];
  const clis = ['opencode', 'claude', 'kilo', 'cursor', 'windsurf', 'gemini'];
  for (const cli of clis) {
    const cfg = readMcpConfig(cli);
    if (!cfg) continue;
    let text = '';
    try { text = JSON.stringify(cfg).toLowerCase(); } catch { text = ''; }
    if (text.includes(String(term).toLowerCase())) evidence.push(`${cli} MCP config contains "${term}"`);
  }
  return evidence;
}

function detectBinary(names) {
  for (const n of names) {
    if (findOnPath(n)) return { found: true, name: n };
  }
  return { found: false, name: null };
}

const ALL_CLIS = ['opencode', 'claude', 'claude-code', 'kilo', 'cursor', 'windsurf', 'gemini', 'others', '*'];

const REGISTRY = [
  {
    id: 'gentle-ai',
    name: 'gentle-ai',
    description: 'Base tooling for agent environment (gentle-ai).',
    cliSupport: [...ALL_CLIS],
    dangerous: true,
    detect: async () => {
      const evidence = [];
      let installed = false;
      const bin = detectBinary(['gentle-ai', 'gentleai']);
      if (bin.found) { installed = true; evidence.push(`binary on PATH: ${bin.name}`); }
      const mcp = scanMcpFor('gentle-ai');
      if (mcp.length) { installed = true; evidence.push(...mcp); }
      const mcp2 = scanMcpFor('gentle_ai');
      if (mcp2.length) { installed = true; evidence.push(...mcp2); }
      return { installed, evidence };
    },
    install: async () => {
      const r = await runCmd('npm install -g gentle-ai');
      if (r.ok) return { ok: true, output: r.output };
      return { ok: false, error: r.error };
    },
    verify: async () => {
      // re-run detect via registry lookup avoided; inline
      const evidence = [];
      let installed = false;
      if (findOnPath('gentle-ai') || findOnPath('gentleai')) { installed = true; evidence.push('binary on PATH'); }
      const mcp = scanMcpFor('gentle-ai');
      if (mcp.length) { installed = true; evidence.push(...mcp); }
      return installed ? { ok: true, evidence } : { ok: false, error: 'gentle-ai not detected after install', evidence };
    }
  },
  {
    id: 'superpowers',
    name: 'superpowers',
    description: 'Superpowers skill/tooling for agents.',
    cliSupport: [...ALL_CLIS],
    dangerous: true,
    detect: async () => {
      const evidence = [];
      let installed = false;
      const bin = detectBinary(['superpowers']);
      if (bin.found) { installed = true; evidence.push(`binary on PATH: ${bin.name}`); }
      const mcp = scanMcpFor('superpowers');
      if (mcp.length) { installed = true; evidence.push(...mcp); }
      return { installed, evidence };
    },
    install: async () => {
      const r = await runCmd('npm install -g superpowers');
      if (r.ok) return { ok: true, output: r.output };
      return { ok: false, error: r.error };
    },
    verify: async () => {
      const installed = findOnPath('superpowers') || scanMcpFor('superpowers').length > 0;
      return installed ? { ok: true, evidence: ['detected'] } : { ok: false, error: 'superpowers not detected after install' };
    }
  },
  {
    id: 'oh-my-openclaude',
    name: 'oh-my-openclaude',
    description: 'oh-my-openclaude (Claude Code only).',
    cliSupport: ['claude', 'claude-code'],
    dangerous: true,
    detect: async () => {
      const evidence = [];
      let installed = false;
      const bin = detectBinary(['oh-my-openclaude', 'ohmyopenclaude']);
      if (bin.found) { installed = true; evidence.push(`binary on PATH: ${bin.name}`); }
      const mcp = scanMcpFor('oh-my-openclaude');
      if (mcp.length) { installed = true; evidence.push(...mcp); }
      const mcp2 = scanMcpFor('oh_my_openclaude');
      if (mcp2.length) { installed = true; evidence.push(...mcp2); }
      return { installed, evidence };
    },
    install: async () => {
      const r = await runCmd('npm install -g oh-my-openclaude');
      if (r.ok) return { ok: true, output: r.output };
      return { ok: false, error: r.error };
    },
    verify: async () => {
      const installed = findOnPath('oh-my-openclaude') || findOnPath('ohmyopenclaude') || scanMcpFor('oh-my-openclaude').length > 0;
      return installed ? { ok: true, evidence: ['detected'] } : { ok: false, error: 'oh-my-openclaude not detected after install' };
    }
  }
];

export function getRegistry(cwd = process.cwd()) {
  let state = { tools: {} };
  try { state = loadToolsState(cwd); } catch {}
  const overrides = (state && state.tools) || {};
  return REGISTRY.map(t => {
    const ov = overrides[t.id];
    const enabled = (ov && typeof ov.enabled === 'boolean') ? ov.enabled : true;
    return { ...t, enabled };
  });
}

export function getTool(id, cwd = process.cwd()) {
  return getRegistry(cwd).find(t => t.id === id) || null;
}

export function loadToolsState(cwd) {
  const file = path.join(cwd, 'contextbase', 'tools.json');
  try {
    if (!fs.existsSync(file)) return { version: 1, tools: {} };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, tools: {} };
    if (!parsed.tools || typeof parsed.tools !== 'object') parsed.tools = {};
    return parsed;
  } catch {
    return { version: 1, tools: {} };
  }
}

export function saveToolsState(cwd, state) {
  const file = path.join(cwd, 'contextbase', 'tools.json');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify(state || { version: 1, tools: {} }, null, 2));
}

export function setEnabled(id, bool, cwd = process.cwd()) {
  const state = loadToolsState(cwd);
  if (!state.tools) state.tools = {};
  if (!state.tools[id]) state.tools[id] = {};
  state.tools[id].enabled = !!bool;
  saveToolsState(cwd, state);
  return state;
}