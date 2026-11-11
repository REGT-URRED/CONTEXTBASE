import fs from 'node:fs';
import path from 'node:path';

export const CONTEXTBASE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
})();

export const CONTEXTBASE_RULE_BLOCK = `<!-- CONTEXTBASE:START -->
<!-- CONTEXTBASE:v${CONTEXTBASE_VERSION} -->
## Memoria Persistente, Telaraña de Agentes y Bitácora Automática (contextbase)
> **Filosofía Central:** *"No es la IA, es quien controla a la IA"*

Este proyecto utiliza un sistema autónomo de memoria técnica persistente y Red de Agentes en Telaraña en la carpeta \`contextbase/\`.

### Protocolo Automático Obligatorio para Agentes (OpenCode, Kilo, Claude, Cursor, Windsurf):
1. **Inicio Automático de Sesión (Cero Intervención Manual):** Al comenzar cualquier tarea o turno, consultar inmediatamente \`contextbase_context\` (vía MCP) o leer \`contextbase/strands/context.json\` sin esperar a que el usuario lo pida. Si operas dentro de un worktree de Araña (\`.worktrees/swarm-*\`), lee \`contextbase/.spider-context.json\`, \`task.md\` y \`subagents.json\`.
2. **Red de Agentes en Telaraña (\`web\` / \`telarana\` / \`swarm\`):**
   - Cuando el objetivo abarque múltiples módulos o trabajo paralelo, lanza la Telaraña sobre la Presa: \`contextbase web start --prey "<objetivo>" --spiders N\` (o vía MCP \`contextbase_swarm_start\`).
   - Cada Araña trabaja en su propio worktree aislado con memoria pre-hidratada, hilo disjunto de archivos (\`assignedFiles\`) y 3 subagentes secuenciales por terminal (\`1. Explorador de Hilo\` -> \`2. Constructor Focalizado\` -> \`3. Verificador y Árbitro Local\`), sin desplegar subagentes recursivos descontrolados.
   - Ejecuta el Árbitro Automático (\`contextbase web arbitrate\` o \`contextbase_swarm_status\` con \`arbitrate: true\`) para evaluar sobre 100 puntos (\`PASS\` / \`REFIX\` / \`RERUN\` / \`FAIL\`) y mantener la Zona de Flujo (\`flow.md\` y \`metrics.json\`).
3. **Cierre Automático en \`contextbase/changelog.md\`:** Toda corrección, mejora o implementación debe registrarse antes de finalizar la respuesta usando \`contextbase_log\` o editando \`## Cambios Realizados\` con fecha y actualizando \`## Cambios por Hacer\`.
4. **Gestión Automática en \`contextbase/tasklist.md\`:** Marcar con \`[x]\` las tareas completadas (\`contextbase_task\` con \`action: "done"\`) y registrar con \`[ ]\` cualquier nuevo pendiente (\`action: "add"\`).
5. **Arquitectura en \`contextbase/fundamentos.md\`:** Ejecutar \`contextbase_sync\` o actualizar si hubo cambios en arquitectura, dependencias, scripts o reglas operativas.
6. **Idioma:** Toda salida, bitácora y documentación debe mantenerse estrictamente en **español**.
7. **Mantenimiento Preventivo Automático:** Al iniciar sesión y al cerrar cambios de dependencias, revisar \`contextbase/componentes.md\` y regenerarlo con \`contextbase_audit\` o \`contextbase audit\`.
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
