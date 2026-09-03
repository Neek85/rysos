# Migraciones archivadas

Este directorio no es leído por el Supabase CLI (`supabase migration
list`/`db push` solo miran archivos directos en `supabase/migrations/`,
no subdirectorios) — los archivos de acá nunca se aplican por accidente.

## `20260901150000_lock_anon_write_inspecciones_cap.sql` / `20260901150100_lock_anon_all_inspecciones_cap.sql`

Migraciones de contención de emergencia, preparadas pero nunca
aplicadas, para `INSPECCIONES` + las 6 `CAP_*`. Quedaron **obsoletas y
superadas** por
`supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`
(ver [ADR-033](../../docs/adr/ADR-033-fase-c-paso2-rls-real-inspecciones-cap.md)),
que ya está aplicada en producción y da aislamiento real por
organización — estas 2 solo daban un gate por rol sin aislamiento real
(`IS NOT NULL`/`true`), y además usaban nombres de política
(`rls_anon_deny_*`) que colisionan literalmente con los que crea
ADR-033. **No aplicar nunca estos 2 archivos** — se conservan acá solo
como referencia histórica del incidente que motivó ADR-033.
