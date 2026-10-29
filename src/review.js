import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(__dirname, 'prompts');

const LIMITS = { maxFiles: 20, maxDiffChars: 120000, maxFileChars: 4000 };

// Mismo patron que src/slop.js: no se importa desde ahi porque slop importa este modulo.
const SKIP = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.js|\.map)$/i;

function readPrompt(file) {
  return fs.readFileSync(path.join(PROMPT_DIR, file), 'utf8').replace(/^\uFEFF/, '').trim();
}

export function prompts() {
  return { security: readPrompt('review-security.md'), quality: readPrompt('review-quality.md') };
}

export function promptsText() {
  const p = prompts();
  return '## Reviewer A - Seguridad y correctitud\n\n' + p.security + '\n\n## Reviewer B - Calidad y mantenibilidad\n\n' + p.quality;
}

function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function tryGit(dir, args) {
  try { return git(dir, args); } catch { return null; }
}

export function isRepo(dir) {
  return tryGit(dir, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

function refExists(dir, ref) {
  return tryGit(dir, ['rev-parse', '--verify', '--quiet', ref]) !== null;
}

export function resolveBase(dir, base) {
  if (base) {
    if (!refExists(dir, base)) throw new Error('La ref base "' + base + '" no existe en este repositorio.');
    return base;
  }
  for (const candidate of ['main', 'origin/main', 'master', 'origin/master', 'HEAD~1']) {
    if (refExists(dir, candidate)) return candidate;
  }
  throw new Error('No se pudo inferir la base del diff. Ejecutar: contextbase review <base>');
}

// Los archivos sin seguimiento no aparecen en git diff: se leen aparte para incluirlos.
// Devuelve Map nombre -> contenido; omite binarios (NUL) y lockfiles/minificados.
function untrackedFiles(dir) {
  const out = new Map();
  const raw = tryGit(dir, ['ls-files', '-z', '--others', '--exclude-standard']) || '';
  for (const name of raw.split('\u0000').filter(Boolean)) {
    if (SKIP.test(name)) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    if (text.slice(0, 8000).includes('\u0000')) continue;
    out.set(name, text);
  }
  return out;
}

export function prepare(dir = process.cwd(), options = {}) {
  if (!isRepo(dir)) throw new Error('El directorio no es un repositorio git: ' + dir);
  const base = resolveBase(dir, options.base);
  const notes = [];

  // Sin puntos suspensivos: incluye los commits de la rama y tambien el arbol de trabajo sucio.
  const stat = tryGit(dir, ['diff', '--stat', base]) || '';
  let diff = tryGit(dir, ['diff', '--no-color', '--text', base]) || '';
  if (diff.length > LIMITS.maxDiffChars) {
    diff = diff.slice(0, LIMITS.maxDiffChars) + '\n... (diff truncado en ' + LIMITS.maxDiffChars + ' caracteres)\n';
    notes.push('diff truncado a ' + LIMITS.maxDiffChars + ' caracteres');
  }
  const untracked = untrackedFiles(dir);
  if (!diff.trim() && !untracked.size) {
    throw new Error('El diff contra "' + base + '" esta vacio: no hay cambios que revisar.');
  }

  const tracked = (tryGit(dir, ['diff', '--name-only', '--diff-filter=ACMR', base]) || '')
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const files = tracked.concat([...untracked.keys()]);
  const selected = files.slice(0, LIMITS.maxFiles);
  if (files.length > selected.length) notes.push('incluidos ' + selected.length + ' de ' + files.length + ' archivos');
  if (untracked.size) notes.push('incluye ' + untracked.size + ' archivo(s) sin seguimiento');

  const contents = [];
  for (const f of selected) {
    let text = untracked.get(f);
    if (text === undefined) {
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); }
      catch { contents.push('--- ' + f + ' ---\n(no legible: eliminado o binario)'); continue; }
    }
    if (text.length > LIMITS.maxFileChars) {
      text = text.slice(0, LIMITS.maxFileChars) + '\n... (archivo truncado en ' + LIMITS.maxFileChars + ' caracteres)';
      notes.push(f + ' truncado a ' + LIMITS.maxFileChars + ' caracteres');
    }
    contents.push('--- ' + f + ' ---\n' + text);
  }

  const p = prompts();
  const head = [
    '# Paquete de revision (thermos)',
    '',
    'Base: ' + base + '  |  Archivos cambiados: ' + files.length,
    notes.length ? 'Avisos: ' + notes.join(' | ') : 'Avisos: ninguno',
    '',
    'Lanza DOS revisores en paralelo con este mismo bloque de contexto y el prompt que corresponde a cada uno.',
    'Deben recibir identico contexto: diff, contenidos e intencion.',
  ].join('\n');

  if (options && options.json) {
    return JSON.stringify({ base, changedFiles: files, notes, stat, diff, contents, intent: (options.intent && String(options.intent).trim()) ? String(options.intent).trim() : null, prompts: p }, null, 2);
  }

  return [
    head,
    '',
    '### Git / diff output',
    '',
    stat ? stat : '(sin stat)',
    '',
    diff,
    '',
    '### Changed file contents',
    '',
    contents.length ? contents.join('\n\n') : '(sin archivos legibles)',
    '',
    '### User scope / intent',
    '',
    (options.intent && String(options.intent).trim()) ? String(options.intent).trim() : '(no especificada)',
    '',
    '### Reviewer A - Seguridad y correctitud',
    '',
    p.security,
    '',
    '### Reviewer B - Calidad y mantenibilidad',
    '',
    p.quality,
  ].join('\n');
}

