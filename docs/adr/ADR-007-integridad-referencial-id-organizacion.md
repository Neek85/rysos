# ADR-007 — Integridad referencial de `ID_Organizacion`

- **Estado:** Aceptado (FK) / Pendiente de confirmación (limpieza de datos)
- **Fecha:** 2026-08-21
- **Migraciones:** `supabase/migrations/20260821_225310_fk_id_organizacion_eudr.sql`
  (pendiente de aplicación manual en Supabase Studio, como toda migración
  de este repo)
- **Spec:** este ADR (tarea de auditoría directa, sin spec/plan
  independientes)
- **Tests:** `tests/test_fk_id_organizacion.mjs`, `tests/test_e2e_teardown.py`

## Contexto

Una tarea anterior (investigación pura, sin cambios) encontró que
`"ORG-COOP-NORTE"` — el `ID_Organizacion` usado en 14 filas reales de
`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` — no corresponde a
ninguna fila real de `ORGANIZACIONES` (solo existen `"COOP-JS"` y
`"COOP-ND"`), y que ninguna de las 5 tablas auditadas en ese momento tenía
FK hacia `ORGANIZACIONES`. Esta tarea amplía esa auditoría a **todo** el
esquema y decide qué hacer al respecto.

## Auditoría completa

Confirmado en vivo (Service Role Key — `anon` no tiene `SELECT` en
`ORGANIZACIONES`) cuáles tablas existen y cuáles tienen columna
`ID_Organizacion` propia:

| Tabla | ¿Existe en la instancia real? | ¿Tiene `ID_Organizacion`? | Huérfanos |
|---|---|---|---|
| `EUDR_MONITOREO` | Sí | Sí | **`"ORG-COOP-NORTE"` × 6** |
| `EUDR_USO_SUELO` | Sí | Sí | **`"ORG-COOP-NORTE"` × 4** |
| `EUDR_INSTALACIONES` | Sí | Sí | **`"ORG-COOP-NORTE"` × 4** |
| `PADRON_SOCIOS` | Sí | Sí | Ninguno |
| `PADRON_PARCELAS` | Sí | Sí | Ninguno |
| `INSPECCIONES` | Sí | Sí | Ninguno (2 filas, ambas `"COOP-JS"`) |
| `CAP_DATOS_SOCIO`/`CAP_MIC`/`CAP_CONSERVACION`/`CAP_BIENESTAR`/`CAP_RIESGOS`/`CAP_GESTION` | Sí | **No tienen columna `ID_Organizacion` propia** (error `42703` al consultarla — son hijas de `INSPECCIONES`, heredan el aislamiento vía esa relación, no duplican la columna) | N/A |
| `PECUARIO_GALPONES`/`PECUARIO_JAULAS`/`PECUARIO_LOTES`/`PECUARIO_PESAJE_ALIMENTACION` | **No** (HTTP 404 — todavía no creadas, roadmap de Granja Valencia sin construir) | N/A | N/A |
| `SYNC_QUEUE` | **No** (HTTP 404) | N/A | N/A |
| `PRECIOS_PRODUCTO` | **No** (HTTP 404) | N/A | N/A |

**Conclusión: `"ORG-COOP-NORTE"` es el único huérfano en todo el esquema
real hoy.** Ninguna otra tabla, ningún otro `ID_Organizacion` de origen
desconocido.

## Origen confirmado de `"ORG-COOP-NORTE"`

