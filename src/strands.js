// Integracion completa de Strands Agent (Python) - fase 2.
// Genera archivos de Python con el contexto del proyecto para Strands.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { collectState } from './context.js';
import { analyzeProject } from './scanner.js';
import { writeAtomic } from './fsutil.js';

export const STRANDS_DIR_NAME = 'contextbase/strands';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(msg) { if (process.env.CONTEXTBASE_VERBOSE === '1') process.stderr.write(msg + '\n'); }

function pyBool(v) { return v ? 'True' : 'False'; }
function pyNone() { return 'None'; }
function pyStr(s) {
  const esc = String(s !== undefined ? s : '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return "'" + esc + "'";
}
function pyList(items) {
  if (!Array.isArray(items)) return '[]';
  return '[' + items.map(i => typeof i === 'string' ? pyStr(i) : pyRepr(i)).join(', ') + ']';
}
function pyDict(obj) {
  if (obj === null || obj === undefined) return '{}';
  if (typeof obj !== 'object') return pyRepr(obj);
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  return '{' + keys.map(k => pyStr(k) + ': ' + pyRepr(obj[k])).join(', ') + '}';
}
function pyRepr(v) {
  if (v === null) return 'None';
  if (v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) return pyList(v);
  if (typeof v === 'object') return pyDict(v);
  return pyStr(String(v));
}

function nowIso() { return new Date().toISOString(); }

function pyEscapedComment(text) {
  return String(text).replace(/'''/g, "\\'\\'\\'").replace(/#/g, '#');
}

function formatTasks(state) {
  const now = nowIso();
  const tasks = [];
  let i = 1;
  for (const t of (state.tasks && state.tasks.pending || [])) {
    tasks.push({
      id: 'T-' + String(i).padStart(3, '0'),
      descripcion: t,
      estado: 'pendiente',
      prioridad: 'media',
      fecha: now
    });
    i++;
  }
  for (const t of (state.tasks && state.tasks.done || [])) {
    tasks.push({
      id: 'T-' + String(i).padStart(3, '0'),
      descripcion: t,
      estado: 'completada',
      prioridad: 'media',
      fecha: now
    });
    i++;
  }
  return tasks;
}

export function prepareStrandsContext(projectDir, options = {}) {
  const resolvedDir = path.resolve(projectDir || process.cwd());
  const strandsDir = path.join(resolvedDir, STRANDS_DIR_NAME);
  const state = collectState(resolvedDir);
  const analysis = analyzeProject(resolvedDir);

  fs.mkdirSync(strandsDir, { recursive: true });

  const contextJson = {
    project: state.project,
    dir: state.dir,
    generatedAt: nowIso(),
    contextDirExists: state.contextDirExists,
    files: state.files,
    tasks: state.tasks,
    security: state.security,
    rules: state.rules,
    guard: state.guard,
    metadata: analysis.metadata,
    languages: analysis.languages,
    gitHistory: analysis.gitHistory,
    todos: analysis.todos
  };

  const contextPath = path.join(strandsDir, 'context.json');
  const projectContextPath = path.join(strandsDir, 'project_context.py');
  const strandsConfigPath = path.join(strandsDir, 'strands_config.py');
  const tasksPath = path.join(strandsDir, 'tasks.py');
  const runnerPath = path.join(strandsDir, 'strands_runner.py');
  const readmePath = path.join(strandsDir, 'README.md');

  writeAtomic(contextPath, JSON.stringify(contextJson, null, 2));
  writeAtomic(projectContextPath, generatePythonContext(state, analysis));
  writeAtomic(strandsConfigPath, generateStrandsConfig());
  writeAtomic(tasksPath, generateTasksFile(formatTasks(state)))
  writeAtomic(runnerPath, generateStrandsRunner());
  writeAtomic(readmePath, generateReadme(state, analysis));

  const files = [contextPath, projectContextPath, strandsConfigPath, tasksPath, runnerPath, readmePath];

  const summary = {
    project: state.project,
    strandsDir,
    filesGenerated: files.length,
    pendingTasks: state.tasks.pending.length,
    completedTasks: state.tasks.done.length,
    securityCritical: state.security.critical,
    securityHigh: state.security.high,
    guardStatus: state.guard.status,
    rulesPresent: state.rules.present.length
  };

  log(c.green + c.bold + '[strands]' + c.reset + ' Contexto de Strands generado en ' + strandsDir);

  return { strandsDir, files, summary };
}

export function generatePythonContext(state, analysis) {
  const project = state.project || 'proyecto';
  const dir = state.dir || '';
  const version = (analysis.metadata && analysis.metadata.version) || '0.1.0';
  const pendingTasks = (state.tasks && state.tasks.pending || []).map((t, i) => ({
    id: 'T-' + String(i + 1).padStart(3, '0'),
    descripcion: t,
    estado: 'pendiente',
    prioridad: 'media',
    fecha: nowIso()
  }));
  const completedTasks = (state.tasks && state.tasks.done || []).map((t, i) => ({
    id: 'T-' + String(pendingTasks.length + i + 1).padStart(3, '0'),
    descripcion: t,
    estado: 'completada',
    prioridad: 'media',
    fecha: nowIso()
  }));
  const securityIssues = [];
  if (state.security.critical > 0) securityIssues.push({ severidad: 'critical', cantidad: state.security.critical, descripcion: 'Vulnerabilidades critical detectadas en componentes' });
  if (state.security.high > 0) securityIssues.push({ severidad: 'high', cantidad: state.security.high, descripcion: 'Vulnerabilidades high detectadas en componentes' });
  const components = (analysis.metadata && analysis.metadata.dependencies) || [];
  const ruleFiles = {};
  for (const rv of (state.rules && state.rules.versions || [])) {
    ruleFiles[rv.file] = rv.version || 'sin marca';
  }
  const guardStatus = (state.guard && state.guard.status) || 'unknown';
  const guardDrifts = (state.guard && state.guard.drifts) || [];
  const nextAction = (() => {
    if (state.security.critical > 0 || state.security.high > 0) return 'Corregir brechas de seguridad critical/high y registrarlas en tasklist.md.';
    if (!state.files['componentes.md'] || !state.files['componentes.md'].exists || (state.files['componentes.md'].days || 0) > 7) return 'Regenerar inventario de componentes: contextbase audit.';
    if (state.rules.versions && state.rules.versions.some(r => r.version !== '1.4.0')) return 'Sincronizar reglas de agente: contextbase sync.';
    if (state.tasks.pending.length > 0) return 'Continuar con la tarea pendiente: ' + state.tasks.pending[0];
    return 'Sin pendientes: registrar el proximo objetivo en tasklist.md.';
  })();

  const lines = [];
  lines.push('# -*- coding: utf-8 -*-');
  lines.push('"""');
  lines.push('project_context.py - Contexto del proyecto para Strands Agent.');
  lines.push('');
  lines.push('Este archivo contiene el contexto completo del proyecto, generado por ContextBase,');
  lines.push('para que un agente Strands pueda trabajar organizado, sincronizado y sin perder');
  lines.push('el hilo entre sesiones. Importalo directamente en tu proyecto Strands.');
  lines.push('');
  lines.push('Generado por: ContextBase CLI');
  lines.push('Fecha de generacion: ' + nowIso());
  lines.push('Directorio del proyecto: ' + String(dir).replace(/\\/g, '/'));
  lines.push('"""');
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 1. IDENTIFICACION DEL PROYECTO');
  lines.push('# ============================================================================');
  lines.push("PROJECT_NAME = " + pyStr(project));
  lines.push("PROJECT_DIR = " + pyStr(dir));
  lines.push("PROJECT_VERSION = " + pyStr(version));
  lines.push("PROJECT_TYPE = " + pyStr((analysis.metadata && analysis.metadata.type) || 'Generic'));
  lines.push("PROJECT_DESCRIPTION = " + pyStr((analysis.metadata && analysis.metadata.description) || ''));
  lines.push("FRAMEWORKS = " + pyList((analysis.metadata && analysis.metadata.frameworks) || []));
  lines.push("LANGUAGES = " + pyDict(analysis.languages || {}));
  lines.push("GENERATED_AT = " + pyStr(nowIso()))
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 2. TAREAS PENDIENTES Y COMPLETADAS');
  lines.push('# ============================================================================');
  lines.push('# PENDING_TASKS: lista de diccionarios con id, descripcion, estado, prioridad y fecha.');
  lines.push("PENDING_TASKS = " + pyList(pendingTasks));
  lines.push('# COMPLETED_TASKS: lista de diccionarios de tareas ya realizadas.');
  lines.push("COMPLETED_TASKS = " + pyList(completedTasks));
  lines.push('TOTAL_TASKS = len(PENDING_TASKS) + len(COMPLETED_TASKS)');
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 3. SEGURIDAD Y VULNERABILIDADES');
  lines.push('# ============================================================================');
  lines.push('# SECURITY_ISSUES: vulnerabilidades critical y high detectadas en componentes.');
  lines.push("SECURITY_ISSUES = " + pyList(securityIssues));
  lines.push('SECURITY_CRITICAL_COUNT = ' + String(state.security.critical));
  lines.push('SECURITY_HIGH_COUNT = ' + String(state.security.high));
  lines.push('SECURITY_HAS_ISSUES = ' + pyBool((state.security.critical || 0) > 0 || (state.security.high || 0) > 0));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 4. COMPONENTES Y DEPENDENCIAS');
  lines.push('# ============================================================================');
  lines.push('# COMPONENTS: inventario de dependencias del proyecto.');
  lines.push("COMPONENTS = " + pyList(components));
  lines.push("DEPENDENCIES = " + pyList((analysis.metadata && analysis.metadata.dependencies) || []));
  lines.push("DEV_DEPENDENCIES = " + pyList((analysis.metadata && analysis.metadata.devDependencies) || []));
  lines.push("SCRIPTS = " + pyDict((analysis.metadata && analysis.metadata.scripts) || {}));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 5. ARCHIVOS DE REGLAS Y VERSIONES');
  lines.push('# ============================================================================');
  lines.push('# RULE_FILES: mapa de archivos de regla con su version CONTEXTBASE detectada.');
  lines.push("RULE_FILES = " + pyDict(ruleFiles));
  lines.push('RULE_FILES_PRESENT = ' + pyList((state.rules && state.rules.present) || []));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 6. ESTADO DEL GUARDIA DE ARCHIVOS BASE');
  lines.push('# ============================================================================');
  lines.push('# GUARD_STATUS: ok o drift.');
  lines.push("GUARD_STATUS = " + pyStr(guardStatus));
  lines.push('# GUARD_DRIFTS: lista de archivos con deriva (file, kind).');
  lines.push("GUARD_DRIFTS = " + pyList(guardDrifts.map(d => ({ file: d.file, kind: d.kind }))));
  lines.push('GUARD_HAS_DRIFT = ' + pyBool(guardStatus !== 'ok'))
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 7. SIGUIENTE ACCION RECOMENDADA');
  lines.push('# ============================================================================');
  lines.push('# NEXT_ACTION: accion recomendada para la siguiente sesion del agente.');
  lines.push("NEXT_ACTION = " + pyStr(nextAction));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 8. GIT HISTORY Y TODOS');
  lines.push('# ============================================================================');
  lines.push('GIT_HISTORY = ' + pyList((analysis.gitHistory || []).map(String)))
  lines.push('# TODOS: tareas detectadas en codigo (TODO, FIXME, HACK, BUG).');
  lines.push("TODOS = " + pyList((analysis.todos || []).map(t => ({ type: t.type, text: t.text, file: t.file, line: t.line }))));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# 9. FUNCIONES DE ACCESO RAPIDO');
  lines.push('# ============================================================================');
  lines.push('def get_pending_tasks():');
  lines.push("    '''Retorna la lista de tareas pendientes.'''");
  lines.push('    return PENDING_TASKS');
  lines.push('');
  lines.push('def get_completed_tasks():');
  lines.push("    '''Retorna la lista de tareas completadas.'''");
  lines.push('    return COMPLETED_TASKS');
  lines.push('');
  lines.push('def get_security_issues():');
  lines.push("    '''Retorna los problemas de seguridad detectados.'''");
  lines.push('    return SECURITY_ISSUES');
  lines.push('');
  lines.push('def get_next_action():');
  lines.push("    '''Retorna la siguiente accion recomendada.'''");
  lines.push('    return NEXT_ACTION');
  lines.push('');
  lines.push('def has_critical_security_issues():');
  lines.push("    '''True si hay vulnerabilidades critical sin corregir.'''");
  lines.push('    return SECURITY_CRITICAL_COUNT > 0');
  lines.push('');
  lines.push('def has_guard_drift():');
  lines.push("    '''True si el guardia detecta deriva en archivos base.'''");
  lines.push('    return GUARD_HAS_DRIFT');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    print("PROJECT:", PROJECT_NAME)');
  lines.push('    print("VERSION:", PROJECT_VERSION)');
  lines.push('    print("PENDING_TASKS:", len(PENDING_TASKS))');
  lines.push('    print("COMPLETED_TASKS:", len(COMPLETED_TASKS))');
  lines.push('    print("SECURITY_CRITICAL:", SECURITY_CRITICAL_COUNT)');
  lines.push('    print("SECURITY_HIGH:", SECURITY_HIGH_COUNT)');
  lines.push('    print("GUARD_STATUS:", GUARD_STATUS)');
  lines.push('    print("NEXT_ACTION:", NEXT_ACTION)');
  lines.push('');
  return lines.join('\n') + '\n';
}

export function generateStrandsConfig() {
  const now = nowIso();
  const agentConfig = {
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.2,
    max_tokens: 4096,
    system_prompt: 'Eres un agente Strands que trabaja sobre el proyecto contextbase. Usa project_context.py para mantener el contexto entre sesiones.',
    language: 'es'
  };
  const toolsConfig = {
    available: [
      { name: 'read_file', description: 'Leer un archivo del proyecto' },
      { name: 'write_file', description: 'Escribir un archivo del proyecto' },
      { name: 'list_directory', description: 'Listar contenido de un directorio' },
      { name: 'run_command', description: 'Ejecutar un comando de terminal' },
      { name: 'search_code', description: 'Buscar patrones en el codigo' }
    ],
    max_concurrent: 5,
    timeout_ms: 30000
  };
  const swarmConfig = {
    enabled: false,
    max_workers: 3,
    strategy: 'sequential',
    shared_context_file: 'contextbase/strands/context.json'
  };
  const hooksConfig = {
    pre_execution: [
      { hook: 'load_context', description: 'Cargar context.json y project_context.py antes de ejecutar' },
      { hook: 'check_guard', description: 'Verificar que no hay deriva en archivos base' }
    ],
    post_execution: [
      { hook: 'save_context', description: 'Guardar estado actualizado tras la ejecucion' },
      { hook: 'log_action', description: 'Registrar la accion ejecutada en tasklist.md' }
    ],
    on_error: [
      { hook: 'report_error', description: 'Reportar error y volver al estado ultimo valido' }
    ]
  };

  const lines = [];
  lines.push('# -*- coding: utf-8 -*-');
  lines.push('"""');
  lines.push('strands_config.py - Configuracion para Strands Agent.');
  lines.push('');
  lines.push('Configuracion de agentes, herramientas, enjambre y hooks para Strands.');
  lines.push('Generado por ContextBase CLI el ' + now + '.');
  lines.push('"""');
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# AGENT_CONFIG');
  lines.push('# ============================================================================');
  lines.push('# Configuracion del agente Strands: modelo, temperatura, max_tokens.');
  lines.push('AGENT_CONFIG = ' + pyDict(agentConfig));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# TOOLS_CONFIG');
  lines.push('# ============================================================================');
  lines.push('# Herramientas disponibles para el agente.');
  lines.push('TOOLS_CONFIG = ' + pyDict(toolsConfig));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# SWARM_CONFIG');
  lines.push('# ============================================================================');
  lines.push('# Configuracion de enjambre si se usa trabajo distribuido.');
  lines.push('SWARM_CONFIG = ' + pyDict(swarmConfig));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# HOOKS_CONFIG');
  lines.push('# ============================================================================');
  lines.push('# Hooks pre/post ejecucion y manejo de errores.');
  lines.push('HOOKS_CONFIG = ' + pyDict(hooksConfig));
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# FUNCIONES DE ACCESO');
  lines.push('# ============================================================================');
  lines.push('def get_agent_config():');
  lines.push("    '''Retorna la configuracion del agente.'''");
  lines.push('    return AGENT_CONFIG');
  lines.push('');
  lines.push('def get_tools_config():');
  lines.push("    '''Retorna la configuracion de herramientas.'''");
  lines.push('    return TOOLS_CONFIG');
  lines.push('');
  lines.push('def get_swarm_config():');
  lines.push("    '''Retorna la configuracion de enjambre.'''");
  lines.push('    return SWARM_CONFIG');
  lines.push('');
  lines.push('def get_hooks_config():');
  lines.push("    '''Retorna la configuracion de hooks.'''");
  lines.push('    return HOOKS_CONFIG');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    print("AGENT_CONFIG:", AGENT_CONFIG)');
  lines.push('    print("TOOLS_CONFIG:", TOOLS_CONFIG)');
  lines.push('    print("SWARM_CONFIG:", SWARM_CONFIG)');
  lines.push('    print("HOOKS_CONFIG:", HOOKS_CONFIG)');
  lines.push('');
  return lines.join('\n') + '\n';
}

export function generateTasksFile(tasks) {
  const lines = [];
  lines.push('# -*- coding: utf-8 -*-');
  lines.push('"""');
  lines.push('tasks.py - Lista de tareas pendientes como estructuras de Python.');
  lines.push('');
  lines.push('Cada tarea es un diccionario con id, descripcion, estado, prioridad y fecha.');
  lines.push('Generado por ContextBase CLI.');
  lines.push('"""');
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# TAREAS');
  lines.push('# ============================================================================');
  lines.push('# Lista de diccionarios de tareas.');
  lines.push("TASKS = " + pyList(tasks));
  lines.push('');
  lines.push('PENDING_TASKS = [t for t in TASKS if t.get("estado") == "pendiente"]');
  lines.push('COMPLETED_TASKS = [t for t in TASKS if t.get("estado") == "completada"]');
  lines.push('');
  lines.push('# ============================================================================');
  lines.push('# FUNCIONES DE ACCESO');
  lines.push('# ============================================================================');
  lines.push('def get_tasks():');
  lines.push("    '''Retorna todas las tareas.'''");
  lines.push('    return TASKS');
  lines.push('');
  lines.push('def get_pending_tasks():');
  lines.push("    '''Retorna solo las tareas pendientes.'''");
  lines.push('    return PENDING_TASKS');
  lines.push('');
  lines.push('def get_completed_tasks():');
  lines.push("    '''Retorna solo las tareas completadas.'''");
  lines.push('    return COMPLETED_TASKS');
  lines.push('');
  lines.push('def add_task(descripcion, prioridad="media"):');
  lines.push('    """Agrega una nueva tarea pendiente."""');
  lines.push('    import datetime');
  lines.push('    new_id = "T-" + str(len(TASKS) + 1).zfill(3)');
  lines.push('    task = {');
  lines.push('        "id": new_id,');
  lines.push('        "descripcion": descripcion,');
  lines.push('        "estado": "pendiente",');
  lines.push('        "prioridad": prioridad,');
  lines.push('        "fecha": datetime.datetime.utcnow().isoformat() + "Z"');
  lines.push('    }');
  lines.push('    TASKS.append(task)');
  lines.push('    return task');
  lines.push('');
  lines.push('def mark_done(task_id):');
  lines.push('    """Marca una tarea como completada."""');
  lines.push('    for t in TASKS:');
  lines.push('        if t.get("id") == task_id:');
  lines.push('            t["estado"] = "completada"');
  lines.push('            return t');
  lines.push('    return None');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    print("Total tareas:", len(TASKS))');
  lines.push('    print("Pendientes:", len(PENDING_TASKS))');
  lines.push('    print("Completadas:", len(COMPLETED_TASKS))');
  lines.push('    for t in PENDING_TASKS:');
  lines.push('        print(t["id"], "-", t["descripcion"])');
  lines.push('');
  return lines.join('\n') + '\n';
}

export function generateStrandsRunner() {
  const lines = [];
  lines.push('# -*- coding: utf-8 -*-');
  lines.push('"""');
  lines.push('strands_runner.py - Ejecutable listo para Strands Agent.');
  lines.push('');
  lines.push('Carga el contexto generado por ContextBase y prepara una sesion autonoma.');
  lines.push('Escala al humano solo cuando existe una urgencia real: vulnerabilidades');
  lines.push('critical/high o deriva detectada por el guardia de archivos base.');
  lines.push('"""');
  lines.push('');
  lines.push('from project_context import (');
  lines.push('    PROJECT_NAME,');
  lines.push('    PENDING_TASKS,');
  lines.push('    NEXT_ACTION,');
  lines.push('    SECURITY_ISSUES,');
  lines.push('    SECURITY_HAS_ISSUES,');
  lines.push('    GUARD_HAS_DRIFT,');
  lines.push('    TOTAL_TASKS,');
  lines.push(')');
  lines.push('from strands_config import AGENT_CONFIG');
  lines.push('');
  lines.push('ESCALATE_TO_HUMAN = SECURITY_HAS_ISSUES or GUARD_HAS_DRIFT');
  lines.push('');
  lines.push('SYSTEM_PROMPT = (');
  lines.push('    "Eres un agente Strands que trabaja de forma autonoma sobre el proyecto "');
  lines.push('    + str(PROJECT_NAME)');
  lines.push('    + ". Usa el contexto de ContextBase, respeta las tareas pendientes, "');
  lines.push('    + "registra cada cambio y no inventes resultados."');
  lines.push(')');
  lines.push('');
  lines.push('');
  lines.push('def build_prompt():');
  lines.push('    """Arma el prompt en espanol con el estado actual del proyecto."""');
  lines.push('    lines = []');
  lines.push('    lines.append("Proyecto: " + str(PROJECT_NAME))');
  lines.push('    lines.append("Tareas totales: " + str(TOTAL_TASKS))');
  lines.push('    lines.append("")');
  lines.push('    lines.append("Tareas pendientes (maximo 10):")');
  lines.push('    if PENDING_TASKS:');
  lines.push('        for task in PENDING_TASKS[:10]:');
  lines.push('            if isinstance(task, dict):');
  lines.push('                task_id = task.get("id", "")');
  lines.push('                desc = task.get("descripcion") or task.get("description") or task');
  lines.push('                lines.append("- [" + str(task_id) + "] " + str(desc))');
  lines.push('            else:');
  lines.push('                lines.append("- " + str(task))');
  lines.push('    else:');
  lines.push('        lines.append("- Sin tareas pendientes registradas.")');
  lines.push('    lines.append("")');
  lines.push('    lines.append("Siguiente accion recomendada: " + str(NEXT_ACTION))');
  lines.push('    if SECURITY_ISSUES:');
  lines.push('        lines.append("")');
  lines.push('        lines.append("Advertencia de seguridad:")');
  lines.push('        for issue in SECURITY_ISSUES[:5]:');
  lines.push('            if isinstance(issue, dict):');
  lines.push('                sev = issue.get("severidad", "?")');
  lines.push('                count = issue.get("cantidad", "?")');
  lines.push('                desc = issue.get("descripcion", "")');
  lines.push('                lines.append("- " + str(sev) + " (" + str(count) + "): " + str(desc))');
  lines.push('            else:');
  lines.push('                lines.append("- " + str(issue))');
  lines.push('    if GUARD_HAS_DRIFT:');
  lines.push('        lines.append("")');
  lines.push('        lines.append("Advertencia: el guardia detecto deriva en archivos base; se requiere revision humana.")');
  lines.push('    return "\\n".join(lines)');
  lines.push('');
  lines.push('');
  lines.push('def main():');
  lines.push('    prompt = build_prompt()');
  lines.push('    if ESCALATE_TO_HUMAN:');
  lines.push('        print("[ESCALAR AL HUMANO] Seguridad critical/high o deriva del guardia detectada.")');
  lines.push('        if SECURITY_ISSUES:');
  lines.push('            print("Motivo: " + str(SECURITY_ISSUES))');
  lines.push('        if GUARD_HAS_DRIFT:');
  lines.push('            print("Motivo: deriva detectada en archivos base por el guardia.")');
  lines.push('        print("")');
  lines.push('        print(prompt)');
  lines.push('        return 2');
  lines.push('    try:');
  lines.push('        from strands import Agent');
  lines.push('    except ImportError:');
  lines.push('        print(prompt)');
  lines.push('        print("")');
  lines.push('        print("[MODO SECO] SDK de Strands no instalado; se mostro el prompt completo.")');
  lines.push('        return 0');
  lines.push('    agent = Agent(model=AGENT_CONFIG.get("model"), system_prompt=SYSTEM_PROMPT)');
  lines.push('    result = agent(prompt)');
  lines.push('    print(result)');
  lines.push('    return 0');
  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    raise SystemExit(main())');
  lines.push('');
  return lines.join('\n') + '\n';
}

function generateReadme(state, analysis) {
  const now = nowIso();
  const lines = [];
  lines.push('# Contexto Strands Agent');
  lines.push('');
  lines.push('Directorio generado por ContextBase para integrar Strands Agent (Python) con el proyecto.');
  lines.push('');
  lines.push('## Archivos generados');
  lines.push('');
  lines.push('- `context.json` - Estado estructurado del proyecto en JSON.');
  lines.push('- `project_context.py` - Variables y constantes del contexto para importar en Strands.');
  lines.push('- `strands_config.py` - Configuracion de agente, herramientas, enjambre y hooks.');
  lines.push('- `tasks.py` - Lista de tareas pendientes como estructuras de Python.');
  lines.push('- `strands_runner.py` - Ejecutable que arma el prompt, ejecuta Strands si esta disponible y escala al humano solo por urgencia.');
  lines.push('- `README.md` - Esta documentacion.');
  lines.push('');
  lines.push('## Uso con Strands Agent');
  lines.push('');
  lines.push('Importa el contexto en tu agente Strands:');
  lines.push('');
  lines.push('```python');
  lines.push('from project_context import PROJECT_NAME, PROJECT_DIR, PENDING_TASKS, NEXT_ACTION');
  lines.push('from strands_config import AGENT_CONFIG, TOOLS_CONFIG, HOOKS_CONFIG');
  lines.push('from tasks import get_pending_tasks, mark_done');
  lines.push('```');
  lines.push('');
  lines.push('## Ejecucion autonoma');
  lines.push('');
  lines.push('Ejecuta el runner desde este directorio:');
  lines.push('');
  lines.push('```bash');
  lines.push('python strands_runner.py');
  lines.push('```');
  lines.push('');
  lines.push('El runner escala al humano solo cuando hay vulnerabilidades critical/high o deriva detectada por el guardia (salida 2). Si el SDK de Strands no esta instalado, muestra el prompt completo en modo seco (salida 0).');
  lines.push('');
  lines.push('El contexto se regenera automaticamente despues de cada `log`, `task`, `audit` o `sync`; no requiere un comando manual.');
  lines.push('');
  lines.push('## Flujo de trabajo recomendado');
  lines.push('');
  lines.push('1. Al iniciar una sesion, carga `context.json` y `project_context.py`.');
  lines.push('2. Revisa `NEXT_ACTION` para saber que hacer a continuacion.');
  lines.push('3. Ejecuta las tareas pendientes usando `get_pending_tasks()`.');
  lines.push('4. Al completar una tarea, usa `mark_done(task_id)`.');
  lines.push('5. Al cerrar el cambio, registra el avance y el contexto se regenera solo.');
  lines.push('');
  lines.push('## Proyecto');
  lines.push('- Nombre: ' + (state.project || 'desconocido'));
  lines.push('- Directorio: ' + (state.dir || ''));
  lines.push('- Version: ' + ((analysis.metadata && analysis.metadata.version) || '0.1.0'));
  lines.push('- Pendientes: ' + ((state.tasks && state.tasks.pending.length) || 0));
  lines.push('- Completadas: ' + ((state.tasks && state.tasks.done.length) || 0));
  lines.push('- Seguridad critical: ' + ((state.security && state.security.critical) || 0));
  lines.push('- Seguridad high: ' + ((state.security && state.security.high) || 0));
  lines.push('- Guardia: ' + ((state.guard && state.guard.status) || 'desconocido'));
  lines.push('');
  lines.push('Generado el ' + now + ' por ContextBase CLI.');
  return lines.join('\n') + '\n';
}

export function isReady() {
  return true;
}

