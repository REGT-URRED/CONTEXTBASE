import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJsonc } from '../src/redundancy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = pathToFileURL(path.join(root, 'src', 'redundancy.js')).href;

function touch(file, body = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

// El escaneo resuelve rutas desde el HOME real: se ejecuta en un hijo con HOME falso.
function scanWith(home) {
  const script = 'const m = await import(' + JSON.stringify(moduleUrl) + '); process.stdout.write(JSON.stringify(m.scan()));';
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming') },
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-red-'));
  const opencode = path.join(home, '.config', 'opencode');

  touch(path.join(opencode, 'skills', 'foo', 'SKILL.md'), '# foo\n');
  touch(path.join(home, '.agents', 'skills', 'foo', 'SKILL.md'), '# foo\n');

  touch(path.join(opencode, 'node_modules', 'superpowers', 'skills', 'brainstorming', 'SKILL.md'), '# b\n');
  touch(path.join(opencode, 'node_modules', 'superpowers', 'skills', 'systematic-debugging', 'SKILL.md'), '# s\n');

  const npmModules = process.platform === 'win32'
    ? path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules')
    : path.join(home, '.npm-global', 'lib', 'node_modules');
  touch(path.join(npmModules, '@scope', 'ponytail', 'skills', 'ponytail', 'SKILL.md'), '# p\n');

  touch(path.join(opencode, 'agents', 'RealAgent.md'), '# real\n');
  touch(path.join(opencode, 'commands', 'x.md'), [
    'Usar skills/no-existe y tambien skills/foo.',
    'Ejecutar agent: "GhostAgent".',
    'Ejecutar Agent: "RealAgent".',
    '',
  ].join('\n'));

  touch(path.join(opencode, 'opencode.jsonc'), [
    '{',
    '  // comentario de linea',
    '  "mcp": {',
    '    "legacy": { "command": "node a.js" },',
    '    "other": { "url": "http://localhost:1" },',
    '    /* mismo nombre tambien en servers */',
    '    "servers": { "legacy": { "command": "node a.js" } },',
    '    "timeout": 5000,',
    '  },',
    '}',
    '',
  ].join('\n'));

  return home;
}

test('redundancy detecta duplicados, skills principales y referencias rotas', () => {
  const home = fakeHome();
  const r = scanWith(home);

  const dup = r.duplicated.find(d => d.name === 'foo');
  assert.ok(dup, JSON.stringify(r.duplicated));
  assert.ok(dup.where.includes('.agents/skills'), JSON.stringify(dup));
  assert.ok(dup.where.includes('.config/opencode/skills'), JSON.stringify(dup));

  assert.equal(r.principals.find(p => p.id === 'superpowers').count, 2);
  assert.equal(r.principals.find(p => p.id === 'ponytail').count, 1);

  const refs = r.dangling.map(d => d.kind + ':' + d.ref.toLowerCase());
  assert.ok(refs.includes('skill:no-existe'), JSON.stringify(r.dangling));
  assert.ok(refs.includes('agent:ghostagent'), JSON.stringify(r.dangling));
  assert.ok(!refs.includes('skill:foo'), JSON.stringify(r.dangling));
  assert.ok(!refs.includes('agent:realagent'), JSON.stringify(r.dangling));

  assert.ok(r.mcp.legacy.includes('legacy'), JSON.stringify(r.mcp));
  assert.ok(r.mcp.legacy.includes('other'), JSON.stringify(r.mcp));
  assert.ok(r.mcp.duplicated.includes('legacy'), JSON.stringify(r.mcp));

  fs.rmSync(home, { recursive: true, force: true });
});

test('redundancy tolera un entorno vacio y reporta los principales en 0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-red-empty-'));
  const r = scanWith(home);
  assert.equal(r.principals.length, 5);
  assert.ok(r.principals.every(p => p.count === 0), JSON.stringify(r.principals));
  assert.deepEqual(r.duplicated, []);
  assert.deepEqual(r.dangling, []);
  assert.deepEqual(r.mcp.legacy, []);
  fs.rmSync(home, { recursive: true, force: true });
});

test('readJsonc soporta comentario de linea al final sin romper strings con //', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-red-jsonc-line-'));
  const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  touch(file, [
    '{',
    '  "mcp": {',
    '    "web": { "url": "https://example.com/x" },',
    '    "servers": { "v2": { "command": "node b.js" } }',
    '  } // nota',
    '}',
    '',
  ].join('\n'));

  const cfg = readJsonc(file);
  assert.ok(cfg, 'readJsonc no debe devolver null');
  assert.equal(cfg.mcp.web.url, 'https://example.com/x');

  const r = scanWith(home);
  assert.deepEqual(r.mcp.legacy, ['web']);
  assert.deepEqual(r.mcp.v2, ['v2']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('readJsonc soporta comentarios de bloque', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-red-jsonc-block-'));
  const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  touch(file, [
    '{',
    '  /* bloque */',
    '  "mcp": { "legacy": { "command": "node a.js" } }',
    '}',
    '',
  ].join('\n'));

  const cfg = readJsonc(file);
  assert.ok(cfg, 'readJsonc no debe devolver null');
  assert.equal(cfg.mcp.legacy.command, 'node a.js');
  fs.rmSync(home, { recursive: true, force: true });
});
