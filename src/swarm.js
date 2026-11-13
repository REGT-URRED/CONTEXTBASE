import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentInfo, buildLauncher, mintSessionId } from './swarm-agents.js';
import { realAgentsAllowed } from './env.js';
import { cbError, writeAtomic } from './fsutil.js';
import { isValidId, requireId, resolveInside } from './sandbox.js';
import {
  PHILOSOPHY,
  buildSequentialSubagents,
  calculateTokenEconomy,
  decomposePrey,
  hydrateWorktreeMemory,
  syncRunMirror,
  writeFlowAndMetrics,
} from './web.js';

const SWARM_DIR = 'contextbase/swarm';
const WEB_DIR = 'contextbase/web';

// Campos de un worker que se usan como rutas del filesystem.
const WORKER_PATH_FIELDS = ['task', 'result', 'status', 'subagents', 'refix', 'launcher', 'worktree'];

// Tiempos de espera de los subprocesos. Sin limite, un agente colgado bloquea el event loop
// y `node --test` nunca termina (ver src/env.js para el guard de entorno de pruebas).
const AGENT_TIMEOUT_MS = Number(process.env.CONTEXTBASE_AGENT_TIMEOUT_MS || 120000);
const GIT_TIMEOUT_MS = Number(process.env.CONTEXTBASE_GIT_TIMEOUT_MS || 30000);

function rel(cwd, abs) {
  return path.relative(cwd, abs).split(path.sep).join('/');
}

export function makeRunId(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `${day}-${randomUUID().slice(0, 4)}`;
}

function runDir(cwd, run) {
  const base = path.join(path.resolve(cwd), SWARM_DIR);
  return resolveInside(base, requireId(run, 'runDir', 'id de run'), { op: 'runDir', what: 'id de run' });
}

function webRunDir(cwd, run) {
  const base = path.join(path.resolve(cwd), WEB_DIR);
  return resolveInside(base, requireId(run, 'webRunDir', 'id de run'), { op: 'webRunDir', what: 'id de run' });
}

/**
 * Ruta absoluta y contenida de un campo de worker (result, status, worktree, ...).
 * Un estado manipulado que apunte fuera del proyecto lanza CB_PATH_ESCAPE.
 */
export function workerPath(root, worker, field) {
  const value = worker ? worker[field] : undefined;
  if (typeof value !== 'string' || value === '') {
    throw cbError(
      'CB_STATE_SCHEMA',
      `workerPath.${field}`,
      String(worker && worker.id),
      `el worker no tiene "${field}" como ruta valida; el estado esta corrupto. Recuperacion: relanza el run con "contextbase web start --prey \\"...\\"."`
    );
  }
  return resolveInside(path.resolve(root), value, { op: `workerPath.${worker.id || '?'}.${field}`, what: `ruta "${field}" del worker` });
}

/**
 * Valida el esquema del estado de un run antes de confiar en el.
 * Lanza CB_STATE_SCHEMA / CB_PATH_ESCAPE con la ruta del archivo y una accion de recuperacion.
 */
export function validateState(root, state, file, op = 'readState') {
  const fail = (detail) => cbError('CB_STATE_SCHEMA', op, file, detail);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw fail('el estado debe ser un objeto JSON con "run", "base" y "workers". Recuperacion: relanza el run con "contextbase web start --prey \\"...\\".');
  }
  if (!isValidId(state.run)) {
    throw fail(`falta "run" o no es un id valido (recibido: ${JSON.stringify(state.run)}). Recuperacion: elimina el directorio del run y relanza "contextbase web start --prey \\"...\\".`);
  }
  if (typeof state.base !== 'string' || state.base.trim() === '') {
    throw fail('falta "base" (rama o commit base del run). Recuperacion: restaura el state.json desde un backup o relanza el run.');
  }
  if (!Array.isArray(state.workers)) {
    throw fail('"workers" debe ser un array de arañas. Recuperacion: restaura el state.json desde un backup o relanza el run.');
  }
  for (const w of state.workers) {
    if (!w || typeof w !== 'object') throw fail('cada entrada de "workers" debe ser un objeto.');
    if (!isValidId(w.id)) {
      throw fail(`worker con "id" invalido (${JSON.stringify(w.id)}). Recuperacion: restaura el state.json desde un backup o relanza el run.`);
    }
    for (const field of WORKER_PATH_FIELDS) {
      const value = w[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' || value === '') {
        throw fail(`"workers[${w.id}].${field}" debe ser una ruta relativa no vacia.`);
      }
      try {
        resolveInside(root, value, { op: `state.workers.${w.id}.${field}`, what: `ruta "${field}"` });
      } catch (err) {
        throw cbError(
          'CB_PATH_ESCAPE',
          `state.workers.${w.id}.${field}`,
          path.resolve(root, value),
          `el estado apunta fuera del proyecto en "${field}"; el state.json esta manipulado o corrupto. Recuperacion: restaura el state.json desde un backup o relanza el run.`
        );
      }
    }
  }
  return state;
}

