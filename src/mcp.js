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
  'contextbase_hook'
]);

const TOOLS = [
  { name: 'contextbase_status', description: 'Estado estructurado de la memoria del proyecto: archivos, tareas, seguridad y salud.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_context', description: 'Digest compacto para iniciar sesion: pendientes, progreso, seguridad y siguiente accion.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_log', description: 'Registra un cambio realizado en contextbase/changelog.md.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_task', description: 'Gestiona tareas: action add|done|list con text opcional.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, text: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'contextbase_audit', description: 'Regenera inventario de componentes, frescura de versiones y brechas de seguridad.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_sync', description: 'Sincroniza bloque tecnico de fundamentos.md, cambios del arbol de trabajo y reglas de agente.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_bootstrap', description: 'Bootstrap del entorno de agentes: detecta CLIs, instala faltantes, init y snapshot.', inputSchema: { type: 'object', properties: { cli: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } }, yes: { type: 'boolean' }, autoConfirmRest: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_guard', description: 'Verifica integridad de archivos base; opcionalmente repara desde fuentes oficiales.', inputSchema: { type: 'object', properties: { check: { type: 'boolean' }, repair: { type: 'boolean' }, show: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_snapshot', description: 'Crea punto de restauracion de archivos base.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_restore', description: 'Restaura archivos base desde snapshot (id opcional).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_tools', description: 'Lista/habilita/deshabilita herramientas del registro.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_review', description: 'Review tipo thermos: modo prepare arma diff + contenidos + intencion + los 2 prompts de revisor; modo prompts devuelve solo prompts; modo merge fusiona dos reportes.', inputSchema: { type: 'object', properties: { mode: { type: 'string' }, base: { type: 'string' }, intent: { type: 'string' }, reports: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'contextbase_redundancy', description: 'Detecta redundancia en el entorno global: skills duplicados entre ubicaciones, referencias rotas en commands/agents, bloques de AGENTS.md y MCP duplicados.', inputSchema: { type: 'object', properties: { json: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_slop', description: 'Delivery gate antislop: escanea las lineas agregadas del diff con reglas heuristas de copy, comentarios y estructura.', inputSchema: { type: 'object', properties: { base: { type: 'string' }, json: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_export', description: 'Exporta el estado o digest del proyecto en formato JSON o HTML.', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'estado o digest' }, format: { type: 'string', description: 'json o html' }, output: { type: 'string', description: 'ruta de archivo de salida opcional' } }, additionalProperties: false } },
  { name: 'contextbase_strands_prepare', description: 'Prepara el contexto del proyecto para Strands Agent (Python): genera contextbase/strands/ con project_context.py, strands_config.py, tasks.py y context.json.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_init', description: 'Garantiza la memoria ContextBase y autoconfigura agentes (OpenCode, Kilo, Claude, Cursor) sin intervencion manual.', inputSchema: { type: 'object', properties: { autoConfig: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_hook', description: 'Ejecuta o instala hooks automaticos (install|remove|session-start|post-tool|session-stop).', inputSchema: { type: 'object', properties: { action: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'contextbase_mission', description: 'Devuelve el prompt de mision de orquestacion y testing (Lead Orchestrator).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_swarm_start', description: 'Lanza un enjambre: un worktree, una rama y una sesion por worker. Devuelve los session ids para el orquestador.', inputSchema: { type: 'object', properties: { task: { type: 'string' }, workers: { type: 'number' }, agent: { type: 'string' }, base: { type: 'string' }, ttl: { type: 'number' } }, required: ['task'], additionalProperties: false } },
  { name: 'contextbase_swarm_status', description: 'Estado de los workers: running, done o stale, con cambios y evidencia de actividad.', inputSchema: { type: 'object', properties: { run: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_swarm_send', description: 'Envia un mensaje a un worker (o all). Entrega nativa en la sesion viva o por archivo.', inputSchema: { type: 'object', properties: { worker: { type: 'string' }, message: { type: 'string' }, run: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_swarm_collect', description: 'Reune result.md de cada worker y da veredicto de merge por rama (clean/conflict).', inputSchema: { type: 'object', properties: { run: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_swarm_stop', description: 'Detiene los procesos de los workers vivos del run.', inputSchema: { type: 'object', properties: { run: { type: 'string' } }, additionalProperties: false } }
];

const RESOURCES = [
  { uri: 'contextbase://digest', name: 'ContextBase Digest', description: 'Digest compacto del estado actual del proyecto', mimeType: 'text/markdown' },
  { uri: 'contextbase://state', name: 'ContextBase State JSON', description: 'Estado estructurado completo del proyecto', mimeType: 'application/json' },
  { uri: 'contextbase://fundamentos', name: 'Fundamentos del Proyecto', description: 'Arquitectura, stack y reglas operativas (contextbase/fundamentos.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://changelog', name: 'Bitacora del Proyecto', description: 'Historial de cambios realizados y pendientes (contextbase/changelog.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://tasklist', name: 'Lista de Tareas', description: 'Tareas pendientes y completadas (contextbase/tasklist.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://componentes', name: 'Inventario y Seguridad', description: 'Componentes instalados y brechas de seguridad (contextbase/componentes.md)', mimeType: 'text/markdown' },
  { uri: 'contextbase://strands/context', name: 'Contexto Strands JSON', description: 'Estado completo para Strands Agent (contextbase/strands/context.json)', mimeType: 'application/json' }
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

function readResourceContent(uri, projectDir) {
  const state = collectState(projectDir);
  if (uri === 'contextbase://digest') {
    return { uri, mimeType: 'text/markdown', text: buildDigest(state, SERVER.version) };
  }
  if (uri === 'contextbase://state') {
    return { uri, mimeType: 'application/json', text: JSON.stringify(state, null, 2) };
  }
  const map = {
    'contextbase://fundamentos': ['contextbase', 'fundamentos.md', 'text/markdown'],
    'contextbase://changelog': ['contextbase', 'changelog.md', 'text/markdown'],
    'contextbase://tasklist': ['contextbase', 'tasklist.md', 'text/markdown'],
    'contextbase://componentes': ['contextbase', 'componentes.md', 'text/markdown'],
    'contextbase://strands/context': ['contextbase', 'strands', 'context.json', 'application/json']
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
      'MODO AUTOMATICO CONTEXTBASE ACTIVO:',
      '1. Tienes acceso directo y preautorizado a las tools contextbase_*. No pidas confirmacion al usuario para usarlas.',
      '2. Al finalizar cualquier modificacion de codigo o tarea, invoca automaticamente contextbase_log (con el resumen en espanol) y contextbase_task (action="done" o "add") antes de cerrar tu respuesta.',
      '3. El contexto actual del proyecto ya fue cargado automaticamente a continuacion:',
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
  if (name === 'contextbase_strands_prepare') {
    const strands = await import('./strands.js');
    const result = strands.prepareStrandsContext(projectDir);
    return JSON.stringify(result, null, 2);
  }
  if (name === 'contextbase_init') {
    const r = autoEnsure(projectDir, { autoConfig: Boolean(args && args.autoConfig) });
    if (args && args.autoConfig) {
      r.configured = autoConfigureProject(projectDir).files;
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
  if (name === 'contextbase_tools') {
    const reg = await import('./registry.js');
    const action = (args && args.action) || 'list';
    if (action === 'list') return JSON.stringify(reg.getRegistry(projectDir).map(t => ({ id: t.id, name: t.name, enabled: t.enabled, cliSupport: t.cliSupport })));
    if (action === 'enable' && args && args.name) { reg.setEnabled(args.name, true, projectDir); return 'ok'; }
    if (action === 'disable' && args && args.name) { reg.setEnabled(args.name, false, projectDir); return 'ok'; }
    throw new Error('Accion invalida');
  }
  if (name === 'contextbase_mission') {
    const mission = await import('./mission.js');
    return mission.missionText();
  }
  if (name === 'contextbase_swarm_start') {
    const sw = await import('./swarm.js');
    if (!args.task) throw new Error('Falta task');
    const out = sw.startSwarm({ cwd: projectDir, task: args.task, workers: args.workers, agent: args.agent, base: args.base, ttlMinutes: args.ttl });
    return JSON.stringify(out, null, 2);
  }
  if (name === 'contextbase_swarm_status') {
    const sw = await import('./swarm.js');
    return JSON.stringify(sw.swarmStatus({ cwd: projectDir, run: args.run }), null, 2);
  }
  if (name === 'contextbase_swarm_send') {
    const sw = await import('./swarm.js');
    if (!args.message) throw new Error('Falta message');
    return JSON.stringify(sw.swarmSend({ cwd: projectDir, run: args.run, worker: args.worker, message: args.message }), null, 2);
  }
  if (name === 'contextbase_swarm_collect') {
    const sw = await import('./swarm.js');
    return JSON.stringify(sw.swarmCollect({ cwd: projectDir, run: args.run }), null, 2);
  }
  if (name === 'contextbase_swarm_stop') {
    const sw = await import('./swarm.js');
    return JSON.stringify(sw.swarmStop({ cwd: projectDir, run: args.run }), null, 2);
  }
  throw new Error('Tool desconocida: ' + name);
}

function reply(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

/**
 * Servidor MCP sobre stdio (JSON-RPC 2.0, cero dependencias).
 * Cola secuencial FIFO para garantizar orden determinista de respuestas.
 */
export async function startMcpServer(projectDir = process.cwd()) {
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
        const content = readResourceContent(uri, projectDir);
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
        try {
          try { autoEnsure(projectDir); } catch {}
          const out = await callTool(name, args, projectDir);
          if (MUTATING_TOOLS.has(name)) { try { refreshStrands(projectDir); } catch {} }
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }] } });
        } catch (e) {
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } });
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
    queue.finally(() => {
      if (watcher) { try { watcher.close(); } catch {} }
      resolve();
    });
  }));
}
