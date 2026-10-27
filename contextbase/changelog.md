# Bitácora Histórica del Proyecto (Changelog)

Registro metódico del progreso técnico, decisiones de arquitectura y evolución del sistema.

---

## Cambios Realizados
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

- Agregar soporte para exportación en formatos adicionales (ej. JSON/HTML si se requiere).
- Incorporar pruebas unitarias automáticas con el runner nativo `node:test`.
- Publicar en registro npm público (nombre `contextbase` disponible; requiere `npm login`, la máquina no tiene sesión).

---
*Nota: Registrar siempre cada nueva tarea completada en "Cambios Realizados" y actualizar los ítems pendientes en "Cambios por Hacer".*
