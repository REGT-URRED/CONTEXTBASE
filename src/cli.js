import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { analyzeProject, packRepository } from './scanner.js';
import { writeContextBase, syncFundamentos } from './generator.js';
import { injectAgentRules } from './rules.js';
import { installSkill } from './installer.js';
import { runMaintenance } from './maintenance.js';
import { writeAtomic, withLock } from './fsutil.js';
import { appendEntry, archiveBody } from './changelog.js';
import { collectState, buildDigest, evaluateHealth } from './context.js';
import { installGitHook, runLifecycleHook } from './hooks.js';
import { runExtra } from './cli_extra.js';
import { refreshBaseline } from './guard.js';
import { startMcpServer } from './mcp.js';
import * as review from './review.js';
import * as redundancy from './redundancy.js';
import * as slop from './slop.js';
import * as exp from './export.js';
import { autoEnsure, refreshStrands } from './auto.js';
import { prepareStrandsContext } from './strands.js';
import { autoConfigureProject, autoConfigureGlobal, reportConfigError } from './autoconfig.js';
import { startWatcher, startDaemonWatcher, stopDaemonWatcher, statusDaemonWatcher, syncWorkspaceChanges } from './watcher.js';
import { PHILOSOPHY } from './web.js';

// Estilos ANSI sin dependencias
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function banner() {
  const version = readOwnVersion();
  const vPad = `CONTEXTBASE (v${version})`;
  console.log(`\n${c.cyan}${c.bold}╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║                   ${vPad.padEnd(44, ' ')}║`);
  console.log(`║   Memoria Técnica Persistente y Telaraña Autónoma de Agentes   ║`);
  console.log(`║          "${PHILOSOPHY}"           ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝${c.reset}\n`);
}

