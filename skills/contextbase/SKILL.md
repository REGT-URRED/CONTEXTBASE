---
name: contextbase
description: Sistema universal y autónomo de memoria técnica persistente, Red de Agentes en Telaraña (web/swarm) con Árbitro Automático (PASS/REFIX/RERUN/FAIL) y Economía de Tokens para OpenCode, Kilo Code, Claude Code, Cursor y Windsurf.
---

# ContextBase: Memoria Técnica Persistente y Red de Agentes en Telaraña

> **Filosofía Central:** *"No es la IA, es quien controla a la IA"*

ContextBase mantiene la continuidad técnica, el contexto persistente y la orquestación paralela de agentes en una **Telaraña (`web` / `telarana` / `swarm`)** sin requerir ejecución manual.

## Activación Automática Cero-Intervención
ContextBase opera de manera 100% automática en OpenCode, Kilo Code, Claude Code, Cursor y otros entornos:

1. **Auto-reparación y configuración automática (`postinstall`, `autoEnsure`, `contextbase auto`):**
   - Registra y repara automáticamente el servidor MCP `contextbase`, los permisos preaprobados (`contextbase_*`) y el plugin de ciclo de vida (`contextbase-auto.js`) en `.opencode/plugins/`, `.opencode/plugin/`, `.kilo/plugins/`, `.kilo/plugin/`, `.kilocode/`, `opencode.json`, `kilo.json` y `.mcp.json`.
   - El plugin resuelve dinámicamente el binario de `contextbase` aunque el proyecto se mueva de carpeta o se ejecute dentro de un worktree `.worktrees/swarm-*`.
2. **Al iniciar cualquier sesión en OpenCode, Kilo o Claude Code:**
   - Si `contextbase/` no existe, `autoEnsure` lo inicializa de inmediato sin pedir confirmación.
   - Si la sesión corre dentro del worktree de una Araña (`.worktrees/swarm-<run>-w<i>`), inyecta automáticamente su misión (`task.md`), su hilo disjunto de archivos (`assignedFiles`), sus 3 subagentes secuenciales (`subagents.json`) y las órdenes de autocorrección (`refix.md`).
3. **Durante y al finalizar cada turno:**
   - En los worktrees de Arañas, el plugin bloquea ediciones sobre archivos asignados a otras Arañas (`forbiddenFiles`) para que ningún hilo rompa la telaraña, auto-sintetiza `result.md` y `status.json` al cerrar sesión si faltaban, y dispara el **Árbitro Automático** en la raíz del proyecto.

---

## Arquitectura de la Telaraña y Control Automático (`src/web.js` + `src/swarm.js`)

1. **La Presa (`--prey` / `--task`):**
   - Escribes tu objetivo en lenguaje humano (`contextbase web start --prey "..." --spiders 3`) y `decomposePrey` lo divide automáticamente en segmentos y reparte los archivos del proyecto en hilos disjuntos (`assignedFiles`) para evitar que dos Arañas toquen el mismo archivo.
2. **Las Arañas e Hilos Aislados (worktrees):**
   - Cada terminal abre una Araña (`OpenCode` o `Kilo Code`) en su propio `.worktrees/swarm-<run>-w<i>` y rama `swarm/<run>/w<i>`, con `contextbase/` pre-hidratado (`hydrateWorktreeMemory`) y plugins activos.
3. **Subagentes Secuenciales por Terminal (`subagents.json`):**
   - Cada Araña ejecuta una cadena estricta de 3 subagentes secuenciales sin anidar subagentes recursivos:
     1. **Explorador de Hilo (25% tokens):** Lee solo `contextbase/` y sus archivos asignados.
     2. **Constructor Focalizado (50% tokens):** Implementa el cambio exclusivamente en su worktree e hilo.
     3. **Verificador y Árbitro Local (25% tokens):** Valida pruebas, pasa `antislop` y escribe `result.md` y `status.json`.
4. **Economía de Tokens (Modelos Básicos → Avanzados):**
   - `calculateTokenEconomy` mide los tokens del repositorio completo frente al micro-contexto entregado a cada hilo, logrando ahorros del 70% al 95% de tokens.
5. **Árbitro Automático (`arbitrate` / `judge`):**
   - `contextbase web arbitrate` (o vía MCP con `arbitrate: true`) evalúa cada Araña sobre 100 puntos (`result.md`, `status.json`, `0` hallazgos en `slop`, aislamiento de hilo y `git merge-tree` limpio) y aplica sin intervención manual:
     - **PASS**: Hilo aprobado y listo para tejer.
     - **REFIX**: Escribe `refix.md` con los defectos exactos y re-inyecta la orden a la Araña.
     - **RERUN**: Relanza Arañas en `stale` o bloqueadas.
     - **FAIL**: Corta bucles tras 2 intentos y escala a `ATENCION_HUMANA`.
6. **Zona Final del Programador (`flow.md` y `metrics.json`):**
   - Todo queda organizado y espejado en `contextbase/web/<run>/` y `contextbase/swarm/<run>/` con el estado de flujo (`EN_ZONA`, `AUTOCORRIGIENDO` o `ATENCION_HUMANA`).

## Comandos Principales de la Zona de Flujo
- `contextbase web start --prey "tu objetivo en texto humano" --spiders 3` (también acepta `contextbase telarana` o `contextbase swarm`)
- `contextbase web arbitrate` (ejecuta el Árbitro Automático: `PASS` / `REFIX` / `RERUN` / `FAIL`)
- `contextbase web flow` y `contextbase web metrics --json` (tablero de Zona de Flujo y ahorro de tokens)
- `contextbase web weave [--merge]` (verifica que ningún hilo rompa a otro y teje las ramas en `PASS`)
- `contextbase web collect` y `contextbase web stop`
