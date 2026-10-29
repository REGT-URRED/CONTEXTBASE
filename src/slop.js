import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isRepo, resolveBase } from './review.js';

// prose: true -> solo aplica a prosa, nunca a lineas de codigo.
const RULES = [
  { id: 'banned-word', prose: true, detail: 'palabra de relleno o marketing IA', test: t => {
      const m = t.match(/\b(seamless(ly)?|leverage|leveraging|robust|cutting-edge|world-class|game-?changer|unlock|empower|elevate|delve|tapestry|myriad|pivotal|meticulous|intricate|testament to|in today'?s fast-paced|revolutioni[sz]e)\b/i);
      return m ? m[0] : null;
    } },
  { id: 'not-x-but-y', prose: true, detail: 'construccion contrastiva de relleno', test: t => {
      const m = t.match(/\bnot\s+[a-z][\w\s-]{0,30}\bbut\b/i);
      return m ? m[0].trim() : null;
    } },
  { id: 'dash-density', prose: true, detail: 'dos o mas guiones largos en una linea', test: t => {
      const n = (t.match(/\u2014/g) || []).length;
      return n >= 2 ? n + ' guiones' : null;
    } },
  { id: 'bold-label', prose: true, detail: 'etiqueta en negrita tipo informe IA', test: t => {
      const m = t.match(/\*\*[^*\n]{2,40}\*\*\s*:/);
      return m ? m[0] : null;
    } },
  { id: 'comment-restates-code', detail: 'comentario que repite lo que el codigo ya dice', test: t => {
      const m = t.match(/^\+\s*\/\/\s*(increment|inicializ|initialize|set |get |loop|iterate|handle|process|check|call|return|update|create|add|remove|delete|assign|declare)\b/i);
      return m ? m[0].replace(/^\+\s*/, '') : null;
    } },
];

const SKIP = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.js|\.map)$/i;

const CODE_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|cs|rb|php|sh|ps1|css|scss|less|html|vue|svelte)$/i;
const COMMENT = /^\+\s*(\/\/|\/\*|\*|#|<!--|--\s)/;
const LINE_COMMENT = /^\+\s*\/\//;

// Las reglas de prosa aplican a prosa, no a codigo: en archivos de codigo solo cuentan los comentarios.
function applies(rule, file, text) {
  if (rule.prose) return !CODE_FILE.test(file) || COMMENT.test(text);
  return CODE_FILE.test(file) && LINE_COMMENT.test(text);
}

function addedLines(dir, base) {
  const raw = execFileSync('git', ['diff', '--unified=0', '--no-color', '--text', base], {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (line.startsWith('+++ ')) { file = null; continue; }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { lineNo = parseInt(hunk[1], 10); continue; }
    if (!file || SKIP.test(file)) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) { out.push({ file, line: lineNo, text: line }); lineNo++; }
    else if (line.startsWith('-')) continue;
    else lineNo++;
  }
  return out;
}

function untrackedLines(dir) {
  const raw = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  const out = [];
  for (const name of raw.split('\u0000').filter(Boolean)) {
    if (SKIP.test(name)) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    const body = text.split(/\r?\n/);
    if (body.length && body[body.length - 1] === '') body.pop();
    body.forEach((t, i) => out.push({ file: name, line: i + 1, text: '+' + t }));
  }
  return out;
}

export function scan(dir = process.cwd(), options = {}) {
  if (!isRepo(dir)) throw new Error('El directorio no es un repositorio git: ' + dir);
  const base = resolveBase(dir, options.base);
  const lines = addedLines(dir, base).concat(untrackedLines(dir));
  if (!lines.length) return { base, scanned: 0, findings: [], empty: true };
  const findings = [];
  for (const l of lines) {
    for (const rule of RULES) {
      if (!applies(rule, l.file, l.text)) continue;
      const hit = rule.test(l.text);
      if (hit) findings.push({ rule: rule.id, detail: rule.detail, file: l.file, line: l.line, text: l.text.trim().slice(0, 160) });
    }
  }
  return { base, scanned: lines.length, findings };
}

export function render(result) {
  const r = result || scan();
  const lines = ['# Antislop - Delivery Gate', ''];
  if (r.empty) lines.push('AVISO: no hay cambios que evaluar contra "' + r.base + '"; el gate no aplica (no equivale a aprobado).', '');
  lines.push('Base: ' + r.base + '  |  lineas agregadas escaneadas: ' + r.scanned);
  lines.push('', '## Hallazgos (' + r.findings.length + ')');
  if (!r.findings.length) lines.push('(sin hallazgos en las reglas aplicadas)');
  else for (const f of r.findings) lines.push('- ' + f.file + ':' + f.line + ' [' + f.rule + '] ' + f.detail + ' -> ' + f.text);
  lines.push('', '## Checklist antes de entregar UI, copy o comentarios');
  lines.push('- Contraste y foco de teclado verificados si hay UI.');
  lines.push('- Copy sin relleno, sin signos de venta ni superlativos.');
  lines.push('- Comentarios solo para el porque, nunca para repetir el codigo.');
  lines.push('- Estados: vacio, cargando, error y exito presentes.');
  lines.push('', 'Reglas heuristas: no reemplazan criterio humano.');
  return lines.join('\n');
}