export function readOwnVersion() {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

function showHelp() {
  banner();
  console.log(`${c.bold}USO:${c.reset}`);
  console.log(`  ${c.green}contextbase${c.reset} [comando] [opciones]\n`);
  console.log(`${c.bold}COMANDOS PRINCIPALES:${c.reset}`);
  console.log(`  ${c.cyan}init${c.reset}                  Inicializa contextbase y autoconfigura todos los agentes.`);
  console.log(`  ${c.cyan}auto${c.reset} | ${c.cyan}setup${c.reset}          Configura ejecución 100% automática (MCP, plugins, permisos, hooks).`);
  console.log(`  ${c.cyan}watch${c.reset} [start|stop|status] Observador en segundo plano que sincroniza y arbitra en tiempo real.`);
  console.log(`  ${c.cyan}web${c.reset} | ${c.cyan}telarana${c.reset} | ${c.cyan}swarm${c.reset}  Red de Agentes en Telaraña (start|arbitrate|flow|metrics|weave|status|send|collect|stop).`);
  console.log(`  ${c.cyan}status${c.reset} | ${c.cyan}check${c.reset}        Muestra el estado visual de la memoria, tareas y Telaraña.`);
  console.log(`  ${c.cyan}pack${c.reset} [archivo]        Empaqueta el código fuente estilo Repomix en un solo archivo.`);
  console.log(`  ${c.cyan}audit${c.reset}               Regenera el inventario de componentes y verifica brechas de seguridad (componentes.md).`);
  console.log(`  ${c.cyan}dump${c.reset}                  Vuelca el contenido completo de contextbase en pantalla.`);
  console.log(`  ${c.cyan}install-skill${c.reset}         Instala la Skill y plugins de ContextBase en los directorios globales.`);
  console.log(`  ${c.cyan}log${c.reset} <mensaje> [--scope=name|--worktree]  Registra cambio (global o namespaced por worktree).`);
  console.log(`  ${c.cyan}task add${c.reset} <descripción> Añade una nueva tarea pendiente [ ] a tasklist.md.`);
  console.log(`  ${c.cyan}task done${c.reset} <texto>      Marca una tarea como completada [x] en tasklist.md.`);
  console.log(`  ${c.cyan}task list${c.reset}             Lista todas las tareas actuales.\n`);
  console.log(`  ${c.cyan}context${c.reset} [--json]      Digest compacto para iniciar sesion (<=2k tokens).`);
  console.log(`  ${c.cyan}sync${c.reset}                  Sincroniza bloque tecnico de fundamentos.md, arbol de trabajo y reglas.`);
  console.log(`  ${c.cyan}hook${c.reset} [install|remove] Autoguardado: post-commit registra cada commit en changelog.md.`);
  console.log(`  ${c.cyan}mcp${c.reset}                   Servidor MCP sobre stdio (tools, resources, prompts y watcher activo).`);
  console.log(`  ${c.cyan}review${c.reset} [base] [--intent "..."]  Paquete de revision tipo thermos: diff + contenidos + 2 prompts.`);
  console.log(`  ${c.cyan}review prompts${c.reset}                  Solo los dos prompts de revisor.`);
  console.log(`  ${c.cyan}review merge${c.reset} <a.md> <b.md>      Fusiona exactamente dos reportes y marca coincidencias.`);
  console.log(`  ${c.cyan}redundancy${c.reset} [--json]             Detecta skills principales y duplicados, referencias rotas y MCP repetidos.`);
  console.log(`  ${c.cyan}slop${c.reset} [base] [--json]            Delivery gate antislop sobre el arbol de trabajo contra <base>.`);
  console.log(`  ${c.cyan}export${c.reset} <estado|digest> [json|html] [archivo]  Exporta estado o digest en JSON/HTML.`);
  console.log(`  ${c.cyan}status --json${c.reset}         Estado estructurado para agentes y CI.`);
  console.log(`  ${c.cyan}bootstrap${c.reset}            Bootstrap del entorno de agentes (detecta/instala/init/snapshot).`);
  console.log(`  ${c.cyan}guard${c.reset}                Verifica integridad de archivos base y repara.`);
  console.log(`  ${c.cyan}snapshot${c.reset}             Crea punto de restauracion de archivos base.`);
  console.log(`  ${c.cyan}restore${c.reset} [id]         Restaura archivos base desde snapshot.`);
  console.log(`  ${c.cyan}tools${c.reset} list|enable|disable  Gestiona herramientas del registro.`);
  console.log(`  ${c.cyan}mission${c.reset}             Prompt de mision: orquestacion, ejecucion resiliente y testing.`);
  console.log(`  ${c.cyan}status --check${c.reset}        Exit 1 si hay brechas, informe vencido o reglas desactualizadas.`);
  console.log(`${c.bold}OPCIONES DE INIT:${c.reset}`);
  console.log(`  ${c.yellow}--force${c.reset}               Sobrescribe archivos existentes en contextbase/.`);
  console.log(`  ${c.yellow}--pack${c.reset}                Genera también contextbase-pack.txt durante la inicialización.\n`);
}

/**
 * Comando: contextbase init
 */
export async function runInit(targetDir = process.cwd(), options = {}) {
  banner();
  console.log(`${c.bold}Iniciando implementación secuencial de ContextBase en:${c.reset} ${c.dim}${targetDir}${c.reset}\n`);

  // Paso 1: Creación de directorio
  console.log(`${c.cyan}[1/6] Creación de Directorio:${c.reset} Verificando carpeta 'contextbase/'...`);
  const contextDir = path.join(targetDir, 'contextbase');
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
    console.log(`      ${c.green}✓ Carpeta creada exitosamente:${c.reset} ${contextDir}`);
  } else {
    console.log(`      ${c.gray}✓ Carpeta existente detectada.${c.reset}`);
  }

  // Paso 2: Análisis y escaneo profundo (estilo Repomix)
  console.log(`\n${c.cyan}[2/6] Análisis y Escaneo Profundo:${c.reset} Leyendo archivos, dependencias y commits...`);
  const analysis = analyzeProject(targetDir);
  console.log(`      ${c.green}✓ Proyecto detectado:${c.reset} ${analysis.metadata.name} (${analysis.metadata.type})`);
  console.log(`      ${c.green}✓ Archivos analizados:${c.reset} ${analysis.files.length} archivos relevantes`);
  if (analysis.todos.length > 0) {
    console.log(`      ${c.yellow}✓ TODOs/Pendientes detectados:${c.reset} ${analysis.todos.length} ítems en código`);
  }
  if (analysis.gitHistory.length > 0) {
    console.log(`      ${c.green}✓ Historial Git:${c.reset} ${analysis.gitHistory.length} commits recientes registrados`);
  }

  // Paso 3: Generación de documentos
  console.log(`\n${c.cyan}[3/6] Generación y Poblado de Documentos:${c.reset}`);
  const result = writeContextBase(targetDir, analysis, { force: options.force });
  try { syncFundamentos(targetDir, analysis); } catch {}
  for (const f of result.filesWritten) {
    console.log(`      ${c.green}✓ Generado:${c.reset} ${f}`);
  }
  if (result.filesWritten.length === 0) {
    console.log(`      ${c.gray}(Archivos previos conservados. Usa --force si deseas regenerarlos)${c.reset}`);
  }

  // Paso 3.5: Mantenimiento preventivo automático
  console.log(`\n${c.magenta}[3.5/6] Mantenimiento Preventivo:${c.reset} Componentes, versiones y brechas de seguridad...`);
  try {
    const maint = runMaintenance(targetDir);
    const depsCount = maint.inventory.reduce((acc, row) => acc + row.deps.length, 0);
    console.log(`      ${c.green}✓ Generado:${c.reset} contextbase/componentes.md (${depsCount} componentes inventariados)`);
  } catch (e) {
    console.log(`      ${c.gray}Nota: mantenimiento preventivo omitido (${e.message})${c.reset}`);
  }

  // Paso 4: Autoconfiguración de Agentes (OpenCode, Kilo, Claude, Cursor) y Reglas
  console.log(`\n${c.cyan}[4/6] Autoconfiguración de Agentes (OpenCode, Kilo, Claude, Cursor) y Reglas:${c.reset}`);
  try {
    const autoCfg = autoConfigureProject(targetDir, options);
    for (const af of autoCfg.files) {
      console.log(`      ${c.green}✓ Configurado automáticamente:${c.reset} ${af}`);
    }
  } catch {}
  const rulesUpdated = injectAgentRules(targetDir);
  for (const r of rulesUpdated) {
    console.log(`      ${c.green}✓ Regla de actualización obligatoria inyectada en:${c.reset} ${r}`);
  }
  try {
    if (fs.existsSync(path.join(targetDir, '.git'))) {
      const hk = installGitHook(targetDir, 'install');
      if (hk.ok) console.log(`      ${c.green}✓ ${hk.message}${c.reset}`);
    }
  } catch {}
  try { refreshBaseline(targetDir); } catch {}

  // Paso 5: Instalación global de la skill y plugins para agentes
  console.log(`\n${c.cyan}[5/6] Disponibilidad Universal de Skill y Plugins:${c.reset}`);
  try {
    const installed = installSkill('all', targetDir);
    for (const inst of installed) {
      console.log(`      ${c.green}✓ Skill disponible en:${c.reset} ${inst}`);
    }
  } catch (e) {
    console.log(`      ${c.gray}Nota: No se pudo instalar la skill global (${e.message})${c.reset}`);
  }

  try {
    const strandsResult = prepareStrandsContext(targetDir);
    console.log(`\n[6/6] Contexto Strands (Python): generado en contextbase/strands/ (${strandsResult.files.length} archivos)`);
  } catch (e) {
    console.log(`\n${c.gray}Nota: contexto Strands omitido (${e.message})${c.reset}`);
  }

  // Empaquetado opcional
  if (options.pack) {
    console.log(`\n${c.magenta}[Repomix] Generando empaquetado del repositorio...${c.reset}`);
    const packContent = packRepository(targetDir);
    const packFile = path.join(targetDir, 'contextbase-pack.txt');
    fs.writeFileSync(packFile, packContent, 'utf8');
    console.log(`      ${c.green}✓ Repositorio empaquetado en:${c.reset} contextbase-pack.txt`);
  }

  console.log(`\n${c.green}${c.bold}✨ ¡ContextBase inicializado y 100% automatizado!${c.reset}`);
  console.log(`${c.dim}OpenCode, Kilo Code, Claude Code y demás agentes ahora operan de forma automática sin requerir comandos manuales.${c.reset}\n`);
}

