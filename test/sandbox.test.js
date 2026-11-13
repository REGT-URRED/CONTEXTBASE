import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applySandbox, createSandbox, listSandboxes, removeSandbox, runInSandbox } from '../src/sandbox.js';

function tmp(prefix = 'cb-sandbox-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function proyecto() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'original', 'utf8');
  return dir;
}

test('createSandbox copia el proyecto pero excluye .git, node_modules y *.log', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'original', 'utf8');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref', 'utf8');
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'x', 'utf8');
  fs.writeFileSync(path.join(dir, 'debug.log'), 'x', 'utf8');

  const sb = createSandbox(dir, { label: 'exclusiones' });

  assert.equal(fs.existsSync(path.join(sb.path, 'app.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.path, '.git')), false);
  assert.equal(fs.existsSync(path.join(sb.path, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(sb.path, 'debug.log')), false);
});

test('runInSandbox ejecuta en una copia aislada y no toca el proyecto real', async () => {
  const dir = proyecto();
  const res = await runInSandbox(dir, process.execPath, [
    '-e',
    'import("node:fs").then((fs) => fs.writeFileSync("nuevo.txt", "x"))',
  ]);

  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'nuevo.txt')), false, 'el proyecto real no debe recibir el archivo');
  assert.equal(fs.existsSync(path.join(res.path, 'nuevo.txt')), true, 'el sandbox si debe tener el archivo');
  assert.ok(res.changedFiles.includes('nuevo.txt'), 'changedFiles debe incluir nuevo.txt');
});

test('applySandbox promueve los cambios del sandbox al proyecto real', async () => {
  const dir = proyecto();
  const res = await runInSandbox(dir, process.execPath, [
    '-e',
    'import("node:fs").then((fs) => fs.writeFileSync("nuevo.txt", "x"))',
  ]);

  const aplicado = applySandbox(dir, res.id);

  assert.deepEqual(aplicado.applied, ['nuevo.txt']);
  assert.deepEqual(aplicado.rejected, []);
  assert.equal(fs.readFileSync(path.join(dir, 'nuevo.txt'), 'utf8'), 'x');
});

test('un comando que falla reporta su codigo y deja el proyecto intacto', async () => {
  const dir = proyecto();
  const res = await runInSandbox(dir, process.execPath, ['-e', 'process.exit(3)']);

  assert.equal(res.exitCode, 3);
  assert.equal(res.timedOut, false);
  assert.deepEqual(res.changedFiles, []);
  assert.equal(fs.readFileSync(path.join(dir, 'app.txt'), 'utf8'), 'original');
});

test('applySandbox rechaza rutas que escapan del proyecto', () => {
  const root = tmp();
  const dir = path.join(root, 'proyecto');
  fs.mkdirSync(dir, { recursive: true });
  const sb = createSandbox(dir, { label: 'traversal' });

  const fuera = path.join(dir, 'contextbase', 'sandbox', 'escaped.txt');
  fs.writeFileSync(fuera, 'fuera', 'utf8');
  const metaPath = path.join(sb.path, '.sandbox-meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.changedFiles = ['../escaped.txt'];
  fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');

  const res = applySandbox(dir, sb.id);

  assert.ok(res.rejected.includes('../escaped.txt'), 'la ruta debe reportarse como rechazada');
  assert.deepEqual(res.applied, []);
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false, 'no debe escribirse fuera del proyecto');
});

test('listSandboxes lista los sandboxes y tolera metadatos corruptos', () => {
  const dir = tmp();
  const sb = createSandbox(dir, { label: 'etiqueta' });

  const roto = path.join(dir, 'contextbase', 'sandbox', 'roto');
  fs.mkdirSync(roto, { recursive: true });
  fs.writeFileSync(path.join(roto, '.sandbox-meta.json'), '{ esto no es json', 'utf8');

  const items = listSandboxes(dir);

  assert.equal(items.length, 2);
  assert.ok(items.some((i) => i.id === sb.id && i.corrupt === false && i.label === 'etiqueta'));
  assert.ok(items.some((i) => i.id === 'roto' && i.corrupt === true), 'la meta corrupta no debe romper el listado');
});

test('removeSandbox elimina el sandbox y reporta cuando ya no existe', () => {
  const dir = tmp();
  const sb = createSandbox(dir, {});

  assert.deepEqual(removeSandbox(dir, sb.id), { removed: true });
  assert.equal(fs.existsSync(sb.path), false);
  assert.deepEqual(removeSandbox(dir, sb.id), { removed: false });
});
