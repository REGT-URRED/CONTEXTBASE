import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, render } from '../src/slop.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'contextbase.js');

const GIT = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];

function git(dir, args) {
  return execFileSync('git', [...GIT, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
}

function write(dir, name, body) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

// Repo con un commit base; los cambios posteriores quedan sin commitear.
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-slop-'));
  git(dir, ['init', '-b', 'main']);
  for (const [name, body] of Object.entries(files)) write(dir, name, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function rules(result, file) {
  return result.findings.filter(f => f.file === file).map(f => f.rule);
}

test('prosa: palabra de relleno en markdown se reporta con su linea', () => {
  const dir = repo({ 'notes.md': '# Notas\n' });
  write(dir, 'notes.md', '# Notas\n\nOur seamless workflow.\n');
  const r = scan(dir, { base: 'HEAD' });
  const hit = r.findings.find(f => f.rule === 'banned-word');
  assert.ok(hit, JSON.stringify(r.findings));
  assert.equal(hit.file, 'notes.md');
  assert.equal(hit.line, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prosa: not X but Y en markdown se reporta', () => {
  const dir = repo({ 'notes.md': '# Notas\n' });
  write(dir, 'notes.md', '# Notas\n\nThis is not a bug but a feature.\n');
  const r = scan(dir, { base: 'HEAD' });
  assert.ok(rules(r, 'notes.md').includes('not-x-but-y'), JSON.stringify(r.findings));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codigo: palabras de relleno dentro de identificadores o regex no se reportan', () => {
  const dir = repo({ 'src/app.js': 'export const a = 1;\n' });
  write(dir, 'src/app.js', 'export const a = 1;\nexport const seamlessMode = /robust|elevate/g;\n');
  const r = scan(dir, { base: 'HEAD' });
  assert.deepEqual(rules(r, 'src/app.js'), [], JSON.stringify(r.findings));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codigo: palabras de relleno en un comentario si se reportan', () => {
  const dir = repo({ 'src/app.js': 'export const a = 1;\n' });
  write(dir, 'src/app.js', 'export const a = 1;\n// robust helper for every case\nexport const b = 2;\n');
  const r = scan(dir, { base: 'HEAD' });
  const hit = r.findings.find(f => f.rule === 'banned-word' && f.file === 'src/app.js');
  assert.ok(hit, JSON.stringify(r.findings));
  assert.equal(hit.line, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codigo: comentario que repite lo que el codigo ya dice se reporta', () => {
  const dir = repo({ 'src/counter.js': 'let counter = 0;\n' });
  write(dir, 'src/counter.js', 'let counter = 0;\n// initialize the counter\ncounter = counter + 1;\n');
  const r = scan(dir, { base: 'HEAD' });
  const hit = r.findings.find(f => f.rule === 'comment-restates-code');
  assert.ok(hit, JSON.stringify(r.findings));
  assert.equal(hit.line, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('numeracion: el marcador de fin de archivo no corre la linea', () => {
  const dir = repo({ 'tail.js': 'const a = 1;\nconst b = 2;\nconst c = 3;' });
  write(dir, 'tail.js', 'const a = 1;\nconst b = 2;\n// seamless c');
  const diff = git(dir, ['diff', '--no-color', '--text']);
  assert.ok(diff.includes('\\ No newline at end of file'), diff);
  const r = scan(dir, { base: 'HEAD' });
  const hits = r.findings.filter(f => f.file === 'tail.js' && f.rule === 'banned-word');
  assert.equal(hits.length, 1, JSON.stringify(r.findings));
  assert.equal(hits[0].line, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('archivos nuevos sin commit se escanean y numeran desde la linea 1', () => {
  const dir = repo({ 'README.md': '# Proyecto\n' });
  write(dir, 'nuevo.md', 'Our robust plan.\nsegunda linea\n');
  const r = scan(dir, { base: 'HEAD' });
  const hit = r.findings.find(f => f.file === 'nuevo.md' && f.rule === 'banned-word');
  assert.ok(hit, JSON.stringify(r.findings));
  assert.equal(hit.line, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('package-lock.json se omite del escaneo', () => {
  const dir = repo({ 'README.md': '# Proyecto\n' });
  write(dir, 'package-lock.json', '{\n  "name": "robust seamless package"\n}\n');
  const r = scan(dir, { base: 'HEAD' });
  assert.equal(r.scanned, 0, JSON.stringify(r.findings));
  assert.ok(r.findings.every(f => f.file !== 'package-lock.json'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('arbol limpio contra HEAD devuelve vacio con aviso', () => {
  const dir = repo({ 'README.md': '# Proyecto\n' });
  const r = scan(dir, { base: 'HEAD' });
  assert.equal(r.empty, true);
  const out = render(r);
  assert.ok(out.includes('AVISO'), out);
  assert.ok(out.includes('el gate no aplica'), out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: codigo de salida 1 con hallazgos y 0 sin hallazgos', () => {
  const dir = repo({ 'notes.md': '# Notas\n' });

  const clean = spawnSync(process.execPath, [bin, 'slop', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  const cleanJson = JSON.parse(clean.stdout);
  assert.equal(cleanJson.findings.length, 0);

  write(dir, 'notes.md', '# Notas\n\nOur seamless workflow.\n');
  const dirty = spawnSync(process.execPath, [bin, 'slop', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(dirty.status, 1, dirty.stderr);
  const dirtyJson = JSON.parse(dirty.stdout);
  assert.ok(dirtyJson.findings.length > 0);

  fs.rmSync(dir, { recursive: true, force: true });
});
