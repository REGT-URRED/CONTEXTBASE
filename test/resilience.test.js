import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { buildOpenCodePluginSource } from '../src/autoconfig.js';
import { isRelevantPath } from '../src/watcher.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'contextbase.js');

function tmp(prefix = 'cb-res-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function loadPlugin(dir) {
  const file = path.join(dir, 'plugin.js');
  fs.writeFileSync(file, buildOpenCodePluginSource(), 'utf8');
  return import(pathToFileURL(file).href + '?v=' + Date.now());
}

function mcpRoundtrip(dir, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = [];
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          try { responses.push(JSON.parse(line)); } catch (err) { reject(new Error('linea no JSON en el stream: ' + line)); return; }
        }
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout MCP')); }, 30000);
    timer.unref();
    child.on('close', code => { clearTimeout(timer); resolve({ responses, code, stderr }); });
    child.on('error', reject);
  });
}

test('plugin: el default export cumple el contrato de OpenCode v2 (id + setup) y conserva la factory v1', async () => {
  const dir = tmp('cb-res-plugin-');
  const mod = await loadPlugin(dir);
  assert.equal(typeof mod.default, 'object');
  assert.equal(mod.default.id, 'contextbase-auto');
  assert.equal(typeof mod.default.setup, 'function');
  assert.equal(typeof mod.default.server, 'function');
  assert.equal(typeof mod.ContextBaseAutoPlugin, 'function');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin: el hook async de spawn tiene listener de error (evita abortar el host)', async () => {
  const dir = tmp('cb-res-spawn-');
  const src = buildOpenCodePluginSource();
  assert.ok(src.includes('child.on("error"'), 'el spawn del hook debe manejar el evento error');
  assert.ok(src.includes('if (!resolved) return;'), 'no debe invocar un binario inexistente');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin: el aislamiento de hilo no se puede evadir con .. ni con mayusculas', async () => {
  const dir = tmp('cb-res-iso-');
  fs.mkdirSync(path.join(dir, 'contextbase'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'contextbase', '.spider-context.json'), JSON.stringify({
    forbiddenFiles: ['src/theirs.js', 'src/Case.js'],
    assignedFiles: ['src/mine.js'],
  }));
  const mod = await loadPlugin(dir);
  const hooks = await mod.ContextBaseAutoPlugin({ directory: dir });
  const before = hooks['tool.execute.before'];
  for (const target of ['src/theirs.js', 'src/../src/theirs.js', 'SRC/THEIRS.JS', 'src/case.js']) {
    let threw = false;
    try {
      await before({ tool: 'write', args: { filePath: target } });
    } catch (err) {
      threw = String(err.message || '').includes('Aislamiento de hilo activo');
    }
    assert.equal(threw, true, 'debe bloquear ' + target);
  }
  await before({ tool: 'write', args: { filePath: 'src/mine.js' } });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watcher: las rutas fuera del proyecto no se consideran relevantes', () => {
  assert.equal(isRelevantPath('src/app.js'), true);
  assert.equal(isRelevantPath('C:/Windows/Temp/outside.js'), false);
  assert.equal(isRelevantPath('../../outside.js'), false);
});

test('MCP: reconexion (dos servidores seguidos) responde igual y el primero sale limpio', async () => {
  const dir = tmp('cb-res-mcp-');
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'contextbase://digest' } },
  ];
  const first = await mcpRoundtrip(dir, reqs);
  assert.equal(first.code, 0);
  assert.equal(first.responses.length, 2);
  assert.ok(first.responses[0].result.protocolVersion);
  const second = await mcpRoundtrip(dir, reqs);
  assert.equal(second.code, 0);
  assert.equal(second.responses.length, 2);
  assert.ok(second.responses[1].result.contents[0].text.includes('# ContextBase'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP: una tool que imprime en stdout no corrompe el stream JSON-RPC', async () => {
  const dir = tmp('cb-res-stdout-');
  const res = await mcpRoundtrip(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'contextbase_audit', arguments: {} } },
  ]);
  assert.equal(res.responses.length, 2, 'solo deben llegar 2 respuestas JSON (nada de stdout suelto)');
  const call = res.responses[1];
  assert.ok(call.result, 'la tool debe responder');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP: linea malformada responde error y el servidor sigue vivo', async () => {
  const dir = tmp('cb-res-bad-');
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });
  child.stdin.write('esto no es json\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }) + '\n');
  child.stdin.end();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 30000);
    timer.unref();
    child.on('close', () => { clearTimeout(timer); resolve(); });
    child.on('error', reject);
  });
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[1].result !== undefined, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
