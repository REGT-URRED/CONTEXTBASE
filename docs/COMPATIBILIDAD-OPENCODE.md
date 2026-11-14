# Compatibilidad con OpenCode: fallos que ya nos costaron caro

> Documento operativo. Cada fallo de esta lista rompio OpenCode de verdad, y cada uno tiene hoy
> una garantia en el codigo y una verificacion concreta. Si algo vuelve a fallar, empieza por aqui.

## Contexto y alcance

Un `plugin` de OpenCode es un modulo que el host carga desde el config; su default export es un
objeto con `id` y una funcion (`setup` en v2, `server` en v1). En este repositorio es el punto de
entrada que registra los hooks de contextbase, y la clave `plugins` del esquema v2 es la lista donde
se declaran.

Este documento registra los fallos de integracion con OpenCode v2 que contextbase ya sufrio y la
garantia de codigo que hoy los previene. Sirve a quien mantiene el plugin, a quien genera el
`opencode.json` y a quien diagnostica una instalacion que funciona en un proyecto y falla en otro.

Queda fuera de alcance: el funcionamiento interno del host, el desarrollo de agentes custom mas alla
de su registro y cualquier version de OpenCode anterior a la v2.

## 1. Contrato del plugin (OpenCode v2)

El `default export` del plugin **debe ser un objeto con `id` y una funcion**. El contrato que
ACTIVA correctamente es:

```js
export default {
  id: "contextbase-auto",
  server: ContextBaseAutoPlugin, // v1: factory que devuelve hooks
  setup: setupContextBaseAuto    // v2: registra hooks por ctx
};
```

**`effect` esta PROHIBIDO.** El runtime resuelve `"effect" in r ? r : due(r)`: si existe `effect`,
lo prefiere sobre `setup` y la activacion queda colgada esperando hooks de `ctx`. Si el default
export no es un objeto (por ejemplo una funcion suelta), el host lanza
`Plugin must export a default definition with an id and an effect or setup function` y **descarta el
plugin, dejando la sesion sin agentes custom**.

Garantia del tool: `validateOpenCodePluginSource()` exige `id` + `setup` y rechaza `effect`; el
generador se autovalida y, si no cumple, **no escribe nada** y reporta `CONFIG_PLUGIN_INVALID`.

## 2. Esquema del config: v1 vs v2

| Version | Agentes | Plugins | Permisos | MCP |
| :--- | :--- | :--- | :--- | :--- |
| v1 (legacy) | `agent` | `plugin` | `permission` (objeto) | `mcp.<nombre>` |
| v2 (actual) | `agents` | `plugins` | `permissions` (array `{action,resource,effect}`) | `mcp.servers.<nombre>` |

Mezclar ambos esquemas en el mismo archivo hace que el host **rechace la configuracion**: la
descarta, escribe una copia `.recovered-<fecha>` y la sesion pierde los colores de los agentes y los
servidores MCP registrados. Eso fue exactamente el sintoma "se rompieron los colores y los MCP".

Garantia del tool: la fusion **detecta el esquema instalado** (si hay `permissions`/`agents` es v2)
y escribe en la forma correcta; ademas es **idempotente**: si no hay cambios reales no reescribe el
archivo, porque reescribirlo dispara la recarga del host y el churn.

## 3. Un solo plugin por host: las cuatro rutas

El host trata como directorio de plugins a mas de una ruta. En esta instalacion, estas cuatro
entregan plugins con el mismo identificador:

| Ruta | Alcance |
| :--- | :--- |
| `<proyecto>/.opencode/plugins/` | proyecto |
| `~/.config/opencode/plugins/` | global (esquema v2) |
| `~/.opencode/plugins/` | global (home legacy) |
| `~/.opencode/plugin/` | global (home legacy, singular) |

Si el mismo `id` aparece en mas de una, el host carga todas y descarta las sobrantes. El sintoma en
`opencode plugin list` es una entrada `local` y otra `failed, local` para el mismo nombre, y en el
`log` del host: `Duplicate plugin ID: contextbase-auto`. En la sesion se pierde la automatizacion de la
instancia descartada.

El guard de instancia unica (`globalThis.__contextbaseAutoPluginActive`) evita hooks duplicados, pero
no evita que el host marque una entrada como fallida: la correccion es de instalacion, no de runtime.

Garantia del tool:

- `configureOpenCode` escribe el plugin del proyecto solo cuando no hay un plugin global valido; con
  global presente, elimina la copia local.
- `installSkill` limpia `~/.opencode/plugin/contextbase-auto.js` y
  `~/.opencode/plugins/contextbase-auto.js`, porque en ese home solo viven las skills.
- `hasStaleAgentConfig` acepta el plugin global como equivalente, asi que `autoEnsure` no reintenta
  una reparacion imposible.

Comprobacion:

```bash
contextbase doctor
Get-ChildItem ~/.config/opencode/plugins, ~/.opencode/plugins, ~/.opencode/plugin -Filter contextbase-auto.js
```

El resultado esperado es **un** archivo por maquina. Si aparece mas de uno, el host reporta el
identificador duplicado; borra las copias sobrantes y reinicia el cliente para que la lista de
plugins se refresque.

## 4. Instalacion global que no se nota

Un plugin o MCP "instalado" que el host no lee es peor que no tenerlo: parece funcionar en el
proyecto (porque el proyecto tiene su propia copia) y falla en cualquier otro lado.

Garantia del tool: `contextbase doctor` verifica, con evidencia, que en el home global existan y
sean validos el config, el plugin, el esquema, las skills instaladas y el handshake MCP real
(`initialize` + `tools/list` + salida 0). `--fix` repara lo reparable.

## 5. Nunca pisar archivos del usuario

Los configuradores de agentes (`.clinerules`, `.github/copilot-instructions.md`, `.vscode/mcp.json`,
`.gemini/settings.json`, `.aider.conf.yml`) pisaban archivos completos sin merge ni respaldo: perdida
de datos real.

Garantia del tool: los JSON se fusionan clave por clave, los archivos de reglas usan un bloque
marcado, siempre hay backup `.bak-contextbase` y un JSON corrupto **no se toca**.

## 6. El proceso MCP no lee stdin

`contextbase_hook` leia stdin de forma sincrona dentro del servidor MCP; el host nunca cierra ese
pipe, asi que la cola FIFO se bloqueaba para siempre.

Garantia del tool: el servidor MCP marca `CONTEXTBASE_MCP=1` y no toca stdin; el camino CLI
(`contextbase hook-run`) sigue leyendo el payload como siempre.

## 7. El directorio personal no es un proyecto

Inicializar el home dejaba `opencode.json`, `kilo.json`, `AGENTS.md`, `.mcp.json` y `contextbase/` en
la raiz del perfil, y Kilo normalizaba ese `opencode.json` con su propio `$schema`.

Garantia del tool: toda ruta de scaffold (`init`, `auto`, `status`, `log`, `sync`) se salta el home.

## Diagnostico en un minuto

```bash
contextbase doctor            # estado real de la instalacion global (sube a fallo con exit 1)
contextbase status --check    # salud de la memoria del proyecto
opencode plugin list          # que plugins ve el host
opencode mcp list             # que MCP ve el host (connected/failed)
opencode debug config         # que fuentes de configuracion lee el host
opencode debug agents         # agentes y colores que el host aplica
```

Si el host escribio un `.recovered-*`, la config fue rechazada: comparala con la actual, corre
`contextbase doctor --fix` y vuelve a comprobar `opencode debug config`.