/**
 * Comando: contextbase status
 */
export function runStatus(targetDir = process.cwd(), options = {}) {
  const state = collectState(targetDir);
  if (options.json) { console.log(JSON.stringify(state, null, 2)); return state; }
  banner();
  const contextDir = path.join(targetDir, 'contextbase');

  if (!fs.existsSync(contextDir)) {
    console.log(`${c.yellow}⚠️ No se encontró la carpeta 'contextbase/' en este directorio.${c.reset}`);
    console.log(`   Ejecuta ${c.green}contextbase init${c.reset} para inicializar la memoria persistente.\n`);
    return;
  }

  const fundamentosPath = path.join(contextDir, 'fundamentos.md');
  const changelogPath = path.join(contextDir, 'changelog.md');
  const tasklistPath = path.join(contextDir, 'tasklist.md');
  const componentesPath = path.join(contextDir, 'componentes.md');

  console.log(`${c.bold}ESTADO DE LA MEMORIA TÉCNICA (${targetDir}):${c.reset}\n`);

  const files = [
    { name: 'fundamentos.md', path: fundamentosPath },
    { name: 'changelog.md', path: changelogPath },
    { name: 'tasklist.md', path: tasklistPath },
    { name: 'componentes.md', path: componentesPath }
  ];

  for (const f of files) {
    if (fs.existsSync(f.path)) {
      const stat = fs.statSync(f.path);
      const mod = stat.mtime.toLocaleDateString('es-ES') + ' ' + stat.mtime.toLocaleTimeString('es-ES');
      console.log(`  ${c.green}●${c.reset} ${c.bold}${f.name}${c.reset} ${c.gray}(Modificado: ${mod}, ${stat.size} bytes)${c.reset}`);
    } else {
      console.log(`  ${c.red}○${c.reset} ${c.bold}${f.name}${c.reset} ${c.red}(Faltante)${c.reset}`);
    }
  }

  if (fs.existsSync(componentesPath)) {
    const dias = Math.floor((Date.now() - fs.statSync(componentesPath).mtimeMs) / 86400000);
    if (dias > 7) {
      console.log(`\n${c.yellow}⚠ Informe de componentes desactualizado (${dias} días). Regenerar con:${c.reset} ${c.green}contextbase audit${c.reset}`);
    }
  } else {
    console.log(`\n${c.yellow}⚠ Falta contextbase/componentes.md. Generar con:${c.reset} ${c.green}contextbase audit${c.reset}`);
  }

  if (state.web) {
    console.log(`\n${c.bold}TELARAÑA ACTIVA (${state.web.run}):${c.reset} Flujo ${c.cyan}${state.web.flowState}${c.reset} | Arañas: ${state.web.spiders} | Ahorro tokens: ${state.web.savingsPct ?? 80}%`);
  } else {
    console.log(`\n${c.bold}TELARAÑA / SWARM:${c.reset} orquestación aislada por worktrees y Árbitro Automático. Ver: ${c.cyan}contextbase web flow${c.reset}`);
  }

  if (state.tasks) {
    const doneCount = state.tasks.done.length;
    const pendingCount = state.tasks.pending.length;
    const total = state.tasks.total;
    const pct = state.tasks.pct;

    console.log(`\n${c.bold}PROGRESO DE TAREAS:${c.reset}`);
    console.log(`  ${c.green}✓ Completadas:${c.reset} ${doneCount}`);
    console.log(`  ${c.yellow}⏳ Pendientes:${c.reset}  ${pendingCount}`);
    console.log(`  ${c.cyan}📊 Total:${c.reset}       ${total} (${pct}% completado)`);
  }

  if (state.security.critical > 0 || state.security.high > 0) {
    console.log(`\n${c.red}⚠ Brechas de seguridad:${c.reset} critical ${state.security.critical}, high ${state.security.high} (ver contextbase/componentes.md)`);
  }

  const ownVersion = readOwnVersion();
  const drift = state.rules.versions.filter(r => r.version !== ownVersion);
  if (drift.length > 0) {
    console.log(`\n${c.yellow}⚠ Reglas de agente desactualizadas (v${drift[0].version} → v${ownVersion}):${c.reset} ${drift.map(d => d.file).join(', ')}`);
    console.log(`  Sincronizar con: ${c.green}contextbase sync${c.reset}`);
  }

  if (options.check) {
    const health = evaluateHealth(state, ownVersion);
    if (health.ok) { console.log(`${c.green}✓ Salud OK${c.reset}\n`); } else { console.log(`${c.red}✗ Salud con problemas:${c.reset}`); for (const p of health.problems) console.log(`  - ${p}`); console.log(''); process.exitCode = 1; }
  }
  return state;
}

