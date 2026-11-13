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

// ---------- regresiones P0/P1/P2 ----------

test('convergencia: un hallazgo nulo se descarta en vez de romper la ronda', () => {
  const valido = {
    id: 'egm-design-1', persona: 'egm-design', severity: 'major', dimension: 'riesgos',
    scope: 'section:riesgos', detail: 'falta riesgos', evidence: 'x', resolution: 'propose_fix', status: 'open',
  };
  const objeto = {
    findings: [null, valido],
    reviewers: [null, { persona: 'egm-design', status: 'completed' }],
  };
  const a = egmConvergence({ findingsByRound: [objeto] });
  assert.equal(a.detalle[0].findings.length, 1);
  assert.equal(a.detalle[0].findings[0].id, 'egm-design-1');
  assert.equal(a.detalle[0].majors, 1);

  // Forma de ronda en array plano: mismo contrato de descarte.
  const b = egmConvergence({ findingsByRound: [[null, valido]] });
  assert.equal(b.detalle[0].findings.length, 1);
  assert.equal(b.detalle[0].majors, 1);
});

test('egmDrift: docs inexistente es missingDocs, docs existente es escaneo real', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': '# Especificacion\n\n## Contexto\nEl alcance es solo el documento.\n' });

  const faltante = egmDrift({ cwd: dir, docsDir: 'docs-inexistente' });
  assert.equal(faltante.missingDocs, true);
  assert.equal(faltante.scanned, 0);
  assert.deepEqual(faltante.drift, []);
  assert.equal(faltante.docsDir, path.join(dir, 'docs-inexistente'));
  assert.notEqual(faltante.message, 'No drift detected');
  assert.ok(faltante.message.includes(path.join(dir, 'docs-inexistente')), faltante.message);

  const presente = egmDrift({ cwd: dir, docsDir: 'docs' });
  assert.equal(presente.missingDocs, false);
  assert.equal(presente.scanned, 1);
  assert.equal(presente.docsDir, path.join(dir, 'docs'));
  assert.deepEqual(presente.drift, []);
  assert.equal(presente.message, 'No drift detected');
  drop(dir);
});

test('egmDrift: una referencia con separador de Windows se detecta y se normaliza', () => {
  const dir = tmp({
    ...SRC,
    'docs/spec.md': '# Especificacion\n\n## Contexto\nLa logica rota vive en src\\inexistente.js desde el inicio.\nLa logica buena vive en src\\cli.js desde siempre.\n',
  });
  const r = egmDrift({ cwd: dir, docsDir: 'docs' });
  const missing = r.drift.filter(d => d.kind === 'missing_feature');
  assert.equal(missing.length, 1, JSON.stringify(r.drift, null, 2));
  assert.equal(missing[0].ref, 'src/inexistente.js');
  assert.ok(!missing.some(d => d.ref === 'src/cli.js'), 'la ruta existente con \\ no es drift');
  drop(dir);
});

test('egmDrift: una repeticion de sintaxis como ") + " no es logic_shortcut', () => {
  const dir = tmp({
    'src/join.js': [
      'export function join(a, b, c) {',
      '  const x = a + ") + " + b;',
      '  const y = b + ") + " + c;',
      '  const z = a + ") + " + c;',
      '  return [x, y, z];',
      '}',
      '',
    ].join('\n'),
    'docs/spec.md': '# Especificacion del armado\n\n## Contexto\nEl separador debe ser configurable y no quedar fijo en el codigo.\nLa logica vive en `src/join.js`.\n\n## Alcance\nSolo el armado del texto.\n',
  });
  const r = egmDrift({ cwd: dir, docsDir: 'docs' });
  assert.deepEqual(r.drift.filter(d => d.kind === 'logic_shortcut'), [], JSON.stringify(r.drift, null, 2));
  drop(dir);

  // Control positivo: un valor de negocio repetido si se reporta (el filtro no apaga todo).
  const dir2 = tmp({
    'src/pago.js': "export function p() {\n  return ['pendiente-pago', 'pendiente-pago', 'pendiente-pago'];\n}\n",
    'docs/spec.md': '# Especificacion del pago\n\n## Contexto\nEl estado de pago debe ser configurable y no quedar fijo en el codigo.\nLa logica vive en `src/pago.js`.\n\n## Alcance\nSolo el estado.\n',
  });
  const r2 = egmDrift({ cwd: dir2, docsDir: 'docs' });
  const hit = r2.drift.filter(d => d.kind === 'logic_shortcut');
  assert.equal(hit.length, 1, JSON.stringify(r2.drift, null, 2));
  assert.equal(hit[0].ref, 'src/pago.js');
  drop(dir2);
});

test('target no markdown: PASS con los checkers de Markdown en skipped', () => {
  const dir = tmp({ 'lib/math.js': 'export function add(a, b) {\n  return a + b;\n}\n' });
  const r = egmReview({ cwd: dir, target: 'lib/math.js' });
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings, null, 2));
  const mdOnly = ['egm-structural', 'egm-style', 'egm-comprehension', 'egm-implementation-readiness', 'egm-design'];
  for (const persona of mdOnly) {
    const rv = r.reviewers.find(x => x.persona === persona);
    assert.ok(rv, persona);
    assert.equal(rv.status, 'skipped', persona);
    assert.ok(rv.motivo, persona + ' debe declarar el motivo');
  }
  assert.equal(r.summary.revisores.skipped, mdOnly.length);
  assert.equal(r.summary.revisores.failed, 0);
  drop(dir);
});

