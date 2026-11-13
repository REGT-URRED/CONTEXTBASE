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
import { arbitrateWeb, PHILOSOPHY, webFlow, webMetrics, weaveWeb } from './web.js';
import {
  configureUniversalBridges,
  listUniversalAgents,
  registerCustomAgent,
} from './universal-agents.js';
import {
  compileHumanIntent,
  runAutopilotCycle,
  verifyAgentObedience,
} from './control.js';
import { fileURLToPath } from 'node:url';
import { applySandbox, listSandboxes, removeSandbox, runInSandbox } from './sandbox.js';

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

  if (command === 'swarm' || command === 'web' || command === 'telarana' || command === 'telaraña') {
    return runSwarmCommand(args, cwd);
  }

  if (command === 'control' || command === 'govern') {
    return runControlCommand(args, cwd);
  }

  if (command === 'sandbox') {
    return runSandboxCommand(args, cwd);
  }

  if (command === 'doctor') {
    // Verificacion con evidencia de la instalacion GLOBAL (config, plugin, esquema,
    // skills y handshake MCP real). Exit 1 si alguna comprobacion de error falla.
    const { runDoctor } = await import('./doctor.js');
    const json = args.includes('--json');
    const fix = args.includes('--fix');
    const res = await runDoctor(cwd, { json, fix });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log('\nDiagnostico de ContextBase\n');
      for (const c of res.checks) {
        const marca = c.ok ? 'OK  ' : (c.severity === 'error' ? 'FALLA' : 'AVISO');
        console.log('  [' + marca + '] ' + c.id.padEnd(24) + ' ' + c.detail);
      }
      const s = res.summary || {};
      console.log('\nResumen: ' + (s.passed || 0) + '/' + (s.total || 0) + ' ok, ' + (s.failed || 0) + ' fallo(s), ' + (s.warnings || 0) + ' aviso(s) en ' + res.durationMs + ' ms');
      if (res.fix && res.fix.attempted) console.log('Reparaciones aplicadas: ' + res.fix.actions.join(', '));
    }
    if (!res.ok) process.exitCode = 1;
    return true;
  }

  if (command === 'verify') {
    // Verificacion probabilistica del Arbitro sobre Happy Path y Unhappy Path:
    // la puerta falla si hay un falso PASS o un falso FAIL.
    const { simulateArbitration } = await import('./simulate.js');
    const roundsArg = args.find((a) => a.startsWith('--rounds'));
    let rounds;
    if (roundsArg) {
      const valor = roundsArg.includes('=') ? roundsArg.split('=')[1] : args[args.indexOf(roundsArg) + 1];
      const n = Number(valor);
      if (Number.isFinite(n) && n > 0) rounds = Math.floor(n);
    }
    const json = args.includes('--json');
    const res = await simulateArbitration(rounds ? { rounds } : {});
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log('\nVerificacion probabilistica del Arbitro (Happy / Unhappy Path)\n');
      console.log('  ' + 'Escenario'.padEnd(30) + 'Tipo'.padEnd(10) + 'PASS'.padStart(6) + 'REFIX'.padStart(7) + 'RERUN'.padStart(7) + 'FAIL'.padStart(6) + '  passRate  intentos');
      for (const sc of res.scenarios) {
        const o = sc.outcomes || {};
        console.log('  ' + String(sc.id).padEnd(30) + String(sc.kind).padEnd(10) +
          String(o.PASS || 0).padStart(6) + String(o.REFIX || 0).padStart(7) +
          String(o.RERUN || 0).padStart(7) + String(o.FAIL || 0).padStart(6) +
          '  ' + String(sc.passRate).padEnd(9) + String(sc.meanAttempts));
      }
      const a = res.aggregate;
      console.log('\n  Agregado: PASS ' + a.passRate + ' | REFIX ' + a.refixRate + ' | RERUN ' + a.rerunRate + ' | FAIL ' + a.failRate);
      console.log('  Intentos medios: ' + a.expectedAttempts + ' | Falso PASS: ' + a.falsePassRate + ' | Falso FAIL: ' + a.falseFailRate);
      console.log('  Paralelo: ' + res.parallel.workers + ' workers, ' + res.parallel.throughputRoundsPerSec + ' rondas/s, ' + res.durationMs + ' ms');
      if (res.gate.ok) console.log('\n  PUERTA: OK (0 falsos PASS, 0 falsos FAIL)');
      else console.log('\n  PUERTA: FALLA\n  - ' + res.gate.violations.join('\n  - '));
    }
    if (!res.gate.ok) process.exitCode = 1;
    return true;
  }

  if (command === 'agents') {
    return runAgentsCommand(args, cwd);
  }

  if (command === 'egm') {
    const sub = args[1] && !args[1].startsWith('--') ? args[1] : '';
    const isJson = args.includes('--json');
    const flags = parseFlags(args.slice(1));
    // Sin subcomando (o con --help) es un error de uso: no se ejecuta una revision condenada.
    if (!sub) {
      const helpFlag = args.slice(1).some(a => a === '--help' || a === '-h');
      if (helpFlag) console.log(usEgmHelp());
      else console.error(usEgmHelp());
      process.exitCode = 2;
      return true;
    }
    const egm = await import('./egm.js');
    if (sub === 'personas') {
      if (isJson) { console.log(JSON.stringify(egm.EGM_PERSONAS, null, 2)); return true; }
      console.log(c.bold + 'Personas del modelo EGM:' + c.reset);
      for (const p of egm.EGM_PERSONAS) console.log('  - ' + p.id + ' | ' + p.mision);
      return true;
    }
    if (sub === 'standards') {
      if (isJson) { console.log(JSON.stringify(egm.EGM_ESTANDARES, null, 2)); return true; }
      console.log(c.bold + 'Estandares del modelo EGM:' + c.reset);
      for (const s of egm.EGM_ESTANDARES) {
        console.log('  - ' + s.id + ': ' + s.nombre);
        for (const r of s.reglas) console.log('      * ' + r);
      }
      return true;
    }
    if (sub === 'skills') {
      if (isJson) { console.log(JSON.stringify(egm.EGM_SKILLS, null, 2)); return true; }
      console.log(c.bold + 'Skills del modelo EGM:' + c.reset);
      for (const s of egm.EGM_SKILLS) console.log('  - ' + s.id + ': ' + s.proposito);
      return true;
    }
    if (sub === 'drift') {
      const res = await egm.egmDrift({ cwd, docsDir: typeof flags.docs === 'string' ? flags.docs : undefined });
      if (isJson) { console.log(JSON.stringify(res, null, 2)); return true; }
      console.log(res.message || ('Drift detectado: ' + res.drift.length));
      for (const d of res.drift || []) {
        const scope = d.ref || d.tech || '(sin referencia)';
        console.log('  - [' + d.kind + '] ' + d.doc + ' -> ' + scope + ': ' + d.detail);
      }
      if (res.drift && res.drift.length) process.exitCode = 1;
      return true;
    }
    if (sub === 'review') {
      const targetArg = typeof flags.target === 'string' ? flags.target : '';
      const baseArg = typeof flags.base === 'string' ? flags.base : '';
      const res = await egm.egmReview({ cwd, target: targetArg || undefined, base: baseArg || undefined });
      if (isJson) { console.log(JSON.stringify(res, null, 2)); }
      else { console.log(res.report || ''); }
      if (res.verdict !== 'PASS') process.exitCode = 1;
      return true;
    }
    console.error(c.red + 'Error: subcomando de egm no reconocido: ' + sub + c.reset + '\n' + usEgmHelp());
    process.exitCode = 2;
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
      for (const d of r.drifts) {
        try {
          const content = fs.readFileSync(path.join(cwd, d.file), 'utf8');
          console.log('\n' + c.cyan + '=== ' + d.file + ' ===' + c.reset + '\n' + content);
        } catch {}
      }
    }
    if (checkFlag && r.drifts.length > 0) process.exitCode = 1;
    return true;
  }

  if (command === 'snapshot') {
    const sub = args[1];
    const noteArg = (args.find(a => a.startsWith('--note=')) || '').replace('--note=', '');
    if (sub === 'list') {
      const items = snapshot.list(cwd);
      if (args.includes('--json')) { console.log(JSON.stringify(items, null, 2)); return true; }
      if (!items.length) { console.log('(sin snapshots)'); return true; }
      for (const it of items) console.log(it.id + (it.note ? ' - ' + it.note : ''));
      return true;
    }
    if (sub === 'restore') {
      const id = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
      const r = await snapshot.restore(cwd, id);
      if (!r.ok) { console.log(c.red + 'Error:' + c.reset + ' ' + r.error); process.exitCode = 1; return true; }
      console.log(c.green + 'Restaurados:' + c.reset + ' ' + (r.restored.join(', ') || '(ninguno)'));
      return true;
    }
    if (sub === 'create' || sub === undefined || sub.startsWith('--')) {
      const id = await snapshot.create(cwd, noteArg);
      console.log(c.green + 'Snapshot creado:' + c.reset + ' ' + id);
      return true;
    }
    console.error(c.red + 'Error: subcomando de snapshot no soportado: ' + sub + ' (usa: snapshot | snapshot list | snapshot restore <id>)' + c.reset);
    process.exitCode = 2;
    return true;
  }

  if (command === 'restore') {
    const id = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
    const r = await snapshot.restore(cwd, id);
    if (!r.ok) { console.log(c.red + 'Error:' + c.reset + ' ' + r.error); process.exitCode = 1; return true; }
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
      if (!name || name.startsWith('--')) { console.error(c.yellow + 'Uso: contextbase tools ' + sub + ' <nombre>' + c.reset); process.exitCode = 2; return true; }
      setEnabled(name, sub === 'enable', cwd);
      console.log(c.green + 'OK:' + c.reset + ' ' + name + ' ' + (sub === 'enable' ? 'habilitado' : 'deshabilitado'));
      return true;
    }
    console.error(c.yellow + 'Uso: contextbase tools list|enable <name>|disable <name>' + c.reset);
    process.exitCode = 2;
    return true;
  }

  if (command === 'terminals') {
    const sub = args[1] || 'list';
    const json = args.includes('--json');
    const terms = await import('./terminals.js');
    if (sub === 'list') {
      const items = terms.listTerminals(cwd);
      if (json) { console.log(JSON.stringify(items, null, 2)); return true; }
      if (!items.length) { console.log('No se identificaron terminales de agente en ejecucion en este equipo.'); return true; }
      console.log(c.bold + 'PID     AGENTE         SCOPE      PROTEGIDO  SESION        COMANDO' + c.reset);
      for (const t of items) {
        const line = [String(t.pid).padEnd(7), String(t.agent).padEnd(14), String(t.scope).padEnd(10), (t.protected ? 'si' : 'no').padEnd(10), String(t.sessionId || '-').padEnd(13), String(t.commandLine || '').slice(0, 60)].join(' ');
        console.log((t.protected ? c.gray : t.scope === 'project' ? c.green : c.dim) + line + c.reset);
      }
      return true;
    }
    if (sub === 'close') {
      const rest = args.slice(2).filter(a => !a.startsWith('--'));
      const yes = args.includes('--yes');
      const force = args.includes('--force');
      const targets = args.includes('--all') ? ['all'] : rest;
      if (!targets.length) { console.error('Uso: contextbase terminals close <pid...|all> [--all] [--yes] [--force]'); process.exitCode = 2; return true; }
      const res = terms.closeTerminals(targets, { yes, force, cwd });
      if (res.dryRun) {
        console.log('DRY-RUN: no se cerro nada. Objetivos identificados:');
        for (const t of res.targets) {
          console.log('  - pid ' + t.pid + (t.agent ? ' (' + t.agent + ', ' + t.scope + (t.protected ? ', protegido' : '') + ')' : ' ERROR: ' + t.error));
        }
        console.log('Ejecuta de nuevo con --yes para cerrar.');
        return true;
      }
      for (const r of res.results) console.log((r.ok ? 'OK' : 'FAIL') + ' pid ' + r.pid + (r.agent ? ' (' + r.agent + ')' : '') + (r.reason ? ' - ' + r.reason : ''));
      if (!res.ok) process.exitCode = 1;
      return true;
    }
    if (sub === 'auto') {
      const includeStale = args.includes('--include-stale');
      const dryRun = !args.includes('--yes');
      const res = await terms.autoCloseFinished(cwd, { includeStale, dryRun });
      if (json) { console.log(JSON.stringify(res, null, 2)); return true; }
      if (!res.candidates.length) { console.log(c.dim + (res.reason || 'sin terminales de agente terminadas para cerrar') + c.reset); return true; }
      console.log(c.bold + 'Terminales de agente con trabajo terminado:' + c.reset);
      for (const t of res.candidates) console.log('  - pid ' + t.pid + ' (' + t.agent + ', worker ' + t.worker + ')');
      if (dryRun) { console.log(c.yellow + 'DRY-RUN: no se cerro nada. Repite con --yes para cerrar.' + c.reset); return true; }
      for (const r of res.closed) console.log(c.green + '\u2713 cerrada pid ' + r.pid + ' (' + r.agent + ', worker ' + r.worker + ')' + c.reset);
      for (const s of res.skipped) console.log(c.yellow + '- worker ' + s.worker + ': ' + s.reason + c.reset);
      return true;
    }
    if (sub === 'send') {
      const pid = args[2];
      const msgFlag = args.find(a => a.startsWith('--message='));
      const message = msgFlag ? msgFlag.replace('--message=', '') : args.slice(3).filter(a => !a.startsWith('--')).join(' ');
      const pidNum = Number(pid);
      if (!pid || !Number.isInteger(pidNum) || pidNum <= 0) { console.error('Uso: contextbase terminals send <pid> --message "..."'); process.exitCode = 2; return true; }
      try {
        const r = terms.sendToTerminal(pidNum, message, { cwd });
        if (json) { console.log(JSON.stringify(r, null, 2)); return true; }
        console.log((r.ok ? 'OK' : 'FAIL') + ' pid ' + r.pid + ' (' + r.sessionId + ')' + (r.tail ? '\n' + r.tail : ''));
        if (!r.ok) process.exitCode = 1;
      } catch (err) {
        console.error('Error: ' + err.message);
        process.exitCode = 1;
      }
      return true;
    }
    console.error('Uso: contextbase terminals [list|close <pid...|all> [--yes] [--force]|send <pid> --message "..."]');
    process.exitCode = 2;
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

export async function runSandboxCommand(args, cwd) {
  cwd = cwd || process.cwd();

  if (args.length < 2) {
    console.error(usSandboxHelp());
    process.exitCode = 2;
    return true;
  }
  if (args[1] === 'help' || args[1] === '--help' || args[1] === '-h') {
    console.log(usSandboxHelp());
    return true;
  }

  const sub = args[1];
  const json = args.includes('--json');

  if (sub === 'run') {
    // Las flags propias se pueden escribir en cualquier posicion; tras `--` todo es del comando hijo.
    const own = [];
    const child = [];
    const rest = args.slice(2);
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--') { child.push(...rest.slice(i + 1)); break; }
      if (token === '--json') { own.push(token); continue; }
      if (token === '--timeout' || token === '--label') { own.push(token, rest[++i]); continue; }
      if (token.startsWith('--timeout=') || token.startsWith('--label=')) { own.push(token); continue; }
      child.push(token);
    }
    const command = child[0] || '';
    const childArgs = child.slice(1);
    const flags = parseFlags(own);
    const timeoutMs = flags.timeout === undefined ? undefined : Number(flags.timeout);
    if (!command || (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))) {
      console.error(usSandboxHelp());
      process.exitCode = 2;
      return true;
    }
    const res = await runInSandbox(cwd, command, childArgs, {
      label: typeof flags.label === 'string' ? flags.label : '',
      timeoutMs,
    });
    return reportSandboxRun(res, command, childArgs, json);
  }

  if (sub === 'list') {
    const items = listSandboxes(cwd);
    if (json) { console.log(JSON.stringify(items, null, 2)); return true; }
    if (!items.length) { console.log('(sin sandboxes)'); return true; }
    for (const it of items) {
      const corrupt = it.corrupt ? c.yellow + ' [meta corrupta]' + c.reset : '';
      console.log(it.id + corrupt + (it.label ? ' - ' + it.label : '') + ' | cambios: ' + it.changedFilesCount + (it.command ? ' | ' + it.command : ''));
    }
    return true;
  }

  if (sub === 'apply') {
    const id = args[2] && !args[2].startsWith('--') ? args[2] : '';
    if (!id) {
      console.error('Uso: contextbase sandbox apply <id> [--files <a,b,c>] [--json]');
      process.exitCode = 2;
      return true;
    }
    const flags = parseFlags(args.slice(2));
    const files = typeof flags.files === 'string' ? flags.files.split(',').map((f) => f.trim()).filter(Boolean) : null;
    const res = applySandbox(cwd, id, { files });
    if (json) {
      console.log(JSON.stringify({ id, ...res }, null, 2));
    } else {
      if (res.error) console.log(c.red + 'Error:' + c.reset + ' ' + res.error);
      console.log(c.green + 'Aplicados:' + c.reset + ' ' + (res.applied.join(', ') || '(ninguno)'));
      console.log(c.yellow + 'Omitidos (borrados o ausentes):' + c.reset + ' ' + (res.skipped.join(', ') || '(ninguno)'));
      if (res.rejected.length) console.log(c.red + 'Rechazados (fuera del proyecto):' + c.reset + ' ' + res.rejected.join(', '));
    }
    if (res.error || res.rejected.length) process.exitCode = 1;
    return true;
  }

  if (sub === 'rm' || sub === 'remove') {
    const id = args[2] && !args[2].startsWith('--') ? args[2] : '';
    if (!id) {
      console.error('Uso: contextbase sandbox rm <id> [--json]');
      process.exitCode = 2;
      return true;
    }
    const res = removeSandbox(cwd, id);
    if (json) console.log(JSON.stringify({ id, ...res }, null, 2));
    else console.log(res.removed ? c.green + 'Sandbox eliminado:' + c.reset + ' ' + id : c.yellow + 'Sandbox no encontrado:' + c.reset + ' ' + id);
    if (!res.removed) process.exitCode = 1;
    return true;
  }

  if (sub === 'auto' || sub === 'init') {
    const flags = parseFlags(args.slice(2));
    const timeoutMs = flags.timeout === undefined ? undefined : Number(flags.timeout);
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      console.error('Uso: contextbase sandbox ' + sub + ' [--timeout <ms>] [--label <texto>] [--json]');
      process.exitCode = 2;
      return true;
    }
    const entry = fileURLToPath(new URL('../bin/contextbase.js', import.meta.url));
    const res = await runInSandbox(cwd, process.execPath, [entry, sub], {
      label: typeof flags.label === 'string' ? flags.label : 'contingencia: ' + sub,
      timeoutMs,
      // Home aislado: la configuracion global se escribe dentro del sandbox, nunca en el equipo.
      env: (sandboxPath) => ({
        HOME: path.join(sandboxPath, '.home'),
        USERPROFILE: path.join(sandboxPath, '.home'),
      }),
    });
    if (json) {
      console.log(JSON.stringify({ subcommand: sub, ...res }, null, 2));
    } else {
      console.log(c.bold + 'Plan de contingencia: contextbase ' + sub + ' sobre una copia aislada' + c.reset);
      console.log('  Sandbox: ' + res.id + ' ' + c.dim + res.path + c.reset);
      console.log('  Codigo de salida: ' + (res.exitCode === null ? 'n/a' : res.exitCode) + (res.timedOut ? c.yellow + ' (timeout)' + c.reset : ''));
      console.log('  El proyecto real no fue modificado. Cambios propuestos (' + res.changedFiles.length + '):');
      for (const f of res.changedFiles) console.log('    - ' + f);
      if (res.stderr.trim()) console.log(c.gray + res.stderr.trimEnd() + c.reset);
      console.log(c.dim + '  Promover con: contextbase sandbox apply ' + res.id + c.reset);
    }
    if (res.exitCode !== 0 || res.timedOut) process.exitCode = 1;
    return true;
  }

  console.error(c.red + 'Subcomando de sandbox no reconocido: ' + sub + c.reset + '\n' + usSandboxHelp());
  process.exitCode = 2;
  return true;
}

