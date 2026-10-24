# ContextBase

Memoria técnica persistente, bitácora y lista de tareas para proyectos trabajados con agentes de código. Un comando deja el contexto listo y cualquier agente sabe dónde retomar.

`Zero dependencies` · `Node.js ESM` · `Windows / Linux / macOS` · `MIT`

> Persistent technical memory, changelog and task list for AI coding agents. One command, no dependencies.

---

## El problema

Cada sesión con un agente empieza en blanco: no recuerda decisiones, pendientes, deuda técnica ni qué se rompió la última vez. Copiar archivos enteros al prompt quema tokens y sigue sin garantizar continuidad.

## La solución

`contextbase init` analiza el proyecto y crea una memoria viva en `contextbase/`, además de inyectar la regla de actualización en los archivos que leen los agentes. Desde ahí:

- El agente sabe qué está pendiente y qué se decidió.
- Cada cambio queda registrado con fecha.
- El mantenimiento (frescura de dependencias y brechas de seguridad) corre por CLI, no por instrucciones infladas.
- El contexto que consume el agente es acotado y determinista, no el repositorio completo.

---

## Instalación

```bash
# global
npm install -g contextbase

# o sin instalar
npx contextbase init
```

Verificar:

```bash
contextbase --version
contextbase status
```

---

## Inicio rápido

```bash
cd tu-proyecto
contextbase init
contextbase context
```

`init` hace, en orden:

1. Crea `contextbase/`.
2. Escanea archivos, dependencias, frameworks, commits y TODOs.
3. Genera `fundamentos.md`, `changelog.md` y `tasklist.md` con datos reales del proyecto.
4. Genera `componentes.md`: inventario, frescura de versiones y brechas de seguridad.
5. Inyecta las reglas en `AGENTS.md`, `CLAUDE.md`, `.cursorrules` y `.windsurfrules`.
6. Instala la Skill global para agentes compatibles.

Opciones: `--force` regenera los documentos existentes; `--pack` añade `contextbase-pack.txt`.

---

## Qué crea

| Archivo | Contenido |
| :--- | :--- |
| `contextbase/fundamentos.md` | Objetivo, reglas de desarrollo, arquitectura, dependencias y mapa de directorios. |
| `contextbase/changelog.md` | Bitácora con `## Cambios Realizados` (historial Git real) y `## Cambios por Hacer`. Rota a `changelog-YYYY.md` al superar 500 entradas. |
| `contextbase/tasklist.md` | Tareas con `[x]` completadas y `[ ]` pendientes. |
| `contextbase/componentes.md` | Versiones instaladas, última modificación de cada manifiesto, desactualizaciones y vulnerabilidades conocidas. |

Los cuatro documentos se mantienen en **español**; el código y la API en inglés.

---

## Uso desde agentes

La regla inyectada obliga al agente a actualizar `contextbase/` al cerrar cada cambio. Para que consuma poco contexto:

```bash
contextbase context          # digest de menos de 2k tokens
contextbase status --json    # estado estructurado
contextbase status --check   # exit 1 si hay brechas, informe vencido o reglas viejas
```

### MCP nativo

Cualquier cliente compatible MCP puede usar ContextBase como tools, sin shell ni parseo de texto:

```json
{
  "mcpServers": {
    "contextbase": { "command": "contextbase", "args": ["mcp"] }
  }
}
```

Tools expuestas: `contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`.

---

## Comandos

| Comando | Para qué |
| :--- | :--- |
| `contextbase init` | Inicializa memoria, reglas, Skill y mantenimiento. |
| `contextbase status` / `check` | Tablero de archivos, tareas, seguridad y reglas. `--json`, `--check`. |
| `contextbase context` | Digest compacto para iniciar sesión. `--json` disponible. |
| `contextbase log "<mensaje>"` | Registra un cambio en el changelog. |
| `contextbase task add\|done\|list` | Gestiona tareas. |
| `contextbase audit` | Regenera componentes, frescura y brechas. |
| `contextbase sync` | Sincroniza el bloque técnico de `fundamentos.md` y reinyecta reglas sin borrar notas manuales. |
| `contextbase hook` | Instala o quita `post-commit` para autoguardar commits. `hook remove` desinstala. |
| `contextbase pack [archivo]` | Empaqueta el repositorio para contexto, con redacción de secretos. |
| `contextbase dump` | Vuelca los documentos de `contextbase/` en terminal. |
| `contextbase mcp` | Servidor MCP sobre stdio. |
| `contextbase install-skill` | Reinstala la Skill global. |

---

## Seguridad y mantenimiento

- **Cero dependencias**: no hay cadena de suministro que auditar en ContextBase.
- **Redacción de secretos**: `pack` reemplaza claves AWS, tokens GitHub/Slack/OpenAI, bloques PEM y valores de `password`/`token` antes de escribir el contexto; además excluye `.env` y `.env.*`.
- **Inventario verificable**: `audit` usa `npm outdated`, `npm audit`, `pip list --outdated`, `pip-audit`, `cargo audit` y `govulncheck` cuando existen. Si una herramienta no está, lo declara en vez de inventar cobertura.
- **Escritura segura**: archivos del registro se escriben de forma atómica y con bloqueo, para que dos agentes simultáneos no se pisen.
- **Salud en CI**: `status --check` devuelve código 1 ante brechas critical/high, informe vencido o reglas desactualizadas.

---

## Compatibilidad

| Entorno | Mecanismo |
| :--- | :--- |
| Antigravity / Gemini CLI | `AGENTS.md` + Skill global |
| Claude Code | `CLAUDE.md` + Skill |
| Cursor | `.cursorrules` |
| Windsurf | `.windsurfrules` |
| OpenCode / Codex / Kilo / Kimi / Roo / Trae | `AGENTS.md` o MCP |
| Terminal | CLI directa |

Sincronización de reglas entre versiones: `contextbase sync`.

---

## Arquitectura

```
bin/contextbase.js      entrada CLI
src/cli.js              router y comandos
src/scanner.js          escaneo, metadatos, Repomix, redacción
src/generator.js        documentos y bloque sincronizado
src/maintenance.js      inventario, frescura y brechas
src/context.js          estado, digest y salud
src/changelog.js        bitácora y rotación
src/fsutil.js           escritura atómica y bloqueo
src/hooks.js            hook post-commit
src/mcp.js              servidor MCP stdio
src/rules.js            inyección de reglas con versión
src/installer.js        Skill global
skills/contextbase/     definición de la Skill
```

Sin compilación, sin `node_modules` en runtime, arranque en milisegundos.

---

## Pruebas

```bash
npm test
```

20 casos con `node:test`: escaneo y redacción, rotación, bloqueo, inyección de reglas, tareas, digest, sincronización, hook, MCP y mantenimiento.

---

## Licencia

MIT
