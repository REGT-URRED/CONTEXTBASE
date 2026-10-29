import fs from 'node:fs';
import path from 'node:path';
import { detectCli } from './detect.js';
import { getRegistry, setEnabled } from './registry.js';
import { check as guardCheck, repair as guardRepair, REPAIR_ALLOWLIST } from './guard.js';
import * as snapshot from './snapshot.js';
import { recommend as bootstrapRecommend, preview as bootstrapPreview, run as bootstrapRun } from './bootstrap.js';
import { missionText } from './mission.js';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m',
  blue: '\x1b[34m', gray: '\x1b[90m'
};

export async function runExtra(command, args, cwd) {
  cwd = cwd || process.cwd();
  if (command === 'mission') {
    console.log(missionText());
    return true;
  }

  if (command === 'swarm') {
    console.log('Swarm (Strands): interface stub, not implemented (ready=false).');
    console.log('Use git worktrees + subagents for parallel work; contextbase tracks memory/bitacora only.');
    return true;
  }
  if (command === 'bootstrap') {
    const cliArg = (args.find(a => a.startsWith('--cli=')) || '').replace('--cli=', '') || 'auto';
    const toolsArg = (args.find(a => a.startsWith('--tools=')) || '').replace('--tools=', '');
    const yes = args.includes('--yes');
    const autoConfirmRest = args.includes('--auto-confirm-rest');
    const cliName = (cliArg === 'auto' || !cliArg) ? (detectCli().primary || 'OpenCode') : cliArg;
    const selected = toolsArg ? toolsArg.split(',').map(x => x.trim()).filter(Boolean) : bootstrapRecommend(cliName);
    console.log(c.bold + 'Preview de bootstrap (' + cliName + '):' + c.reset);
    const pv = await bootstrapPreview(cwd, cliName, selected);
    for (const m of pv.main) console.log('  - ' + m);
    if (pv.dangerous.length) {
      console.log(c.yellow + 'Acciones peligrosas:' + c.reset);
      for (const d of pv.dangerous) console.log('  ! ' + d);
    }
    const res = await bootstrapRun(cwd, { cli: cliName, tools: selected, yes, autoConfirmRest });
    console.log(c.green + 'Instalados:' + c.reset + ' ' + (res.installed.join(', ') || '(ninguno)'));
    console.log(c.gray + 'Omitidos:' + c.reset + ' ' + (res.skipped.join(', ') || '(ninguno)'));
    console.log('Init ejecutado: ' + (res.initRan ? 'si' : 'no') + ' | Snapshot: ' + (res.snapshotId || 'n/a'));
    return true;
  }

  if (command === 'guard') {
    const json = args.includes('--json');
    const checkFlag = args.includes('--check');
    const repairFlag = args.includes('--repair');
    const show = args.includes('--show');
    const r = guardCheck(cwd);
    if (json) { console.log(JSON.stringify(r, null, 2)); }
    else {
      console.log(c.bold + 'Guardia de archivos base:' + c.reset + ' ' + r.status);
      for (const d of r.drifts) console.log('  - ' + d.file + ': ' + d.kind + ' (' + d.reason + ')');
      if (r.drifts.length === 0) console.log('  ' + c.green + 'Sin deriva.' + c.reset);
    }
    if (repairFlag && r.drifts.length) {
      for (const d of r.drifts) {
        if (REPAIR_ALLOWLIST[d.file]) {
          const rr = await guardRepair(cwd, d.file);
          console.log(rr.ok ? c.green + 'Reparado:' + c.reset + ' ' + d.file : c.red + 'Error reparando ' + d.file + ':' + c.reset + ' ' + rr.error);
        } else {
          console.log(c.yellow + 'Sin fuente oficial para:' + c.reset + ' ' + d.file);
        }
      }
    }
    if (show && r.drifts.length) {
      const fsMod = await import('node:fs');
      const pathMod = await import('node:path');
      for (const d of r.drifts) {
        try {
          const content = fsMod.readFileSync(pathMod.join(cwd, d.file), 'utf8');
          console.log('\n' + c.cyan + '=== ' + d.file + ' ===' + c.reset + '\n' + content);
        } catch {}
      }
    }
    if (checkFlag && r.drifts.length > 0) process.exitCode = 1;
    return true;
  }

  if (command === 'snapshot') {
    const noteArg = (args.find(a => a.startsWith('--note=')) || '').replace('--note=', '');
    const id = await snapshot.create(cwd, noteArg);
    console.log(c.green + 'Snapshot creado:' + c.reset + ' ' + id);
    return true;
  }

  if (command === 'restore') {
    const id = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
    const r = await snapshot.restore(cwd, id);
    if (!r.ok) { console.log(c.red + 'Error:' + c.reset + ' ' + r.error); return true; }
    console.log(c.green + 'Restaurados:' + c.reset + ' ' + (r.restored.join(', ') || '(ninguno)'));
    return true;
  }

  if (command === 'tools') {
    const sub = args[1] || 'list';
    if (sub === 'list') {
      const reg = getRegistry(cwd);
      for (const t of reg) console.log(t.id + ' - ' + (t.enabled ? 'enabled' : 'disabled') + ' (' + t.cliSupport.join(',') + ')');
      return true;
    }
    if (sub === 'enable' || sub === 'disable') {
      const name = args[2];
      if (!name) { console.log(c.yellow + 'Uso: contextbase tools ' + sub + ' <nombre>' + c.reset); return true; }
      setEnabled(name, sub === 'enable', cwd);
      console.log(c.green + 'OK:' + c.reset + ' ' + name + ' ' + (sub === 'enable' ? 'habilitado' : 'deshabilitado'));
      return true;
    }
    console.log(c.yellow + 'Uso: contextbase tools list|enable <name>|disable <name>' + c.reset);
    return true;
  }

  return false;
}
