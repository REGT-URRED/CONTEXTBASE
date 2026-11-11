# Fundamentos del Proyecto: contextbase

## 1. Objetivo Principal
Sistema minimalista, universal y Zero-Dependencies de memoria persistente técnica automática y bitácora de proyecto para desarrolladores y agentes de código (OpenCode, Kilo Code, Claude Code, Cursor, Windsurf, Antigravity, Codex, Roo Code, etc.).

Este sistema resuelve la pérdida de contexto y continuidad técnica entre sesiones de trabajo mediante autoconfiguración de MCP, plugins de ciclo de vida, observador en tiempo real y directivas universales de actualización.

---

## 2. Reglas de Desarrollo y Buenas Prácticas
1. **Regla Crítica de Actualización (Obligatoria para Agentes de Código):**
   - Toda corrección, mejora, alteración o nueva implementación en el código debe concluir **siempre y de manera obligatoria** con la actualización de los registros dentro de `contextbase/`:
     - `contextbase/changelog.md`: Registrar en `## Cambios Realizados` y actualizar `## Cambios por Hacer`.
     - `contextbase/tasklist.md`: Marcar con `[x]` las tareas completadas y registrar con `[ ]` las nuevas tareas.
     - `contextbase/fundamentos.md`: Actualizar si se modificaron arquitectura, dependencias o reglas.
2. **Minimalismo Absoluto (Zero-Dependencies):**
   - No incorporar dependencias externas en `dependencies`. Usar únicamente módulos estándar de Node.js (`node:fs`, `node:path`, `node:child_process`, `node:os`).
   - Mantener ejecución instantánea (< 50ms) y compatibilidad directa sin pasos de compilación.
3. **Calidad de Código y Estilo:**
   - Estándar Node.js ESM moderno (`type: "module"`).
   - Manejo seguro de errores y rutas del sistema de archivos multiplataforma.
4. **Idioma de Documentación:**
   - Toda la documentación, bitácoras y salidas de terminal deben mantenerse estrictamente en **español**.
5. **Mantenimiento Preventivo Automático:**
   - Al iniciar un proyecto o sesión y como verificación final al cerrar cada cambio, revisar `contextbase/componentes.md`; regenerarlo con `contextbase audit` (componentes, versiones instaladas y brechas de seguridad). Delegar en la CLI sin saturar instrucciones.

---

## 3. Arquitectura y Contexto Técnico General
- **Nombre:** `contextbase`
- **Versión:** `1.5.0`
- **Ecosistema:** Node.js (ESM puro, >= 18.0.0)
- **Dependencias Externas:** 0 (Zero-Dependencies)
- **Binarios Registrados:** `contextbase`, `cb`, `openwiki`
- **Motor de Escaneo:** Analizador estático y empaquetador Repomix integrado en `src/scanner.js`
- **Mantenimiento Preventivo:** Inventario de componentes, frescura y brechas en `src/maintenance.js`; informe en `contextbase/componentes.md`; comando `contextbase audit`
- **Autoconfiguración de Agentes:** `src/autoconfig.js` genera y mantiene `kilo.json`, `opencode.json`, `.mcp.json`, `.opencode/plugins/contextbase-auto.js`, `.kilo/plugins/contextbase-auto.js`, `.kilo/rules/contextbase.md` y `.claude/settings.json`.

