import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('servidor MCP responde initialize, tools/list y tools/call', async () => {
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
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'contextbase_context' } });
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
    setTimeout(() => reject(new Error('timeout MCP')), 15000);
  });
  assert.equal(responses.length, 3);
  assert.equal(responses[0].result.protocolVersion, '2024-11-05');
  assert.equal(responses[1].result.tools.length, 6);
  assert.ok(responses[2].result.content[0].text.includes('# ContextBase'));
});
