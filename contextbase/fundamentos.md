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
- **Autoconfiguración de Agentes:** `src/autoconfig.js` detecta los agentes presentes (OpenCode, Kilo Code, Claude Code, Cursor, Windsurf) y escribe en su configuración existente lo mínimo necesario: servidor MCP, permisos preaprobados `contextbase_*`, plugin nativo y reglas. Nunca pisa contenido del usuario y respeta la precedencia `.jsonc`.

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
- `src/fsutil.js`: Escritura atómica (`writeAtomic`, temporal + rename, sin `.tmp` huérfano), errores tipados `cbError`/`emitCbError` (`[ContextBase Error] <CODE> | <op> | <path> | <detalle>`) y bloqueo asesor por archivo con token de propiedad (`withLock` + `isLockOwnerAlive`: un lock con dueño vivo no se roba).
- `src/hooks.js`: Hooks Git (`post-commit`, `post-merge`, `post-checkout`) y ejecutor de eventos de ciclo de vida (`runLifecycleHook`).
- `src/mcp.js`: Servidor MCP sobre stdio con cola secuencial FIFO, instrucciones vivas, 7 resources, 2 prompts, 26 tools (incluye `contextbase_terminals` y `contextbase_egm_review`) y watcher activo.
- `src/bootstrap.js`: Recomendación y ejecución del arranque de un proyecto (`preview`, `run`).
- `src/cli_extra.js`: Subcomandos extendidos del CLI (`swarm`, `bootstrap`, `guard`, `snapshot`, `restore`, `tools`, `mission`, `egm`, `sandbox`).
- `src/detect.js`: Detección de CLIs instalados, binarios en `PATH` y lectura JSON/JSONC de configuraciones MCP.
- `src/export.js`: Exportación del estado o digest en JSON y HTML.
- `src/guard.js`: Protección de archivos sensibles con línea base, hash, escaneo de cambios sospechosos y refresco controlado de la línea base (`refreshBaseline`). El hash ignora el fin de línea (CRLF -> LF); un baseline con hash crudo se migra una sola vez al hash normalizado sin reportar deriva falsa.
- `src/registry.js`: Registro de herramientas del proyecto y su estado habilitado.
- `src/redundancy.js`: Detección de redundancia global (skills duplicados, referencias rotas, bloques `AGENTS.md` y MCP repetidos).
- `src/review.js`: Revisión tipo thermos: diff, contenidos, prompts de revisor y fusión de reportes.
- `src/slop.js`: Delivery gate antislop sobre el árbol de trabajo, con reglas de prosa y código por separado.
- `src/snapshot.js`: Creación, listado, poda y restauración de snapshots del registro.
- `src/egm.js`: Modelo de calidad EGM (Elephant-Goldfish): 10 personas, 5 estándares y 7 skills; revisión adversarial determinista (PASS/REFIX/RERUN/FAIL), convergencia por rondas limpias, detección de drift doc-código y comparación real contra una referencia git. `egmPulse` es el pulso que corre en el heartbeat y persiste el veredicto en `contextbase/egm/verdict.json`.
- `src/sandbox.js`: Sandbox de contingencia: copia aislada del proyecto para ejecutar operaciones delicadas (`run`), detectar cambios (`list`), promoverlos (`apply`) o descartarlos (`rm`). Helpers de contención `isValidId`, `requireId`, `isInside` y `resolveInside`: toda ruta resuelta fuera del proyecto lanza `CB_PATH_ESCAPE` con ruta y operación. `apply` planifica y respalda antes de escribir y, si un archivo falla a mitad, revierte todo y lanza `CB_SANDBOX_APPLY`.
- `src/strands.js`: Contexto Python para Strands (`contextbase/strands/`), configuración, tareas y `strands_runner.py` con escalado humano.
- `src/swarm.js` y `src/swarm-agents.js`: Orquestación de enjambre por worktrees para `opencode` y `kilo`. El estado se valida antes de usarse (`validateState`/`loadStateFile`): un `state.json` corrupto lanza `CB_STATE_CORRUPT` sin filtrar el mensaje del parser; la escritura es atómica y cada ruta derivada pasa por `workerPath` con contención.
- `src/prompts/`: Prompts de revisor `review-security.md`, `review-quality.md` y `mission-orchestration.md`.
- `test/`: Suite de 270 pruebas con el runner nativo `node:test` (sin dependencias), incluyendo `test/qa-hardening.test.js`, `test/terminals.test.js` y los cinco archivos de hardening: `hardening-containment` (10), `hardening-cli-mcp` (17), `hardening-observability` (7), `autoconfig-backup-exclude` (10) y `egm-calibration` (8).
- `src/env.js`: Criterio único `isTestEnv()`/`realAgentsAllowed()` (guard NODE_TEST_CONTEXT) para que ninguna ruta lance agentes reales bajo `node --test`.
- `src/jsonc.js`: Fusión quirúrgica sobre JSONC (parse con posición de miembros, `setJsoncPath`, `appendJsoncArray`, `parseJsonc`) preservando comentarios.
- `src/terminals.js`: Identificación de terminales/procesos de agente abiertos para el proyecto, cierre protegido (dry-run + `--yes`, nunca el propio árbol) y envío por contrato nativo (`opencode run --session` / `kilo run --session`). Tool MCP `contextbase_terminals` (list/close/send; close por defecto es dry-run, `confirm=true` ejecuta).
- `skills/contextbase/SKILL.md`: Definición formal de la Skill para agentes de IA.
- `docs/FUNCIONAMIENTO.md`: Documentación funcional completa del flujo automático, plugins, hooks, watcher, MCP, Strands y swarm.

