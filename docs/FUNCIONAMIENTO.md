# Funcionamiento de ContextBase

## 1. Qué es y qué problema resuelve

ContextBase es una memoria técnica persistente para agentes de código. Mantiene en el
repositorio el contexto que normalmente se pierde entre sesiones: arquitectura, decisiones,
cambios realizados, tareas pendientes, inventario de componentes y estado de seguridad.

El proyecto es Node.js ESM y no tiene dependencias externas. La carpeta `contextbase/` es la
fuente de verdad; la CLI y el servidor MCP solo la crean, la leen, la sincronizan y la protegen.
Los archivos se escriben de forma atómica y con bloqueo para tolerar varios agentes a la vez.

Objetivos concretos:

- Evitar que cada sesión empiece sin saber qué se hizo, qué falta y qué reglas rigen.
- Mantener una bitácora y una lista de tareas verificables, no solo conversación.
- Detectar deriva en los archivos de reglas de los agentes.
- Exponer el mismo estado por CLI y por MCP, sin duplicar lógica.
- Delegar el mantenimiento en automatismos para que el usuario no memorice comandos.

## 2. Flujo automático actual

La operación normal no requiere que el usuario recuerde comandos. El agente usa MCP o la CLI y
ContextBase se encarga del ciclo de vida.

1. **Inicialización automática si falta memoria.** `ensureContextBase` (CLI) y `autoEnsure`
   (MCP y automatismos) comprueban que existan `contextbase/`, `fundamentos.md`,
   `changelog.md` y `tasklist.md`. Si falta algo, ejecutan `silentInit`: escaneo del proyecto,
   generación de documentos, inventario de componentes, inyección de reglas, baseline y
   contexto Strands. No se pide confirmación.
2. **`autoEnsure` en cada uso MCP.** El servidor MCP lo ejecuta al arrancar y antes de cada
   `tools/call`. Así, una sesión nueva encuentra la memoria completa aunque el repositorio se
   haya clonado sin `contextbase/` o con archivos parciales.
3. **`refreshComponents` si `componentes.md` supera 7 días.** `autoEnsure` revisa la fecha de
   modificación y ejecuta el mantenimiento preventivo cuando el informe está vencido.
4. **`refreshStrands` si el contexto Strands está viejo.** `context.json` se compara contra la
   fecha más reciente de `tasklist.md`, `changelog.md`, `componentes.md` y `fundamentos.md`.
   Si el contexto es anterior, se regeneran todos los archivos de `contextbase/strands/`.
5. **Sincronización tras `log`, `task`, `audit` y `sync`.** Cada uno de esos comandos refresca
   el contexto Strands. En MCP, las tools que mutan estado también lo refrescan después de
   ejecutarse.
6. **Hook post-commit.** Si se instala con `contextbase hook install` (o con la tool MCP
   `contextbase_hook`), cada commit agrega una entrada al changelog con el hash corto y el
   asunto. No sobrescribe un `post-commit` ajeno.
7. **Baseline tras inyección legítima de reglas.** `init`, `sync` y `silentInit` actualizan la
   línea base después de inyectar el bloque de reglas. Así el guardia no confunde una
   actualización deliberada con una manipulación. Los archivos ausentes conservan su entrada
   previa en lugar de borrarse.

El usuario no necesita ejecutar `init`, `sync`, `audit` ni `strands_prepare` para trabajar.
Esos comandos siguen disponibles para diagnóstico, automatización o reparación manual.

## 3. Archivos que crea y mantiene

- `contextbase/fundamentos.md`: objetivo, reglas de desarrollo, arquitectura, módulos y bloque
  técnico sincronizado. Es la referencia estable del proyecto.
- `contextbase/changelog.md`: bitácora con fecha. Las entradas antiguas rotan a
  `changelog-AAAA.md` cuando se supera el límite configurado.
- `contextbase/tasklist.md`: tareas pendientes `[ ]` y completadas `[x]`. Es la fuente de verdad
  de las tareas; los archivos Python de Strands son una vista generada.
- `contextbase/componentes.md`: inventario de componentes, frescura de versiones y brechas de
  seguridad. Se regenera con `contextbase audit` o de forma automática cuando vence.
- `contextbase/baseline.json`: hashes SHA-256 y fechas de modificación de los archivos
  protegidos por el guardia, más la fecha de creación de la línea base.
- `contextbase/strands/context.json`: estado estructurado del proyecto en JSON.
- `contextbase/strands/project_context.py`: constantes y funciones de acceso al contexto.
- `contextbase/strands/strands_config.py`: configuración de agente, herramientas, enjambre y
  hooks.
- `contextbase/strands/tasks.py`: tareas como diccionarios de Python y helpers de consulta.
- `contextbase/strands/strands_runner.py`: ejecutable que arma el prompt, usa el SDK de Strands
  si está disponible y decide si escala al humano.
