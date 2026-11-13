import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from './scanner.js';
import { syncFundamentos } from './generator.js';
import { runMaintenance } from './maintenance.js';
import { appendEntry } from './changelog.js';
import { writeAtomic, withLock } from './fsutil.js';
import { refreshBaseline } from './guard.js';
import { prepareStrandsContext } from './strands.js';
import { autoFinalizeSpiderWorktree, autoPulseWeb } from './web.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IGNORED_PREFIXES = [
  'contextbase/',
  '.git/',
  'node_modules/',
  '.opencode/',
  '.kilo/',
  '.kilocode/',
  '.claude/',
  '.cursor/',
  '.windsurf/',
  '.gemini/',
  '.agents/',
  '.worktrees/',
  '.atl/',
  'dist/',
  'build/',
  'coverage/'
];

const IGNORED_FILES = new Set([
  'kilo.json',
  'kilo.jsonc',
  'opencode.json',
  'opencode.jsonc',
  '.mcp.json',
  'agents.md',
  'claude.md',
  '.cursorrules',
  '.windsurfrules',
  'contextbase-pack.txt'
]);

const MANIFEST_FILES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod'
]);

export function isRelevantPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm) return false;
  if (norm[1] === ':' && norm[2] === '/') return false;
  if (norm.startsWith('../') || norm === '..') return false;
  if (IGNORED_FILES.has(norm.toLowerCase())) return false;
  if (norm.endsWith('.tmp') || norm.endsWith('.lock') || norm.endsWith('.log')) return false;
  for (const prefix of IGNORED_PREFIXES) {
    if (norm === prefix.slice(0, -1) || norm.startsWith(prefix)) return false;
  }
  return true;
}

export function detectWorkingTreeChanges(projectDir) {
  try {
    const out = execFileSync(
      'git',
      ['-c', 'core.filemode=false', '-c', 'core.autocrlf=false', 'status', '--porcelain', '-uall'],
      {
        cwd: projectDir,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000
      }
    );
    const files = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line || line.length < 4) continue;
      let file = line.slice(3).trim();
      if (file.includes(' -> ')) file = file.split(' -> ').pop().trim();
      file = file.replace(/^"|"$/g, '');
      if (isRelevantPath(file)) files.push(file.replace(/\\/g, '/'));
    }
    return Array.from(new Set(files));
  } catch {
    return [];
  }
}

function updateAutoChangelog(projectDir, changedFiles) {
  const changelogPath = path.join(projectDir, 'contextbase', 'changelog.md');
  if (!fs.existsSync(changelogPath) || changedFiles.length === 0) return false;
  const dateStr = new Date().toISOString().slice(0, 10);
  const sample = changedFiles.slice(0, 6).join(', ') + (changedFiles.length > 6 ? ` (+${changedFiles.length - 6})` : '');
  const entryLine = `- [${dateStr}] [auto] Sincronización automática de archivos modificados: ${sample}`;

  return withLock(changelogPath, () => {
    const current = fs.readFileSync(changelogPath, 'utf8');
    const lines = current.split(/\r?\n/);
    const autoPrefix = `- [${dateStr}] [auto] Sincronización automática de archivos modificados:`;
    const existingIdx = lines.findIndex(l => l.startsWith(autoPrefix));
    if (existingIdx !== -1) {
      if (lines[existingIdx] === entryLine) return false;
      lines[existingIdx] = entryLine;
      writeAtomic(changelogPath, lines.join('\n'));
      return true;
    }
    const next = appendEntry(current, entryLine, 500);
    writeAtomic(changelogPath, next.content);
    return true;
  });
}

