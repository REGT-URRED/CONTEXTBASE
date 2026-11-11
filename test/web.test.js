import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PHILOSOPHY,
  arbitrateWeb,
  autoFinalizeSpiderWorktree,
  buildSequentialSubagents,
  calculateTokenEconomy,
  checkWebIntegrity,
  decomposePrey,
  hydrateWorktreeMemory,
  startWeb,
  weaveWeb,
  webFlow,
  webMetrics,
} from '../src/web.js';
import { runSwarmCommand } from '../src/cli_extra.js';
import { runLifecycleHook } from '../src/hooks.js';
import { autoEnsure } from '../src/auto.js';
import { hasStaleAgentConfig } from '../src/autoconfig.js';

function tmp(prefix = 'cb-web-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFakeDeps(root, opts = {}) {
  const calls = [];
  const diffByBranch = opts.diffByBranch || {};
  return {
    calls,
    exec(args, o = {}) {
      calls.push({ args, cwd: o.cwd });
      if (args[0] === 'worktree' && args[1] === 'add') {
        const wtRel = args[2];
        fs.mkdirSync(path.join(root, wtRel), { recursive: true });
        return '';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') {
        const branch = args[3];
        return (diffByBranch[branch] || []).join('\n');
      }
      if (args[0] === 'merge-tree') {
        if (opts.conflictBranch && args[4] === opts.conflictBranch) {
          throw new Error('conflict');
        }
        return 'clean-tree';
      }
      if (args[0] === 'log') {
        return String(opts.lastCommitSec ?? Math.floor(Date.now() / 1000));
      }
      if (args[0] === 'status') {
        return opts.porcelain || '';
      }
      if (args[0] === 'merge') {
        return 'merged';
      }
      return '';
    },
    spawn(launcher, cwd) {
      calls.push({ spawn: launcher, cwd });
      return { pid: 4242 };
    },
    runAgent(args, o = {}) {
      calls.push({ runAgent: args, cwd: o.cwd });
      return '{}';
    },
    alive() {
      return true;
    },
    kill(pid) {
      calls.push({ kill: pid });
    },
  };
}

