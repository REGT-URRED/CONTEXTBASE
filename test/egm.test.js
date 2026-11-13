import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EGM_PERSONAS,
  EGM_ESTANDARES,
  EGM_SKILLS,
  EGM_SEVERIDADES,
  EGM_RESOLUCIONES,
  egmReview,
  egmConvergence,
  egmDrift,
  egmReport,
} from '../src/egm.js';

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-egm-'));
  for (const [name, body] of Object.entries(files || {})) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

function drop(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const SRC = {
  'src/cli.js': 'export function run() { return 0; }\n',
  'src/fsutil.js': 'export function readAtomic(p) { return p; }\n',
};

const DOC_LIMPIO = `# Especificacion del comando de arranque

## Contexto
El comando de arranque ya existe en \`src/cli.js\` y delega la lectura de archivos a \`src/fsutil.js\`.
El paquete declara Node.js como unico requisito de ejecucion.

## Alternativas consideradas
Se evaluo reusar \`src/fsutil.js\` frente a escribir utilidades nuevas dentro del comando.
La opcion reusada evita duplicar la lectura atomica que ya implementa esa pieza.

## Riesgos
El riesgo principal es la incompatibilidad con versiones previas del binario publicado.
La mitigacion es mantener la firma actual de los subcomandos durante la transicion.

## Pruebas
Las pruebas unitarias cubren la resolucion de rutas y el estado devuelto.
Cada rama del parser tiene al menos un caso en la suite.
`;

const DOC_REFERENCIA_ROTA = `# Especificacion del comando

## Contexto
La logica de arranque ya existe en \`src/no-existe.js\` y se apoya en \`src/cli.js\`.

## Alternativas consideradas
Se evaluo reusar la pieza actual frente a escribir una nueva.

## Riesgos
El riesgo es la incompatibilidad con el binario publicado.
La mitigacion es conservar la interfaz publica.

## Pruebas
Las pruebas cubren la resolucion de rutas del comando.
Cada rama tiene un caso en la suite.
`;

const DOC_SIN_ALTERNATIVAS = `# Propuesta de modulo

## Contexto
El analizador procesara la entrada del usuario y devolvera un resultado estructurado.
El reporte se muestra en la consola del proyecto.

## Alcance
El trabajo incluye el analizador, el reporte en consola y la suite de pruebas.

## Pruebas
Cada rama del analizador tiene un caso en la suite.
La suite corre en la maquina de desarrollo.
`;

const DOC_DECISION_ABIERTA = `# Especificacion de la migracion

## Contexto
La migracion actualiza los registros existentes en la base de datos local.
El proceso corre de noche y no acepta escrituras mientras dura.

## Plan de implementacion
La primera fase cambia el esquema y la segunda fase migra los datos.
El comportamiento de reintentos queda por definir.

## Alternativas consideradas
Se evaluo migrar en un solo paso frente a migrar por lotes.

## Riesgos
El riesgo es la interrupcion del servicio durante la migracion.
La mitigacion es ejecutar el trabajo fuera de la ventana de uso.

## Pruebas
Las pruebas verifican la integridad de los datos despues de migrar.
Cada fase tiene su propio caso de prueba.
`;

const DOC_HYPE = `# Propuesta de la plataforma

## Contexto
La plataforma es un sistema robusto que integra los datos del equipo.
La ingesta corre cada noche y publica un reporte.

## Alternativas consideradas
Se evaluo el enfoque actual frente a migrar a otro proveedor.

## Riesgos
El riesgo es el costo del proveedor elegido.
La mitigacion es negociar volumen anual.

## Pruebas
Las pruebas validan la ingesta de datos cada noche.
El reporte semanal revisa el resultado.
`;

const DOC_TERMINO_SIN_DEFINIR = `# Analizador de entrada

## Contexto
El parser procesa la entrada del usuario y normaliza los campos.
El modulo \`parser\` define la gramatica aceptada.

## Alternativas consideradas
Se evaluo un analizador propio frente a una libreria externa.

## Riesgos
El riesgo es que la gramatica crezca sin control.
La mitigacion es versionar la especificacion.

## Pruebas
Las pruebas cubren cada regla de la gramatica.
Cada error produce un mensaje estable.
`;

const DOC_SALTO_JERARQUIA = `# Especificacion del servicio

### Contexto
El servicio expone un comando unico para el usuario.
El comando devuelve el estado del proceso.

## Alternativas consideradas
Se evaluo el enfoque actual frente a reescribirlo.

## Riesgos
El riesgo es perder compatibilidad con consumidores viejos.
La mitigacion es publicar la version nueva en paralelo.

## Pruebas
Las pruebas cubren el comando y sus errores.
Cada caso verifica la salida en consola.
`;

function finding(f, persona, severity) {
  return f.persona === persona && (!severity || f.severity === severity);
}

test('metadatos: 10 personas, 5 estandares, 7 skills y severidades coherentes', () => {
  assert.equal(EGM_PERSONAS.length, 10);
  assert.equal(EGM_ESTANDARES.length, 5);
  assert.equal(EGM_SKILLS.length, 7);
  for (const p of EGM_PERSONAS) {
    assert.ok(p.id && p.nombre && p.mision && p.dimensiones.length, p.id);
    assert.ok(['REVIEW', 'BRAINSTORM'].includes(p.modo), p.id);
    assert.ok(p.artefacto && p.criterio_pass, p.id);
  }
  assert.equal(EGM_SEVERIDADES.blocker.bloquea, true);
  assert.equal(EGM_SEVERIDADES.major.bloquea, true);
  assert.equal(EGM_SEVERIDADES.nit.bloquea, false);
  assert.deepEqual(Object.keys(EGM_RESOLUCIONES).sort(), ['contest', 'decline', 'escalate', 'propose_fix']);
});

test('PASS: documento limpio sin majors ni blockers', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_LIMPIO });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings, null, 2));
  assert.equal(r.reviewComplete, true);
  assert.equal(r.findings.filter(f => f.severity === 'major').length, 0);
  assert.equal(r.findings.filter(f => f.severity === 'blocker').length, 0);
  assert.equal(r.summary.blocker, 0);
  assert.equal(r.summary.major, 0);
  assert.ok(r.report.includes('Veredicto: PASS'));
  assert.ok(r.report.includes('Goldfish Review Report'));
  drop(dir);
});

