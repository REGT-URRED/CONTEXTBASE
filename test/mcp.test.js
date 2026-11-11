import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('servidor MCP responde initialize, tools/list, resources/list, prompts/list y tools/call', async () => {
  const child = spawn(process.execPath, [path.join(root, 'bin', 'contextbase.js'), 'mcp'], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'ignore']
  });
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
  const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: ' tools/call'.trim(), params: { name: 'contextbase_context' } });
  send({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  send({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'contextbase://digest' } });
  send({ jsonrpc: '2.0', id: 6, method: 'prompts/list' });
  child.stdin.end();
  let timer = null;
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout MCP')), 15000);
    if (typeof timer.unref === 'function') timer.unref();
    child.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  assert.equal(responses.length, 6);
  assert.equal(responses[0].result.protocolVersion, '2024-11-05');
  assert.ok(responses[0].result.instructions.includes('# ContextBase ::'));
  assert.ok(responses[0].result.capabilities.resources);
  assert.ok(responses[0].result.capabilities.prompts);
  assert.equal(responses[1].result.tools.length, 25);
  const names = responses[1].result.tools.map(t => t.name);
  for (const name of ['contextbase_review', 'contextbase_redundancy', 'contextbase_slop', 'contextbase_swarm_start', 'contextbase_swarm_stop', 'contextbase_terminals', 'contextbase_export', 'contextbase_strands_prepare', 'contextbase_init', 'contextbase_hook']) {
    assert.ok(names.includes(name), 'falta la tool ' + name);
  }
  assert.ok(responses[2].result.content[0].text.includes('# ContextBase'));
  assert.ok(responses[3].result.resources.some(r => r.uri === 'contextbase://digest'));
  assert.ok(responses[4].result.contents[0].text.includes('# ContextBase'));
  assert.ok(responses[5].result.prompts.some(p => p.name === 'contextbase_session'));
});