### Contratos del Sistema (2026-11-11)
- **Códigos de salida:** `0` éxito, `1` error de ejecución, `2` error de uso (subcomando/flag/argumento inválido).
- **Configuración de usuario (global y proyecto):** un archivo existente que no parsea NUNCA se sobrescribe; se deja backup `.bak-contextbase` y se reporta con `[ContextBase Error] code=CONFIG_INVALID_JSON`. Los `.jsonc` existentes (Kilo/OpenCode) se fusionan quirúrgicamente preservando comentarios, con precedencia sobre el `.json`.
- **Plugin de agentes:** el default export debe ser un objeto con `id` y una función. El contrato que Activa correctamente en OpenCode v2 es `{ id, server, setup }` (la API Promise registra los hooks por `ctx`). `effect` está PROHIBIDO: el runtime lo prefiere sobre `setup` (`"effect" in r ? r : due(r)`) y la activación queda colgada esperando hooks de `ctx`. `validateOpenCodePluginSource()` exige `id` + `setup` y rechaza `effect`; el generador se autovalida antes de escribir, así que un plugin inválido nunca llega a disco. La factory v1 se conserva como named export. Todo `spawn` lleva listener de `error` (un ENOENT/EINVAL abortaba el host) y nunca se invoca un binario inexistente.
- **Plugin (uno por host):** el host lee plugins desde `<proyecto>/.opencode/plugins`, `~/.config/opencode/plugins`, `~/.opencode/plugins` y `~/.opencode/plugin`. Dos copias con el mismo `id` producen `Duplicate plugin ID` y una entrada `failed, local` en la lista del host. Con plugin global válido no se escribe copia en el proyecto y se elimina la existente; `installSkill` deja el home legacy sin plugins. `hasStaleAgentConfig` acepta el global como equivalente.
- **No pisado del usuario:** ninguna configuración de agente sobrescribe contenido ajeno. Los JSON se fusionan clave por clave (respaldando antes) y los archivos de reglas usan un bloque marcado; el archivo existente del usuario manda.
- **Precedencia de configuración:** si el proyecto ya usa `opencode.jsonc` o `kilo.jsonc`, ContextBase escribe y fusiona ahí; nunca crea un `.json` paralelo que eclipse al del usuario.
- **Esquema del host:** la fusion del config se adapta al esquema instalado (v1: `plugin`/`permission`/`mcp.<n>`; v2: `plugins`/`permissions`/`mcp.servers`) y es idempotente: si no hay cambios reales no se reescribe el archivo (reescribirlo dispara la recarga del host y el churn).
- **Directorio personal:** el home no es un proyecto. Ninguna ruta (`init`, `auto`, `status`, `log`, `sync`) deja scaffolding en la raíz del directorio personal.
- **Sandbox (plan de contingencia):** una operación delicada se ejecuta sobre una copia aislada (`contextbase sandbox run`), se listan los cambios y solo se promote al proyecto real con `contextbase sandbox apply`. `auto` e `init` aceptan `--sandbox` para ese modo.
- **EGM (calidad):** el modelo corre en el heartbeat (`autoEnsure` -> `egmPulse`), el veredicto vive en `contextbase/egm/verdict.json`, aparece en el digest vivo con una accion concreta y la skill `contextbase-egm` enseña el bucle revisión -> corrección -> PASS. `contextbase egm review|drift|personas|standards|skills` es determinista y sin modelos. Un directorio de documentación inexistente se reporta como `missingDocs`, nunca como "sin drift"; un objetivo que no es Markdown puede alcanzar PASS con los revisores aplicables en `skipped`.
- **MCP:** ninguna tool puede escribir en stdout durante una llamada (el stream JSON-RPC se corrompe); la salida se captura y viaja en el contenido de la respuesta. Un servidor MCP es un proceso por cliente: reconectar significa un proceso nuevo, y el anterior debe salir con codigo 0.
- **Guard de pruebas:** toda ruta que pueda lanzar procesos de agente (swarm/web/auto/hooks/watcher) está inerte bajo `NODE_TEST_CONTEXT`; `node --test` debe terminar solo y en segundos.
- **Autogestión (sin intervención manual):** ContextBase cierra automáticamente las terminales de sus propios workers cuando el trabajo terminó (`done`; `stale` solo con `--include-stale`), registra el SDK de Strands en `contextbase/strands/sdk.json` y lo instala en segundo plano si falta (`CONTEXTBASE_STRANDS_AUTOINSTALL=0` lo desactiva). El runner `strands_runner.py` degrada sin traza: modo seco sin SDK (salida 0) y modo degradado sin credenciales de proveedor (salida 3).
- **Control de terminales:** `terminals list` (solo lectura), `terminals close <pid...|all> [--yes] [--force]` (dry-run por defecto, nunca cierra el árbol propio ni procesos no identificados como agentes), `terminals send <pid> --message "..."` (por contrato nativo; no se inyectan teclas en TUIs ajenas).
- **Formato de error único:** toda falla accionable se emite como `[ContextBase Error] <CODE> | <op> | <path> | <detalle>`; el código de uso es `CB_USAGE`. Un valor de flag inválido se valida antes de cualquier efecto secundario.

