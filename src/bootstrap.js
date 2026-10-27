import fs from 'node:fs';
import path from 'node:path';
import { detectCli, detectTools } from './detect.js';
import { getRegistry, getTool, loadToolsState } from './registry.js';
import { baseline } from './guard.js';
import * as snapshot from './snapshot.js';

export function recommend(cli) {
  const c = String(cli || '').toLowerCase();
  const ids = ['gentle-ai', 'superpowers'];
  if (c.includes('claude')) ids.push('oh-my-openclaude');
  return ids;
}

export async function preview(cwd, cli, selected) {
  const tools = Array.isArray(selected) ? selected : recommend(cli);
  const reg = getRegistry(cwd);
  const byId = Object.fromEntries(reg.map(t => [t.id, t]));
  const main = [];
  const dangerous = [];
  const contextMissing = !fs.existsSync(path.join(cwd, 'contextbase'));
  if (contextMissing) main.push('Run contextbase init (contextbase/ missing).');
  for (const id of tools) {
    const tool = byId[id] || getTool(id, cwd);
    let installed = false;
    let evidence = [];
    try {
      if (tool && typeof tool.detect === 'function') {
        const d = await tool.detect();
        installed = !!d.installed;
        evidence = Array.isArray(d.evidence) ? d.evidence : [];
      }
    } catch {}
    if (installed) {
      main.push(`Skip ${id} (already installed${evidence.length ? ': ' + evidence.join(', ') : ''}).`);
    } else {
      main.push(`Install missing: ${id}.`);
      dangerous.push(`Install ${id} globally (npm install -g ${id}).`);
    }
  }
  const snap = 'Create baseline snapshot of guarded files.';
  main.push(snap);
  return { main, dangerous };
}

export async function run(cwd, opts = {}) {
  const options = opts || {};
  const cli = options.cli || (detectCli().primary || 'OpenCode');
  const selected = Array.isArray(options.tools) && options.tools.length ? options.tools : recommend(cli);
  const yes = !!options.yes;
  const autoConfirm = !!options.autoConfirmRest;

  const installed = [];
  const skipped = [];
  const allowedToInstall = yes || autoConfirm;

  for (const id of selected) {
    const tool = getTool(id, cwd);
    if (!tool) { skipped.push(id); continue; }
    let isInstalled = false;
    try {
      const d = await tool.detect();
      isInstalled = !!d.installed;
    } catch { isInstalled = false; }

    if (isInstalled) {
      skipped.push(id);
      continue;
    }
    if (!allowedToInstall) {
      skipped.push(id);
      continue;
    }
    try {
      const r = await tool.install();
      if (r && r.ok) installed.push(id);
      else skipped.push(id);
    } catch {
      skipped.push(id);
    }
  }

  let initRan = false;
  const contextDir = path.join(cwd, 'contextbase');
  if (!fs.existsSync(contextDir)) {
    try {
      const cliMod = await import('./cli.js');
      if (cliMod && typeof cliMod.runInit === 'function') {
        await cliMod.runInit(cwd, { force: false });
        initRan = true;
      }
    } catch {
      try { fs.mkdirSync(contextDir, { recursive: true }); initRan = true; } catch {}
    }
  }

  try { baseline(cwd); } catch {}

  let snapshotId = null;
  try {
    snapshotId = await snapshot.create(cwd, 'bootstrap');
  } catch {}

  return { installed, skipped, initRan, snapshotId };
}