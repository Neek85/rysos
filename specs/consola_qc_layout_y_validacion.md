# Especificación: Reordenar Consola QC + Corregir función de validación topológica faltante

## Contexto
La Consola de Auditoría QC (`/dashboard/qc`) tiene hoy el panel de edición
(atributos, geometría, validación, aprobar/rechazar) debajo del mapa, lo que
obliga a hacer scroll vertical cada vez que se selecciona un registro para
llegar a los botones de acción.

Además, al presionar "Ejecutar Test Espacial" aparece el error:
`Could not find the function public.fn_validar_topologia_eudr(p_registro_id, p_tabla_origen) in the schema cache`
— la función que el frontend espera llamar no existe en la base de datos.
Esto también provoca el error secundario "No se pudo guardar la geometría:
el registro ya no está en estado PENDIENTE..." al intentar guardar cambios
de geometría, porque el flujo de validación nunca se completa correctamente.

## Objetivo
1. Reordenar el layout de `/dashboard/qc` para que el panel de edición quede
   fijo en una columna a la derecha del mapa, no debajo, eliminando la
   necesidad de scroll para aprobar/rechazar un registro.
2. Restaurar o crear la función `fn_validar_topologia_eudr` en Supabase para
   que el botón "Ejecutar Test Espacial" y el guardado de geometría vuelvan
   a funcionar sin error.

## Criterios de aceptación

### Layout
- El mapa ocupa el centro, a toda la altura disponible de la pantalla.
- El panel de edición (Corregir atributos, Ajustar geometría, Validación
  topológica, Aprobar/Rechazar) se muestra en una columna fija a la derecha,
  visible sin necesidad de scroll vertical al seleccionar un registro.
- La lista de registros pendientes a la izquierda no cambia de comportamiento.
- Si el panel derecho resulta muy largo en pantallas más pequeñas, usar
  pestañas internas (Atributos / Geometría / Validación) en vez de volver a
  requerir scroll largo.
- No se rompe ninguna funcionalidad existente (editor vectorial, dibujo de
  polígonos, sincronización con Google Drive, carga de capa espacial).

### Función de validación topológica
- Antes de crear nada, revisar el historial de migraciones
  (`supabase/migrations/*.sql`) para confirmar si `fn_validar_topologia_eudr`
  existió alguna vez y se perdió, o si nunca se creó.
- Restaurar o crear la función como migración idempotente
  (`CREATE OR REPLACE FUNCTION ... IF NOT EXISTS` según corresponda),
  siguiendo la firma que el frontend ya invoca:
  `fn_validar_topologia_eudr(p_registro_id, p_tabla_origen)`.
- La función debe validar al menos: geometría válida (`ST_IsValid`), y
  que las parcelas >= 4.0 ha estén representadas como Polygon (regla ya
  definida en el prompt orquestador RYZOS V3.1, sección 5).
- Documentar la función y la decisión en un ADR nuevo
  (`docs/adr/ADR-XXX-funcion-validacion-topologica-eudr.md`).
- Tras el fix, "Ejecutar Test Espacial" debe correr sin el error de función
  no encontrada, y "Guardar Cambios de Geometría" debe completar el flujo
  sin el error de estado PENDIENTE bajo uso normal.

## Fuera de alcance
- Cualquier cambio a las apps móviles.
- Cualquier cambio a otras rutas del dashboard (mapa, inspecciones, lotes).
- Cambios de estilo visual más allá del reordenamiento (colores, tipografía).

## Resolución (2026-08-21)

### Función de validación topológica — NO faltaba, faltaba aplicarla

`fn_validar_topologia_eudr` **ya existe** en
`supabase/migrations/20260820_fn_validar_topologia_eudr.sql` (creada en una
tarea anterior de esta misma línea de trabajo, `specs/qc_topological_eudr_validation.md`),
con la firma exacta que el frontend invoca —
`fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)`,
confirmada contra `app/api/qc/validate-spatial/route.js:41`
(`supabase.rpc('fn_validar_topologia_eudr', { p_tabla_origen, p_registro_id })`)
— y usa las columnas reales correctas (`EUDR_MONITOREO.geom_inspeccion` +
PK `id_monitoreo`, `EUDR_USO_SUELO.geom` + PK `id`), no `EUDR_MONITOREO.geom`/`.id`
como asumía un prompt de seguimiento posterior.

Se reprodujo el error citado arriba **en vivo** contra la instancia real de
Supabase (`curl -X POST http://localhost:3000/api/qc/validate-spatial`,
mismo mensaje exacto: `Could not find the function
public.fn_validar_topologia_eudr(p_registro_id, p_tabla_origen) in the
schema cache`) — confirma que la causa real es que **la migración nunca se
aplicó** en Supabase Studio SQL Editor (no hay CLI de Supabase vinculada a
este repo, ver `CLAUDE.md`), no que la función esté mal escrita o ausente
del código. No se creó ninguna migración nueva — crear una segunda función
con una firma distinta (`p_monitoreo_id uuid`) habría coexistido como un
overload separado sin resolver el problema real, y además habría fallado en
uso al referenciar columnas que no existen (`geom`/`id` en
`EUDR_MONITOREO`).

