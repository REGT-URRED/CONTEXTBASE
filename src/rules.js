import fs from 'node:fs';
import path from 'node:path';

export const CONTEXTBASE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
})();

export const CONTEXTBASE_RULE_BLOCK = `<!-- CONTEXTBASE:START -->
<!-- CONTEXTBASE:v${CONTEXTBASE_VERSION} -->
## Memoria Persistente y Bitácora del Proyecto (contextbase)
Este proyecto utiliza un sistema automático de memoria técnica persistente en la carpeta \`contextbase/\`.

### Protocolo Automático Obligatorio para Agentes (OpenCode, Kilo, Claude, Cursor, Windsurf):
1. **Inicio Automático de Sesión:** Al comenzar cualquier tarea o turno sin contexto previo, consultar inmediatamente \`contextbase_context\` (vía MCP) o leer \`contextbase/strands/context.json\` sin esperar a que el usuario lo pida.
2. **Cierre Automático en \`contextbase/changelog.md\`:** Toda corrección, mejora o implementación debe registrarse antes de finalizar la respuesta usando \`contextbase_log\` o editando \`## Cambios Realizados\` con fecha y actualizando \`## Cambios por Hacer\`.
3. **Gestión Automática en \`contextbase/tasklist.md\`:** Marcar con \`[x]\` las tareas completadas (\`contextbase_task\` con \`action: "done"\`) y registrar con \`[ ]\` cualquier nuevo pendiente (\`action: "add"\`).
4. **Arquitectura en \`contextbase/fundamentos.md\`:** Ejecutar \`contextbase_sync\` o actualizar si hubo cambios en arquitectura, dependencias, scripts o reglas operativas.
5. **Idioma:** Toda salida, bitácora y documentación debe mantenerse estrictamente en **español**.
6. **Mantenimiento Preventivo Automático:** Al iniciar sesión y al cerrar cambios de dependencias, revisar \`contextbase/componentes.md\` y regenerarlo con \`contextbase_audit\` o \`contextbase audit\`.
<!-- CONTEXTBASE:END -->`;

/**
 * Inyecta o actualiza el bloque de reglas de contextbase en un archivo
 */
function injectRuleInFile(filePath) {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }

  const startTag = '<!-- CONTEXTBASE:START -->';
  const endTag = '<!-- CONTEXTBASE:END -->';

  let updatedContent;
  if (content.includes(startTag) && content.includes(endTag)) {
    const regex = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'g');
    updatedContent = content.replace(regex, CONTEXTBASE_RULE_BLOCK);
  } else if (content.trim().length > 0) {
    updatedContent = `${content.trim()}\n\n${CONTEXTBASE_RULE_BLOCK}\n`;
  } else {
    updatedContent = `${CONTEXTBASE_RULE_BLOCK}\n`;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  return true;
}

/**
 * Inyecta las directivas de ContextBase en todos los agentes comunes
 */
export function injectAgentRules(projectDir) {
  const targetFiles = [
    path.join(projectDir, 'AGENTS.md'),
    path.join(projectDir, 'CLAUDE.md'),
    path.join(projectDir, '.cursorrules'),
    path.join(projectDir, '.windsurfrules')
  ];

  const optionalDirs = [
    ['.gemini', path.join(projectDir, '.gemini', 'rules', 'contextbase.md')],
    ['.agents', path.join(projectDir, '.agents', 'rules', 'contextbase.md')],
    ['.kilo', path.join(projectDir, '.kilo', 'rules', 'contextbase.md')],
    ['.kilocode', path.join(projectDir, '.kilocode', 'rules', 'contextbase.md')],
    ['.opencode', path.join(projectDir, '.opencode', 'rules', 'contextbase.md')]
  ];

  for (const [dirName, rulePath] of optionalDirs) {
    if (fs.existsSync(path.join(projectDir, dirName))) {
      targetFiles.push(rulePath);
    }
  }

  const injected = [];
  for (const file of targetFiles) {
    try {
      injectRuleInFile(file);
      injected.push(path.relative(projectDir, file).replace(/\\/g, '/'));
    } catch {}
  }

  return injected;
}
