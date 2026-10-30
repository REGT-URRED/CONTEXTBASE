---
name: contextbase
description: Sistema universal y minimalista de memoria persistente técnica, bitácora y lista de tareas para agentes de código (Antigravity, Claude Code, Cursor, OpenCode, Kilo, Kimi Code, etc.).
---

# ContextBase: Memoria Técnica Persistente y Bitácora Universal

ContextBase garantiza la continuidad técnica, contexto persistente y trazabilidad entre sesiones de trabajo para agentes de código y desarrolladores.

## Directiva de Inicialización ("Instala esto...")
Cuando el usuario indique "instala esto", "inicializa memoria" o se trabaje en un proyecto sin bitácora técnica:

1. Ejecutar en terminal:
   ```bash
   contextbase init
   ```
   *(O simplemente `contextbase` - detecta automáticamente si `contextbase/` falta y lo crea).*

2. Esto ejecutará secuencialmente:
   - Creación de `contextbase/`
   - Generación de `contextbase/fundamentos.md` con objetivos, arquitectura y reglas.
   - Creación de `contextbase/changelog.md` con historial metódico ("Cambios realizados" y "Cambios por hacer").
   - Creación de `contextbase/tasklist.md` con formato visual `[x]` y `[ ]`.
   - Escaneo retroactivo y volcado de datos reales del proyecto.
   - Inyección de directivas en `AGENTS.md`, `CLAUDE.md`, `.cursorrules` y `.windsurfrules`.

> **Garantía de Auto-Creación:** Si ejecutas cualquier comando (`status`, `task add`, `log`, etc.) en un proyecto que aún no tiene `contextbase/`, la herramienta lo inicializará automáticamente antes de procesar la orden.

---

## Regla Crítica de Actualización (Obligatoria para Agentes)
> **Directiva Fundamental:** Toda futura corrección, mejora, alteración o nueva implementación en el código debe incluir SIEMPRE, como paso final y obligatorio, la actualización de los registros dentro de la carpeta `contextbase/`:
>
> 1. `contextbase/changelog.md`: Registrar la entrada bajo `## Cambios Realizados` y actualizar `## Cambios por Hacer`.
> 2. `contextbase/tasklist.md`: Marcar con `[x]` las tareas completadas y registrar con `[ ]` las pendientes.
> 3. `contextbase/fundamentos.md`: Actualizar si se modificó la arquitectura o dependencias.
> 4. Idioma: Toda la documentación debe mantenerse estrictamente en **español**.
>
> 5. **Mantenimiento preventivo:** revisar y regenerar `contextbase/componentes.md` con `contextbase audit` al iniciar un proyecto o sesión y como verificación final al cerrar cada cambio (componentes, versiones instaladas y brechas de seguridad). Delegar en la CLI, sin saturar las instrucciones del agente.

---

## Comandos CLI de Soporte Rápido
- `contextbase status`: Ver estado visual de memoria, tareas completadas vs pendientes.
- `contextbase task add "<tarea>"`: Agregar una tarea pendiente a `tasklist.md`.
- `contextbase task done "<tarea>"`: Marcar tarea como completada en `tasklist.md`.
- `contextbase log "<mensaje>"`: Registrar un cambio en `changelog.md`.
- `contextbase pack`: Empaquetar el repositorio estilo Repomix para análisis en contexto.
- `contextbase dump`: Volcar todo el contenido de contextbase para alimentar el prompt.
- `contextbase audit`: Regenerar el inventario de componentes, su frescura de versiones y la verificación de brechas de seguridad conocidas en `contextbase/componentes.md`.
- `contextbase context`: Digest compacto (pendientes, progreso, brechas, siguiente acción) para iniciar sesión con poco contexto.
- `contextbase status --json` / `--check`: estado estructurado para agentes y CI; `--check` sale con código 1 si hay problemas.
- `contextbase sync`: Sincroniza el bloque técnico de `fundamentos.md` y reinyecta reglas sin borrar notas manuales.
- `contextbase hook`: Autoguardado; registra cada commit en `changelog.md` mediante hook `post-commit`.
- `contextbase mcp`: Servidor MCP sobre stdio con tools nativas para agentes compatibles.
- `contextbase review [base] [--intent "texto"]`: Paquete de revisión tipo thermos: diff contra `base`, contenidos de archivos cambiados, intención del usuario y los dos prompts de revisor.
- `contextbase review prompts`: Imprime solo los dos prompts de revisor.
- `contextbase review merge <reporte-a.md> <reporte-b.md>`: Fusiona dos reportes; exige exactamente dos archivos y falla con otra cantidad.
- `contextbase redundancy [--json]`: Detecta redundancia global (skills duplicados, referencias rotas, bloques de `AGENTS.md` y MCP duplicados) e informa las skills principales.
- `contextbase slop [base] [--json]`: Escanea el árbol de trabajo contra `base` (inferida si se omite) con las reglas heurísticas de antislop.
- `contextbase bootstrap`: Prepara el entorno de agentes (detecta/instala/init/snapshot).
- `contextbase guard`: Verifica la integridad de los archivos base y repara desde fuentes oficiales.
- `contextbase snapshot`: Crea un punto de restauración de archivos base.
- `contextbase restore [id]`: Restaura archivos base desde un snapshot.
- `contextbase tools list|enable|disable`: Gestiona las herramientas del registro.

### Tools MCP

El servidor expone 14 tools: `contextbase_status`, `contextbase_context`, `contextbase_log`, `contextbase_task`, `contextbase_audit`, `contextbase_sync`, `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`, `contextbase_review`, `contextbase_redundancy`, `contextbase_slop`.

## Enjambre de agentes (swarm)

Cuando el usuario pida trabajo en paralelo, varios agentes, o "enjambre":

1. `contextbase swarm start --task "<objetivo>" --workers N` crea N worktrees, N ramas y N sesiones. Devuelve los session ids.
2. Pasa los session ids al orquestador para que reparta tareas.
3. `contextbase swarm status` para saber quien avanza, quien esta `stale` y quien termino.
4. `contextbase swarm send --worker w1 --message "..."` para redirigir a un worker vivo.
5. `contextbase swarm collect` para leer `result.md` y el veredicto de merge por rama.
6. `contextbase swarm stop` al cerrar.

El canal real es archivo, no pantalla: `task.md` de entrada, `result.md` y `status.json` de salida. Nunca parsees la salida de la terminal del worker.
