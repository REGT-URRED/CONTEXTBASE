import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * Sandbox = plan de contingencia.
 * Toda operacion experimental o delicada corre sobre una copia aislada del
 * proyecto; el proyecto real solo se toca cuando se promueve con applySandbox.
 */

const OUTPUT_LIMIT = 200 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const META_FILE = '.sandbox-meta.json';
const KILL_GRACE_MS = 5000;

const EXCLUDED_PATHS = new Set([
  '.git',
  'node_modules',
  '.worktrees',
  'contextbase/sandbox',
  'contextbase/snapshot',
  'contextbase/swarm',
  'contextbase/web',
  'contextbase/control',
  'dist',
  'build',
  'coverage',
]);

// Directorios internos del sandbox que no son cambios del proyecto.
const INTERNAL_PATHS = new Set([META_FILE, '.home']);

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function isExcluded(rel) {
  const p = toPosix(rel);
  if (EXCLUDED_PATHS.has(p)) return true;
  return p.endsWith('.log');
}

function isInternal(rel) {
  const p = toPosix(rel);
  if (INTERNAL_PATHS.has(p)) return true;
  return p.startsWith('.home/');
}

function sandboxRoot(projectDir) {
  return path.join(projectDir, 'contextbase', 'sandbox');
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function newId() {
  return `${stamp()}-${randomBytes(3).toString('hex')}`;
}

function isValidId(id) {
  return typeof id === 'string' && id !== '' && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/.test(id);
}

function writeMeta(dir, meta) {
  try {
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf8');
  } catch {}
}

// No se siguen enlaces simbolicos: se omiten para no copiar fuera del proyecto.
function copyTree(srcDir, destDir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (isExcluded(childRel)) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyTree(from, to, childRel);
    else if (entry.isFile()) {
      try { fs.copyFileSync(from, to); } catch {}
    }
  }
}

function walkFiles(rootDir, rel = '', out = [], skipInternal = false) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(rootDir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (isExcluded(childRel) || entry.isSymbolicLink()) continue;
    if (skipInternal && isInternal(childRel)) continue;
    if (entry.isDirectory()) walkFiles(rootDir, childRel, out, skipInternal);
    else if (entry.isFile()) out.push(toPosix(childRel));
  }
  return out;
}

function sameContent(a, b) {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function computeChangedFiles(projectDir, sandboxPath) {
  const inSandbox = new Set(walkFiles(sandboxPath, '', [], true));
  const inProject = new Set(walkFiles(projectDir));
  const changed = [];
  for (const rel of inSandbox) {
    if (!inProject.has(rel) || !sameContent(path.join(projectDir, rel), path.join(sandboxPath, rel))) {
      changed.push(rel);
    }
  }
  // Borrados: existian en el proyecto y ya no estan en el sandbox.
  for (const rel of inProject) {
    if (!inSandbox.has(rel)) changed.push(rel);
  }
  return changed.sort();
}

function isInside(root, target) {
  const norm = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  const r = norm(path.resolve(root));
  const t = norm(path.resolve(target));
  return t === r || t.startsWith(r + path.sep);
}

export function createSandbox(projectDir, options = {}) {
  const origin = path.resolve(projectDir);
  const root = sandboxRoot(origin);
  fs.mkdirSync(root, { recursive: true });
  const id = newId();
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  copyTree(origin, dir);
  const meta = {
    id,
    label: typeof options.label === 'string' ? options.label : '',
    origin,
    createdAt: new Date().toISOString(),
    command: typeof options.command === 'string' ? options.command : '',
    args: Array.isArray(options.args) ? options.args.map(String) : [],
    changedFiles: [],
  };
  writeMeta(dir, meta);
  return { id, path: dir, meta };
}

export function runInSandbox(projectDir, command, args = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const sandbox = createSandbox(projectDir, {
    label: options.label,
    command,
    args,
  });
  const env = { ...process.env };
  if (options.env) {
    Object.assign(env, typeof options.env === 'function' ? options.env(sandbox.path) : options.env);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let outLen = 0;
    let errLen = 0;
    let timedOut = false;
    let settled = false;
    let timer = null;
    let killTimer = null;
    let child = null;

    const append = (chunk, stream) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (stream === 'out') {
        if (outLen >= OUTPUT_LIMIT) return;
        const slice = buffer.subarray(0, OUTPUT_LIMIT - outLen);
        outLen += slice.length;
        stdout += slice.toString();
      } else {
        if (errLen >= OUTPUT_LIMIT) return;
        const slice = buffer.subarray(0, OUTPUT_LIMIT - errLen);
        errLen += slice.length;
        stderr += slice.toString();
      }
    };

    const finish = (exitCode, errorMessage) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const durationMs = Date.now() - startedAt;
      let changedFiles = [];
      try { changedFiles = computeChangedFiles(projectDir, sandbox.path); } catch {}
      const meta = { ...sandbox.meta, changedFiles, exitCode, durationMs, timedOut };
      sandbox.meta = meta;
      writeMeta(sandbox.path, meta);
      const result = { id: sandbox.id, path: sandbox.path, exitCode, stdout, stderr, changedFiles, durationMs, timedOut };
      if (errorMessage) result.error = errorMessage;
      resolve(result);
    };

    try {
      child = spawn(command, args.map(String), {
        cwd: sandbox.path,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish(127, `No se pudo ejecutar "${command}": ${err.message}`);
      return;
    }

    child.stdout.on('data', (chunk) => append(chunk, 'out'));
    child.stderr.on('data', (chunk) => append(chunk, 'err'));
    child.on('error', (err) => finish(127, `No se pudo ejecutar "${command}": ${err.message}`));
    child.on('close', (code) => finish(code === null ? 1 : code));

    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
      killTimer = setTimeout(() => finish(124, 'Tiempo de espera agotado; el proceso no termino al ser detenido.'), KILL_GRACE_MS);
    }, timeoutMs);
  });
}

