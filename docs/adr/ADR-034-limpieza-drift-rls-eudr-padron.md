# ADR-034 — Limpieza de drift RLS en las 5 tablas EUDR/PADRON + creación de las políticas oficiales faltantes en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** Propuesto — migración escrita, **sin aplicar y sin
  commitear**, pendiente de aprobación.
- **Migraciones:**
  `supabase/migrations/20260903180720_limpieza_drift_rls_eudr_padron.sql`
  (nueva, este ADR).
- **Código:** ninguno — cambio puro de RLS, sin tocar ningún archivo de
  `app/`/`lib/`/`components/`.
- **Tests:** ninguno nuevo — verificación hecha con consultas de solo
  lectura directas contra la instancia real (`pg_policies`,
  `information_schema.role_table_grants`) y lectura completa del
  historial de migraciones (`grep`), no con `node --test`.
- **Contexto previo:** `ADR-031` (mismo patrón — política `anon`
  efectivamente sin restricción real, en `PADRON_SOCIOS`/
  `PADRON_PARCELAS` — resuelto ahí para el `SELECT` de `anon`, que este
  ADR no vuelve a tocar); `ADR-032` (mismo patrón de drift —
  huérfanas creadas fuera del repo — resuelto para `INSPECCIONES`/
  `CAP_*`, con la nota explícita de que el drift de estas 5 tablas
  "queda pendiente, fuera de alcance"); `ADR-033` (aislamiento real
  `authenticated`/`anon` en `INSPECCIONES`/`CAP_*`, el mismo patrón
  final que este ADR deja en estas 5 tablas).

## Contexto — el hallazgo

Reconocimiento en vivo (2026-09-03, esta sesión) contra
`jhtocgxlozfuzullrtol`: **21 políticas activas hoy en las 5 tablas**,
cruzadas contra el historial completo de migraciones (`grep -rn` sobre
`supabase/migrations/*.sql` y `supabase/migrations/archivadas/*.sql`).
**13 de las 21 son huérfanas**, en 3 grupos con orígenes distintos:

**Grupo 1 — `rls_all_*` (5 políticas): nunca creadas por ninguna
migración de este repo.**
```
rls_all_eudr_monitoreo, rls_all_eudr_instalaciones, rls_all_eudr_uso_suelo,
rls_all_padron_socios, rls_all_padron_parcelas
```
`grep -rn` de cada nombre contra el historial completo (activo +
`archivadas/`): cero resultados. Se originaron fuera de este repo —
probablemente en Supabase Studio, mismo patrón que ADR-032 documentó
para las 8 políticas en español de `INSPECCIONES`/`CAP_*`.

**Grupo 2 — `ryzos_all_monitoreo`/`ryzos_all_socios`/`ryzos_all_parcelas`
(3 políticas): tampoco creadas por ninguna migración, y asimétricas
entre tablas.**
```
ryzos_all_monitoreo   -- solo en EUDR_MONITOREO
ryzos_all_socios      -- solo en PADRON_SOCIOS
ryzos_all_parcelas    -- solo en PADRON_PARCELAS
```
`EUDR_INSTALACIONES`/`EUDR_USO_SUELO` no tienen ningún equivalente —
confirma que no es un patrón sistemático aplicado a las 5 tablas por
igual, sino artefactos puntuales. `grep -rn` de los 3 nombres: cero
resultados en todo el historial.

**Grupo 3 — `ryzos_all_eudr_*`/`ryzos_all_padron_*` (5 políticas): SÍ
fueron creadas por una migración activa, pero otra migración activa
posterior intentó eliminarlas explícitamente y ese `DROP` nunca surtió
efecto en producción.**
```
ryzos_all_eudr_monitoreo, ryzos_all_eudr_instalaciones, ryzos_all_eudr_uso_suelo,
ryzos_all_padron_socios, ryzos_all_padron_parcelas
```
Creadas por `20260815_fase1_security_storage.sql`/
`20260815_fix_rls_policies.sql`. `20260816_fase3_seguridad_rls.sql`
contiene, para cada una de las 5, un `DROP POLICY IF EXISTS` explícito
antes de crear las políticas `rls_select_*`/`rls_write_*` que debían
reemplazarlas — pero las 5 siguen vivas hoy. Mismo patrón exacto que
`20260816_fase3_seguridad_rls.sql` intentó (y falló en) para
`INSPECCIONES`/`CAP_*`, ya documentado en el contexto de ADR-032.

## Hallazgo adicional, más serio que el drift en sí: `PADRON_SOCIOS`/`PADRON_PARCELAS` nunca tuvieron políticas `rls_select_*`/`rls_write_*` vivas

`20260816_fase3_seguridad_rls.sql` crea, para las 5 tablas por igual,
un par `rls_select_<tabla>`/`rls_write_<tabla>` (`SELECT` y `FOR ALL`
respectivamente, ambos con la condición
`"ID_Organizacion" = auth_org_id() OR service_role OR postgres`).
Para las 3 tablas EUDR, ese par existe hoy en producción — redefinido
una vez más por `20260818_rls_multi_tenant_fortification.sql` (mismo
nombre, mismo patrón, solo una segunda pasada de DROP+CREATE ese mismo
día), y verificado en `pg_policies` (`rls_select_eudr_monitoreo`,
`rls_write_eudr_monitoreo`, etc. — presentes, con la condición
esperada).

