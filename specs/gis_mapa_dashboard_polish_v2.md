# Spec — Polish v2 de `/dashboard/mapa`: cascada de productor + z-index del modal

Continuación de `specs/gis_mapa_dashboard_polish.md` (misma sesión, mismo
día). Otro `[PROMPT PARA CLAUDE]` pidió 2 correcciones.

## Corrección de premisas

- **`enrichWithParcelaInfo` no vive en `lib/actions/gisActions.js`.** Esa
  función solo existe en `lib/eudrQcActions.js` (Consola QC), que la
  necesita porque `vw_monitoreo_poligonos`/`puntos` no traen datos de
  `PADRON_PARCELAS`. `vw_monitoreo_web` (la vista que consume
  `MapDashboard.jsx`) **ya joinea `PADRON_PARCELAS`** (alias `pp`, para
  `parcela_codigo`/`parcela_nombre`/`area_ha`) — no hace falta ningún
  helper cliente nuevo, la cascada se resuelve enteramente en la vista SQL,
  reutilizando el join `pp` ya existente.
- **`PADRON_PARCELAS."ID_Socio"` sí existe** (confirmado: ya usada en
  `supabase/migrations/20260818_sync_parcelas_baja_por_socio_inactivo.sql`)
  — es el dueño registrado de la parcela, independiente de si esa parcela
  tuvo o no una visita `EUDR_MONITOREO`.
- **Gap real confirmado:** la migración anterior
  (`20260819_vw_monitoreo_web_productor_nombre.sql`) solo resuelve
  `productor_nombre` a partir del `productor` ya resuelto en
  `vw_monitoreo_poligonos`/`puntos`, que para `EUDR_USO_SUELO`/
  `EUDR_INSTALACIONES` depende de que exista una visita `EUDR_MONITOREO`
  sobre la misma parcela (`LEFT JOIN LATERAL`). Si esa parcela nunca tuvo
  una visita (común para registros cargados vía el Ingestor de Capas
  Espaciales o el Editor Vectorial), sigue mostrando "Sin registrar" aunque
  la parcela tenga un dueño real en `PADRON_PARCELAS."ID_Socio"`.
- **El z-index sí es un bug real, verificado por código fuente** (no se
  pudo reproducir visualmente — `screenshot`/`zoom` siguen fallando de
  forma persistente sobre el mapa Leaflet en esta sesión, mismo patrón ya
  documentado): `node_modules/leaflet/dist/leaflet.css` fija
  `.leaflet-top, .leaflet-bottom { z-index: 1000; }` (controles de
  zoom/capas) y `.leaflet-popup-pane { z-index: 700; }`. Esos elementos son
  descendientes de `.leaflet-container`, que tiene `position: relative`
  pero **ningún `z-index` propio** — no aísla un stacking context nuevo,
  así que su `z-index: 1000` interno compite directamente con cualquier
  otro elemento posicionado en el mismo nivel de la página, incluido el
  overlay del modal (`fixed inset-0 z-50`, es decir `z-index: 50` real —
  muy por debajo de 1000). Corregido a `z-[9999]`.
- **Se rechaza parte del layout sugerido por el prompt.** Pedía además
  `max-w-xl` (más angosto que el `max-w-3xl` actual) y remover
  `max-h-[90vh] overflow-y-auto` — ambos cambios revertirían el fix de
  overflow de la tabla de vista previa hecho en la tarea anterior (un modal
  más angosto Y sin scroll vertical vuelve a comprimir/cortar contenido, el
  mismo síntoma que se acababa de corregir). Se aplicó solo la parte
  verificada como bug real (z-index) y `shadow-2xl` (mejora cosmética sin
  riesgo); se conservó `max-w-3xl`/`max-h-[90vh] overflow-y-auto`.
- **No se crea `tests/test_gis_mapa.mjs`.** Ninguno de los 2 cambios de
  esta tarea introduce lógica JS nueva y testeable con `node --test` — la
  cascada de nombre es 100% SQL (vista), y el z-index es una clase Tailwind
  estática. Un archivo de test que solo hiciera `grep` sobre el JSX no
  seguiría el patrón real de testing de este proyecto (los `tests/*.mjs`
  existentes prueban comportamiento de funciones puras, no contenido de
  markup).

## Cambios

1. `supabase/migrations/20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`:
   segundo `LEFT JOIN` independiente a `PADRON_SOCIOS` (alias `ps_parcela`)
   sobre `pp."ID_Socio"`; `productor_nombre` pasa a
   `COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo, src.productor, mon.productor)`.
2. `app/dashboard/mapa/components/CargaEspacialModal.jsx`: overlay
   `z-50` → `z-[9999]`, `shadow-xl` → `shadow-2xl`. Sin cambios de ancho/alto.
3. `MapDashboard.jsx`: sin cambios — ya lee `productor_nombre`, la cascada
   nueva es transparente para el cliente.

## Pendiente de aplicar en Supabase

Dos migraciones sobre `vw_monitoreo_web` sin aplicar todavía en la
instancia real (`jhtocgxlozfuzullrtol`): la de la tarea anterior
(`..._productor_nombre.sql`) y esta (`..._parcela_fallback.sql`) — deben
aplicarse en orden.
