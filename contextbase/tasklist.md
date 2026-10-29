# Lista de Tareas Visual (Tasklist)

Seguimiento del estado de tareas con alto contraste visual.

---

## Tareas Completadas
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
- [x] Suite completa en verde: 60 casos, 60 aprobados, 0 fallidos
- [x] `review` y `slop` cubren el arbol de trabajo y los archivos sin seguimiento
- [x] Codigos de salida: `slop` devuelve 1 con hallazgos y 0 sin hallazgos; `review merge` falla con exit 1 fuera de dos reportes
- [x] `redundancy` informa familias principales y escanea `node_modules`, `plugins` y npm global
- [x] Skill global sincronizada en `~/.config/opencode` y `~/.gemini`
- [x] Exportaciones namespaced en `src/index.js`
- [x] `.atl/` agregado a `.gitignore`
- [x] `bin/contextbase.js` con bit ejecutable `100755`
---

## Tareas Pendientes / En Progreso

- [ ] Agregar soporte para exportación en formatos adicionales (ej. JSON/HTML si se requiere)
- [ ] Publicar en npm (`npm login` pendiente en esta máquina)

---
*Regla: Marcar con `[x]` las tareas completadas y agregar con `[ ]` cualquier nuevo requerimiento técnico.*