- `contextbase/strands/README.md`: documentación de la integración generada.
- `contextbase/swarm/`: estado de cada ejecución del enjambre, tareas, resultados y estados de
  los workers. Se crea solo cuando se usa swarm.
- `contextbase/guarded.json` (opcional): lista adicional de archivos que el guardia debe
  vigilar además de los archivos de reglas conocidos.

## 4. Integración Strands Agent (Python)

La generación es automática después de `log`, `task`, `audit`, `sync`, al iniciar MCP y cuando
`autoEnsure` detecta contexto viejo. La tool MCP `contextbase_strands_prepare` permite forzar
la regeneración.

Qué genera cada archivo:

- `context.json`: proyecto, directorio, archivos de memoria, tareas, seguridad, reglas, guardia,
  metadatos, lenguajes, historial Git y TODOs detectados.
- `project_context.py`: constantes como `PROJECT_NAME`, `PENDING_TASKS`, `NEXT_ACTION`,
  `SECURITY_ISSUES`, `GUARD_STATUS` y funciones como `get_pending_tasks()`,
  `get_security_issues()` y `has_guard_drift()`.
- `strands_config.py`: `AGENT_CONFIG`, `TOOLS_CONFIG`, `SWARM_CONFIG` y `HOOKS_CONFIG`.
- `tasks.py`: `TASKS`, `PENDING_TASKS`, `COMPLETED_TASKS`, `add_task` y `mark_done`. Los cambios
  hechos solo en memoria no sustituyen a `tasklist.md`; el registro real se hace con la CLI o
  MCP.
- `strands_runner.py`: prompt en español, importación opcional de `strands.Agent`, escalado y
  modo seco.

Importación típica desde el propio directorio `contextbase/strands`:

```python
from project_context import PROJECT_NAME, PROJECT_DIR, PENDING_TASKS, NEXT_ACTION
from strands_config import AGENT_CONFIG, TOOLS_CONFIG, HOOKS_CONFIG
from tasks import get_pending_tasks, mark_done

print(PROJECT_NAME, PROJECT_DIR)
for tarea in get_pending_tasks():
    print(tarea["id"], tarea["descripcion"])
```

Ejecución:

```bash
cd contextbase/strands
python strands_runner.py
```

Reglas de escalado:

- El runner escala al humano **solo** si hay vulnerabilidades `critical` o `high`, o si el
  guardia detecta deriva en archivos base. En ese caso imprime el motivo y sale con código 2.
- Si el SDK de Strands no está instalado, imprime el prompt completo en **modo seco** y sale
  con código 0. Esto permite inspeccionar el contexto sin instalar nada.
- Si el SDK está instalado y no hay urgencia, crea el agente con el modelo de `AGENT_CONFIG`,
  ejecuta el prompt y muestra el resultado.

## 5. MCP

El servidor MCP usa JSON-RPC 2.0 sobre stdio y no tiene dependencias. Se inicia con
`node bin/contextbase.js mcp` o con `contextbase mcp`. Las tools actuales son:

| Tool | Función |
| --- | --- |
| `contextbase_status` | Devuelve el estado estructurado de la memoria, tareas, seguridad y salud. |
| `contextbase_context` | Devuelve el digest compacto para iniciar una sesión. |
| `contextbase_log` | Registra un cambio en `contextbase/changelog.md`. |
| `contextbase_task` | Agrega, completa o lista tareas (`add`, `done`, `list`). |
| `contextbase_audit` | Regenera el inventario de componentes y las brechas de seguridad. |
| `contextbase_sync` | Sincroniza el bloque técnico de `fundamentos.md` y reinyecta reglas. |
| `contextbase_bootstrap` | Detecta e instala el entorno de agentes, ejecuta init y crea snapshot. |
| `contextbase_guard` | Verifica integridad de archivos base; permite reparar y mostrar deriva. |
| `contextbase_snapshot` | Crea un punto de restauración de los archivos base. |
| `contextbase_restore` | Restaura archivos base desde un snapshot. |
| `contextbase_tools` | Lista, habilita o deshabilita herramientas del registro. |
| `contextbase_review` | Prepara revisión tipo thermos, devuelve prompts o fusiona dos reportes. |
| `contextbase_redundancy` | Detecta skills duplicados, referencias rotas, bloques y MCP repetidos. |
| `contextbase_slop` | Aplica el delivery gate antislop sobre las líneas agregadas del diff. |
| `contextbase_export` | Exporta estado o digest en JSON o HTML, a pantalla o a archivo. |
| `contextbase_strands_prepare` | Regenera el contexto Python de Strands. |
| `contextbase_init` | Garantiza la memoria del proyecto y la inicializa si falta. |
| `contextbase_hook` | Instala o quita el hook post-commit de autoguardado. |
| `contextbase_mission` | Devuelve el prompt de misión de orquestación y testing. |
| `contextbase_swarm_start` | Lanza un run con un worktree, una rama y una sesión por worker. |
| `contextbase_swarm_status` | Devuelve el estado de los workers y detecta los que están en stale. |
| `contextbase_swarm_send` | Envía un mensaje a un worker o a todos. |
| `contextbase_swarm_collect` | Reúne los resultados y calcula el veredicto de merge por rama. |
| `contextbase_swarm_stop` | Detiene los procesos de los workers vivos del run. |

