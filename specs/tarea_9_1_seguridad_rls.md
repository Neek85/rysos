# SPEC: Seguridad RLS Multi-Tenant Consolidada (Tarea 9.1)

## 1. Objetivo
Habilitar y consolidar Row Level Security (RLS) en todas las tablas maestras y transaccionales del sistema, más el bucket de Storage `evidencias_eudr`, aislando el acceso estrictamente por el claim `ID_Organizacion` del JWT de Supabase Auth — reemplazando el helper `public.get_my_org_id()` (basado en `auth.jwt()`) por una función nueva `public.auth_org_id()` (basada en `current_setting('request.jwt.claims', true)`), sin romper ningún objeto ya desplegado que dependa del helper anterior.

## 2. Contexto: relación con la migración previa
`supabase/migrations/20260815_fix_rls_policies.sql` ya había dejado RLS habilitado y políticas activas sobre las mismas 6 tablas, usando `public.get_my_org_id()` y un único patrón `FOR ALL` por tabla. Esta tarea **no** parte de cero: `20260816_fase3_seguridad_rls.sql`...

- Elimina (`DROP POLICY IF EXISTS`) las políticas `ryzos_*` de la migración anterior y las reemplaza por un set nuevo con nombres `rls_select_*` / `rls_write_*` — nunca deja ambos sets activos simultáneamente (evita políticas duplicadas/redundantes sobre la misma tabla).
- Crea `public.auth_org_id()` como la función auxiliar autoritativa nueva.
- Redefine `public.get_my_org_id()` como un **alias delgado** que delega en `public.auth_org_id()`, en vez de eliminarlo — porque `trg_set_id_organizacion()` (el trigger que auto-inyecta `ID_Organizacion` en INSERTs) y potencialmente otros objetos ya desplegados siguen llamándolo por nombre. Esto evita tener que tocar/redesplegar el trigger en esta misma migración.

## 3. Invariantes de Negocio y Seguridad
- **Aislamiento por Claim JWT:** Toda política usa `"<columna>" = public.auth_org_id()` como condición central; `auth_org_id()` extrae `ID_Organizacion` de `current_setting('request.jwt.claims', true)::json`, devolviendo `NULL` (nunca cadena vacía) si el claim no está presente — un `NULL` nunca satisface `= `, así que un usuario sin ese claim no ve ni escribe ninguna fila.
- **Bypass service_role:** Toda política agrega `OR auth.role() = 'service_role' OR current_user = 'postgres'`. El primero es redundante con el atributo `BYPASSRLS` que Supabase ya otorga por defecto al rol `service_role` (los requests con la Service Role Key ya bypasean RLS a nivel de rol, no de política) — se incluye igual como defensa en profundidad explícita. El segundo preserva el acceso irrestricto desde el SQL Editor de Supabase Studio, que ejecuta como el rol `postgres`.
- **Asimetría deliberada en `ORGANIZACIONES`:** Solo recibe política de `SELECT`. Es la tabla de identidad del tenant (una fila por organización); un usuario autenticado de esa organización no debe poder modificar ni borrar su propio registro vía API — igual que en la migración anterior, comportamiento preservado intencionalmente, no una omisión.
- **Lectura + Escritura en las 5 tablas restantes:** `PADRON_SOCIOS`, `PADRON_PARCELAS`, `EUDR_MONITOREO`, `EUDR_INSTALACIONES`, `EUDR_USO_SUELO` reciben una política `FOR SELECT` y una política `FOR ALL` (cubre INSERT/UPDATE/DELETE, con solape intencional y no dañino sobre SELECT — Postgres combina políticas permisivas múltiples con OR). `CREATE POLICY` no admite una lista `FOR INSERT, UPDATE, DELETE` en una sola sentencia; `FOR ALL` es la forma válida de cubrir las tres operaciones de escritura en una política.
- **Storage aislado por prefijo de carpeta:** Toda política de `storage.objects` exige `bucket_id = 'evidencias_eudr' AND (storage.foldername(name))[1] = public.auth_org_id()`, consistente con la convención `{ID_Organizacion}/{filename}` que usa `scripts/etl_drive_to_supabase.py` desde la Tarea 7.5.
- **Política de Storage UPDATE agregada:** La migración anterior solo tenía SELECT/INSERT/DELETE sobre `storage.objects`. Se agrega `rls_storage_update_evidencias`, ausente hasta ahora — relevante porque `upload_evidence_photo()` sube con `upsert=true` (agregado en una tarea de ETL previa para evitar 409 Duplicate en nombres de archivo repetidos), que en un re-procesamiento ejecuta un UPDATE sobre el objeto existente además del INSERT inicial; sin política de UPDATE, ese camino podía fallar bajo RLS estricto.

