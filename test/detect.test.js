import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, readMcpConfig, detectCli } from '../src/detect.js';

test('findOnPath finds node', () => {
  assert.equal(findOnPath('node'), true);
});

test('readMcpConfig returns null when missing and parses JSONC when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'));
  assert.equal(readMcpConfig('opencode', dir, dir), null);
  fs.writeFileSync(path.join(dir, 'kilo.jsonc'), '{\n  // comentario\n  "mcp": { "contextbase": { "type": "local", "enabled": true } },\n}\n');
  const parsed = readMcpConfig('kilo', dir, dir);
  assert.ok(parsed && parsed.mcp && parsed.mcp.contextbase);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectCli returns primary', () => {
  const r = detectCli();
  assert.ok(r.primary);
  assert.ok(Array.isArray(r.all));
});