**Para `PADRON_SOCIOS`/`PADRON_PARCELAS`, ese mismo par (`rls_select_padron_socios`/
`rls_write_padron_socios`/`rls_select_padron_parcelas`/
`rls_write_padron_parcelas`) NO aparece en `pg_policies` en absoluto.**
Ningún archivo posterior las redefine ni las borra — simplemente no
están, pese a que `20260816_fase3_seguridad_rls.sql` sí las crea.
Mismo patrón de "cambio manual en Studio que diverge del historial de
migraciones" que el resto de este ADR documenta, pero con una
consecuencia distinta: acá el problema no es que sobre una política
redundante, es que **falta la política oficial de escritura/lectura
autenticada real** — hoy, el único acceso `authenticated` efectivo a
`PADRON_SOCIOS`/`PADRON_PARCELAS` corre a través de las políticas
huérfanas de los 3 grupos de arriba (`rls_all_*`, `ryzos_all_*`), no de
ninguna política documentada. **Borrar las huérfanas sin crear antes
las oficiales dejaría a `authenticated` sin ningún acceso real a estas
2 tablas** — por eso esta migración hace la Parte 1 (crear) antes que
la Parte 2 (borrar), en la misma transacción.

## Verificación de neutralidad ante `anon`

Ninguna de las 13 huérfanas deja pasar a `anon`, por 2 razones
distintas según el grupo:

- **Las 5 del Grupo 3 (`ryzos_all_eudr_*`/`ryzos_all_padron_*`):**
  `roles = {authenticated}` — `anon` no está en el alcance de la
  política en absoluto, sin importar la condición.
- **Las 8 de los Grupos 1 y 2 (`rls_all_*`, `ryzos_all_monitoreo`/
  `_socios`/`_parcelas`):** todas tienen `roles = {public}` (que sí
  incluye `anon`), pero:
  - Las 5 `rls_all_*` usan `"ID_Organizacion" = auth_org_id() OR
    auth.role() = 'service_role'`.
  - Las 3 `ryzos_all_monitoreo`/`_socios`/`_parcelas` usan
    `"ID_Organizacion" = (current_setting('request.jwt.claims')::json
    ->> 'ID_Organizacion') OR (...->>'role' = 'service_role')` — no
    llama a `auth_org_id()`/`auth_role()` por nombre, pero usa el mismo
    mecanismo subyacente de lectura de claim JWT al que `auth_org_id()`
    cae como fallback.

  Ambos mecanismos ya están confirmados, en esta sesión y en el propio
  comentario fuente de `auth_org_id()`
  (`20260902213506_login_fase_a_identidad.sql`), como `NULL` para la
  llave `anon` (su JWT no lleva ningún claim `ID_Organizacion`). `NULL
  OR false` no es `TRUE` — ninguna de las 8 pasa para `anon`.

**Conclusión: el `DROP` de las 13 no cambia ningún comportamiento de
acceso real hoy** — es limpieza de superficie RLS + relleno de un hueco
de políticas oficiales faltantes, no un endurecimiento ni un
debilitamiento de seguridad para ningún rol.

## Decisión

Una sola migración, en una transacción:

1. **Crear** `rls_select_padron_socios`/`rls_write_padron_socios`/
   `rls_select_padron_parcelas`/`rls_write_padron_parcelas` —
   idénticas en forma a las que ya existen y funcionan en las 3 tablas
   EUDR (`"ID_Organizacion" = auth_org_id() OR service_role OR
   postgres`), con `DROP POLICY IF EXISTS` antes de cada `CREATE` para
   que la migración sea segura de re-correr.
2. **Borrar** las 13 políticas huérfanas de los 3 grupos, con `DROP
   POLICY IF EXISTS` (idempotente).

El orden (crear antes de borrar) es deliberado, no cosmético — ver la
sección anterior.

## Fuera de alcance, explícito

1. **No se tocan `rls_anon_select_padron_socios`/
   `rls_anon_select_padron_parcelas`** — ya están correctas desde
   ADR-031 (`USING (false)`, cierre completo de lectura `anon` directa),
   confirmado en el reconocimiento de esta sesión, sin cambios.
2. **No se agrega ninguna política de rol granular** (`admin`/
   `tecnico_campo`/`auditor_qc`) todavía — las políticas
   `rls_select_*`/`rls_write_*` de esta migración siguen siendo
   "cualquier `authenticated` de la organización correcta", igual que
   las 3 tablas EUDR ya vigentes. Diferenciar por rol dentro de una
   misma organización es la Fase D Paso 2 real
   (`specs/login_real_organizacion_rol.md`), que sigue pendiente. Esta
   migración deja a las 5 tablas EUDR/PADRON estructuralmente parejas
   entre sí y con el patrón ya aplicado a `INSPECCIONES`/`CAP_*` en
   ADR-033 — el prerrequisito para poder diseñar esa fase de forma
   uniforme, no la propia fase.
3. **No se toca ningún `GRANT`/`REVOKE`** de tabla — confirmado en el
   reconocimiento que `anon`/`authenticated` ya tienen los mismos
   grants amplios en las 5 tablas que en `INSPECCIONES`/`CAP_*`; RLS es
   la única superficie que este ADR ajusta, igual que ADR-032/033.
