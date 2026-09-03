# ADR-032 — Limpieza de 8 políticas RLS huérfanas, nombradas en español, en `INSPECCIONES` y las 6 `CAP_*`

- **Estado:** Propuesto — migración escrita, **sin aplicar y sin commitear**, pendiente de aprobación.
- **Migraciones:**
  `supabase/migrations/20260903064952_limpieza_drift_rls_policies_espanol.sql`
  (nueva, este ADR).
- **Código:** ninguno — cambio puro de RLS, sin tocar ningún archivo de
  `app/`/`lib/`/`components/`.
- **Tests:** ninguno nuevo — verificación hecha con consultas de solo
  lectura directas contra la instancia real (ver "Verificación de
  neutralidad" abajo), no con `node --test`.
- **Contexto previo:** hallazgo original en `ADR-031` (mismo patrón de
  política `anon` efectivamente sin restricción real, en `PADRON_SOCIOS`/
  `PADRON_PARCELAS`, ya cerrado ahí); `20260818_fix_inspecciones_rls.sql`
  (políticas oficiales `rls_anon_all_inspecciones`/`rls_anon_all_cap_*`
  con las que se verificó la redundancia).

## Contexto — el hallazgo

Durante el reconocimiento previo al diseño del enforcement de roles
(Fase D, `specs/login_real_organizacion_rol.md`), auditando en vivo
`pg_policies` para las tablas que respaldan `/dashboard/inspecciones`,
apareció un patrón de drift distinto al ya conocido en `EUDR_MONITOREO`/
`PADRON_*` (ver "Fuera de alcance" abajo): **8 políticas activas hoy en
la instancia real, en 7 tablas, con nombres en español y sin prefijo
`rls_*`/`ryzos_*`** — estilo completamente distinto a toda convención de
nombres usada en este repo desde su primera migración:

```
INSPECCIONES     | "Permitir edicion desde el panel web" | UPDATE | {public} | qual: true
INSPECCIONES     | "Permitir lectura al panel web"       | SELECT | {public} | qual: true
CAP_DATOS_SOCIO  | "Permitir web SOCIO"                  | ALL    | {public} | qual: true
CAP_MIC          | "Permitir web MIC"                    | ALL    | {public} | qual: true
CAP_CONSERVACION | "Permitir web MIC"                    | ALL    | {public} | qual: true
CAP_BIENESTAR    | "Permitir web MIC"                    | ALL    | {public} | qual: true
CAP_RIESGOS      | "Permitir web MIC"                    | ALL    | {public} | qual: true
CAP_GESTION      | "Permitir web MIC"                    | ALL    | {public} | qual: true
```

Curiosidad confirmada, no relevante para el riesgo pero sí para el
diagnóstico de origen: el nombre `"Permitir web MIC"` está copiado
literal en 5 de las 6 tablas `CAP_*` (`CAP_MIC`, `CAP_CONSERVACION`,
`CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION`) — consistente con haberse
creado a mano en Supabase Studio, copiando/pegando la misma política
tabla por tabla sin renombrarla.

**Confirmado con grep exacto de cada uno de los 4 nombres literales
(`"Permitir edicion desde el panel web"`, `"Permitir lectura al panel
web"`, `"Permitir web SOCIO"`, `"Permitir web MIC"`) contra
`supabase/migrations/*.sql` completo: cero apariciones.** Ninguna
migración de este repo —aplicada o no— las crea, las referencia, ni
depende de encontrarlas. Se originaron fuera del historial de
migraciones de este repo, en algún punto anterior a que estas 7 tablas
empezaran a tener migraciones propias acá.

## Verificación de neutralidad

Antes de proponer el `DROP`, se confirmó contra la instancia real que
ninguna de las 8 políticas está cubriendo hoy un acceso que la política
oficial equivalente no cubra ya:

- **`INSPECCIONES`:** la oficial `rls_anon_all_inspecciones`
  (`20260818_fix_inspecciones_rls.sql`) usa
  `USING("ID_Organizacion" IS NOT NULL OR service_role OR postgres)`.
  Las 2 en español usan `qual: true`, sin condición. Para que fueran
  equivalentes hacía falta que ninguna fila real tuviera
  `"ID_Organizacion" IS NULL` — verificado con:
  ```sql
  SELECT count(*) FROM public."INSPECCIONES" WHERE "ID_Organizacion" IS NULL;
  -- resultado real: 0
  ```
  Con 0 filas en ese estado, `"ID_Organizacion" IS NOT NULL` y `true`
  son observacionalmente idénticas sobre los datos reales de hoy — el
  `DROP` de las 2 políticas en español no cierra ningún acceso que la
  oficial ya no cerrara.
- **Las 6 `CAP_*`:** no hizo falta el mismo chequeo de filas — la
  oficial `rls_anon_all_cap_*` de cada tabla ya es
  `USING(true) WITH CHECK(true)` (sin ninguna condición que filtrar,
  ver `20260818_fix_inspecciones_rls.sql`), así que **cualquier fila
  que la política en español dejara pasar, la oficial también la deja
  pasar** — subconjunto trivial, sin necesidad de contar filas.
- **Ninguna dependencia de nombre:** el mismo grep exacto de los 4
  nombres contra `supabase/migrations/*.sql` (aplicadas o no, incluidas
  las 2 migraciones de contención de emergencia preparadas y sin
  aplicar,
  `20260901150000_lock_anon_write_inspecciones_cap.sql`/
  `20260901150100_lock_anon_all_inspecciones_cap.sql`) confirma que
  ningún `DROP POLICY IF EXISTS` futuro que dependa de encontrar la
  política oficial por nombre se ve afectado por eliminar además estas
  8 — no hay ningún archivo que las mencione, en ningún sentido.

## Decisión

`DROP POLICY IF EXISTS` de las 8, una migración idempotente
(`supabase/migrations/20260903064952_limpieza_drift_rls_policies_espanol.sql`),
sin tocar ninguna otra política, sin tocar `GRANT`/`REVOKE`, sin tocar
código de aplicación. Es limpieza de superficie RLS — reduce el número
de objetos a auditar en el futuro — **no es un endurecimiento de
seguridad**: el acceso `anon`/`public` efectivo a estas 7 tablas no
cambia en absoluto, porque las políticas oficiales ya cubrían (o
excedían) exactamente el mismo universo.

## Fuera de alcance (explícitamente, no un olvido)

Este ADR resuelve únicamente las 8 políticas en español. Dos hallazgos
relacionados, encontrados en la misma auditoría, quedan **sin resolver**
a propósito:

1. **Drift más amplio en las 5 tablas EUDR/PADRON** — `EUDR_MONITOREO`,
   `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`, `PADRON_SOCIOS`,
   `PADRON_PARCELAS` tienen cada una 2 políticas huérfanas adicionales,
   distintas de las de este ADR:
   - Una `ryzos_all_*` (nombrada en el vocabulario del repo, definida en
     `20260815_fase1_security_storage.sql`/`20260815_fix_rls_policies.sql`,
     que `20260816_fase3_seguridad_rls.sql` debía eliminar vía
     `DROP POLICY IF EXISTS` explícito y sigue viva en las 5 tablas —
     ese `DROP` nunca surtió efecto real en producción).
   - Una `rls_all_*`/`ryzos_all_monitoreo`/`ryzos_all_parcelas`/
     `ryzos_all_socios`, que **no aparece en ningún archivo de
     migración** — mismo tipo de drift que este ADR, pero en tablas y
     con condiciones (`auth_org_id()`/`get_my_org_id()`/claim JWT crudo)
     distintas, que sí requieren verificar `NULL`/degradación antes de
     tocarlas (a diferencia de las 8 de este ADR, con `qual: true`
     trivial). Necesita su propio ADR y su propia migración — no se
     mezcla acá porque el análisis de neutralidad es distinto (depende
     de que `auth_org_id()`/`get_my_org_id()`/el claim crudo degraden a
     `NULL` para `anon`, no de un conteo de filas).
2. **Endurecimiento real de `anon` en `INSPECCIONES`/`CAP_*`** (Fase C
   Paso 2 del proyecto de login real,
   `specs/login_real_organizacion_rol.md` §6) — las políticas oficiales
   `rls_anon_all_inspecciones`/`rls_anon_all_cap_*` siguen permitiendo
   lectura y escritura `anon` sin aislamiento real de organización (ni
   siquiera las 6 `CAP_*`, que no filtran ni por
   `"ID_Organizacion" IS NOT NULL`). Existen 2 migraciones de
   contención preparadas y sin aplicar
   (`20260901150000_lock_anon_write_inspecciones_cap.sql`,
   `20260901150100_lock_anon_all_inspecciones_cap.sql`), pero aplicar
   cualquiera de las 2 rompe el guardado de inspecciones hoy mismo:
   `fn_guardar_inspeccion_completa()` no es `SECURITY DEFINER` (corre
   con el rol del llamador, hoy `anon`, sobre tablas que dependían
   deliberadamente de RLS abierta para `anon`) — cerrar esa escritura
   sin un reemplazo `SECURITY DEFINER` equivalente deja el módulo de
   Inspecciones inutilizable. Este es el bloqueante real de la Fase C
   Paso 2, ya documentado en `ADR-031` ("Salvedad importante para quien
   implemente la fase 2") y en `AI_STATE.md` — este ADR no lo resuelve,
   solo lo re-confirma como pendiente.