test('blocker: referencia a un archivo inexistente que el doc da por existente', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_REFERENCIA_ROTA });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const blockers = r.findings.filter(f => f.severity === 'blocker');
  assert.equal(blockers.length, 1, JSON.stringify(r.findings, null, 2));
  assert.equal(blockers[0].persona, 'egm-codebase-details');
  assert.notEqual(r.verdict, 'PASS');
  assert.equal(r.verdict, 'FAIL');
  drop(dir);
});

test('major: documento sin seccion de alternativas ni de riesgos', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_SIN_ALTERNATIVAS });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const design = r.findings.filter(f => finding(f, 'egm-design', 'major'));
  assert.ok(design.length >= 2, JSON.stringify(r.findings, null, 2));
  assert.equal(r.verdict, 'REFIX');
  drop(dir);
});

test('major: marcadores de decision abierta (TBD, por definir)', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_DECISION_ABIERTA });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const readiness = r.findings.filter(f => finding(f, 'egm-implementation-readiness', 'major'));
  assert.ok(readiness.length >= 1, JSON.stringify(r.findings, null, 2));
  assert.ok(readiness.some(f => f.scope.startsWith('marker:')));
  assert.equal(r.verdict, 'REFIX');
  drop(dir);
});

test('major: hype de marketing en la prosa', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_HYPE });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const style = r.findings.filter(f => finding(f, 'egm-style', 'major'));
  assert.ok(style.length >= 1, JSON.stringify(r.findings, null, 2));
  assert.ok(style.some(f => f.scope.startsWith('style:hype:')));
  drop(dir);
});

test('egm-comprehension: termino usado antes de definirse', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_TERMINO_SIN_DEFINIR });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const comp = r.findings.filter(f => finding(f, 'egm-comprehension'));
  assert.ok(comp.length >= 1, JSON.stringify(r.findings, null, 2));
  assert.ok(comp.some(f => f.scope === 'term:parser'));
  drop(dir);
});

test('egm-structural: salto de jerarquia H1 a H3', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_SALTO_JERARQUIA });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const structural = r.findings.filter(f => finding(f, 'egm-structural', 'major'));
  assert.ok(structural.length >= 1, JSON.stringify(r.findings, null, 2));
  assert.ok(structural.some(f => f.scope.startsWith('structure:jump:')));
  drop(dir);
});

test('target inexistente: FAIL con reviewComplete false y findings vacio', () => {
  const dir = tmp({ ...SRC });
  const r = egmReview({ cwd: dir, target: 'docs/no-existe.md' });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.reviewComplete, false);
  assert.deepEqual(r.findings, []);
  assert.ok(r.reason);
  assert.ok(r.report.includes('Revision completa: no'));
  drop(dir);
});

test('convergencia: una ronda limpia no converge, dos limpias consecutivas si', () => {
  const limpia = { findings: [], reviewers: [{ persona: 'egm-style', status: 'completed' }] };
  const uno = egmConvergence({ findingsByRound: [limpia] });
  assert.equal(uno.converged, false);
  assert.equal(uno.cleanRounds, 1);
  const dos = egmConvergence({ findingsByRound: [limpia, limpia] });
  assert.equal(dos.converged, true);
  assert.equal(dos.cleanRounds, 2);
  assert.equal(dos.verdict, 'PASS');
});