### Módulos Principales del Sistema:
- `bin/contextbase.js`: Punto de entrada ejecutable CLI.
- `src/index.js`: Exportaciones de la API programática.
- `src/cli.js`: Enrutador de comandos (`init`, `auto`, `setup`, `watch`, `hook-run`, etc.).
- `src/auto.js`: Automatización silenciosa: inicialización, autoconfiguración de agentes, refresco de componentes, reglas y contexto Strands.
- `src/autoconfig.js`: Generador de configuraciones MCP, permisos preaprobados (`contextbase_*`) y plugins nativos para OpenCode, Kilo Code, Claude Code, Cursor y Windsurf.
- `src/watcher.js`: Observador en tiempo real y demonio en segundo plano que sincroniza cambios del árbol de trabajo hacia `contextbase/`.
- `src/scanner.js`: Escáner de sistema de archivos, detector de stacks/commits/TODOs y motor Repomix.
- `src/generator.js`: Generador de `fundamentos.md`, `changelog.md` y `tasklist.md`.
- `src/rules.js`: Inyector universal de reglas de agente (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.kilo/rules/contextbase.md`, `.opencode/rules/contextbase.md`).
- `src/installer.js`: Instalador de la Skill y plugins globales en todos los agentes soportados.
- `src/maintenance.js`: Motor de mantenimiento preventivo (inventario de componentes, frescura de versiones y verificación de brechas de seguridad).
- `src/context.js`: Estado estructurado del proyecto, digest compacto para agentes y evaluación de salud.
- `src/changelog.js`: Inserción de entradas y rotación de la bitácora a archivos anuales.
- `src/fsutil.js`: Escritura atómica y bloqueo asesor por archivo (concurrencia multiagente).
- `src/hooks.js`: Hooks Git (`post-commit`, `post-merge`, `post-checkout`) y ejecutor de eventos de ciclo de vida (`runLifecycleHook`).
- `src/mcp.js`: Servidor MCP sobre stdio con cola secuencial FIFO, instrucciones vivas, 7 resources, 2 prompts, 24 tools y watcher activo.
- `src/bootstrap.js`: Recomendación y ejecución del arranque de un proyecto (`preview`, `run`).
- `src/cli_extra.js`: Subcomandos extendidos del CLI (`swarm`, `bootstrap`, `guard`, `snapshot`, `restore`, `tools`, `mission`).
- `src/detect.js`: Detección de CLIs instalados, binarios en `PATH` y lectura JSON/JSONC de configuraciones MCP.
- `src/export.js`: Exportación del estado o digest en JSON y HTML.
- `src/guard.js`: Protección de archivos sensibles con línea base, hash, escaneo de cambios sospechosos y refresco controlado de la línea base (`refreshBaseline`).
- `src/registry.js`: Registro de herramientas del proyecto y su estado habilitado.
- `src/redundancy.js`: Detección de redundancia global (skills duplicados, referencias rotas, bloques `AGENTS.md` y MCP repetidos).
- `src/review.js`: Revisión tipo thermos: diff, contenidos, prompts de revisor y fusión de reportes.
- `src/slop.js`: Delivery gate antislop sobre el árbol de trabajo, con reglas de prosa y código por separado.
- `src/snapshot.js`: Creación, listado, poda y restauración de snapshots del registro.
- `src/strands.js`: Contexto Python para Strands (`contextbase/strands/`), configuración, tareas y `strands_runner.py` con escalado humano.
- `src/swarm.js` y `src/swarm-agents.js`: Orquestación de enjambre por worktrees para `opencode` y `kilo`.
- `src/prompts/`: Prompts de revisor `review-security.md`, `review-quality.md` y `mission-orchestration.md`.
- `test/`: Suite de 112 pruebas con el runner nativo `node:test` (sin dependencias), incluyendo `test/qa-hardening.test.js` y `test/terminals.test.js`.
- `src/env.js`: Criterio único `isTestEnv()`/`realAgentsAllowed()` (guard NODE_TEST_CONTEXT) para que ninguna ruta lance agentes reales bajo `node --test`.
- `src/jsonc.js`: Fusión quirúrgica sobre JSONC (parse con posición de miembros, `setJsoncPath`, `appendJsoncArray`, `parseJsonc`) preservando comentarios.
- `src/terminals.js`: Identificación de terminales/procesos de agente abiertos para el proyecto, cierre protegido (dry-run + `--yes`, nunca el propio árbol) y envío por contrato nativo (`opencode run --session`).
- `skills/contextbase/SKILL.md`: Definición formal de la Skill para agentes de IA.
- `docs/FUNCIONAMIENTO.md`: Documentación funcional completa del flujo automático, plugins, hooks, watcher, MCP, Strands y swarm.

### Contratos del Sistema (2026-11-11)
- **Códigos de salida:** `0` éxito, `1` error de ejecución, `2` error de uso (subcomando/flag/argumento inválido).
- **Configuración de usuario (global y proyecto):** un archivo existente que no parsea NUNCA se sobrescribe; se deja backup `.bak-contextbase` y se reporta con `[ContextBase Error] code=CONFIG_INVALID_JSON`. Los `.jsonc` existentes (Kilo/OpenCode) se fusionan quirúrgicamente preservando comentarios, con precedencia sobre el `.json`.
- **Guard de pruebas:** toda ruta que pueda lanzar procesos de agente (swarm/web/auto/hooks/watcher) está inerte bajo `NODE_TEST_CONTEXT`; `node --test` debe terminar solo y en segundos.
- **Control de terminales:** `terminals list` (solo lectura), `terminals close <pid...|all> [--yes] [--force]` (dry-run por defecto, nunca cierra el árbol propio ni procesos no identificados como agentes), `terminals send <pid> --message "..."` (por contrato nativo; no se inyectan teclas en TUIs ajenas).

---

<!-- CONTEXTBASE:SYNC:START -->
## Contexto Técnico Sincronizado (auto)
> Generado por `contextbase sync`. No editar dentro de este bloque: se reemplaza completo.
- **Versión:** 1.5.0
- **Ecosistema:** Node.js / JavaScript / TypeScript
- **Frameworks:** Librerías estándar / Vanilla
- **Lenguajes dominantes:** JavaScript (67), Markdown (15), JSON (3)
- **Dependencias:** Sin dependencias externas registradas.
- **Scripts:** start, postinstall, auto, watch, test, audit, mcp, pack:release, test:ci, release:github
- **Directorios raíz:** bin, contextbase, docs, scripts, skills, src, test
<!-- CONTEXTBASE:SYNC:END -->

---
*Generado y consolidado por ContextBase CLI el 11/11/2026.*