test('decomposePrey divide la Presa y asigna hilos de archivos estrictamente disjuntos', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'core.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'cli.js'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(dir, 'src', 'db.js'), 'export const c = 3;\n');
  fs.writeFileSync(path.join(dir, 'test', 'core.test.js'), 'export const t = 4;\n');

  const res = decomposePrey(dir, 'Refactorizar core.js; actualizar cli.js; cubrir core.test.js', 3);
  assert.equal(res.spiderCount, 3);
  assert.equal(res.disjointVerified, true);
  assert.equal(res.threads.length, 3);

  const union = new Set();
  for (const t of res.threads) {
    for (const f of t.assignedFiles) {
      assert.equal(union.has(f), false, `El archivo ${f} no debe repetirse entre hilos`);
      union.add(f);
      assert.equal(t.forbiddenFiles.includes(f), false);
    }
  }
  assert.equal(union.size, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('startWeb pre-hidrata worktrees, crea subagents.json secuencial, flow.md y metrics.json con ahorro 70%-95%', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'contextbase'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'contextbase', 'fundamentos.md'), '# Fundamentos\nArquitectura limpia.');
  fs.writeFileSync(path.join(dir, 'contextbase', 'changelog.md'), '# Changelog\n## Cambios Realizados\n');
  fs.writeFileSync(path.join(dir, 'contextbase', 'tasklist.md'), '# Tasklist\n## Tareas Pendientes / En Progreso\n');
  fs.writeFileSync(path.join(dir, 'contextbase', 'componentes.md'), '# Componentes\n- critical: 0\n- high: 0\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'modA.js'), 'export const a = 1;\n'.repeat(40));
  fs.writeFileSync(path.join(dir, 'src', 'modB.js'), 'export const b = 2;\n'.repeat(40));
  fs.writeFileSync(path.join(dir, 'src', 'modC.js'), 'export const c = 3;\n'.repeat(40));

  const deps = makeFakeDeps(dir);
  const out = startWeb(
    {
      cwd: dir,
      prey: 'Optimizar modA; optimizar modB; verificar modC',
      spiders: 3,
      agent: 'opencode',
      base: 'main',
    },
    deps
  );

  assert.equal(out.philosophy, PHILOSOPHY);
  assert.equal(out.spiders.length, 3);
  assert.ok(out.tokenEconomy.savingsPct >= 70 && out.tokenEconomy.savingsPct <= 95);

  for (const w of out.spiders) {
    // subagents.json existe y tiene 3 subagentes secuenciales sin anidamiento
    const subPath = path.join(dir, w.subagents);
    assert.equal(fs.existsSync(subPath), true);
    const sub = JSON.parse(fs.readFileSync(subPath, 'utf8'));
    assert.equal(sub.executionMode, 'strict-sequential');
    assert.equal(sub.allowNestedSubagents, false);
    assert.equal(sub.sequence.length, 3);
    assert.match(sub.sequence[0].name, /Explorador de Hilo/);
    assert.match(sub.sequence[1].name, /Constructor Focalizado/);
    assert.match(sub.sequence[2].name, /Verificador y Árbitro Local/);

    // El worktree fue pre-hidratado con contextbase/ y .spider-context.json
    const wtCb = path.join(dir, w.worktree, 'contextbase');
    assert.equal(fs.existsSync(path.join(wtCb, 'fundamentos.md')), true);
    assert.equal(fs.existsSync(path.join(wtCb, '.spider-context.json')), true);
  }

  // Verificar que contextbase/web/<run> y contextbase/swarm/<run> tienen flow.md y metrics.json
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'web', out.run, 'flow.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'web', out.run, 'metrics.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'swarm', out.run, 'flow.md')), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('arbitrateWeb aplica PASS, REFIX, RERUN y FAIL automaticamente segun el contrato de 100 puntos', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(dir, 'src', 'c.js'), 'export const c = 3;\n');

  const deps = makeFakeDeps(dir);
  const started = startWeb(
    {
      cwd: dir,
      prey: 'Implementar mejoras en paralelo sin romper hilos',
      spiders: 3,
      agent: 'opencode',
      base: 'main',
    },
    deps
  );

  const [w1, w2, w3] = started.spiders;

  // w1 cumple todo: result.md detallado + status.json done -> PASS (100/100)
  fs.writeFileSync(
    path.join(dir, w1.result),
    '# Resultado w1\nQué hice: actualicé el módulo asignado.\nArchivos tocados: src/a.js\nVerificación: tests OK.\nPendiente: nada.',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, w1.status), JSON.stringify({ state: 'done' }), 'utf8');

  // w2 escribió result.md pero tuvo conflicto de merge -> REFIX en intento 1
  fs.writeFileSync(
    path.join(dir, w2.result),
    '# Resultado w2\nQué hice: cambios parciales.\nArchivos tocados: src/b.js\nVerificación: pendiente.',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, w2.status), JSON.stringify({ state: 'done' }), 'utf8');

  // w3 está bloqueado -> RERUN en intento 1
  fs.writeFileSync(path.join(dir, w3.status), JSON.stringify({ state: 'blocked', reason: 'esperando' }), 'utf8');

  const arb1 = arbitrateWeb(
    { cwd: dir, run: started.run },
    makeFakeDeps(dir, { conflictBranch: w2.branch })
  );

  const s1 = arb1.spiders.find((s) => s.id === 'w1');
  const s2 = arb1.spiders.find((s) => s.id === 'w2');
  const s3 = arb1.spiders.find((s) => s.id === 'w3');

  assert.equal(s1.verdict, 'PASS');
  assert.equal(s1.score, 100);
  assert.equal(s2.verdict, 'REFIX');
  assert.equal(s2.retries, 1);
  assert.equal(fs.existsSync(path.join(dir, w2.refix)), true);
  assert.equal(s3.verdict, 'RERUN');
  assert.equal(s3.retries, 1);
  assert.equal(arb1.flowState, 'AUTOCORRIGIENDO');

  // Segundo intento fallido en w2 y luego tercer arbitraje -> corta bucle y marca FAIL (ATENCION_HUMANA)
  arbitrateWeb({ cwd: dir, run: started.run }, makeFakeDeps(dir, { conflictBranch: w2.branch }));
  const arb3 = arbitrateWeb({ cwd: dir, run: started.run }, makeFakeDeps(dir, { conflictBranch: w2.branch }));
  const s2Final = arb3.spiders.find((s) => s.id === 'w2');
  assert.equal(s2Final.verdict, 'FAIL');
  assert.equal(arb3.flowState, 'ATENCION_HUMANA');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkWebIntegrity y weaveWeb detectan colisiones entre hilos y tejen ramas cuando todas estan en PASS', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'export const b = 2;\n');

  const deps = makeFakeDeps(dir);
  const started = startWeb({ cwd: dir, prey: 'Tejer limpio', spiders: 2, agent: 'opencode', base: 'main' }, deps);
  const [w1, w2] = started.spiders;

  for (const w of [w1, w2]) {
    fs.writeFileSync(
      path.join(dir, w.result),
      '# Resultado\nQué hice: completado.\nArchivos tocados: asignados.\nVerificación: ok.',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, w.status), JSON.stringify({ state: 'done' }), 'utf8');
  }

  // Caso 1: Colisión porque ambos tocaron el mismo archivo
  const collisionDeps = makeFakeDeps(dir, {
    diffByBranch: {
      [w1.branch]: ['src/a.js'],
      [w2.branch]: ['src/a.js'],
    },
  });
  const badWeave = weaveWeb({ cwd: dir, run: started.run, merge: true }, collisionDeps);
  assert.equal(badWeave.intact, false);
  assert.equal(badWeave.collisions.length, 1);

  // Caso 2: Hilos disjuntos sin colisión -> PASS y weave limpio
  const cleanDeps = makeFakeDeps(dir, {
    diffByBranch: {
      [w1.branch]: [w1.assignedFiles[0] || 'src/a.js'],
      [w2.branch]: [w2.assignedFiles[0] || 'src/b.js'],
    },
  });
  const goodWeave = weaveWeb({ cwd: dir, run: started.run, merge: true }, cleanDeps);
  assert.equal(goodWeave.intact, true);
  assert.equal(goodWeave.ok, true);
  assert.equal(goodWeave.wovenBranches.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('autonomia en worktree: session-start inyecta mision de Araña y session-stop auto-completa result.md y status.json', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'contextbase'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'contextbase', 'fundamentos.md'), '# F');
  fs.writeFileSync(path.join(dir, 'contextbase', 'changelog.md'), '# C\n## Cambios Realizados\n');
  fs.writeFileSync(path.join(dir, 'contextbase', 'tasklist.md'), '# T\n## Tareas Pendientes / En Progreso\n');
  fs.writeFileSync(path.join(dir, 'contextbase', 'componentes.md'), '# Comp\n- critical: 0\n- high: 0\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const x = 1;\n');

  const deps = makeFakeDeps(dir);
  const started = startWeb({ cwd: dir, prey: 'Automatizar cierre de Araña', spiders: 1, agent: 'opencode', base: 'main' }, deps);
  const w1 = started.spiders[0];
  const wtAbs = path.join(dir, w1.worktree);

  // 1. Al iniciar sesión dentro del worktree de la Araña, el hook devuelve automáticamente las instrucciones del hilo
  const startDigest = await runLifecycleHook('session-start', wtAbs);
  assert.ok(startDigest.includes('MODO ARAÑA ACTIVO EN WORKTREE'));
  assert.ok(startDigest.includes(w1.branch));

  // 2. Al cerrar sesión tras editar un archivo en el worktree, autoFinalizeSpiderWorktree genera result.md y status.json automáticamente
  autoFinalizeSpiderWorktree(wtAbs, ['src/app.js']);
  assert.equal(fs.existsSync(path.join(dir, w1.result)), true);
  assert.equal(fs.existsSync(path.join(dir, w1.status)), true);
  const stJson = JSON.parse(fs.readFileSync(path.join(dir, w1.status), 'utf8'));
  assert.equal(stJson.state, 'done');

  // 3. Y autoEnsure repara configuraciones con rutas rotas (como /tmp/contextbase_work/...)
  fs.writeFileSync(
    path.join(dir, 'opencode.json'),
    JSON.stringify({ mcp: { contextbase: { command: ['/no/existe/node', '/no/existe/cb.js', 'mcp'] } } }),
    'utf8'
  );
  assert.equal(hasStaleAgentConfig(dir), true);
  autoEnsure(dir, { autoConfig: true });
  assert.equal(hasStaleAgentConfig(dir), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
