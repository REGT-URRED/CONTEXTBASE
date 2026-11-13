# ContextBase

Memoria técnica persistente, Red de Agentes en Telaraña (`web` / `telarana` / `swarm`), Árbitro Automático (`PASS` / `REFIX` / `RERUN` / `FAIL`) y Economía de Tokens 100% automática para proyectos trabajados con agentes de código (OpenCode, Kilo Code, Claude Code, Cursor, Windsurf, Antigravity).

`Zero dependencies` · `Node.js ESM` · `Windows / Linux / macOS` · `MIT`

> **Filosofía Central:** *"No es la IA, es quien controla a la IA"*

---

## El problema

Cada sesión con un agente empieza en blanco: no recuerda decisiones, pendientes, deuda técnica ni qué se rompió la última vez. Además, cuando se despliegan múltiples agentes en paralelo sin aislamiento ni arbitraje, se pisan los mismos archivos, disparan el consumo de tokens y las herramientas pasivas fallan si el usuario olvida invocarlas manualmente.

## La solución autónoma y en Telaraña

ContextBase opera de extremo a extremo sin requerir invocación manual durante el uso en OpenCode, Kilo Code, Claude Code, Cursor y Windsurf:

1. **Autoconfiguración y Auto-Reparación (`postinstall` / `autoEnsure` / `contextbase auto`):** Registra el servidor MCP `contextbase`, preaprueba los permisos (`"contextbase_*": "allow"`), registra `"plugin"` en `opencode.json` y `kilo.json`, e instala los plugins de ciclo de vida en `.opencode/plugins/`, `.opencode/plugin/`, `.kilo/plugins/`, `.kilo/plugin/` y `.kilocode/`. Si el proyecto cambia de carpeta o máquina, el plugin resuelve dinámicamente el binario de `contextbase` y `autoEnsure` repara cualquier ruta rota al instante.
2. **Inyección automática al abrir sesión:** El plugin nativo (`contextbase-auto.js`), el hook `SessionStart` y la respuesta `initialize` del servidor MCP inicializan `contextbase/` si aún no existe e inyectan el digest compacto del proyecto directamente en el prompt del sistema antes del primer turno. Si la terminal se abre dentro del worktree de una Araña (`.worktrees/swarm-*`), inyecta automáticamente su hilo asignado, sus 3 subagentes secuenciales y las órdenes de corrección (`refix.md`).
3. **Sincronización y Arbitraje automático tras cada edición y al cerrar turno:** El observador en tiempo real (`watcher.js`) y los hooks `tool.execute.before`, `tool.execute.after`, `session.idle` y `Stop` protegen el aislamiento de cada hilo, actualizan `fundamentos.md`, registran el cambio en `changelog.md`, sincronizan `TODO`/`FIXME` en `tasklist.md`, auto-completan `result.md` y `status.json` en worktrees de Arañas y disparan el **Árbitro Automático**.

---

## Arquitectura de la Telaraña y Control Automático (`src/web.js` + `src/swarm.js`)

| Elemento | Cómo funciona en ContextBase v1.5.0 |
| :--- | :--- |
| **1. La Presa (`--prey` / `--task`)** | Escribes tu objetivo en lenguaje humano desde la Zona de Flujo (`contextbase web start --prey "..." --spiders 3`) y `decomposePrey` lo divide automáticamente en segmentos y reparte los archivos del proyecto en hilos disjuntos (`assignedFiles`) para evitar que dos agentes toquen el mismo archivo. |
| **2. Las Arañas e Hilos Aislados (`worktrees`)** | Cada terminal abre una Araña (`OpenCode` o `Kilo Code`) en su propio `.worktrees/swarm-<run>-w<i>` y rama `swarm/<run>/w<i>`, con una copia de `contextbase/` pre-hidratada (`hydrateWorktreeMemory`) y plugins activos para que ya tenga la memoria del proyecto sin re-escanear desde cero. |
| **3. Subagentes Secuenciales por Terminal (`subagents.json`)** | Cada Araña recibe en `task.md` y `subagents.json` una cadena estricta de 3 subagentes secuenciales con presupuesto acotado de tokens (sin subagentes anidados recursivos): **1. Explorador de Hilo** (lee solo `contextbase/` y sus archivos asignados) → **2. Constructor Focalizado** (implementa el cambio en su worktree) → **3. Verificador y Árbitro Local** (valida pruebas, pasa `antislop` y escribe `result.md` y `status.json`). |
| **4. Economía de Tokens (Modelos Básicos → Avanzados)** | `calculateTokenEconomy` mide los tokens del repositorio completo frente al micro-contexto entregado a cada hilo, logrando ahorros típicos del **70% al 95% de tokens** para que modelos básicos o económicos operen con precisión de modelos sofisticados sin saturar su ventana de contexto. |
| **5. Árbitro Automático (`arbitrate` / `judge`)** | `contextbase web arbitrate` (o vía MCP con `arbitrate: true`) evalúa cada Araña sobre 100 puntos (contrato `result.md`, `status.json`, `0` hallazgos en `slop`, aislamiento de hilo y `git merge-tree` limpio) y ejecuta la acción sin intervención manual: **PASS** (pasa/bien), **REFIX** (escribe `refix.md` con los defectos exactos y re-inyecta la orden a la Araña), **RERUN** (relanza Arañas en `stale` o bloqueadas) o **FAIL** (corta bucles tras 2 intentos y escala al humano). |
| **6. Zona Final del Programador (`flow.md` y `metrics.json`)** | Todo queda organizado dentro de `contextbase/web/<run>/` (y sincronizado en `contextbase/swarm/<run>/`) con el reporte `flow.md`, el estado de flujo (`EN_ZONA`, `AUTOCORRIGIENDO` o `ATENCION_HUMANA`), los veredictos por hilo y el ahorro de tokens. |

