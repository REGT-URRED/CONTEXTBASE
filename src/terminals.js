import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Control de terminales/agentes abiertos del proyecto.
 *
 * Identifica procesos de agentes de código en ejecución en este equipo,
 * marca cuáles pertenecen al proyecto actual y permite cerrarlos o enviarles
 * trabajo por su contrato nativo (opencode run --session).
 *
 * Reglas de seguridad:
 * - `terminals` (list) es de SOLO LECTURA.
 * - `terminals close` es DRY-RUN por defecto; exige --yes para actuar.
 * - Nunca se cierra el proceso actual ni sus ancestros.
 * - Solo se cierran procesos identificados como agentes conocidos.
 */

// Ejecutables y patrones de línea de comandos de agentes conocidos.
export const AGENT_PROCS = [
  { name: 'OpenCode', bins: ['opencode'], cmd: /opencode/i },
  { name: 'Kilo Code', bins: ['kilo', 'kilocode'], cmd: /kilo(code)?/i },
  { name: 'Claude Code', bins: ['claude'], cmd: /claude(-code)?/i },
  { name: 'Codex', bins: ['codex'], cmd: /codex/i },
  { name: 'Cursor', bins: ['cursor'], cmd: /cursor/i },
  { name: 'Windsurf', bins: ['windsurf'], cmd: /windsurf/i },
  { name: 'Gemini CLI', bins: ['gemini'], cmd: /gemini/i },
  { name: 'Aider', bins: ['aider'], cmd: /aider/i },
  { name: 'Roo Code', bins: ['roo'], cmd: /roo[-a-z]*code/i },
];

const SESSION_RE = /ses_[a-z0-9_]{4,}/i;

function norm(s) {
  return String(s || '').replace(/\\/g, '/').toLowerCase();
}

function agentOf(exe, commandLine) {
  const base = norm(path.basename(String(exe || ''))).replace(/\.(exe|cmd|bat|ps1|com)$/i, '');
  const cmd = norm(commandLine);
  for (const a of AGENT_PROCS) {
    if (a.bins.some(b => base === b)) return a;
    if (a.cmd.test(cmd)) return a;
  }
  return null;
}

function defaultDeps() {
  if (process.platform === 'win32') {
    return {
      listProcesses() {
        const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress -Depth 3';
        const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
        }).trim();
        if (!out) return [];
        let arr = JSON.parse(out);
        if (!Array.isArray(arr)) arr = [arr];
        return arr.map(p => ({
          pid: Number(p.ProcessId),
          ppid: Number(p.ParentProcessId) || 0,
          exe: String(p.Name || ''),
          commandLine: String(p.CommandLine || ''),
          createdAt: p.CreationDate || null,
        }));
      },
      kill(pid, force) {
        execFileSync('taskkill', force ? ['/F', '/PID', String(pid)] : ['/PID', String(pid)], {
          stdio: 'ignore', timeout: 10000, windowsHide: true,
        });
      },
      sendAgent(bin, sessionId, message, o = {}) {
        return spawnSync(bin, ['run', '--session', sessionId, '--format', 'json', String(message)], {
          cwd: o.cwd, encoding: 'utf8', timeout: Number(process.env.CONTEXTBASE_AGENT_TIMEOUT_MS || 120000), windowsHide: true,
        });
      },
    };
  }
  return {
    listProcesses() {
      const out = execFileSync('ps', ['-eo', 'pid,ppid,comm,args'], { encoding: 'utf8', timeout: 15000 });
      return out.split('\n').slice(1).map(l => {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), exe: path.basename(m[3]), commandLine: m[4], createdAt: null } : null;
      }).filter(Boolean);
    },
    kill(pid, force) {
      try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); } catch (err) { throw new Error('No se pudo cerrar el pid ' + pid + ': ' + err.message); }
    },
    sendAgent(bin, sessionId, message, o = {}) {
      return spawnSync(bin, ['run', '--session', sessionId, '--format', 'json', String(message)], {
        cwd: o.cwd, encoding: 'utf8', timeout: Number(process.env.CONTEXTBASE_AGENT_TIMEOUT_MS || 120000),
      });
    },
  };
}

function ancestorChain(procs, selfPid = process.pid) {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const chain = new Set([selfPid]);
  let cur = byPid.get(selfPid);
  let guard = 0;
  while (cur && cur.ppid && !chain.has(cur.ppid) && guard++ < 64) {
    chain.add(cur.ppid);
    cur = byPid.get(cur.ppid);
  }
  return chain;
}

/** Lista terminales/procesos de agente identificados; `scope: project` si su comando referencia la raíz del proyecto. */
export function listTerminals(cwd = process.cwd(), deps = defaultDeps()) {
  const root = norm(path.resolve(cwd));
  const procs = deps.listProcesses();
  const protectedPids = ancestorChain(procs);
  const out = [];
  for (const p of procs) {
    const agent = agentOf(p.exe, p.commandLine);
    if (!agent) continue;
    const cmdNorm = norm(p.commandLine);
    const scope = cmdNorm.includes(root) ? 'project' : 'unknown';
    const m = String(p.commandLine || '').match(SESSION_RE);
    out.push({
      pid: p.pid,
      ppid: p.ppid,
      agent: agent.name,
      exe: p.exe,
      commandLine: String(p.commandLine || '').slice(0, 300),
      sessionId: m ? m[0] : null,
      scope,
      protected: protectedPids.has(p.pid),
      createdAt: p.createdAt || null,
      os: process.platform,
    });
  }
  out.sort((a, b) => (a.scope === b.scope ? a.pid - b.pid : a.scope === 'project' ? -1 : 1));
  return out;
}

