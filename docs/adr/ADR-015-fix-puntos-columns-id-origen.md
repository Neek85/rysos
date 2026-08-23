# ADR-015 — El error "falta aplicar la migración" no era la migración: PUNTOS_COLUMNS nunca pedía `id_origen`

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Código:** `lib/eudrQcActions.js` (`PUNTOS_COLUMNS`, `resolveUpdateTarget`,
  comentarios de cabecera y de `tagRecords`)
- **Tests:** `tests/test_eudr_qc_actions.mjs` (2 tests reescritos, 1 nuevo),
  `tests/test_qc_console_v2.mjs` (1 test reescrito)

## El reporte que arrancó esto

El usuario pidió el contenido de `supabase/migrations/20260819_fix_vw_monitoreo_puntos_id_origen.sql`
para aplicarla, sospechando (con razón, dado el mensaje de error que veía)
que seguía pendiente desde el 19 de agosto. Antes de asumir eso, se
verificó en vivo: la migración **ya estaba aplicada** — `vw_monitoreo_puntos`
expone `id_origen` con valores reales:

```json
{"id_origen": "27", "tabla_origen": "EUDR_INSTALACIONES", "registro_id": "1"}
```

El commit que la creó (`b770d38`, mismo 19 de agosto) dice literalmente
"close id_origen gap" en su mensaje — todo indicaba que se aplicó ese
mismo día.

**Pero el usuario tenía una captura de pantalla real, del mismo día de esta
tarea (23 de agosto), mostrando el mensaje de error en vivo en el
navegador** — con la migración confirmada como aplicada. Esa contradicción
es la que se investigó acá, en vez de cerrar el caso con "ya está aplicada,
listo".

## La causa real

`lib/eudrQcActions.js` arma la consulta a `vw_monitoreo_puntos` con una
lista explícita de columnas (PostgREST solo devuelve lo que se le pide,
aunque la vista tenga más columnas disponibles):

```js
// ANTES:
const PUNTOS_COLUMNS =
  'tabla_origen,registro_id,id_monitoreo,ID_Organizacion,ID_Parcela_Fija,' +
  'productor,tipo_infra,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,' +
  'cumple_eudr,area_calculada_ha,geom'
```

`id_origen` **no está en esa lista** — a diferencia de `POLIGONOS_COLUMNS`,
que sí la incluye. La migración del 19 de agosto agregó la columna a la
vista, pero nadie actualizó `PUNTOS_COLUMNS` para pedirla. Reproducido
exactamente con el mismo string que usa el código real, contra la
instancia viva:

```python
PUNTOS_COLUMNS = 'tabla_origen,registro_id,id_monitoreo,ID_Organizacion,ID_Parcela_Fija,productor,tipo_infra,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,cumple_eudr,area_calculada_ha,geom'
# resultado real contra vw_monitoreo_puntos: 'id_origen' in row? False
```

De ahí en adelante, la cadena de causa-efecto real:

1. `fetchPendingRecords` trae filas de `vw_monitoreo_puntos` sin `id_origen`
   (nunca se pidió).
2. `tagRecords` intenta rellenarlo con un fallback — pero ese fallback
   **solo cubre `EUDR_MONITOREO`** (usa `id_monitoreo` como equivalente):
   ```js
   const id_origen = r.id_origen ?? (r.tabla_origen === 'EUDR_MONITOREO' ? r.id_monitoreo : undefined)
   ```
   Para `EUDR_INSTALACIONES`, queda `undefined`.
3. `resolveUpdateTarget`, al intentar aprobar/rechazar, ve `id_origen`
   ausente y lanza el error — con un mensaje que además **apuntaba a la
   causa equivocada**, porque fue escrito cuando la migración de verdad
   estaba pendiente y nadie lo actualizó cuando dejó de estarlo:
   ```js
   if (!record.id_origen) {
     throw new EUDRQcError(
       `No se puede aplicar la decisión sobre este registro de ${LAYER_LABELS[record.tabla_origen]}: falta aplicar ` +
         'la migración supabase/migrations/20260819_fix_vw_monitoreo_puntos_id_origen.sql.'
     )
   }
   ```

**Resultado:** el mensaje decía "falta aplicar la migración" durante 4 días
después de que la migración ya estaba aplicada — el síntoma real (no poder
aprobar/rechazar Instalaciones) seguía activo por un motivo completamente
distinto al que el propio mensaje describía.

