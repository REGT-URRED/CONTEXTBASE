import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { merge, prompts, prepare } from '../src/review.js';

const GIT = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];

function git(dir, args) {
  return execFileSync('git', [...GIT, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
}

function write(dir, name, body) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initRepo(prefix) {
  const dir = tempDir(prefix);
  git(dir, ['init', '-b', 'main']);
  return dir;
}

function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

// Repo con dos commits: la base y un cambio revisable contra HEAD~1.
function changedRepo(prefix) {
  const dir = initRepo(prefix);
  write(dir, 'README.md', '# Proyecto\n');
  write(dir, 'src/app.js', 'export const sum = (a, b) => a + b;\n');
  commitAll(dir, 'base');
  write(dir, 'src/app.js', 'export const sum = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n');
  commitAll(dir, 'resta');
  return dir;
}

test('merge exige exactamente dos reportes', () => {
  for (const input of [[], ['x'], ['a', 'b', 'c']]) {
    assert.throws(() => merge(input), /exactamente dos/);
  }
});

test('merge marca como coincidencia los hallazgos corroborados', () => {
  const out = merge([
    '- SQL injection en login: la consulta concatena el input del usuario',
    '- La funcion authenticate concatena el input del usuario en la consulta',
  ]);
  assert.ok(out.includes('coincidencias: 1'), out);
});

test('merge separa los hallazgos no relacionados', () => {
  const a = '- SQL injection en login por concatenacion de strings';
  const b = '- Funcion gigante con duplicacion de ramas y nombres pobres';
  const out = merge([a, b]);
  assert.ok(out.includes('coincidencias: 0'), out);
  const restA = out.slice(out.indexOf('## Solo pasada A'));
  const restB = out.slice(out.indexOf('## Solo pasada B'));
  assert.ok(restA.includes(a.trim().slice(2)), restA);
  assert.ok(restB.includes(b.trim().slice(2)), restB);
});

test('prompts devuelve dos bloques de revisor no vacios', () => {
  const p = prompts();
  assert.ok(p.security.length > 0);
  assert.ok(p.quality.length > 0);
  assert.ok(!/this skill/i.test(p.security));
  assert.ok(!/this skill/i.test(p.quality));
});

test('prepare arma diff, contenidos e intencion contra la base', () => {
  const dir = changedRepo('cb-review-prep-');
  const out = prepare(dir, { base: 'HEAD~1', intent: 'verificar la resta sin romper la suma' });
  assert.ok(out.includes('### Git / diff output'), out.slice(0, 400));
  assert.ok(out.includes('### Changed file contents'));
  assert.ok(out.includes('### User scope / intent'));
  assert.ok(out.includes('verificar la resta sin romper la suma'));
  assert.ok(out.includes('export const sub'), out.slice(0, 800));
  assert.ok(out.includes('Reviewer A'));
  assert.ok(out.includes('Reviewer B'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare falla fuera de git, con ref desconocida y con diff vacio', () => {
  const plain = tempDir('cb-review-nogit-');
  assert.throws(() => prepare(plain, {}), /no es un repositorio git/);
  fs.rmSync(plain, { recursive: true, force: true });

  const repo = initRepo('cb-review-badref-');
  write(repo, 'a.txt', 'hola\n');
  commitAll(repo, 'base');
  assert.throws(() => prepare(repo, { base: 'no-existe-esta-ref' }), /no existe en este repositorio/);
  assert.throws(() => prepare(repo, { base: 'HEAD' }), /diff [^\n]*vacio/i);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('prepare trunca archivos que superan el limite', () => {
  const dir = initRepo('cb-review-trunc-');
  write(dir, 'a.txt', 'base\n');
  commitAll(dir, 'base');
  write(dir, 'grande.txt', 'x'.repeat(5000) + '\n');
  commitAll(dir, 'archivo grande');
  const out = prepare(dir, { base: 'HEAD~1' });
  assert.ok(out.includes('archivo truncado'), out.slice(0, 600));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare ve los cambios sin commitear de un arbol sucio', () => {
  const dir = initRepo('cb-review-dirty-');
  write(dir, 'src/app.js', 'export const sum = (a, b) => a + b;\n');
  commitAll(dir, 'base');
  write(dir, 'src/app.js', 'export const sum = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n');

  const out = prepare(dir);
  assert.ok(out.includes('export const mul'), out.slice(0, 800));
  assert.ok(out.includes('Archivos cambiados: 1'), out.slice(0, 400));
  assert.ok(!out.includes('sin seguimiento'), out.slice(0, 400));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare incluye archivos sin seguimiento en contenidos y conteo', () => {
  const dir = initRepo('cb-review-untracked-');
  write(dir, 'a.txt', 'base\n');
  commitAll(dir, 'base');
  write(dir, 'nuevo.txt', 'contenido sin seguimiento\n');
  write(dir, 'package-lock.json', '{}\n');

  const out = prepare(dir);
  assert.ok(out.includes('Archivos cambiados: 1'), out.slice(0, 400));
  assert.ok(out.includes('incluye 1 archivo(s) sin seguimiento'), out.slice(0, 400));
  assert.ok(out.includes('contenido sin seguimiento'), out.slice(0, 1200));

  const diffBlock = out.slice(out.indexOf('### Git / diff output'), out.indexOf('### Changed file contents'));
  assert.ok(!diffBlock.includes('contenido sin seguimiento'), diffBlock);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare mantiene el error de diff vacio con arbol limpio y sin archivos nuevos', () => {
  const dir = initRepo('cb-review-clean-');
  write(dir, 'a.txt', 'hola\n');
  commitAll(dir, 'base');
  assert.throws(() => prepare(dir), /vacio/);
  fs.rmSync(dir, { recursive: true, force: true });
});
