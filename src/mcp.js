import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { autoEnsure, refreshStrands } from './auto.js';
import { collectState, buildDigest } from './context.js';
import { startWatcher, syncWorkspaceChanges } from './watcher.js';
import { autoConfigureProject } from './autoconfig.js';

const pkg = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); } catch { return {}; } })();

const PROTOCOL = '2024-11-05';
const SERVER = { name: 'contextbase', version: pkg.version || '0.0.0' };

const MUTATING_TOOLS = new Set([
  'contextbase_log',
  'contextbase_task',
  'contextbase_audit',
  'contextbase_sync',
  'contextbase_restore',
  'contextbase_guard',
  'contextbase_strands_prepare',
  'contextbase_init',
  'contextbase_hook',
  'contextbase_swarm_start',
  'contextbase_swarm_send',
  'contextbase_swarm_stop'
]);

const TOOLS = [
  { name: 'contextbase_status', description: 'Estado estructurado de la memoria del proyecto: archivos, tareas, seguridad, Telaraña y salud.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_context', description: 'Digest compacto para iniciar sesion: pendientes, progreso, seguridad, Telaraña y siguiente accion.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_log', description: 'Registra un cambio realizado en contextbase/changelog.md.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_task', description: 'Gestiona tareas: action add|done|list con text opcional.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, text: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'contextbase_audit', description: 'Regenera inventario de componentes, frescura de versiones y brechas de seguridad.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_sync', description: 'Sincroniza bloque tecnico de fundamentos.md, cambios del arbol de trabajo y reglas de agente.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_bootstrap', description: 'Bootstrap del entorno de agentes: detecta CLIs, instala faltantes, init y snapshot.', inputSchema: { type: 'object', properties: { cli: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } }, yes: { type: 'boolean' }, autoConfirmRest: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_guard', description: 'Verifica integridad de archivos base; opcionalmente repara desde fuentes oficiales.', inputSchema: { type: 'object', properties: { check: { type: 'boolean' }, repair: { type: 'boolean' }, show: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_snapshot', description: 'Crea punto de restauracion de archivos base.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_restore', description: 'Restaura archivos base desde snapshot (id opcional).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_tools', description: 'Lista/habilita/deshabilita herramientas del registro o consulta/registra agentes universales y control soberano.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, cmd: { type: 'string' }, intent: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_review', description: 'Review tipo thermos: modo prepare arma diff + contenidos + intencion + los 2 prompts de revisor; modo prompts devuelve solo prompts; modo merge fusiona dos reportes.', inputSchema: { type: 'object', properties: { mode: { type: 'string' }, base: { type: 'string' }, intent: { type: 'string' }, reports: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'contextbase_redundancy', description: 'Detecta redundancia en el entorno global: skills duplicados entre ubicaciones, referencias rotas en commands/agents, bloques de AGENTS.md y MCP duplicados.', inputSchema: { type: 'object', properties: { json: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_slop', description: 'Delivery gate antislop: escanea las lineas agregadas del diff con reglas heuristas de copy, comentarios y estructura.', inputSchema: { type: 'object', properties: { base: { type: 'string' }, json: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_export', description: 'Exporta el estado o digest del proyecto en formato JSON o HTML.', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'estado o digest' }, format: { type: 'string', description: 'json o html' }, output: { type: 'string', description: 'ruta de archivo de salida opcional' } }, additionalProperties: false } },
  { name: 'contextbase_strands_prepare', description: 'Prepara el contexto del proyecto para Strands Agent (Python): genera contextbase/strands/ con project_context.py, strands_config.py, tasks.py y context.json. Gestiona el SDK de Strands de forma autonoma: sdk=status (informe), sdk=install (instala y verifica), sdk=auto (instala en segundo plano).', inputSchema: { type: 'object', properties: { sdk: { type: 'string', enum: ['status', 'install', 'auto'] } }, additionalProperties: false } },
  { name: 'contextbase_init', description: 'Garantiza la memoria ContextBase y autoconfigura agentes (OpenCode, Kilo, Claude, Cursor y puentes universales) sin intervencion manual.', inputSchema: { type: 'object', properties: { autoConfig: { type: 'boolean' }, universal: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_hook', description: 'Ejecuta o instala hooks automaticos (install|remove|session-start|post-tool|session-stop|web-pulse).', inputSchema: { type: 'object', properties: { action: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'contextbase_mission', description: 'Devuelve el prompt de mision de orquestacion y testing (Lead Orchestrator).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_egm_review', description: 'Modelo de calidad EGM (Elephant-Goldfish) nativo: revision adversarial por severidad (blocker/major/nit) con 10 personas y 5 estandares, deteccion de drift doc-codigo y convergencia por rondas limpias. action=review (target opcional), action=drift, action=personas|standards|skills.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['review', 'drift', 'personas', 'standards', 'skills'] }, target: { type: 'string' }, base: { type: 'string' }, docs: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'contextbase_swarm_start', description: 'Lanza la Telaraña / Enjambre sobre la Presa: un worktree pre-hidratado, hilo disjunto, 3 subagentes secuenciales y una sesion por Araña (con universal: true soporta cualquier agente del mercado).', inputSchema: { type: 'object', properties: { task: { type: 'string' }, prey: { type: 'string' }, workers: { type: 'number' }, spiders: { type: 'number' }, agent: { type: 'string' }, universal: { type: 'boolean' }, agentCmd: { type: 'string' }, base: { type: 'string' }, ttl: { type: 'number' } }, additionalProperties: false } },
  { name: 'contextbase_swarm_status', description: 'Estado de las Arañas/workers, Zona de Flujo, Economia de Tokens y Árbitro Automático (pasar arbitrate: true para evaluar PASS/REFIX/RERUN/FAIL, flow: true para flow.md o metrics: true para metrics.json).', inputSchema: { type: 'object', properties: { run: { type: 'string' }, arbitrate: { type: 'boolean' }, flow: { type: 'boolean' }, metrics: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_swarm_send', description: 'Envia un mensaje u orden de REFIX a una Araña/worker (o all). Entrega nativa en la sesion viva o por archivo.', inputSchema: { type: 'object', properties: { worker: { type: 'string' }, spider: { type: 'string' }, message: { type: 'string' }, run: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_swarm_collect', description: 'Reune result.md de cada Araña, da veredicto de merge por rama (clean/conflict) y opcionalmente ejecuta arbitrate o weave.', inputSchema: { type: 'object', properties: { run: { type: 'string' }, arbitrate: { type: 'boolean' }, weave: { type: 'boolean' }, merge: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_swarm_stop', description: 'Detiene los procesos de las Arañas/workers vivos del run.', inputSchema: { type: 'object', properties: { run: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_terminals', description: 'Identifica terminales/procesos de agente abiertos para este proyecto (action=list; solo lectura). Cierra terminales de agente (action=close: por defecto DRY-RUN, confirm=true ejecuta; nunca cierra el árbol propio ni procesos no identificados). Cierra automáticamente las terminales cuyo trabajo de Araña ya terminó (action=auto; confirm=true ejecuta, dry-run por defecto). Envía trabajo por contrato nativo (action=send, requiere pid y message): opencode run --session / kilo run --session; agentes sin sesión nativa devuelven isError con sus capacidades.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'close', 'auto', 'send'] }, targets: { type: 'array', items: {} }, pid: { type: 'number' }, message: { type: 'string' }, confirm: { type: 'boolean' }, force: { type: 'boolean' }, includeStale: { type: 'boolean' } }, required: ['action'], additionalProperties: false } }
];

const RESOURCES = [
  { uri: 'contextbase://digest', name: 'ContextBase Digest', description: 'Digest compacto del estado actual del proyecto', mimeType: 'text/markdown' },
  { uri: 'contextbase://state', name: 'ContextBase State JSON', description: 'Estado estructurado completo del proyecto', mimeType: 'application/json' },
  { uri: 'contextbase://fundamentos', name: 'Fundamentos del Proyecto', description: 'Arquitectura, stack y reglas operativas (contextbase/fundamentos.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://changelog', name: 'Bitacora del Proyecto', description: 'Historial de cambios realizados y pendientes (contextbase/changelog.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://tasklist', name: 'Lista de Tareas', description: 'Tareas pendientes y completadas (contextbase/tasklist.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://componentes', name: 'Inventario y Seguridad', description: 'Componentes instalados y brechas de seguridad (contextbase/componentes.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://strands/context', name: 'Contexto Strands JSON', description: 'Estado completo para Strands Agent (contextbase/strands/context.json)', mimeType: 'application/json' },
  { uri: 'contextbase://web/flow', name: 'Telaraña Zona de Flujo', description: 'Tablero de Zona de Flujo y Economía de Tokens (contextbase/web/<run>/flow.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://web/metrics', name: 'Telaraña Métricas JSON', description: 'Métricas de cumplimiento, ahorro de tokens y Árbitro Automático', mimeType: 'application/json' },
  { uri: 'contextbase://control/obedience', name: 'Gobernanza Soberana', description: 'Reporte de obediencia e Índice de Control Soberano (0-100)', mimeType: 'application/json' }
];

const PROMPTS = [
  {
    name: 'contextbase_session',
    description: 'Carga automaticamente el contexto persistente y las tareas pendientes al iniciar sesion.',
    arguments: []
  },
  {
    name: 'contextbase_mission',
    description: 'Carga el protocolo Lead Orchestrator para ejecucion resiliente y cobertura de pruebas.',
    arguments: []
  }
];

async function readResourceContent(uri, projectDir) {
  const state = collectState(projectDir);
  if (uri === 'contextbase://digest') {
    return { uri, mimeType: 'text/markdown', text: buildDigest(state, SERVER.version) };
  }
  if (uri === 'contextbase://state') {
    return { uri, mimeType: 'application/json', text: JSON.stringify(state, null, 2) };
  }
  if (uri === 'contextbase://web/flow') {
    const run = state.web && state.web.run;
    const p = run ? path.join(projectDir, 'contextbase', 'web', run, 'flow.md') : '';
    const text = p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '# Sin corrida activa de Telaraña';
    return { uri, mimeType: 'text/markdown', text };
  }
  if (uri === 'contextbase://web/metrics') {
    const run = state.web && state.web.run;
    const p = run ? path.join(projectDir, 'contextbase', 'web', run, 'metrics.json') : '';
    const text = p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : JSON.stringify({ active: false }, null, 2);
    return { uri, mimeType: 'application/json', text };
  }
  if (uri === 'contextbase://control/obedience') {
    const ctrl = await import('./control.js');
    return { uri, mimeType: 'application/json', text: JSON.stringify(ctrl.verifyAgentObedience(projectDir), null, 2) };
  }
  if (uri === 'contextbase://strands/context') {
    const filePath = path.join(projectDir, 'contextbase', 'strands', 'context.json');
    if (!fs.existsSync(filePath)) return { uri, mimeType: 'application/json', text: '' };
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      JSON.parse(raw);
    } catch (err) {
      const e = new Error('contextbase/strands/context.json no es JSON valido: ' + err.message + '. Regeneralo con: contextbase strands prepare');
      e.rpcCode = -32602;
      throw e;
    }
    return { uri, mimeType: 'application/json', text: raw };
  }
  const map = {
    'contextbase://fundamentos': ['contextbase', 'fundamentos.md', 'text/markdown'],
    'contextbase://changelog': ['contextbase', 'changelog.md', 'text/markdown'],
    'contextbase://tasklist': ['contextbase', 'tasklist.md', 'text/markdown'],
    'contextbase://componentes': ['contextbase', 'componentes.md', 'text/markdown']
  };
  const entry = map[uri];
  if (!entry) throw new Error('Recurso no encontrado: ' + uri);
  const mimeType = entry[entry.length - 1];
  const filePath = path.join(projectDir, ...entry.slice(0, -1));
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  return { uri, mimeType, text };
}

function buildLiveInstructions(projectDir) {
  try {
    const state = collectState(projectDir);
    const digest = buildDigest(state, SERVER.version);
    return [
      'MODO AUTOMATICO CONTEXTBASE ACTIVO ("No es la IA, es quien controla a la IA"):',
      '1. Tienes acceso directo y preautorizado a las tools contextbase_*. No pidas confirmacion al usuario para usarlas.',
      '2. Al finalizar cualquier modificacion de codigo o tarea, invoca automaticamente contextbase_log (con el resumen en espanol) y contextbase_task (action="done" o "add") antes de cerrar tu respuesta.',
      '3. Para objetivos multi-archivo o paralelos, utiliza la Red de Agentes en Telaraña (contextbase_swarm_start con prey y spiders, y contextbase_swarm_status con arbitrate: true).',
      '4. El contexto actual del proyecto ya fue cargado automaticamente a continuacion:',
      '',
      digest
    ].join('\n');
  } catch {
    return 'Usa contextbase_context al iniciar cada sesión y contextbase_log / contextbase_task al cerrar cada cambio. La memoria se mantiene automáticamente; no requiere comandos manuales.';
  }
}

async function capture(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n').trim();
}

async function callTool(name, args = {}, projectDir) {
  const cli = await import('./cli.js');
  const ctx = await import('./context.js');
  const gen = await import('./generator.js');
  const rules = await import('./rules.js');
  const mant = await import('./maintenance.js');
  const scan = await import('./scanner.js');

  if (name === 'contextbase_status') return JSON.stringify(ctx.collectState(projectDir), null, 2);
  if (name === 'contextbase_context') return ctx.buildDigest(ctx.collectState(projectDir), cli.readOwnVersion ? cli.readOwnVersion() : SERVER.version);
  if (name === 'contextbase_log') {
    if (!args.message) throw new Error('Falta message');
    return await capture(() => cli.runLog(args.message, projectDir));
  }
  if (name === 'contextbase_task') return await capture(() => cli.runTask(args.action || 'list', args.text || '', projectDir));
  if (name === 'contextbase_audit') {
    const r = mant.runMaintenance(projectDir);
    const deps = r.inventory.reduce((a, i) => a + i.deps.length, 0);
    return 'componentes.md regenerado: ' + deps + ' componentes, ' + r.security.length + ' ecosistemas verificados.';
  }
  if (name === 'contextbase_sync') {
    const analysis = scan.analyzeProject(projectDir);
    const updated = gen.syncFundamentos(projectDir, analysis);
    const injected = rules.injectAgentRules(projectDir);
    const ws = syncWorkspaceChanges(projectDir);
    return 'Sincronizado: ' + (updated ? 'fundamentos.md, ' : '') + (ws.synced ? 'arbol de trabajo, ' : '') + 'reglas en ' + injected.join(', ');
  }
  if (name === 'contextbase_bootstrap') {
    const bootstrap = await import('./bootstrap.js');
    return JSON.stringify(await bootstrap.run(projectDir, args || {}));
  }
  if (name === 'contextbase_guard') {
    const guard = await import('./guard.js');
    const checkRes = guard.check(projectDir);
    const repairs = [];
    if (args && args.repair && Array.isArray(checkRes.drifts)) {
      for (const d of checkRes.drifts) {
        if (guard.REPAIR_ALLOWLIST && guard.REPAIR_ALLOWLIST[d.file]) {
          const r = await guard.repair(projectDir, d.file, guard.REPAIR_ALLOWLIST[d.file]);
          repairs.push({ file: d.file, ok: !!r.ok, error: r.error || null });
        }
      }
    }
    let content = null;
    if (args && args.show && Array.isArray(checkRes.drifts)) {
      content = {};
      for (const d of checkRes.drifts) {
        try { content[d.file] = fs.readFileSync(path.join(projectDir, d.file), 'utf8'); } catch {}
      }
    }
    return JSON.stringify({ status: checkRes.status, drifts: checkRes.drifts, repairs, content });
  }
  if (name === 'contextbase_snapshot') {
    const snapshot = await import('./snapshot.js');
    const id = await snapshot.create(projectDir, (args && args.note) || '');
    return String(id);
  }
  if (name === 'contextbase_restore') {
    const snapshot = await import('./snapshot.js');
    const r = await snapshot.restore(projectDir, args && args.id);
    return JSON.stringify(r);
  }
  if (name === 'contextbase_review') {
    const rv = await import('./review.js');
    const mode = (args && args.mode) || 'prepare';
    if (mode === 'prompts') return rv.promptsText();
    if (mode === 'merge') return rv.merge(Array.isArray(args.reports) ? args.reports : []);
    return rv.prepare(projectDir, { base: args && args.base, intent: args && args.intent });
  }
  if (name === 'contextbase_redundancy') {
    const rd = await import('./redundancy.js');
    const r = rd.scan();
    return (args && args.json) ? JSON.stringify(r, null, 2) : rd.render(r);
  }
  if (name === 'contextbase_slop') {
    const sp = await import('./slop.js');
    const r = sp.scan(projectDir, { base: args && args.base });
    return (args && args.json) ? JSON.stringify(r, null, 2) : sp.render(r);
  }
  if (name === 'contextbase_export') {
    const exp = await import('./export.js');
    const type = (args && args.type) || 'estado';
    const format = (args && args.format) || 'json';
    const output = args && args.output;
    const result = exp.exportCommand(projectDir, { type: type === 'digest' ? 'digest' : 'state', format, output });
    return JSON.stringify(result, null, 2);
  }
  if (name === 'contextbase_egm_review') {
    const egm = await import('./egm.js');
    const action = String((args && args.action) || 'review');
    if (action === 'personas') return JSON.stringify(egm.EGM_PERSONAS, null, 2);
    if (action === 'standards') return JSON.stringify(egm.EGM_ESTANDARES, null, 2);
    if (action === 'skills') return JSON.stringify(egm.EGM_SKILLS, null, 2);
    if (action === 'drift') return JSON.stringify(await egm.egmDrift({ cwd: projectDir, docsDir: args.docs }), null, 2);
    const res = await egm.egmReview({ cwd: projectDir, target: args.target || undefined, base: args.base || undefined });
    return JSON.stringify(res, null, 2);
  }
  if (name === 'contextbase_strands_prepare') {
    const strands = await import('./strands.js');
    const result = strands.prepareStrandsContext(projectDir);
    const sdkMode = String((args && args.sdk) || 'status');
    const sdk = strands.ensureStrandsSdk(projectDir, { mode: sdkMode });
    return JSON.stringify({ ...result, sdk }, null, 2);
  }
  if (name === 'contextbase_init') {
    const r = autoEnsure(projectDir, { autoConfig: Boolean(args && args.autoConfig) });
    if (args && (args.autoConfig || args.universal)) {
      r.configured = autoConfigureProject(projectDir, { includeAll: Boolean(args.universal), universal: Boolean(args.universal) }).files;
    }
    return JSON.stringify(r, null, 2);
  }
  if (name === 'contextbase_hook') {
    const hooks = await import('./hooks.js');
    const act = (args && args.action) || 'install';
    if (act === 'install' || act === 'remove' || act === 'uninstall') {
      const r = hooks.installGitHook(projectDir, act);
      return JSON.stringify(r, null, 2);
    }
    const out = await hooks.runLifecycleHook(act, projectDir, Array.isArray(args.files) ? args.files : []);
    return String(out);
  }
  if (name === 'contextbase_tools' || name === 'contextbase_agents' || name === 'contextbase_control') {
    const reg = await import('./registry.js');
    const ua = await import('./universal-agents.js');
    const ctrl = await import('./control.js');
    const action = (args && args.action) || (name === 'contextbase_agents' ? 'agents' : name === 'contextbase_control' ? 'control' : 'list');
    if (action === 'agents') return JSON.stringify(ua.listUniversalAgents(projectDir), null, 2);
    if (action === 'register-agent' && args.name) return JSON.stringify(ua.registerCustomAgent(projectDir, { id: args.name, commandTemplate: args.cmd }), null, 2);
    if (action === 'control') return JSON.stringify(ctrl.verifyAgentObedience(projectDir), null, 2);
    if (action === 'compile-intent') return JSON.stringify(ctrl.compileHumanIntent(projectDir, args.intent || ''), null, 2);
    if (action === 'autopilot') return JSON.stringify(ctrl.runAutopilotCycle(projectDir), null, 2);
    if (action === 'list') return JSON.stringify(reg.getRegistry(projectDir).map(t => ({ id: t.id, name: t.name, enabled: t.enabled, cliSupport: t.cliSupport })));
    if (action === 'enable' && args && args.name) { reg.setEnabled(args.name, true, projectDir); return 'ok'; }
    if (action === 'disable' && args && args.name) { reg.setEnabled(args.name, false, projectDir); return 'ok'; }
    throw new Error('Accion invalida');
  }
  if (name === 'contextbase_mission') {
    const mission = await import('./mission.js');
    return mission.missionText();
  }
  if (name === 'contextbase_swarm_start' || name === 'contextbase_web_start') {
    const sw = await import('./swarm.js');
    const task = args.prey || args.task;
    if (!task) throw new Error('Falta task o prey');
    const workers = args.spiders ?? args.workers;
    const out = sw.startSwarm({
      cwd: projectDir,
      task,
      prey: task,
      workers,
      spiders: workers,
      agent: args.agent,
      universal: Boolean(args.universal),
      agentCmd: args.agentCmd,
      base: args.base,
      ttlMinutes: args.ttl
    });
    return JSON.stringify(out, null, 2);
  }
  if (name === 'contextbase_swarm_status' || name === 'contextbase_web_status' || name === 'contextbase_web_arbitrate' || name === 'contextbase_web_flow' || name === 'contextbase_web_metrics') {
    const sw = await import('./swarm.js');
    const wb = await import('./web.js');
    if (name === 'contextbase_web_arbitrate' || args.arbitrate) {
      return JSON.stringify(wb.arbitrateWeb({ cwd: projectDir, run: args.run }), null, 2);
    }
    if (name === 'contextbase_web_flow' || args.flow) {
      return JSON.stringify(wb.webFlow({ cwd: projectDir, run: args.run }), null, 2);
    }
    if (name === 'contextbase_web_metrics' || args.metrics) {
      return JSON.stringify(wb.webMetrics({ cwd: projectDir, run: args.run }), null, 2);
    }
    return JSON.stringify(sw.swarmStatus({ cwd: projectDir, run: args.run }), null, 2);
  }
  if (name === 'contextbase_swarm_send' || name === 'contextbase_web_send') {
    const sw = await import('./swarm.js');
    if (!args.message) throw new Error('Falta message');
    return JSON.stringify(sw.swarmSend({ cwd: projectDir, run: args.run, worker: args.spider || args.worker, message: args.message }), null, 2);
  }
  if (name === 'contextbase_swarm_collect' || name === 'contextbase_web_collect' || name === 'contextbase_web_weave') {
    const sw = await import('./swarm.js');
    const wb = await import('./web.js');
    if (name === 'contextbase_web_weave' || args.weave) {
      return JSON.stringify(wb.weaveWeb({ cwd: projectDir, run: args.run, merge: Boolean(args.merge) }), null, 2);
    }
    if (args.arbitrate) {
      wb.arbitrateWeb({ cwd: projectDir, run: args.run });
    }
    return JSON.stringify(sw.swarmCollect({ cwd: projectDir, run: args.run }), null, 2);
  }
  if (name === 'contextbase_swarm_stop' || name === 'contextbase_web_stop') {
    const sw = await import('./swarm.js');
    return JSON.stringify(sw.swarmStop({ cwd: projectDir, run: args.run }), null, 2);
  }
  if (name === 'contextbase_terminals') {
    const t = await import('./terminals.js');
    const action = String(args.action || 'list');
    if (action === 'list') {
      return JSON.stringify(t.listTerminals(projectDir), null, 2);
    }
    if (action === 'close') {
      const targets = Array.isArray(args.targets) ? args.targets.filter(x => x !== undefined && x !== null) : [];
      if (targets.length === 0) return JSON.stringify({ ok: false, dryRun: true, targets: [], note: 'close sin targets: nada que cerrar. Usa action=list para identificar pids o targets=["all"] para agentes del proyecto.' }, null, 2);
      const confirm = args.confirm === true;
      const res = t.closeTerminals(targets.map(x => String(x)), { yes: confirm, force: Boolean(args.force), cwd: projectDir });
      return JSON.stringify(res, null, 2);
    }
    if (action === 'auto') {
      const res = await t.autoCloseFinished(projectDir, { includeStale: Boolean(args.includeStale), dryRun: args.confirm !== true });
      return JSON.stringify(res, null, 2);
    }
    if (action === 'send') {
      const message = String(args.message || '');
      if (!message.trim()) throw new Error('message es obligatorio para send');
      const pid = Number(args.pid ?? (Array.isArray(args.targets) ? args.targets[0] : undefined));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid inválido en targets[0] para send');
      const res = t.sendToTerminal(pid, message, { cwd: projectDir });
      return JSON.stringify(res, null, 2);
    }
    throw new Error('action no soportada en contextbase_terminals: ' + action + ' (usa list, close o send)');
  }
  throw new Error('Tool desconocida: ' + name);
}

function reply(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

/**
 * Captura lo que una tool imprima en stdout para que no contamine el stream JSON-RPC.
 * Sin esto, una tool con console.log (audit, init, swarm_start) rompe el protocolo.
 */
async function withCapturedStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk, ...rest) => {
    captured += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
  try {
    const value = await fn();
    return { value, captured };
  } finally {
    process.stdout.write = original;
  }
}

/**
 * Servidor MCP sobre stdio (JSON-RPC 2.0, cero dependencias).
 * Cola secuencial FIFO para garantizar orden determinista de respuestas.
 */
let serverActivo = false;

export async function startMcpServer(projectDir = process.cwd()) {
  // Marca explicita para que hooks.js nunca intente leer el stdin JSON-RPC del host.
  process.env.CONTEXTBASE_MCP = '1';
  // Dos interfaces readline sobre el mismo stdin duplicarian las respuestas.
  if (serverActivo) return;
  serverActivo = true;
  try { autoEnsure(projectDir); } catch {}
  let watcher = null;
  if (!process.env.NODE_TEST_CONTEXT) {
    try { watcher = startWatcher(projectDir, { unref: true }); } catch {}
  }

  async function processLine(line) {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalido' } }); }
    const { id, method, params } = msg;
    if (String(method || '').startsWith('notifications/') || id === undefined) return;
    try {
      if (method === 'initialize') {
        return reply({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: SERVER,
            instructions: buildLiveInstructions(projectDir)
          }
        });
      }
      if (method === 'ping') return reply({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return reply({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'resources/list') return reply({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      if (method === 'resources/templates/list') return reply({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
      if (method === 'resources/read') {
        const uri = params && params.uri;
        if (!uri) throw new Error('Falta uri');
        try { autoEnsure(projectDir); } catch {}
        let content;
        try {
          content = await readResourceContent(uri, projectDir);
        } catch (e) {
          return reply({ jsonrpc: '2.0', id, error: { code: e.rpcCode || -32603, message: e.message } });
        }
        return reply({ jsonrpc: '2.0', id, result: { contents: [content] } });
      }
      if (method === 'prompts/list') return reply({ jsonrpc: '2.0', id, result: { prompts: PROMPTS } });
      if (method === 'prompts/get') {
        const name = (params && params.name) || 'contextbase_session';
        try { autoEnsure(projectDir); } catch {}
        if (name === 'contextbase_mission') {
          const mission = await import('./mission.js');
          return reply({
            jsonrpc: '2.0',
            id,
            result: {
              description: 'Mision de orquestacion Lead Orchestrator',
              messages: [{ role: 'user', content: { type: 'text', text: mission.missionText() } }]
            }
          });
        }
        return reply({
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Contexto activo de ContextBase',
            messages: [{ role: 'user', content: { type: 'text', text: buildLiveInstructions(projectDir) } }]
          }
        });
      }
      if (method === 'tools/call') {
        const name = params?.name;
        const args = params?.arguments || {};
        // Una tool puede fijar process.exitCode (uso invalido); el servidor no debe
        // terminar con ese codigo porque el host lo interpreta como crash.
        const prevExitCode = process.exitCode;
        try {
          try { autoEnsure(projectDir); } catch {}
          const { value: out, captured } = await withCapturedStdout(() => callTool(name, args, projectDir));
          if (MUTATING_TOOLS.has(name)) { try { refreshStrands(projectDir); } catch {} }
          const text = captured && typeof out === 'string' ? captured + out : String(out);
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } });
        } finally {
          process.exitCode = prevExitCode;
        }
      }
      return reply({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Metodo no soportado: ' + method } });
    } catch (e) {
      return reply({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  }

  let queue = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => {
    queue = queue.then(() => processLine(line)).catch(() => {});
  });
  await new Promise(resolve => rl.on('close', () => {
    serverActivo = false;
    queue.finally(() => {
      if (watcher) { try { watcher.close(); } catch {} }
      resolve();
    });
  }));
}
