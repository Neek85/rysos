# Plan de ejecución: huso horario operativo (America/Lima) en Pecuario

Spec: `specs/pecuario_huso_horario_lima.md`. Nada se aplica contra ninguna base desde el CLI.

## Orden

1. **Migración 1 (colocada, sin aplicar)** `supabase/migrations/20261008100000_huso_horario_lima_vistas_pecuario.sql`
   (sha256 `86ef7165…9763`, copia exacta). Reversa: `supabase/rollbacks/20261008100000_huso_horario_lima_rollback.sql`.
2. **Revisión de seguridad** de Cowork/Neyser (pendiente).
3. **Aplicación manual** por Neyser en Supabase Studio (una transacción; la guarda aborta si
   alguna de las 8 vistas cambió de columnas).
4. **Verificación posterior (CLI, solo lectura):** `pytest tests/test_pecuario_huso_horario.py`
   — b./d1 dejan de saltarse; ideal correrla entre las 19:00 y las 24:00 de Lima. Re-correr
   `tests/test_seguridad_vistas_sin_escritura.py` (el ACL de las vistas no debe cambiar).
   Comparar `SELECT *` de las 8 vistas con el snapshot `~/ryzos_scratch/huso_antes/`.
5. **Migración 2:** defaults `CURRENT_DATE` de Pecuario y las 3 funciones; tests existentes que
   asumen UTC o `date.today()`.
6. **Cliente:** helper único de "hoy" en la app Expo (offset fijo −5 h o `Intl` si Hermes lo soporta).
7. **Docs:** actualizar `docs/schema_live_core.md` / `docs/schema_live_pecuario.md` solo después de aplicar y verificar.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Deriva de esquema en alguna vista | Guarda previa de columnas en la migración |
| Pérdida de permisos de las vistas | `CREATE OR REPLACE VIEW` los conserva; el test de catálogo de ADR-043 los vigila |
| `anon`/`authenticated` sin `EXECUTE` en la función | `GRANT EXECUTE` explícito; test b. con ambos roles |
| Plan de consulta por función por fila | `LANGUAGE sql STABLE` sin `SET` ni `SECURITY DEFINER` (se expande en la consulta); sin argumentos |
| Reversa que "quita" la columna nueva | `CREATE OR REPLACE` no puede; la reversa la conserva |
| Pruebas con base escribiendo en producción | Solo GRANJA-TEST (`es_organizacion_prueba=true`, verificado en `setUpClass`), prefijo `TEST-HUSO-`, limpieza verificada en `tearDown` |

## Estado de las pruebas antes de aplicar

a. estáticos (migración y reversa) pasan; b. y d1 se saltan ("migración 20261008100000 no
aplicada"); c. pasan (lectura con anon/authenticated y aislamiento); d0 (siembra y limpieza
sin la migración) pasa.
