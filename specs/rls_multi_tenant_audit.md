# Spec — Auditoría RLS Multi-Tenant y Blindaje (Zero-Trust donde aplica)

## Contexto y hallazgos de la auditoría (antes de escribir código)

Se auditó el historial completo de `supabase/migrations/*.sql` y el uso real
de cada vista en el frontend (`app/`, `components/`, `lib/`) antes de escribir
esta migración. Hallazgos:

1. **La mayoría de las tablas "core"/"agrícolas" YA tienen RLS Zero-Trust
   desde Tarea 9.1** (`20260816_fase3_seguridad_rls.sql`): `ORGANIZACIONES`,
   `PADRON_SOCIOS`, `PADRON_PARCELAS`, `EUDR_MONITOREO`, `EUDR_USO_SUELO`,
   `EUDR_INSTALACIONES` tienen `ENABLE ROW LEVEL SECURITY` + políticas
   `rls_select_*`/`rls_write_*` filtrando por `"ID_Organizacion" =
   public.auth_org_id()`. No hay una "brecha" real que cerrar ahí — el valor
   de esta tarea es re-certificar esas políticas de forma idempotente
   (defensa contra drift si alguien las alteró a mano en Supabase Studio),
   no inventar lógica nueva.
2. **No existen tablas "pecuarias" en el proyecto** (búsqueda exhaustiva:
   cero resultados para "pecuaria"/"ganado"/"livestock" en todo el repo).
   RYZOS es exclusivamente cafetalero. Se excluyen del alcance por no existir.
3. **Las 6 tablas `CAP_*` no tienen columna `ID_Organizacion` propia**
   (dependen de `ID_Inspeccion → INSPECCIONES.ID_Organizacion`, confirmado en
   `specs/fase6_inspecciones_socioeconomicas.md`). Un filtro literal
   `USING ("ID_Organizacion" = ...)` sobre esas 6 tablas fallaría al crear la
   política — la columna no existe.
4. **`INSPECCIONES` + 6 `CAP_*` + `PADRON_SOCIOS` + `PADRON_PARCELAS` (para
   `anon`) dependen de políticas deliberadamente abiertas** agregadas el
   mismo día (`20260818_fix_inspecciones_rls.sql`) porque el frontend usa
   exclusivamente la anon key, sin sesión real de Supabase Auth
   (`signInWithPassword` no existe en el repo) — no hay JWT del que extraer
   `ID_Organizacion`. Un filtro Zero-Trust estricto ahí rompería el
   formulario de Inspecciones y el autocompletado de padrón, revirtiendo un
   fix de producción del mismo día.
5. **HALLAZGO CRÍTICO NO PEDIDO EN EL PROMPT ORIGINAL, encontrado durante la
   auditoría:** `public.view_eudr_dashboard_aprobados` (Fase 1,
   `20260815_fase1_security_storage.sql` / `20260815_fix_rls_policies.sql`,
   consumida por `app/page.jsx`) selecciona `socio_nombre_completo` y
   `socio_dni` (PII: nombre completo + documento de identidad) **sin ningún
   filtro `ID_Organizacion` en su `WHERE`**. Como la vista corre con
   privilegio de su dueño (`postgres`), esto expone nombre y DNI de
   productores de **todas** las organizaciones cliente a cualquier sesión que
   pueda consultar la vista — el mismo mecanismo de "vista bypasea RLS de
   base" ya documentado para `vw_monitoreo_web`, pero sin el filtro de tenant
   que esa sí tiene. Confirmado además que `app/page.jsx` ni siquiera usa
   `socio_dni`/`socio_nombre_completo` (pide columnas que no existen ya en la
   vista actual — `hectareas`, `riesgo_satelital`, `lot_hash` — código
   huérfano de una línea de trabajo distinta a `vw_monitoreo_web`, ver nota en
   `docs/schema_live.md`). Se decidió corregir esta vista dentro de esta
   misma migración (confirmado con el usuario).

## Decisiones de diseño (confirmadas con el usuario)

1. **Reusar `public.auth_org_id()`** (autoritativa desde Tarea 9.1) en toda
   política nueva. No se crea `fn_get_user_org_id()` ni ninguna otra función
   competidora.
2. **No tocar políticas de `INSPECCIONES`/6 `CAP_*`/`PADRON_SOCIOS`/
   `PADRON_PARCELAS`** en esta migración. Se documentan explícitamente como
   riesgo aceptado por diseño (anon key sin Auth real) — ver sección
   siguiente.
3. **DELETE se mantiene habilitado** en `EUDR_MONITOREO`/`EUDR_USO_SUELO`/
   `EUDR_INSTALACIONES` (`FOR ALL`, igual que Tarea 9.1) — no es un
   endurecimiento nuevo, es consistencia con el estado actual.
4. **Se corrige `view_eudr_dashboard_aprobados`** dentro de esta migración:
   se agrega `WHERE "ID_Organizacion" = public.auth_org_id() OR ... service_role/postgres`
   (mismo patrón que el resto de políticas `authenticated`) y se eliminan
   `socio_dni`/`socio_nombre_completo` de la lista de columnas (mismo
   criterio de sanitización PII ya establecido en Tarea 14 —
   `tests/test_tarea14_trazabilidad.py` ya exige la ausencia exacta de estos
   dos campos en cualquier payload público). `localidad`/`certificaciones`
   se conservan — no están en la lista de campos PII establecida por Tarea 14.

## Riesgo aceptado por diseño — tablas fuera del modelo Zero-Trust

`INSPECCIONES`, `CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`,
`CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION`, `PADRON_SOCIOS` (solo la
política `anon` de lectura), `PADRON_PARCELAS` (solo la política `anon` de
lectura) **no filtran estrictamente por identidad de tenant autenticado**
porque no existe autenticación real en el frontend. El aislamiento real
depende de que el cliente (JS del navegador) envíe el `ID_Organizacion`
correcto — no hay control de servidor que lo verifique contra una sesión.
Este riesgo ya estaba aceptado y documentado en
`supabase/migrations/20260818_fix_inspecciones_rls.sql`; esta auditoría lo
confirma y lo deja explícito en `docs/schema_live.md` como parte del modelo
de amenazas vigente, sin proponer cambiarlo (requeriría implementar Supabase
Auth real, fuera de alcance).

## Criterios de aceptación

- AC1: `ORGANIZACIONES`, `EUDR_MONITOREO`, `EUDR_USO_SUELO`,
  `EUDR_INSTALACIONES` tienen RLS habilitado y políticas `SELECT`/escritura
  usando `public.auth_org_id()`, re-aplicadas de forma idempotente.
- AC2: `ORGANIZACIONES` sigue sin política de escritura (asimetría
  deliberada preservada de Tarea 9.1).
- AC3: `view_eudr_dashboard_aprobados` ya no expone `socio_dni` ni
  `socio_nombre_completo`, y filtra por `ID_Organizacion`.
- AC4: Ninguna política nueva referencia una columna `ID_Organizacion` en una
  tabla que no la tiene (las 6 `CAP_*` quedan explícitamente fuera).
- AC5: La migración es idempotente.
