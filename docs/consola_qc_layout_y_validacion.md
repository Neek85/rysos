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
