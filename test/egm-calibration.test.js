import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { egmReview, egmDrift, egmPulse } from '../src/egm.js';

// Calibracion del modelo EGM: eliminar falsos positivos sin volver laxo el modelo.
// Cada caso fija un limite: lo que deja de bloquear y lo que sigue bloqueando.

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-egm-cal-'));
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
};

// ---------------------------------------------------------------------------
// Control negativo: el modelo NO se vuelve laxo
// ---------------------------------------------------------------------------

const DOC_AFIRMA_INEXISTENTE = `# Especificacion del modulo

## Contexto
El modulo esta en \`src/noexiste.js\` y se apoya en \`src/cli.js\`.
El arranque delega la lectura de archivos al comando principal.
`;

test('control negativo: una afirmacion de existencia sobre un archivo inexistente sigue siendo blocker y FAIL', () => {
  const dir = tmp({ ...SRC, 'docs/spec-modulo.md': DOC_AFIRMA_INEXISTENTE });
  const r = egmReview({ cwd: dir, target: 'docs/spec-modulo.md' });

  const blockers = r.findings.filter(f => f.severity === 'blocker');
  assert.equal(blockers.length, 1, JSON.stringify(r.findings, null, 2));
  assert.equal(blockers[0].persona, 'egm-codebase-details');
  assert.equal(blockers[0].scope, 'ref:src/noexiste.js');
  assert.equal(blockers[0].advisory, undefined, 'un blocker nunca es advisory');
  assert.equal(r.summary.blocker, 1);
  assert.equal(r.verdict, 'FAIL');
  drop(dir);
});

// ---------------------------------------------------------------------------
// E3: mencion historica en hogar externo de agentes
// ---------------------------------------------------------------------------

const DOC_MENCION_HISTORICA = `# Compatibilidad con el arnes de agentes

## Fallos historicos
Los configuradores (\`.clinerules\`, \`.github/copilot-instructions.md\`, \`.vscode/mcp.json\`)
pisaban archivos completos sin merge ni respaldo.
La garantia actual fusiona clave por clave y respalda antes de escribir.
`;

test('mencion historica con hogares externos: 0 blockers y veredicto distinto de FAIL', () => {
  const dir = tmp({ ...SRC, 'docs/COMPATIBILIDAD-ARNES.md': DOC_MENCION_HISTORICA });
  const r = egmReview({ cwd: dir, target: 'docs/COMPATIBILIDAD-ARNES.md' });

  const blockers = r.findings.filter(f => f.severity === 'blocker');
  assert.deepEqual(blockers, [], JSON.stringify(r.findings, null, 2));
  assert.equal(r.summary.blocker, 0);
  assert.notEqual(r.verdict, 'FAIL');
  drop(dir);
});

// ---------------------------------------------------------------------------
// E2: siglas
// ---------------------------------------------------------------------------

const DOC_MAYUSCULAS_ESPANOLAS = `# Nota del contrato

## Reglas
El contrato que ACTIVA correctamente exige el campo id.
**\`effect\` esta PROHIBIDO.** El runtime usa el MISMO proceso.
La respuesta es SI o NO, sin excepciones.
La cola FIFO se respeta.
`;

test('palabras españolas en mayusculas: 0 hallazgos de jargon por esas palabras', () => {
  const dir = tmp({ ...SRC, 'docs/nota-contrato.md': DOC_MAYUSCULAS_ESPANOLAS });
  const r = egmReview({ cwd: dir, target: 'docs/nota-contrato.md' });

  const jargon = r.findings.filter(f => f.dimension === 'jargon').map(f => f.scope).sort();
  // FIFO es una sigla tecnica real y se conserva (como advisory). Las palabras españolas no.
  assert.deepEqual(jargon, ['style:jargon:FIFO'], JSON.stringify(r.findings, null, 2));
  drop(dir);
});

// ---------------------------------------------------------------------------
// E1: [CALIBRATE] es advisory, no defecto
// ---------------------------------------------------------------------------

const DOC_SOLO_CALIBRATE = `# Especificacion del registro de eventos

## Contexto
El registro guarda cada evento del sistema en el archivo local.
La lectura se hace al arrancar y el registro siempre responde igual.

## Alternativas consideradas
Se evaluo un archivo unico frente a un directorio por dia.

## Riesgos
El riesgo es que el archivo crezca sin control.
La mitigacion es rotar el archivo por tamanio.

## Pruebas
La suite cubre el alta y la lectura de eventos.
`;