`initialize` devuelve instrucciones que recuerdan usar `contextbase_context` al iniciar y
`contextbase_strands_prepare` para trabajo autónomo con Strands.

## 6. CLI disponible (opcional)

La CLI es útil para administración y diagnóstico, pero no es obligatoria para la operación
normal. Comandos principales: `init`, `status`, `status --json`, `status --check`, `context`,
`log`, `task`, `sync`, `audit`, `pack`, `dump`, `hook`, `mcp`, `review`, `redundancy`, `slop`,
`export`, `bootstrap`, `guard`, `snapshot`, `restore`, `tools`, `swarm`, `mission`,
`install-skill` y `ensure`.

La razón por la que no hace falta memorizarlos es que el servidor MCP ejecuta la inicialización
y los refrescos automáticamente, y los comandos que mutan memoria ya disparan la regeneración
del contexto Strands.

## 7. Salud y seguridad

- `evaluateHealth` reúne los problemas: falta de `contextbase/`, `componentes.md` ausente o
  vencido, vulnerabilidades `critical`/`high`, reglas de agente desactualizadas y deriva del
  guardia.
- `status --check` devuelve código de salida 1 cuando `evaluateHealth` no está en orden; es
  apto para CI y para el cierre de una sesión.
- `status --json` entrega el mismo estado en formato estructurado para agentes y scripts.
- `guard` compara hashes y fechas contra `baseline.json`, detecta archivos faltantes, cambios y
  contenido sospechoso. La reparación solo usa fuentes oficiales incluidas en la lista blanca.
- `baseline.json` registra hash y mtime. `refreshBaseline` actualiza entradas después de una
  inyección legítima de reglas y conserva la entrada anterior si el archivo no existe.
- El empaquetado (`pack`) redacta secretos evidentes (claves, tokens y credenciales) y
  excluye archivos `.env`. La exportación solo vuelca estado o digest, no código fuente.
- `audit` consulta la frescura y las vulnerabilidades de los ecosistemas detectados: npm,
  pip/pip-audit, cargo audit y govulncheck cuando están disponibles.
- `snapshot` y `restore` permiten volver atrás si una reparación o un cambio de reglas sale
  mal.

## 8. Revisión de código

- `review` (thermos) arma un paquete con el diff, los contenidos relevantes, la intención y dos
  prompts de revisor. `review prompts` devuelve solo los prompts y `review merge` fusiona
  exactamente dos reportes.
- `slop` es el delivery gate antislop: revisa las líneas agregadas del árbol de trabajo contra
  una base, separa prosa de código y devuelve exit 1 si encuentra hallazgos.
- `redundancy` detecta skills duplicados, referencias rotas en commands/agents, bloques de
  `AGENTS.md` repetidos y servidores MCP duplicados.

## 9. Swarm

Swarm lanza trabajo paralelo real: un worktree, una rama `swarm/<run>/<worker>` y una sesión
por worker. El estado vive en `contextbase/swarm/<run>/` y el canal de trabajo es por archivos:
`task.md` de entrada, `result.md` y `status.json` de salida. El orquestador consulta con
`swarm status`, envía instrucciones con `swarm send`, reúne resultados con `swarm collect` y
detiene procesos con `swarm stop`.

Límites reales:

- Solo se lanza `opencode`, porque es el único agente con contrato de sesión y prompt verificado
  en este entorno. `claude` y `codex` figuran como no soportados hasta verificar su contrato.
- Strands se usa para preparar contexto Python, no para lanzar sesiones de swarm.
- La entrega de mensajes a una sesión viva depende de que el agente acepte inyección nativa; si
  no, el mensaje queda por archivo.
- Un worker en `stale` no produjo commits ni resultado dentro del TTL. Eso requiere decisión
  humana o del orquestador, no reintentos infinitos.
- No se lanzan sesiones sin contrato verificado ni se toca la rama principal desde un worker.

## 10. Límites y quién decide escalar al humano

ContextBase automatiza la memoria, el mantenimiento y la verificación, pero no decide por el
humano en asuntos de riesgo. El escalado es obligatorio cuando:

- Hay vulnerabilidades `critical` o `high` sin corregir.
- El guardia detecta deriva en archivos base (el runner Strands sale con código 2).
- Un worker queda bloqueado, falla o entra en stale sin resultado verificable.
- Hay conflictos de merge entre ramas del swarm.
- Se intenta usar un agente sin contrato de sesión verificado.

El agente puede corregir, registrar y volver a verificar, pero no debe inventar resultados ni
declarar sana una memoria con problemas. La decisión final sobre seguridad, conflictos y
cambios de alcance corresponde al humano.