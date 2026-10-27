import fs from 'node:fs';
import path from 'node:path';
import { check as guardCheck } from './guard.js';

export const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules', '.gemini/rules/contextbase.md', '.agents/rules/contextbase.md'];

function statOf(file) {
  try {
    const s = fs.statSync(file);
    return { exists: true, size: s.size, modified: s.mtime.toISOString(), days: Math.floor((Date.now() - s.mtimeMs) / 86400000) };
  } catch { return { exists: false }; }
}

function parseTasks(text) {
  const pending = [];
  const done = [];
  let inDone = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) inDone = /completadas/i.test(line);
    const p = line.match(/^- \[ \]\s+(.+)$/);
    const d = line.match(/^- \[x\]\s+(.+)$/i);
    if (p) pending.push(p[1].trim());
    else if (d && inDone) done.push(d[1].trim());
  }
  const total = pending.length + done.length;
  return { pending, done, total, pct: total ? Math.round((done.length / total) * 100) : 0 };
}

function parseSecurity(text) {
  const out = { critical: 0, high: 0, parsed: false };
  if (!text) return out;
  const crit = text.match(/critical:\s*(\d+)/i);
  const high = text.match(/high:\s*(\d+)/i);
  if (crit || high || /sin vulnerabilidades/i.test(text) || /total\s+0\b/i.test(text)) out.parsed = true;
  out.critical = crit ? Number(crit[1]) : 0;
  out.high = high ? Number(high[1]) : 0;
  return out;
}

function ruleVersions(projectDir) {
  const present = [];
  const outdated = [];
  for (const rel of RULE_FILES) {
    const full = path.join(projectDir, rel);
    if (!fs.existsSync(full)) continue;
    present.push(rel);
    const m = fs.readFileSync(full, 'utf8').match(/<!-- CONTEXTBASE:v([0-9.]+) -->/);
    outdated.push({ file: rel, version: m ? m[1] : 'sin marca' });
  }
  return { present, versions: outdated };
}

export function collectState(projectDir) {
  const contextDir = path.join(projectDir, 'contextbase');
  const read = f => { try { return fs.readFileSync(path.join(contextDir, f), 'utf8'); } catch { return ''; } };
  const taskText = read('tasklist.md');
  const componentesText = read('componentes.md');
  const files = {};
  for (const name of ['fundamentos.md', 'changelog.md', 'tasklist.md', 'componentes.md']) files[name] = statOf(path.join(contextDir, name));
  return {
    project: path.basename(path.resolve(projectDir)),
    dir: path.resolve(projectDir),
    contextDirExists: fs.existsSync(contextDir),
    files,
    tasks: parseTasks(taskText),
    security: { ...parseSecurity(componentesText), informe: files['componentes.md'].exists ? files['componentes.md'].days : null },
    rules: ruleVersions(projectDir),
    guard: (() => { try { const r = guardCheck(projectDir); return { status: r.status, drifts: (r.drifts || []).map(d => ({ file: d.file, kind: d.kind })) }; } catch { return { status: 'unknown', drifts: [] }; } })()
  };
}

export function evaluateHealth(state, ownVersion) {
  const problems = [];
  if (!state.contextDirExists) problems.push('Falta contextbase/ (ejecutar contextbase init).');
  if (!state.files['componentes.md'].exists) problems.push('Falta componentes.md (ejecutar contextbase audit).');
  else if (state.files['componentes.md'].days > 7) problems.push('componentes.md desactualizado (' + state.files['componentes.md'].days + ' dias; ejecutar contextbase audit).');
  if (state.security.critical > 0) problems.push('Vulnerabilidades critical: ' + state.security.critical + ' (corregir antes de continuar).');
  if (state.security.high > 0) problems.push('Vulnerabilidades high: ' + state.security.high + ' (corregir antes de continuar).');
  const drift = state.rules.versions.filter(r => r.version !== ownVersion);
  if (drift.length > 0) problems.push('Reglas de agente desactualizadas en: ' + drift.map(d => d.file).join(', ') + ' (ejecutar contextbase sync).');
  if (state.guard && state.guard.status !== 'ok') problems.push('Deriva en archivos base: ' + (state.guard.drifts || []).map(d => d.file).join(', ') + ' (ejecutar contextbase guard).');
  return { ok: problems.length === 0, problems };
}

/**
 * Digest compacto y determinista para iniciar una sesion de agente sin volcar archivos completos.
 */
export function buildDigest(state, ownVersion) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('# ContextBase :: ' + state.project);
  lines.push('Fecha: ' + date + ' | version CLI: ' + ownVersion);
  lines.push('');
  lines.push('## Tareas pendientes (' + state.tasks.pending.length + ')');
  if (state.tasks.pending.length === 0) lines.push('- Sin pendientes registradas.');
  else state.tasks.pending.slice(0, 10).forEach((t, i) => lines.push((i + 1) + '. ' + t));
  if (state.tasks.pending.length > 10) lines.push('- ... y ' + (state.tasks.pending.length - 10) + ' mas en contextbase/tasklist.md');
  lines.push('');
  lines.push('## Progreso');
  lines.push('Completadas: ' + state.tasks.done.length + ' | Pendientes: ' + state.tasks.pending.length + ' | Avance: ' + state.tasks.pct + '%');
  lines.push('');
  lines.push('## Componentes y seguridad');
  if (!state.files['componentes.md'].exists) lines.push('- Sin informe. Ejecutar: contextbase audit');
  else {
    const sec = state.security;
    const sev = sec.parsed ? ('critical ' + sec.critical + ', high ' + sec.high) : 'sin conteo interpretable';
    lines.push('- Informe de hace ' + state.files['componentes.md'].days + ' dias (' + sev + ').');
  }
  lines.push('');
  lines.push('## Guardia de archivos base');
  if (!state.guard) lines.push('- Sin datos.');
  else if (state.guard.status === 'ok') lines.push('- OK');
  else lines.push('- Deriva: ' + (state.guard.drifts || []).map(d => d.file + ' (' + d.kind + ')').join(', '));
  lines.push('');
  lines.push('## Salud');
  const health = evaluateHealth(state, ownVersion);
  if (health.ok) lines.push('- OK');
  else health.problems.forEach(p => lines.push('- ' + p));
  lines.push('');
  lines.push('## Siguiente accion');
  if (state.security.critical > 0 || state.security.high > 0) lines.push('- Corregir brechas critical/high y registrarlas en tasklist.md.');
  else if (!state.files['componentes.md'].exists || state.files['componentes.md'].days > 7) lines.push('- Regenerar inventario: contextbase audit');
  else if (state.rules.versions.some(r => r.version !== ownVersion)) lines.push('- Sincronizar reglas: contextbase sync');
  else if (state.tasks.pending.length > 0) lines.push('- Continuar con: ' + state.tasks.pending[0]);
  else lines.push('- Sin pendientes: registrar el proximo objetivo.');
  return lines.join('\n');
}
