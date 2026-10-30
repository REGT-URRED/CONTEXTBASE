import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentInfo, buildLauncher, mintSessionId } from './swarm-agents.js';

const SWARM_DIR = 'contextbase/swarm';

function rel(cwd, abs) {
  return path.relative(cwd, abs).split(path.sep).join('/');
}

export function makeRunId(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `${day}-${randomUUID().slice(0, 4)}`;
}

function runDir(cwd, run) {
  return path.join(cwd, SWARM_DIR, run);
}

export function readState(cwd, run) {
  const file = path.join(runDir(cwd, run), 'state.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeState(cwd, state) {
  const dir = runDir(cwd, state.run);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\r\n', 'utf8');
}

export function listRuns(cwd) {
  const base = path.join(cwd, SWARM_DIR);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'state.json')))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export function latestRun(cwd) {
  return listRuns(cwd)[0] || null;
}

export function taskPacket({ run, worker, worktree, branch, task }) {
  return [
    `# Tarea del worker ${worker.id} (run ${run})`,
    '',
    '## Rol',
    'Sos un worker del enjambre. El orquestador principal te asigna esta tarea y espera un resultado verificable.',
    '',
    '## Alcance',
    `- Rama: \`${branch}\``,
    `- Worktree: \`${worktree}\``,
    '- Trabaja solo dentro de tu worktree. No toques main ni el arbol principal.',
    '- Commitea en tu rama con autor REGT-URRED <U19211826@utp.edu.pe>.',
    '',
    '## Tarea',
    task,
    '',
    '## Criterio de salida',
    `1. Escribi \`${worker.result}\` con: que hiciste, archivos tocados, como verificaste, y que quedo pendiente.`,
    `2. Escribi \`${worker.status}\` con {"state":"done"} o {"state":"blocked","reason":"..."} o {"state":"failed","reason":"..."}.`,
    '3. Si te bloqueas, escribi status.json igual y para. No reintentes el mismo fallo mas de dos veces.',
    '',
  ].join('\r\n');
}