test('convergencia: cap de 5 rondas con majors abiertos da FAIL', () => {
  const major = {
    id: 'egm-design-1', persona: 'egm-design', severity: 'major', dimension: 'riesgos',
    scope: 'section:riesgos', detail: 'falta riesgos', evidence: 'x', resolution: 'propose_fix', status: 'open',
  };
  const ronda = { findings: [major], reviewers: [{ persona: 'egm-design', status: 'completed' }] };
  const r = egmConvergence({ findingsByRound: [ronda, ronda, ronda, ronda, ronda] });
  assert.equal(r.rounds, 5);
  assert.equal(r.converged, false);
  assert.equal(r.verdict, 'FAIL');
  assert.ok(r.escalation);
});

test('convergencia: churn cuando el hallazgo reaparece en el mismo scope tras un fix', () => {
  const base = {
    id: 'egm-codebase-details-9', persona: 'egm-codebase-details', severity: 'blocker', dimension: 'referencias',
    scope: 'ref:src/x.js', detail: 'no existe', evidence: 'x', resolution: 'propose_fix',
  };
  const r1 = { findings: [Object.assign({}, base, { status: 'fixed' })], reviewers: [] };
  const r2 = { findings: [Object.assign({}, base, { status: 'open' })], reviewers: [] };
  const r = egmConvergence({ findingsByRound: [r1, r2] });
  assert.equal(r.churn, true);
  assert.equal(r.verdict, 'FAIL');
  assert.ok(r.escalation);
  assert.equal(r.escalation.scope, 'ref:src/x.js');
});

test('convergencia: un hallazgo settled no se reabre ni cuenta como abierto', () => {
  const base = {
    id: 'egm-style-42', persona: 'egm-style', severity: 'major', dimension: 'hype',
    scope: 'style:hype:robusto', detail: 'hype', evidence: 'x', resolution: 'contest',
  };
  const r1 = { findings: [Object.assign({}, base, { status: 'settled' })], reviewers: [] };
  const r2 = { findings: [Object.assign({}, base, { status: 'open' })], reviewers: [] };
  const r = egmConvergence({ findingsByRound: [r1, r2] });
  assert.equal(r.churn, false);
  assert.equal(r.detalle[1].findings[0].status, 'settled');
  assert.equal(r.converged, true);
  assert.equal(r.verdict, 'PASS');
});

test('egmDrift: una ruta declarada "a crear" no es drift', () => {
  const dir = tmp({
    'docs/spec.md': '# Especificacion\n\n## Contexto\nEl modulo `src/nuevo-modulo.js` se creara en una fase posterior.\nEl alcance de esta fase es solo el documento.\n',
  });
  const r = egmDrift({ cwd: dir, docsDir: 'docs' });
  assert.deepEqual(r.drift, [], JSON.stringify(r.drift, null, 2));
  assert.equal(r.message, 'No drift detected');
  drop(dir);
});

test('egmDrift: una ruta citada que no existe se reporta como missing_feature', () => {
  const dir = tmp({
    'docs/spec.md': '# Especificacion\n\n## Contexto\nLa logica vive en `src/inexistente.js` desde el inicio.\nEl alcance es solo el documento.\n',
  });
  const r = egmDrift({ cwd: dir, docsDir: 'docs' });
  const missing = r.drift.filter(d => d.kind === 'missing_feature');
  assert.equal(missing.length, 1, JSON.stringify(r.drift, null, 2));
  assert.equal(missing[0].ref, 'src/inexistente.js');
  drop(dir);
});

test('ids estables: el mismo hallazgo conserva su id entre rondas', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_REFERENCIA_ROTA });
  const a = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const b = egmReview({ cwd: dir, target: 'docs/spec.md' });
  assert.ok(a.findings.length >= 1);
  assert.deepEqual(a.findings.map(f => f.id).sort(), b.findings.map(f => f.id).sort());
  const bloqueador = a.findings.find(f => f.severity === 'blocker');
  assert.match(bloqueador.id, /^egm-codebase-details-\d+$/);
  drop(dir);
});

test('egm-inventive-catalyst: falso compromiso entre adjetivos excluyentes', () => {
  const dir = tmp({
    ...SRC,
    'docs/spec.md': '# Propuesta rapida\n\n## Contexto\nEl servicio debe ser rapido y simple a la vez.\nLa carga crece cada mes.\n\n## Alternativas consideradas\nSe evaluo un enfoque propio frente a uno externo.\nEl primero reduce dependencias.\n\n## Riesgos\nEl riesgo es la carga growing del equipo.\nLa mitigacion es repartir el trabajo.\n\n## Pruebas\nLas pruebas cubren la ruta principal.\nCada error se registra.\n',
  });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const cat = r.findings.filter(f => finding(f, 'egm-inventive-catalyst', 'major'));
  assert.ok(cat.length >= 1, JSON.stringify(r.findings, null, 2));
  drop(dir);
});

test('egmReport: el reporte lista veredicto, hallazgos y revisores', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_LIMPIO });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const out = egmReport(r);
  assert.ok(out.includes('## Resumen'));
  assert.ok(out.includes('## Hallazgos'));
  assert.ok(out.includes('## Revisores'));
  assert.ok(out.includes('egm-synthesizer'));
  drop(dir);
});
