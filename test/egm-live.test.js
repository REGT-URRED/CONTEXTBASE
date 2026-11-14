import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { egmPulse } from '../src/egm.js';
import { installSkill } from '../src/installer.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERDICTOS = new Set(['PASS', 'REFIX', 'RIXIF', 'RERUN', 'FAIL']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function tmp(prefix = 'cb-egm-live-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function proyectoConFundamentos() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'contextbase'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'contextbase', 'fundamentos.md'),
    [
      '# Fundamentos del proyecto',
      '',
      'El proyecto mantiene tres archivos de memoria tecnica en contextbase/.',
      '',
      '## Arquitectura',
      '',
      'El motor lee los archivos del disco y decide un veredicto por severidad.',
      '',
    ].join('\n'),
    'utf8',
  );
  return root;
}

// ---------------------------------------------------------------------------
// Pulso EGM: una pasada determinista sobre el documento vivo
// ---------------------------------------------------------------------------

test('egmPulse con fundamentos.md devuelve veredicto, conteos y escribe el veredicto en disco', () => {
  const root = proyectoConFundamentos();

  const res = egmPulse(root);

  assert.equal(res.ok, true, 'la pasada debe ejecutarse de verdad');
  assert.ok(VERDICTOS.has(res.verdict), 'el veredicto debe ser uno del modelo: ' + res.verdict);
  assert.equal(res.target, 'contextbase/fundamentos.md', 'el objetivo es el documento vivo en ruta relativa');
  assert.equal(typeof res.blockers, 'number');
  assert.equal(typeof res.majors, 'number');
  assert.equal(typeof res.nits, 'number');
  assert.ok(res.blockers >= 0 && res.majors >= 0 && res.nits >= 0, 'los conteos no pueden ser negativos');
  assert.equal(typeof res.drift, 'number');
  assert.ok(res.drift >= 0, 'la deriva no puede ser negativa');
  assert.ok(ISO.test(res.at), 'at debe ser un ISO completo: ' + res.at);
  assert.equal(res.reason, null, 'una pasada exitosa no lleva motivo de fallo');
  assert.ok(res.durationMs >= 0, 'durationMs debe ser un numero no negativo');

  const file = path.join(root, 'contextbase', 'egm', 'verdict.json');
  assert.equal(fs.existsSync(file), true, 'el veredicto debe persistirse en contextbase/egm/verdict.json');
  const guardado = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(guardado.verdict, res.verdict, 'el archivo debe guardar el mismo veredicto');
  assert.equal(guardado.blockers, res.blockers, 'el archivo debe guardar los mismos blockers');
  assert.equal(guardado.majors, res.majors, 'el archivo debe guardar los mismos majors');
  assert.equal(guardado.nits, res.nits, 'el archivo debe guardar los mismos nits');
  assert.equal(guardado.target, res.target, 'el archivo debe guardar el mismo objetivo');
});

test('egmPulse sin documento vivo ni README no ejecuta y reporta sin-documentacion', () => {
  const root = tmp();

  const res = egmPulse(root);

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'sin-documentacion');
  assert.equal(res.verdict, null);
  assert.equal(fs.existsSync(path.join(root, 'contextbase', 'egm', 'verdict.json')), false, 'sin documentacion no se escribe veredicto');
});

test('egmPulse usa README.md cuando el proyecto no tiene fundamentos.md', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'README.md'), '# Proyecto\n\nMemoria tecnica persistente para agentes de codigo.\n', 'utf8');

  const res = egmPulse(root);

  assert.equal(res.ok, true);
  assert.equal(res.target, 'README.md');
});

test('egmPulse nunca lanza: un objetivo que es directorio devuelve ok:false con motivo', () => {
  const root = tmp();
  // fundamentos.md existe, pero como directorio: no se puede leer como documento.
  fs.mkdirSync(path.join(root, 'contextbase', 'fundamentos.md'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

  const porDefecto = egmPulse(root);
  assert.equal(porDefecto.ok, false, 'un directorio no es un documento revisable');
  assert.ok(porDefecto.reason, 'debe explicar por que no se ejecuto');

  const explicito = egmPulse(root, { target: 'docs' });
  assert.equal(explicito.ok, false);
  assert.equal(explicito.reason, 'error', 'un objetivo ilegible es un fallo controlado, no una excepcion');
});

test('egmPulse sobre un directorio inexistente devuelve ok:false sin lanzar', () => {
  const fantasma = path.join(tmp(), 'no-existe');

  const res = egmPulse(fantasma);

  assert.equal(res.ok, false);
  assert.ok(res.reason, 'debe reportar el motivo del fallo');
});

test('el veredicto persistido es JSON valido con tool egm y marca ISO', () => {
  const root = proyectoConFundamentos();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'uso.md'), '# Uso\n\nVer src/egm.js para el motor.\n', 'utf8');

  const res = egmPulse(root);
  assert.equal(res.ok, true);

  const file = path.join(root, 'contextbase', 'egm', 'verdict.json');
  const raw = fs.readFileSync(file, 'utf8');
  const guardado = JSON.parse(raw);

  assert.equal(guardado.tool, 'egm');
  assert.equal(typeof guardado.version, 'string');
  assert.ok(ISO.test(guardado.at), 'at debe ser ISO: ' + guardado.at);
  assert.equal(typeof guardado.drift, 'number');
  assert.ok(ISO.test(res.at));
});

