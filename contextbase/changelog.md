# Bitácora Histórica del Proyecto (Changelog)

Registro metódico del progreso técnico, decisiones de arquitectura y evolución del sistema.

---

## Cambios Realizados
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
<<<<<<< HEAD
=======
>>>>>>> 797e66c (feat: address real-world feedback (swarm status, scoped log/task, review --json))


---

## Cambios por Hacer

- Agregar soporte para exportación en formatos adicionales (ej. JSON/HTML si se requiere).
- Incorporar pruebas unitarias automáticas con el runner nativo `node:test`.
- Publicar en registro npm público (nombre `contextbase` disponible; requiere `npm login`, la máquina no tiene sesión).

---
*Nota: Registrar siempre cada nueva tarea completada en "Cambios Realizados" y actualizar los ítems pendientes en "Cambios por Hacer".*