**Acción pendiente del usuario, fuera del alcance de este repo:** aplicar
`supabase/migrations/20260820_fn_validar_topologia_eudr.sql` en Supabase
Studio SQL Editor.

### Hallazgo adicional no solicitado: las 4 escrituras de la consola estaban
### siempre rotas por RLS, independientemente del estado del registro

Investigando el error secundario citado arriba ("no se pudo guardar la
geometría: el registro ya no está en estado PENDIENTE") se encontró que
**no era un problema de estado stale** — `approveRecord`/`rejectRecord`/
`updateRecordAttributes`/`updateRecordGeometry` (`lib/eudrQcActions.js`) se
invocaban con `getSupabaseClient()` (cliente anon key, sin sesión real de
Supabase Auth — ver el gotcha de RLS documentado en `CLAUDE.md`), pero
`rls_write_eudr_monitoreo`/`rls_write_eudr_uso_suelo`/
`rls_write_eudr_instalaciones`
(`supabase/migrations/20260818_rls_multi_tenant_fortification.sql`) son
`FOR ALL TO authenticated` — sin ninguna política `anon`. Cualquier UPDATE
desde el frontend afectaba **0 filas siempre**, disparando el guard
"ya no está en estado PENDIENTE" en el 100% de los intentos, sin importar
el estado real del registro. Este bug bloqueaba TODA la funcionalidad de
decisión de la Consola QC (Aprobar, Rechazar, corregir atributos, ajustar
geometría), no solo el flujo de validación topológica.

**Fix aplicado** (confirmado con el usuario vía `AskUserQuestion`, opción
recomendada — mismo patrón ya establecido en `lib/actions/sociosActions.js`
y `lib/actions/gisActions.js`, ver
`docs/adr/ADR-003-consola-qc-server-actions-escritura.md`): nuevo
`lib/actions/qcActions.js` ('use server', Service Role Key vía
`getSupabaseServerClient()`) que envuelve las 4 funciones puras ya
existentes en `lib/eudrQcActions.js` (sin cambios en su lógica interna —
el guard multi-tenant + PENDIENTE ya era correcto, el problema nunca fue
esa lógica). `app/dashboard/qc/page.jsx` ahora llama
`approveQcRecord`/`rejectQcRecord`/`updateQcRecordAttributes`/
`updateQcRecordGeometry` en vez de las funciones puras directamente con el
cliente anon.

### Layout

Implementado tal como describe el plan (`plans/consola_qc_layout_y_validacion_plan.md`,
Fase 3): grid de 3 columnas (`lg:grid-cols-12`) — lista (`col-span-3`, sin
cambios de comportamiento), mapa (`col-span-6`, alto de viewport en vez de
600px fijos), panel de edición (`col-span-3`, `sticky` + `overflow-y-auto`
propio). El panel nunca obliga a scrollear la PÁGINA para llegar a
Aprobar/Rechazar — si su contenido es más alto que la pantalla, scrollea
dentro de su propia columna. No se implementaron pestañas internas
(Atributos/Geometría/Validación) — el plan (que este prompt indica que
manda sobre la spec para detalles de UI) solo pide el layout de 3 columnas
con scroll interno del panel, sin mencionar pestañas; agregarlas habría
sido una abstracción no pedida por el documento que gobierna esta
decisión.

## Addendum (2026-08-21) — Solapamiento auditable + 2 bugs del Editor Vectorial

Ver `docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md` para el
detalle completo. Resumen:

- **Popup con nombre crudo de tabla** (`bindPopup`/`openPopup` en
  `QcConsoleMap.jsx`): confirmado real en vivo, eliminado — el panel
  derecho ya mostraba la misma info con etiqueta legible.
- **"Editor de puntos abre modo polígono"**: investigado a fondo (código +
  inspección del DOM en vivo con `javascript_tool`) y no se reprodujo —
  geoman ya maneja `L.CircleMarker` con su propio módulo dedicado, sin
  cadena de vértices. Se mejoró igual el texto de ayuda de "Ajustar
  geometría" para derivar del tipo de geometría real (`record.geom.type`),
  nunca de `tabla_origen`.
- **Mecanismo de solapamiento** (`fn_validar_topologia_eudr`): ya filtraba
  por `ID_Organizacion`, ya excluía el propio registro, y ya calculaba el
  % con `::geography` — los 3 checks pedidos ya estaban correctos, sin
  necesidad de una migración de corrección.
- **Nueva capa de comparación visual**: cuando "Ejecutar Test Espacial"
  detecta solapamiento, `QcConsoleMap.jsx` dibuja las geometrías
  APROBADAS reales contra las que solapa (contorno punteado ámbar), vía
  `fetchComparisonGeometries` (`lib/eudrQcActions.js`, nueva) — consulta
  `vw_monitoreo_poligonos` por los `registro_id` que la RPC ya identificó,
  filtrado igual por `ID_Organizacion` como defensa en profundidad. Se
  limpia al cambiar de registro seleccionado.