`scripts/run_e2e_etl_test.py:17` — `ORG_ID = "ORG-COOP-NORTE"`, un script
de prueba end-to-end real (no un fixture de test unitario) que corre el
pipeline real (`scripts/etl_drive_to_supabase.py`) contra la instancia
viva (ver `docs/prompts/prompt_e2e_etl_test.md`). Las 6 filas de
`EUDR_MONITOREO` corresponden a corridas repetidas de este script
(confirmado: el script no tenía ningún teardown, cada corrida real dejaba
una fila nueva permanente). Las 8 filas restantes (`EUDR_USO_SUELO`/
`EUDR_INSTALACIONES`) **no vienen de este script específico** — su
`build_e2e_package()` solo genera una capa `EUDR_MONITOREO` — sino,
casi con certeza, de una corrida manual/ad-hoc de
`scripts/etl_drive_to_supabase.py` directamente contra una carpeta
`RYZOS_CLIENTES/ORG-COOP-NORTE/` con un GeoPackage multi-capa real (el
pipeline real sí soporta las 3 capas — `USO_SUELO_TABLE`/
`INSTALACIONES_TABLE` en `etl_drive_to_supabase.py`), no reflejada como un
script versionado en este repo. No cambia la conclusión: en ambos casos
es dato de prueba/desarrollo con el mismo `ORG_ID` de placeholder, nunca
datos de producción ni de otro origen desconocido.

## Decisión: FK `NOT VALID` en las 3 tablas EUDR_*, nada en PADRON_*

- **`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`:** se agrega
  `FOREIGN KEY ("ID_Organizacion") REFERENCES "ORGANIZACIONES"("ID") NOT
  VALID`. `NOT VALID` porque las 14 filas huérfanas existen AHORA MISMO —
  una FK totalmente validada de entrada fallaría al aplicar la migración.
  `NOT VALID` deja el constraint activo para cualquier INSERT/UPDATE
  nuevo desde el momento en que se aplica (nunca más va a crecer este
  tipo de huérfano), sin validar retroactivamente las 14 filas existentes
  ni bloquear la tabla con un escaneo completo. `VALIDATE CONSTRAINT`
  (que si exige cero huérfanos) queda como paso separado, condicionado a
  que se confirme y ejecute la limpieza de esas 14 filas — explícitamente
  NO incluido en esta migración.
- **`PADRON_SOCIOS`/`PADRON_PARCELAS` deliberadamente SIN FK**, pese a
  tener 0 huérfanos hoy (lo que técnicamente permitiría una FK
  completamente validada sin fricción). Motivo real, no solo
  consistencia: `CLAUDE.md` documenta que el padrón es "compartido en
  vivo con otro repositorio" — una FK ahí (incluso `NOT VALID`, que igual
  empieza a exigir el constraint para filas NUEVAS desde el momento en
  que se crea) empezaría a RECHAZAR inserts nuevos de ESE OTRO
  repositorio si alguna vez escribe un `ID_Organizacion` que todavía no
  existe en `ORGANIZACIONES` de este lado (ej. un onboarding de
  organización nueva que arranca por el otro sistema antes que por este).
  Es un riesgo real de coordinación cross-repositorio, no una decisión
  que corresponda tomar unilateralmente desde acá sin involucrar a quien
  mantiene el otro repo.

## Limpieza de las 14 filas huérfanas — PENDIENTE de confirmación explícita

Esta tarea fue instruida explícitamente a NO borrar nada sin confirmación
directa del usuario en el chat (`[SOLO SI USUARIO CONFIRMÓ EL BORRADO]`).
La auditoría de arriba deja el terreno confirmado y seguro para hacerlo
(único huérfano, origen de test conocido, sin impacto en datos reales) —
pero el `DELETE` en sí no se ejecutó en esta tarea. Queda pendiente de que
el usuario lo confirme directamente.

## Fix del teardown en `scripts/run_e2e_etl_test.py`

`run_e2e()` ahora envuelve el flujo real en `try`/`finally`: el `finally`
llama `teardown_e2e_rows(pipeline, inserted_ids)`, que borra por
`id_monitoreo` (nunca un `DELETE` sin acotar por `ID_Organizacion`, que
borraría corridas ajenas o cualquier fila real que coincidiera por
casualidad con el mismo código) — corre tanto si el test pasa como si
una verificación intermedia (`verify_archive_criterion`/
`verify_photo_criterion`) lanza `AssertionError` a mitad de camino. Se
salta en modo simulado (`mock_supabase` provisto — no hay nada real que
borrar) y con `cleanup=False` (depuración manual explícita). Esto
resuelve la causa raíz de las 6 filas de `EUDR_MONITOREO` — corridas
futuras de este script ya no van a dejar basura permanente.
