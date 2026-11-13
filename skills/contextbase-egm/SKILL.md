---
name: contextbase-egm
description: Revisión adversarial determinista de documentos con el modelo Elephant-Goldfish (PASS/REFIX/RERUN/FAIL) y control de deriva doc-código; usar antes de cerrar una tarea, al revisar un diseño o cuando el veredicto EGM del digest no sea PASS.
---

# ContextBase EGM: revisión adversarial como flujo de trabajo

> **Filosofía:** el autor no se revisa a sí mismo. Un documento no está listo porque
> "se ve bien", está listo porque un motor determinista lo revisó, halló evidencia y
> llegó a PASS.

El modelo **Elephant-Goldfish (EGM)** deja de ser un módulo que alguien invoca a mano y
pasa a ser un flujo que el agente sigue. El motor determinista ya vive en
`src/egm.js`; esta skill explica cómo trabajar con él, cómo leer su veredicto y cómo
cerrarlo con evidencia.

## Cuándo usar la skill

- Antes de implementar una decisión de diseño: el documento se revisa primero, el código después.
- Al revisar un documento, una especificación o un README que otro va a leer.
- Cuando el digest de ContextBase muestre un veredicto EGM distinto de `PASS`.
- Para detectar deriva entre lo que la documentación afirma y lo que el código hace.
- Antes de cerrar una tarea, como último control: el veredicto queda en
  `contextbase/egm/verdict.json` y el digest lo muestra.

## El bucle de revisión

```
revisar -> corregir blocker y major -> volver a revisar -> PASS
```

1. `contextbase egm review --target <documento>` sobre el documento vivo
   (`contextbase/fundamentos.md`) o el documento que estés por cerrar.
2. Corregir **todos** los `blocker` y los `major`. Los `nit` se corrigen o se
   registran como diferidos.
3. Volver a ejecutar el mismo comando.
4. Repetir hasta `PASS`. Si el veredicto no se mueve después de dos correcciones, el
   problema es el documento, no la redacción: volver al diseño.

### Máquina de estados del veredicto

| Veredicto | Qué significa | Qué hacer |
| --- | --- | --- |
| `PASS` | Sin blockers ni majors; todos los revisores aplicables completaron. | Cerrar la tarea y registrar el cierre. |
| `REFIX` | Quedan `major` abiertos contra el estándar aplicado. | Corregir y volver a correr. |
| `RERUN` | Churn (un hallazgo reaparece) o un revisor no pudo ejecutarse. | Revisar por qué la corrección no se sostuvo y repetir la pasada. |
| `FAIL` | Hay `blocker`: el documento contradice el código o afirma algo falso. | Detener la implementación; el documento miente o el código no es el que se cree. |

`REFIX` aparece escrito como `RIXIF` en material del modelo original: es el mismo estado.

## Regla de evidencia

Ningún hallazgo se cierra en silencio. Cada uno se **corrige** o se **descarta por
escrito**, citando la evidencia concreta (ruta, línea, comando) que lo refuta o que
demuestra la corrección. Un hallazgo duplicado se cierra citando el otro; un hallazgo
fuera de alcance se escala a una persona.

El veredicto no se guarda en la conversación, se guarda en disco:
`contextbase/egm/verdict.json`. Contiene el veredicto, el objetivo revisado, el conteo
por severidad, la deriva detectada y la marca de tiempo. El digest de ContextBase lo
lee de ahí, así que si el archivo no cambió, la revisión no ocurrió.

## La herramienta MCP `contextbase_egm_review`

| Acción | Qué devuelve |
| --- | --- |
| `review` | Hallazgos por severidad y veredicto del documento objetivo. |
| `drift` | Diferencias entre lo que dice la documentación y lo que existe en el código. |
| `personas` | Las 10 personas revisoras con su misión y su estándar. |
| `standards` | Los 5 estándares de documento aplicables. |
| `skills` | Los 7 flujos del modelo y cuándo se usa cada uno. |

Parámetros: `target` (documento a revisar; por defecto el documento vivo), `base`
(referencia git para comparar el cambio) y `docs` (directorio de documentación para
la deriva; por defecto `docs`).

La misma capacidad está expuesta por CLI, que es lo que conviene usar en terminal:

```bash
# Revisar el documento vivo del proyecto
contextbase egm review --target contextbase/fundamentos.md

# Revisar un documento puntual contra una base git
contextbase egm review --target docs/diseno.md --base main

# Salida legible por maquina (mismo veredicto que guarda contextbase/egm/verdict.json)
contextbase egm review --target docs/diseno.md --json

# Deriva doc-código sobre el directorio de documentación
contextbase egm drift --docs docs

# Ver personas, estándares y flujos disponibles
contextbase egm personas
contextbase egm standards
contextbase egm skills
```

## Ojos frescos

El modelo original lanza un subagente nuevo por revisor: ojos frescos, sin la
conversación del autor. En ContextBase eso se consigue de dos formas:

- **Araña de la Telaraña:** `contextbase web start --prey "<objetivo>"` crea un
  worktree aislado con memoria pre-hidratada, sin los supuestos que el autor acumuló
  en su hilo.
- **Subagente sin el hilo previo:** se le entrega el documento y el estándar, nunca la
  discusión que lo produjo ni la conclusión esperada.

Si el revisor ve el razonamiento del autor, deja de ser goldfish y empieza a estar de
acuerdo. En ese caso el `PASS` no vale.

## Checklist de cierre

- [ ] El documento revisado es el vivo (`contextbase/fundamentos.md`) o el que la tarea toca.
- [ ] El último veredicto es `PASS`.
- [ ] Cada `blocker` y `major` tiene su corrección o su descarte escrito con evidencia.
- [ ] `contextbase/egm/verdict.json` refleja la última pasada.
- [ ] La deriva doc-código se revisó; si el directorio de docs no existe, se dice, no se asume cero.
