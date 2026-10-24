import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { installGitHook } from '../src/hooks.js';

test('instala el hook post-commit en un repo git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-hook-'));
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  const r = installGitHook(dir, 'install');
  assert.equal(r.ok, true);
  const hook = path.join(dir, '.git', 'hooks', 'post-commit');
  const content = fs.readFileSync(hook, 'utf8');
  assert.ok(content.includes('ContextBase autosave'));
  assert.ok(content.includes('contextbase.js'));
  const second = installGitHook(dir, 'install');
  assert.equal(second.ok, true, 'reinstalar el propio hook es idempotente');
  const removed = installGitHook(dir, 'remove');
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(hook), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no sobrescribe un hook ajeno', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-hook2-'));
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  const hook = path.join(dir, '.git', 'hooks', 'post-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho ajeno\n');
  const r = installGitHook(dir, 'install');
  assert.equal(r.ok, false);
  assert.ok(fs.readFileSync(hook, 'utf8').includes('ajeno'));
  fs.rmSync(dir, { recursive: true, force: true });
});
