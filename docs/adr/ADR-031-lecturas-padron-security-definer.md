# ADR-031 — Cierre de lectura sin aislamiento de `PADRON_SOCIOS`/`PADRON_PARCELAS` vía `anon`

- **Estado:** Aceptado y aplicado en producción (2026-09-01).
- **Migraciones:**
  `supabase/migrations/20260901160000_lecturas_padron_security_definer.sql`
  (10 funciones `SECURITY DEFINER` + lockdown), `20260901161000_fix_fecha_columns_fn_listar_padron_socios.sql`
  (hotfix del mismo día, ver Consecuencias).
- **Código:** `lib/actions/padronReadActions.js` (Server Actions nuevas),
  `lib/sociosSearch.js`, `lib/padronSearch.js`, `lib/padronCsv.js`,
  `lib/eudrQcActions.js`, `app/dashboard/socios/page.jsx`,
  `components/features/socios/ParcelaFormModal.jsx`,
  `app/dashboard/qc/components/VectorEditorTools.jsx`,
  `components/features/inspecciones/tabs/TabGeneral.jsx`.
- **Tests:** `tests/test_padron_read_functions_live.mjs` (aislamiento
  cruzado contra la instancia real), más los tests existentes de cada
  archivo tocado, reescritos para inyectar la nueva forma de dependencia.
- **Contexto previo:** `docs/schema_live.md` sección "Funciones"/"RLS —
  estado real", `docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md`
  (mismo patrón `anon`-abierto, ahí sí deliberado para `INSPECCIONES`/`CAP_*`).

## Contexto — el hallazgo

`supabase/migrations/20260818_fix_inspecciones_rls.sql` agregó, para
habilitar el autocompletado del formulario de Inspecciones, 2 políticas
de lectura `anon` nuevas:

```sql
CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);
```

`"ID_Organizacion" IS NOT NULL` es, en la práctica, **sin ninguna
restricción real** — verdadero para prácticamente cualquier fila con ese
campo cargado, de **cualquier** organización. Como el frontend de RYZOS
no tiene sesión de Supabase Auth (solo usa la llave `anon`, pública por
diseño — embebida en el bundle JS del sitio en producción, nunca un
secreto), esto significaba que **cualquiera con esa llave podía leer el
padrón completo de cualquier organización, sin login, sin sesión, sin
pasar por ninguna pantalla de RYZOS**, con una simple consulta HTTP
directa al endpoint REST de Supabase.

**Confirmado en vivo, con evidencia real (no una hipótesis):**
- `PADRON_SOCIOS`: 685 filas alcanzables — 618 reales de
  `COOP-AROMAS-VALLE` + 67 de la organización de prueba `ORG-TEST-DEMO`,
  mezcladas, sin ningún filtro. DNI, nombre completo, celular,
  departamento/provincia/distrito confirmados poblados y legibles.
- `PADRON_PARCELAS`: 858 filas alcanzables (821 + 37), mismo patrón.
- Una vista adicional, `vw_parcelas_web` (`security_invoker=true`,
  hereda la misma RLS), exponía la misma superficie con un `GRANT` aún
  más amplio (incluía `DELETE`/`TRUNCATE`) y **no estaba referenciada
  por ningún archivo del repo** — superficie de ataque activa sin
  ningún beneficio funcional.

El hallazgo se originó investigando un hallazgo colateral distinto
(`exportSociosCsv`/`exportParcelasCsv` sin scope de organización) — al
tirar del hilo quedó claro que el problema no era esas 2 funciones, era
la política RLS de la que dependían.

## Decisión

**Reemplazar las 2 políticas de lectura `anon` por `USING (false)`**
(deniega todo SELECT directo de `anon` sobre ambas tablas), y **mover
toda lectura real a 10 funciones `SECURITY DEFINER` parametrizadas por
organización**:

`fn_listar_padron_socios`, `fn_listar_padron_parcelas_por_socio`,
`fn_buscar_padron_socios`, `fn_buscar_padron_parcelas`,
`fn_padron_socios_existentes`, `fn_padron_parcelas_existentes`,
`fn_padron_socios_ids_todos`, `fn_padron_socios_sample_activos`,
`fn_padron_parcelas_codigos_e_ids`, `fn_enriquecer_parcela_qc` — firmas
completas en `docs/schema_live.md`, sección "Funciones".

Las 10 comparten el mismo contrato de seguridad:
- `SECURITY DEFINER` + `SET search_path = public` fijo (mismo patrón ya
  establecido en el proyecto para funciones `SECURITY DEFINER`, ej.
  `20260815_fase1_security_storage.sql`) — necesario porque, con las
  políticas `anon` ahora en `USING (false)`, una función que no fuera
  `SECURITY DEFINER` no podría leer las tablas en absoluto al ser
  invocada por `anon`.
- `REVOKE EXECUTE` explícito de `PUBLIC`/`anon`/`authenticated` +
  `GRANT` único a `service_role` — **desde el día uno de esta
  migración**, no como fix posterior. Esto es deliberado: la función
  filtra por `p_organizacion` explícito dentro de su `WHERE`, pero esa
  garantía solo vale si el llamador no puede elegir libremente qué
  organización pedir — por eso el navegador nunca llama a estas
  funciones directo, solo `service_role` puede, a través de
  `lib/actions/padronReadActions.js` (Server Actions nuevas).
- Confirmado en vivo, no solo en el código: `anon` recibe `42501
  permission denied` al intentar ejecutar cualquiera de las 10 (ver
  `tests/test_padron_read_functions_live.mjs`), no un genérico "función
  no encontrada" — la barrera es real, no solo ausencia de exposición.

## Por qué no bastaba con corregir la política RLS sola

