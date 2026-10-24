# CONTEXTBASE

> **Sistema minimalista y universal de memoria persistente técnica y bitácora de proyecto para agentes de código y desarrolladores.**
> *Zero-Dependencies (100% Node.js ESM nativo) • Ultra-rápido • Compatible con cualquier agente de IA.*

---

## ¿Qué es ContextBase?

Cuando trabajas con agentes de IA de última generación (**Antigravity, Claude Code, Cursor, Windsurf, OpenCode, Kilo, Kimi Code, Codex, Roo Code**, etc.), uno de los mayores problemas es la **pérdida de contexto, continuidad técnica y memoria histórica** entre sesiones de trabajo.

**ContextBase** elimina por completo la complejidad de herramientas pesadas y proporciona un sistema limpio, directo y automático que:
1. Se ejecuta con un simple comando en terminal (`contextbase init`).
2. Puede entregarse a cualquier agente diciéndole simplemente: *"Instala esto: [ruta o comando]"*.
3. Escanea en profundidad el código del proyecto (con un motor estilo **Repomix** nativo integrado sin dependencias).
4. Inicializa y puebla retroactivamente la memoria del proyecto en la carpeta `contextbase/`.
5. Inyecta la **Regla Crítica de Actualización** en las configuraciones de los agentes para que mantengan la memoria técnica actualizada de forma obligatoria tras cada cambio.

---

## Instalación y Puesta en Marcha

### 1. Instalación Global (Recomendada)
Desde el directorio del proyecto:
```bash
npm install -g .
# o con pnpm:
pnpm link --global
```
Una vez instalado, el comando `contextbase` (o el alias corto `cb`) estará disponible en cualquier terminal del sistema.

### 2. Uso Directo sin Instalación previa (npx o node)
```bash
npx contextbase init
# o ejecutando directamente:
node bin/contextbase.js init
```

### 3. Para Agentes de Código ("Instala esto...")
Simplemente indica a tu agente de código:
> *"Instala y ejecuta contextbase en este proyecto para inicializar el sistema de memoria técnica persistente."*

El agente ejecutará `contextbase init` y quedará automáticamente configurado para seguir la directiva de memoria.

---

## Estructura del Sistema contextbase/

Cuando ejecutas `contextbase init`, se crea la carpeta `contextbase/` con tres documentos metódicos y en **español**:

| Archivo | Propósito y Contenido |
| :--- | :--- |
| **`contextbase/fundamentos.md`** | **Objetivo principal** del proyecto, **reglas de desarrollo**, arquitectura general, dependencias detectadas y **mapa de directorios clave**. |
| **`contextbase/changelog.md`** | **Bitácora histórica** dividida metódicamente en dos secciones: `## Cambios Realizados` (poblado con historial Git real) y `## Cambios por Hacer` (poblado con TODOs detectados en código). |
| **`contextbase/tasklist.md`** | **Lista visual de tareas de alto contraste** mediante checkboxes `[x]` (tareas completadas) y `[ ]` (tareas pendientes y roadmap). |

---

## Regla Crítica de Actualización (Obligatoria para Agentes)

ContextBase inyecta automáticamente esta directiva en `AGENTS.md`, `CLAUDE.md`, `.cursorrules` y `.windsurfrules`:

```markdown
<!-- CONTEXTBASE:START -->
## Memoria Persistente y Bitácora del Proyecto (contextbase)
Este proyecto utiliza un sistema de memoria técnica persistente en la carpeta `contextbase/`.

### Regla Crítica de Actualización (Obligatoria para Agentes de Código):
Toda futura corrección, mejora, alteración o nueva implementación en el código debe incluir SIEMPRE, como paso final y obligatorio, la actualización de los registros dentro de la carpeta `contextbase/`:
1. `contextbase/changelog.md`: Registrar el cambio en "Cambios Realizados" y actualizar "Cambios por Hacer".
2. `contextbase/tasklist.md`: Marcar con [x] las tareas completadas y registrar con [ ] las nuevas tareas.
3. `contextbase/fundamentos.md`: Actualizar si hubo modificaciones en arquitectura, reglas o dependencias.
4. Idioma: Toda salida, bitácora y documentación debe mantenerse estrictamente en español.
<!-- CONTEXTBASE:END -->
```

---

## Comandos CLI Disponibles

### `contextbase init`
Inicializa el sistema en el proyecto actual.
- Realiza lectura profunda de archivos, dependencias, frameworks, commits y TODOs.
- Crea y puebla retroactivamente `contextbase/fundamentos.md`, `changelog.md` y `tasklist.md`.
- Inyecta directivas en los archivos de agentes.
- Instala la Skill en las configuraciones globales de agentes.
- *Opciones:*
  - `--force`: Sobrescribe archivos existentes en `contextbase/`.
  - `--pack`: Genera también el archivo empaquetado `contextbase-pack.txt`.

