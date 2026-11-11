# ContextBase

Memoria técnica persistente, bitácora y lista de tareas 100% automática para proyectos trabajados con agentes de código (OpenCode, Kilo Code, Claude Code, Cursor, Windsurf, Antigravity).

`Zero dependencies` · `Node.js ESM` · `Windows / Linux / macOS` · `MIT`

> Persistent technical memory, changelog and task list for AI coding agents. Zero manual commands required.

---

## El problema

Cada sesión con un agente empieza en blanco: no recuerda decisiones, pendientes, deuda técnica ni qué se rompió la última vez. Además, las herramientas pasivas fallan cuando el usuario o el modelo olvidan invocarlas manualmente en medio de una sesión.

## La solución automática

ContextBase opera de extremo a extremo sin requerir invocación manual durante el uso en OpenCode, Kilo Code, Claude Code, Cursor y Windsurf:

1. **Autoconfiguración al instalar (`postinstall` / `contextbase auto`):** Registra el servidor MCP `contextbase`, preaprueba los permisos (`"contextbase_*": "allow"`) e instala los plugins de ciclo de vida en OpenCode y Kilo Code tanto a nivel global como por proyecto.
2. **Inyección automática al abrir sesión:** El plugin nativo (`contextbase-auto.js`), el hook `SessionStart` y la respuesta `initialize` del servidor MCP inicializan `contextbase/` si aún no existe e inyectan el digest compacto del proyecto directamente en el prompt del sistema antes del primer turno.
3. **Sincronización automática tras cada edición y al cerrar turno:** El observador en tiempo real (`watcher.js`) y los hooks `tool.execute.after` / `session.idle` / `Stop` detectan los archivos modificados por cualquier herramienta (`edit`, `write`, `patch`, `bash`), actualizan `fundamentos.md`, registran el cambio en `changelog.md`, sincronizan `TODO`/`FIXME` en `tasklist.md` y regeneran `contextbase/strands/`.
4. **Autoguardado Git:** Los hooks `post-commit`, `post-merge` y `post-checkout` se instalan automáticamente para registrar cada commit y mantener la memoria al día al cambiar de rama.

---

## Instalación

```bash
# global, desde el release de GitHub (autoconfigura el entorno global en postinstall)
npm install -g https://github.com/REGT-URRED/CONTEXTBASE/releases/latest/download/contextbase.tgz

# o desde el codigo
git clone https://github.com/REGT-URRED/CONTEXTBASE.git
cd CONTEXTBASE && npm link && contextbase auto --global
```

Verificar:

```bash
contextbase --version
contextbase status
```

---

## Uso automático y rápido

Al abrir OpenCode, Kilo Code o Claude Code en cualquier repositorio, el plugin global y el servidor MCP inicializan y mantienen `contextbase/` de forma transparente. Si deseas inicializar o verificar un proyecto desde terminal:

```bash
cd tu-proyecto
contextbase auto        # o contextbase init
contextbase watch       # opcional: inicia el demonio observador en segundo plano
```

Qué configura `init` / `auto` automáticamente:

1. Crea y puebla `contextbase/` (`fundamentos.md`, `changelog.md`, `tasklist.md`, `componentes.md`, `strands/`).
2. Configura `opencode.json` y `.opencode/plugins/contextbase-auto.js` para OpenCode.
3. Configura `kilo.json`, `.kilo/rules/contextbase.md` y `.kilo/plugins/contextbase-auto.js` para Kilo Code.
4. Configura `.mcp.json` y los hooks `SessionStart`, `PostToolUse` y `Stop` en `.claude/settings.json` para Claude Code.
5. Configura `.cursor/mcp.json` y `.cursor/rules/contextbase.mdc` (`alwaysApply: true`) para Cursor.
6. Inyecta las reglas sincronizadas en `AGENTS.md`, `CLAUDE.md`, `.cursorrules` y `.windsurfrules`.
7. Instala los hooks Git `post-commit`, `post-merge` y `post-checkout` y protege las rutas autogeneradas en `.git/info/exclude`.

---

## Qué crea y mantiene

| Archivo | Contenido |
| :--- | :--- |
| `contextbase/fundamentos.md` | Objetivo, reglas de desarrollo, arquitectura, dependencias y bloque técnico sincronizado. |
| `contextbase/changelog.md` | Bitácora con `## Cambios Realizados` (commits y sesiones automáticas) y `## Cambios por Hacer`. Rota a `changelog-YYYY.md` al superar 500 entradas. |
| `contextbase/tasklist.md` | Tareas con `[x]` completadas y `[ ]` pendientes (sincronizadas con `todowrite` y `TODO`/`FIXME` en código). |
| `contextbase/componentes.md` | Versiones instaladas, última modificación de cada manifiesto, desactualizaciones y vulnerabilidades conocidas. |
| `contextbase/strands/` | Contexto Python para Strands: variables, configuración, tareas, runner y JSON de estado. Se regenera automáticamente. |
| `.opencode/plugins/contextbase-auto.js` | Plugin nativo para OpenCode que inyecta el digest en el sistema y registra cambios al cerrar cada turno. |
| `.kilo/plugins/contextbase-auto.js` | Plugin nativo y reglas para Kilo Code con permisos `contextbase_*` preaprobados en `kilo.json`. |

Los documentos de memoria se mantienen en **español**; el código y la API en inglés.

---

## MCP nativo (Tools, Resources, Prompts y Watcher)