test('[CALIBRATE] presente: el hallazgo se reporta como advisory y no empuja el veredicto a REFIX', () => {
  const dir = tmp({ ...SRC, 'docs/spec-registro.md': DOC_SOLO_CALIBRATE });
  const r = egmReview({ cwd: dir, target: 'docs/spec-registro.md' });

  const calibrado = r.findings.find(f => f.scope === 'style:claim:siempre');
  assert.ok(calibrado, JSON.stringify(r.findings, null, 2));
  assert.equal(calibrado.advisory, true);
  assert.match(calibrado.detail, /^\[CALIBRATE\]/);
  assert.equal(r.summary.major, 0, 'un advisory no cuenta como major');
  assert.ok(r.summary.advisory >= 1);
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings, null, 2));
  assert.ok(r.report.includes('| style:claim:siempre |'), 'el advisory sigue visible en el reporte');
  drop(dir);
});

// ---------------------------------------------------------------------------
// E4: tipo de documento
// ---------------------------------------------------------------------------

const DOC_COMPATIBILIDAD = `# Compatibilidad con la herramienta

## Que fallaba
El configurador pisaba archivos completos y se perdian datos.
La garantia actual fusiona clave por clave.

## Como se verifica
El comando doctor comprueba la instalacion global.
La salida indica el estado real de cada pieza.
`;

const DOC_SPEC_SIN_ALTERNATIVAS = `# Especificacion del analizador

## Contexto
El analizador procesa la entrada del usuario y devuelve un resultado.
El resultado se muestra en la consola.

## Alcance
El trabajo incluye el analizador y su reporte.
La entrada se valida antes de procesar.

## Pruebas
Cada rama del analizador tiene un caso en la suite.
La suite corre en la maquina de desarrollo.
`;

test('documento de compatibilidad sin alternativas: no recibe major de diseño', () => {
  const dir = tmp({ ...SRC, 'docs/COMPATIBILIDAD-HERRAMIENTA.md': DOC_COMPATIBILIDAD });
  const r = egmReview({ cwd: dir, target: 'docs/COMPATIBILIDAD-HERRAMIENTA.md' });

  const design = r.findings.filter(f => f.persona === 'egm-design');
  assert.deepEqual(design, [], JSON.stringify(r.findings, null, 2));
  drop(dir);
});

test('spec real sin alternativas: conserva el major de diseño', () => {
  const dir = tmp({ ...SRC, 'docs/spec-analizador.md': DOC_SPEC_SIN_ALTERNATIVAS });
  const r = egmReview({ cwd: dir, target: 'docs/spec-analizador.md' });

  const design = r.findings.filter(f => f.persona === 'egm-design' && f.severity === 'major');
  assert.ok(design.some(f => f.scope === 'section:alternativas'), JSON.stringify(r.findings, null, 2));
  assert.ok(design.some(f => f.scope === 'section:riesgos'), JSON.stringify(r.findings, null, 2));
  assert.equal(design[0].advisory, undefined, 'el major de diseño es un defecto, no un advisory');
  assert.equal(r.verdict, 'REFIX');
  drop(dir);
});

// ---------------------------------------------------------------------------
// Regresion: egm review sin --target (el comando que recomienda el digest)
// ---------------------------------------------------------------------------

test('sin --target revisa el documento de docs/ mas reciente, no el cwd', () => {
  const dir = tmp({ ...SRC, 'docs/spec-viejo.md': DOC_SOLO_CALIBRATE, 'docs/spec-nuevo.md': DOC_SOLO_CALIBRATE });
  const viejo = path.join(dir, 'docs', 'spec-viejo.md');
  const nuevo = path.join(dir, 'docs', 'spec-nuevo.md');
  const ahora = Date.now();
  fs.utimesSync(viejo, new Date(ahora - 60000), new Date(ahora - 60000));
  fs.utimesSync(nuevo, new Date(ahora), new Date(ahora));

  const r = egmReview({ cwd: dir });
  assert.equal(r.target, 'docs/spec-nuevo.md', JSON.stringify(r, null, 2));
  assert.notEqual(r.verdict, 'FAIL');
  assert.doesNotMatch(String(r.reason || ''), /no es un archivo/);
  drop(dir);
});

