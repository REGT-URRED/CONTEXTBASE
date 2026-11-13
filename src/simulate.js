import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { arbitrateWeb, SWARM_DIR } from './web.js';
import { writeState } from './swarm.js';

/**
 * Arnés de verificación probabilística del Árbitro Automático (Telaraña ContextBase).
 *
 * Regla de oro: cada veredicto reportado es un veredicto REAL de `arbitrateWeb`.
 * El simulador solo siembra proyectos sintéticos aislados en `os.tmpdir()` y mide
 * cuántas veces el Árbitro clasifica bien. No reimplementa la lógica de puntaje.
 */

const WEB_DIR = 'contextbase/web';
const PHILOSOPHY = 'No es la IA, es quien controla la IA';

// ---------------------------------------------------------------------------
// PRNG determinista (mulberry32). Nunca se usa Math.random.
// ---------------------------------------------------------------------------

function mulberry32(state) {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla (seed, escenario, ronda) en una semilla estable e independiente del orden de ejecución. */
function mixSeed(seed, scenarioIndex, round) {
  let h = (Number(seed) || 0) >>> 0;
  h = Math.imul(h ^ (scenarioIndex + 1), 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (round + 1), 0x85ebca77) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function pick(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

// ---------------------------------------------------------------------------
// Fixtures: proyecto sintético + corrida sintética + git inyectado
// ---------------------------------------------------------------------------

const SPIDER_IDS = ['w1', 'w2'];

/** Textos detallados: cumplen el contrato result.md (>= 25 chars o palabras clave). */
const DETAILED_RESULTS = [
  '# Resultado\nQué hice: implementé el segmento asignado del hilo.\nArchivos tocados: el archivo del hilo.\nVerificación: pruebas locales en verde.\nPendiente: nada.',
  '# Resultado del hilo\nResumen: cambios aplicados en el módulo asignado.\nArchivos tocados: uno solo.\nCómo se verificó: suite focalizada OK.\nPendiente: ninguno.',
  '# Resultado\nCambio completado en el hilo aislado.\nArchivos tocados: el asignado.\nVerificación: compilación y pruebas OK.\nPendiente: nada bloqueante.',
];

/**
 * Textos delgados: ninguno contiene palabras clave del contrato result.md.
 * Las variantes largas (>= 25 chars) se quedan con el bonus de longitud pero
 * sin las palabras clave; todas siguen por debajo del umbral de PASS.
 */
const THIN_RESULTS = [
  'ok',
  'wip',
  'avance',
  'avance parcial del hilo sin detalle', // 34 chars: bonus de longitud, cero palabras clave
  'trabajo en curso pendiente de cierre', // 36 chars: ídem
];

/**
 * Escribe el estado de la corrida sintética (contextbase/swarm/<run>/state.json y su espejo web).
 * Usa el `writeState` real para no duplicar el contrato de estado.
 */
function seedRun(dir, runId, { base = 'HEAD', extraWorkers = [] } = {}) {
  const workers = SPIDER_IDS.map((id, index) => ({
    id,
    spiderName: `araña-${index + 1}`,
    role: 'Hilo de Ejecución Sintético',
    preySegment: `Segmento ${id} de la simulación`,
    assignedFiles: [index === 0 ? 'src/a.js' : 'src/b.js'],
    forbiddenFiles: [index === 0 ? 'src/b.js' : 'src/a.js'],
    branch: `swarm/${runId}/${id}`,
    worktree: `.worktrees/swarm-${runId}-${id}`,
    session: `ses-sim-${runId}-${id}`,
    scope: `${runId}-${id}`,
    retries: 0,
    verdict: 'PENDING',
    pid: null,
    task: `${SWARM_DIR}/${runId}/${id}/task.md`,
    result: `${SWARM_DIR}/${runId}/${id}/result.md`,
    status: `${SWARM_DIR}/${runId}/${id}/status.json`,
    subagents: `${SWARM_DIR}/${runId}/${id}/subagents.json`,
    refix: `${SWARM_DIR}/${runId}/${id}/refix.md`,
    launcher: `${SWARM_DIR}/${runId}/${id}/${process.platform === 'win32' ? 'launch.cmd' : 'launch.sh'}`,
    ...(extraWorkers.find((w) => w.id === id) || {}),
  }));

  const state = {
    run: runId,
    philosophy: PHILOSOPHY,
    base,
    agent: 'opencode',
    universal: false,
    task: 'Simulación probabilística del Árbitro Automático',
    prey: 'Simulación probabilística del Árbitro Automático',
    spiders: workers.length,
    flowState: 'EN_ZONA',
    createdAt: new Date().toISOString(),
    ttlMinutes: 10,
    workers,
  };

  for (const w of workers) {
    fs.mkdirSync(path.join(dir, SWARM_DIR, runId, w.id), { recursive: true });
    fs.mkdirSync(path.join(dir, WEB_DIR, runId, w.id), { recursive: true });
    fs.mkdirSync(path.join(dir, w.worktree), { recursive: true });
  }
  writeState(dir, state);
  return state;
}

/**
 * Git inyectado: mismo patrón que test/web.test.js. `options` es mutable para que
 * cada `build(ctx)` declare el comportamiento de merge/diff de su escenario.
 */
function makeDeps(root) {
  const options = { diffByBranch: {}, conflictBranch: null, porcelain: '' };
  const deps = {
    options,
    exec(args, o = {}) {
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(path.join(root, args[2]), { recursive: true });
        return '';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') {
        const branch = args[3];
        return (options.diffByBranch[branch] || []).join('\n');
      }
      if (args[0] === 'merge-tree') {
        if (options.conflictBranch && args[4] === options.conflictBranch) {
          throw new Error('conflict');
        }
        return 'clean-tree';
      }
      if (args[0] === 'log') return String(Math.floor(Date.now() / 1000));
      if (args[0] === 'status') return options.porcelain || '';
      if (args[0] === 'merge') return 'merged';
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
  return deps;
}

function writeResult(dir, worker, text) {
  fs.writeFileSync(path.join(dir, worker.result), text, 'utf8');
}

function writeStatus(dir, worker, payload) {
  fs.writeFileSync(path.join(dir, worker.status), JSON.stringify(payload), 'utf8');
}

/** Siembra el hilo "sano": result.md detallado + status done + diff limpio + merge limpio. */
function seedCleanWorker(ctx, id, text) {
  const worker = ctx.workers.find((w) => w.id === id);
  writeResult(ctx.dir, worker, text || DETAILED_RESULTS[0]);
  writeStatus(ctx.dir, worker, { state: 'done' });
}

// ---------------------------------------------------------------------------
// Plantilla de repositorio git real para poder disparar el gate antislop.
// slop.scan() ejecuta git de verdad (no acepta deps), así que el único modo de
// obtener hallazgos reales es un worktree que sea repositorio. Se crea UNA vez
// y se copia por ronda: el costo de git se paga una sola vez.
// ---------------------------------------------------------------------------

function createSlopTemplate(templateDir) {
  fs.mkdirSync(templateDir, { recursive: true });
  const git = (args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=sim',
        '-c',
        'user.email=sim@example.invalid',
        '-c',
        'init.defaultBranch=main',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.safecrlf=false',
        ...args,
      ],
      { cwd: templateDir, stdio: 'ignore', windowsHide: true, timeout: 20000 }
    );
  git(['init']);
  // Commit vacío: alcanza para que `resolveBase` encuentre HEAD y para que el diff
  // sea vacío; así el gate antislop solo ve el archivo infractor de cada ronda.
  git(['commit', '--allow-empty', '-m', 'base']);
}

/** Frases que disparan reglas reales de antislop (prosa, no código). */
const SLOP_LINES = [
  'Entrega seamless y robusta para el equipo.',
  'This is not a fix but a masterpiece.',
  'Resultado — claro — preciso — listo.',
  '**Resumen**: todo listo para integrar.',
];

// ---------------------------------------------------------------------------
// Catálogo de escenarios
// ---------------------------------------------------------------------------

/**
 * Cada escenario declara el veredicto FINAL esperado y la regla exacta que ejercita.
 * `resolvable: true` significa que un autoFix real (re-siembra del estado corregido)
 * puede llevarlo a PASS en el siguiente intento.
 * `escalates: true` significa que el escenario recorre la escalera completa de
 * reintentos hasta que el Árbitro corta el bucle con FAIL.
 */
export const ARBITRATION_SCENARIOS = [
  {
    id: 'happy-clean',
    title: 'Hilo limpio: contrato completo y merge sin conflictos',
    kind: 'happy',
    // Regla: 20 (result.md) + 10 (detalle) + 20 (status done) + 20 (0 slop) + 30 (merge clean) = 100 -> PASS.
    expect: ['PASS'],
    resolvable: false,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', pick(ctx.rng, DETAILED_RESULTS));
      seedCleanWorker(ctx, 'w2', pick(ctx.rng, DETAILED_RESULTS));
    },
  },
  {
    id: 'happy-after-refix',
    title: 'Conflicto de merge que el reintento resolutivo convierte en PASS',
    kind: 'happy',
    // Regla: merge conflict -> 70/100 -> REFIX (retries 1 < maxRetries). Tras re-sembrar
    // el estado corregido, el intento 2 vuelve a 100 y el Árbitro da PASS.
    expect: ['PASS'],
    resolvable: true,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', pick(ctx.rng, DETAILED_RESULTS));
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
      ctx.deps.options.conflictBranch = ctx.workers[0].branch;
    },
    resolve(ctx) {
      ctx.deps.options.conflictBranch = null;
      seedCleanWorker(ctx, 'w1', DETAILED_RESULTS[0]);
    },
  },
  {
    id: 'unhappy-no-result',
    title: 'Araña sin result.md: no hay resumen verificable',
    kind: 'unhappy',
    // Regla: resultExists === false y state !== 'done' -> RERUN (relanzar), nunca PASS.
    expect: ['RERUN'],
    resolvable: false,
    build(ctx) {
      const w1 = ctx.workers[0];
      // Variantes: status ausente, "running" o "pending": todas derivan en RERUN.
      // (Nunca "done": un done sin result.md saltaría a REFIX, otra rama distinta.)
      const variant = pick(ctx.rng, ['absent', 'running', 'pending']);
      if (variant !== 'absent') writeStatus(ctx.dir, w1, { state: variant });
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
    },
  },
  {
    id: 'unhappy-stale',
    title: 'Araña stale por TTL vencido aunque tenga score alto',
    kind: 'unhappy',
    // Regla: st.stale -> RERUN. El hilo tiene 80/100 (pierde los 20 de status),
    // prueba que el estado stale manda sobre el puntaje.
    expect: ['RERUN'],
    resolvable: false,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', pick(ctx.rng, DETAILED_RESULTS));
      writeStatus(ctx.dir, ctx.workers[0], { state: 'stale' });
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
    },
  },
  {
    id: 'unhappy-blocked',
    title: 'Araña bloqueada que reporta blocked',
    kind: 'unhappy',
    // Regla: st.state === 'blocked' -> RERUN (relanza en su worktree). 80/100 sin PASS.
    expect: ['RERUN'],
    resolvable: false,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', pick(ctx.rng, DETAILED_RESULTS));
      writeStatus(ctx.dir, ctx.workers[0], { state: 'blocked', reason: 'esperando dependencia' });
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
    },
  },
  {
    id: 'unhappy-slop',
    title: 'Diff con hallazgos antislop reales en el worktree',
    kind: 'unhappy',
    // Regla: slopFindings > 0 -> pierde los 20 del gate antislop (80/100) y,
    // con result.md + done, cae en REFIX. Los hallazgos son reales: slop.scan()
    // corre git sobre un worktree que sí es repositorio.
    expect: ['REFIX'],
    resolvable: false,
    needsSlopTemplate: true,
    // slop.scan() lanza 4 procesos git reales por ronda (~0.5 s en Windows), así que
    // este escenario consume un presupuesto de rondas menor para no inflar el lote.
    roundsCap: 3,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', DETAILED_RESULTS[0]);
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
      const worktree = path.join(ctx.dir, ctx.workers[0].worktree);
      fs.cpSync(ctx.slopTemplate, worktree, { recursive: true });
      const hits = 1 + Math.floor(ctx.rng() * 3); // 1 a 3 líneas infractoras
      const body = ['# Notas del hilo', ...SLOP_LINES.slice(0, hits)].join('\n') + '\n';
      fs.writeFileSync(path.join(worktree, 'notes.md'), body, 'utf8');
    },
  },
  {
    id: 'unhappy-conflict',
    title: 'Conflicto de merge persistente que nunca se resuelve',
    kind: 'unhappy',
    // Regla: 70/100 -> REFIX y, al agotarse maxRetries, la rama `retries >= maxRetries`
    // corta el bucle con FAIL (ATENCION_HUMANA). Se recorre la escalera completa.
    expect: ['FAIL'],
    resolvable: false,
    escalates: true,
    // Cada ronda agota 3 arbitrajes (REFIX, REFIX, FAIL): tope más bajo de rondas.
    roundsCap: 6,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', pick(ctx.rng, DETAILED_RESULTS));
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
      ctx.deps.options.conflictBranch = ctx.workers[0].branch;
    },
  },
  {
    id: 'unhappy-invaded',
    title: 'Ruptura de aislamiento: el diff toca archivos de otra Araña',
    kind: 'unhappy',
    // Regla: `invadedFiles.length > 0` anula los 30 puntos de merge/isolation -> 70/100
    // -> REFIX en el primer pase (retries 0 < maxRetries). Nunca PASS: la invasión
    // es un defecto estructural, no un problema de puntaje que un bonus tape.
    expect: ['REFIX'],
    resolvable: false,
    build(ctx) {
      seedCleanWorker(ctx, 'w1', DETAILED_RESULTS[0]);
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
      const other = ctx.workers[1];
      // w1 modificó el archivo asignado a w2 (forbiddenFiles de w1).
      ctx.deps.options.diffByBranch[ctx.workers[0].branch] = [other.assignedFiles[0]];
      ctx.deps.options.diffByBranch[other.branch] = [];
    },
  },
  {
    id: 'unhappy-low-score',
    title: 'result.md delgado y estado sin confirmar: puntaje mínimo',
    kind: 'unhappy',
    // Regla: result.md sin bonus de detalle (20/30) + status no done (0/20) pero
    // merge limpio (30/30) y 0 slop (20/20) -> 70-80/100 -> REFIX. Nunca PASS.
    expect: ['REFIX'],
    resolvable: false,
    build(ctx) {
      const w1 = ctx.workers[0];
      const thin = pick(ctx.rng, THIN_RESULTS);
      writeResult(ctx.dir, w1, thin);
      writeStatus(ctx.dir, w1, { state: pick(ctx.rng, ['running', 'pending']) });
      seedCleanWorker(ctx, 'w2', DETAILED_RESULTS[0]);
    },
  },
];