### Comandos principales para operar desde tu Zona de Flujo

- **Lanzar la Telaraña sobre la Presa:** `contextbase web start --prey "tu objetivo en texto humano" --spiders 3` (también acepta `contextbase telarana` o `contextbase swarm`).
- **Ejecutar el Árbitro Automático y autocorrección (`PASS` / `REFIX` / `RERUN` / `FAIL`):** `contextbase web arbitrate`
- **Consultar el tablero de la Zona de Flujo y ahorro de tokens:** `contextbase web flow` (o `contextbase web metrics --json`).
- **Verificar e integrar hilos sin romper la telaraña:** `contextbase web weave [--merge]`
- **Reunir resultados y cerrar sesiones:** `contextbase web collect` y `contextbase web stop`.
- **Identificar y gestionar terminales de agente abiertas para este proyecto:** `contextbase terminals` (list), `contextbase terminals close <pid...|all> [--yes] [--force]` (dry-run por defecto; nunca cierra el árbol propio) y `contextbase terminals send <pid> --message "..."` (opencode y kilo, contrato nativo `run --session`).
- **Autogestión:** ContextBase cierra solo las terminales de sus propias Arañas cuando el trabajo terminó (`contextbase terminals auto`, y automático en cada hook y en `web collect`) y gestiona el SDK de Strands por sí solo (`contextbase strands sdk --status|--install`; instalación automática en segundo plano al preparar el contexto).

---

## Instalación

```bash
# global, desde el release de GitHub (autoconfigura el entorno global en postinstall)
npm install -g https://github.com/REGT-URRED/CONTEXTBASE/releases/latest/download/contextbase.tgz

# o desde el codigo
git clone https://github.com/REGT-URRED/CONTEXTBASE.git
cd CONTEXTBASE && npm link && contextbase auto --global
```

Verificar:

```bash
contextbase --version
contextbase status
```

---

## Compatibilidad Automática

| Entorno | Mecanismo Automático |
| :--- | :--- |
| **OpenCode** | `opencode.json` (MCP + `plugin` + `permission: allow`) + `.opencode/plugins/contextbase-auto.js` + `.opencode/plugin/contextbase-auto.js` + `AGENTS.md` + Skill |
| **Kilo Code** | `kilo.json` (MCP + `plugin` + `permission: allow`) + `.kilo/plugins/contextbase-auto.js` + `.kilo/plugin/contextbase-auto.js` + `.kilo/rules/contextbase.md` + `.kilocode/mcp.json` |
| **Claude Code** | `.mcp.json` + `.claude/settings.json` (`SessionStart`, `PostToolUse`, `Stop`) + `CLAUDE.md` + Skill |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/contextbase.mdc` (`alwaysApply: true`) + `.cursorrules` |
| **Windsurf** | `.windsurf/mcp.json` + `.windsurfrules` |
| **Antigravity / Gemini CLI** | `AGENTS.md` + `.gemini/rules/contextbase.md` + Skill global |

---

## Arquitectura de Archivos

```
bin/contextbase.js      entrada CLI
src/cli.js              router y comandos principales
src/cli_extra.js        comandos de Telaraña (web/telarana/swarm), arbitraje, flujo y herramientas
src/web.js              motor de Telaraña: decomposePrey, hydrateWorktreeMemory, subagents.json, Árbitro Automático y Economía de Tokens
src/swarm.js            gestión de worktrees, ramas, estado espejado y sesiones de Arañas
src/swarm-agents.js     lanzadores por terminal para OpenCode y Kilo Code
src/terminals.js        control de terminales de agente abiertas (list/close/send) con protección propia
src/auto.js             automatización silenciosa, auto-reparación de configs y pulso de Telaraña
src/autoconfig.js       autoconfiguración resiliente de MCP, permisos y plugins (OpenCode, Kilo, Claude, Cursor)
src/watcher.js          observador en tiempo real, sincronización del árbol de trabajo y arbitraje continuo
src/hooks.js            hooks Git y ejecutor de ciclo de vida (session-start, post-tool, session-stop, web-pulse)
src/mcp.js              servidor MCP stdio (26 tools, resources, prompts, instrucciones vivas y watcher)
src/scanner.js          escaneo, metadatos, Repomix, redacción
src/generator.js        documentos y bloque sincronizado
src/maintenance.js      inventario, frescura y brechas
src/context.js          estado, digest y salud
src/changelog.js        bitácora y rotación
src/fsutil.js           escritura atómica y bloqueo
src/rules.js            inyección de reglas con versión
src/review.js           revisión tipo thermos: diff, contenidos, prompts y merge
src/redundancy.js       redundancia del entorno global
src/slop.js             delivery gate antislop sobre líneas agregadas
src/installer.js        Skill y plugins globales multi-CLI
src/export.js           exportación JSON/HTML
src/strands.js          contexto Python y runner para Strands
skills/contextbase/     definición de la Skill
```

---

## Pruebas

```bash
npm test
```

---

## Licencia

MIT