function loadStateFile(root, file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw cbError(
      'CB_STATE_CORRUPT',
      'readState',
      file,
      `no se pudo leer el estado (${err && err.message ? err.message : err}); verifica permisos o relanza el run con "contextbase web start --prey \\"...\\"."`
    );
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    // El mensaje crudo del parser ("Unexpected token ...") nunca sale al usuario.
    throw cbError(
      'CB_STATE_CORRUPT',
      'readState',
      file,
      'el state.json no es JSON valido. Recuperacion: restaura el archivo desde contextbase/snapshot (contextbase snapshot restore <id>) o elimina el directorio del run y relanza "contextbase web start --prey \\"...\\".'
    );
  }
  return validateState(root, state, file);
}

export function readState(cwd, run) {
  const root = path.resolve(cwd);
  const id = requireId(run, 'readState', 'id de run');
  const fileSwarm = path.join(runDir(root, id), 'state.json');
  if (fs.existsSync(fileSwarm)) return loadStateFile(root, fileSwarm);
  const fileWeb = path.join(webRunDir(root, id), 'state.json');
  if (fs.existsSync(fileWeb)) return loadStateFile(root, fileWeb);
  return null;
}

export function writeState(cwd, state) {
  const root = path.resolve(cwd);
  const id = requireId(state && state.run, 'writeState', 'id de run');
  const payload = JSON.stringify(state, null, 2) + '\r\n';
  for (const dir of [runDir(root, id), webRunDir(root, id)]) {
    validateState(root, state, path.join(dir, 'state.json'), 'writeState');
    fs.mkdirSync(dir, { recursive: true });
    // Un unico temporal + rename por archivo: nunca queda un state.json a medio escribir.
    writeAtomic(path.join(dir, 'state.json'), payload);
  }
}

export function listRuns(cwd) {
  const found = new Set();
  for (const baseRel of [SWARM_DIR, WEB_DIR]) {
    const base = path.join(path.resolve(cwd), baseRel);
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!isValidId(e.name)) continue;
      if (e.isDirectory() && fs.existsSync(path.join(base, e.name, 'state.json'))) {
        found.add(e.name);
      }
    }
  }
  return Array.from(found).sort().reverse();
}

export function latestRun(cwd) {
  return listRuns(cwd)[0] || null;
}

