import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARBITRATION_SCENARIOS, simulateArbitration } from '../src/simulate.js';

function findScenario(report, id) {
  const found = report.scenarios.find((s) => s.id === id);
  assert.ok(found, `El reporte debe incluir el escenario ${id}`);
  return found;
}

function tmpRoot(prefix = 'cb-sim-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Happy Path: el hilo limpio pasa en el primer intento con passRate 1 y firstTryPassRate 1', async () => {
  const report = await simulateArbitration({ rounds: 8, seed: 42, scenarioIds: ['happy-clean'] });

  const scenario = findScenario(report, 'happy-clean');
  assert.equal(scenario.kind, 'happy');
  assert.deepEqual(scenario.expect, ['PASS']);
  assert.equal(scenario.passRate, 1);
  assert.equal(scenario.firstTryPassRate, 1);
  assert.equal(scenario.outcomes.PASS, 8);
  assert.equal(scenario.outcomes.REFIX + scenario.outcomes.RERUN + scenario.outcomes.FAIL, 0);
  assert.equal(scenario.meanScore, 100);
  assert.equal(scenario.meanAttempts, 1);
  assert.equal(report.gate.ok, true);
  assert.deepEqual(report.gate.violations, []);
});

test('Unhappy Path: sin result.md toda ronda cae en RERUN y el passRate es 0', async () => {
  const report = await simulateArbitration({ rounds: 6, seed: 42, scenarioIds: ['unhappy-no-result'] });

  const scenario = findScenario(report, 'unhappy-no-result');
  assert.equal(scenario.kind, 'unhappy');
  assert.equal(scenario.passRate, 0);
  assert.equal(scenario.outcomes.RERUN, 6);
  assert.equal(scenario.outcomes.PASS, 0);
  assert.equal(scenario.outcomes.REFIX, 0);
  assert.equal(scenario.outcomes.FAIL, 0);
  assert.equal(report.aggregate.falsePassRate, 0);
});

test('Conflicto persistente: nunca PASS y el Árbitro corta el bucle con FAIL tras maxRetries', async () => {
  const report = await simulateArbitration({ rounds: 3, seed: 42, scenarioIds: ['unhappy-conflict'] });

  const scenario = findScenario(report, 'unhappy-conflict');
  assert.equal(scenario.outcomes.PASS, 0);
  assert.equal(scenario.passRate, 0);
  assert.equal(scenario.outcomes.FAIL, 3);
  // maxRetries = 2 => intento 1 REFIX, intento 2 REFIX, intento 3 FAIL.
  assert.equal(scenario.meanAttempts, 3);
  assert.equal(report.maxRetries, 2);
});

test('Quality gate: la matriz completa no registra falsos PASS ni falsos FAIL', async () => {
  const report = await simulateArbitration({ rounds: 4, seed: 7 });

  assert.equal(report.gate.ok, true);
  assert.deepEqual(report.gate.violations, []);
  assert.equal(report.aggregate.falsePassRate, 0);
  assert.equal(report.aggregate.falseFailRate, 0);
  assert.equal(report.aggregate.determinism, 'seeded');

  // Todo escenario unhappy con expect PASS es un fallo de calibración del propio arnés.
  for (const scenario of report.scenarios) {
    if (scenario.kind === 'unhappy') {
      assert.equal(scenario.outcomes.PASS, 0, `${scenario.id} no debe producir PASS`);
    } else {
      assert.equal(scenario.passRate, 1, `${scenario.id} debe pasar siempre`);
    }
    assert.ok(
      scenario.expect.includes('PASS') === (scenario.kind === 'happy'),
      `${scenario.id} declara expectativas coherentes con su kind`
    );
  }

  const sum = report.aggregate.passRate + report.aggregate.refixRate + report.aggregate.rerunRate + report.aggregate.failRate;
  assert.ok(Math.abs(sum - 1) < 0.001, 'las cuatro tasas deben sumar 1');
});

test('Determinismo: la misma semilla reproduce escenarios y agregado idénticos', async () => {
  const options = {
    rounds: 3,
    seed: 2024,
    scenarioIds: ['happy-clean', 'happy-after-refix', 'unhappy-low-score', 'unhappy-conflict'],
  };

  const first = await simulateArbitration(options);
  const second = await simulateArbitration(options);

  assert.deepEqual(first.scenarios, second.scenarios);
  assert.deepEqual(first.aggregate, second.aggregate);
  assert.deepEqual(first.gate, second.gate);
  assert.equal(first.rounds, second.rounds);

  // Semilla distinta: el lote cambia de contenido (jitter determinista de textos).
  const other = await simulateArbitration({ ...options, seed: 9 });
  assert.notDeepEqual(first.scenarios, other.scenarios);
});

test('Paralelismo: parallel 1 y parallel 4 dan el mismo agregado y miden duración real', async () => {
  const options = { rounds: 2, seed: 55, scenarioIds: ['happy-clean', 'unhappy-slop', 'unhappy-invaded'] };

  const serial = await simulateArbitration({ ...options, parallel: 1 });
  const concurrent = await simulateArbitration({ ...options, parallel: 4 });

  assert.equal(serial.parallel.workers, 1);
  assert.equal(concurrent.parallel.workers, 4);
  assert.deepEqual(serial.aggregate, concurrent.aggregate);
  assert.deepEqual(
    serial.scenarios.map((s) => s.outcomes),
    concurrent.scenarios.map((s) => s.outcomes)
  );

  assert.equal(typeof serial.durationMs, 'number');
  assert.ok(serial.durationMs > 0, 'durationMs debe ser un número positivo');
  assert.ok(concurrent.durationMs > 0, 'durationMs debe ser un número positivo');
  assert.ok(serial.parallel.throughputRoundsPerSec > 0);
  assert.ok(concurrent.parallel.throughputRoundsPerSec > 0);
});

test('Aislamiento: el root temporal prestado queda vacío (ni un directorio filtrado)', async () => {
  const root = tmpRoot();
  try {
    const report = await simulateArbitration({
      rounds: 2,
      seed: 3,
      root,
      scenarioIds: ['happy-clean', 'unhappy-slop', 'unhappy-conflict'],
    });

    assert.equal(report.rounds, 6); // 2 + 2 + 2 (caps por encima de 2 rondas)
    assert.equal(report.gate.ok, true);
    assert.deepEqual(fs.readdirSync(root), [], 'no deben quedar directorios de simulación');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Catálogo: todos los escenarios declarados se ejecutan y respetan su veredicto esperado', async () => {
  const report = await simulateArbitration({ rounds: 1, seed: 1 });

  assert.deepEqual(
    report.scenarios.map((s) => s.id),
    ARBITRATION_SCENARIOS.map((s) => s.id),
    'el reporte debe cubrir el catálogo completo en orden'
  );

  for (const scenario of ARBITRATION_SCENARIOS) {
    const observed = findScenario(report, scenario.id);
    assert.equal(observed.kind, scenario.kind);
    assert.deepEqual(observed.expect, scenario.expect);
    const verdicts = Object.entries(observed.outcomes)
      .filter(([, count]) => count > 0)
      .map(([verdict]) => verdict);
    assert.equal(verdicts.length, 1, `${scenario.id} debe tener un veredicto estable`);
    assert.ok(
      scenario.expect.includes(verdicts[0]),
      `${scenario.id} produjo ${verdicts[0]} y esperaba ${scenario.expect.join('/')}`
    );
  }
});
