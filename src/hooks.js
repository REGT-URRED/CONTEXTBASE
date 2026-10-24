import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/**
 * Instala o quita un hook post-commit que registra automaticamente cada commit
 * en contextbase/changelog.md. Autoguardado sin depender del agente.
 */
export function installGitHook(projectDir, action = 'install') {
  const gitDir = path.join(projectDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: 'No es un repositorio Git: falta .git/. Ejecutar contextbase init dentro de un repo Git.' };
  }
  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');
  if (action === 'remove' || action === 'uninstall') {
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
    'exit 0',
    ''
  ].join('\n');
  const resolved = script.replace('NODEBIN', shellQuote(nodePath)).replace('BINPATH', shellQuote(binPath));
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, resolved, { mode: 0o755 });
  try { fs.chmodSync(hookPath, 0o755); } catch {}
  return { ok: true, message: 'Hook post-commit instalado en ' + path.relative(projectDir, hookPath) + ' (autoguardado de commits en changelog.md).' };
}