function syncCodeTodosToTasklist(projectDir, analysis) {
  const tasklistPath = path.join(projectDir, 'contextbase', 'tasklist.md');
  if (!fs.existsSync(tasklistPath)) return false;
  const todos = ((analysis && analysis.todos) || []).filter(t => !/^test\//i.test(String(t.file || '')));
  if (todos.length === 0) return false;

  return withLock(tasklistPath, () => {
    let content = fs.readFileSync(tasklistPath, 'utf8');
    let added = false;
    const header = '## Tareas Pendientes / En Progreso';
    for (const t of todos.slice(0, 10)) {
      const marker = `\`${t.file}:${t.line}\``;
      if (!content.includes(marker) && !content.includes(t.text)) {
        const line = `- [ ] Resolver ${t.type} en ${marker}: ${t.text}`;
        if (content.includes(header)) {
          content = content.replace(header, `${header}\n${line}`);
        } else {
          content += `\n${header}\n${line}\n`;
        }
        added = true;
      }
    }
    if (added) writeAtomic(tasklistPath, content);
    return added;
  });
}

/**
 * Sincroniza automaticamente cambios del arbol de trabajo hacia contextbase/.
 */
export function syncWorkspaceChanges(projectDir = process.cwd(), explicitFiles = [], options = {}) {
  const root = path.resolve(projectDir);
  const contextDir = path.join(root, 'contextbase');
  if (!fs.existsSync(contextDir)) return { synced: false, reason: 'no-contextbase' };

  const candidates = explicitFiles.length > 0
    ? explicitFiles.map(f => path.isAbsolute(f) ? path.relative(root, f) : f).filter(isRelevantPath)
    : detectWorkingTreeChanges(root);

  const uniqueFiles = Array.from(new Set(candidates.map(f => String(f).replace(/\\/g, '/'))));
  if (uniqueFiles.length === 0 && !options.force) {
    return { synced: false, files: [] };
  }

  let fundamentosUpdated = false;
  let componentesUpdated = false;
  let changelogUpdated = false;
  let tasksUpdated = false;
  let strandsUpdated = false;

  try {
    const analysis = analyzeProject(root);
    fundamentosUpdated = Boolean(syncFundamentos(root, analysis));
    tasksUpdated = syncCodeTodosToTasklist(root, analysis);
  } catch {}

  if (uniqueFiles.some(f => MANIFEST_FILES.has(path.basename(f)))) {
    try {
      runMaintenance(root);
      componentesUpdated = true;
    } catch {}
  }

  if (uniqueFiles.length > 0 && options.logChanges !== false) {
    try {
      changelogUpdated = updateAutoChangelog(root, uniqueFiles);
    } catch {}
  }

  try { refreshBaseline(root); } catch {}

  try {
    prepareStrandsContext(root);
    strandsUpdated = true;
  } catch {}

  try {
    autoFinalizeSpiderWorktree(root, uniqueFiles, options.deps);
  } catch {}

  try {
    autoPulseWeb(root, options.deps);
  } catch {}

  return {
    synced: true,
    files: uniqueFiles,
    fundamentosUpdated,
    componentesUpdated,
    changelogUpdated,
    tasksUpdated,
    strandsUpdated
  };
}

/**
 * Inicia un observador en tiempo real sobre el proyecto que mantiene contextbase/
 * actualizado automaticamente ante ediciones de cualquier agente o IDE.
 */
export function startWatcher(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const debounceMs = Number(options.debounceMs || 1200);
  const pollMs = Number(options.pollMs || 0);
  const pendingFiles = new Set();
  let timer = null;
  let pollTimer = null;
  let closed = false;
  let syncCount = 0;
  let lastResult = null;
  let fsWatcher = null;

  function flush() {
    timer = null;
    if (closed || pendingFiles.size === 0) return;
    const batch = Array.from(pendingFiles);
    pendingFiles.clear();
    try {
      const res = syncWorkspaceChanges(root, batch, { logChanges: options.logChanges !== false });
      if (res.synced) {
        syncCount += 1;
        lastResult = res;
        if (typeof options.onSync === 'function') options.onSync(res);
      }
    } catch {}
  }

  function schedule(relFile) {
    if (closed) return;
    if (relFile && isRelevantPath(relFile)) {
      pendingFiles.add(String(relFile).replace(/\\/g, '/'));
    }
    if (pendingFiles.size === 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    if (options.unref !== false && timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  try {
    fsWatcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      schedule(String(filename));
    });
    fsWatcher.on('error', () => {});
    if (options.unref !== false && typeof fsWatcher.unref === 'function') {
      fsWatcher.unref();
    }
  } catch {
    const fallbackInterval = pollMs > 0 ? pollMs : 4000;
    pollTimer = setInterval(() => {
      const changed = detectWorkingTreeChanges(root);
      for (const f of changed) schedule(f);
      try { autoPulseWeb(root); } catch {}
    }, fallbackInterval);
    if (options.unref !== false && typeof pollTimer.unref === 'function') {
      pollTimer.unref();
    }
  }

  if (pollMs > 0 && !pollTimer) {
    pollTimer = setInterval(() => {
      const changed = detectWorkingTreeChanges(root);
      for (const f of changed) schedule(f);
      try { autoPulseWeb(root); } catch {}
    }, pollMs);
    if (options.unref !== false && typeof pollTimer.unref === 'function') {
      pollTimer.unref();
    }
  }

  return {
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (fsWatcher) {
        try { fsWatcher.close(); } catch {}
        fsWatcher = null;
      }
    },
    trigger(files = []) {
      for (const f of files) schedule(f);
      flush();
    },
    getStats() {
      return { root, closed, syncCount, lastResult };
    }
  };
}

function pidFile(projectDir) {
  return path.join(path.resolve(projectDir), 'contextbase', '.watcher.pid');
}

export function startDaemonWatcher(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const existing = statusDaemonWatcher(root);
  if (existing.running) return existing;

  const binPath = path.resolve(__dirname, '..', 'bin', 'contextbase.js');
  const child = spawn(process.execPath, [binPath, 'watch', '--foreground'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  // Sin listener de 'error' el daemon caido por un spawn fallido abortaba el proceso padre.
  child.on('error', () => {});
  child.unref();
  const pFile = pidFile(root);
  fs.mkdirSync(path.dirname(pFile), { recursive: true });
  writeAtomic(pFile, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }, null, 2));
  return { running: true, pid: child.pid, projectDir: root };
}

export function statusDaemonWatcher(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const pFile = pidFile(root);
  if (!fs.existsSync(pFile)) return { running: false, pid: null, projectDir: root };
  try {
    const data = JSON.parse(fs.readFileSync(pFile, 'utf8'));
    const pid = Number(data && data.pid);
    if (!pid) return { running: false, pid: null, projectDir: root };
    process.kill(pid, 0);
    return { running: true, pid, startedAt: data.startedAt || null, projectDir: root };
  } catch {
    try { fs.unlinkSync(pFile); } catch {}
    return { running: false, pid: null, projectDir: root };
  }
}

export function stopDaemonWatcher(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const st = statusDaemonWatcher(root);
  const pFile = pidFile(root);
  if (!st.running || !st.pid) {
    try { if (fs.existsSync(pFile)) fs.unlinkSync(pFile); } catch {}
    return { stopped: false, pid: null };
  }
  try {
    process.kill(st.pid, 'SIGTERM');
  } catch {}
  try { if (fs.existsSync(pFile)) fs.unlinkSync(pFile); } catch {}
  return { stopped: true, pid: st.pid };
}