// ---------------------------------------------------------------------------
// Instalador: una skill no es la unica
// ---------------------------------------------------------------------------

test('installSkill global instala contextbase y contextbase-egm respetando el contenido original', () => {
  const home = tmp('cb-egm-home-');
  const proyecto = tmp('cb-egm-proj-');

  const instalados = installSkill('global', proyecto, home);

  const base = path.join(home, '.agents', 'skills', 'contextbase', 'SKILL.md');
  const egm = path.join(home, '.agents', 'skills', 'contextbase-egm', 'SKILL.md');

  assert.equal(fs.existsSync(base), true, 'debe seguir instalando la skill contextbase');
  assert.equal(fs.existsSync(egm), true, 'debe instalar tambien la skill contextbase-egm');
  assert.ok(instalados.includes(base), 'la ruta instalada debe estar en el resultado');
  assert.ok(instalados.includes(egm), 'la ruta de contextbase-egm debe estar en el resultado');

  const fuente = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'contextbase', 'SKILL.md'), 'utf8');
  assert.equal(fs.readFileSync(base, 'utf8'), fuente, 'el contenido de contextbase no debe cambiar');

  assert.equal(fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'contextbase-egm', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(home, '.kilo', 'skills', 'contextbase-egm', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(home, '.gemini', 'config', 'skills', 'contextbase-egm', 'SKILL.md')), true);
});

test('installSkill global elimina copias legacy del plugin en ~/.opencode', () => {
  const home = tmp('cb-legacy-home-');
  const proyecto = tmp('cb-legacy-proj-');
  for (const dir of ['.opencode/plugin', '.opencode/plugins']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
    fs.writeFileSync(path.join(home, dir, 'contextbase-auto.js'), 'export default {};\n', 'utf8');
  }

  installSkill('global', proyecto, home);

  assert.equal(fs.existsSync(path.join(home, '.opencode', 'plugin', 'contextbase-auto.js')), false,
    'una copia legacy en ~/.opencode/plugin choca con la global y el host la descarta');
  assert.equal(fs.existsSync(path.join(home, '.opencode', 'plugins', 'contextbase-auto.js')), false,
    'una copia legacy en ~/.opencode/plugins choca con la global y el host la descarta');
  assert.equal(fs.existsSync(path.join(home, '.opencode', 'skills', 'contextbase', 'SKILL.md')), true,
    'la sincronizacion de skills del home legacy debe mantenerse');
});

test('installSkill workspace instala todas las skills en el proyecto', () => {
  const home = tmp('cb-egm-home2-');
  const proyecto = tmp('cb-egm-proj2-');

  installSkill('workspace', proyecto, home);

  assert.equal(fs.existsSync(path.join(proyecto, '.agents', 'skills', 'contextbase', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(proyecto, '.agents', 'skills', 'contextbase-egm', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(proyecto, '.opencode', 'skills', 'contextbase-egm', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(proyecto, '.kilo', 'skills', 'contextbase-egm', 'SKILL.md')), true);
});

test('la skill contextbase-egm del repositorio tiene frontmatter con name y description', () => {
  const file = path.join(REPO_ROOT, 'skills', 'contextbase-egm', 'SKILL.md');
  assert.equal(fs.existsSync(file), true, 'debe existir skills/contextbase-egm/SKILL.md');

  const raw = fs.readFileSync(file, 'utf8');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, 'la skill debe abrir con frontmatter YAML');

  const name = fm[1].match(/^name:\s*(.+)$/m);
  const description = fm[1].match(/^description:\s*(.+)$/m);
  assert.ok(name, 'el frontmatter debe declarar name');
  assert.equal(name[1].trim(), 'contextbase-egm');
  assert.ok(description, 'el frontmatter debe declarar description');
  assert.ok(description[1].trim().length > 20, 'la description debe explicar cuando usar la skill');
});