test('sin --target y sin docs/ cae a README.md en vez de FAIL espurio', () => {
  const dir = tmp({ ...SRC, 'README.md': DOC_COMPATIBILIDAD });
  const r = egmReview({ cwd: dir });
  assert.equal(r.target, 'README.md', JSON.stringify(r, null, 2));
  assert.notEqual(r.verdict, 'FAIL');
  drop(dir);
});

// ---------------------------------------------------------------------------
// Regresiones EGM post-integracion: "todo" en espanol, backticks y archivo historico
// ---------------------------------------------------------------------------

test('la palabra "todo" en espanol y los literales `TODO`/`FIXME` entre backticks no disparan marker:todo', () => {
  const docLimpio = `# Guia operativa de sesiones

## Flujo
En todo el repositorio la configuracion aplica sobre todos los archivos editados.
La herramienta extrae marcadores \`TODO\` y \`FIXME\` del codigo fuente sin abrir decisiones aqui.
`;
  const docAbierto = `# Especificacion pendiente

## Contexto
La estructura de salida cubre el caso base.
TODO: definir el timeout maximo del cliente.

## Alternativas consideradas
Se evaluo un limite fijo frente a uno configurable.

## Riesgos
El riesgo es cortar respuestas validas por timeout corto; se mitiga ajustando el umbral.

## Pruebas
La suite comprueba respuestas rapidas y respuestas agotadas.
`;
  const dir = tmp({ ...SRC, 'docs/guia.md': docLimpio, 'docs/spec-abierto.md': docAbierto });

  const limpio = egmReview({ cwd: dir, target: 'docs/guia.md' });
  const falsosMarkers = limpio.findings.filter(f => f.scope === 'marker:todo' && !f.advisory);
  assert.deepEqual(falsosMarkers, [], JSON.stringify(limpio.findings, null, 2));

  const abierto = egmReview({ cwd: dir, target: 'docs/spec-abierto.md' });
  const realMarker = abierto.findings.find(f => f.scope === 'marker:todo' && !f.advisory);
  assert.ok(realMarker, JSON.stringify(abierto.findings, null, 2));
  drop(dir);
});

test('los documentos vivos reales del repositorio (FUNCIONAMIENTO, COMPATIBILIDAD-OPENCODE, fundamentos) pasan EGM sin blockers ni majors', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const rel of ['docs/FUNCIONAMIENTO.md', 'docs/COMPATIBILIDAD-OPENCODE.md', 'contextbase/fundamentos.md']) {
    const r = egmReview({ cwd: repoRoot, target: rel });
    assert.equal(r.verdict, 'PASS', `${rel}: ${JSON.stringify(r.findings, null, 2)}`);
    assert.equal(r.summary.blocker, 0, `${rel} blockers`);
    assert.equal(r.summary.major, 0, `${rel} majors`);
  }
});

test('egmDrift y egmPulse ignoran archivos historicos en docs/superpowers y pasan sobre el repositorio', () => {
  const dir = tmp({
    ...SRC,
    'docs/COMPATIBILIDAD-GUIA.md': DOC_COMPATIBILIDAD,
    'docs/superpowers/specs/2026-10-29-swarm-design.md': '# Diseno historico\n\n## Contexto\nVive en `src/inexistente.js` y queda TODO por definir.\n',
  });
  const futuro = new Date(Date.now() + 86400000);
  fs.utimesSync(path.join(dir, 'docs/superpowers/specs/2026-10-29-swarm-design.md'), futuro, futuro);

  const driftTmp = egmDrift({ cwd: dir, docsDir: 'docs' });
  assert.deepEqual(driftTmp.drift, [], JSON.stringify(driftTmp.drift, null, 2));

  const pulseTmp = egmPulse(dir);
  assert.equal(pulseTmp.ok, true, JSON.stringify(pulseTmp));
  assert.equal(pulseTmp.target, 'docs/COMPATIBILIDAD-GUIA.md');
  assert.equal(pulseTmp.verdict, 'PASS');
  assert.equal(pulseTmp.drift, 0);
  drop(dir);

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const driftRepo = egmDrift({ cwd: repoRoot });
  assert.deepEqual(driftRepo.drift, [], JSON.stringify(driftRepo.drift, null, 2));

  const pulseRepo = egmPulse(repoRoot);
  assert.equal(pulseRepo.ok, true, JSON.stringify(pulseRepo));
  assert.equal(pulseRepo.verdict, 'PASS');
  assert.equal(pulseRepo.blockers, 0);
  assert.equal(pulseRepo.majors, 0);
  assert.equal(pulseRepo.drift, 0);
});
