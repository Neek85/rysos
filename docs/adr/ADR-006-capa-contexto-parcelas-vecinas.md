# ADR-006 — Capa de contexto de parcelas vecinas (Fase 3)

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Migraciones:** `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql`
  (pendiente de aplicación manual en Supabase Studio, como toda migración
  de este repo — ver `CLAUDE.md`)
- **Spec:** este ADR (tarea de seguimiento directo, sin spec/plan
  independientes — precondición confirmada: Fase 1 y Fase 2 ya en
  `staging` con tests verdes)
- **Tests:** `tests/test_qc_parcelas_vecinas.mjs`

## Contexto

La Consola QC (`/dashboard/qc`) ya tiene la geometría en revisión (capa
principal) y, desde Fase 1, la capa de comparación de solapamiento
(geometrías APROBADAS reales contra las que un registro específico
solapa, ver ADR-005). Fase 3 pide una TERCERA capa, puramente
informativa: parcelas vecinas dentro de un radio, para dar contexto
espacial general al auditor mientras dibuja o ajusta una geometría —
"¿qué más hay cerca?", sin implicar ningún conflicto.

## Corrección de premisas del contrato original

Verificado contra `docs/schema_live.md` y la instancia real (Service
Role Key, no solo lectura anon — `ORGANIZACIONES` no tiene política
`SELECT` para `anon`) antes de escribir la migración:

1. **`p_organizacion_id` no es `uuid`** — `"ID_Organizacion"` es `text`
   en todo el schema (ej. `"ORG-COOP-NORTE"`), mismo motivo ya corregido
   en `fn_validar_topologia_eudr`. Confirmado además que
   `ORGANIZACIONES."ID"` (la PK real) tampoco es `uuid` — son códigos
   como `"COOP-JS"`/`"COOP-ND"`.
