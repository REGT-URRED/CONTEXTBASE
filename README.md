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
# global, desde el release de GitHub (siempre la ultima version)
npm install -g https://github.com/REGT-URRED/CONTEXTBASE/releases/latest/download/contextbase.tgz

# o desde el codigo
git clone https://github.com/REGT-URRED/CONTEXTBASE.git
cd CONTEXTBASE && npm link
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

Tools expuestas: `contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`, `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`, `contextbase_review`, `contextbase_redundancy`, `contextbase_slop`.

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
| `contextbase review [base] [--intent "texto"]` | Arma el paquete de revisión sobre el árbol de trabajo (incluye cambios sin confirmar) contra `<base>`: diff, contenidos de archivos cambiados, intención del usuario y los dos prompts de revisor. |
| `contextbase review prompts` | Imprime solo los dos prompts de revisor. |
| `contextbase review merge <reporte-a.md> <reporte-b.md>` | Fusiona dos reportes; exige exactamente dos archivos y falla con otra cantidad. |
| `contextbase redundancy [--json]` | Detecta redundancia global e informa las skills principales. |
| `contextbase slop [base] [--json]` | Escanea el árbol de trabajo contra `<base>` (inferida si se omite) con las reglas antislop; exit 1 cuando hay hallazgos y 0 cuando no. |

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

## Revisión, redundancia y antislop

**Revisión tipo thermos.** `contextbase review [base] [--intent "texto"]` revisa el árbol de trabajo (los cambios sin confirmar incluidos) contra `<base>` y arma un paquete con el diff, el contenido de los archivos cambiados, la intención del usuario y dos prompts de revisor:

| Revisor | Rol |
| :--- | :--- |
| A | Seguridad y correctitud |
| B | Calidad y mantenibilidad |

El flujo es `review` → dos revisores en paralelo con el mismo contexto → `review merge <a> <b>`. El merge destaca las coincidencias corroboradas por ambas pasadas y deja el resto como hallazgos que requieren criterio propio.

**Redundancia (0 redundancia).** `contextbase redundancy` detecta skills duplicados entre ubicaciones, referencias rotas en `commands`/`agents`, bloques de `AGENTS.md` sin cierre o con rutas inexistentes, y MCP duplicados. Informa las familias principales (Superpowers, Ponytail, Antislop, ContextBase, OfficeCLI) y separa `Otros skills`.

**Antislop.** `contextbase slop [base]` es un delivery gate heurístico sobre las líneas agregadas del árbol de trabajo, complementado por una lista de verificación manual. Devuelve exit 1 cuando hay hallazgos y 0 cuando no. Las reglas heurísticas no reemplazan el criterio humano: una corrida limpia no equivale a aprobación cuando no hay cambios que evaluar.

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
src/review.js           revisión tipo thermos: diff, contenidos, prompts y merge
src/redundancy.js       redundancia del entorno global
src/slop.js             delivery gate antislop sobre líneas agregadas
src/prompts/review-security.md prompt de revisor de seguridad y correctitud
src/prompts/review-quality.md  prompt de revisor de calidad y mantenibilidad
src/installer.js        Skill global
skills/contextbase/     definición de la Skill
```

Sin compilación, sin `node_modules` en runtime, arranque en milisegundos.

---

## Pruebas

```bash
npm test
```

Suite de pruebas con el runner nativo `node:test`: escaneo y redacción, rotación, bloqueo, inyección de reglas, tareas, digest, sincronización, hook, MCP y mantenimiento.

---

## Licencia

MIT

---

## Publicar release en GitHub (sin Actions)

El empaquetado se hace local y se sube como asset del release:

```bash
npm run release:github
```

Requiere `gh` autenticado con permiso de escritura (`GH_TOKEN` o `gh auth login`). El comando corre tests, genera `contextbase.tgz` y lo adjunta al release `v<version>` (lo crea si no existe).

Instalacion desde el release:

```bash
npm install -g https://github.com/REGT-URRED/CONTEXTBASE/releases/latest/download/contextbase.tgz
```

---

## Enjambre de agentes (swarm)

Orquestacion real por worktrees: cada worker recibe arbol propio, rama propia y sesion propia. El agente principal reparte tareas y lee resultados; la terminal es solo para mirar e intervenir.

```bash
contextbase swarm start --task "arreglar el fork multi-red" --workers 3
contextbase swarm status
contextbase swarm send --worker w1 --message "prioriza los tests de red"
contextbase swarm collect
contextbase swarm stop
```

Que crea cada worker:

| Archivo | Quien escribe | Para que |
|---|---|---|
| `contextbase/swarm/<run>/<w>/task.md` | contextbase | La tarea y el criterio de salida |
| `contextbase/swarm/<run>/<w>/result.md` | el worker | Que hizo, como lo verifico, que quedo pendiente |
| `contextbase/swarm/<run>/<w>/status.json` | el worker | `done`, `blocked` o `failed` |
| `contextbase/swarm/<run>/<w>/launch.cmd` | contextbase | Lanzador generado (sin texto del usuario) |
| `contextbase/swarm/<run>/state.json` | contextbase | Sesiones, ramas, worktrees, pids |

Reglas del modelo:

- **La terminal es para el humano; el archivo es para la maquina.** Ningun orquestador parsea la pantalla.
- `contextbase swarm send` intenta inyectar en la sesion viva (`delivered: native`). Si el agente no tiene contrato de sesion verificado, deja el mensaje en `inbox.md` (`delivered: file`).
- `status` marca `stale` cuando un worker no dejo commits, cambios ni resultado dentro del ttl (10 min por defecto). Un worker mudo es el fallo tipico de un enjambre, no el crash.
- `collect` da veredicto `clean`/`conflict` por rama con `git merge-tree`, sin tocar el arbol. No hace merge automatico.

Limites actuales, sin adornos:

- Solo `opencode` tiene contrato de sesion verificado. `claude` y `codex` quedan declarados como no soportados hasta verificarlos.
- `--auto` (aprobacion automatica de permisos) no se pasa por defecto: el worker puede quedar esperando permiso en la TUI.
- El estado del run vive en `contextbase/swarm/` (ignorado por git). La bitacora durable sigue siendo `changelog.md`.
