import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactSecrets, scanFiles, packRepository } from '../src/scanner.js';

test('redacta secretos conocidos', () => {
  const input = 'AKIA' + 'A'.repeat(16) + ' ghp_' + 'b'.repeat(36) + ' password="abcdefgh123"';
  const { text, count } = redactSecrets(input);
  assert.ok(count >= 3, 'esperaba al menos 3 redacciones, hubo ' + count);
  assert.ok(!text.includes('AKIA'));
  assert.ok(text.includes('[REDACTED:AWS_ACCESS_KEY]'));
});

test('ignora archivos .env en el escaneo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-scan-'));
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=2');
  fs.writeFileSync(path.join(dir, 'index.js'), 'x');
  const { files } = scanFiles(dir);
  assert.deepEqual(files.map(f => f.relativePath), ['index.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('packRepository no filtra secretos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pack-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const token = "sk-' + 'a'.repeat(30) + '";');
  const out = packRepository(dir);
  assert.ok(!out.includes('sk-aaaa'), 'el token no debe aparecer');
  assert.ok(out.includes('REDACTED'));
  fs.rmSync(dir, { recursive: true, force: true });
});