### Por qué nadie lo había notado antes de esta sesión

El comentario original documentaba, explícitamente, "hoy no bloquea nada
real: no hay registros PENDIENTE de EUDR_INSTALACIONES en la base" — cierto
en su momento. Recién con la resincronización de `Prueba1.zip` durante el
trabajo de ADR-012 (2026-08-23) aparecieron los primeros registros
`PENDIENTE` reales de `EUDR_INSTALACIONES` (5, ver tabla abajo) — es decir,
el bug estuvo *presente pero invisible* desde el 19 de agosto, y solo se
volvió observable el mismo día que se investigó.

## La corrección

Un solo cambio funcional — agregar la columna faltante a la lista:

```js
// DESPUÉS:
const PUNTOS_COLUMNS =
  'tabla_origen,registro_id,id_origen,id_monitoreo,ID_Organizacion,ID_Parcela_Fija,' +
  'productor,tipo_infra,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,' +
  'cumple_eudr,area_calculada_ha,geom'
```

Más 2 correcciones de higiene, hechas en la misma tarea porque ambas
contribuyeron a que el diagnóstico tardara:

- **El mensaje de error ya no culpa a una migración específica** — describe
  el síntoma real (`id_origen` ausente) sin asumir una causa, para no volver
  a inducir a nadie a perseguir la pista equivocada:
  ```js
  throw new EUDRQcError(
    `No se puede aplicar la decisión sobre este registro de ${LAYER_LABELS[record.tabla_origen]}: no se pudo ` +
      'determinar su identificador real (id_origen ausente). Recargá la consola; si el problema persiste, ' +
      'puede ser un dato faltante en la base — revisá manualmente.'
  )
  ```
- **Los comentarios de cabecera y de `tagRecords`** (que describían esto
  como "pendiente de aplicación manual") se actualizaron para reflejar que
  la migración SQL está aplicada, y que el bug real vivía en el código
  cliente — con referencia a este ADR para quien necesite el detalle
  completo más adelante.

El guard en `resolveUpdateTarget` (rechazar en vez de intentar un `UPDATE`
con `id: undefined`, que matchearía 0 filas en silencio) se mantiene sin
cambios de comportamiento — sigue siendo la defensa correcta si `id_origen`
alguna vez faltara por un motivo real (dato ausente en la base), ya no por
un `.select()` incompleto.

## Verificación en vivo

1. Confirmado, vía REST con Service Role Key, que `id_origen` ahora **sí**
   llega en la respuesta real de `fetchPendingRecords` para los 5 registros
   `EUDR_INSTALACIONES` `PENDIENTE` existentes (`27`, `28`, `29`, `33`,
   `34`) — leído directamente del estado de React en el navegador real
   (`/dashboard/qc`), no solo de una consulta aislada.
2. Se seleccionó uno de esos 5 registros (`id=27`, tipo "Vivienda") en la
   Consola QC real — **sin ningún mensaje de error**, botones "Aprobar"/
   "Rechazar" habilitados (a diferencia de antes, donde el mensaje rojo
   aparecía inmediatamente y bloqueaba la decisión).
3. Se aprobó a través del botón real "✓ Aprobar". Confirmado por REST tras
   el clic:
   ```
   {'id': 27, 'estado_revision': 'APROBADO'}
   {'id': 28, 'estado_revision': 'PENDIENTE'}
   {'id': 29, 'estado_revision': 'PENDIENTE'}
   {'id': 33, 'estado_revision': 'PENDIENTE'}
   {'id': 34, 'estado_revision': 'PENDIENTE'}
   ```
   Algo que, antes de este fix, era estructuralmente imposible de lograr a
   través de la UI — el error se disparaba antes de que el clic pudiera
   llegar a `approveRecord`.

## Fuera de alcance de esta tarea (a propósito)

- **Por qué el bug quedó invisible 4 días** ya está explicado arriba — no
  se investiga más a fondo un proceso de revisión de código que lo hubiera
  detectado antes, no era parte del pedido.
- **Auditar el resto del archivo por otros `.select()` con listas de
  columnas potencialmente desactualizadas** — no se hizo una revisión
  sistemática de `POLIGONOS_COLUMNS` ni de otras consultas; esta tarea se
  limitó al síntoma reportado (`PUNTOS_COLUMNS`/`EUDR_INSTALACIONES`).
