# Instrucciones para Agentes de Código

<!-- CONTEXTBASE:START -->
<!-- CONTEXTBASE:v1.5.0 -->
## Memoria Persistente, Telaraña de Agentes y Bitácora Automática (contextbase)
> **Filosofía Central:** *"No es la IA, es quien controla a la IA"*

Este proyecto utiliza un sistema autónomo de memoria técnica persistente y Red de Agentes en Telaraña en la carpeta `contextbase/`.

### Protocolo Automático Obligatorio para Agentes (OpenCode, Kilo, Claude, Cursor, Windsurf):
1. **Inicio Automático de Sesión (Cero Intervención Manual):** Al comenzar cualquier tarea o turno, consultar inmediatamente `contextbase_context` (vía MCP) o leer `contextbase/strands/context.json` sin esperar a que el usuario lo pida. Si operas dentro de un worktree de Araña (`.worktrees/swarm-*`), lee `contextbase/.spider-context.json`, `task.md` y `subagents.json`.
2. **Red de Agentes en Telaraña (`web` / `telarana` / `swarm`):**
   - Cuando el objetivo abarque múltiples módulos o trabajo paralelo, lanza la Telaraña sobre la Presa: `contextbase web start --prey "<objetivo>" --spiders N` (o vía MCP `contextbase_swarm_start`).
   - Cada Araña trabaja en su propio worktree aislado con memoria pre-hidratada, hilo disjunto de archivos (`assignedFiles`) y 3 subagentes secuenciales por terminal (`1. Explorador de Hilo` -> `2. Constructor Focalizado` -> `3. Verificador y Árbitro Local`), sin desplegar subagentes recursivos descontrolados.
   - Ejecuta el Árbitro Automático (`contextbase web arbitrate` o `contextbase_swarm_status` con `arbitrate: true`) para evaluar sobre 100 puntos (`PASS` / `REFIX` / `RERUN` / `FAIL`) y mantener la Zona de Flujo (`flow.md` y `metrics.json`).
3. **Cierre Automático en `contextbase/changelog.md`:** Toda corrección, mejora o implementación debe registrarse antes de finalizar la respuesta usando `contextbase_log` o editando `## Cambios Realizados` con fecha y actualizando `## Cambios por Hacer`.
4. **Gestión Automática en `contextbase/tasklist.md`:** Marcar con `[x]` las tareas completadas (`contextbase_task` con `action: "done"`) y registrar con `[ ]` cualquier nuevo pendiente (`action: "add"`).
5. **Arquitectura en `contextbase/fundamentos.md`:** Ejecutar `contextbase_sync` o actualizar si hubo cambios en arquitectura, dependencias, scripts o reglas operativas.
6. **Idioma:** Toda salida, bitácora y documentación debe mantenerse estrictamente en **español**.
7. **Mantenimiento Preventivo Automático:** Al iniciar sesión y al cerrar cambios de dependencias, revisar `contextbase/componentes.md` y regenerarlo con `contextbase_audit` o `contextbase audit`.
<!-- CONTEXTBASE:END -->
