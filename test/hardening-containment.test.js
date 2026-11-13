import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readState, swarmStatus } from '../src/swarm.js';
import { startWeb, weaveWeb } from '../src/web.js';
import * as snapshot from '../src/snapshot.js';
import { baseline, check, hashFile, loadGuarded } from '../src/guard.js';
import { writeAtomic, withLock } from '../src/fsutil.js';
import { applySandbox } from '../src/sandbox.js';

function tmp(prefix = 'cb-hard-containment-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

/** Dependencias falsas con el mismo contrato que test/web.test.js (sin git real). */
function makeFakeDeps(root, opts = {}) {
  const calls = opts.calls || [];
  const diffByBranch = opts.diffByBranch || {};
  return {
    calls,
    exec(args, o = {}) {
      calls.push([...args]);
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(path.join(root, args[2]), { recursive: true });
        return '';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return (diffByBranch[args[3]] || []).join('\n');
      }
      if (args[0] === 'merge-tree') return 'clean-tree';
      if (args[0] === 'log') return String(opts.lastCommitSec ?? Math.floor(Date.now() / 1000));
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse') return opts.head || '';
      if (args[0] === 'merge' && args[1] === '--no-ff') {
        const branch = args[args.length - 1];
        if (opts.failOnBranch && branch === opts.failOnBranch) throw new Error('CONFLICT (content): Merge conflict simulado');
        return 'merged';
      }
      if (args[0] === 'merge' && args[1] === '--abort') return '';
      if (args[0] === 'reset') return '';
      return '';
    },
    spawn() {
      return { pid: 4242 };
    },
    runAgent() {
      return '{}';
    },
    alive() {
      return true;
    },
    kill() {},
  };
}