export function taskPacket({ run, worker, worktree, branch, task }) {
  const assignedList =
    Array.isArray(worker.assignedFiles) && worker.assignedFiles.length > 0
      ? worker.assignedFiles.slice(0, 20).map((f) => `  - \`${f}\``).join('\r\n')
      : '  - (Archivos dentro de tu dominio asignado en el worktree)';
  const forbiddenNote =
    Array.isArray(worker.forbiddenFiles) && worker.forbiddenFiles.length > 0
      ? `- Archivos reservados a otras Arañas (NO TOCAR para no romper la telaraña): ${worker.forbiddenFiles.slice(0, 12).map((f) => `\`${f}\``).join(', ')}`
      : '- Mantén tus cambios estrictamente acotados a tu hilo para evitar conflictos de merge.';

  return [
    `# Tarea de la Araña ${worker.id} (${worker.spiderName || worker.id} — run ${run})`,
    '',
    `> **Filosofía:** *"${PHILOSOPHY}"*`,
    '',
    '## Rol en la Telaraña',
    `Sos una Araña (${worker.role || 'Hilo Especializado'}) de la Red de Agentes de ContextBase. Trabajas en paralelo sobre tu propio hilo aislado sin romper los hilos de las demás Arañas.`,
    '',
    '## Alcance y Aislamiento de Hilo (Worktree)',
    `- Rama: \`${branch}\``,
    `- Worktree: \`${worktree}\``,
    '- Memoria pre-hidratada: `contextbase/` ya está disponible en tu worktree (no re-escanees todo el proyecto desde cero).',
    '- Trabaja solo dentro de tu worktree. No toques `main` ni el árbol principal.',
    forbiddenNote,
    '- Commitea en tu rama con autor REGT-URRED <U19211826@utp.edu.pe>.',
    '',
    '## Archivos Asignados a tu Hilo de Seda',
    assignedList,
    '',
    '## La Presa (Tarea y Segmento Asignado)',
    task,
    worker.preySegment && worker.preySegment !== task ? `\r\n### Enfoque de tu Hilo\r\n${worker.preySegment}` : '',
    '',
    '## Cadena Estricta de 3 Subagentes Secuenciales (Prohibido Anidar Subagentes)',
    `Lee \`${worker.subagents || 'subagents.json'}\` y ejecuta en orden estricto dentro de esta misma terminal:`,
    '1. **Explorador de Hilo (25% presupuesto):** Lee solo `contextbase/` y tus archivos asignados.',
    '2. **Constructor Focalizado (50% presupuesto):** Implementa los cambios únicamente en los archivos de tu hilo.',
    '3. **Verificador y Árbitro Local (25% presupuesto):** Valida pruebas, confirma 0 hallazgos en `slop`, haz commit y genera los archivos de salida.',
    '',
    '## Criterio de Salida para el Árbitro Automático (PASS / REFIX / RERUN / FAIL)',
    `1. Escribí \`${worker.result}\` con: qué hiciste, archivos tocados, cómo verificaste y qué quedó pendiente.`,
    `2. Escribí \`${worker.status}\` con {"state":"done"} o {"state":"blocked","reason":"..."} o {"state":"failed","reason":"..."}.`,
    `3. Si el Árbitro Automático escribe \`${worker.refix || 'refix.md'}\`, corregí exactamente los puntos listados. No reintentes el mismo fallo más de dos veces.`,
    '',
  ]
    .filter((line) => line !== '')
    .join('\r\n');
}

/**
 * Elimina el arbol de procesos hijo de un proceso ya terminado.
 *
 * En Windows, `execFileSync` con `shell:true` crea un `cmd.exe` que a su vez lanza el
 * binario real (por ejemplo opencode.exe). Si matamos solo el padre, el nieto queda
 * huerfano y mantiene bloqueados los archivos del proyecto. Este helper localiza a los
 * descendientes por ParentProcessId y los termina.
 */
