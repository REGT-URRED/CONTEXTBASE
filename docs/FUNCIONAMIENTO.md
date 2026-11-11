# Funcionamiento de ContextBase

## 1. Qué es y qué problema resuelve

ContextBase es una memoria técnica persistente y automática para agentes de código. Mantiene en el
repositorio el contexto que normalmente se pierde entre sesiones: arquitectura, decisiones,
cambios realizados, tareas pendientes, inventario de componentes y estado de seguridad.

El proyecto es Node.js ESM y no tiene dependencias externas. La carpeta `contextbase/` es la
fuente de verdad; los plugins nativos, hooks, el watcher en segundo plano, la CLI y el servidor
MCP la crean, la leen, la sincronizan y la protegen sin intervención manual.

## 2. Arquitectura de automatización total (OpenCode, Kilo Code, Claude Code, Cursor)

ContextBase no espera a que el usuario o el agente recuerden ejecutar comandos manuales. Opera a
través de cinco capas coordinadas:

1. **Autoconfiguración de entorno (`src/autoconfig.js` y `postinstall`):**
   - Al instalar el paquete (`npm install -g` o `contextbase auto --global`), se instalan la
     skill y el plugin `contextbase-auto.js` en los directorios globales (`~/.config/opencode`,
     `~/.config/kilo`, `~/.agents/skills`, `~/.gemini/config/skills`, `~/.claude/skills`) y se
     registra el servidor MCP con permisos preaprobados (`"contextbase_*": "allow"`).
   - A nivel de proyecto, `autoConfigureProject` genera o actualiza `kilo.json`, `opencode.json`,
     `.mcp.json`, `.opencode/plugins/contextbase-auto.js`, `.kilo/plugins/contextbase-auto.js` y
     `.kilo/rules/contextbase.md`, y los registra en `.git/info/exclude` para no ensuciar `git status`.
2. **Plugin nativo de ciclo de vida para OpenCode y Kilo (`contextbase-auto.js`):**
   - **Al iniciar sesión (`session.created` / arranque):** Ejecuta `hook-run session-start`,
     que garantiza la existencia de `contextbase/` (`autoEnsure`) sin intervención del usuario.
   - **Transformación automática del sistema (`experimental.chat.system.transform`):** Inyecta
     el digest actualizado del proyecto dentro del prompt del sistema antes de cada turno.
   - **Seguimiento de herramientas (`tool.execute.after`):** Registra cada archivo editado con
     `edit`, `write`, `patch`, `apply_patch` o `bash`, y sincroniza los ítems de `todowrite`
     directamente hacia `contextbase/tasklist.md`.
   - **Cierre automático de turno (`session.idle` y `stop`):** Cuando el agente termina de
     responder tras haber modificado archivos, ejecuta `hook-run session-stop` para actualizar
     `contextbase/changelog.md`, `contextbase/fundamentos.md`, `contextbase/tasklist.md` y
     `contextbase/strands/` automáticamente.
3. **Hooks nativos para Claude Code (`.claude/settings.json`):**
   - Configura `SessionStart` (`hook-run session-start`), `PostToolUse` (`hook-run post-tool`)
     y `Stop` (`hook-run session-stop`), logrando el mismo ciclo automático en Claude Code.
4. **Servidor MCP enriquecido con instrucciones vivas, Resources, Prompts y Watcher (`src/mcp.js`):**
   - Al recibir `initialize`, devuelve dentro de `result.instructions` el digest vivo del
     proyecto junto con la directiva automática para el modelo.
   - Expone `resources/list` y `resources/read` (`contextbase://digest`, `contextbase://state`,
     `contextbase://fundamentos`, `contextbase://changelog`, `contextbase://tasklist`,
     `contextbase://componentes`, `contextbase://strands/context`) y `prompts/list` / `prompts/get`.
   - Mantiene activo `startWatcher` durante toda la vida de la conexión MCP.
5. **Observador en tiempo real y Hooks Git (`src/watcher.js` y `src/hooks.js`):**
   - `syncWorkspaceChanges` detecta archivos modificados en el árbol de trabajo, consolida la
     entrada `[auto]` del día en `changelog.md`, extrae nuevos `TODO`/`FIXME` hacia `tasklist.md`,
     actualiza `fundamentos.md`, regenera `componentes.md` si cambió algún manifiesto y refresca
     `contextbase/strands/`.
   - Los hooks Git `post-commit`, `post-merge` y `post-checkout` se instalan automáticamente
     cuando existe `.git/`.

## 3. Archivos que crea y mantiene

- `contextbase/fundamentos.md`: objetivo, reglas de desarrollo, arquitectura y bloque técnico sincronizado.
- `contextbase/changelog.md`: bitácora con fecha y rotación automática a `changelog-AAAA.md`.
- `contextbase/tasklist.md`: tareas pendientes `[ ]` y completadas `[x]`.
- `contextbase/componentes.md`: inventario de componentes, frescura de versiones y brechas de seguridad.
- `contextbase/baseline.json`: hashes SHA-256 y fechas de modificación de los archivos protegidos.
- `contextbase/strands/`: contexto Python (`context.json`, `project_context.py`, `strands_config.py`, `tasks.py`, `strands_runner.py`, `README.md`).
- `opencode.json` y `.opencode/plugins/contextbase-auto.js`: configuración MCP, permisos y plugin automático para OpenCode.
- `kilo.json`, `.kilo/rules/contextbase.md` y `.kilo/plugins/contextbase-auto.js`: configuración MCP, permisos, reglas y plugin automático para Kilo Code.
- `.mcp.json`: configuración MCP estándar para Claude Code y clientes compatibles.

## 4. Comandos de automatización y diagnóstico

- `contextbase auto` (o `contextbase setup`): repara o instala toda la configuración automática local y global (`--global`), y opcionalmente lanza el demonio observador (`--watch`).
- `contextbase watch [start|stop|status]`: gestiona el demonio observador en segundo plano.
- `contextbase hook-run <session-start|post-tool|session-stop|post-commit>`: endpoint invocado automáticamente por los plugins y hooks.
- `contextbase status --check`: devuelve código 1 ante brechas `critical`/`high`, informe vencido, reglas desactualizadas o deriva del guardia.