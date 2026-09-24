# Spec — Destete: recolección semanal + conformación de lotes por sexo (Pecuario Cuyes)

**Nota de transparencia (Claude Code CLI, 2026-09-25):** este archivo no
existía en el repo al recibir esta tarea — mismo hallazgo recurrente de
toda esta ronda (las specs de Cowork no siempre quedan versionadas acá).
El prompt pidió crear el archivo "con el contenido de abajo", pero lo
único que se entregó fue el diseño de backend (la migración SQL, ya con
su propio razonamiento extenso en los comentarios de cabecera, y el
contrato Zod) — no el contenido de las secciones §1–§9 (decisiones de
negocio y diseño del simulador/mockup que motivaron esas dos fases).
Este archivo **no reconstruye esas secciones** — sería inventar contenido
sin base. Se agrega únicamente la §10 (Backend), sintetizada fielmente
del razonamiento que sí vino completo en la cabecera de
`supabase/migrations/20260925090000_pecuario_destete_recoleccion.sql`.
Si en algún momento aparece el documento completo (§1–§9, con el detalle
del simulador, la spec de "una sola alerta por semana", el bug de
sobrescritura del §8, etc.), debe reemplazar/completar este archivo, no
convivir con una versión truncada.

## §10. Backend — migración y contrato Zod (2026-09-25)

Redactado por Claude (Cowork), tras cruzar esta spec contra la migración
de Población (`20260924110000_pecuario_poblacion_vistas.sql`).

### Problema de fondo que resuelve

El flujo real tiene dos fases separadas en el tiempo:

1. **Recolección** (Paso 1, sin sexar) — se juntan los gazapos de varios
   partos que ya cumplieron su período de lactancia, sin separarlos por
   sexo todavía.
2. **Conformación de lotes** (Paso 2, repetible, sexado) — de ese
   remanente recolectado se van armando lotes reales, un sexo por lote,
   posiblemente en sesiones distintas y días distintos.

El simulador solo podía guardar ese estado intermedio en memoria del
navegador (`poolDestete`/`lotesDesteteFormados`), perdiéndolo al cerrar
la app o cambiar de dispositivo (§9.4 de la spec original, no
reconstruida acá). Esta migración lo vuelve un registro real y
persistente.

### Hallazgo propio (encontrado por Cowork antes de escribir esta migración)

`vw_pecuario_lactancia_restante` (de la migración de Población,
2026-09-24) calculaba "destetado" mirando
`PECUARIO_LOTES.parto_origen_id` (un lote = un solo parto de origen).
Pero el flujo real de Destete agrupa varios partos sin sexar antes de
crear ningún lote — un lote real de esta pantalla casi nunca tiene un
único parto de origen, así que `parto_origen_id` habría quedado `NULL`
siempre y la lactancia real nunca hubiera bajado en esa vista una vez
construida esta pantalla.

Además, el corte real de "ya no está en lactancia" ocurre en la
**recolección** (Paso 1 — los gazapos salen físicamente de la poza de
maternidad ahí), no en la conformación del lote (Paso 2, que puede pasar
días después). Por eso esta migración **reemplaza** el cálculo de
`vw_pecuario_lactancia_restante` (mismo nombre de vista y de columna
`cantidad_destetada`, para no romper `vw_pecuario_ocupacion_poza`/
`vw_pecuario_poblacion_resumen`, que ya dependen de ella) para que sume
desde `PECUARIO_RECOLECCION_PARTOS` en vez de
`PECUARIO_LOTES.parto_origen_id`. `parto_origen_id` sigue existiendo en
el esquema — el flujo real de Destete simplemente no lo usa; la
trazabilidad hacia los partos de origen de un lote real pasa por
`PECUARIO_RECOLECCION_PARTOS`, de forma agregada/proporcional (varios
partos por recolección).

### Decisión de arquitectura

