# Fundamentos del Proyecto: contextbase

## 1. Objetivo Principal
Sistema minimalista, universal y Zero-Dependencies de memoria persistente técnica y bitácora de proyecto para desarrolladores y agentes de código (Antigravity, Claude Code, Cursor, Windsurf, OpenCode, Kilo, Kimi Code, Codex, Roo Code, etc.).

Este sistema resuelve de manera definitiva la pérdida de contexto y continuidad técnica entre sesiones de trabajo mediante un comando simple (`contextbase init`) y una directiva universal de actualización obligatoria.

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
- **Versión:** `1.3.0`
- **Ecosistema:** Node.js (ESM puro, >= 18.0.0)
- **Dependencias Externas:** 0 (Zero-Dependencies)
- **Binarios Registrados:** `contextbase`, `cb`, `openwiki`
- **Motor de Escaneo:** Analizador estático y empaquetador Repomix integrado en `src/scanner.js`
- **Mantenimiento Preventivo:** Inventario de componentes, frescura y brechas en `src/maintenance.js`; informe en `contextbase/componentes.md`; comando `contextbase audit`

### Módulos Principales del Sistema:
- `bin/contextbase.js`: Punto de entrada ejecutable CLI.
- `src/index.js`: Exportaciones de la API programática.
- `src/cli.js`: Enrutador de comandos, interfaz ANSI y acciones interactivas.
- `src/scanner.js`: Escáner de sistema de archivos, detector de stacks/commits/TODOs y motor Repomix.
- `src/generator.js`: Generador de `fundamentos.md`, `changelog.md` y `tasklist.md`.
- `src/rules.js`: Inyector universal de reglas de agente (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.).
- `src/installer.js`: Instalador de la Skill global en el entorno de agentes.
- `src/maintenance.js`: Motor de mantenimiento preventivo (inventario de componentes, frescura de versiones y verificación de brechas de seguridad).
- `src/context.js`: Estado estructurado del proyecto, digest compacto para agentes y evaluación de salud.
- `src/changelog.js`: Inserción de entradas y rotación de la bitácora a archivos anuales.
- `src/fsutil.js`: Escritura atómica y bloqueo asesor por archivo (concurrencia multiagente).
- `src/hooks.js`: Instalación del hook `post-commit` de autoguardado.
- `src/mcp.js`: Servidor MCP sobre stdio con tools nativas para agentes compatibles.
- `src/bootstrap.js`: Recomendación y ejecución del arranque de un proyecto (`preview`, `run`).
- `src/cli_extra.js`: Subcomandos extendidos del CLI que no viven en el enrutador principal.
- `src/detect.js`: Detección de CLIs instalados, binarios en `PATH` y configuración MCP.
- `src/guard.js`: Protección de archivos sensibles con línea base, hash y escaneo de cambios sospechosos.
- `src/registry.js`: Registro de herramientas del proyecto y su estado habilitado.
- `src/redundancy.js`: Detección de redundancia global (skills duplicados, referencias rotas, bloques `AGENTS.md` y MCP repetidos).
- `src/review.js`: Revisión tipo thermos: diff, contenidos, prompts de revisor y fusión de reportes.
- `src/slop.js`: Delivery gate antislop sobre el árbol de trabajo, con reglas de prosa y código por separado.
- `src/snapshot.js`: Creación, listado, poda y restauración de snapshots del registro.
- `src/strands.js`: Preparación de objetivos tipo Strands (fase 1: solo interfaz, sin ejecución).
- `src/prompts/`: Prompts de revisor `review-security.md` y `review-quality.md`.
- `test/`: Suite de pruebas con el runner nativo `node:test` (sin dependencias).
- `skills/contextbase/SKILL.md`: Definición formal de la Skill para agentes de IA.

---

## 4. Mapa de Estructura del Repositorio
```
contextbase/
├── bin/
│   └── contextbase.js
├── contextbase/
│   ├── fundamentos.md
│   ├── changelog.md
│   ├── tasklist.md
│   └── componentes.md
├── docs/
│   └── 2026-10-27-contextbase-base-tool-design.md
├── skills/
│   └── contextbase/
│       └── SKILL.md
├── src/
│   ├── bootstrap.js
│   ├── changelog.js
│   ├── cli.js
│   ├── cli_extra.js
│   ├── context.js
│   ├── detect.js
│   ├── fsutil.js
│   ├── generator.js
│   ├── guard.js
│   ├── hooks.js
│   ├── index.js
│   ├── installer.js
│   ├── maintenance.js
│   ├── mcp.js
│   ├── redundancy.js
│   ├── registry.js
│   ├── review.js
│   ├── rules.js
│   ├── scanner.js
│   ├── slop.js
│   ├── snapshot.js
│   ├── strands.js
│   └── prompts/
│       ├── review-quality.md
│       └── review-security.md
├── test/
│   └── (19 archivos *.test.js)
├── .atl/ (ignorado por git)
├── .cursorrules
├── .gitignore
├── .windsurfrules
├── AGENTS.md
├── CLAUDE.md
├── LICENSE
├── package.json
└── README.md
```

<!-- CONTEXTBASE:SYNC:START -->
## Contexto Técnico Sincronizado (auto)
> Generado por `contextbase sync`. No editar dentro de este bloque: se reemplaza completo.
- **Versión:** 1.4.0
- **Ecosistema:** Node.js / JavaScript / TypeScript
- **Frameworks:** Librerías estándar / Vanilla
- **Lenguajes dominantes:** JavaScript (50), Markdown (14), JSON (2)
- **Dependencias:** Sin dependencias externas registradas.
- **Scripts:** start, test, audit, mcp, pack:release, test:ci, release:github
- **Directorios raíz:** bin, contextbase, docs, scripts, skills, src, test
<!-- CONTEXTBASE:SYNC:END -->

---
*Generado y consolidado por ContextBase CLI el 7/10/2026.*