### `contextbase status` (o `contextbase check`)
Muestra un tablero visual del estado de la memoria técnica:
- Archivos presentes y última fecha de modificación.
- Conteo visual y porcentaje de tareas completadas `[x]` vs pendientes `[ ]`.

### `contextbase task [add|done|list]`
Gestión rápida de tareas desde la terminal o por el agente:
```bash
# Agregar una tarea pendiente
contextbase task add "Implementar endpoint de autenticación JWT"

# Marcar una tarea completada (búsqueda inteligente por texto)
contextbase task done "autenticación"

# Listar tareas
contextbase task list
```

### `contextbase log "<mensaje>"`
Añade un registro con fecha al historial de cambios en `contextbase/changelog.md`:
```bash
contextbase log "Optimización del algoritmo de escaneo de archivos"
```

### `contextbase pack [archivo]` *(Motor Repomix Integrado)*
Empaqueta todo el repositorio en un único archivo de contexto formateado para LLMs, respetando `.gitignore` y filtrando binarios y archivos pesados:
```bash
contextbase pack mi-repositorio.txt
```

### `contextbase dump`
Vuelca los tres documentos de `contextbase/` directamente en la terminal (ideal para inyectar en el contexto de un chat o sesión de IA).

### `contextbase audit` *(Mantenimiento Preventivo Automático)*
Regenera `contextbase/componentes.md`: inventario de componentes con su versión instalada y última modificación del manifiesto, frescura de versiones (`npm outdated`, `pip list --outdated`) y verificación final de brechas de seguridad conocidas (`npm audit`, `pip-audit` cuando esté disponible):
```bash
contextbase audit
```
También se ejecuta automáticamente como paso `[3.5/5]` durante `contextbase init`. Agentes y buenos desarrolladores lo revisan al iniciar un proyecto o sesión, y lo regeneran como verificación final al cerrar cada cambio, sin saturar las instrucciones del agente.

### `contextbase context` *(digest para sesiones de agente)*
Genera un resumen compacto y determinista (menos de 2k tokens) con tareas pendientes, progreso, estado de componentes y la siguiente acción recomendada. Ideal al iniciar una sesión sin volcar archivos completos:
```bash
contextbase context
contextbase context --json
```

### `contextbase status --json` y `--check`
`status --json` devuelve estado estructurado (archivos, tareas, seguridad, salud, reglas) para agentes y CI. `--check` termina con código 1 si hay brechas critical/high, informe de componentes vencido o reglas de agente desactualizadas:
```bash
contextbase status --json
contextbase status --check
```

### `contextbase sync` *(sincronización idempotente)*
Regenera el bloque técnico de `fundamentos.md` entre marcadores `CONTEXTBASE:SYNC`, sin tocar notas manuales, y reinyecta el bloque de reglas en los archivos de agente. Soluciona la deriva entre proyectos existentes y la versión instalada:
```bash
contextbase sync
```

### `contextbase hook [install|remove]` *(autoguardado)*
Instala un hook `post-commit` que registra automáticamente cada commit en `contextbase/changelog.md`. El autoguardado deja de depender de que el agente se acuerde:
```bash
contextbase hook
contextbase hook remove
```

### `contextbase mcp` *(servidor MCP sobre stdio)*
Expone ContextBase como tools MCP nativas (`contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`) para cualquier agente compatible, sin shell ni parseo de ANSI. Ejemplo de configuración de cliente MCP:
```json
{
  "mcpServers": {
    "contextbase": { "command": "contextbase", "args": ["mcp"] }
  }
}
```

### Pruebas
```bash
npm test
```
Ejecuta la suite con el runner nativo `node:test` (sin dependencias): escaneo y redacción de secretos, rotación de bitácora, bloqueo de escritura, inyección de reglas, tareas, digest, sincronización, hook y protocolo MCP.
### `contextbase install-skill`
Copia e instala la Skill de ContextBase en el directorio global de agentes (`~/.gemini/config/skills/contextbase`).

---

## Compatibilidad Universal de Agentes

ContextBase está diseñado para operar de forma nativa con cualquier agente o editor:
- **Google Antigravity / Gemini CLI** (mediante Skill global y `AGENTS.md`)
- **Anthropic Claude Code** (mediante `CLAUDE.md` y `~/.claude/skills`)
- **Cursor IDE** (mediante `.cursorrules`)
- **Windsurf / Codeium** (mediante `.windsurfrules`)
- **OpenCode / Codex / Kilo Code / Kimi Code / Roo Code / Trae** (mediante `AGENTS.md`)
- **Línea de comandos tradicional** (Windows PowerShell, Linux Bash, macOS Zsh)

---

## Arquitectura Técnica Minimalista

- **0 dependencias externas (`dependencies: {}`)**: Instalación instantánea en menos de 1 segundo.
- **Node.js ESM nativo**: Compatible con Node 18, 20, 22+.
- **Zero build step**: No requiere compilar TypeScript; se ejecuta directamente sin demoras.
- **Portabilidad total**: Funciona idénticamente en Windows, Linux y macOS.

---

## Licencia
MIT
