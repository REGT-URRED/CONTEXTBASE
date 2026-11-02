import fs from 'node:fs';
import path from 'node:path';
import { collectState, buildDigest } from './context.js';

const OWN_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function escHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escBlock(data) {
  return String(data).replace(/\r\n/g, '\n').split('\n').map(l => escHTML(l)).join('\n');
}

export function exportToJSON(data) {
  return JSON.stringify(data, null, 2);
}

export function exportToHTML(title, data) {
  const now = new Date().toISOString();
  const safeTitle = escHTML(title);
  const safeData = escBlock(data);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 2rem; background: #fafafa; }
.max { max-width: 900px; margin: 0 auto; }
header { border-bottom: 2px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 2rem; }
h1 { font-size: 1.75rem; margin: 0 0 0.25rem; color: #0f172a; }
.sub { color: #64748b; font-size: 0.95rem; }
.toc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem 1.5rem; margin-bottom: 2rem; }
.toc h2 { font-size: 1rem; margin-top: 0; color: #334155; }
.toc ul { list-style: none; padding: 0; margin: 0.5rem 0 0; }
.toc li { margin: 0.25rem 0; }
.toc a { color: #2563eb; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
pre { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; font-size: 0.9rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 0.85rem; }
.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #e2e8f0; color: #334155; font-size: 0.8rem; margin-left: 0.5rem; }
</style>
</head>
<body>
<div class="max">
<header>
<h1>${safeTitle}</h1>
<div class="sub">Generado: ${now}</div>
</header>

<div class="toc">
<h2>Contenido</h2>
<ul>
<li><a href="#datos">Datos exportados</a></li>
</ul>
</div>

<section id="datos">
<pre><code>${safeData}</code></pre>
</section>

<footer>
<p>Exportado con ContextBase v${OWN_VERSION} &bull; ${now}</p>
</footer>
</div>
</body>
</html>`;
}

export function exportState(projectDir, format = 'json') {
  const data = collectState(projectDir);
  return renderFormat(data, 'Estado de ContextBase', format);
}

export function exportDigest(projectDir, format = 'json') {
  const state = collectState(projectDir);
  const data = buildDigest(state, OWN_VERSION);
  return renderFormat(data, 'Digest de ContextBase', format);
}

function renderFormat(data, title, format) {
  let content, filename, mimeType;
  if (format === 'html') {
    content = exportToHTML(title, data);
    filename = slug(title) + '.html';
    mimeType = 'text/html';
  } else {
    content = typeof data === 'string' ? data : exportToJSON(data);
    filename = slug(title) + '.json';
    mimeType = 'application/json';
  }
  return { content, filename, mimeType };
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function exportCommand(projectDir, options) {
  const { type = 'state', format = 'json', output } = options || {};
  let result;
  if (type === 'digest') result = exportDigest(projectDir, format);
  else result = exportState(projectDir, format);

  if (output) {
    try {
      const outPath = path.isAbsolute(output) ? output : path.join(process.cwd(), output);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, result.content, 'utf8');
      return { written: outPath, filename: path.basename(outPath), mimeType: result.mimeType };
    } catch (err) {
      throw new Error('No se pudo escribir el archivo de exportación: ' + err.message);
    }
  }
  return result;
}
