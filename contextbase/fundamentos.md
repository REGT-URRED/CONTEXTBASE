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

---

## 3. Arquitectura y Contexto Técnico General
- **Nombre:** `contextbase`
- **Versión:** `1.0.0`
- **Ecosistema:** Node.js (ESM puro, >= 18.0.0)
- **Dependencias Externas:** 0 (Zero-Dependencies)
- **Binarios Registrados:** `contextbase`, `cb`, `openwiki`
- **Motor de Escaneo:** Analizador estático y empaquetador Repomix integrado en `src/scanner.js`

### Módulos Principales del Sistema:
- `bin/contextbase.js`: Punto de entrada ejecutable CLI.
- `src/index.js`: Exportaciones de la API programática.
- `src/cli.js`: Enrutador de comandos, interfaz ANSI y acciones interactivas.
- `src/scanner.js`: Escáner de sistema de archivos, detector de stacks/commits/TODOs y motor Repomix.
- `src/generator.js`: Generador de `fundamentos.md`, `changelog.md` y `tasklist.md`.
- `src/rules.js`: Inyector universal de reglas de agente (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.).
- `src/installer.js`: Instalador de la Skill global en el entorno de agentes.
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
│   └── tasklist.md
├── skills/
│   └── contextbase/
│       └── SKILL.md
├── src/
│   ├── cli.js
│   ├── generator.js
│   ├── index.js
│   ├── installer.js
│   ├── rules.js
│   └── scanner.js
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── LICENSE
├── package.json
└── README.md
```

---
*Generado y consolidado por ContextBase CLI el 7/10/2026.*