export function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    } catch {
      // el proceso ya no existe: se reintenta el barrido por PPID
    }
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='SilentlyContinue'; $ids=@(${pid}); for($i=0;$i -lt 5;$i++){` +
            `$kids=Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId;` +
            `if(-not $kids){break}; $ids=$kids; foreach($k in $ids){ Stop-Process -Id $k -Force -ErrorAction SilentlyContinue } }`,
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 20000 }
      );
    } catch {
      // barrido best-effort: si falla no se propaga el error
    }
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // proceso ya terminado
  }
}

/**
 * Ejecuta un binario con limite de tiempo y limpieza del arbol de procesos.
 * Si se agota el tiempo lanza un error controlado (nunca deja el evento loop colgado).
 *
 * Se usa spawnSync (y no execFileSync) porque solo spawnSync expone el pid del proceso
 * intermedio, necesario para matar tambien a sus descendientes (cmd.exe -> opencode.exe).
 */
export function runAgentProcess(bin, args, opts = {}) {
  const timeout = Number(opts.timeout || AGENT_TIMEOUT_MS);
  const started = Date.now();
  const res = spawnSync(bin, args, {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: opts.shell !== undefined ? opts.shell : process.platform === 'win32',
    timeout,
    killSignal: 'SIGTERM',
  });

  if (res.error) {
    if (res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM') {
      // El proceso intermedio ya fue terminado por el timeout: sus descendientes siguen vivos.
      killProcessTree(res.pid);
      const e = new Error(
        `Timeout de ${timeout} ms al ejecutar "${bin}" (tras ${Date.now() - started} ms). Proceso abortado.`
      );
      e.code = 'ETIMEDOUT';
      e.timeout = timeout;
      throw e;
    }
    throw res.error;
  }

  if (res.status !== 0) {
    const e = new Error(`"${bin}" termino con codigo ${res.status}.`);
    e.code = 'AGENT_FAILED';
    e.status = res.status;
    e.stderr = res.stderr;
    throw e;
  }

  return res.stdout;
}

export function defaultDeps(cwd) {
  return {
    exec(args, opts = {}) {
      return execFileSync('git', args, {
        cwd: opts.cwd || cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGTERM',
      }).trimEnd();
    },
    spawn(launcherAbs, spawnCwd) {
      if (!realAgentsAllowed()) {
        // Guard de entorno: el launcher abriria una sesion real de agente (cmd.exe start -> opencode.exe)
        // y dejaria procesos huerfanos que bloquean el borrado del directorio del proyecto.
        return { pid: null };
      }
      const child =
        process.platform === 'win32'
          ? nodeSpawn('cmd.exe', ['/c', 'start', '', launcherAbs], {
              cwd: spawnCwd,
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            })
          : nodeSpawn('sh', [launcherAbs], { cwd: spawnCwd, detached: true, stdio: 'ignore' });
      // Sin listener de 'error' un spawn fallido (ENOENT/EINVAL) abortaba el proceso padre.
      child.on('error', () => {});
      child.unref();
      return { pid: child.pid };
    },
    runAgent(args, opts = {}) {
      const bin = opts.binary || 'opencode';
      if (!realAgentsAllowed()) {
        // Guard de entorno: en `node --test` no se lanzan sesiones reales de agente.
        // swarmSend captura este error y degrada a entrega por archivo (inbox.md).
        const e = new Error(`Ejecucion de agente "${bin}" deshabilitada en entorno de pruebas.`);
        e.code = 'AGENT_DISABLED_IN_TEST_ENV';
        throw e;
      }
      return runAgentProcess(bin, args, {
        cwd: opts.cwd || cwd,
        timeout: opts.timeout || AGENT_TIMEOUT_MS,
      });
    },
    alive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    kill(pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {
        // proceso ya terminado: nada que detener
      }
    },
  };
}

export function startSwarm(options = {}, deps) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const agent = options.agent || 'opencode';
  const universal = Boolean(options.universal || options.agentCmd);
  const info = agentInfo(agent, { universal, agentCmd: options.agentCmd, cwd });
  if (!info.supported) {
    throw new Error(`Agent "${info.name}" is not supported for swarm launch: ${info.reason}`);
  }
  const task = String(options.prey ?? options.task ?? '').trim();
  if (!task) throw new Error('Falta la tarea o presa del enjambre (--task "..." o --prey "...").');
  const count = Number(options.spiders ?? options.workers ?? 2);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('workers/spiders debe ser un entero entre 1 y 12.');
  }
  const base = options.base || 'HEAD';
  const ttlMinutes = Number(options.ttlMinutes || 10);
  const d = deps || defaultDeps(cwd);
  const run = options.run || makeRunId();

  const decomposition = decomposePrey(cwd, task, count);

  const planned = [];
  for (let i = 1; i <= count; i += 1) {
    const id = `w${i}`;
    const thread = decomposition.threads[i - 1] || {
      spiderName: `araña-${i}`,
      role: 'Hilo de Ejecución',
      preySegment: task,
      assignedFiles: [],
      forbiddenFiles: [],
    };
    planned.push({
      id,
      spiderName: thread.spiderName,
      role: thread.role,
      preySegment: thread.preySegment,
      assignedFiles: thread.assignedFiles,
      forbiddenFiles: thread.forbiddenFiles,
      branch: `swarm/${run}/${id}`,
      worktree: `.worktrees/swarm-${run}-${id}`,
      session: mintSessionId(run, id),
      scope: `${run}-${id}`,
      retries: 0,
      verdict: 'PENDING',
    });
  }

  const created = [];
  try {
    for (const w of planned) {
      d.exec(['worktree', 'add', w.worktree, '-b', w.branch, base]);
      created.push(w.worktree);
    }
  } catch (err) {
    for (const wt of created) {
      try {
        d.exec(['worktree', 'remove', '--force', wt]);
      } catch {
        // el worktree ya no existe: nada que limpiar
      }
    }
    throw err;
  }

  const dir = runDir(cwd, run);
  const wDirRoot = webRunDir(cwd, run);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(wDirRoot, { recursive: true });

  for (const w of planned) {
    const wDir = path.join(dir, w.id);
    const wWebDir = path.join(wDirRoot, w.id);
    fs.mkdirSync(wDir, { recursive: true });
    fs.mkdirSync(wWebDir, { recursive: true });
    w.task = rel(cwd, path.join(wDir, 'task.md'));
    w.result = rel(cwd, path.join(wDir, 'result.md'));
    w.status = rel(cwd, path.join(wDir, 'status.json'));
    w.subagents = rel(cwd, path.join(wDir, 'subagents.json'));
    w.refix = rel(cwd, path.join(wDir, 'refix.md'));
    const launcherName = process.platform === 'win32' ? 'launch.cmd' : 'launch.sh';
    w.launcher = rel(cwd, path.join(wDir, launcherName));
    w.pid = null;
  }

  const tokenEconomy = calculateTokenEconomy(cwd, planned, task);

  const state = {
    run,
    philosophy: PHILOSOPHY,
    base,
    agent: info.name,
    universal: Boolean(info.universal),
    task,
    prey: task,
    spiders: count,
    flowState: 'EN_ZONA',
    createdAt: new Date().toISOString(),
    ttlMinutes,
    tokenEconomy,
    workers: planned,
  };

  for (const w of planned) {
    const wDir = path.join(dir, w.id);
    const subagentsSpec = buildSequentialSubagents({
      run,
      workerId: w.id,
      spiderName: w.spiderName,
      preySegment: w.preySegment,
      assignedFiles: w.assignedFiles,
    });
    const subagentsJson = JSON.stringify(subagentsSpec, null, 2) + '\r\n';
    const packetText = taskPacket({
      run,
      worker: w,
      worktree: w.worktree,
      branch: w.branch,
      task,
    });
    fs.writeFileSync(path.join(wDir, 'subagents.json'), subagentsJson, 'utf8');
    fs.writeFileSync(path.join(wDir, 'task.md'), packetText, 'utf8');

    const launcherText = buildLauncher({
      agent: info.name,
      session: w.session,
      taskPath: path.join(cwd, w.task),
      outDir: path.dirname(path.join(cwd, w.task)),
      subagentsPath: path.join(cwd, w.subagents),
      universal,
      agentCmd: options.agentCmd,
      cwd,
    });
    fs.writeFileSync(path.join(cwd, w.launcher), launcherText, 'utf8');
    try {
      if (process.platform !== 'win32') fs.chmodSync(path.join(cwd, w.launcher), 0o755);
    } catch {}

    // Pre-hidratar memoria y contexto de Araña en el worktree si existe en disco
    const wtAbs = path.join(cwd, w.worktree);
    if (fs.existsSync(wtAbs)) {
      hydrateWorktreeMemory(cwd, wtAbs, {
        run,
        spiderId: w.id,
        spiderName: w.spiderName,
        role: w.role,
        branch: w.branch,
        prey: task,
        preySegment: w.preySegment,
        assignedFiles: w.assignedFiles,
        forbiddenFiles: w.forbiddenFiles,
        taskPath: w.task,
        resultPath: w.result,
        statusPath: w.status,
        subagentsPath: w.subagents,
        refixPath: w.refix,
      });
    }
  }

  writeState(cwd, state);

  for (const w of state.workers) {
    const spawned = d.spawn(workerPath(cwd, w, 'launcher'), workerPath(cwd, w, 'worktree'));
    if (spawned && spawned.pid) w.pid = spawned.pid;
  }
  writeState(cwd, state);

  try {
    writeFlowAndMetrics(cwd, state, { economy: tokenEconomy });
  } catch {}
  syncRunMirror(cwd, run);

  return {
    run,
    philosophy: PHILOSOPHY,
    agent: info.name,
    universal: Boolean(info.universal),
    prey: task,
    flowState: state.flowState,
    tokenEconomy,
    workers: state.workers,
    spiders: state.workers,
  };
}

export function resolveRun(cwd, run) {
  const id = run || latestRun(cwd);
  if (!id) {
    throw Object.assign(new Error('No hay runs de swarm/web en este proyecto. Usa: contextbase web start --prey "..."'), { code: 'NO_RUNS' });
  }
  const state = readState(cwd, id);
  if (!state) throw new Error(`Run de swarm/web no encontrado: ${id}`);
  return state;
}

function readReport(cwd, worker) {
  try {
    return JSON.parse(fs.readFileSync(workerPath(cwd, worker, 'status'), 'utf8'));
  } catch {
    return null;
  }
}

export function swarmStatus({ cwd, run }, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  const now = Date.now();
  const ttl = Number(state.ttlMinutes || 10) * 60000;
  const started = Date.parse(state.createdAt) || now;

  const workers = state.workers.map((w) => {
    // Contencion: el estado puede venir manipulado; nunca se lee fuera del proyecto.
    const resultAbs = workerPath(root, w, 'result');
    const resultExists = fs.existsSync(resultAbs);
    const resultAt = resultExists ? fs.statSync(resultAbs).mtimeMs : 0;
    const wt = workerPath(root, w, 'worktree');
    let lastCommitAt = 0;
    let changes = 0;
    try {
      lastCommitAt = (Number(d.exec(['log', '-1', '--format=%ct'], { cwd: wt })) || 0) * 1000;
    } catch {
      lastCommitAt = 0;
    }
    try {
      changes = d
        .exec(['status', '--porcelain'], { cwd: wt })
        .split(/\r?\n/)
        .filter(Boolean).length;
    } catch {
      changes = 0;
    }
    const reported = readReport(root, w);
    const lastActivity = Math.max(lastCommitAt, resultAt, started);
    const recent = now - lastActivity < ttl;
    const derived = resultExists ? 'done' : recent ? 'running' : 'stale';
    const finalState = reported && reported.state ? reported.state : derived;
    return {
      id: w.id,
      spiderName: w.spiderName || w.id,
      role: w.role || null,
      session: w.session,
      branch: w.branch,
      worktree: w.worktree,
      state: finalState,
      stale: finalState === 'stale',
      changes,
      lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
      reported: reported ? reported.state : null,
      resultExists,
      verdict: w.verdict || null,
      retries: Number(w.retries || 0),
      pid: w.pid ?? null,
    };
  });

  return {
    run: state.run,
    prey: state.prey || state.task,
    flowState: state.flowState || 'EN_ZONA',
    agent: state.agent,
    ttlMinutes: state.ttlMinutes,
    workers,
    spiders: workers,
  };
}

export function swarmSend({ cwd, run, worker, message }, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  const text = String(message || '').trim();
  if (!text) throw new Error('Mensaje vacio: nada que enviar.');
  const targets =
    !worker || worker === 'all' ? state.workers : state.workers.filter((w) => w.id === worker || w.spiderName === worker);
  if (!targets.length) throw new Error(`Worker/Araña no encontrado: ${worker}`);

  const info = agentInfo(state.agent, { cwd: root });
  const workers = [];
  for (const w of targets) {
    const wDir = path.dirname(workerPath(root, w, 'task'));
    fs.mkdirSync(wDir, { recursive: true });
    fs.appendFileSync(path.join(wDir, 'inbox.md'), `- [${new Date().toISOString()}] ${text}\r\n`, 'utf8');
    let delivered = 'file';
    if (info.supported && !info.universal && typeof d.runAgent === 'function') {
      try {
        d.runAgent(['run', '--session', w.session, '--format', 'json', text], {
          cwd: workerPath(root, w, 'worktree'),
          binary: info.binary,
        });
        delivered = 'native';
      } catch {
        delivered = 'file';
      }
    }
    workers.push({ id: w.id, delivered });
  }

  syncRunMirror(root, state.run);
  return {
    run: state.run,
    delivered: workers.every((w) => w.delivered === 'native') ? 'native' : 'file',
    workers,
  };
}

export function swarmCollect({ cwd, run }, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);

  const workers = state.workers.map((w) => {
    const resultAbs = workerPath(root, w, 'result');
    const exists = fs.existsSync(resultAbs);
    const content = exists ? fs.readFileSync(resultAbs, 'utf8') : '';
    let merge = 'unknown';
    try {
      d.exec(['merge-tree', '--write-tree', '--name-only', state.base, w.branch], { cwd: root });
      merge = 'clean';
    } catch {
      merge = 'conflict';
    }
    return {
      id: w.id,
      spiderName: w.spiderName || w.id,
      branch: w.branch,
      state: exists ? 'done' : 'pending',
      verdict: w.verdict || null,
      merge,
      result: content.slice(0, 4000),
    };
  });

  syncRunMirror(root, state.run);
  return { run: state.run, base: state.base, prey: state.prey || state.task, workers, spiders: workers };
}

export function swarmStop({ cwd, run }, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  const stopped = [];

  for (const w of state.workers) {
    if (!w.pid) continue;
    try {
      if (d.alive(w.pid)) {
        d.kill(w.pid);
        stopped.push(w.id);
      }
    } catch {
      // el proceso ya no existe: nada que detener
    }
  }

  state.stoppedAt = new Date().toISOString();
  writeState(root, state);
  syncRunMirror(root, state.run);
  return { run: state.run, stopped };
}
