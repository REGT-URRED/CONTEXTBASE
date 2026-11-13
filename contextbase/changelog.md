# Bitácora Histórica del Proyecto (Changelog)

Registro metódico del progreso técnico, decisiones de arquitectura y evolución del sistema.

---

## Cambios Realizados
- [2026-11-13] Sesion completa: EGM vivo (pulso + digest + skill), sandbox de contingencia, auditoria de bugs ocultos resuelta, fusion de config adaptada al esquema v2 e idempotente
- [2026-11-13] [commit] 7efe70a feat(egm,sandbox): live EGM pulse, contingency sandbox and host-schema-aware config merge
- [2026-11-13] [egm-vivo] El modelo EGM deja de ser un comando manual: `egmPulse` (`src/egm.js`) revisa el documento vivo y la deriva doc-codigo, `autoEnsure` lo dispara en el heartbeat (`egmPulsed`), el veredicto se persiste en `contextbase/egm/verdict.json` y aparece en el digest vivo con una accion concreta; ademas se instala la skill `contextbase-egm` (patron skill + MCP + evidencia, tomado de morluto/rea) para que el agente aplique el bucle revision -> correccion -> PASS sin depender de que alguien recuerde el comando
- [2026-11-13] [opencode] Fusion del config adaptada al esquema del host: ContextBase ya NO inyecta claves legacy (`plugin`, `permission`, `mcp.<nombre>`) en un config v2 (`plugins`, `permissions`, `mcp.servers`); ademas la fusion es idempotente (si no hay cambios reales no se reescribe el archivo, evitando la recarga del host y el churn). Verificado contra una copia del config real: 0 claves legacy, 24 agentes y 14 servidores MCP intactos, segunda pasada sin tocar el archivo
- [2026-11-13] [skills] `installSkill` instala TODAS las skills presentes en `skills/` (antes solo `contextbase`), de modo que cada skill nueva llega a OpenCode, Kilo, Gemini, Claude y al workspace
- [2026-11-13] prueba
- [2026-11-13] [plugin] Contrato de OpenCode v2 verificado contra el binario instalado: el default export debe ser un objeto con `id` y una funcion. El contrato que ACTIVA correctamente es `{ id, server, setup }`; `effect` queda PROHIBIDO porque el runtime lo prefiere sobre `setup` (`"effect" in r ? r : due(r)`) y la activacion termina colgada esperando hooks de ctx. `validateOpenCodePluginSource()` exige `id` + `setup` y rechaza `effect`; el generador se autovalida, asi que un plugin invalido nunca se escribe a disco. Cubierto por `test/plugin-contract.test.js` (incluye la regresion: un bloque con `effect` es rechazado)
- [2026-11-13] [sandbox] El sandbox pasa a ser plan de contingencia de primera clase: `src/sandbox.js` (create/run/list/apply/rm), comando `contextbase sandbox run|list|apply|rm` y bandera `--sandbox` en `auto` e `init` para ejecutar una operacion delicada sobre una copia aislada sin tocar el proyecto real
- [2026-11-13] [egm] Modelo EGM endurecido: la libreria deja de reportar "limpio" cuando falta el directorio de docs, toleran findings nulos en convergencia, deja de marcar fragmentos de codigo como valores hardcodeados, reconoce referencias con separador Windows, declara sus 10 personas (una manual) y permite PASS sobre objetivos que no son markdown, `--base` ahora es una comparacion real contra git, `maxRounds` converge de verdad y el orden de severidad y `reabre` se respetan
- [2026-11-13] [egm-cli] Superficie CLI de EGM corregida: el listado de drift ya no imprime `undefined`, `egm` sin subcomando y `egm --help` devuelven error de uso (2), los flags con espacio (`--target docs/x.md`) se parsean y `egm` aparece en `contextbase --help`
- [2026-11-13] [auditoria] Auditoria de bugs ocultos (147/147 verde no los cubria): `src/universal-agents.js` pisaba archivos del usuario enteros (ahora fusiona y respalda), la configuracion de proyecto ignoraba la precedencia `.jsonc` (ya no crea un `opencode.json`/`kilo.json` paralelo), `contextbase_hook` colgaba el servidor MCP leyendo stdin (ahora el proceso MCP no lee stdin), el guard del directorio personal cubria solo dos rutas (ahora cubre tambien `status`/`log`/`sync`), `hook remove` ya no borra hooks ajenos y el proceso MCP ya no hereda el exit code de un error de uso
- [2026-11-13] [mcp] Tool `contextbase_egm_review` registrada en TOOLS (26 tools; antes callable pero no listada, por un fallo silencioso de parcheo). Verificada: el servidor reporta 26 tools en initialize y tools/list
- [2026-11-13] [residuo-home] ContextBase ya NO inicializa el directorio personal como proyecto: `autoConfigureProject`/`autoEnsure` devuelven `skipped: 'home-directory'` sin crear `opencode.json`, `kilo.json`, `.mcp.json` ni `contextbase/` en `$env:USERPROFILE` (era el residuo con schema de Kilo que OpenCode normalizaba; verificado en sandbox home fresco: raiz vacia, solo se crean los globales `.config`/`.agents`)
- [2026-11-13] [qa] `node --test test/*.test.js` (26 tools, 129 casos) corrige el aislamiento de `qa-autoconfig` (proyecto != home) y el conteo de tools del MCP
- [2026-11-13] Motor EGM (Elephant-Goldfish) como motor determinista de revision: nuevos src/egm.js y test/egm.test.js. Exporta EGM_PERSONAS (10), EGM_ESTANDARES (5), EGM_SKILLS (7), EGM_SEVERIDADES (blocker/major/nit), EGM_RESOLUCIONES (contest/escalate/propose_fix/decline), egmReview, egmConvergence, egmDrift y egmReport. Sin dependencias, todo offline y determinista. Suite propia en verde: 18 tests.
- [2026-11-13] [commit] 4298b3e fix: plugin compatible con OpenCode v2 + robustez MCP (reconexion y stdout)
- [2026-11-12] [fix] OpenCode v2 (2.2.7) rechazaba el plugin automatico: el default export era una funcion pelada y el loader exige un objeto con `id` y `setup`/`effect`, por lo que el plugin se descartaba en silencio (sin digest, sin aislamiento de hilo, sin auto-sync). `buildOpenCodePluginSource()` ahora exporta `{ id, server, setup }` manteniendo la factory v1 como named export; ademas el instalador deja de registrar la ruta de un archivo en `plugin[]` porque v2 autoscanea `plugin/` y `plugins/` y exige directorios. Verificado en vivo: el plugin global instalado ya expone el shape v2. Cierra y supera el PR #2
- [2026-11-12] [fix] Tres `spawn` sin listener de `error` (plugin, watcher y swarm) abortaban el proceso host con ENOENT/EINVAL: ahora el error se captura y el proceso sigue. El binario de ContextBase ausente ya no se inventa (`resolveCbCommand` devuelve null y los hooks salen limpios)
- [2026-11-12] [fix] Aislamiento de hilo evadible: `src/../src/x.js` y las mayusculas (Windows) esquivaban el bloqueo de archivos prohibidos; ahora se comparan rutas resueltas y normalizadas. Ademas el regex de normalizacion de separadores estaba mal escapado (`/\\\\/g` en vez de `/\\/g`)
- [2026-11-12] [fix] El digest del plugin se quedaba congelado cuando `output.system` era string, se perdia el resto del prompt cuando el marcador vivia dentro de un elemento del array, y faltaba por completo si `output.system` era undefined
- [2026-11-12] [fix] El watcher registraba en el changelog rutas fuera del proyecto (absolutas o con `..`) y duplicaba la entrada `[auto]` cuando caia fuera de las 20 primeras lineas; el dedupe de `task-add` descartaba tareas nuevas por coincidencia de subcadena
- [2026-11-12] [fix] MCP: las tools que imprimen en stdout (audit, init, swarm_start) contaminaban el stream JSON-RPC; ahora su salida se captura y viaja dentro del contenido de la respuesta. Se anade guard contra dos instancias de readline sobre el mismo stdin y pruebas de regresion de reconexion (dos servidores seguidos, ambos responden y el primero sale con codigo 0)
- [2026-11-12] [qa] El runner de pruebas queda acotado a `test/*.test.js` (los tests de paquetes externos vendorizados ya no rompen la suite) y los backups `*.bak-contextbase` y el paquete de referencia EGM quedan fuera del repo. Suite: 128/128 verde y auto-terminable
- [2026-11-13] [auto] Sincronización automática de archivos modificados: skills/contextbase-egm/SKILL.md, src/sandbox.js, skills/contextbase-egm, skills, test/egm-live.test.js, src (+25)
- [2026-11-11] [auto] Autogestión completa: (1) ContextBase cierra solo las terminales de sus workers terminados (`terminals auto` + automático en hooks de sesión y en `web collect`; nunca toca el árbol protegido ni terminales ajenas); (2) gestión autónoma del SDK de Strands (`contextbase strands sdk --status|--install|--auto`, instalación automática en segundo plano al preparar el contexto, registro en `contextbase/strands/sdk.json`, desactivable con CONTEXTBASE_STRANDS_AUTOINSTALL=0); (3) `strands_runner.py` degrada sin traza: modo seco sin SDK (salida 0) y modo degradado sin credenciales de proveedor (salida 3) con modelo configurable por CONTEXTBASE_STRANDS_MODEL. SDK instalado y verificado en vivo: strands-agents 1.64.0
- [2026-11-11] Push a GitHub completado: commit aa50217 en main de REGT-URRED/CONTEXTBASE, autor y committer REGT-URRED <U19211826@utp.edu.pe>; suite 121/121 verde antes del push
- [2026-11-11] [fix] `spawn` del instalador del SDK ahora maneja el evento `error` (un interprete de Python ausente ya no aborta el proceso) y la deteccion de version usa importlib.metadata
- [2026-11-11] [mcp] Nueva tool `contextbase_terminals` (list/close/send) que expone el control de terminales de agente; close es dry-run por defecto y confirm=true ejecuta (nunca cierra el árbol propio ni procesos no identificados). Suite MCP: 25 tools
- [2026-11-11] Sin saltos pendientes: postinstall aislado verificado en HOME sandbox (setup --global --silent, exit 0; kilo.json corrupto NO se pisa: backup + salida 1; kilo.jsonc con comentarios fusionado in situ, comentarios preservados, sin crear kilo.json); contrato nativo de Kilo verificado (kilo run --session <id> --format json, v7.8.27); strands_runner.py verificado ejecutando en modo seco (rc OK sin SDK; capa SDK exige `pip install strands-agents`); inyección en TUI resuelta por diseño vía `terminals send` + `contextbase_terminals`
- [2026-11-11] [contract] Capacidades nativas declaradas y testeadas en `src/terminals.js`: nativo OpenCode (`opencode run --session`) y Kilo (`kilo run --session`); claude/codex sin contrato de sesión verificado en esta máquina (CLIs no instalados) y cubiertos por el launcher universal (`contextbase web start --universal`)
- [2026-11-11] Push a GitHub completado: commit ea6d819 en main de REGT-URRED/CONTEXTBASE, autor y committer REGT-URRED <U19211826@utp.edu.pe>; suite 114/114 verde antes del push
- [2026-11-11] [qa] Remediación completa tras auditoría de QA en vivo (Happy/Unhappy/Hipotético): fix del colgado de `node --test` (timeout 120 s/30 s en runAgent/git, propagación de deps, guard NODE_TEST_CONTEXT y unref del timer MCP); contrato no-pisado de configuración (backup .bak-contextbase, fusión quirúrgica JSONC con precedencia jsonc: global Kilo/OpenCode y proyecto); convención de exit codes 0/1/2 (subcomando/flag inválido->2, ejecución->1); `snapshot list` cableado (ya no crea snapshots) y `snapshot restore` enruta a restore; `export` valida tipo/formato e interpreta flags; MCP resources/read devuelve -32602 con JSON corrupto (nunca contenido corrupto); `log` sanea multilínea; `slop` excluye archivos generados por contextbase; `web ... --json` responde JSON ({empty:true} sin runs, exit 0); contador único de tareas compartido; nuevo módulo `src/terminals.js` + comando `terminals list|close|send` (identifica terminales de agente abiertas para el proyecto, close es dry-run con --yes y nunca cierra el árbol propio, send por contrato nativo opencode run --session); módulos nuevos `src/env.js` y `src/jsonc.js`; suite 81->112 casos, termina sola en ~13 s
- [2026-11-11] Push a GitHub completado: commit d1ded08 en main de REGT-URRED/CONTEXTBASE, autor y committer REGT-URRED <U19211826@utp.edu.pe>; suite 112/112 verde antes del push (node --test termina solo en ~13 s)
- [2026-11-11] Incorporado Adaptador Universal Multi-Agente (src/universal-agents.js para 13+ agentes y registro custom en contextbase/agents.json) y Motor de Gobernanza Soberana (src/control.js con compilador de intención humana, Índice de Control Soberano 0-100 y autopiloto de bucle cerrado)
- [2026-11-11] Implementada arquitectura completa de Red de Agentes en Telaraña (src/web.js + src/swarm.js), descomposición de Presa en hilos disjuntos, hidratación de worktrees, 3 subagentes secuenciales por terminal (subagents.json), Economía de Tokens, Árbitro Automático (PASS/REFIX/RERUN/FAIL), Zona de Flujo (flow.md y metrics.json) y auto-reparación de plugins en OpenCode/Kilo Code
- [2026-11-11] [auto] Sincronización automática de archivos modificados: .gitignore
- [2026-11-11] Push a GitHub completado: commit 0d23128 en main de REGT-URRED/CONTEXTBASE (sincronizacion final de la memoria), autor y committer REGT-URRED <U19211826@utp.edu.pe>
- [2026-11-11] Release v1.5.0: automatización integral cero-intervención para OpenCode, Kilo Code, Claude Code, Cursor y Windsurf (`src/autoconfig.js`, `src/watcher.js`, plugins `contextbase-auto.js`, hooks de ciclo de vida, MCP resources/prompts con cola FIFO y `postinstall` global)
- [2026-11-02] Release v1.4.0: autonomia total, Strands Python, MCP completo (24 tools), export JSON/HTML y baseline autorreparable
- [2026-11-02] Ajuste: salida de Strands silenciosa por defecto (CONTEXTBASE_VERBOSE=1 para diagnostico)
- [2026-11-02] v1.4.0: version de exportacion derivada de package.json (OWN_VERSION) y conteo exacto de 24 tools en la prueba MCP
- [2026-11-02] Instalacion global v1.4.0: binarios contextbase, cb y openwiki enlazados; contexto Strands regenerado
- [2026-11-02] v1.4.0: MCP completo con contextbase_export, contextbase_strands_prepare, contextbase_init y contextbase_hook; instrucciones de autonomia en initialize
- [2026-11-02] v1.4.0: contexto Strands autonomo (project_context.py, strands_config.py, tasks.py, strands_runner.py) regenerado tras log/task/audit/sync y al iniciar MCP
- [2026-11-02] v1.4.0: kilo.json con permisos unicos y MCP contextbase; baseline se refresca tras inyeccion legitima de reglas; documentacion de funcionamiento en docs/FUNCIONAMIENTO.md
- [2026-11-02] Pruebas actualizadas: MCP verifica >=23 tools y los nombres nuevos; `tasks.test.js` acepta los artefactos Strands automáticos; `strands.test.js` cubre la API de fase 2 y el runner.
- [2026-11-02] Integración Strands Python completa: `src/strands.js` genera `contextbase/strands/{context.json,project_context.py,strands_config.py,tasks.py,strands_runner.py,README.md}`; `strands_runner.py` escala al humano solo por vulnerabilidades critical/high o deriva del guardia.
- [2026-11-02] Automatización autónoma: nuevo `src/auto.js` con `autoEnsure`, `refreshStrands`, `refreshComponents` y `silentInit`; `init`, `log`, `task`, `audit` y el arranque MCP refrescan la memoria y el contexto sin comandos manuales.
- [2026-11-02] MCP completo: nuevas tools `contextbase_strands_prepare`, `contextbase_init` y `contextbase_hook`, sumadas a `contextbase_export`; `initialize` devuelve instrucciones de uso y el servidor inicializa la memoria al arrancar.
- [2026-11-02] Exportación JSON/HTML estable en `src/export.js` y comando `contextbase export` para estado o digest.
- [2026-11-02] Fix `guard repair source`: la reparación usa la fuente oficial y evita sobrescribir archivos con contenido derivado.
- [2026-11-02] Fix `parseSecurity`: el parser tolera variantes del informe de componentes y cuenta critical/high sin falsos negativos.
- [2026-11-02] Baseline limpiado y conflicto de changelog resuelto: entradas duplicadas consolidadas y línea base regenerada.
- [2026-11-02] Agregada exportacion namespace exp en src/index.js
- [2026-10-30] Swarm real (fase 1-3): worktree+rama+sesion por worker, status con stale, send/collect/stop, CLI y 5 tools MCP
- [2026-10-29] Fix release-github: npm pack en Windows requiere shell (EINVAL con Node 24); release v1.3.2 verificado
- [2026-10-29] Release 1.3.2: empaquetado npm incluido como asset contextbase.tgz en GitHub Releases (sin Actions)
- [2026-10-29] Full GitHub: workflows CI y Release con npm pack adjunto como contextbase.tgz
- [2026-10-29] Mision de orquestacion/testing integrada: comando mission, MCP contextbase_mission, link global
- [2026-10-29] v1.3.1: correccion del campo `author` en `package.json` (`U19211826.@utp.edu.pe` -> `U19211826@utp.edu.pe`) y normalizacion de identidades de commit con `.mailmap` (los commits de `cloud-assa` y `REGT (rafa)` ahora se resuelven como REGT-URRED)
- [2026-10-29] v1.3.1: distribucion movida a GitHub Releases con asset de nombre estable `contextbase.tgz`; el paquete npm queda detenido en 1.2.0 por la suspension de la cuenta `datersx` y por no tener ownership sobre el nombre
- [2026-10-29] v1.3.1: README actualizado con instalacion desde el asset del release y desde el repositorio, en reemplazo de `npm install -g contextbase`
- [2026-10-29] Feedback real: swarm status expuesto, log/task --scope/--worktree, review --json
- [2026-10-29] Push a GitHub completado: commit 4a45812 en main de REGT-URRED/CONTEXTBASE, autor y committer REGT-URRED <U19211826@utp.edu.pe>
- [2026-10-29] Suite de pruebas ampliada de 36 a 60 casos (60/60 en verde): nuevos `test/review.test.js`, `test/slop.test.js` y `test/redundancy.test.js`, y corrección del conteo de tools en `test/mcp.test.js`
- [2026-10-29] `review` y `slop` operan sobre el árbol de trabajo e incluyen archivos sin seguimiento; `review merge` exige exactamente dos reportes y falla con exit 1
- [2026-10-29] `slop` puede fallar: exit 1 con hallazgos y 0 sin hallazgos; las reglas de prosa se aplican solo a prosa y comentarios, lo que elimina el falso positivo sobre su propia regex
- [2026-10-29] Correcciones: off-by-one con `\ No newline at end of file`, JSONC con comentarios en línea y comas finales, referencias `agent:` comparadas sin distinguir mayúsculas y `knownAgents` reconstruido una sola vez por archivo
- [2026-10-29] `redundancy` reporta familias principales (Superpowers, Ponytail, Antislop, ContextBase, OfficeCLI) y escanea `node_modules`, `plugins` y npm global
- [2026-10-29] `src/index.js` con exportaciones namespaced; `.atl/` ignorado en `.gitignore`; `bin/contextbase.js` con bit ejecutable `100755`
- [2026-10-29] Skill global sincronizada con la versión del repo en `~/.config/opencode/skills/contextbase` y `~/.gemini/config/skills/contextbase`
- [2026-10-29] Corregida similitud de fusion en review merge: coeficiente de solapamiento sobre el conjunto menor con umbral 0.40 y minimo 2 terminos compartidos, porque Jaccard con 0.50 no detectaba coincidencias entre revisores independientes
- [2026-10-29] v1.3.0: tres tools MCP nuevas (contextbase_review, contextbase_redundancy, contextbase_slop); servidor MCP pasa de 11 a 14 tools
- [2026-10-29] v1.3.0: nuevo modulo src/slop.js y comando slop (--json) como delivery gate antislop sobre las lineas agregadas del diff con 5 reglas heuristas (palabras de relleno, not-X-but-Y, densidad de guiones, etiquetas en negrita, comentarios que repiten el codigo)
- [2026-10-29] v1.3.0: nuevo modulo src/redundancy.js y comando redundancy (--json) que detecta skills duplicados entre .agents/.config-opencode/.gemini/.claude, referencias rotas en commands y agents, bloques AGENTS.md sin cierre o con paths inexistentes, y MCP duplicados o fuera de mcp.servers
- [2026-10-29] v1.3.0: integra thermos como modulo nativo de revision (src/review.js + src/prompts/review-security.md y review-quality.md) con modos prepare/prompts/merge; CLI review, review prompts, review merge
- [2026-10-27] Bump version to 1.2.2 for npm publish (latest)
- [2026-10-27] Implementacion fases 1-3: modulos base (detect, registry, guard, snapshot, strands, bootstrap), integracion CLI/MCP/context y pruebas (36/36)
- [2026-10-24] v1.2.1: README reescrito para publicacion en npm (instalacion desde registro, quickstart, tabla de comandos, MCP, seguridad y arquitectura). Sin cambios de API ni de comandos.
- [2026-10-24] v1.2.0: integración nativa. Servidor MCP sobre stdio (`src/mcp.js`) con seis tools; `status --json` y `status --check`; digest `contextbase context`; `contextbase sync` con bloque idempotente en fundamentos.md; hook `post-commit` de autoguardado (`src/hooks.js`); escritura atómica y bloqueo por archivo (`src/fsutil.js`, `src/changelog.js`).
- [2026-10-24] Bitácora con rotación automática a `changelog-YYYY.md` al superar 500 entradas, para no inflar el contexto de los agentes.
- [2026-10-24] Seguridad del empaquetado: `pack` redacta secretos conocidos y el escáner ignora `.env`/`.env.*`; verificadores `cargo audit` y `govulncheck` cuando están instalados, y versiones instaladas de pip/Cargo.lock/go.mod en el inventario.
- [2026-10-24] Suite de pruebas con `node:test` sin dependencias: 20 casos (escáner, rotación, bloqueo, reglas, tareas, digest, sync, hook, MCP, mantenimiento, generador).
- [2026-10-24] Aviso de vigencia del informe de mantenimiento en `contextbase status`: detecta `componentes.md` faltante o con más de 7 días sin regenerar y sugiere `contextbase audit` (sin costo de red).
- [2026-10-24] Implementación del mantenimiento preventivo automático: nuevo módulo `src/maintenance.js` que inventaría componentes (manifiestos, última modificación y versión instalada), mide frescura (`npm outdated`, `pip list --outdated`) y verifica brechas de seguridad conocidas (`npm audit`, `pip-audit`).
- [2026-10-24] Nuevo comando CLI `contextbase audit` que regenera `contextbase/componentes.md` (inventario + frescura + brechas) y paso `[3.5/5]` integrado en `init`.
- [2026-10-24] Regla 5 de Mantenimiento Preventivo Automático añadida al bloque inyectado (`rules.js`), a `fundamentos.md` generado y a `skills/contextbase/SKILL.md`; verificación final obligatoria al cerrar cambios sin saturar instrucciones.
- [2026-10-24] Corrección de código muerto en `contextbase task done` (`lines`, `matched` y `query` sin declarar); ahora funciona.
- [2026-10-24] Versión 1.1.0: banner con versión dinámica desde `package.json` y script npm `audit`.
- [2026-10-07] Limpieza y estandarización visual de README.md: eliminación total de emojis y sincronización con GitHub.
- [2026-10-07] Incorporación de auto-creación y garantía de resiliencia (ensureContextBase) ante ausencia o modificación de contextbase/ en cualquier proyecto.
- [2026-10-07] Reinicialización de repositorio Git limpio para REGT-URRED y publicación en GitHub.
- [2026-10-07] Transformación integral del repositorio: eliminación del código legado de OpenWiki y creación de ContextBase como herramienta propia minimalista Zero-Dependencies en Node.js ESM.
- [2026-10-07] Implementación del motor de escaneo profundo y empaquetador Repomix nativo en `src/scanner.js`.
- [2026-10-07] Creación del generador de documentos técnicos (`fundamentos.md`, `changelog.md`, `tasklist.md`) con población retroactiva en `src/generator.js`.
- [2026-10-07] Creación del inyector universal de directivas para agentes (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`) en `src/rules.js`.
- [2026-10-07] Creación e instalación global de la Skill para agentes en `~/.gemini/config/skills/contextbase/SKILL.md`.
- [2026-10-07] Creación de interfaz CLI con banner ANSI, subcomandos de gestión de tareas (`task add`, `task done`, `task list`), bitácora (`log`), volcado (`dump`) y empaquetado (`pack`).
- [2026-10-07] Vinculación global mediante `npm link` con ejecutables `contextbase`, `cb` y alias `openwiki`.
- [2026-10-07] Redacción de documentación técnica completa en español en `README.md`.


---

## Cambios por Hacer
- Tool MCP `contextbase_terminals` y soporte `send` para agentes sin contrato ses_ (Kilo/Claude): inyección de teclas en TUI queda fuera por diseño

- Verificar `strands_runner.py` con el SDK de Strands instalado y documentar la versión compatible.
- Definir y verificar el contrato de sesión para `claude` y `codex` en swarm.
- Verificar la inyección en sesión con TUI abierta simultánea (spike pendiente).
- Publicar en el registro npm público (requiere `npm login`).

---
*Nota: Registrar siempre cada nueva tarea completada en "Cambios Realizados" y actualizar los ítems pendientes en "Cambios por Hacer".*
