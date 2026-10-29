import readline from 'node:readline';
import fs from 'node:fs';

const pkg = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); } catch { return {}; } })();

const PROTOCOL = '2024-11-05';
const SERVER = { name: 'contextbase', version: pkg.version || '0.0.0' };

const TOOLS = [
  { name: 'contextbase_status', description: 'Estado estructurado de la memoria del proyecto: archivos, tareas, seguridad y salud.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_context', description: 'Digest compacto para iniciar sesion: pendientes, progreso, seguridad y siguiente accion.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_log', description: 'Registra un cambio realizado en contextbase/changelog.md.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_task', description: 'Gestiona tareas: action add|done|list con text opcional.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, text: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'contextbase_audit', description: 'Regenera inventario de componentes, frescura de versiones y brechas de seguridad.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_sync', description: 'Sincroniza bloque tecnico de fundamentos.md y reinyecta reglas de agente.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_bootstrap', description: 'Bootstrap del entorno de agentes: detecta CLIs, instala faltantes, init y snapshot.', inputSchema: { type: 'object', properties: { cli: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } }, yes: { type: 'boolean' }, autoConfirmRest: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_guard', description: 'Verifica integridad de archivos base; opcionalmente repara desde fuentes oficiales.', inputSchema: { type: 'object', properties: { check: { type: 'boolean' }, repair: { type: 'boolean' }, show: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_snapshot', description: 'Crea punto de restauracion de archivos base.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_restore', description: 'Restaura archivos base desde snapshot (id opcional).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_tools', description: 'Lista/habilita/deshabilita herramientas del registro.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' } }, additionalProperties: false } },
  { name: 'contextbase_review', description: 'Review tipo thermos: modo prepare arma diff + contenidos + intencion + los 2 prompts de revisor; modo prompts devuelve solo prompts; modo merge fusiona dos reportes.', inputSchema: { type: 'object', properties: { mode: { type: 'string' }, base: { type: 'string' }, intent: { type: 'string' }, reports: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'contextbase_redundancy', description: 'Detecta redundancia en el entorno global: skills duplicados entre ubicaciones, referencias rotas en commands/agents, bloques de AGENTS.md y MCP duplicados.', inputSchema: { type: 'object', properties: { json: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'contextbase_slop', description: 'Delivery gate antislop: escanea las lineas agregadas del diff con reglas heuristas de copy, comentarios y estructura.', inputSchema: { type: 'object', properties: { base: { type: 'string' }, json: { type: 'boolean' } }, additionalProperties: false } }
];

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
    return 'Sincronizado: ' + (updated ? 'fundamentos.md, ' : '') + 'reglas en ' + injected.join(', ');
  }
  if (name === 'contextbase_bootstrap') {
    const bootstrap = await import('./bootstrap.js');
    return JSON.stringify(await bootstrap.run(projectDir, args || {}));
  }
  if (name === 'contextbase_guard') {
    const guard = await import('./guard.js');
    const snapshot = await import('./snapshot.js');
    const checkRes = guard.check(projectDir);
    const repairs = [];
    if (args && args.repair && Array.isArray(checkRes.drifts)) {
      for (const d of checkRes.drifts) {
        if (guard.REPAIR_ALLOWLIST && guard.REPAIR_ALLOWLIST[d.file]) {
          const r = await guard.repair(projectDir, d.file);
          repairs.push({ file: d.file, ok: !!r.ok, error: r.error || null });
        }
      }
    }
    let content = null;
    if (args && args.show && Array.isArray(checkRes.drifts)) {
      content = {};
      for (const d of checkRes.drifts) {
        try { content[d.file] = (await import('node:fs')).readFileSync((await import('node:path')).join(projectDir, d.file), 'utf8'); } catch {}
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
  if (name === 'contextbase_tools') {
    const reg = await import('./registry.js');
    const action = (args && args.action) || 'list';
    if (action === 'list') return JSON.stringify(reg.getRegistry(projectDir).map(t => ({ id: t.id, name: t.name, enabled: t.enabled, cliSupport: t.cliSupport })));
    if (action === 'enable' && args && args.name) { reg.setEnabled(args.name, true, projectDir); return 'ok'; }
    if (action === 'disable' && args && args.name) { reg.setEnabled(args.name, false, projectDir); return 'ok'; }
    throw new Error('Accion invalida');
  }
  throw new Error('Tool desconocida: ' + name);
}

function reply(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

/**
 * Servidor MCP minimo sobre stdio (JSON-RPC 2.0, cero dependencias).
 * Permite que cualquier agente compatible MCP use ContextBase como tools nativas.
 */
export async function startMcpServer(projectDir = process.cwd()) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async line => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalido' } }); }
    const { id, method, params } = msg;
    if (method === 'notifications/initialized' || id === undefined) return;
    try {
      if (method === 'initialize') {
        return reply({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER } });
      }
      if (method === 'ping') return reply({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return reply({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'tools/call') {
        const name = params?.name;
        const args = params?.arguments || {};
        try {
          const out = await callTool(name, args, projectDir);
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }] } });
        } catch (e) {
          return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } });
        }
      }
      return reply({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Metodo no soportado: ' + method } });
    } catch (e) {
      return reply({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  });
  await new Promise(resolve => rl.on('close', resolve));
}
