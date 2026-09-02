# ADR-008 — Etiqueta `es_organizacion_prueba` y guardarail del E2E test

- **Estado:** Aceptado (todo aditivo — sin acción destructiva en esta tarea)
- **Fecha:** 2026-08-22
- **Migraciones:** `supabase/migrations/20260822_021532_es_organizacion_prueba.sql`
  (pendiente de aplicación manual en Supabase Studio, como toda migración
  de este repo)
- **Código:** `scripts/run_e2e_etl_test.py` (`ORG_ID`, `assert_org_is_test_marked`),
  `lib/safety/confirmarOperacionMasiva.js`
- **Regla de proceso:** Sección 5 de `docs/RYZOS_ORQUESTADOR_V3.1.md`
  ("Confirmación de Borrados/Actualizaciones Masivas")
- **Tests:** `tests/test_es_organizacion_prueba.mjs`, `tests/test_e2e_org_guardrail.py`

## Contexto: el incidente que motivó esto

ADR-007 documentó y resolvió 14 filas huérfanas (`"ORG-COOP-NORTE"`) en
`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, generadas por
corridas reales de `scripts/run_e2e_etl_test.py` contra la instancia
viva. El commit `2391859` ejecutó el `DELETE` de esas 14 filas **tras
confirmación explícita del usuario en el chat**, y en ese caso específico
el dato borrado sí era, en efecto, 100% sintético. Pero el proceso que
llevó a esa confirmación dependía enteramente de que alguien —en este
caso, un humano y un LLM colaborando— recordara auditar manualmente el
esquema completo antes de confirmar. No existía ninguna señal a nivel de
base de datos que distinguiera "esto es dato de prueba" de "esto es un
cliente real" — la única evidencia era la reconstrucción manual del
origen del `ID_Organizacion` hecha en ADR-007. Un futuro borrado masivo
sin esa misma auditoría previa (por prisa, por un prompt mal formulado,
por asumir que un `ID_Organizacion` desconocido es descartable) no tendría
ninguna barrera real que lo detuviera.

Esta tarea es puramente aditiva — no se borra ni modifica ningún dato
real existente. Se agrega la señal de esquema que faltaba, un guardarail
de código que la hace cumplir automáticamente, y un protocolo documentado
para cualquier operación destructiva futura.

## Decisión 1: columna `es_organizacion_prueba boolean NOT NULL DEFAULT false`

Agregada a `ORGANIZACIONES` vía `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
(idempotente). El `DEFAULT false` es la decisión central de este ADR:
**cualquier organización sin marcar explícitamente como de prueba se
trata como REAL** — el lado seguro del error. Las 2 filas reales
existentes (`"COOP-JS"`, `"COOP-ND"`) quedan en `false` automáticamente,
sin necesidad de tocarlas ni de una migración de datos separada.

## Decisión 2: fila real `'ORG-TEST-E2E'`, `es_organizacion_prueba = true`

La misma migración inserta (o actualiza, vía `ON CONFLICT ("ID") DO
UPDATE`) una fila explícita para el E2E test:
`Nombre_Organizacion = 'Organización de Prueba — NO ES CLIENTE REAL'`,
`es_organizacion_prueba = true`. Esto reemplaza el patrón de
`"ORG-COOP-NORTE"`: a partir de ahora, todo dato generado por
`scripts/run_e2e_etl_test.py` pertenece a una organización que SÍ existe
en `ORGANIZACIONES`, pero inequívocamente etiquetada como sintética —
tanto para un humano que la vea en Supabase Studio como para cualquier
consulta automatizada.

`RUC`/`Direccion_Fiscal`/`Representante_Legal` se rellenan con
placeholders explícitos ("N/A — organización sintética") en vez de
`NULL`: no se pudo confirmar si esas columnas son `NOT NULL` en la tabla
real (no tiene `CREATE TABLE` en el historial de migraciones de este
repo — ver `docs/schema_live.md`), así que se optó por el valor que
funciona sin importar la nulabilidad real.

## Decisión 3: guardarail en `scripts/run_e2e_etl_test.py`

`ORG_ID` cambia de `"ORG-COOP-NORTE"` a `"ORG-TEST-E2E"`. Antes de que
`run_e2e()` llame a `pipeline.process_package()` (el punto real de
escritura), y solo en modo real (`mock_supabase is None` — el modo
simulado no toca la base y no tiene `ORGANIZACIONES` que consultar), se
llama a `assert_org_is_test_marked(pipeline.supabase, ORG_ID)`: consulta
en vivo si `ORG_ID` tiene `es_organizacion_prueba = true`; si la fila no
existe o el flag es `false`, lanza `UnsafeOrgIdError` y el script aborta
sin escribir nada. Esto hace estructuralmente imposible que una corrida
real de este script escriba contra una organización no marcada como de
prueba — ya no depende de que `ORG_ID` esté "bien" por convención de
nombre, sino de un chequeo en vivo contra el esquema.

El teardown agregado en ADR-007 (`teardown_e2e_rows`, borra por
`id_monitoreo` dentro de un `finally`) no necesitó ningún cambio: nunca
dependió del valor de `ORG_ID`, solo de los ids que cada run insertó —
sigue funcionando igual con `"ORG-TEST-E2E"`.

## Decisión 4: `lib/safety/confirmarOperacionMasiva.js`

Utilidad compartida, server-side (usa `getSupabaseServerClient`, nunca
importable desde `'use client'`), que cualquier Server Action de
borrado/actualización masiva puede invocar antes de ejecutar: dado
`{ idOrganizacion, tabla }`, consulta `ORGANIZACIONES` y la tabla en
cuestión y retorna `{ nombre_organizacion, es_prueba,
conteo_filas_afectadas }`. No ejecuta ningún borrado/actualización por sí
misma — solo reporta el estado real para que la confirmación humana (o la
UI que la solicite) tenga los números correctos delante, en vez de
depender de que alguien los consulte a mano como pasó en el origen de
ADR-007.

## Decisión 5: protocolo documentado en `docs/RYZOS_ORQUESTADOR_V3.1.md`

Se agregó una regla nueva a la Sección 5 ("Reglas Inviolables de Código y
Seguridad") de `docs/RYZOS_ORQUESTADOR_V3.1.md`, no a `CLAUDE.md`: el
propio documento define en su Sección 2 que "cuando sea sobre qué reglas
debe seguir el trabajo nuevo, este documento manda" (mientras que
`CLAUDE.md` manda sobre "qué existe hoy" en el código). Una regla de
proceso sobre operaciones destructivas futuras es exactamente "qué reglas
debe seguir el trabajo nuevo", así que corresponde ahí. La regla exige
reportar conteo real + nombre real de la organización antes de cualquier
`DELETE`/`UPDATE` masivo contra datos de una organización con
`es_organizacion_prueba = false` (o sin fila en `ORGANIZACIONES`), y
esperar confirmación humana explícita citando esos números — sin importar
si la acción se dispara desde Claude Code CLI, un script, o directamente
en Supabase Studio.
