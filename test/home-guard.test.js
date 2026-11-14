import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureContextBase } from '../src/cli.js';
import { autoEnsure, silentInit, isHomeDirectory } from '../src/auto.js';
import { baseline as guardBaseline, check as guardCheck, refreshBaseline as guardRefreshBaseline } from '../src/guard.js';

function tmp(prefix = 'cb-home-guard-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withHome(dir, fn) {
  const prevUser = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  process.env.USERPROFILE = dir;
  process.env.HOME = dir;
  try {
    return fn();
  } finally {
    if (prevUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUser;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
}

function assertNothingScaffolded(dir) {
  for (const name of ['contextbase', 'AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} no debe crearse en el directorio personal`);
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'el directorio personal debe quedar intacto');
}

test('guardia de hogar: el predicado detecta el HOME via USERPROFILE', () => {
  const home = tmp();
  try {
    withHome(home, () => {
      // En Windows os.homedir() resuelve desde USERPROFILE; si Node cambia esto,
      // el test falla y hay que ampliar isHomeDirectory con el env explicito.
      assert.equal(path.resolve(os.homedir()).toLowerCase(), path.resolve(home).toLowerCase());
      assert.equal(isHomeDirectory(home), true, 'el HOME debe detectarse como directorio personal');
      const project = path.join(home, 'projects', 'foo');
      assert.equal(isHomeDirectory(project), false, 'un proyecto DENTRO del home no debe saltarse');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guardia de hogar: silentInit no crea contextbase/ ni reglas en el HOME', () => {
  const home = tmp();
  try {
    withHome(home, () => {
      const res = silentInit(home);
      assert.equal(res.created, false);
      assert.equal(res.skipped, 'home-directory');
      assert.deepEqual(res.files, []);
    });
    assertNothingScaffolded(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guardia de hogar: autoEnsure reporta el salto y no toca el HOME', () => {
  const home = tmp();
  try {
    withHome(home, () => {
      const res = autoEnsure(home, { autoConfig: true, installSkill: true });
      assert.equal(res.skipped, 'home-directory');
      assert.equal(res.initialized, undefined, 'no debe inicializar nada');
    });
    assertNothingScaffolded(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guardia de hogar: ensureContextBase no inicializa el HOME y no lanza', async () => {
  const home = tmp();
  const prevUser = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    const created = await ensureContextBase(home, true);
    assert.equal(created, false);
    assertNothingScaffolded(home);
  } finally {
    if (prevUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUser;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('guardia de hogar: un proyecto real sigue creando contextbase/', () => {
  const project = tmp('cb-home-guard-proj-');
  try {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo-guard', version: '1.0.0' }, null, 2));
    const res = silentInit(project);
    assert.equal(res.created, true);
    assert.equal(res.skipped, undefined);
    assert.equal(fs.existsSync(path.join(project, 'contextbase')), true, 'un proyecto real debe recibir contextbase/');
    for (const f of ['fundamentos.md', 'changelog.md', 'tasklist.md']) {
      assert.equal(fs.existsSync(path.join(project, 'contextbase', f)), true, `debe generarse ${f}`);
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('guardia de hogar: baseline, check y refreshBaseline nunca escriben en $HOME', () => {
  const home = tmp('cb-home-guard-drift-');
  try {
    withHome(home, () => {
      const b = guardBaseline(home);
      assert.equal(b.skipped, 'home-directory');
      assert.deepEqual(b.files, {});

      const c = guardCheck(home);
      assert.equal(c.status, 'ok');
      assert.equal(c.skipped, 'home-directory');
      assert.deepEqual(c.drifts, []);

      const r = guardRefreshBaseline(home);
      assert.equal(r, false);
      assertNothingScaffolded(home);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