function reportSandboxRun(res, command, childArgs, json) {
  if (json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(c.bold + 'Sandbox:' + c.reset + ' ' + res.id + ' ' + c.dim + res.path + c.reset);
    console.log('Comando: ' + command + (childArgs.length ? ' ' + childArgs.join(' ') : ''));
    console.log('Codigo de salida: ' + (res.exitCode === null ? 'n/a' : res.exitCode) + (res.timedOut ? c.yellow + ' (timeout)' + c.reset : ''));
    console.log('Cambios detectados (' + res.changedFiles.length + '):');
    for (const f of res.changedFiles) console.log('  - ' + f);
    if (res.error) console.log(c.red + 'Error:' + c.reset + ' ' + res.error);
    if (res.stdout.trim()) console.log('\n' + c.gray + '--- stdout ---' + c.reset + '\n' + res.stdout.trimEnd());
    if (res.stderr.trim()) console.log('\n' + c.gray + '--- stderr ---' + c.reset + '\n' + res.stderr.trimEnd());
  }
  if (res.error || res.timedOut || res.exitCode !== 0) process.exitCode = 1;
  return true;
}

function usEgmHelp() {
  return [
    'Uso: contextbase egm <subcomando> [opciones]',
    '',
    '  review  [--target <archivo>] [--base <ref>] [--json]',
    '      Revision Elephant-Goldfish del archivo indicado (por defecto, el directorio actual).',
    '  drift   [--docs <dir>] [--json]',
    '      Deriva doc-codigo: referencias citadas en los docs que no existen en el proyecto.',
    '  personas | standards | skills [--json]',
    '      Catalogo del modelo EGM (personas revisoras, estandares y skills).',
  ].join('\n');
}

