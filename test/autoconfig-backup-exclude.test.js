import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { backupConfig, ensureGitExclude } from '../src/autoconfig.js';

const BACKUP_RE = /\.bak-contextbase-\d{8}-\d{6}(?:\.\d+)?$/;

function tmp(prefix = 'cb-he-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim();
}

function listBackups(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.bak-contextbase-`;
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ---------------------------------------------------------------------------
// A. Respaldo que no destruye historia
// ---------------------------------------------------------------------------

test('dos respaldos seguidos son distintos y el primero conserva el contenido original', () => {
  const dir = tmp('cb-bak-');
  const file = path.join(dir, 'opencode.json');
  const original = '{\n  "model": "original-del-usuario"\n}\n';
  fs.writeFileSync(file, original, 'utf8');

  const first = backupConfig(file);
  assert.equal(typeof first, 'string', 'el primer respaldo debe devolver su ruta');
  assert.match(first, BACKUP_RE);

  fs.writeFileSync(file, '{\n  "model": "migrado-una-vez"\n}\n', 'utf8');
  const second = backupConfig(file);
  assert.equal(typeof second, 'string');
  assert.match(second, BACKUP_RE, 'el segundo respaldo debe tener marca temporal');
  assert.notEqual(second, first, 'la segunda migracion NO puede pisar el primer respaldo');
  assert.equal(fs.existsSync(first), true, 'el primer respaldo debe seguir existiendo');
  assert.equal(fs.readFileSync(first, 'utf8'), original, 'el primer respaldo debe conservar la config original');

  assert.equal(listBackups(file).length, 2, 'deben existir DOS respaldos con marca temporal');
  cleanup(dir);
});

test('el respaldo legado .bak-contextbase se crea una vez y nunca se sobrescribe', () => {
  const dir = tmp('cb-bak-legacy-');
  const file = path.join(dir, 'kilo.json');
  const original = '{ "original": true }\n';
  fs.writeFileSync(file, original, 'utf8');

  backupConfig(file);
  const legacy = file + '.bak-contextbase';
  assert.equal(fs.existsSync(legacy), true, 'el respaldo legado debe existir para compatibilidad');
  assert.equal(fs.readFileSync(legacy, 'utf8'), original);

  fs.writeFileSync(file, '{ "migrado": true }\n', 'utf8');
  backupConfig(file);
  assert.equal(fs.readFileSync(legacy, 'utf8'), original, 'el legado nunca se pisa con contenido migrado');
  cleanup(dir);
});

test('un respaldo legado preexistente no se borra ni se pisa', () => {
  const dir = tmp('cb-bak-legacy2-');
  const file = path.join(dir, 'opencode.json');
  const legacy = file + '.bak-contextbase';
  fs.writeFileSync(legacy, 'RESPALDO HISTORICO DEL USUARIO\n', 'utf8');
  fs.writeFileSync(file, '{ "actual": 1 }\n', 'utf8');

  backupConfig(file);
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'RESPALDO HISTORICO DEL USUARIO\n', 'el legado del usuario queda intacto');
  cleanup(dir);
});

test('backupConfig devuelve null cuando el archivo no existe', () => {
  const dir = tmp('cb-bak-none-');
  assert.equal(backupConfig(path.join(dir, 'no-existe.json')), null);
  cleanup(dir);
});

test('retencion: 7 respaldos dejan 5 y se borran los mas viejos', () => {
  const dir = tmp('cb-bak-ret-');
  const file = path.join(dir, 'opencode.jsonc');
  fs.writeFileSync(file, 'estado-0\n', 'utf8');
  const created = [];
  for (let i = 0; i < 7; i += 1) {
    fs.writeFileSync(file, `estado-${i + 1}\n`, 'utf8');
    const backup = backupConfig(file);
    assert.equal(typeof backup, 'string');
    created.push(backup);
  }

  const left = listBackups(file);
  assert.equal(left.length, 5, 'solo se conservan los ultimos 5 respaldos');
  const removed = created.slice(0, 2).map((p) => path.basename(p));
  for (const name of removed) {
    assert.equal(left.includes(name), false, `el respaldo viejo ${name} debe borrarse`);
  }
  const kept = created.slice(2).map((p) => path.basename(p));
  for (const name of kept) {
    assert.equal(left.includes(name), true, `el respaldo reciente ${name} debe conservarse`);
  }
  // El respaldo mas nuevo contiene el ultimo estado escrito.
  assert.equal(fs.readFileSync(created[6], 'utf8'), 'estado-7\n');
  cleanup(dir);
});

test('la retencion no toca respaldos de otros archivos ni el legado', () => {
  const dir = tmp('cb-bak-ret2-');
  const file = path.join(dir, 'kilo.json');
  const other = path.join(dir, 'otro.json');
  fs.writeFileSync(other, 'otro\n', 'utf8');
  const otherBackup = backupConfig(other);
  fs.writeFileSync(file + '.bak-contextbase', 'legado\n', 'utf8');

  fs.writeFileSync(file, 'x0\n', 'utf8');
  for (let i = 0; i < 6; i += 1) backupConfig(file);

  assert.equal(fs.existsSync(otherBackup), true, 'los respaldos de otros archivos no se rotan');
  assert.equal(fs.existsSync(file + '.bak-contextbase'), true, 'el respaldo legado no se rota');
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// B. Exclude que funciona tambien en worktrees
// ---------------------------------------------------------------------------

const ENTRIES_TO_CHECK = ['kilo.json', '.opencode/', 'contextbase/strands/', 'contextbase/swarm/'];

test('ensureGitExclude es idempotente y no duplica lineas', () => {
  const dir = tmp('cb-excl-idem-');
  git(dir, ['init', '-q']);

  assert.equal(ensureGitExclude(dir), true);
  const excludeFile = path.join(dir, '.git', 'info', 'exclude');
  const first = fs.readFileSync(excludeFile, 'utf8');
  for (const entry of ENTRIES_TO_CHECK) assert.ok(first.includes(entry), `debe incluir ${entry}`);

  assert.equal(ensureGitExclude(dir), true);
  const second = fs.readFileSync(excludeFile, 'utf8');
  assert.equal(second, first, 'la segunda llamada no debe reescribir el archivo');
  assert.equal(second.split(/\r?\n/).filter((l) => l === 'kilo.json').length, 1, 'no debe duplicar lineas');
  assert.equal(second.split('# ContextBase auto-generated agent files').length - 1, 1, 'un solo bloque');
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false, 'no debe crear .gitignore');
  cleanup(dir);
});

test('ensureGitExclude devuelve false sin lanzar cuando no hay repositorio git', () => {
  const dir = tmp('cb-excl-nogit-');
  assert.equal(ensureGitExclude(dir), false);
  cleanup(dir);
});

test('ensureGitExclude escribe en el info/exclude del repositorio COMUN dentro de un worktree', (t) => {
  const base = tmp('cb-excl-wt-');
  const repo = path.join(base, 'repo');
  const wt = path.join(base, 'worktree-arana');
  fs.mkdirSync(repo, { recursive: true });

  try {
    git(repo, ['init', '-q']);
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n', 'utf8');
    git(repo, ['add', 'seed.txt']);
    git(repo, ['commit', '-q', '-m', 'seed']);
    git(repo, ['worktree', 'add', '-q', '-b', 'arana-1', wt]);
  } catch (err) {
    // Entorno sin soporte de worktrees: se cubre la variante fabricada mas abajo.
    cleanup(base);
    t.skip(`git worktree add no disponible: ${err.message.split('\n')[0]}`);
    return;
  }

  assert.equal(fs.statSync(path.join(wt, '.git')).isFile(), true, 'en un worktree .git es un ARCHIVO');

  assert.equal(ensureGitExclude(wt), true, 'debe funcionar aunque .git sea un archivo');
  const commonExclude = path.join(repo, '.git', 'info', 'exclude');
  assert.equal(fs.existsSync(commonExclude), true, 'el exclude debe escribirse en el repo comun');
  const content = fs.readFileSync(commonExclude, 'utf8');
  for (const entry of ENTRIES_TO_CHECK) assert.ok(content.includes(entry), `el exclude comun debe incluir ${entry}`);
  assert.equal(fs.existsSync(path.join(wt, '.gitignore')), false, 'no debe crear .gitignore en el worktree');

  // Idempotente tambien en worktree: no duplica.
  const before = content;
  assert.equal(ensureGitExclude(wt), true);
  assert.equal(fs.readFileSync(commonExclude, 'utf8'), before, 'la segunda llamada no cambia nada');

  cleanup(base);
});

test('fallback sin git: .git como archivo con gitdir resuelve el exclude', (t) => {
  const base = tmp('cb-excl-fake-');
  const fakeGitDir = path.join(base, 'main-repo', '.git', 'worktrees', 'spider');
  fs.mkdirSync(fakeGitDir, { recursive: true });
  fs.writeFileSync(path.join(fakeGitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

  const wt = path.join(base, 'spider');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${fakeGitDir.replace(/\\/g, '/')}\n`, 'utf8');

  // Evita que git ascienda a un repositorio padre si la estructura fabricada no le gusta.
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = base;
  try {
    if (!fs.existsSync(fakeGitDir)) {
      t.skip('no se pudo preparar el gitdir fabricado');
      return;
    }
    assert.equal(ensureGitExclude(wt), true, 'debe resolver el gitdir desde el archivo .git');
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }

  const candidates = [
    path.join(fakeGitDir, 'info', 'exclude'),
    path.join(base, 'main-repo', '.git', 'info', 'exclude')
  ];
  const written = candidates.filter((file) => fs.existsSync(file));
  assert.ok(written.length > 0, `debe escribir un info/exclude (gitdir o comun): ${candidates.join(', ')}`);
  const content = fs.readFileSync(written[0], 'utf8');
  for (const entry of ENTRIES_TO_CHECK) assert.ok(content.includes(entry), `el exclude debe incluir ${entry}`);

  cleanup(base);
});
