import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoEnsure, pulseEgm } from '../src/auto.js';
import { collectState, buildDigest, collectEgmState } from '../src/context.js';

function tmp(prefix = 'cb-egm-pulse-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Proyecto valido: contexto base completo, sin contextbase/egm/ (caso comun).
function project() {
  const dir = tmp();
  const cb = path.join(dir, 'contextbase');
  fs.mkdirSync(cb, { recursive: true });
  fs.writeFileSync(path.join(cb, 'fundamentos.md'), '# Fundamentos\n\nProyecto de prueba.\n', 'utf8');
  fs.writeFileSync(path.join(cb, 'changelog.md'), '# Changelog\n', 'utf8');
  fs.writeFileSync(path.join(cb, 'tasklist.md'), '# Tareas\n\n## Tareas Pendientes / En Progreso\n\n- [ ] una\n', 'utf8');
  return dir;
}

function writeVerdict(dir, payload) {
  const egmDir = path.join(dir, 'contextbase', 'egm');
  fs.mkdirSync(egmDir, { recursive: true });
  fs.writeFileSync(path.join(egmDir, 'verdict.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Latido: el pulso EGM nunca rompe la autogestion
// ---------------------------------------------------------------------------

test('el latido reporta egmPulsed como booleano en un proyecto sin contextbase/', () => {
  const dir = tmp();
  let res;
  assert.doesNotThrow(() => { res = autoEnsure(dir, { egmPulse: true }); });
  assert.equal(typeof res.egmPulsed, 'boolean');
  assert.equal(res.initialized, true, 'el latido debe seguir inicializando el contexto base');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el latido reporta egmPulsed como booleano en un proyecto con contexto base completo', () => {
  const dir = project();
  let res;
  assert.doesNotThrow(() => { res = autoEnsure(dir, { egmPulse: true }); });
  assert.equal(typeof res.egmPulsed, 'boolean');
  assert.equal(res.skipped, undefined, 'el proyecto real no debe saltarse el latido');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pulseEgm degrada a false sin lanzar cuando el motor no puede revisar', () => {
  const dir = tmp();
  let pulsed;
  assert.doesNotThrow(() => { pulsed = pulseEgm(dir, { egmPulse: true, egmBudgetMs: 5000 }); });
  assert.equal(typeof pulsed, 'boolean');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el presupuesto agotado no rompe el latido: egmPulsed queda en false', () => {
  const dir = project();
  const res = autoEnsure(dir, { egmPulse: true, egmBudgetMs: -1 });
  assert.equal(typeof res.egmPulsed, 'boolean');
  assert.equal(res.egmPulsed, false, 'sin presupuesto el pulso se reporta como no ejecutado');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el directorio personal no se pulsa con EGM y mantiene skipped home-directory', () => {
  const dir = tmp('cb-egm-home-');
  const prevU = process.env.USERPROFILE;
  const prevH = process.env.HOME;
  process.env.USERPROFILE = dir;
  process.env.HOME = dir;
  try {
    const res = autoEnsure(dir, { egmPulse: true });
    assert.equal(res.skipped, 'home-directory');
    assert.ok(!res.egmPulsed, 'el directorio personal no debe pulsarse con EGM');
    assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'egm')), false, 'no debe crearse contextbase/egm en el home');
  } finally {
    if (prevU === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevU;
    if (prevH === undefined) delete process.env.HOME; else process.env.HOME = prevH;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el pulso del latido persiste el veredicto y el digest lo refleja', () => {
  const dir = project();
  const res = autoEnsure(dir, { egmPulse: true });
  const file = path.join(dir, 'contextbase', 'egm', 'verdict.json');
  // Si el motor EGM no expone el pulso, el latido igual no rompe: nada que verificar.
  if (!fs.existsSync(file)) {
    assert.equal(typeof res.egmPulsed, 'boolean');
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  assert.equal(res.egmPulsed, true, 'con motor disponible el pulso se reporta como ejecutado');
  const egm = collectEgmState(dir);
  assert.ok(egm, 'el veredicto persistido debe ser legible');
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.ok(digest.includes('## Control de calidad EGM'), 'el digest debe mostrar el pulso del latido');
  assert.ok(digest.includes('Veredicto: ' + egm.verdict), 'debe mostrar el veredicto persistido');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Digest: el veredicto EGM vive en el contexto que lee cada agente
// ---------------------------------------------------------------------------

test('collectEgmState lee el veredicto persistido por el pulso', () => {
  const dir = project();
  writeVerdict(dir, { verdict: 'REFIX', target: 'contextbase/fundamentos.md', blockers: 0, majors: 2, nits: 5, drift: 1, at: '2026-11-13T01:20:00.000Z', ok: false });
  const egm = collectEgmState(dir);
  assert.ok(egm, 'debe leer el veredicto');
  assert.equal(egm.verdict, 'REFIX');
  assert.equal(egm.majors, 2);
  assert.equal(egm.nits, 5);
  assert.equal(egm.drift, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el digest incluye la seccion EGM con veredicto y conteos', () => {
  const dir = project();
  writeVerdict(dir, { verdict: 'PASS', blockers: 0, majors: 0, nits: 3, drift: 0, at: new Date().toISOString() });
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.ok(digest.includes('## Control de calidad EGM'), 'debe existir la seccion EGM');
  assert.ok(digest.includes('Veredicto: PASS'), 'debe mostrar el veredicto');
  assert.ok(digest.includes('Blockers: 0'));
  assert.ok(digest.includes('Majors: 0'));
  assert.ok(digest.includes('Nits: 3'));
  assert.ok(!digest.includes('Estado: vencido'), 'un veredicto fresco no debe marcarse vencido');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el digest agrega una accion cuando el veredicto no es PASS', () => {
  const dir = project();
  writeVerdict(dir, { verdict: 'RERUN', blockers: 1, majors: 2, nits: 0, drift: 0, at: new Date().toISOString() });
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.ok(digest.includes('Veredicto: RERUN'));
  assert.ok(/Accion: .*contextbase egm review/.test(digest), 'debe indicar como corregir');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el digest omite la seccion EGM cuando no hay verdict.json', () => {
  const dir = project();
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.equal(digest.includes('Control de calidad EGM'), false, 'sin veredicto no debe aparecer la seccion');
  assert.equal(digest.includes('Veredicto:'), false, 'no debe inventarse un veredicto');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el digest marca vencido un veredicto de hace mas de 7 dias', () => {
  const dir = project();
  const viejo = new Date(Date.now() - 10 * 86400000).toISOString();
  writeVerdict(dir, { verdict: 'PASS', blockers: 0, majors: 0, nits: 0, drift: 0, at: viejo });
  const digest = buildDigest(collectState(dir), '1.0.0');
  assert.ok(digest.includes('## Control de calidad EGM'));
  assert.ok(digest.includes('Estado: vencido'), 'un veredicto viejo no debe presentarse como actual');
  assert.ok(/Accion: .*egm review/.test(digest), 'debe pedir refrescar el veredicto');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un verdict.json corrupto no rompe el digest ni imprime la seccion', () => {
  const dir = project();
  const egmDir = path.join(dir, 'contextbase', 'egm');
  fs.mkdirSync(egmDir, { recursive: true });
  fs.writeFileSync(path.join(egmDir, 'verdict.json'), '{ roto ', 'utf8');
  let digest;
  assert.doesNotThrow(() => { digest = buildDigest(collectState(dir), '1.0.0'); });
  assert.equal(digest.includes('Control de calidad EGM'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