### Hardening (2026-11-13)
- **Contención de rutas:** `sandbox.js` expone `isValidId`, `requireId`, `isInside` y `resolveInside`; toda ruta resuelta fuera del área permitida lanza `CB_PATH_ESCAPE` con operación y ruta. `swarm.js`, `web.js`, `guard.js` y `snapshot.js` importan esos helpers.
- **Integridad de estado:** `state.json` corrupto lanza `CB_STATE_CORRUPT` (sin filtrar el mensaje del parser); la escritura es atómica (`writeAtomic`, sin `.tmp` huérfano) y los locks usan token de propiedad (`withLock` + `isLockOwnerAlive`: no se roba un lock con dueño vivo).
- **Sandbox atómico:** `applySandbox` planifica y respalda antes de escribir; si un archivo falla a mitad, revierte todo lo aplicado y lanza `CB_SANDBOX_APPLY`. Id inválido, sandbox ausente o rechazos se informan en el resultado y el CLI sale con 1.
- **MCP robusto:** `installStdoutGuard` desvía a stderr cualquier escritura ajena al descriptor original; `params.arguments` no-objeto y `params.name` desconocido responden `-32602`; EPIPE sale con 0; SIGTERM/SIGINT apagan limpio; cerrar stdin drena las respuestas en vuelo sin truncarlas.
- **Doctor:** verifica `EXPECTED_MCP_TOOLS` = 26 y que el config global v2 no contenga claves v1 que el host descarta en silencio (`prompt`, `permission`, `variant`); un stdout no JSON-RPC falla el handshake con `stdout contaminado`.
- **EGM calibrado:** `advisory` no cuenta para el veredicto; la distinción mención/afirmación y el tipo de documento evitan falsos blockers sin ablandar el modelo (una afirmación falsa sigue dando blocker + FAIL).

---

<!-- CONTEXTBASE:SYNC:START -->
## Contexto Técnico Sincronizado (auto)
> Generado por `contextbase sync`. No editar dentro de este bloque: se reemplaza completo.
- **Versión:** 1.5.0
- **Ecosistema:** Node.js / JavaScript / TypeScript
- **Frameworks:** Librerías estándar / Vanilla
- **Lenguajes dominantes:** JavaScript (87), Markdown (17), JSON (3)
- **Dependencias:** Sin dependencias externas registradas.
- **Scripts:** start, postinstall, auto, watch, test, audit, mcp, pack:release, test:ci, release:github
- **Directorios raíz:** bin, contextbase, docs, scripts, skills, src, test
<!-- CONTEXTBASE:SYNC:END -->

---
*Generado y consolidado por ContextBase CLI el 11/11/2026.*