// ---------------------------------------------------------------------------
// Ejecución de una ronda
// ---------------------------------------------------------------------------

const VERDICTS = ['PASS', 'REFIX', 'RERUN', 'FAIL'];

function round(ctx, scenario, { maxRetries, autoFix = true }) {
  const attemptsBudget = scenario.escalates || scenario.resolvable ? maxRetries + 1 : 1;
  let verdict = null;
  let score = 0;
  let attempts = 0;
  let firstVerdict = null;

  for (let attempt = 1; attempt <= attemptsBudget; attempt += 1) {
    attempts = attempt;
    const arbitration = arbitrateWeb(
      { cwd: ctx.dir, run: ctx.run, autoFix, maxRetries },
      ctx.deps
    );
    const subject =
      arbitration.spiders.find((s) => s.id === (scenario.subject || 'w1')) || arbitration.spiders[0];
    verdict = subject.verdict;
    score = subject.score;
    if (attempt === 1) firstVerdict = verdict;

    if (verdict === 'PASS') break;
    // autoFix real: el Árbitro ya escribió refix.md; acá se re-siembra el estado
    // corregido (equivalente a que la Araña aplique la orden y vuelva a commitear).
    if (scenario.resolvable && typeof scenario.resolve === 'function') {
      if (verdict === 'REFIX' || verdict === 'RERUN') {
        scenario.resolve(ctx);
        continue;
      }
    }
  }

  return { verdict, score, attempts, firstVerdict };
}