/**
 * Cierra terminales de agente. Sin `yes` no actúa (dry-run y las lista).
 * Nunca cierra el proceso actual ni sus ancestros; solo agentes identificados.
 */
export function closeTerminals(targets, options = {}, deps = defaultDeps()) {
  const { yes = false, force = false, cwd = process.cwd() } = options;
  const identified = listTerminals(cwd, deps);
  const sel = [];
  for (const t of targets || []) {
    if (t === 'all') {
      sel.push(...identified.filter(i => i.scope === 'project'));
      continue;
    }
    const pid = Number(t);
    const hit = identified.find(i => i.pid === pid);
    if (hit) sel.push(hit);
    else sel.push({ pid, agent: null, error: 'pid no identificado como proceso agente en esta máquina' });
  }
  if (!yes) {
    return { ok: true, dryRun: true, targets: sel, note: 'dry-run: no se cerró nada. Repite con --yes para actuar.' };
  }
  const results = [];
  for (const s of sel) {
    if (s.error) { results.push({ pid: s.pid, ok: false, reason: s.error }); continue; }
    if (s.protected) { results.push({ pid: s.pid, agent: s.agent, ok: false, reason: 'protegido: es el proceso actual o un ancestro suyo' }); continue; }
    try {
      deps.kill(s.pid, force);
      results.push({ pid: s.pid, agent: s.agent, ok: true });
    } catch (err) {
      results.push({ pid: s.pid, agent: s.agent, ok: false, reason: err.message });
    }
  }
  return { ok: results.every(r => r.ok), dryRun: false, results };
}

/**
 * Envía trabajo a una terminal de agente por su contrato nativo.
 * La inyección de teclas en TUI ajenas no está soportada; se usa el contrato
 * de sesión del agente (hoy: opencode run --session <ses_...>).
 */
// Contrato nativo de envío: solo agentes cuyo CLI expone run --session verificado.
export function nativeSendSpec(agent) {
  const a = String(agent || '');
  if (a === 'OpenCode') return { bin: 'opencode' };
  if (a === 'Kilo Code') return { bin: 'kilo' };
  return null;
}

/**
 * Cierra automaticamente las terminales de agente cuyo trabajo ya termino.
 * Solo interviene sobre procesos ligados a workers de una corrida de ContextBase
 * (pid o sesion registrados en el estado swarm/web) cuyo worker esta en 'done'.
 * Nunca toca el arbol protegido ni terminales ajenas a este proyecto.
 */
export async function autoCloseFinished(cwd = process.cwd(), options = {}, deps = defaultDeps()) {
  const { includeStale = false, dryRun = false } = options;
  const result = { closed: [], skipped: [], candidates: [], reason: null };
  let status;
  try {
    const swarm = await import('./swarm.js');
    status = swarm.swarmStatus({ cwd });
  } catch (err) {
    result.reason = 'sin corridas activas en este proyecto';
    return result;
  }
  const workers = (status.workers || []).filter(w => w.state === 'done' || (includeStale && w.state === 'stale'));
  if (!workers.length) { result.reason = 'ningun worker con trabajo terminado'; return result; }
  const live = listTerminals(cwd, deps);
  for (const w of workers) {
    const byPid = w.pid ? live.find(t => t.pid === Number(w.pid)) : null;
    const bySession = w.session ? live.find(t => t.sessionId && t.sessionId === w.session) : null;
    const target = byPid || bySession;
    if (!target) { result.skipped.push({ worker: w.id, reason: 'sin proceso vivo (sesion ' + (w.session || 'n/a') + ')' }); continue; }
    if (target.protected) { result.skipped.push({ worker: w.id, pid: target.pid, reason: 'protegido: arbol de la sesion actual' }); continue; }
    result.candidates.push({ worker: w.id, pid: target.pid, agent: target.agent, session: target.sessionId });
    if (dryRun) continue;
    try {
      deps.kill(target.pid, true);
      result.closed.push({ worker: w.id, pid: target.pid, agent: target.agent });
    } catch (err) {
      result.skipped.push({ worker: w.id, pid: target.pid, reason: err.message });
    }
  }
  return result;
}

export function sendToTerminal(pid, message, options = {}, deps = defaultDeps()) {
  const { cwd = process.cwd() } = options;
  if (!String(message || '').trim()) throw new Error('Uso: contextbase terminals send <pid> --message "..."');
  const identified = listTerminals(cwd, deps);
  const target = identified.find(i => i.pid === Number(pid));
  if (!target) throw new Error('pid ' + pid + ' no identificado como agente en ejecución en este equipo. Ejecuta: contextbase terminals');
  if (target.protected) throw new Error('pid ' + pid + ' está protegido (es tu propio árbol de procesos)');
  const cap = nativeSendSpec(target.agent);
  if (!cap || !target.sessionId) {
    throw new Error('la terminal ' + target.agent + ' (pid ' + pid + ') no expone envío nativo' + (!target.sessionId ? ' (sin sesion ses_ en su línea de comandos)' : '') + '. Capacidades verificadas en esta máquina: opencode -> nativo (opencode run --session), kilo -> nativo (kilo run --session, v7.8.27), claude/codex -> sin contrato verificado (CLIs no instalados; usa el launcher universal: contextbase web start --universal). Para runs activos de Telaraña: contextbase web send --worker <id> --message "..." o ciérrala con: contextbase terminals close ' + pid + ' --yes');
  }
  const res = deps.sendAgent(cap.bin, target.sessionId, message, { cwd });
  const out = String(res.stdout || '').trim();
  return { ok: res.status === 0, pid: target.pid, agent: target.agent, sessionId: target.sessionId, tail: out.slice(-2000), status: res.status };
}