test('revisores: la lista refleja las 10 personas y solo una es manual', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_LIMPIO });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  assert.equal(r.reviewers.length, EGM_PERSONAS.length);
  const manual = r.reviewers.filter(rv => rv.status === 'manual');
  assert.equal(manual.length, 1);
  assert.equal(manual[0].persona, 'egm-bootstrap-orchestrator');
  assert.ok(manual[0].motivo);
  assert.equal(r.summary.revisores.manual, 1);
  drop(dir);
});

test('maxRounds: se respeta el cap y la convergencia viaja en el resultado', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_SIN_ALTERNATIVAS });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md', maxRounds: 3 });
  assert.equal(r.maxRounds, 3);
  assert.ok(r.rounds >= 2, 'rondas: ' + r.rounds);
  assert.ok(r.rounds <= 3, 'rondas: ' + r.rounds);
  assert.equal(typeof r.convergence, 'object');
  assert.ok(r.convergence);
  assert.equal(typeof r.convergence.converged, 'boolean');
  assert.equal(r.convergence.converged, false);
  drop(dir);
});

const DOC_MIXTO = `# Especificacion del modulo QZX

## Contexto
La logica vive en \`src/inexistente.js\` y el modulo QZX la reutiliza.

## Alcance
El alcance es revisar el modulo QZX.
`;

test('severidad: los hallazgos salen ordenados blocker -> major -> nit', () => {
  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_MIXTO });
  const r = egmReview({ cwd: dir, target: 'docs/spec.md' });
  const rank = { blocker: 0, major: 1, nit: 2 };
  const orden = r.findings.map(f => f.severity);
  assert.ok(orden.includes('blocker'), JSON.stringify(orden));
  assert.ok(orden.includes('major'), JSON.stringify(orden));
  assert.ok(orden.includes('nit'), JSON.stringify(orden));
  assert.equal(orden[0], 'blocker');
  assert.equal(orden[orden.length - 1], 'nit');
  for (let i = 1; i < orden.length; i++) {
    assert.ok(rank[orden[i - 1]] <= rank[orden[i]], 'orden roto: ' + JSON.stringify(orden));
  }
  // El reporte usa el mismo orden: la primera fila de hallazgo es el blocker.
  const filas = r.report.split(/\r?\n/).filter(l => /^\| egm-[^|]+ \| egm-[^|]+ \| (blocker|major|nit) \|/.test(l));
  assert.ok(filas.length >= 3, r.report);
  assert.ok(filas[0].includes('| blocker |'), filas[0]);
  assert.ok(filas[filas.length - 1].includes('| nit |'), filas[filas.length - 1]);
  drop(dir);
});

test('convergencia: una resolucion con reabre=true vuelve a abrir el hallazgo settled', () => {
  assert.equal(EGM_RESOLUCIONES.propose_fix.reabre, true);
  assert.equal(EGM_RESOLUCIONES.contest.reabre, false);
  const base = {
    id: 'egm-style-77', persona: 'egm-style', severity: 'nit', dimension: 'relleno',
    scope: 'style:dash-density:x', detail: 'nit', evidence: 'x', resolution: 'propose_fix',
  };
  const r1 = { findings: [Object.assign({}, base, { status: 'settled' })], reviewers: [] };
  const r2 = { findings: [Object.assign({}, base, { status: 'open' })], reviewers: [] };
  const r = egmConvergence({ findingsByRound: [r1, r2] });
  const segundo = r.detalle[1].findings[0];
  assert.equal(segundo.status, 'open');
  assert.equal(segundo.reabierto, true);
  assert.equal(r.churn, false);
  assert.equal(r.converged, true);
  assert.equal(r.verdict, 'PASS');
});

test('baseDiff: compara contra git y es null cuando no se pasa base', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('git no disponible');
    return;
  }

  const dir = tmp({ ...SRC, 'docs/spec.md': DOC_LIMPIO });
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(run(['init']).status, 0);
  assert.equal(run(['config', 'user.email', 'egm@test.local']).status, 0);
  assert.equal(run(['config', 'user.name', 'EGM Test']).status, 0);
  assert.equal(run(['add', '-A']).status, 0);
  const commit = run(['commit', '-m', 'base']);
  assert.equal(commit.status, 0, commit.stderr);

  fs.appendFileSync(path.join(dir, 'docs/spec.md'), '\n## Nota\nLinea agregada despues de la base.\n');

  const r = egmReview({ cwd: dir, target: 'docs/spec.md', base: 'HEAD' });
  assert.ok(r.baseDiff, 'baseDiff debe existir con base');
  assert.equal(r.baseDiff.ok, true, r.baseDiff.message);
  assert.equal(r.baseDiff.ref, 'HEAD');
  assert.ok(r.baseDiff.files.some(f => f.file === 'docs/spec.md'), JSON.stringify(r.baseDiff.files));
  assert.equal(r.baseDiff.target.changed, true);
  assert.ok(r.report.includes('## Comparacion con base'));

  const sinBase = egmReview({ cwd: dir, target: 'docs/spec.md' });
  assert.equal(sinBase.base, null);
  assert.equal(sinBase.baseDiff, null);
  drop(dir);
});
