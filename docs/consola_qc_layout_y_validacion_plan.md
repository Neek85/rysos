# Plan de ejecución: Reordenar Consola QC + Corregir validación topológica

## Fase 1 — Investigación (no tocar código todavía)
1. Leer `docs/schema_live.md` para confirmar el estado real de funciones y
   tablas relacionadas a QC/monitoreo.
2. Buscar en `supabase/migrations/*.sql` cualquier referencia histórica a
   `fn_validar_topologia_eudr` (creación, alteración o eliminación).
3. Leer el componente actual de la Consola QC (probablemente en
   `components/gis/` o `app/dashboard/qc/`) para entender la estructura
   actual del layout antes de modificarlo.
4. Reportar hallazgos antes de escribir ninguna migración o código.

## Fase 2 — Base de datos
1. Crear migración `supabase/migrations/YYYYMMDDHHMMSS_fn_validar_topologia_eudr.sql`
   con la función, idempotente (`CREATE OR REPLACE FUNCTION`).
2. Documentar el ADR correspondiente en `docs/adr/`.
3. Nota: esta migración se aplica manualmente en Supabase Studio SQL Editor
   (no hay CLI de Supabase vinculada en este repo, según `CLAUDE.md`) —
   dejar la migración lista y avisar que requiere aplicación manual.

## Fase 3 — Frontend (layout)
1. Modificar el componente de la Consola QC para pasar de layout apilado
   (mapa arriba, panel abajo) a layout de dos/tres columnas (lista |
   mapa | panel de edición fijo).
2. Verificar que el editor vectorial, dibujo de geometría y sincronización
   con Google Drive sigan funcionando igual.
3. Verificar visualmente con `npm run dev` (no hay `npm test` para frontend
   en este repo, según `CLAUDE.md`).

## Fase 4 — Verificación funcional
1. Confirmar que "Ejecutar Test Espacial" ya no muestra el error de función
   no encontrada.
2. Confirmar que "Guardar Cambios de Geometría" completa el flujo sin el
   error de estado PENDIENTE, en un registro de prueba.
3. Confirmar visualmente que el panel derecho es accesible sin scroll al
   seleccionar cualquier registro de la lista.

## Fase 5 — Cierre
1. Commit siguiendo Conventional Commits:
   `fix(qc): reordenar layout y restaurar función de validación topológica`
2. Push a `staging`, no a `main` (regla inviolable del prompt V3.1).
3. Actualizar `ESTADO_PROYECTO.md` con el resultado de esta tarea.
