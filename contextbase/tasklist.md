# Lista de Tareas Visual (Tasklist)

Seguimiento del estado de tareas con alto contraste visual.

---

## Tareas Completadas
- [x] QA en vivo completa y remediación: suite 112/112 en verde, termina sola en ~13 s
- [x] Fix del colgado de `node --test`: timeouts en agente/git, deps propagadas, guard NODE_TEST_CONTEXT
- [x] Contrato no-pisado de config global/proyecto (backup .bak-contextbase, fusión JSONC quirúrgica con precedencia .jsonc)
- [x] Convención de exit codes 0/1/2 en toda la CLI (+ tests qa-hardening y terminals)
- [x] `snapshot list` y `snapshot restore` cableados en el CLI; `export` validado; MCP -32602 con JSON corrupto; `slop` excluye archivos generados
- [x] Nuevo comando `terminals list|close|send` (src/terminals.js) para identificar y gestionar terminales de agente abiertas del proyecto
- [x] Plugin compatible con OpenCode v2: default export `{ id, server, setup }` (cierra y supera el PR #2), sin `spawn` sin handler de error, aislamiento de hilo a prueba de `..` y mayusculas, digest estable en array/string/undefined
- [x] MCP robusto: stdout de las tools capturado (no contamina JSON-RPC), guard de doble instancia y pruebas de reconexion (test/resilience.test.js)
- [x] Autogestión: cierre automático de terminales de workers terminados (`terminals auto` + hooks + `web collect`) y gestión autónoma del SDK de Strands (instalación automática en segundo plano, registro en `contextbase/strands/sdk.json`, runner con modo degradado sin traza)
- [x] v1.5.0: Autoconfiguración real de agentes (`src/autoconfig.js`) para OpenCode (`opencode.json`), Kilo Code (`kilo.json`), Claude Code (`.mcp.json` y `.claude/settings.json`), Cursor y Windsurf con permisos `contextbase_*` preaprobados
- [x] v1.5.0: Plugin nativo automático `contextbase-auto.js` (`.opencode/plugins/` y `.kilo/plugins/`) con inyección de digest en `experimental.chat.system.transform`, captura de ediciones en `tool.execute.after` (incluyendo `todowrite`) y cierre automático en `session.idle`
- [x] v1.5.0: Observador en tiempo real y demonio en segundo plano (`src/watcher.js`, `contextbase watch`) que sincroniza `fundamentos.md`, `changelog.md`, `tasklist.md`, `componentes.md` y `strands/`
- [x] v1.5.0: Servidor MCP mejorado con cola secuencial FIFO, digest vivo en `initialize.result.instructions`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get` y watcher integrado
- [x] v1.5.0: Soporte de `kilo` en swarm (`src/swarm-agents.js`), lectura JSONC y rutas completas en `src/detect.js`, e instalación universal de skills en `src/installer.js` + `postinstall`
- [x] Salida de Strands silenciosa por defecto (`CONTEXTBASE_VERBOSE=1` para diagnostico), sin NativeCommandError en PowerShell
- [x] v1.4.0: version de exportacion derivada de package.json (OWN_VERSION) y conteo exacto de 24 tools en la prueba MCP
- [x] v1.4.0: `kilo.json` con permisos aprobados de una sola vez y MCP `contextbase`
- [x] v1.4.0: `refreshBaseline` actualiza la línea base tras la inyección legítima de reglas en `init`, `sync` y `silentInit`
- [x] v1.4.0: documentación completa de funcionamiento en `docs/FUNCIONAMIENTO.md`
- [x] Pruebas de tareas y Strands actualizadas al comportamiento automático
- [x] Integración Strands Python: `contextbase/strands/` con `context.json`, `project_context.py`, `strands_config.py`, `tasks.py`, `strands_runner.py` y `README.md`
- [x] `strands_runner.py` listo para Strands con escalado solo por critical/high o deriva del guardia
- [x] Automatización autónoma en `src/auto.js` (`autoEnsure`, `refreshStrands`, `refreshComponents`, `silentInit`)
- [x] `init`, `log`, `task`, `sync` y `audit` regeneran el contexto Strands sin comandos nuevos
- [x] MCP completo: `contextbase_export`, `contextbase_strands_prepare`, `contextbase_init` y `contextbase_hook`
- [x] Exportación JSON/HTML (`src/export.js` y `contextbase export`)
- [x] Fix `guard repair source`
- [x] Fix `parseSecurity`
- [x] Baseline limpiado y conflicto de changelog resuelto
- [x] Pruebas MCP actualizadas al total de tools vigente
- [x] Swarm real: worktree + rama + sesion por worker, status con stale, send/collect/stop
- [x] Superficie CLI y 5 tools MCP de swarm
- [x] Release 1.3.2: npm pack subido como contextbase.tgz a GitHub Releases
- [x] Full GitHub: workflows CI y Release con npm pack adjunto (contextbase.tgz)
- [x] Mision de orquestacion/testing integrada (CLI mission + MCP contextbase_mission + link global)
- [x] v1.3.1: campo `author` corregido en `package.json` y `.mailmap` agregado para normalizar autores de commit
- [x] v1.3.1: release de GitHub con asset estable `contextbase.tgz` y README con la nueva via de instalacion
- [x] npm descartado como canal de distribucion (cuenta `datersx` suspendida, nombre del paquete fuera de nuestro control)
- [x] Commit y push del repo ContextBase 1.3.0 a GitHub (REGT-URRED/CONTEXTBASE)
- [x] Creación de carpeta de memoria persistente `contextbase/`
- [x] Generación de documento estructurado `fundamentos.md`
- [x] Creación de bitácora histórica `changelog.md`
- [x] Configuración de lista de tareas visual de alto contraste `tasklist.md`
- [x] Inyección de directivas y reglas críticas para agentes de código (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`)
- [x] Escaneo y análisis retroactivo de los archivos del proyecto (`contextbase`)
- [x] Eliminación de complejidad y código legado de OpenWiki (conversión a Node.js ESM Zero-Dependencies)
- [x] Implementación del motor de escaneo y empaquetado estilo Repomix integrado (`scanner.js`)
- [x] Implementación del router CLI y subcomandos (`init`, `status`, `task`, `log`, `pack`, `dump`, `install-skill`, `ensure`)
- [x] Incorporación de auto-creación preventiva (ensureContextBase) ante ausencia o daño de `contextbase/`
- [x] Creación e instalación global de la Skill para agentes en `~/.gemini/config/skills/contextbase`
- [x] Enlace global del sistema mediante `npm link` (`contextbase`, `cb`, `openwiki`)
- [x] Elaboración de documentación integral en español (`README.md`)
- [x] Eliminación de emojis en `README.md` para presentación sobria
- [x] Reinicialización limpia de Git bajo autoría exclusiva de REGT-URRED
- [x] Publicación inicial en GitHub (https://github.com/REGT-URRED/CONTEXTBASE.git)
- [x] Mantenimiento preventivo automático: inventario de componentes y verificación de brechas (`src/maintenance.js`, `contextbase audit`, `contextbase/componentes.md`)
- [x] Regla de mantenimiento preventivo integrada en bloques de agente, generador y Skill global
- [x] Corrección del subcomando `contextbase task done` (variables sin declarar)
- [x] Aviso automático en `status` cuando el informe de componentes falta o supera 7 días
- [x] Integración nativa: servidor MCP, `status --json`/`--check`, digest `context`, `sync` idempotente, hook `post-commit`
- [x] Escritura atómica con bloqueo y rotación de bitácora
- [x] Redacción de secretos en `pack` y exclusión de archivos `.env`
- [x] Verificadores Rust (`cargo audit`) y Go (`govulncheck`) en el mantenimiento preventivo
- [x] Suite de 20 pruebas con `node:test`
- [x] README orientado a npm (instalacion desde registro, quickstart, comandos, MCP, seguridad)
- [x] v1.3.0: integracion de thermos en `src/review.js` + `src/prompts/review-security.md` y `review-quality.md` con modos prepare/prompts/merge
- [x] v1.3.0: comandos CLI `review`, `review prompts`, `review merge` y `--intent`
- [x] v1.3.0: `src/redundancy.js` y comando `redundancy` (skills duplicados, refs rotas, bloques AGENTS.md, MCP repetidos)
- [x] v1.3.0: `src/slop.js` y comando `slop` como delivery gate antislop sobre el diff
- [x] v1.3.0: tools MCP `contextbase_review`, `contextbase_redundancy`, `contextbase_slop` (14 tools total)
- [x] Verificados `review`, `slop`, `redundancy` y `review merge` en repo git real y en los cuatro casos de error
- [x] Corregida similitud de fusion en `merge`: coeficiente de solapamiento sobre el conjunto menor, umbral 0.40 y minimo 2 terminos compartidos
- [x] Pruebas de los tres modulos nuevos: `test/review.test.js`, `test/slop.test.js`, `test/redundancy.test.js`
- [x] Suite completa en verde: 81 casos, 81 aprobados, 0 fallidos
- [x] `review` y `slop` cubren el arbol de trabajo y los archivos sin seguimiento
- [x] Codigos de salida: `slop` devuelve 1 con hallazgos y 0 sin hallazgos; `review merge` falla con exit 1 fuera de dos reportes
- [x] `redundancy` informa familias principales y escanea `node_modules`, `plugins` y npm global
- [x] Skill global sincronizada en `~/.config/opencode` y `~/.gemini`
- [x] Exportaciones namespaced en `src/index.js`
- [x] `.atl/` agregado a `.gitignore`
- [x] Exportacion namespace exp agregada en src/index.js
- [x] `bin/contextbase.js` con bit ejecutable `100755`
---

- [x] [2026-11-13] Residuo home/opencode.json: corregido (guard de home; el home ya no se inicializa como proyecto)
## Tareas Pendientes / En Progreso
- [x] Tool MCP `contextbase_terminals` (list/close/send) integrado y testeado; soporte send nativo: opencode verificado, kilo verificado (v7.8.27, `kilo run --session`); agentes sin sesión nativa (claude/codex, CLIs no instalados) cubiertos por launcher universal `--universal`; inyección de teclas en TUI no soportada por diseño

- [x] `strands_runner.py` verificado: py_compile OK y ejecución completa en modo seco (imprime contexto y tareas; salto humano solo por critical/high o deriva del guardia). Capa SDK requiere `pip install strands-agents` (decisión del usuario)
- [x] Contrato de `claude` y `codex` en swarm: sin contrato nativo verificable en esta máquina (CLIs no instalados); resolución efectiva: launcher universal verificado (`contextbase web start --universal`, 13+ agentes) + `nativeSendSpec('Claude Code') === null` testeado
- [x] Inyección en sesión con TUI abierta simultánea: resuelta por diseño con `contextbase terminals` (CLI) + `contextbase_terminals` (MCP): list/close/send sin inyectar teclas; opencode y kilo entregan por `run --session`; TUI pura queda fuera por seguridad
- [x] Distribución npm descartada definitivamente (GitHub Releases con asset `contextbase.tgz`; ver 2026-10-29); no es un pendiente real

---
*Regla: Marcar con `[x]` las tareas completadas y agregar con `[ ]` cualquier nuevo requerimiento técnico.*