Cerrar la política sin nada más habría roto el producto: 6 caminos
reales de código dependían de leer `PADRON_SOCIOS`/`PADRON_PARCELAS`
directo con `anon`, no solo el autocompletado de Inspecciones que
motivó la política original:

1. `lib/sociosSearch.js::fetchSocios` — listado de `/dashboard/socios`.
2. `lib/sociosSearch.js::fetchParcelasBySocio` — parcelas de un socio.
3. `lib/padronSearch.js::searchSocios`/`searchParcelas` — autocompletado,
   usado por **2** consumidores reales (formulario de Inspecciones **y**
   el editor vectorial de la Consola QC) — el segundo no estaba
   identificado hasta hacer el refactor.
4. `lib/padronCsv.js` — detección de duplicados en el preview de
   importación masiva.
5. `lib/padronCsv.js` — plantillas descargables de Socios/Parcelas
   (cálculo de próximo código libre).
6. `lib/eudrQcActions.js::enrichWithParcelaInfo` — enriquecimiento de
   `parcela_codigo`/`parcela_nombre` en la Consola QC. **Hallazgo
   adicional acá:** esta consulta no filtraba por organización en
   absoluto (ni siquiera el defecto original de "sin restricción real"
   — directamente ningún filtro), un bug independiente descubierto al
   auditar este camino.

Cada uno de los 6 se reescribió para llamar a la función `SECURITY
DEFINER` correspondiente vía Server Action, en vez de consultar la tabla
base. `fetchSocios` de paso perdió su propio probe contra
`PADRON_SOCIOS` para "adivinar" la organización activa (única razón por
la que necesitaba leer la tabla antes de saber a qué organización
pertenecía) — ahora usa siempre `resolveOrganizationId()`
(Server Action ya existente, contra `ORGANIZACIONES`), simplificando el
código a la vez que cierra el hueco.

**Dos caminos deliberadamente NO tocados en esta fase** (documentados,
no un olvido): `exportSociosCsv`/`exportParcelasCsv` (los 2 botones de
exportar CSV) no estaban en la lista de "6 caminos" real — hoy devuelven
un CSV vacío en vez de filtrar mal (el hueco queda cerrado, pero la
función quedó rota; reemplazarlas por el mismo patrón es trabajo
pendiente, no incluido en esta ronda).

## Consecuencias

- **Hotfix el mismo día:** al correr el test de aislamiento cruzado
  contra la instancia real recién aplicada, `fn_listar_padron_socios`
  falló con `42804` — declaraba `socio_fecha_nacimiento`/
  `socio_fecha_ingreso` como `text` en su `RETURNS TABLE`, el tipo real
  en `PADRON_SOCIOS` es `date` (confirmado contra el OpenAPI de
  PostgREST, no asumido). Postgres no permite cambiar el tipo de una
  columna de `RETURNS TABLE` con `CREATE OR REPLACE` — hizo falta `DROP
  FUNCTION` + `CREATE`, lo que resetea privilegios a los defaults de
  Postgres (`EXECUTE` abierto a `PUBLIC`) — el `REVOKE`/`GRANT` se
  repitió completo en el hotfix por ese motivo, no por descuido. Las
  otras 9 funciones se probaron una por una contra datos reales antes de
  dar la migración por buena — sin más discrepancias.
- **Verificado end-to-end contra producción**, no solo con tests: 686/686
  tests (`node --test tests/*.mjs`), 6/6 tests de aislamiento cruzado
  real (`COOP-AROMAS-VALLE` vs `ORG-TEST-DEMO`, sin fake), y verificación
  manual en `/dashboard/socios` (618 socios reales, modal de Parcelas de
  un socio real con sus 2 parcelas reales) — ver `AI_STATE.md` para el
  detalle completo de cada paso.
- El mismo patrón — comentario que afirma una restricción que la
  política real no aplica — se detectó también en
  `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql`
  (esa función en sí SÍ es segura, corre solo con Service Role Key desde
  el servidor — el patrón de comentario engañoso es lo que se repite, no
  necesariamente el hueco). Auditoría `GRANT`/`REVOKE` completa sobre
  todas las funciones RPC del proyecto sigue pendiente como tarea aparte.

## Referencia para la fase 2 del incidente: `INSPECCIONES`/`CAP_*`

Este mismo patrón (política `anon` efectivamente sin restricción real)
existe también en `INSPECCIONES` (`FOR ALL`, condición siempre
verdadera) y en las 6 tablas `CAP_*` (`FOR ALL TO anon USING (true) WITH
CHECK (true)`, **sin ninguna restricción, ni siquiera de organización**)
— más severo en el mecanismo (lectura **y escritura y borrado**, no solo
lectura), aunque el contenido real expuesto hoy es mínimo (2 filas
esqueléticas en `INSPECCIONES`, 0 en las 6 `CAP_*` — ver el análisis de
impacto ya hecho). Migraciones de contención preparadas, sin aplicar:
`20260901150000_lock_anon_write_inspecciones_cap.sql` (mitigación
parcial) y `20260901150100_lock_anon_all_inspecciones_cap.sql`
(contención completa).

**Salvedad importante para quien implemente la fase 2 copiando este
patrón:** este ADR resuelve un caso de **solo lectura** — las 10
funciones nunca escriben. `INSPECCIONES`/`CAP_*` necesitan además un
camino de **escritura** real (`saveInspeccion()`, hoy vía
`fn_guardar_inspeccion_completa`, que deliberadamente NO es `SECURITY
DEFINER` porque corre con el rol del llamador sobre tablas que sí tenían
RLS `anon`-abierta a propósito). Cerrar esa escritura sin un reemplazo
`SECURITY DEFINER` equivalente (que valide y escriba con privilegios
elevados, no solo lea) rompe el guardado de inspecciones por completo —
no es una copia mecánica de este ADR, necesita su propio diseño.