/**
 * Comando: contextbase task
 */
export function runTask(action, taskText, targetDir = process.cwd(), scope = null) {
  const baseDir = scope ? path.join(targetDir, 'contextbase', sanitizeScope(scope)) : path.join(targetDir, 'contextbase');
  if (scope) fs.mkdirSync(baseDir, { recursive: true });
  const tasklistPath = path.join(baseDir, 'tasklist.md');
  if (scope && !fs.existsSync(tasklistPath)) { fs.mkdirSync(baseDir, { recursive: true }); fs.writeFileSync(tasklistPath, '# Tasklist (' + sanitizeScope(scope) + ')\n\n## Tareas Completadas\n\n## Tareas Pendientes / En Progreso\n', 'utf8'); }
  if (!fs.existsSync(tasklistPath)) {
    console.log(`${c.red}Error: No existe contextbase/tasklist.md. Ejecuta 'contextbase init' primero.${c.reset}`);
    return;
  }

  let content = fs.readFileSync(tasklistPath, 'utf8');

  if (action === 'add') {
    if (!taskText) {
      console.log(`${c.yellow}Uso: contextbase task add "<descripción de la tarea>"${c.reset}`);
      process.exitCode = 2;
      return;
    }
    const targetHeader = '## Tareas Pendientes / En Progreso';
    const newTask = `- [ ] ${taskText.trim()}`;
    if (content.includes(targetHeader)) {
      content = content.replace(targetHeader, `${targetHeader}\n${newTask}`);
    } else {
      content += `\n${targetHeader}\n${newTask}\n`;
    }
    withLock(tasklistPath, () => writeAtomic(tasklistPath, content));
    console.log(`${c.green}✓ Tarea agregada con éxito:${c.reset} ${taskText}`);
    try { refreshStrands(targetDir); } catch {}
  } else if (action === 'done') {
    if (!taskText) {
      console.log(`${c.yellow}Uso: contextbase task done "<texto o parte de la tarea>"${c.reset}`);
      process.exitCode = 2;
      return;
    }
    const lines = content.split('\n');
    let matched = false;
    const query = taskText.toLowerCase();
    let completedLine = null;
    const remainingLines = [];

    for (let i = 0; i < lines.length; i++) {
      if (!matched && lines[i].includes('[ ]') && lines[i].toLowerCase().includes(query)) {
        completedLine = lines[i].replace('[ ]', '[x]');
        matched = true;
        console.log(`${c.green}✓ Tarea completada:${c.reset} ${completedLine.replace('- [x]', '').trim()}`);
      } else {
        remainingLines.push(lines[i]);
      }
    }

    if (matched && completedLine) {
      let newContent = remainingLines.join('\n');
      const compHeader = '## Tareas Completadas';
      if (newContent.includes(compHeader)) {
        newContent = newContent.replace(compHeader, `${compHeader}\n${completedLine}`);
      } else {
        newContent = `${compHeader}\n${completedLine}\n\n${newContent}`;
      }
      withLock(tasklistPath, () => writeAtomic(tasklistPath, newContent));
      try { refreshStrands(targetDir); } catch {}
    } else {
      console.log(`${c.yellow}No se encontró ninguna tarea pendiente que coincida con:${c.reset} "${taskText}"`);
    }
  } else if (action === 'list') {
    const lines = content.split('\n');
    console.log(`\n${c.bold}LISTA DE TAREAS:${c.reset}\n`);
    for (const line of lines) {
      if (line.includes('[x]')) {
        console.log(`  ${c.green}${line}${c.reset}`);
      } else if (line.includes('[ ]')) {
        console.log(`  ${c.yellow}${line}${c.reset}`);
      } else if (line.startsWith('## ')) {
        console.log(`\n${c.bold}${c.cyan}${line}${c.reset}`);
      }
    }
    console.log('\n');
  }
}

