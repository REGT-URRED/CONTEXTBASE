import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoEnsure, isHomeDirectory } from './auto.js';
import { collectState, buildDigest } from './context.js';
import { syncWorkspaceChanges } from './watcher.js';
import { autoFinalizeSpiderWorktree, autoPulseWeb, PHILOSOPHY } from './web.js';

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
 * Construye el bloque de misión automática si la sesión se está ejecutando dentro del worktree de una Araña.
 */
function buildSpiderLiveInstructions(projectDir) {
  const spiderCtxPath = path.join(projectDir, 'contextbase', '.spider-context.json');
  if (!fs.existsSync(spiderCtxPath)) return '';
  try {
    const meta = JSON.parse(fs.readFileSync(spiderCtxPath, 'utf8'));
    if (!meta || !meta.run || !meta.spiderId) return '';
    const root = meta.rootCwd ? path.resolve(meta.rootCwd) : projectDir;
    const refixAbs = meta.refixPath ? path.join(root, meta.refixPath) : null;
    const refixText = refixAbs && fs.existsSync(refixAbs) ? fs.readFileSync(refixAbs, 'utf8').trim() : '';

    const lines = [
      '',
      `## 🕷️ MODO ARAÑA ACTIVO EN WORKTREE (${meta.spiderId} — Run ${meta.run})`,
      `- **Filosofía:** "${PHILOSOPHY}"`,
      `- **Rama Aislada:** \`${meta.branch}\``,
      `- **Segmento de la Presa:** ${meta.preySegment || meta.prey}`,
      `- **Archivos de tu Hilo (PERMITIDOS):** ${(meta.assignedFiles || []).join(', ') || '(Dentro de tu módulo)'}`,
      `- **Archivos de otras Arañas (PROHIBIDOS):** ${(meta.forbiddenFiles || []).slice(0, 12).join(', ') || '(Ninguno)'}`,
      '- **Cadena de 3 Subagentes Secuenciales (sin anidar subagentes):**',
      '  1. `Explorador de Hilo` -> Lee solo `contextbase/` y tus archivos asignados.',
      '  2. `Constructor Focalizado` -> Implementa el cambio dentro de tu hilo.',
      `  3. \`Verificador y Árbitro Local\` -> Valida pruebas, 0 slop y escribe \`${meta.resultPath}\` y \`${meta.statusPath}\`.`,
    ];

    if (refixText) {
      lines.push('');
      lines.push('### ⚠️ ORDEN ACTIVA DEL ÁRBITRO AUTOMÁTICO (refix.md):');
      lines.push(refixText);
    }
    return lines.join('\n');
  } catch {
    return '';
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
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes('ContextBase autosave')) {
      // Un hook ajeno que install se niega a tocar jamas se elimina desde 'remove'.
      return { ok: false, message: 'post-commit ajeno: no se elimina.' };
    }
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

function readStdinPayload(timeoutMs = 150) {
  return new Promise((resolve) => {
    try {
      // Dentro del servidor MCP el stdin es el canal JSON-RPC vivo del host: leerlo
      // bloquea el proceso para siempre o consume mensajes del protocolo.
      if (process.env.CONTEXTBASE_MCP === '1') return resolve(null);
      if (process.stdin.isTTY || process.stdin.destroyed || process.stdin.readableEnded) return resolve(null);

      const chunks = [];
      let settled = false;
      let timer = null;
      const finish = (rawText) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError);
        try { process.stdin.pause(); } catch {}
        const raw = String(rawText || '').trim();
        if (!raw) return resolve(null);
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      };
      const onData = (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'));
      const onError = () => finish('');

      process.stdin.on('data', onData);
      process.stdin.once('end', onEnd);
      process.stdin.once('error', onError);
      process.stdin.resume();

      timer = setTimeout(() => {
        const soFar = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
        finish(soFar);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Ejecuta eventos automaticos de ciclo de vida invocados por plugins de OpenCode/Kilo,
 * hooks de Claude Code, Antigravity/Gemini o hooks de Git.
 */
export async function runLifecycleHook(event = 'session-start', projectDir = process.cwd(), extraArgs = [], deps = null) {
  let root = path.resolve(projectDir);
  const rawArgs = Array.isArray(extraArgs) ? extraArgs : [];
  const wantAntigravity = rawArgs.includes('--antigravity') || process.env.CONTEXTBASE_HOOK_FORMAT === 'antigravity';
  const cleanArgs = rawArgs.filter((a) => a !== '--antigravity');
  const evt = String(event || 'session-start').toLowerCase();

  const payload = (evt === 'session-start' || evt === 'post-tool' || evt === 'session-stop' || evt === 'stop')
    ? await readStdinPayload()
    : null;

  if (payload && typeof payload === 'object' && isHomeDirectory(root)) {
    const cand = payload.cwd
      || (Array.isArray(payload.workspace_roots) && payload.workspace_roots[0])
      || payload.workspaceRoot
      || '';
    if (cand && typeof cand === 'string') {
      const resolvedCand = path.resolve(cand);
      if (fs.existsSync(resolvedCand)) root = resolvedCand;
    }
  }

  if (isHomeDirectory(root)) {
    return wantAntigravity ? JSON.stringify({}) : '';
  }

  try {
    autoEnsure(root, { deps });
  } catch {}

  // Autogestion: cierra terminales de agente cuyo trabajo ya termino (solo workers de este proyecto).
  if (!process.env.NODE_TEST_CONTEXT) {
    try {
      const terms = await import('./terminals.js');
      const closed = await terms.autoCloseFinished(root);
      if (closed.closed && closed.closed.length) {
        console.error('[ContextBase] terminales cerradas automaticamente: ' + closed.closed.map(x => x.pid + ' (' + x.agent + ')').join(', '));
      }
    } catch {}
  }

  if (evt === 'session-start' || evt === 'digest') {
    const state = collectState(root);
    const baseDigest = buildDigest(state, readOwnVersion());
    const spiderBlock = buildSpiderLiveInstructions(root);
    const full = spiderBlock ? `${baseDigest}\n${spiderBlock}` : baseDigest;
    return wantAntigravity ? JSON.stringify({ injectSteps: [full] }) : full;
  }

  if (evt === 'web-pulse') {
    const arb = autoPulseWeb(root, deps);
    return JSON.stringify(arb || { active: false });
  }

  if (evt === 'task-add' && cleanArgs[0]) {
    const cliMod = await import('./cli.js');
    const tasklistPath = path.join(root, 'contextbase', 'tasklist.md');
    const text = String(cleanArgs.join(' ')).trim();
    if (text && fs.existsSync(tasklistPath)) {
      const current = fs.readFileSync(tasklistPath, 'utf8');
      // Deduplicacion exacta por linea de tarea: un substring no debe descartar una tarea nueva.
      const already = current.split('\n').some(l => {
        const t = l.trim();
        return t === '- [ ] ' + text || t === '- [x] ' + text;
      });
      if (!already) {
        cliMod.runTask('add', text, root);
      }
    }
    return 'ok';
  }

  if (evt === 'task-done' && cleanArgs[0]) {
    const cliMod = await import('./cli.js');
    const text = String(cleanArgs.join(' ')).trim();
    if (text) cliMod.runTask('done', text, root);
    return 'ok';
  }

  if (evt === 'post-tool') {
    const files = [...cleanArgs];
    if (payload && typeof payload === 'object') {
      const input = payload.tool_input || payload.input || payload.args || payload.tool_info || payload;
      const fp = input.file_path || input.filePath || input.path || '';
      if (fp) files.push(String(fp));
    }
    const res = syncWorkspaceChanges(root, files, { logChanges: false });
    return JSON.stringify(res);
  }

  if (evt === 'session-stop' || evt === 'stop' || evt === 'post-commit' || evt === 'post-merge' || evt === 'post-checkout') {
    const logChanges = evt !== 'post-commit';
    const res = syncWorkspaceChanges(root, cleanArgs, { logChanges, force: evt === 'post-commit' || evt === 'post-merge', deps });
    try {
      autoFinalizeSpiderWorktree(root, res.files && res.files.length ? res.files : cleanArgs, deps);
    } catch {}
    try {
      autoPulseWeb(root, deps);
    } catch {}
    return JSON.stringify(res);
  }

  const state = collectState(root);
  return buildDigest(state, readOwnVersion());
}
