<!-- CONTEXTBASE:START -->
<!-- CONTEXTBASE:v1.5.0 -->
## Memoria Persistente y Bitácora del Proyecto (contextbase)
Este proyecto utiliza un sistema automático de memoria técnica persistente en la carpeta `contextbase/`.

### Protocolo Automático Obligatorio para Agentes (OpenCode, Kilo, Claude, Cursor, Windsurf):
1. **Inicio Automático de Sesión:** Al comenzar cualquier tarea o turno sin contexto previo, consultar inmediatamente `contextbase_context` (vía MCP) o leer `contextbase/strands/context.json` sin esperar a que el usuario lo pida.
2. **Cierre Automático en `contextbase/changelog.md`:** Toda corrección, mejora o implementación debe registrarse antes de finalizar la respuesta usando `contextbase_log` o editando `## Cambios Realizados` con fecha y actualizando `## Cambios por Hacer`.
3. **Gestión Automática en `contextbase/tasklist.md`:** Marcar con `[x]` las tareas completadas (`contextbase_task` con `action: "done"`) y registrar con `[ ]` cualquier nuevo pendiente (`action: "add"`).
4. **Arquitectura en `contextbase/fundamentos.md`:** Ejecutar `contextbase_sync` o actualizar si hubo cambios en arquitectura, dependencias, scripts o reglas operativas.
5. **Idioma:** Toda salida, bitácora y documentación debe mantenerse estrictamente en **español**.
6. **Mantenimiento Preventivo Automático:** Al iniciar sesión y al cerrar cambios de dependencias, revisar `contextbase/componentes.md` y regenerarlo con `contextbase_audit` o `contextbase audit`.
<!-- CONTEXTBASE:END -->