function bullets(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim())
    .filter(l => /^[-*]\s+\S/.test(l))
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(l => l.length > 15);
}

function tokens(s) {
  return s.toLowerCase().replace(/[`*_]/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 3);
}

function similar(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter >= 2 ? inter / Math.min(A.size, B.size) : 0;
}

export function merge(reports = []) {
  const clean = (Array.isArray(reports) ? reports : [])
    .filter(r => typeof r === 'string' && r.trim()).map(r => r.trim());
  if (clean.length !== 2) throw new Error('Se necesitan exactamente dos reportes con contenido; recibidos: ' + clean.length + '.');

  const a = bullets(clean[0]).map(t => ({ text: t, toks: tokens(t) }));
  const b = bullets(clean[1]).map(t => ({ text: t, toks: tokens(t) }));
  if (!a.length || !b.length) {
    return ['No se detectaron hallazgos en formato de lista; se devuelven los reportes crudos.', '', '### A', clean[0], '', '### B', clean[1]].join('\n');
  }

  const usedB = new Set();
  const both = [];
  const onlyA = [];
  for (const x of a) {
    let best = -1, score = 0;
    b.forEach((y, i) => {
      if (usedB.has(i)) return;
      const s = similar(x.toks, y.toks);
      if (s > score) { score = s; best = i; }
    });
    if (best >= 0 && score >= 0.4) { usedB.add(best); both.push({ a: x.text, b: b[best].text }); }
    else onlyA.push(x.text);
  }
  const onlyB = b.filter((_, i) => !usedB.has(i)).map(y => y.text);

  const out = ['# Revision fusionada', '', 'A (seguridad/correctitud): ' + a.length + ' hallazgos  |  B (calidad): ' + b.length + ' hallazgos  |  coincidencias: ' + both.length, ''];
  out.push('## Coincidencias (corroboradas por ambas pasadas)');
  out.push(both.length ? both.map(h => '- ' + h.a).join('\n') : '(ninguna)');
  out.push('', '## Solo pasada A - seguridad y correctitud');
  out.push(onlyA.length ? onlyA.map(t => '- ' + t).join('\n') : '(ninguno)');
  out.push('', '## Solo pasada B - calidad y mantenibilidad');
  out.push(onlyB.length ? onlyB.map(t => '- ' + t).join('\n') : '(ninguno)');
  out.push('', 'Las coincidencias pesan mas. Los demas hallazgos requieren criterio propio antes de actuar.');
  return out.join('\n');
}