## 4. Criterios de Aceptación
- [ ] RLS está habilitado (`rowsecurity = true` en `pg_tables`) en las 6 tablas listadas.
- [ ] `public.auth_org_id()` existe, es `STABLE`, y devuelve `NULL` (no `''`) cuando el claim `ID_Organizacion` está ausente.
- [ ] `public.get_my_org_id()` sigue existiendo y devuelve el mismo valor que `public.auth_org_id()` — `trg_set_id_organizacion()` no requiere cambios.
- [ ] Un usuario autenticado de la Organización A no puede leer ni escribir filas de la Organización B en ninguna de las 6 tablas.
- [ ] `ORGANIZACIONES` solo permite `SELECT`; un intento de `UPDATE`/`DELETE`/`INSERT` desde un usuario `authenticated` (no `service_role`/`postgres`) es rechazado por RLS.
- [ ] `storage.objects` del bucket `evidencias_eudr` aísla por primer segmento de ruta (`ID_Organizacion`) en SELECT, INSERT, UPDATE y DELETE.
- [ ] Un request con la Service Role Key (o ejecutado como `postgres`) tiene acceso completo a las 6 tablas y al bucket, sin restricción de organización.
- [ ] La migración es idempotente: `DROP POLICY IF EXISTS` (nombres viejos `ryzos_*` y los nuevos `rls_*`) antes de cada `CREATE POLICY`; `CREATE OR REPLACE FUNCTION` para ambos helpers; `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` es seguro re-ejecutar.

## 5. Plan de Despliegue
1. Ejecutar `supabase/migrations/20260816_fase3_seguridad_rls.sql` en el SQL Editor de Supabase (o `supabase db push`).
2. Verificar que ningún objeto quedó con políticas duplicadas:
   ```sql
   SELECT tablename, policyname FROM pg_policies
   WHERE schemaname IN ('public', 'storage')
   ORDER BY tablename, policyname;
   ```
   No debe aparecer ningún `ryzos_*` junto a los `rls_*` nuevos en la misma tabla.
3. Probar con dos usuarios autenticados de organizaciones distintas que cada uno solo ve/edita sus propias filas en las 6 tablas y sus propios objetos en `evidencias_eudr`.
4. Confirmar que el trigger `trg_set_id_organizacion()` (Fase 1) sigue auto-completando `ID_Organizacion` en INSERTs sin cambios — no debería requerir ninguna acción, pero es la prueba de que el alias `get_my_org_id() -> auth_org_id()` funciona correctamente.
5. Confirmar que una re-ingesta del mismo paquete ETL (upsert con foto repetida) no falla por RLS en el UPDATE de `storage.objects`.

## 6. Rollback
Restaurar el set de políticas de `supabase/migrations/20260815_fix_rls_policies.sql` (que sigue en el historial de migraciones) re-ejecutándolo: sus propios `DROP POLICY IF EXISTS` limpian los nombres `rls_*` que no reconoce (los deja intactos, ya que solo referencia nombres `ryzos_*` y legacy) — por lo tanto el rollback real requiere además borrar explícitamente las políticas `rls_*` de esta migración:
```sql
DROP POLICY IF EXISTS "rls_select_organizaciones" ON public."ORGANIZACIONES";
DROP POLICY IF EXISTS "rls_select_padron_socios" ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_write_padron_socios" ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_select_padron_parcelas" ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "rls_write_padron_parcelas" ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "rls_select_eudr_monitoreo" ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "rls_write_eudr_monitoreo" ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "rls_select_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "rls_write_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "rls_select_eudr_uso_suelo" ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "rls_write_eudr_uso_suelo" ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "rls_storage_select_evidencias" ON storage.objects;
DROP POLICY IF EXISTS "rls_storage_insert_evidencias" ON storage.objects;
DROP POLICY IF EXISTS "rls_storage_update_evidencias" ON storage.objects;
DROP POLICY IF EXISTS "rls_storage_delete_evidencias" ON storage.objects;
```
`public.auth_org_id()` puede quedar sin usar tras el rollback (no genera error dejarla); `public.get_my_org_id()` no debe eliminarse en ningún caso — el trigger de auto-inyección depende de ella.

## 7. Riesgo Residual
No se pudo ejecutar ni verificar esta migración contra una instancia real de Postgres/Supabase desde este entorno (sin `psql` ni conexión local). Se revisó cuidadosamente la sintaxis (incluyendo corregir un `FOR INSERT, UPDATE, DELETE` inválido — `CREATE POLICY` solo admite un único comando por política, no una lista — reemplazado por `FOR ALL`), pero la validación definitiva de tipos de columna (`"ID_Organizacion"` como texto en las 6 tablas) y de la existencia de `auth.role()` en el proyecto Supabase del usuario queda pendiente de la ejecución real.
