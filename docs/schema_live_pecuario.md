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

## Módulo Pecuario Cuyes MVP — migración lista, NO aplicada todavía (2026-09-10)

**Re-confirmado en vivo (2026-09-10, Claude Code CLI) exactamente lo que
esta sección ya decía desde el 2026-09-04:** ninguna tabla `PECUARIO_*`
existe en producción. Esta vez el prompt de origen (diseño de Gemini,
revisado por Claude Cowork) afirmaba explícitamente lo contrario —
"`PECUARIO_GALPONES`, `PECUARIO_JAULAS`, `PECUARIO_LOTES` y
`PECUARIO_PESAJE_ALIMENTACION` ya existen en producción (Granja Valencia ya
opera como tenant activo)" — verificado como **falso** por 3 vías
independientes (esquema OpenAPI de PostgREST, `GET` directo por tabla vía
REST → `404 PGRST205`, y `ORGANIZACIONES` sin ninguna fila "Granja
Valencia" — solo `COOP-AROMAS-VALLE`/`ORG-TEST-DEMO` existen). Ver
`specs/pecuario_cuyes_mvp.md` sección "Verificación pendiente" para el
detalle completo.

**Estado real:** la migración
`supabase/migrations/20260910160000_pecuario_cuyes_core.sql` existe en el
repo, lista para aplicarse, pero **no se aplicó contra la instancia real**
(aplicarla en Supabase Studio es un paso manual del usuario, fuera del
alcance de cualquier sesión de este agente). Cuando se aplique, creará
desde cero:

- `PECUARIO_CONFIGURACION` — `id` (uuid pk), `ID_Organizacion` (text, FK a
  `ORGANIZACIONES."ID"`, UNIQUE), `dias_lactancia_destete` (int, default
  14), `max_partos_madre` (int, default 4), `min_promedio_crias_vivas`
  (numeric(3,1), default 2.0), `created_at`/`updated_at`.
- `PECUARIO_JAULAS` — `id` (uuid pk), `ID_Organizacion` (text, FK),
  `galpon_id` (uuid, **sin FK real** — ver gap abajo), `codigo_poza`
  (varchar(50), UNIQUE junto con `ID_Organizacion`), `tipo_uso`
  (enum `tipo_uso_poza`), `capacidad_max`/`n_hembras_activas` (int),
  `macho_codigo` (varchar(50)), `linea_genetica` (varchar(50)), `estado`
  (varchar(20)), `device_id`/`created_offline_at`/`synced_at` (offline-ready),
  `created_at`/`updated_at`.
- `PECUARIO_PARTOS` — `id` (uuid pk), `ID_Organizacion` (text NOT NULL, FK),
  `poza_id` (uuid NOT NULL, FK a `PECUARIO_JAULAS`), `fecha_parto` (date NOT
  NULL), `n_vivos`/`n_muertos` (int NOT NULL, CHECK >= 0),
  `peso_total_camada_g` (int), `macho_activo_codigo` (varchar(50)),
  `madre_id` (uuid, **reservado sin FK** — futura genealogía individual),
  `observaciones` (text), campos offline, `created_at`.
- `PECUARIO_LOTES` — `id` (uuid pk), `ID_Organizacion` (text, FK),
  `codigo_lote` (varchar(50), UNIQUE junto con `ID_Organizacion`),
  `poza_actual_id`/`poza_origen_id` (uuid, FK a `PECUARIO_JAULAS`),
  `parto_origen_id` (uuid, FK a `PECUARIO_PARTOS` — trazabilidad hasta la
  camada de origen), `fecha_destete` (date NOT NULL), `cantidad_inicial`
  (int, CHECK > 0), `cantidad_actual` (int, CHECK >= 0), `sexo`
  (varchar(10)), `etapa` (enum `etapa_productiva`), `estado` (varchar(20)),
  campos offline, `created_at`/`updated_at`.
- `PECUARIO_PESAJES` — `id` (uuid pk), `ID_Organizacion` (text NOT NULL,
  FK), `lote_id` (uuid, FK a `PECUARIO_LOTES`), `poza_id` (uuid),
  `fecha_pesaje` (date NOT NULL), `animales_muestreados` (int NOT NULL,
  CHECK > 0), `peso_total_muestra_g` (numeric(10,2) NOT NULL, CHECK > 0),
  `peso_promedio_g` (numeric(8,2), **generated column**:
  `peso_total_muestra_g / NULLIF(animales_muestreados, 0)`),
  `ganancia_diaria_estimada_g` (numeric(6,2)), campos offline, `created_at`.
  Tabla independiente de `PECUARIO_PESAJE_ALIMENTACION` porque esta última
  no existe — no hay nada con qué fusionarla.
- `PECUARIO_MORTALIDAD` — `id` (uuid pk), `ID_Organizacion` (text NOT NULL,
  FK), `poza_id`/`lote_id` (uuid, FK a `PECUARIO_LOTES` el segundo),
  `animal_id` (uuid, reservado sin FK), `fecha_evento` (date NOT NULL),
  `cantidad` (int NOT NULL, CHECK > 0), `etapa` (enum `etapa_productiva`
  NOT NULL), `causa` (enum `causa_mortalidad`), `descripcion_sintomas`
  (text), campos offline, `created_at`.
- `PECUARIO_VENTAS` — `id` (uuid pk), `ID_Organizacion` (text NOT NULL, FK),
  `lote_id` (uuid, FK a `PECUARIO_LOTES`), `poza_id` (uuid), `fecha_venta`
  (date NOT NULL), `tipo_salida` (enum `tipo_venta_cuy`), `cantidad` (int
  NOT NULL, CHECK > 0), `peso_total_kg` (numeric(8,2)), `precio_total`
  (numeric(10,2) NOT NULL, CHECK >= 0), `comprador_nombre` (varchar(150),
  **PII de un tercero** — nunca en logs/trazabilidad pública), campos
  offline, `created_at`.

**RLS:** las 7 tablas tienen `ENABLE ROW LEVEL SECURITY` + una política
`FOR ALL TO authenticated USING/WITH CHECK ("ID_Organizacion" =
public.auth_org_id() OR auth.role() = 'service_role' OR current_user =
'postgres')` — igual que el resto del proyecto, pero **sin condición de
rol** (a diferencia de `PADRON_SOCIOS`/`INSPECCIONES`): cualquier usuario
interno autenticado de la organización puede escribir, por diseño (app de
campo de un solo tipo de usuario).

**Trigger:** `fn_crear_tarea_destete()` (`AFTER INSERT` en
`PECUARIO_PARTOS`) intenta crear una tarea en `TAREAS` a
`fecha_parto + dias_lactancia_destete` días. **No hace nada** hasta que
`TAREAS` exista (verifica `to_regclass()`, emite `RAISE WARNING`, no rompe
el `INSERT` del parto).

**Gap real conocido, no resuelto por esta migración:** `PECUARIO_GALPONES`
nunca se crea acá (solo se referencia por FK condicional desde
`PECUARIO_JAULAS.galpon_id`) — no hay diseño real de sus columnas todavía.
Requiere su propia spec antes de agregarse.