/**
 * Comando: contextbase log
 */
function deriveScope(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
    if (out && out !== 'HEAD') return sanitizeScope(out);
  } catch {}
  return sanitizeScope(path.basename(path.resolve(cwd)));
}

function sanitizeScope(s) { return String(s || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'; }

export function runLog(logMessage, targetDir = process.cwd(), scope = null) {
  if (!logMessage) {
    console.log(`${c.yellow}Uso: contextbase log "<mensaje del cambio realizado>"${c.reset}`);
    process.exitCode = 2;
    return;
  }

  const baseDir = scope ? path.join(targetDir, 'contextbase', sanitizeScope(scope)) : path.join(targetDir, 'contextbase');
  if (scope) fs.mkdirSync(baseDir, { recursive: true });
  const changelogPath = path.join(baseDir, 'changelog.md');
  if (scope && !fs.existsSync(changelogPath)) { fs.mkdirSync(baseDir, { recursive: true }); fs.writeFileSync(changelogPath, '# Changelog (' + sanitizeScope(scope) + ')\n\n## Cambios Realizados\n', 'utf8'); }
  if (!fs.existsSync(changelogPath)) {
    console.log(`${c.red}Error: No existe contextbase/changelog.md. Ejecuta 'contextbase init' primero.${c.reset}`);
    return;
  }

  const cleanMessage = String(logMessage).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `- [${dateStr}] ${cleanMessage}`;
  const limit = 500;
  const result = withLock(changelogPath, () => {
    const current = fs.readFileSync(changelogPath, 'utf8');
    const next = appendEntry(current, newEntry, limit);
    writeAtomic(changelogPath, next.content);
    if (next.rotated.length > 0) {
      const archivePath = path.join(targetDir, 'contextbase', `changelog-${new Date().toISOString().slice(0, 4)}.md`);
      const existing = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';
      const body = archiveBody(next.rotated);
      const merged = existing ? existing.replace(/\s*$/, '') + '\n' + next.rotated.join('\n') + '\n' : body;
      writeAtomic(archivePath, merged);
    }
    return next;
  });
  console.log(`${c.green}✓ Cambio registrado en contextbase/changelog.md:${c.reset} ${newEntry}`);
  if (result.rotated.length > 0) {
    console.log(`${c.gray}  (${result.rotated.length} entradas antiguas rotadas a changelog-${new Date().toISOString().slice(0, 4)}.md)${c.reset}`);
  }
  try { refreshStrands(targetDir); } catch {}
}

/**
 * Comando: contextbase dump
 */
export function runDump(targetDir = process.cwd()) {
  const contextDir = path.join(targetDir, 'contextbase');
  if (!fs.existsSync(contextDir)) {
    console.log(`${c.red}Error: No se encontró la carpeta contextbase/.${c.reset}`);
    return;
  }

  const files = ['fundamentos.md', 'changelog.md', 'tasklist.md'];
  for (const file of files) {
    const full = path.join(contextDir, file);
    if (fs.existsSync(full)) {
      console.log(`\n${c.cyan}${c.bold}=== ${file.toUpperCase()} ===${c.reset}\n`);
      console.log(fs.readFileSync(full, 'utf8'));
    }
  }
}

/**
 * Comando: contextbase pack
 */
export function runPack(outputFile, targetDir = process.cwd()) {
  banner();
  console.log(`${c.magenta}[Repomix Engine] Empaquetando código fuente...${c.reset}`);
  const result = packRepository(targetDir);
  const outPath = outputFile || path.join(targetDir, 'contextbase-pack.txt');
  fs.writeFileSync(outPath, result, 'utf8');
  console.log(`${c.green}✓ Repositorio empaquetado exitosamente en:${c.reset} ${outPath}\n`);
}

/**
 * Garantiza que contextbase/ exista y contenga todos los archivos requeridos.
 * Si no existe o le falta algún archivo, lo inicializa automáticamente.
 */
export async function ensureContextBase(targetDir = process.cwd(), silent = false) {
  const contextDir = path.join(targetDir, 'contextbase');
  const fundamentos = path.join(contextDir, 'fundamentos.md');
  const changelog = path.join(contextDir, 'changelog.md');
  const tasklist = path.join(contextDir, 'tasklist.md');

  const isMissing = !fs.existsSync(contextDir) ||
                    !fs.existsSync(fundamentos) ||
                    !fs.existsSync(changelog) ||
                    !fs.existsSync(tasklist);

  if (isMissing) {
    if (!silent) {
      console.log(`${c.yellow}⚡ 'contextbase/' no existe o está incompleto en este proyecto. Inicializando automáticamente...${c.reset}`);
    }
    await runInit(targetDir, { force: false });
    return true;
  }
  try { autoEnsure(targetDir); } catch {}
  return false;
}

/**
 * CLI Router Principal
 */
export async function cli(args = process.argv.slice(2)) {
  if (args.length === 0) {
    const contextDir = path.join(process.cwd(), 'contextbase');
    if (!fs.existsSync(contextDir)) {
      await runInit(process.cwd());
    } else {
      await ensureContextBase(process.cwd(), true);
      runStatus(process.cwd());
    }
    return;
  }

  const command = args[0];

  if (command === '--help' || command === '-h' || command === 'help') {
    showHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(readOwnVersion());
    return;
  }

  if (command === 'hook-run') {
    const evt = args[1] || 'session-start';
    const extra = args.slice(2);
    const out = await runLifecycleHook(evt, process.cwd(), extra);
    if (out) process.stdout.write(String(out) + '\n');
    return;
  }

  if (command === 'auto' || command === 'setup') {
    const silent = args.includes('--silent') || args.includes('-s');
    const globalOnly = args.includes('--global');
    const isJson = args.includes('--json');

    const autoFailures = [];
    let globalFiles = [];
    try {
      globalFiles = installSkill('global', process.cwd());
      const g = autoConfigureGlobal({ forceGlobal: globalOnly });
      globalFiles.push(...g.files);
      autoFailures.push(...g.failures);
    } catch (err) {
      autoFailures.push(reportConfigError('CONFIG_WRITE_FAILED', 'auto|setup', err.message));
    }

    if (globalOnly) {
      if (autoFailures.length) process.exitCode = 1;
      if (isJson) console.log(JSON.stringify({ ok: autoFailures.length === 0, failures: autoFailures, globalFiles }, null, 2));
      else if (!silent) console.log(`${c.green}✓ Entorno global autoconfigurado (${globalFiles.length} rutas).${c.reset}`);
      return;
    }

    const ensured = autoEnsure(process.cwd(), { autoConfig: true, installSkill: true });
    const projCfg = autoConfigureProject(process.cwd(), { includeAll: args.includes('--all') });
    autoFailures.push(...(projCfg.failures || []));
    const wsSync = syncWorkspaceChanges(process.cwd());

    if (args.includes('--daemon') || args.includes('--watch')) {
      const dm = startDaemonWatcher(process.cwd());
      ensured.daemon = dm;
    }

    if (isJson) {
      console.log(JSON.stringify({ ok: autoFailures.length === 0, failures: autoFailures, ensured, configured: projCfg.files, synced: wsSync, globalFiles }, null, 2));
    } else if (!silent) {
      banner();
      console.log(`${c.green}✓ Automatización completa activada en:${c.reset} ${process.cwd()}`);
      console.log(`  - Archivos de agentes configurados: ${projCfg.files.join(', ')}`);
      console.log(`  - Skills y plugins globales sincronizados: ${globalFiles.length}`);
      if (ensured.daemon) console.log(`  - Watcher en segundo plano activo (PID: ${ensured.daemon.pid})`);
      console.log('');
    }
    if (autoFailures.length) {
      console.error('\x1b[31m⚠ Configuración incompleta (' + autoFailures.length + ' fallo(s)):\x1b[0m');
      for (const f of autoFailures) { console.error('  - [' + (f.code || 'CONFIG') + '] ' + (f.message || '') + (f.file ? ' (' + f.file + ')' : '')); }
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'watch' || command === 'daemon') {
    await ensureContextBase(process.cwd(), true);
    const sub = args[1] || (args.includes('--foreground') ? 'foreground' : 'start');
    if (sub === 'stop') {
      const r = stopDaemonWatcher(process.cwd());
      console.log(r.stopped ? `${c.green}✓ Watcher detenido (PID ${r.pid}).${c.reset}` : `${c.gray}No había watcher en ejecución.${c.reset}`);
      return;
    }
    if (sub === 'status') {
      const r = statusDaemonWatcher(process.cwd());
      if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
      else console.log(r.running ? `${c.green}● Watcher activo (PID ${r.pid}, desde ${r.startedAt}).${c.reset}` : `${c.yellow}○ Watcher inactivo.${c.reset}`);
      return;
    }
    if (sub === 'foreground' || args.includes('--foreground')) {
      const watcher = startWatcher(process.cwd(), { unref: false, pollMs: 3000 });
      if (!args.includes('--silent')) {
        console.log(`${c.cyan}👁 ContextBase Watcher + Árbitro activo en ${process.cwd()} (Ctrl+C para detener)...${c.reset}`);
      }
      process.on('SIGINT', () => { watcher.close(); process.exit(0); });
      process.on('SIGTERM', () => { watcher.close(); process.exit(0); });
      await new Promise(() => {});
      return;
    }
    const r = startDaemonWatcher(process.cwd());
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else console.log(`${c.green}✓ Watcher iniciado en segundo plano (PID ${r.pid}).${c.reset}`);
    return;
  }

  if (command === 'init') {
    const force = args.includes('--force');
    const pack = args.includes('--pack');
    await runInit(process.cwd(), { force, pack });
    return;
  }

  if (command === 'ensure') {
    await ensureContextBase(process.cwd());
    return;
  }

  if (command === 'status' || command === 'check') {
    await ensureContextBase(process.cwd());
    runStatus(process.cwd(), { json: args.includes('--json'), check: args.includes('--check') || command === 'check' });
    return;
  }

  if (command === 'sync') {
    await ensureContextBase(process.cwd());
    banner();
    const analysis = analyzeProject(process.cwd());
    const updated = syncFundamentos(process.cwd(), analysis);
    const rules = injectAgentRules(process.cwd());
    const ws = syncWorkspaceChanges(process.cwd());
    try { refreshBaseline(process.cwd()); } catch {}
    if (updated) console.log(`${c.green}✓ Bloque técnico sincronizado en:${c.reset} contextbase/fundamentos.md`);
    if (ws.synced && ws.files.length > 0) console.log(`${c.green}✓ Árbol de trabajo sincronizado:${c.reset} ${ws.files.join(', ')}`);
    console.log(`${c.green}✓ Reglas de agente reinyectadas en:${c.reset} ${rules.join(', ')}`);
    const st = collectState(process.cwd());
    if (!st.files['componentes.md'].exists || st.files['componentes.md'].days > 7) {
      console.log(`${c.yellow}⚠ Informe de componentes pendiente. Ejecutar:${c.reset} contextbase audit`);
    }
    try { refreshStrands(process.cwd()); } catch {}
    console.log('');
    return;
  }

  if (command === 'hook') {
    const result = installGitHook(process.cwd(), args[1] || 'install');
    console.log((result.ok ? c.green + '✓ ' : c.red + '✗ ') + result.message + c.reset);
    return;
  }

  if (command === 'review') {
    const rest = args.slice(1);
    let intent = '';
    const clean = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--intent') { intent = rest[++i] || ''; continue; }
      if (rest[i] === '--json') { clean.push('--json'); continue; }
      clean.push(rest[i]);
    }
    if (clean[0] === 'prompts') { console.log(review.promptsText()); return; }
    if (clean[0] === 'merge') {
      const files = clean.slice(1);
      if (files.length < 2) throw new Error('Uso: contextbase review merge <reporte-a.md> <reporte-b.md>');
      const reports = files.map(f => {
        if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('Reporte no encontrado: ' + f);
        return fs.readFileSync(f, 'utf8');
      });
      console.log(review.merge(reports));
      return;
    }
    const jsonMode = clean.includes('--json');
    const baseArg = clean.filter(x => x !== '--json')[0];
    console.log(review.prepare(process.cwd(), { base: baseArg, intent, json: jsonMode }));
    return;
  }

  if (command === 'redundancy') {
    const r = redundancy.scan();
    console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : redundancy.render(r));
    return;
  }

  if (command === 'slop') {
    const baseRef = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
    const r = slop.scan(process.cwd(), { base: baseRef });
    console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : slop.render(r));
    process.exitCode = r.findings.length > 0 ? 1 : 0;
    return;
  }

  if (command === 'export') {
    const rest = args.slice(1);
    const flagMap = {};
    const positionals = [];
    for (const a of rest) {
      const s = String(a);
      if (s.startsWith('--')) {
        const eq = s.indexOf('=');
        const key = eq > 0 ? s.slice(2, eq) : s.slice(2);
        const val = eq > 0 ? s.slice(eq + 1) : true;
        flagMap[key] = val;
      } else positionals.push(s);
    }
    const pick = (v) => (typeof v === 'string' && v ? v : undefined);
    const type = pick(flagMap.tipo) || pick(flagMap.type) || positionals[0] || 'estado';
    const format = pick(flagMap.formato) || pick(flagMap.fmt)
      || (flagMap.json ? 'json' : flagMap.html ? 'html' : positionals[1] || 'json');
    const output = pick(flagMap.output) || pick(flagMap.out) || positionals[2];
    if (!['estado', 'digest'].includes(String(type))) {
      console.error(`${c.red}Error: tipo no soportado: ${type} (usa "estado" o "digest")${c.reset}`);
      process.exitCode = 1;
      return;
    }
    if (!['json', 'html'].includes(String(format))) {
      console.error(`${c.red}Error: formato no soportado: ${format} (usa "json" o "html")${c.reset}`);
      process.exitCode = 1;
      return;
    }
    const result = exp.exportCommand(process.cwd(), { type: String(type) === 'digest' ? 'digest' : 'state', format: String(format), output });
    if (output) {
      console.log(`${c.green}✓ Exportado en:${c.reset} ${result.written} (${result.mimeType})`);
    } else {
      console.log(result.content);
    }
    return;
  }

  if (command === 'strands') {
    const sub = args[1] || 'sdk';
    if (sub !== 'sdk') {
      console.error(`${c.red}Error: subcomando de strands no soportado: ${sub} (usa: strands sdk)${c.reset}`);
      process.exitCode = 2;
      return;
    }
    const mode = args.includes('--install') ? 'install' : args.includes('--auto') ? 'auto' : 'status';
    const { ensureStrandsSdk } = await import('./strands.js');
    const res = ensureStrandsSdk(process.cwd(), { mode });
    if (args.includes('--json')) { console.log(JSON.stringify(res, null, 2)); }
    else {
      console.log(`${c.bold}SDK de Strands:${c.reset} ${res.installed ? c.green + 'instalado' : c.yellow + 'no instalado'}${res.version ? ' (v' + res.version + ')' : ''} | accion: ${res.action}`);
      if (!res.installed && res.reason) console.log(`  ${c.dim}${res.reason}${c.reset}`);
      if (res.log) console.log(`  ${c.dim}log de instalacion: ${res.log}${c.reset}`);
      if (res.action === 'scheduled') console.log(`  ${c.dim}instalacion lanzada en segundo plano (pid ${res.pid}); se registra en contextbase/strands/sdk.json${c.reset}`);
    }
    if (res.action === 'failed' || res.action === 'disabled') process.exitCode = 1;
    return;
  }

  if (command === 'mcp') {
    await startMcpServer(process.cwd());
    return;
  }

  if (command === 'context') {
    await ensureContextBase(process.cwd());
    if (args.includes('--json')) { console.log(JSON.stringify(collectState(process.cwd()), null, 2)); } else { console.log(buildDigest(collectState(process.cwd()), readOwnVersion())); }
    return;
  }

  if (command === 'pack') {
    const out = args[1];
    runPack(out, process.cwd());
    return;
  }

  if (command === 'audit') {
    await ensureContextBase(process.cwd());
    banner();
    console.log(`${c.magenta}[Mantenimiento] Inventario de componentes + verificación de brechas de seguridad...${c.reset}`);
    try {
      const maint = runMaintenance(process.cwd());
      for (const s of maint.security) {
        console.log(`  ${c.yellow}•${c.reset} ${s.eco}: ${s.detail.replace(/\n/g, ' | ')}`);
      }
      console.log(`${c.green}✓ Informe regenerado en:${c.reset} contextbase/componentes.md\n`);
    } catch (e) {
      console.log(`${c.red}Error en mantenimiento preventivo: ${e.message}${c.reset}\n`);
    }
    try { refreshStrands(process.cwd()); } catch {}
    return;
  }

  if (command === 'dump') {
    await ensureContextBase(process.cwd());
    runDump(process.cwd());
    return;
  }

  if (command === 'install-skill') {
    const installed = installSkill('all', process.cwd());
    console.log(`${c.green}✓ Skill instalada en:${c.reset}\n${installed.join('\n')}`);
    return;
  }

  if (command === 'log') {
    await ensureContextBase(process.cwd());
    const msg = args.filter(a => !a.startsWith('--')).slice(1).join(' ');
    const scopeFlag = (args.find(a => a.startsWith('--scope=')) || '').replace('--scope=', '');
    const autoScope = args.includes('--worktree') || args.includes('--auto-scope');
    const scope = scopeFlag || (autoScope ? deriveScope(process.cwd()) : null);
    runLog(msg, process.cwd(), scope);
    return;
  }

  if (command === 'task') {
    await ensureContextBase(process.cwd());
    const subAction = args[1] || 'list';
    const text = args.filter(a => !a.startsWith('--')).slice(2).join(' ');
    const scopeFlag = (args.find(a => a.startsWith('--scope=')) || '').replace('--scope=', '');
    const autoScope = args.includes('--worktree') || args.includes('--auto-scope');
    const scope = scopeFlag || (autoScope ? deriveScope(process.cwd()) : null);
    runTask(subAction, text, process.cwd(), scope);
    return;
  }

  if (await runExtra(command, args, process.cwd())) return;

  console.log(`${c.red}Comando no reconocido: ${command}${c.reset}\n`);
  process.exitCode = 2;
  showHelp();
}
