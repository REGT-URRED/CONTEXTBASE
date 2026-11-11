import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  autoConfigureProject,
  autoConfigureGlobal,
  configureClaude,
  configureCursorAndIde,
  ensureGitExclude,
  buildOpenCodePluginSource
} from '../src/autoconfig.js';

function tmp(prefix = 'cb-ac-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('autoConfigureProject genera kilo.json, opencode.json, .mcp.json y plugins', () => {
  const dir = tmp();
  const res = autoConfigureProject(dir);
  assert.ok(res.files.includes('kilo.json'));
  assert.ok(res.files.includes('opencode.json'));
  assert.ok(res.files.includes('.mcp.json'));
  assert.ok(res.files.includes('.opencode/plugins/contextbase-auto.js'));
  assert.ok(res.files.includes('.kilo/plugins/contextbase-auto.js'));

  const kilo = JSON.parse(fs.readFileSync(path.join(dir, 'kilo.json'), 'utf8'));
  assert.equal(kilo.permission['contextbase_*'], 'allow');
  assert.equal(kilo.mcp.contextbase.type, 'local');
  assert.equal(kilo.mcp.contextbase.enabled, true);
  assert.ok(kilo.instructions.includes('AGENTS.md'));

  const opencode = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  assert.equal(opencode.permission['contextbase_*'], 'allow');
  assert.equal(opencode.mcp.contextbase.type, 'local');
  assert.equal(opencode.mcp.contextbase.enabled, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('configureClaude y configureCursorAndIde son idempotentes y preservan ajustes', () => {
  const dir = tmp('cb-claude-');
  configureClaude(dir, { includeAll: true });
  configureClaude(dir, { includeAll: true });
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('mcp__contextbase__*'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.equal(settings.hooks.Stop.length, 1);

  configureCursorAndIde(dir, { includeAll: true });
  assert.ok(fs.existsSync(path.join(dir, '.cursor', 'mcp.json')));
  const mdc = fs.readFileSync(path.join(dir, '.cursor', 'rules', 'contextbase.mdc'), 'utf8');
  assert.ok(mdc.includes('alwaysApply: true'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ensureGitExclude registra rutas sin tocar .gitignore', () => {
  const dir = tmp('cb-excl-');
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  assert.equal(ensureGitExclude(dir), true);
  const excl = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(excl.includes('kilo.json'));
  assert.ok(excl.includes('.opencode/'));
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autoConfigureGlobal configura directorio home aislado y plugin valido', () => {
  const home = tmp('cb-home-');
  const configured = autoConfigureGlobal({ homeDir: home, forceGlobal: true });
  assert.ok(configured.files.some(f => f.includes('contextbase-auto.js')));
  const src = buildOpenCodePluginSource();
  assert.ok(src.includes('experimental.chat.system.transform'));
  assert.ok(src.includes('tool.execute.after'));
  assert.ok(src.includes('session.idle'));
  fs.rmSync(home, { recursive: true, force: true });
});