export function listSandboxes(projectDir) {
  const root = sandboxRoot(projectDir);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const dir = path.join(root, entry.name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8'));
      out.push({
        id: typeof meta.id === 'string' && meta.id ? meta.id : entry.name,
        path: dir,
        label: typeof meta.label === 'string' ? meta.label : '',
        createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
        command: typeof meta.command === 'string' ? meta.command : '',
        changedFilesCount: Array.isArray(meta.changedFiles) ? meta.changedFiles.length : 0,
        corrupt: false,
      });
    } catch {
      out.push({ id: entry.name, path: dir, label: '', createdAt: '', command: '', changedFilesCount: 0, corrupt: true });
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));
  return out;
}

export function applySandbox(projectDir, id, options = {}) {
  const result = { applied: [], skipped: [], rejected: [] };
  if (!isValidId(id)) {
    result.rejected.push(String(id));
    return result;
  }
  const projectRoot = path.resolve(projectDir);
  const dir = path.join(sandboxRoot(projectRoot), id);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8'));
  } catch {
    result.error = 'Sandbox no encontrado o metadatos corruptos: ' + id;
    return result;
  }

  const only = Array.isArray(options.files) && options.files.length ? new Set(options.files.map(String)) : null;
  let files = Array.isArray(meta.changedFiles) ? meta.changedFiles : [];
  if (only) files = files.filter((rel) => only.has(String(rel)));

  for (const rel of files) {
    const raw = String(rel);
    if (!raw || path.isAbsolute(raw) || raw.includes('\0')) {
      result.rejected.push(raw);
      continue;
    }
    const target = path.resolve(projectRoot, raw);
    const source = path.resolve(dir, raw);
    if (!isInside(projectRoot, target) || !isInside(dir, source)) {
      result.rejected.push(raw);
      continue;
    }
    let isFile = false;
    try { isFile = fs.statSync(source).isFile(); } catch {}
    // Un borrado dentro del sandbox se reporta pero nunca se aplica.
    if (!isFile) {
      result.skipped.push(raw);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      result.applied.push(raw);
    } catch {
      result.skipped.push(raw);
    }
  }
  return result;
}

export function removeSandbox(projectDir, id) {
  if (!isValidId(id)) return { removed: false };
  const dir = path.join(sandboxRoot(path.resolve(projectDir)), id);
  if (!fs.existsSync(dir)) return { removed: false };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { removed: true };
  } catch {
    return { removed: false };
  }
}