El servidor MCP (`contextbase mcp`) incluye watcher en tiempo real, inyección del digest activo en `initialize.result.instructions`, 7 recursos (`resources/list`, `resources/read`), 2 prompts (`prompts/list`, `prompts/get`) y 24 tools:

`contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`, `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`, `contextbase_review`, `contextbase_redundancy`, `contextbase_slop`, `contextbase_export`, `contextbase_mission`, `contextbase_swarm_start`, `contextbase_swarm_status`, `contextbase_swarm_send`, `contextbase_swarm_collect`, `contextbase_swarm_stop`, `contextbase_strands_prepare`, `contextbase_init`, `contextbase_hook`.

---

## Comandos

| Comando | Para qué |
| :--- | :--- |
| `contextbase auto` / `setup` | Autoconfigura MCP, plugins, permisos y hooks en el proyecto o globalmente (`--global`, `--watch`). |
| `contextbase watch [start\|stop\|status]` | Demonio observador en tiempo real que sincroniza cambios del árbol de trabajo hacia `contextbase/`. |
| `contextbase init` | Inicializa memoria, autoconfigura agentes, reglas, Skill, hooks Git y mantenimiento. |
| `contextbase status` / `check` | Tablero de archivos, tareas, seguridad y reglas. `--json`, `--check`. |
| `contextbase context` | Digest compacto para iniciar sesión. `--json` disponible. |
| `contextbase log "<mensaje>"` | Registra un cambio en el changelog. |
| `contextbase task add\|done\|list` | Gestiona tareas. |
| `contextbase audit` | Regenera componentes, frescura y brechas. |
| `contextbase sync` | Sincroniza `fundamentos.md`, cambios del árbol de trabajo y reglas sin borrar notas manuales. |
| `contextbase hook [install\|remove]` | Instala o quita los hooks Git (`post-commit`, `post-merge`, `post-checkout`). |
| `contextbase hook-run <evento>` | Ejecutor interno de eventos automáticos (`session-start`, `post-tool`, `session-stop`). |
| `contextbase pack [archivo]` | Empaqueta el repositorio para contexto, con redacción de secretos. |
| `contextbase dump` | Vuelca los documentos de `contextbase/` en terminal. |
| `contextbase mcp` | Servidor MCP sobre stdio con watcher activo. |
| `contextbase install-skill` | Reinstala la Skill y plugins globales en todos los agentes. |
| `contextbase review [base] [--intent "texto"]` | Arma el paquete de revisión sobre el árbol de trabajo contra `<base>`. |
| `contextbase review prompts` | Imprime solo los dos prompts de revisor. |
| `contextbase review merge <reporte-a.md> <reporte-b.md>` | Fusiona dos reportes; exige exactamente dos archivos. |
| `contextbase redundancy [--json]` | Detecta redundancia global e informa las skills principales. |
| `contextbase slop [base] [--json]` | Escanea el árbol de trabajo contra `<base>` con las reglas antislop. |

---

## Compatibilidad

| Entorno | Mecanismo Automático |
| :--- | :--- |
| OpenCode | `opencode.json` (MCP + `permission: allow`) + `.opencode/plugins/contextbase-auto.js` + `AGENTS.md` + Skill |
| Kilo Code | `kilo.json` (MCP + `permission: allow`) + `.kilo/plugins/contextbase-auto.js` + `.kilo/rules/contextbase.md` |
| Claude Code | `.mcp.json` + `.claude/settings.json` (`SessionStart`, `PostToolUse`, `Stop`) + `CLAUDE.md` + Skill |
| Cursor | `.cursor/mcp.json` + `.cursor/rules/contextbase.mdc` (`alwaysApply: true`) + `.cursorrules` |
| Windsurf | `.windsurf/mcp.json` + `.windsurfrules` |
| Antigravity / Gemini CLI | `AGENTS.md` + `.gemini/rules/contextbase.md` + Skill global |

---

## Arquitectura

```
bin/contextbase.js      entrada CLI
src/cli.js              router y comandos
src/auto.js             automatización silenciosa de memoria, reglas, hooks y Strands
src/autoconfig.js       autoconfiguración de MCP, permisos y plugins (OpenCode, Kilo, Claude, Cursor)
src/watcher.js          observador en tiempo real y demonio de sincronización del árbol de trabajo
src/hooks.js            hooks Git (post-commit/merge/checkout) y ejecutor de ciclo de vida (hook-run)
src/mcp.js              servidor MCP stdio (tools, resources, prompts, instrucciones vivas y watcher)
src/scanner.js          escaneo, metadatos, Repomix, redacción
src/generator.js        documentos y bloque sincronizado
src/maintenance.js      inventario, frescura y brechas
src/context.js          estado, digest y salud
src/changelog.js        bitácora y rotación
src/fsutil.js           escritura atómica y bloqueo
src/rules.js            inyección de reglas con versión
src/review.js           revisión tipo thermos: diff, contenidos, prompts y merge
src/redundancy.js       redundancia del entorno global
src/slop.js             delivery gate antislop sobre líneas agregadas
src/installer.js        Skill y plugins globales multi-CLI
src/export.js           exportación JSON/HTML
src/strands.js          contexto Python y runner para Strands
src/swarm.js            orquestación de enjambre por worktrees (opencode y kilo)
skills/contextbase/     definición de la Skill
```

---

## Pruebas

```bash
npm test
```

---

## Licencia

MIT
