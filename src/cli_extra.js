import fs from 'node:fs';
import path from 'node:path';
import { detectCli } from './detect.js';
import { getRegistry, setEnabled } from './registry.js';
import { check as guardCheck, repair as guardRepair, REPAIR_ALLOWLIST } from './guard.js';
import * as snapshot from './snapshot.js';
import { recommend as bootstrapRecommend, preview as bootstrapPreview, run as bootstrapRun } from './bootstrap.js';
import { missionText } from './mission.js';
import { agentInfo } from './swarm-agents.js';
import { startSwarm, swarmCollect, swarmSend, swarmStatus, swarmStop } from './swarm.js';

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
    return runSwarmCommand(args, cwd);
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

function parseFlags(list) {
  const out = {};
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key.includes('=')) {
      const [k, ...rest] = key.split('=');
      out[k] = rest.join('=');
    } else if (list[i + 1] && !list[i + 1].startsWith('--')) {
      out[key] = list[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printWorkers(workers) {
  console.log(c.bold + 'id   estado     cambios  sesion                        rama' + c.reset);
  for (const w of workers) {
    const state = w.stale ? c.yellow + w.state + c.reset : w.state === 'done' ? c.green + w.state + c.reset : w.state;
    console.log(
      String(w.id).padEnd(5) + String(state).padEnd(18) + String(w.changes ?? '-').padEnd(9) +
      String(w.session).padEnd(31) + (w.branch || '')
    );
  }
}

export function runSwarmCommand(args, cwd) {
  cwd = cwd || process.cwd();
  const sub = args[1] || 'status';
  const flags = parseFlags(args.slice(2));
  const json = Boolean(flags.json);

  if (sub === 'help') {
    console.log(usSwarmHelp());
    return true;
  }

  if (sub === 'start') {
    const out = startSwarm({
      cwd,
      base: flags.base,
      agent: flags.agent,
      workers: flags.workers,
      task: flags.task,
      ttlMinutes: flags.ttl,
    });
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Swarm ' + out.run + ' iniciado con ' + out.workers.length + ' workers.' + c.reset);
    console.log(c.dim + 'Las sesiones ya existen: pasalas al orquestador. Ventanas abiertas en cada worktree.' + c.reset + '\n');
    printWorkers(out.workers.map((w) => ({ ...w, changes: 0, state: 'lanzado' })));
    return true;
  }

  if (sub === 'status') {
    let out;
    try {
      out = swarmStatus({ cwd, run: flags.run });
    } catch (err) {
      console.log(c.dim + err.message + c.reset);
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.bold + 'Run ' + out.run + ' (' + out.agent + ', ttl ' + out.ttlMinutes + ' min)' + c.reset);
    printWorkers(out.workers);
    const stale = out.workers.filter((w) => w.stale);
    if (stale.length) {
      console.log('\n' + c.yellow + stale.length + ' worker(s) en stale: sin commits ni resultado dentro del ttl.' + c.reset);
    }
    return true;
  }

  if (sub === 'send') {
    const positional = args.slice(2).filter((a) => !a.startsWith('--'));
    const worker = flags.worker || positional[0] || 'all';
    const message = flags.message || positional.slice(1).join(' ');
    const out = swarmSend({ cwd, run: flags.run, worker, message });
    console.log(c.green + '\u2713 Enviado (' + out.delivered + ') a ' + out.workers.map((w) => w.id).join(', ') + c.reset);
    if (out.delivered === 'file') {
      console.log(c.dim + 'Entrega solo por archivo: el agente no acepta inyeccion en sesion viva.' + c.reset);
    }
    return true;
  }

  if (sub === 'collect') {
    const out = swarmCollect({ cwd, run: flags.run });
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    for (const w of out.workers) {
      const badge = w.merge === 'clean' ? c.green + 'clean' + c.reset : c.red + w.merge + c.reset;
      console.log(c.bold + w.id + c.reset + ' [' + badge + '] ' + c.dim + w.branch + c.reset);
      console.log(w.result ? w.result.trim().split('\n').slice(0, 12).join('\n') : c.dim + '(sin result.md)' + c.reset);
      console.log('');
    }
    return true;
  }

  if (sub === 'stop') {
    const out = swarmStop({ cwd, run: flags.run });
    console.log(
      out.stopped.length
        ? c.green + '\u2713 Detenidos: ' + out.stopped.join(', ') + c.reset
        : c.dim + 'Nada que detener: ningun worker sigue vivo.' + c.reset
    );
    return true;
  }

  console.log(c.red + 'Subcomando de swarm no reconocido: ' + sub + c.reset + '\n');
  console.log(usSwarmHelp());
  return true;
}

function usSwarmHelp() {
  return [
    'Uso: contextbase swarm <subcomando> [flags]',
    '',
    '  start     --task \"...\" [--workers 2] [--agent opencode] [--base main] [--ttl 10]',
    '  status    [--run <id>] [--json]',
    '  send      [--worker w1|all] --message \"...\" [--run <id>]',
    '  collect   [--run <id>] [--json]',
    '  stop      [--run <id>]',
    '',
    'Cada worker recibe: worktree propio, rama swarm/<run>/<id>, sesion ses_cb_<run>_<id>.',
    'El canal real es archivo: task.md de entrada, result.md y status.json de salida.',
    'Agentes sin contrato de sesion verificado: ' + Object.keys({ claude: 1, codex: 1 }).map((n) => n + ' (' + agentInfo(n).reason + ')').join(', '),
  ].join('\n');
}