function usSandboxHelp() {
  return [
    'Uso: contextbase sandbox <subcomando> [opciones]',
    '',
    '  run <comando> [args...] [--json] [--timeout <ms>] [--label <texto>]',
    '      Ejecuta un comando sobre una copia aislada del proyecto y reporta los cambios.',
    '      Usa -- antes de las flags que pertenecen al comando hijo.',
    '  list [--json]',
    '      Lista los sandboxes existentes (mas nuevos primero).',
    '  apply <id> [--files <a,b,c>] [--json]',
    '      Promueve al proyecto real solo los archivos cambiados (nunca borrados).',
    '  rm <id> [--json]',
    '      Elimina el sandbox.',
    '  auto | init [--timeout <ms>] [--label <texto>] [--json]',
    '      Plan de contingencia: corre "contextbase auto|init" aislado y reporta el diff sin tocar el proyecto.',
  ].join('\n');
}

export function runControlCommand(args, cwd) {
  cwd = cwd || process.cwd();
  const sub = args[1] && !args[1].startsWith('--') ? args[1] : 'status';
  const flags = parseFlags(args.slice(1));
  const json = Boolean(flags.json);

  if (sub === 'compile') {
    const intent = flags.intent || flags.prey || flags.task || args.slice(2).filter(a => !a.startsWith('--')).join(' ');
    const contract = compileHumanIntent(cwd, intent, { spiders: flags.spiders || flags.workers || 3 });
    if (json) {
      console.log(JSON.stringify(contract, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Contrato Determinista compilado bajo "' + PHILOSOPHY + '"' + c.reset);
    console.log('  Ahorro de tokens proyectado: ' + contract.cognitiveGovernance.tokenSavingsPct + '% (' + contract.cognitiveGovernance.leverageFactor + 'x)');
    console.log('  Hilos disjuntos generados: ' + contract.fileBoundaries.threads.length);
    console.log('  Guardado en: contextbase/control/intent-contract.json y contextbase/control/control.md');
    return true;
  }

  if (sub === 'autopilot') {
    const res = runAutopilotCycle(cwd, { autoConfig: Boolean(flags.all), run: flags.run });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Ciclo de Autopiloto Soberano ejecutado (' + res.obedience.verdict + ' — ' + res.obedience.sovereigntyScore + '/100)' + c.reset);
    return true;
  }

  const report = verifyAgentObedience(cwd, { run: flags.run });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return true;
  }
  console.log(c.bold + 'Gobernanza Soberana :: "' + report.philosophy + '"' + c.reset);
  console.log('  Índice de Control Soberano: ' + c.cyan + report.sovereigntyScore + '/100' + c.reset + ' [' + report.verdict + ']');
  console.log('  Agentes universales soportados: ' + report.supportedAgentsCount);
  for (const ch of report.checks) {
    const icon = ch.status === 'PASS' ? c.green + '\u2713' : ch.status === 'WARN' ? c.yellow + '\u26A0' : c.red + '\u2717';
    console.log(`  ${icon}${c.reset} ${ch.gate}: ${ch.points}/25 ${ch.detail ? `(${ch.detail})` : ''}`);
  }
  return true;
}

export function runAgentsCommand(args, cwd) {
  cwd = cwd || process.cwd();
  const sub = args[1] && !args[1].startsWith('--') ? args[1] : 'list';
  const flags = parseFlags(args.slice(1));
  const json = Boolean(flags.json);

  if (sub === 'register') {
    const id = flags.name || flags.id || args[2];
    const registered = registerCustomAgent(cwd, {
      id,
      displayName: flags.display || id,
      binary: flags.binary || id,
      commandTemplate: flags.cmd || flags.template,
    });
    if (json) {
      console.log(JSON.stringify(registered, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Agente personalizado registrado en contextbase/agents.json: ' + registered.id + c.reset);
    console.log('  Plantilla de comando: ' + registered.commandTemplate);
    return true;
  }

  if (sub === 'configure') {
    const written = configureUniversalBridges(cwd, { includeAll: true, universal: true });
    if (json) {
      console.log(JSON.stringify({ configured: written }, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Adaptadores universales generados (' + written.length + ' archivos): ' + written.join(', ') + c.reset);
    return true;
  }

  const list = listUniversalAgents(cwd);
  if (json) {
    console.log(JSON.stringify(list, null, 2));
    return true;
  }
  console.log(c.bold + 'Catálogo Universal de Agentes de Código (' + list.length + ' agentes soportados):' + c.reset);
  for (const a of list) {
    const mode = a.nativeSwarmVerified ? c.green + 'nativo+universal' + c.reset : c.cyan + 'universal (--universal)' + c.reset;
    console.log(`  - ${c.bold}${a.id.padEnd(10)}${c.reset} (${a.displayName.padEnd(24)}) [${mode}] -> ${c.dim}${a.commandTemplate}${c.reset}`);
  }
  return true;
}

export function runSwarmCommand(args, cwd) {
  cwd = cwd || process.cwd();
  const sub = args[1] || 'status';
  const flags = parseFlags(args.slice(2));
  const json = Boolean(flags.json);

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(usSwarmHelp());
    return true;
  }

  if (sub === 'start') {
    const preyOrTask = flags.prey || flags.task || '';
    const spidersOrWorkers = flags.spiders ?? flags.workers;
    const out = startSwarm({
      cwd,
      base: flags.base,
      agent: flags.agent,
      universal: Boolean(flags.universal),
      agentCmd: flags['agent-cmd'] || flags.cmd,
      workers: spidersOrWorkers,
      spiders: spidersOrWorkers,
      task: preyOrTask,
      prey: preyOrTask,
      ttlMinutes: flags.ttl,
    });
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.green + '\u2713 Telaraña / Swarm ' + out.run + ' iniciada con ' + out.workers.length + ' Arañas (workers) en ' + out.agent + '.' + c.reset);
    console.log(c.cyan + '  Filosofía: "' + PHILOSOPHY + '"' + c.reset);
    if (out.tokenEconomy) {
      console.log(c.magenta + '  Economía de Tokens: ahorro estimado del ' + out.tokenEconomy.savingsPct + '% (' + out.tokenEconomy.savedTokens + ' tokens ahorrados).' + c.reset);
    }
    console.log(c.dim + 'Las sesiones y subagentes secuenciales (subagents.json) ya existen en cada worktree.' + c.reset + '\n');
    printWorkers(out.workers.map((w) => ({ ...w, changes: 0, state: 'lanzado' })));
    return true;
  }

  if (sub === 'arbitrate' || sub === 'judge') {
    let out;
    try {
      out = arbitrateWeb({
        cwd,
        run: flags.run,
        autoFix: flags['no-fix'] ? false : true,
        maxRetries: flags.retries ? Number(flags.retries) : 2,
      });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const empty = Boolean(err && err.code === 'NO_RUNS');
      if (json) console.log(JSON.stringify(empty ? { empty: true, message: msg } : { error: msg }));
      else console.log(c.dim + msg + c.reset);
      if (!empty) process.exitCode = 1;
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.bold + 'Árbitro Automático :: Run ' + out.run + ' [' + out.flowState + ']' + c.reset);
    console.log(c.dim + 'Filosofía: "' + out.philosophy + '" | Ahorro tokens: ' + out.tokenEconomy.savingsPct + '%' + c.reset + '\n');
    console.log(c.bold + 'id   veredicto  puntaje  merge     slop  intentos  acción' + c.reset);
    for (const s of out.spiders) {
      const vColor =
        s.verdict === 'PASS' ? c.green : s.verdict === 'FAIL' ? c.red : c.yellow;
      console.log(
        String(s.id).padEnd(5) +
        (vColor + String(s.verdict).padEnd(11) + c.reset) +
        String(s.score + '/100').padEnd(9) +
        String(s.merge).padEnd(10) +
        String(s.slopFindings).padEnd(6) +
        String(s.retries + '/2').padEnd(10) +
        String(s.actionTaken)
      );
    }
    return true;
  }

  if (sub === 'flow') {
    let out;
    try {
      out = webFlow({ cwd, run: flags.run, arbitrate: Boolean(flags.arbitrate) });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const empty = Boolean(err && err.code === 'NO_RUNS');
      if (json) console.log(JSON.stringify(empty ? { empty: true, message: msg } : { error: msg }));
      else console.log(c.dim + msg + c.reset);
      if (!empty) process.exitCode = 1;
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(out.markdown);
    return true;
  }

  if (sub === 'metrics') {
    let out;
    try {
      out = webMetrics({ cwd, run: flags.run });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const empty = Boolean(err && err.code === 'NO_RUNS');
      if (json) console.log(JSON.stringify(empty ? { empty: true, message: msg } : { error: msg }));
      else console.log(c.dim + msg + c.reset);
      if (!empty) process.exitCode = 1;
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.bold + 'Métricas de Zona de Flujo y Economía de Tokens (' + out.run + ')' + c.reset);
    console.log('  Estado de Flujo: ' + out.flowState);
    console.log('  Telaraña Intacta: ' + (out.webIntact ? 'Sí (0 colisiones)' : 'No'));
    console.log('  Ahorro de Tokens: ' + out.tokenEconomy.savingsPct + '% (' + out.tokenEconomy.savedTokens + ' tokens ahorrados)');
    console.log('  Factor Multiplicador: ' + out.tokenEconomy.leverageFactor + 'x');
    return true;
  }

  if (sub === 'weave' || sub === 'tejer') {
    let out;
    try {
      out = weaveWeb({ cwd, run: flags.run, merge: Boolean(flags.merge) });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const empty = Boolean(err && err.code === 'NO_RUNS');
      if (json) console.log(JSON.stringify(empty ? { empty: true, message: msg } : { error: msg }));
      else console.log(c.dim + msg + c.reset);
      if (!empty) process.exitCode = 1;
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(
      (out.ok ? c.green + '\u2713 Telaraña lista y verificada: ' : c.yellow + '\u26A0 Telaraña en progreso: ') +
      'Run ' + out.run + ' (' + out.flowState + ')' + c.reset
    );
    console.log('  Hilos en PASS: ' + (out.passed.join(', ') || '(ninguno)'));
    if (out.wovenBranches.length) {
      console.log('  Ramas tejidas en base: ' + out.wovenBranches.join(', '));
    }
    return true;
  }

  if (sub === 'status') {
    let out;
    try {
      if (flags.arbitrate) {
        arbitrateWeb({ cwd, run: flags.run });
      }
      out = swarmStatus({ cwd, run: flags.run });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const empty = Boolean(err && err.code === 'NO_RUNS');
      if (json) console.log(JSON.stringify(empty ? { empty: true, message: msg } : { error: msg }));
      else console.log(c.dim + msg + c.reset);
      if (!empty) process.exitCode = 1;
      return true;
    }
    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return true;
    }
    console.log(c.bold + 'Run ' + out.run + ' (' + out.agent + ', ttl ' + out.ttlMinutes + ' min, flujo ' + (out.flowState || 'EN_ZONA') + ')' + c.reset);
    printWorkers(out.workers);
    const stale = out.workers.filter((w) => w.stale);
    if (stale.length) {
      console.log('\n' + c.yellow + stale.length + ' worker(s) en stale: sin commits ni resultado dentro del ttl.' + c.reset);
    }
    return true;
  }

  if (sub === 'send') {
    const positional = args.slice(2).filter((a) => !a.startsWith('--'));
    const worker = flags.spider || flags.worker || positional[0] || 'all';
    const message = flags.message || positional.slice(1).join(' ');
    const out = swarmSend({ cwd, run: flags.run, worker, message });
    console.log(c.green + '\u2713 Enviado (' + out.delivered + ') a ' + out.workers.map((w) => w.id).join(', ') + c.reset);
    if (out.delivered === 'file') {
      console.log(c.dim + 'Entrega solo por archivo: el agente no acepta inyeccion en sesion viva.' + c.reset);
    }
    return true;
  }

  if (sub === 'collect') {
    if (flags.arbitrate) {
      try { arbitrateWeb({ cwd, run: flags.run }); } catch {}
    }
    const out = swarmCollect({ cwd, run: flags.run });
    try {
      import('./terminals.js')
        .then(t => t.autoCloseFinished(cwd))
        .then(closed => {
          if (closed.closed && closed.closed.length && !json) {
            console.log(c.green + '\u2713 Terminales de agente cerradas automaticamente: ' + closed.closed.map(x => x.pid).join(', ') + c.reset);
          }
        })
        .catch(() => {});
    } catch {}
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

  console.log(c.red + 'Subcomando de web/swarm no reconocido: ' + sub + c.reset + '\n');
  console.log(usSwarmHelp());
  process.exitCode = 2;
  return true;
}

function usSwarmHelp() {
  return [
    'Uso: contextbase <web|telarana|swarm> <subcomando> [flags]',
    '',
    '  start      --prey "..." [--spiders 3] [--agent <nombre>] [--universal] [--agent-cmd "..."] [--base main] [--ttl 10]',
    '  arbitrate  [--run <id>] [--no-fix] [--retries 2] [--json]  (Árbitro Automático: PASS / REFIX / RERUN / FAIL)',
    '  flow       [--run <id>] [--arbitrate] [--json]             (Tablero de Zona de Flujo y flow.md)',
    '  metrics    [--run <id>] [--json]                           (Economía de Tokens y métricas de cumplimiento)',
    '  weave      [--run <id>] [--merge] [--json]                 (Verifica que los hilos no se rompan entre sí)',
    '  status     [--run <id>] [--arbitrate] [--json]',
    '  send       [--worker w1|all] --message "..." [--run <id>]',
    '  collect    [--run <id>] [--arbitrate] [--json]',
    '  stop       [--run <id>]',
    '',
    'Filosofía: "' + PHILOSOPHY + '"',
    'Cada Araña recibe: worktree propio con memoria pre-hidratada, hilo disjunto, rama swarm/<run>/<id>,',
    '3 subagentes secuenciales (subagents.json) y arbitraje automático sobre 100 puntos.',
    'Usa --universal o "contextbase agents register" para lanzar cualquier agente de código del mercado.',
    'Agentes sin contrato nativo de sesion verificado (usar --universal): ' + Object.keys({ claude: 1, codex: 1 }).map((n) => n + ' (' + agentInfo(n).reason + ')').join(', '),
  ].join('\n');
}
