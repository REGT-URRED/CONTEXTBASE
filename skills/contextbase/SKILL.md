---
name: contextbase
description: Sistema universal y minimalista de memoria persistente técnica automática, bitácora y lista de tareas para agentes de código (OpenCode, Kilo Code, Claude Code, Cursor, Windsurf, Antigravity, etc.).
---

# ContextBase: Memoria Técnica Persistente y Bitácora Automática

ContextBase mantiene la continuidad técnica, el contexto persistente y la trazabilidad entre sesiones de trabajo para agentes de código y desarrolladores sin requerir ejecución manual.

## Activación Automática Cero-Intervención
ContextBase opera de manera 100% automática en OpenCode, Kilo Code, Claude Code, Cursor y otros entornos:

1. **Al instalar globalmente (`postinstall` o `contextbase auto`):**
   - Registra automáticamente el servidor MCP `contextbase`, los permisos preaprobados (`contextbase_*`) y el plugin de ciclo de vida (`contextbase-auto.js`) en los directorios globales y del proyecto.
2. **Al iniciar cualquier sesión en OpenCode, Kilo o Claude Code:**
   - Si `contextbase/` no existe en el proyecto, `autoEnsure` lo inicializa de inmediato sin pedir confirmación.
   - El plugin nativo (`.opencode/plugins/contextbase-auto.js` / `.kilo/plugins/contextbase-auto.js`), el hook `SessionStart` (`.claude/settings.json`) y la respuesta `initialize` de MCP inyectan el digest vivo del proyecto directamente en el contexto del modelo.
3. **Durante y al finalizar cada turno:**
   - El observador en segundo plano (`watcher.js`) y los hooks `tool.execute.after` / `session.idle` / `Stop` detectan los archivos modificados, sincronizan `fundamentos.md`, registran la actividad en `changelog.md`, extraen nuevos `TODO`/`FIXME` hacia `tasklist.md` y regeneran `contextbase/strands/`.

---

## Protocolo Automático Obligatorio para Agentes
> Toda corrección, mejora, alteración o nueva implementación en el código debe incluir, como paso final y obligatorio, la actualización de los registros dentro de `contextbase/`:
>
> 1. **`contextbase/changelog.md`:** Registrar la entrada bajo `## Cambios Realizados` (`contextbase_log`) y actualizar `## Cambios por Hacer`.
> 2. **`contextbase/tasklist.md`:** Marcar con `[x]` las tareas completadas (`contextbase_task` con `action="done"`) y registrar con `[ ]` las pendientes (`action="add"`).
> 3. **`contextbase/fundamentos.md`:** Sincronizar con `contextbase_sync` si se modificó la arquitectura o dependencias.
> 4. **Idioma:** Toda la documentación debe mantenerse estrictamente en **español**.
> 5. **Mantenimiento preventivo:** Revisar y regenerar `contextbase/componentes.md` con `contextbase_audit` o `contextbase audit` al iniciar sesión y al cerrar cambios de dependencias.

---

## Comandos CLI de Soporte
- `contextbase auto` / `contextbase setup`: Configura automáticamente OpenCode, Kilo, Claude, Cursor, plugins, permisos y hooks en el proyecto o globalmente (`--global`).
- `contextbase watch [start|stop|status]`: Observador en tiempo real que sincroniza cambios del árbol de trabajo hacia `contextbase/`.
- `contextbase init`: Inicializa o repara `contextbase/` y todas las integraciones de agentes.
- `contextbase status` / `check`: Estado visual o estructurado (`--json`, `--check`).
- `contextbase context`: Digest compacto (pendientes, progreso, brechas, siguiente acción).
- `contextbase task add|done|list "<tarea>"`: Gestiona tareas en `tasklist.md`.
- `contextbase log "<mensaje>"`: Registra un cambio en `changelog.md`.
- `contextbase sync`: Sincroniza `fundamentos.md`, cambios del árbol de trabajo y reglas de agentes.
- `contextbase audit`: Regenera `contextbase/componentes.md` (inventario, frescura y brechas).
- `contextbase hook [install|remove]`: Instala hooks Git (`post-commit`, `post-merge`, `post-checkout`).
- `contextbase mcp`: Servidor MCP sobre stdio con 24 tools, resources, prompts y watcher activo.
- `contextbase review [base] [--intent "texto"]`: Paquete de revisión tipo thermos.
- `contextbase redundancy [--json]`: Detecta redundancia global en skills, referencias y MCP.
- `contextbase slop [base] [--json]`: Escanea el diff con las reglas heurísticas antislop.
- `contextbase export <estado|digest> [json|html] [archivo]`: Exporta estado o digest.
- `contextbase bootstrap` / `guard` / `snapshot` / `restore` / `tools`: Gestión y protección del entorno base.

### Recursos, Prompts y Tools MCP
- **24 Tools:** `contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`, `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`, `contextbase_review`, `contextbase_redundancy`, `contextbase_slop`, `contextbase_export`, `contextbase_strands_prepare`, `contextbase_init`, `contextbase_hook`, `contextbase_mission`, `contextbase_swarm_start`, `contextbase_swarm_status`, `contextbase_swarm_send`, `contextbase_swarm_collect`, `contextbase_swarm_stop`.
- **Resources:** `contextbase://digest`, `contextbase://state`, `contextbase://fundamentos`, `contextbase://changelog`, `contextbase://tasklist`, `contextbase://componentes`, `contextbase://strands/context`.
- **Prompts:** `contextbase_session`, `contextbase_mission`.

## Enjambre de agentes (swarm)
Cuando el usuario pida trabajo en paralelo, varios agentes, o "enjambre":

1. `contextbase swarm start --task "<objetivo>" --workers N [--agent opencode|kilo]` crea N worktrees, N ramas y N sesiones.
2. Pasa los session ids al orquestador para que reparta tareas.
3. `contextbase swarm status` informa quién avanza, quién está `stale` y quién terminó.
4. `contextbase swarm send --worker w1 --message "..."` redirige a un worker vivo.
5. `contextbase swarm collect` lee `result.md` y el veredicto de merge por rama.
6. `contextbase swarm stop` detiene procesos al cerrar.