2. **Hallazgo colateral, no relacionado con esta tarea pero real:**
   `"ORG-COOP-NORTE"` (el `ID_Organizacion` que aparece en TODOS los
   registros `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` con
   los que se trabajó durante toda esta sesión) **no corresponde a
   ninguna fila real de `ORGANIZACIONES`** — la tabla solo tiene 2 filas
   reales (`COOP-JS`, `COOP-ND`). `ID_Organizacion` no tiene FK real
   (ya documentado como patrón en este proyecto — "código manual, no
   autogenerado"), así que esto no rompe nada funcionalmente, pero es un
   dato huérfano/de prueba a tener en cuenta para cualquier tarea futura
   que asuma que `ID_Organizacion` siempre resuelve a una fila real de
   `ORGANIZACIONES`.
3. **El filtro de estado no es `estado = 'APROBADA'`** — la columna real
   es `estado_revision` (no `estado`) y el valor real es `'APROBADO'`
   (masculino), confirmado en vivo contra `vw_monitoreo_poligonos`.
4. **La columna de geometría es `geom_inspeccion`, no `geom`** — `geom`
   es el nombre real en `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, no en
   `EUDR_MONITOREO`.
5. **El índice GiST ya existe** (`idx_gist_eudr_monitoreo_geom` sobre
   `geom_inspeccion`, desde `20260818_gis_core_sanitization.sql`) — se
   declara igual con `IF NOT EXISTS` por idempotencia, sin asumir que
   esa migración anterior ya corrió en la instancia real.
6. **`ORGANIZACIONES.Config` sí existe como columna real** pero está
   `NULL` en las 2 organizaciones reales — no hay datos que migrar, tal
   como anticipaba el prompt; el fallback a 500m vive enteramente en la
   capa de aplicación.

## Decisiones de alcance

- **Solo Monitoreos EUDR** (`EUDR_MONITOREO`) — no `EUDR_USO_SUELO` ni
  `EUDR_INSTALACIONES`. Los Monitoreos son el perímetro real de la
  parcela (lo que un auditor necesita ver como "contexto de vecindario"
  para EUDR); Uso de Suelo son subdivisiones internas de una parcela ya
  conocida, e Instalaciones son puntos de infraestructura — ninguno de
  los dos aporta el mismo tipo de contexto "parcela vecina". Ampliar a
  las 3 tablas queda fuera de alcance de esta tarea si se necesita a
  futuro.
- **Radio por defecto: 500 m.** Configurable por organización vía
  `ORGANIZACIONES.Config.gis.radio_contexto_vecinos_m` (JSON, sin
  columna dedicada) — **sin UI de administración para editarlo**, tal
  como pedía la tarea explícitamente. Documentado acá como tarea
  diferida (ver `docs/ESTADO_PROYECTO.md`).
- **Sin `SECURITY DEFINER` ni `GRANT EXECUTE ... TO anon`** en
  `fn_parcelas_vecinas_eudr` — mismo criterio que `fn_validar_topologia_eudr`
  (ADR previo): se invoca exclusivamente server-side con la Service Role
  Key (`lib/actions/qcActions.js::fetchParcelasVecinas`, Server Action).
  Motivo de seguridad real, no solo consistencia: `p_organizacion_id` lo
  decide el llamador — si la función fuera invocable directamente desde
  el navegador con la anon key, cualquiera podría pedir geometrías de
  OTRA organización con solo cambiar ese parámetro. El aislamiento
  multi-tenant real es el `WHERE "ID_Organizacion" = p_organizacion_id`
  dentro de la función, ejecutado con una Service Role Key que ya
  bypasea RLS por diseño (ADR-003) — nunca RLS de sesión (este frontend
  no tiene sesión real de Supabase Auth).
- **Trigger: al entrar en modo dibujo/edición, no en cada pan/zoom ni en
  cada vértice.** Dos disparadores discretos en `QcConsoleMap.jsx`:
  (a) cuando `editingKey` cambia (empezar a editar un registro
  existente) — centrado en el centroide/punto real de ESE registro; (b)
  cuando `vectorEditor.drawnLayer` pasa a existir (geoman terminó de
  dibujar una geometría nueva, `pm:create` ya corrió) — centrado en el
  centroide/punto de lo recién dibujado. Deliberadamente NO se dispara
  en cada vértice mientras se dibuja (cada corrida es una consulta real
  al server) ni en cada pan/zoom del mapa — ambos disparadores son
  eventos discretos y poco frecuentes por diseño.
- **Toggle on/off, ON por defecto, sin persistencia entre sesiones** —
  estado de componente puro (`useState`) en `QcConsoleMap.jsx`,
  documentado como limitación conocida (se resetea a ON en cada
  recarga de página). Persistirlo (localStorage, o el mismo `Config` de
  organización) queda fuera de alcance de esta tarea.
- **Estilo visual deliberadamente distinto** tanto del registro en
  revisión (colores sólidos por `tabla_origen`) como de la capa de
  solapamiento de Fase 1 (`#b45309` ámbar, `dashArray: '6, 6'`): gris/
  slate neutro (`#64748b`/`#94a3b8`), punteado más fino (`dashArray:
  '2, 6'`) — para que un auditor jamás confunda "vecino de contexto"
  (informativo, sin ningún conflicto detectado) con "solapa de verdad"
  (alerta real, Fase 1).

## Contrato de datos

```
fn_parcelas_vecinas_eudr(
  p_organizacion_id text,   -- corregido de uuid
  p_geom geometry,
  p_radio_m numeric DEFAULT 500,
  p_excluir_id uuid DEFAULT NULL,  -- id_monitoreo sí es uuid real
  p_limite integer DEFAULT 25
) RETURNS TABLE (
  id uuid,           -- alias de id_monitoreo
  geom geometry,      -- alias de geom_inspeccion
  codigo_socio text,   -- alias de "ID_Socio"
  total_encontrados integer,
  total_devueltos integer
)
```

`lib/actions/qcActions.js::fetchParcelasVecinas(organizationId, geometry, excludeId)`
resuelve el radio configurado (fallback 500m), invoca la RPC con Service
Role Key, y devuelve `{ parcelas, totalEncontrados, totalDevueltos, radioM }`.
El frontend muestra "hay más parcelas en el radio, acercate al mapa"
cuando `totalEncontrados > totalDevueltos`, en vez de fallar
silenciosamente ante un radio con muchos resultados.

## Verificación en vivo (instrucción explícita — este archivo ya tuvo 2
## regresiones reales por cambios de capas sin verificar en vivo)

Confirmado con el dev server real, ANTES de dar la tarea por cerrada
(la migración no está aplicada todavía, así que la llamada RPC real
falla — se verificó específicamente que ese fallo se degrada con
gracia, sin romper nada más):

- Toolbar del Editor Vectorial (`.leaflet-pm-toolbar`) sigue presente.
- Dibujar un polígono nuevo: el panel de Fase 2 (área/perímetro/badge)
  sigue funcionando exactamente igual; al terminar de dibujar
  (`pm:create`), la búsqueda de vecinos se dispara y falla en silencio
  (RPC no aplicada todavía) sin ningún error de consola ni romper el
  formulario de guardado.
- Toggle "Parcelas vecinas de contexto": togglea sin error.
- Seleccionar un registro PENDIENTE existente + "Ajustar Geometría":
  sigue mostrando "Editando…", el marcador sigue arrastrable
  (`leaflet-pm-draggable`), y el toolbar de dibujo sigue
  deshabilitándose correctamente (mutua exclusión de Fase 1, sin
  regresión).
- Terminar la edición: el toolbar se rehabilita correctamente
  (`pm-disabled` se remueve).
- **Cero errores de consola en todo el flujo.**

## Pendiente, fuera de este repo

Aplicar `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql`
en Supabase Studio SQL Editor. Hasta entonces, la capa de contexto
queda visible en la UI (toggle) pero sin datos (fallo silencioso ya
verificado como no disruptivo).
