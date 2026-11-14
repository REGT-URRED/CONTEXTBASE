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
  configureOpenCode,
  configureCursorAndIde,
  ensureGitExclude,
  buildOpenCodePluginSource
} from '../src/autoconfig.js';

function tmp(prefix = 'cb-ac-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('autoConfigureProject genera kilo.json, opencode.json, .mcp.json y plugins', () => {
  const dir = tmp();
  // Home aislado sin plugin global: en una maquina con el plugin global instalado
  // el proyecto ya no recibe copia local (un solo plugin por host).
  const home = tmp('cb-ac-home-');
  const res = autoConfigureProject(dir, { homeDir: home });
  fs.rmSync(home, { recursive: true, force: true });
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

test('configureOpenCode no deja rutas de archivo en plugin/plugins sobre un config v2', () => {
  const dir = tmp('cb-v2-plugin-');
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
    permissions: [{ action: 'read', resource: '*', effect: 'allow' }],
    plugin: ['./.opencode/plugins/contextbase-auto.js', 'plugin-npm-valido'],
    plugins: ['./otro-plugin.js']
  }, null, 2) + '\n', 'utf8');

  configureOpenCode(dir);

  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  const rutas = [...(cfg.plugin || []), ...(cfg.plugins || [])].filter((p) => /\.(js|mjs|cjs|ts|mts|cts)$/i.test(String(p)));
  assert.deepEqual(rutas, [], 'una ruta de archivo en plugin/plugins hace que el host descarte el plugin');
  assert.ok((cfg.plugin || []).includes('plugin-npm-valido'), 'las entradas que no son rutas se preservan');
  assert.ok(cfg.permissions.some((p) => p && p.action === 'contextbase_*'), 'el permiso contextbase_* se agrega en v2');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Un solo plugin por host: si el global es valido, el proyecto no duplica copia
// ---------------------------------------------------------------------------

const GLOBAL_PLUGIN_SRC = "export default {\n  id: 'contextbase-auto',\n  server: async () => ({}),\n  setup: async () => ({})\n};\n";

function homeWithGlobalPlugin() {
  const home = tmp('cb-ac-home-');
  const pluginsDir = path.join(home, '.config', 'opencode', 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, 'contextbase-auto.js'), GLOBAL_PLUGIN_SRC, 'utf8');
  return home;
}

test('con plugin global valido: no escribe copia local y elimina la existente', () => {
  const dir = tmp('cb-ac-proj-');
  const home = homeWithGlobalPlugin();
  const localPlugin = path.join(dir, '.opencode', 'plugins', 'contextbase-auto.js');
  fs.mkdirSync(path.dirname(localPlugin), { recursive: true });
  fs.writeFileSync(localPlugin, '// copia vieja del proyecto\n', 'utf8');

  const res = autoConfigureProject(dir, { homeDir: home });

  assert.equal(fs.existsSync(localPlugin), false, 'la copia del proyecto se elimina si el global cubre');
  assert.equal(res.files.includes('.opencode/plugins/contextbase-auto.js'), false);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('sin plugin global: escribe la copia local y la reporta', () => {
  const dir = tmp('cb-ac-proj-');
  const home = tmp('cb-ac-home-'); // home vacio, sin global

  const res = autoConfigureProject(dir, { homeDir: home });
  const localPlugin = path.join(dir, '.opencode', 'plugins', 'contextbase-auto.js');

  assert.equal(fs.existsSync(localPlugin), true, 'sin global el proyecto necesita su propio plugin');
  assert.ok(res.files.includes('.opencode/plugins/contextbase-auto.js'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});