export function defaultDeps(cwd) {
  return {
    exec(args, opts = {}) {
      return execFileSync('git', args, {
        cwd: opts.cwd || cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trimEnd();
    },
    spawn(launcherAbs, spawnCwd) {
      const child =
        process.platform === 'win32'
          ? nodeSpawn('cmd.exe', ['/c', 'start', '', launcherAbs], {
              cwd: spawnCwd,
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            })
          : nodeSpawn('sh', [launcherAbs], { cwd: spawnCwd, detached: true, stdio: 'ignore' });
      child.unref();
      return { pid: child.pid };
    },
    runAgent(args, opts = {}) {
      return execFileSync('opencode', args, {
        cwd: opts.cwd || cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
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
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {
        // proceso ya terminado
      }
    },
  };
}

export function startSwarm(options, deps) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const agent = options.agent || 'opencode';
  const info = agentInfo(agent);
  if (!info.supported) {
    throw new Error(`Agent "${info.name}" is not supported for swarm launch: ${info.reason}`);
  }
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Falta la tarea del enjambre (--task "...").');
  const count = Number(options.workers || 2);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('workers debe ser un entero entre 1 y 12.');
  }
  const base = options.base || 'HEAD';
  const ttlMinutes = Number(options.ttlMinutes || 10);
  const d = deps || defaultDeps(cwd);
  const run = options.run || makeRunId();

  const planned = [];
  for (let i = 1; i <= count; i += 1) {
    const id = `w${i}`;
    planned.push({
      id,
      branch: `swarm/${run}/${id}`,
      worktree: `.worktrees/swarm-${run}-${id}`,
      session: mintSessionId(run, id),
      scope: `${run}-${id}`,
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
  fs.mkdirSync(dir, { recursive: true });
  for (const w of planned) {
    const wDir = path.join(dir, w.id);
    fs.mkdirSync(wDir, { recursive: true });
    w.task = rel(cwd, path.join(wDir, 'task.md'));
    w.result = rel(cwd, path.join(wDir, 'result.md'));
    w.status = rel(cwd, path.join(wDir, 'status.json'));
    const launcherName = process.platform === 'win32' ? 'launch.cmd' : 'launch.sh';
    w.launcher = rel(cwd, path.join(wDir, launcherName));
    w.pid = null;
  }

  const state = {
    run,
    base,
    agent: info.name,
    createdAt: new Date().toISOString(),
    ttlMinutes,
    workers: planned,
  };

  for (const w of planned) {
    const wDir = path.join(dir, w.id);
    fs.writeFileSync(path.join(wDir, 'task.md'), taskPacket({ run, worker: w, worktree: w.worktree, branch: w.branch, task }), 'utf8');
    const launcherText = buildLauncher({
      agent: info.name,
      session: w.session,
      taskPath: path.join(cwd, w.task),
      outDir: path.dirname(path.join(cwd, w.task)),
    });
    fs.writeFileSync(path.join(cwd, w.launcher), launcherText, 'utf8');
  }

  writeState(cwd, state);

  for (const w of state.workers) {
    const spawned = d.spawn(path.join(cwd, w.launcher), path.join(cwd, w.worktree));
    if (spawned && spawned.pid) w.pid = spawned.pid;
  }
  writeState(cwd, state);

  return { run, workers: state.workers };
}

export function resolveRun(cwd, run) {
  const id = run || latestRun(cwd);
  if (!id) {
    throw new Error('No hay runs de swarm en este proyecto. Usa: contextbase swarm start --task "..."');
  }
  const state = readState(cwd, id);
  if (!state) throw new Error(`Run de swarm no encontrado: ${id}`);
  return state;
}

function readReport(cwd, worker) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, worker.status), 'utf8'));
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
    const resultAbs = path.join(root, w.result);
    const resultExists = fs.existsSync(resultAbs);
    const resultAt = resultExists ? fs.statSync(resultAbs).mtimeMs : 0;
    const wt = path.join(root, w.worktree);
    let lastCommitAt = 0;
    let changes = 0;
    try {
      lastCommitAt = (Number(d.exec(['log', '-1', '--format=%ct'], { cwd: wt })) || 0) * 1000;
    } catch {
      lastCommitAt = 0;
    }
    try {
      changes = d.exec(['status', '--porcelain'], { cwd: wt }).split('\r\n').filter(Boolean).length;
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
      session: w.session,
      branch: w.branch,
      worktree: w.worktree,
      state: finalState,
      stale: finalState === 'stale',
      changes,
      lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
      reported: reported ? reported.state : null,
      resultExists,
      pid: w.pid ?? null,
    };
  });

  return { run: state.run, agent: state.agent, ttlMinutes: state.ttlMinutes, workers };
}

export function swarmSend({ cwd, run, worker, message }, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  const text = String(message || '').trim();
  if (!text) throw new Error('Mensaje vacio: nada que enviar.');
  const targets =
    !worker || worker === 'all' ? state.workers : state.workers.filter((w) => w.id === worker);
  if (!targets.length) throw new Error(`Worker no encontrado: ${worker}`);

  const info = agentInfo(state.agent);
  const workers = [];
  for (const w of targets) {
    const wDir = path.join(root, w.task, '..');
    fs.mkdirSync(wDir, { recursive: true });
    fs.appendFileSync(path.join(wDir, 'inbox.md'), `- [${new Date().toISOString()}] ${text}\r\n`, 'utf8');
    let delivered = 'file';
    if (info.supported && typeof d.runAgent === 'function') {
      try {
        d.runAgent(['run', '--session', w.session, '--format', 'json', text], {
          cwd: path.join(root, w.worktree),
        });
        delivered = 'native';
      } catch {
        delivered = 'file';
      }
    }
    workers.push({ id: w.id, delivered });
  }

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
    const resultAbs = path.join(root, w.result);
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
      branch: w.branch,
      state: exists ? 'done' : 'pending',
      merge,
      result: content.slice(0, 4000),
    };
  });

  return { run: state.run, base: state.base, workers };
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
  return { run: state.run, stopped };
}