// ---------------------------------------------------------------- 1. traversal de run
test('1. un id de run con traversal no resuelve state fuera del area del run', () => {
  const dir = tmp();
  // Trampa: "contextbase/state.json" es justo lo que resuelve run=".." desde contextbase/swarm/..
  writeJson(path.join(dir, 'contextbase', 'state.json'), {
    run: 'run-fuera-del-area',
    base: 'main',
    workers: [],
    task: 'ESTADO_FUERA_DEL_AREA',
  });

  for (const evil of ['..', '.', '../..', '../../x', 'a/b', 'a\\b']) {
    assert.throws(
      () => readState(dir, evil),
      (err) => {
        assert.equal(err.code, 'CB_PATH_ESCAPE', `run="${evil}" debe rechazarse con CB_PATH_ESCAPE`);
        assert.match(err.message, /^\[ContextBase Error\] CB_PATH_ESCAPE \| /);
        return true;
      },
      `readState debe rechazar el run "${evil}"`
    );
    assert.throws(
      () => swarmStatus({ cwd: dir, run: evil }, makeFakeDeps(dir)),
      (err) => err.code === 'CB_PATH_ESCAPE',
      `swarmStatus (web status --run) debe rechazar "${evil}"`
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------- 2. traversal de worker
test('2. un worker con result fuera del proyecto se rechaza al validar el esquema', () => {
  const dir = tmp();
  const outside = tmp('cb-hard-outside-worker-');
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'CONTENIDO_SECRETO', 'utf8');

  const runDir = path.join(dir, 'contextbase', 'swarm', 'run-x');
  writeJson(path.join(runDir, 'state.json'), {
    run: 'run-x',
    base: 'main',
    createdAt: new Date().toISOString(),
    ttlMinutes: 10,
    workers: [
      {
        id: 'w1',
        branch: 'swarm/run-x/w1',
        worktree: '.worktrees/swarm-run-x-w1',
        task: 'contextbase/swarm/run-x/w1/task.md',
        result: toPosix(path.relative(dir, secret)),
        status: 'contextbase/swarm/run-x/w1/status.json',
      },
    ],
  });

  assert.throws(
    () => readState(dir, 'run-x'),
    (err) => {
      assert.equal(err.code, 'CB_PATH_ESCAPE');
      assert.match(err.message, /\[ContextBase Error\] CB_PATH_ESCAPE \| /);
      assert.match(err.message, /result/);
      return true;
    },
    'el estado con un worker que apunta fuera del proyecto no debe cargarse'
  );

  // Y nunca se filtra el contenido del archivo externo por la ruta de status.
  assert.throws(() => swarmStatus({ cwd: dir, run: 'run-x' }, makeFakeDeps(dir)), (err) => err.code === 'CB_PATH_ESCAPE');

  // Control positivo: el mismo estado con rutas contenidas si es valido.
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  state.workers[0].result = 'contextbase/swarm/run-x/w1/result.md';
  writeJson(path.join(runDir, 'state.json'), state);
  assert.equal(readState(dir, 'run-x').workers[0].result, 'contextbase/swarm/run-x/w1/result.md');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// -------------------------------------------------------------- 3. snapshot id invalido
test('3. snapshot.restore con id traversal devuelve ok:false y no copia nada', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'original', 'utf8');
  const root = path.join(dir, 'contextbase', 'snapshot');
  fs.mkdirSync(root, { recursive: true });

  const outside = tmp('cb-hard-outside-snap-');
  fs.writeFileSync(path.join(outside, 'AGENTS.md'), 'SECUESTRADO', 'utf8');
  const evilId = toPosix(path.relative(root, outside));

  const res = await snapshot.restore(dir, evilId);

  assert.equal(res.ok, false, 'un id que escapa no puede restaurarse');
  assert.deepEqual(res.restored, []);
  assert.match(res.error, /CB_PATH_ESCAPE/);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'original', 'no debe copiarse nada desde fuera');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// ------------------------------------------------------------ 4. guarded.json con escape
test('4. guarded.json descarta entradas que escapan y no rompe check()', () => {
  const dir = tmp();
  const outside = tmp('cb-hard-outside-guarded-');
  const evilFile = path.join(outside, 'outside.md');
  fs.writeFileSync(evilFile, 'FUERA', 'utf8');
  const evilRel = toPosix(path.relative(dir, evilFile));

  writeJson(path.join(dir, 'contextbase', 'guarded.json'), [evilRel, 'notas.md']);

  const guarded = loadGuarded(dir);
  assert.equal(guarded.includes(evilRel), false, 'la entrada que escapa debe descartarse');
  assert.ok(guarded.includes('AGENTS.md'), 'la lista base debe seguir intacta');
  assert.ok(guarded.includes('notas.md'), 'las entradas legitimas deben conservarse');

  const res = check(dir);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.drifts, []);

  baseline(dir);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'contextbase', 'baseline.json'), 'utf8'));
  assert.equal(
    Object.keys(stored.files).some((k) => k.startsWith('..') || path.isAbsolute(k)),
    false,
    'el baseline no debe registrar rutas fuera del proyecto'
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// --------------------------------------------------------------- 5. state.json corrupto
test('5. state.json corrupto produce un error accionable con la ruta y sin "Unexpected token"', () => {
  const dir = tmp();
  const runDir = path.join(dir, 'contextbase', 'swarm', 'run-roto');
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, 'state.json');
  fs.writeFileSync(file, '{ "run": "run-roto", "base": "main", "workers": [ } ', 'utf8');

  let error = null;
  try {
    readState(dir, 'run-roto');
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'un state.json invalido debe lanzar');
  assert.equal(error.code, 'CB_STATE_CORRUPT');
  assert.ok(error.message.includes(file), 'el mensaje debe indicar la ruta del archivo');
  assert.match(error.message, /\[ContextBase Error\] CB_STATE_CORRUPT \| /);
  assert.match(error.message, /Recuperacion:/i);
  assert.equal(/Unexpected token/i.test(error.message), false, 'no debe filtrar el mensaje crudo del parser');
  assert.equal(/JSON at position/i.test(error.message), false);

  // Esquema incompleto: sin "base".
  writeJson(file, { run: 'run-roto', workers: [] });
  assert.throws(
    () => readState(dir, 'run-roto'),
    (err) => err.code === 'CB_STATE_SCHEMA' && err.message.includes(file) && /base/.test(err.message)
  );

  // Esquema incompleto: workers no es array.
  writeJson(file, { run: 'run-roto', base: 'main', workers: {} });
  assert.throws(
    () => readState(dir, 'run-roto'),
    (err) => err.code === 'CB_STATE_SCHEMA' && err.message.includes(file) && /workers/.test(err.message)
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------- 6. lock ajeno
test('6. withLock usa token de propiedad: no borra el lock ajeno ni roba uno con dueno vivo', () => {
  const dir = tmp();
  const file = path.join(dir, 'x.md');
  const lock = `${file}.lock`;
  const deadChild = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  const deadPid = deadChild.pid;

  // (a) el lock propio contiene un token con pid + timestamp + aleatorio.
  const tokenRaw = withLock(file, () => fs.readFileSync(lock, 'utf8'));
  const token = JSON.parse(tokenRaw);
  assert.equal(token.pid, process.pid);
  assert.ok(token.token && token.token.length >= 8);
  assert.equal(fs.existsSync(lock), false, 'el lock propio se libera al terminar');

  // (b) si otro proceso reemplaza el lock durante fn, el finally NO lo borra.
  const foreign = JSON.stringify({ pid: 999999, at: Date.now(), token: 'ajeno' });
  withLock(file, () => {
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, foreign, 'utf8');
  });
  assert.equal(fs.existsSync(lock), true, 'no debe borrarse el lock de otro proceso');
  assert.equal(fs.readFileSync(lock, 'utf8'), foreign);
  fs.unlinkSync(lock);

  // (c) lock "stale" por mtime pero con dueno vivo: no se roba.
  const staleLive = JSON.stringify({ pid: process.pid, at: Date.now() - 60000, token: 'vivo' });
  fs.writeFileSync(lock, staleLive, 'utf8');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.throws(
    () => withLock(file, () => 'nunca', 80),
    (err) => err.code === 'CB_LOCK_BUSY',
    'un lock con dueno vivo no debe robarse aunque supere el umbral de antiguedad'
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), staleLive, 'el lock del dueno vivo debe seguir intacto');
  fs.unlinkSync(lock);

  // (d) control positivo: un lock stale cuyo dueno murio si se recupera.
  const staleDead = JSON.stringify({ pid: deadPid, at: Date.now() - 60000, token: 'muerto' });
  fs.writeFileSync(lock, staleDead, 'utf8');
  fs.utimesSync(lock, old, old);
  assert.equal(withLock(file, () => 'ok'), 'ok');
  assert.equal(fs.existsSync(lock), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------- 7. writeAtomic limpia el .tmp
test('7. writeAtomic no deja .tmp huerfano cuando la escritura falla', () => {
  const dir = tmp();
  const target = path.join(dir, 'destino-directorio');
  fs.mkdirSync(target, { recursive: true });

  assert.throws(
    () => writeAtomic(target, 'contenido'),
    (err) => {
      assert.equal(err.code, 'CB_ATOMIC_WRITE');
      assert.match(err.message, /\[ContextBase Error\] CB_ATOMIC_WRITE \| writeAtomic \| /);
      return true;
    },
    'escribir sobre un directorio debe fallar con un error accionable'
  );

  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no debe quedar ningun temporal huerfano');
  assert.deepEqual(fs.readdirSync(dir), ['destino-directorio']);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------ 8. applySandbox con rollback
test('8. applySandbox revierte todo lo aplicado cuando un archivo falla a mitad', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'original', 'utf8');
  // "bloqueo" es un archivo: impide crear "bloqueo/b.txt" en el proyecto real.
  fs.writeFileSync(path.join(dir, 'bloqueo'), 'soy un archivo', 'utf8');

  const sandboxPath = path.join(dir, 'contextbase', 'sandbox', 'sb1');
  fs.mkdirSync(path.join(sandboxPath, 'bloqueo'), { recursive: true });
  fs.writeFileSync(path.join(sandboxPath, 'ok.txt'), 'modificado', 'utf8');
  fs.writeFileSync(path.join(sandboxPath, 'bloqueo', 'b.txt'), 'x', 'utf8');
  writeJson(path.join(sandboxPath, '.sandbox-meta.json'), {
    id: 'sb1',
    origin: dir,
    createdAt: new Date().toISOString(),
    changedFiles: ['ok.txt', 'bloqueo/b.txt'],
  });

  assert.throws(
    () => applySandbox(dir, 'sb1'),
    (err) => {
      assert.equal(err.code, 'CB_SANDBOX_APPLY');
      assert.match(err.message, /bloqueo\/b\.txt/);
      assert.match(err.message, /Se revirtieron 1 archivo/);
      return true;
    },
    'un fallo a mitad debe propagarse'
  );

  assert.equal(
    fs.readFileSync(path.join(dir, 'ok.txt'), 'utf8'),
    'original',
    'el archivo ya aplicado debe volver a su contenido original'
  );
  assert.equal(fs.readFileSync(path.join(dir, 'bloqueo'), 'utf8'), 'soy un archivo');
  // El sandbox sigue consistente y reutilizable.
  const meta = JSON.parse(fs.readFileSync(path.join(sandboxPath, '.sandbox-meta.json'), 'utf8'));
  assert.deepEqual(meta.changedFiles, ['ok.txt', 'bloqueo/b.txt']);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------ 9. weaveWeb con rollback
test('9. weaveWeb revierte las ramas ya tejidas cuando una fusion falla', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'export const b = 2;\n', 'utf8');

  const started = startWeb(
    { cwd: dir, prey: 'tejer con rollback', spiders: 2, agent: 'opencode', base: 'main' },
    makeFakeDeps(dir)
  );
  const [w1, w2] = started.spiders;
  for (const w of [w1, w2]) {
    fs.writeFileSync(
      path.join(dir, w.result),
      '# Resultado\nQué hice: completado.\nArchivos tocados: asignados.\nVerificación: ok.\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, w.status), JSON.stringify({ state: 'done' }), 'utf8');
  }

  const calls = [];
  const head = 'deadbeefcafe1234';
  const mergeDeps = makeFakeDeps(dir, {
    calls,
    head,
    failOnBranch: w2.branch,
    diffByBranch: { [w1.branch]: ['src/a.js'], [w2.branch]: ['src/b.js'] },
  });

  const out = weaveWeb({ cwd: dir, run: started.run, merge: true }, mergeDeps);

  assert.equal(out.ok, false);
  assert.equal(out.code, 'CB_WEAVE_ROLLBACK');
  assert.equal(out.failedBranch, w2.branch);
  assert.deepEqual(out.wovenBranches, [w1.branch]);
  assert.deepEqual(out.rolledBack, [w1.branch], 'debe reportar la rama ya tejida que se revirtio');
  assert.ok(calls.some((c) => c[0] === 'merge' && c[1] === '--abort'), 'debe abortar el merge en curso');
  assert.ok(
    calls.some((c) => c[0] === 'reset' && c[1] === '--hard' && c[2] === head),
    `debe volver al commit previo (${head})`
  );
  assert.match(out.error, /\[ContextBase Error\] CB_WEAVE_ROLLBACK \| weaveWeb \| /);
  assert.match(out.error, new RegExp(w2.branch.replace(/[/\\]/g, '\\$&')));

  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------- 10. CRLF vs LF en guard/baseline
test('10. CRLF y LF hashean igual; un cambio real de contenido sigue dando deriva', () => {
  const dir = tmp();
  const file = path.join(dir, 'AGENTS.md');
  const bfile = path.join(dir, 'contextbase', 'baseline.json');

  // Baseline con LF.
  fs.writeFileSync(file, '# Reglas\nlinea uno\nlinea dos\n', 'utf8');
  baseline(dir);
  assert.equal(check(dir).status, 'ok');

  // El mismo contenido con CRLF no debe reportar deriva.
  fs.writeFileSync(file, '# Reglas\r\nlinea uno\r\nlinea dos\r\n', 'utf8');
  const afterCrlf = check(dir);
  assert.equal(afterCrlf.status, 'ok', 'CRLF no debe ser deriva');
  assert.deepEqual(afterCrlf.drifts, []);

  // Compatibilidad: baseline legado con el hash crudo (sin normalizar) se migra una vez.
  const rawHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const legacy = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  legacy.files['AGENTS.md'] = { hash: rawHash, mtime: new Date(0).toISOString() };
  fs.writeFileSync(bfile, JSON.stringify(legacy, null, 2), 'utf8');

  const migrated = check(dir);
  assert.equal(migrated.status, 'ok', 'un baseline legado no debe producir deriva falsa');
  const stored = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  assert.equal(stored.files['AGENTS.md'].hash, hashFile(file), 'el baseline debe quedar migrado al hash normalizado');
  assert.notEqual(stored.files['AGENTS.md'].hash, rawHash);

  // Control negativo: cambiar una palabra real si es deriva.
  fs.writeFileSync(file, '# Reglas\r\nlinea uno CAMBIADA\r\nlinea dos\r\n', 'utf8');
  const drift = check(dir);
  assert.equal(drift.status, 'drift');
  assert.ok(drift.drifts.some((d) => d.file === 'AGENTS.md' && d.kind === 'modified' && d.reason === 'hash mismatch'));

  fs.rmSync(dir, { recursive: true, force: true });
});
