import readline from 'node:readline';

const PROTOCOL = '2024-11-05';
const SERVER = { name: 'contextbase', version: '1.2.0' };

const TOOLS = [
  { name: 'contextbase_status', description: 'Estado estructurado de la memoria del proyecto: archivos, tareas, seguridad y salud.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_context', description: 'Digest compacto para iniciar sesion: pendientes, progreso, seguridad y siguiente accion.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_log', description: 'Registra un cambio realizado en contextbase/changelog.md.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } },
  { name: 'contextbase_task', description: 'Gestiona tareas: action add|done|list con text opcional.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, text: { type: 'string' } }, required: ['action'], additionalProperties: false } },
  { name: 'contextbase_audit', description: 'Regenera inventario de componentes, frescura de versiones y brechas de seguridad.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'contextbase_sync', description: 'Sincroniza bloque tecnico de fundamentos.md y reinyecta reglas de agente.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
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