1. **`PECUARIO_RECOLECCIONES_DESTETE`** — fila ancla por ronda de
   recolección (fecha, organización). Inmutable tras crearse (nunca se
   hace `UPDATE`) — todos los números derivados (recolectado, asignado,
   pendiente, abierta/cerrada) se calculan en la vista
   `vw_pecuario_recolecciones_destete`, nunca se guardan como contador
   replicado.
2. **`PECUARIO_RECOLECCION_PARTOS`** — qué partos entraron en cada
   recolección y cuánto de cada uno (`cantidad_incluida`, siempre
   calculada por trigger desde `vw_pecuario_lactancia_restante` en el
   momento del insert — nunca se confía en lo que mande el cliente). Un
   parto solo puede recolectarse una vez en total (`UNIQUE(parto_id)`
   global, no por recolección): se recolecta completo o nada.
3. **`PECUARIO_LOTES.recoleccion_origen_id`** (columna nueva, nullable)
   — el lote real que arma el Paso 2. El trigger
   `trg_conformar_lote_destete` (`BEFORE INSERT` en `PECUARIO_LOTES`,
   solo actúa cuando `recoleccion_origen_id IS NOT NULL` — no afecta
   ningún otro flujo que inserte en `PECUARIO_LOTES`, como el traslado
   parcial) valida que la cantidad pedida no supere el remanente real de
   la recolección y que la poza destino sea de la misma organización.
4. **`vw_pecuario_recolecciones_destete`** — reemplaza
   `poolDestete`/`lotesDesteteFormados` del simulador: recolectada,
   asignada, pendiente y estado (`'abierta'`/`'cerrada'`, 100%
   calculado) por recolección.

### Sexo obligatorio sin "mixto"

`PECUARIO_LOTES.sexo` sigue siendo texto libre (columna ya existente,
otros flujos de creación de lotes pueden necesitar `'mixto'`) — se
agrega un `CHECK` acotado solo a lotes de este flujo
(`recoleccion_origen_id IS NULL OR sexo IN ('macho','hembra')`).

### Sobre el bug de sobrescritura mencionado en la spec original (§8, no reconstruida)

Ese bug es estructuralmente imposible acá: un `INSERT` real con
`uq_lote_org_codigo` (`UNIQUE`, ya existe desde v1) rechaza un código
duplicado en vez de sobrescribir en silencio.

### Pesaje opcional al conformar

Usa `PECUARIO_PESAJES` ya existente (v1) sin cambios de esquema — el
Server Action hace 2 inserts secuenciales (lote, y si se cargó pesaje,
un segundo insert en `PECUARIO_PESAJES` con `lote_id` = id del lote
recién creado). No es atómico con el insert del lote a propósito (es
opcional y ortogonal a la bitácora de la recolección).

### Fuera de alcance a propósito

- La agrupación de "una sola alerta por semana con día central sugerido"
  — sigue sin definirse. Esta migración no genera ninguna tarea nueva.
- Si el sistema debe bloquear una recolección nueva mientras otra sigue
  con remanente — decisión de negocio sin confirmar. No se agrega ningún
  constraint que lo bloquee.
- **Hallazgo señalado, no corregido acá:** el trigger
  `fn_crear_tarea_destete` (v1) todavía crea una tarea por cada parto con
  vencimiento fijo a los "+14 días" — contradice la decisión ya
  confirmada de que la fecha de destete real es flexible y la tarea
  debería ser por semana, no por parto. No se toca en esta migración
  (cambiar/desactivar un trigger en producción está fuera del alcance
  pedido) — queda señalado para decidirse aparte.

### Contrato Zod

`RecoleccionDestemteSchema`/`ConformarLoteDestemteSchema` en
`lib/validations/pecuario.ts`. `cantidad_inicial ≤ remanente` **no** se
valida en Zod a propósito — depende de una consulta en vivo a la
recolección; ese chequeo vive solo en `trg_conformar_lote_destete`
(fuente de verdad única), mismo criterio que ya usa la guarda de Sanidad
en este archivo.
