# Schema Live — Vertical Pecuaria

> **Split (2026-09-04):** ver [`docs/schema_live_core.md`](schema_live_core.md)
> para la nota de alcance completa. Este archivo cubre la vertical
> `PECUARIO_*` — ver [`docs/schema_live_agricola.md`](schema_live_agricola.md)
> para la vertical agrícola (`PADRON_PARCELAS`, `EUDR_*`, Inspecciones).

## Estado real: sin tablas propias todavía

**Confirmado por `grep` exhaustivo de "PECUARIO" contra todo el repositorio
(2026-09-04, tarea de reconocimiento de esta misma sesión):** no existe
ninguna tabla `PECUARIO_*` en el historial de migraciones ni en
`docs/schema_live.md` (el archivo original que este split reemplaza). Las
únicas apariciones reales del concepto "pecuario" en el repo hoy son:

- `docs/ESTADO_PROYECTO.md` (`docs/archive/ESTADO_HISTORICO.md` tras la
  rotación de 2026-09-04): decisión de negocio ya cerrada — "App de
  cuyes (Granja Valencia) será un tenant más dentro de RYZOS, usando el
  módulo `PECUARIO_*` ya definido — no un producto separado" y "App
  Granja Valencia (pecuario)" entre las 3 apps móviles confirmadas.
  **"Ya definido" se refiere a una decisión de alcance/negocio, no a un
  schema SQL que exista hoy** — no confundir una cosa con la otra.
- `specs/roadmap_padron_multiorganizacion.md` — menciona la vertical
  pecuaria como parte del roadmap más amplio, sin schema propio todavía.
- `public."PRODUCTOS".vertical` (ADR-028, ver
  `docs/schema_live_agricola.md`) — `CHECK IN ('AGRICOLA', 'PECUARIO')`
  ya incluye el valor `'PECUARIO'` en el constraint, **pero ninguna fila
  real usa ese valor hoy** (las 2 filas semilla, `CAFE`/`CACAO`, son
  ambas `AGRICOLA`) — el enum está preparado para el futuro, no en uso.
- `docs/adr/ADR-007-integridad-referencial-id-organizacion.md` y
  `supabase/migrations/20260821_225310_fk_id_organizacion_eudr.sql`
  mencionan "pecuario" solo de forma incidental (contexto de diseño
  multi-vertical), sin tabla asociada.

## Qué hace falta antes de que este archivo tenga contenido real

Cuando se diseñe el módulo pecuario real (tablas `PECUARIO_*`, políticas
RLS, funciones), seguir el mismo patrón `SDD` de `CLAUDE.md`
(`specs/<módulo>.md` → `plans/<módulo>_plan.md` → migración/código →
tests) y documentar el schema resultante acá — no inventar columnas ni
estructura en este archivo antes de que exista una migración real que
las respalde.
