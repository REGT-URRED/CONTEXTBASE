import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoEnsure } from './auto.js';
import { collectState, buildDigest } from './context.js';
import { syncWorkspaceChanges } from './watcher.js';

function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

function readOwnVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Instala o quita hooks Git (post-commit, post-merge, post-checkout) que registran
 * automaticamente cada commit y sincronizan contextbase/ sin depender del agente.
 */
export function installGitHook(projectDir, action = 'install') {
  const gitDir = path.join(projectDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: 'No es un repositorio Git: falta .git/. Ejecutar contextbase init dentro de un repo Git.' };
  }
  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');
  const auxHooks = ['post-merge', 'post-checkout'].map(name => path.join(hooksDir, name));

  if (action === 'remove' || action === 'uninstall') {
    for (const aux of auxHooks) {
      try {
        if (fs.existsSync(aux) && fs.readFileSync(aux, 'utf8').includes('ContextBase autosave')) {
          fs.unlinkSync(aux);
        }
      } catch {}
    }
    if (!fs.existsSync(hookPath)) return { ok: true, message: 'No habia hook post-commit instalado.' };
    fs.unlinkSync(hookPath);
    return { ok: true, message: 'Hook post-commit eliminado.' };
  }

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes('ContextBase autosave')) {
      return { ok: false, message: 'Ya existe un post-commit ajeno. No se sobrescribe: fusionar a mano o moverlo.' };
    }
  }

  const nodePath = process.execPath.replace(/\\/g, '/');
  const binPath = fileURLToPath(new URL('../bin/contextbase.js', import.meta.url)).replace(/\\/g, '/');
  const script = [
    '#!/bin/sh',
    '# ContextBase autosave: registra cada commit en contextbase/changelog.md',
    'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0',
    '[ -d "$ROOT/contextbase" ] || exit 0',
    'SUBJECT=$(git log -1 --pretty=format:%s)',
    'SHORT=$(git log -1 --pretty=format:%h)',
    'NODEBIN BINPATH log "[commit] $SHORT $SUBJECT" >/dev/null 2>&1',
    'NODEBIN BINPATH hook-run post-commit >/dev/null 2>&1',
    'exit 0',
    ''
  ].join('\n');
  const resolved = script.replace(/NODEBIN/g, shellQuote(nodePath)).replace(/BINPATH/g, shellQuote(binPath));
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, resolved, { mode: 0o755 });
  try { fs.chmodSync(hookPath, 0o755); } catch {}

  const syncScript = [
    '#!/bin/sh',
    '# ContextBase autosave: sincroniza memoria tras merge o cambio de rama',
    'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0',
    '[ -d "$ROOT/contextbase" ] || exit 0',
    'NODEBIN BINPATH hook-run post-merge >/dev/null 2>&1',
    'exit 0',
    ''
  ].join('\n').replace(/NODEBIN/g, shellQuote(nodePath)).replace(/BINPATH/g, shellQuote(binPath));

  for (const aux of auxHooks) {
    try {
      if (!fs.existsSync(aux) || fs.readFileSync(aux, 'utf8').includes('ContextBase autosave')) {
        fs.writeFileSync(aux, syncScript, { mode: 0o755 });
        try { fs.chmodSync(aux, 0o755); } catch {}
      }
    } catch {}
  }

  return { ok: true, message: 'Hook post-commit instalado en ' + path.relative(projectDir, hookPath) + ' (autoguardado de commits en changelog.md).' };
}

function parseStdinPayload() {
  try {
    if (process.stdin.isTTY) return null;
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Ejecuta eventos automaticos de ciclo de vida invocados por plugins de OpenCode/Kilo,
 * hooks de Claude Code o hooks de Git.
 */
export async function runLifecycleHook(event = 'session-start', projectDir = process.cwd(), extraArgs = []) {
  const root = path.resolve(projectDir);
  const evt = String(event || 'session-start').toLowerCase();

  try {
    autoEnsure(root);
  } catch {}

  if (evt === 'session-start' || evt === 'digest') {
    const state = collectState(root);
    return buildDigest(state, readOwnVersion());
  }

  if (evt === 'task-add' && extraArgs[0]) {
    const cliMod = await import('./cli.js');
    const tasklistPath = path.join(root, 'contextbase', 'tasklist.md');
    const text = String(extraArgs.join(' ')).trim();
    if (text && fs.existsSync(tasklistPath)) {
      const current = fs.readFileSync(tasklistPath, 'utf8');
      if (!current.includes(text)) {
        cliMod.runTask('add', text, root);
      }
    }
    return 'ok';
  }

  if (evt === 'task-done' && extraArgs[0]) {
    const cliMod = await import('./cli.js');
    const text = String(extraArgs.join(' ')).trim();
    if (text) cliMod.runTask('done', text, root);
    return 'ok';
  }

  if (evt === 'post-tool') {
    const payload = parseStdinPayload();
    const files = [...extraArgs];
    if (payload && typeof payload === 'object') {
      const input = payload.tool_input || payload.input || payload.args || {};
      const fp = input.file_path || input.filePath || input.path || '';
      if (fp) files.push(String(fp));
    }
    const res = syncWorkspaceChanges(root, files, { logChanges: false });
    return JSON.stringify(res);
  }

  if (evt === 'session-stop' || evt === 'stop' || evt === 'post-commit' || evt === 'post-merge' || evt === 'post-checkout') {
    const logChanges = evt !== 'post-commit';
    const res = syncWorkspaceChanges(root, extraArgs, { logChanges, force: evt === 'post-commit' || evt === 'post-merge' });
    return JSON.stringify(res);
  }

  const state = collectState(root);
  return buildDigest(state, readOwnVersion());
}