// ---------------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------------

/**
 * Ejercita el Árbitro real sobre el catálogo de escenarios y devuelve probabilidades
 * medidas (no opiniones): tasa de PASS por escenario, intentos medios y tasas de
 * falso PASS / falso FAIL.
 *
 * `rounds` es el presupuesto por escenario. El default es 10 (no 60) porque cada
 * arbitraje real cuesta ~30 ms en Windows (escrituras atómicas del run) y el gate
 * antislop lanza git de verdad: 10 rondas rinden ~130 arbitrajes en ~4-6 s.
 */
export async function simulateArbitration({
  rounds = 10,
  seed = 1,
  scenarioIds,
  maxRetries = 2,
  parallel = 4,
  root,
} = {}) {
  const selected = scenarioIds && scenarioIds.length
    ? ARBITRATION_SCENARIOS.filter((s) => scenarioIds.includes(s.id))
    : ARBITRATION_SCENARIOS.slice();

  const workers = Math.max(1, Math.min(16, Number(parallel) || 1));
  const requestRounds = Math.max(1, Number(rounds) || 1);

  const ownsRoot = !root;
  const baseRoot = root || fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sim-'));
  fs.mkdirSync(baseRoot, { recursive: true });

  const startedAt = Date.now();
  let slopTemplate = null;
  const skipped = [];

  if (selected.some((s) => s.needsSlopTemplate)) {
    const templateDir = path.join(baseRoot, '.slop-template');
    try {
      createSlopTemplate(templateDir);
      slopTemplate = templateDir;
    } catch (err) {
      skipped.push(`unhappy-slop omitido: git no disponible (${err.message})`);
    }
  }

  const active = selected.filter((s) => !(s.needsSlopTemplate && !slopTemplate));

  // Plan determinista: cada ronda tiene su propia semilla derivada, así el resultado
  // no depende del orden ni del grado de paralelismo.
  const plan = [];
  const perScenario = new Map();
  active.forEach((scenario, scenarioIndex) => {
    perScenario.set(scenario.id, []);
    const budget = Math.min(requestRounds, scenario.roundsCap || requestRounds);
    for (let r = 0; r < budget; r += 1) {
      plan.push({ scenario, scenarioIndex, r, itemSeed: mixSeed(seed, scenarioIndex, r) });
    }
  });

  const cleanup = (dir) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: Windows puede retener handles brevemente
    }
  };

  const runItem = async ({ scenario, r, itemSeed }) => {
    const dir = path.join(baseRoot, `s-${scenario.id}-r${r}`);
    const runId = `sim-${scenario.id}-${r}`;
    const rng = mulberry32(itemSeed);
    fs.mkdirSync(dir, { recursive: true });
    const state = seedRun(dir, runId);
    const deps = makeDeps(dir);
    const ctx = {
      dir,
      run: runId,
      state,
      workers: state.workers,
      deps,
      rng,
      slopTemplate,
    };
    try {
      scenario.build(ctx);
      const outcome = round(ctx, scenario, { maxRetries });
      return { scenarioId: scenario.id, ...outcome };
    } finally {
      cleanup(dir);
    }
  };

  // Un escenario puede fallar por una causa transitoria (antislop lanza git real y
  // bajo carga puede agotar el timeout). Se reintenta una vez y, si persiste, el
  // fallo se registra como error del escenario: nunca se traga en silencio ni se
  // convierte en "0 outcomes", que es indistinguible de "sin datos".
  const executeItem = async (item) => {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await runItem(item);
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return {
      scenarioId: item.scenario.id,
      error: lastError && lastError.message ? lastError.message : String(lastError),
    };
  };

  // Pool de workers: el trabajo es síncrono, así que el paralelismo se intercala
  // por turnos del event loop. Se mide igual el throughput real del lote.
  let cursor = 0;
  const sink = new Array(plan.length);
  const runner = async () => {
    while (cursor < plan.length) {
      const index = cursor;
      cursor += 1;
      sink[index] = await executeItem(plan[index]);
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(workers, plan.length) }, () => runner()));

  const durationMs = Date.now() - startedAt;

  for (const row of sink) {
    if (row) perScenario.get(row.scenarioId).push(row);
  }

  // -------------------------------------------------------------------------
  // Agregación
  // -------------------------------------------------------------------------

  const round4 = (n) => Math.round(Number(n) * 10000) / 10000;
  const round2 = (n) => Math.round(Number(n) * 100) / 100;

  const scenarios = active.map((scenario) => {
    const rows = perScenario.get(scenario.id) || [];
    const ok = rows.filter((row) => !row.error);
    const errors = rows.filter((row) => row.error).map((row) => row.error);
    const outcomes = { PASS: 0, REFIX: 0, RERUN: 0, FAIL: 0 };
    let scoreSum = 0;
    let attemptsSum = 0;
    let firstTryPass = 0;
    for (const row of ok) {
      outcomes[row.verdict] = (outcomes[row.verdict] || 0) + 1;
      scoreSum += row.score;
      attemptsSum += row.attempts;
      if (row.firstVerdict === 'PASS') firstTryPass += 1;
    }
    const n = ok.length || 1;
    return {
      id: scenario.id,
      title: scenario.title,
      kind: scenario.kind,
      expect: scenario.expect.slice(),
      outcomes,
      errors,
      passRate: round4(outcomes.PASS / n),
      meanScore: round2(scoreSum / n),
      meanAttempts: round2(attemptsSum / n),
      firstTryPassRate: round4(firstTryPass / n),
    };
  });

  const totals = { PASS: 0, REFIX: 0, RERUN: 0, FAIL: 0 };
  let totalRoundsRun = 0;
  let totalAttempts = 0;
  let happyRounds = 0;
  let happyNonPass = 0;
  let unhappyRounds = 0;
  let unhappyPass = 0;
  const violations = [];

  for (const scenario of active) {
    const rows = perScenario.get(scenario.id) || [];
    for (const row of rows) {
      totalRoundsRun += 1;
      totalAttempts += row.attempts;
      totals[row.verdict] = (totals[row.verdict] || 0) + 1;
      if (scenario.kind === 'happy') {
        happyRounds += 1;
        if (row.verdict !== 'PASS') happyNonPass += 1;
      } else {
        unhappyRounds += 1;
        if (row.verdict === 'PASS') unhappyPass += 1;
      }
      if (!scenario.expect.includes(row.verdict)) {
        violations.push(`${scenario.id}: veredicto ${row.verdict} fuera de lo esperado [${scenario.expect.join(', ')}]`);
      }
    }
  }

  const aggregate = {
    passRate: round4(totals.PASS / (totalRoundsRun || 1)),
    refixRate: round4(totals.REFIX / (totalRoundsRun || 1)),
    rerunRate: round4(totals.RERUN / (totalRoundsRun || 1)),
    failRate: round4(totals.FAIL / (totalRoundsRun || 1)),
    expectedAttempts: round2(totalAttempts / (totalRoundsRun || 1)),
    falsePassRate: round4(unhappyPass / (unhappyRounds || 1)),
    falseFailRate: round4(happyNonPass / (happyRounds || 1)),
    determinism: 'seeded',
  };

  violations.push(...skipped);
  if (aggregate.falsePassRate > 0) {
    violations.push(`falso PASS: ${unhappyPass}/${unhappyRounds} rondas unhappy terminaron en PASS`);
  }
  if (aggregate.falseFailRate > 0) {
    violations.push(`falso FAIL: ${happyNonPass}/${happyRounds} rondas happy no terminaron en PASS`);
  }

  // Limpieza total: el root prestado queda vacío, el propio se elimina.
  if (slopTemplate) cleanup(slopTemplate);
  if (ownsRoot) cleanup(baseRoot);

  return {
    rounds: totalRoundsRun,
    seed,
    maxRetries,
    durationMs,
    parallel: {
      workers,
      throughputRoundsPerSec: round2((totalRoundsRun / Math.max(1, durationMs)) * 1000),
    },
    scenarios,
    aggregate,
    gate: { ok: aggregate.falsePassRate === 0 && aggregate.falseFailRate === 0, violations },
  };
}

export default simulateArbitration;
