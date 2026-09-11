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

## Módulo Pecuario Cuyes MVP — v1 APLICADA y confirmada en vivo (2026-09-10)

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

**Estado real (actualizado 2026-09-11):** la migración
`supabase/migrations/20260910160000_pecuario_cuyes_core.sql` fue aplicada
manualmente por el usuario en Supabase Studio y **confirmada en vivo**
(las 7 tablas responden `200`, ya no `404 PGRST205`). Crea:

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

**Gap de v1, cerrado por v2 (ver abajo):** `PECUARIO_GALPONES` no se creaba
en v1 (solo se referenciaba por FK condicional desde
`PECUARIO_JAULAS.galpon_id`) — v2 la crea y agrega la FK real.

## Módulo Pecuario Cuyes — v2 (sanidad recurrente + insumos), APLICADA (2026-09-11)

**Hallazgo antes de aplicar (Claude Code CLI, 2026-09-11):** el prompt de
esta tarea afirmaba que la migración v2
(`supabase/migrations/20260911090000_pecuario_sanidad_insumos.sql`) "ya
estaba escrita" — **era falso**: el archivo no existía en el repo (ni en
el working tree, ni en el historial de git, ni en ningún stash),
confirmado antes de tocar nada. El usuario había aplicado la v2 real
manualmente en Supabase Studio (desde una sesión de Claude Cowork que
nunca llegó a commitear el archivo al repo) — confirmado en vivo con
`GET`/`404`→`200` en las 5 tablas nuevas entre una verificación y la
siguiente. `supabase/migrations/20260911090000_pecuario_sanidad_insumos.sql`
en el repo hoy es una **reconstrucción a posteriori**, escrita columna por
columna contra el esquema OpenAPI de PostgREST en vivo (no adivinada) —
ver el encabezado de ese archivo para el detalle completo de qué se pudo
confirmar por REST y qué no (nombres exactos de constraints/políticas, que
PostgREST no expone).

Tablas (columnas confirmadas en vivo, `jhtocgxlozfuzullrtol`):

- `PECUARIO_GALPONES` — `id` (uuid pk), `ID_Organizacion` (text NOT NULL,
  FK), `codigo_galpon` (varchar NOT NULL), `nombre` (varchar),
  `capacidad_pozas` (int), `dias_frecuencia_limpieza` (int, default 15),
  campos offline, `created_at`/`updated_at`. Cierra el gap de v1: ahora
  `PECUARIO_JAULAS.galpon_id` tiene FK real a esta tabla.
- `PECUARIO_CONTROL_SANITARIO` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `fecha` (date NOT NULL), `producto_usado`/`responsable` (varchar),
  `observaciones` (text), campos offline, `created_at`. Desinfección
  recurrente **a nivel de organización** (no de galpón/lote/individual —
  eso es `PECUARIO_TRATAMIENTOS`, v3).
- `PECUARIO_LIMPIEZA_GALPON` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `galpon_id` (uuid NOT NULL, FK a `PECUARIO_GALPONES`), `fecha` (date NOT
  NULL), `observaciones`, campos offline, `created_at`.
- `PECUARIO_INSUMOS` — `id`, `ID_Organizacion` (NOT NULL, FK), `nombre`
  (varchar NOT NULL), `categoria` (enum `categoria_insumo`:
  `alimento`/`sanitario`/`cama`/`equipo`/`otro`, default `otro`),
  `unidad_medida` (varchar NOT NULL, default `'unidad'`), `stock_minimo`
  (numeric), `activo` (boolean, default `true`), campos offline,
  `created_at`. **Sin columna de stock actual** — se deriva sumando
  `PECUARIO_INSUMOS_MOVIMIENTOS` (entrada − salida), no se denormaliza.
- `PECUARIO_INSUMOS_MOVIMIENTOS` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `insumo_id` (uuid NOT NULL, FK a `PECUARIO_INSUMOS`), `tipo_movimiento`
  (enum `tipo_movimiento_insumo`: `entrada`/`salida`), `cantidad` (numeric
  NOT NULL, CHECK > 0), `fecha` (date NOT NULL), `poza_id`/`lote_id`
  (uuid, opcionales), `observaciones`, campos offline, `created_at`. v3
  inserta acá automáticamente al registrar un tratamiento que consume un
  insumo (`fn_descontar_insumo_tratamiento`).

**RLS:** mismo patrón que v1 en las 5 tablas — `FOR ALL TO authenticated`,
scoped por `ID_Organizacion`, sin condición de rol. Confirmado en vivo que
`anon` no lee ninguna (`GET` con anon key → `200` con lista vacía en las 5).

## Módulo Pecuario Cuyes — v3 (identificación individual), APLICADA (2026-09-11)

`supabase/migrations/20260911140000_pecuario_identificacion_individual.sql`
— overlay opcional sobre el manejo poblacional (ver
`specs/pecuario_identificacion_individual.md` para el diseño completo,
incluido el análisis del app donante en AppSheet "CuyManager SaaS V1").
Confirmada en vivo, incluida la lógica de negocio (no solo columnas) —
`tests/test_pecuario_sanidad_identificacion.py`, 16/16 passing contra la
instancia real:

- `PECUARIO_REPRODUCTORES` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `codigo_arete` (varchar NOT NULL, UNIQUE junto con `ID_Organizacion`),
  `sexo` (enum `sexo_cuy`: `macho`/`hembra`, NOT NULL), `raza`,
  `fecha_nacimiento`, `madre_id`/`padre_id` (uuid, auto-referencia FK),
  `jaula_actual_id` (FK a `PECUARIO_JAULAS`), `proposito` (enum
  `proposito_animal`, default `reproductor`), `estado` (enum
  `estado_animal`, default `activo`), `fecha_salida`, `foto_url`, `notas`,
  campos offline, `created_at`/`updated_at`.
- `PECUARIO_HISTORIAL_MACHOS` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `macho_id` (FK a `PECUARIO_REPRODUCTORES`), `jaula_id` (FK a
  `PECUARIO_JAULAS`), `fecha_entrada` (date NOT NULL, default
  `CURRENT_DATE`), `fecha_salida` (nullable — `NULL` = todavía activo en
  esa jaula), campos offline, `created_at`. Trigger
  `fn_cerrar_historial_macho_anterior` (`AFTER INSERT`): al asignar un
  macho nuevo a una jaula, cierra automáticamente cualquier asignación
  anterior de esa misma jaula que siguiera abierta — **verificado en vivo**
  (`test_historial_macho_auto_closes_previous_open_record`).
- `PECUARIO_TRATAMIENTOS` — `id`, `ID_Organizacion` (NOT NULL, FK),
  `alcance` (enum `alcance_tratamiento`: `galpon`/`lote`/`individual`, NOT
  NULL), `galpon_id`/`lote_id`/`animal_id` (exactamente uno según
  `alcance`, `CHECK chk_tratamientos_alcance_target` — **verificado en
  vivo que rechaza un mismatch**), `fecha`, `tipo_tratamiento` (enum
  `tipo_tratamiento_sanitario`: `preventivo`/`curativo`/`vitaminas`),
  `diagnostico`, `insumo_id` (FK a `PECUARIO_INSUMOS`), `cantidad_dosis`,
  `costo_estimado`, campos offline, `created_at`. Trigger
  `fn_descontar_insumo_tratamiento` (`AFTER INSERT`): si trae
  `insumo_id`+`cantidad_dosis`, inserta un movimiento `salida` en
  `PECUARIO_INSUMOS_MOVIMIENTOS` — **verificado en vivo**
  (`test_tratamiento_descuenta_insumo_del_kardex`).

**Columnas nuevas en tablas de v1:** `PECUARIO_PARTOS.macho_id` (FK a
`PECUARIO_REPRODUCTORES`, complementa `macho_activo_codigo` de texto
libre), `PECUARIO_PARTOS.madre_id` (pasa de reservada sin FK a FK real),
`PECUARIO_MORTALIDAD.animal_id` (pasa de reservada a FK real + `CHECK
chk_mortalidad_individual_xor_poblacional`), `PECUARIO_VENTAS.animal_id`
(nueva, FK real + `CHECK chk_ventas_individual_xor_lote`). Los 2 `CHECK`
XOR están **verificados en vivo que rechazan** la combinación inválida
(`23514`) tanto "ambos llenos" como "ninguno lleno".

**Triggers de baja automática — versión corregida del bug real detectado
en el app donante** (ese bot dejaba `estado="Vendido"` en cualquier
muerte, por 2 acciones encadenadas e invertidas): `fn_dar_baja_animal_por_mortalidad`
marca `estado='muerto'` (verificado en vivo, no 'vendido'),
`fn_dar_baja_animal_por_venta` marca `estado='vendido'` — ambos limpian
`jaula_actual_id` y fijan `fecha_salida` a la fecha del evento.

**Consanguinidad:** `fn_son_parientes(animal_a, animal_b, generaciones
default 3)`, `WITH RECURSIVE` sobre `madre_id`/`padre_id` — validación en
la app antes de asignar un macho, no `CHECK` bloqueante en la base (no
rompe la escritura offline). No cubierta por el test suite automatizado
todavía (requiere armar un árbol genealógico de varias generaciones).

**RLS:** mismo patrón que v1/v2 en las 3 tablas nuevas. Aislamiento
cross-organización **verificado en vivo**
(`test_reproductores_cross_org_read_isolation`): una sesión real de
`ORG-TEST-DEMO` no puede leer una fila de `PECUARIO_REPRODUCTORES`
sembrada en `COOP-AROMAS-VALLE`.

## Módulo Pecuario Cuyes — v4 (venta por animal + taxonomía de insumos), APLICADA (2026-09-11 noche)

`supabase/migrations/20260911180000_pecuario_ventas_insumos_ajustes.sql`
— ajustes de campo tras revisar el mockup contra la app AppSheet original.
Confirmado en vivo (`jhtocgxlozfuzullrtol`):

- `PECUARIO_VENTAS.precio_unitario` — `numeric(10,2)`, nullable. Trigger
  `fn_calcular_precio_total_venta` (`BEFORE INSERT OR UPDATE`): si
  `precio_unitario` viene informado, recalcula `precio_total = ROUND(cantidad
  * precio_unitario, 2)` **sin importar qué `precio_total` haya mandado el
  cliente** — verificado enviando un `precio_total` deliberadamente
  incorrecto junto con `precio_unitario` y confirmando que el valor
  persistido es el recalculado. Si `precio_unitario` es `NULL`,
  `precio_total` se respeta tal cual se envía (venta de lote con precio
  pactado directo). `peso_total_kg` se conserva sin cambios, pasa a ser
  dato referencial.
- `categoria_insumo` (enum, `ALTER TYPE`) — ahora `alimento`, `sanitario`,
  `material` (renombrado desde `cama` — `cama` **ya no es un valor
  válido**, un `INSERT` con `categoria='cama'` falla), `equipo`, `otro`,
  `medicamento`, `vitamina` (2 nuevos). `sanitario` se conserva aparte de
  `medicamento` (desinfectantes de instalaciones vs. fármacos
  administrados al animal).
- `PECUARIO_INSUMOS.unidad_medida` — pasa de `varchar` (texto libre) al
  enum nuevo `unidad_medida_insumo`: `kg`, `g`, `litro`, `ml`, `unidad`,
  `saco_50kg`, `saco_40kg`. Backfill de filas existentes vía `CASE`
  (mapea variantes comunes — "Kg"/"kilogramos"/etc. — antes de convertir
  el tipo de columna; cualquier valor no mapeado cae a `'unidad'` por
  default).
- `vw_pecuario_insumos_stock` — vista (no tabla), columnas `insumo_id`,
  `ID_Organizacion`, `nombre`, `categoria`, `unidad_medida`,
  `stock_minimo`, `stock_actual` (calculado: `SUM(entrada) - SUM(salida)`
  de `PECUARIO_INSUMOS_MOVIMIENTOS`). Existe desde la v2 real (no desde
  v4) — v4 la recrea (`DROP`/`CREATE OR REPLACE`) porque Postgres no deja
  cambiar el tipo de una columna de la que depende una vista. **La
  reconstrucción de v2 en este repo no la incluía originalmente — se
  corrigió en la misma tarea de v4** (ver `docs/ESTADO_PROYECTO.md`).
  RLS: la vista respeta `auth_org_id()` en su propio `WHERE`, con `GRANT
  SELECT TO authenticated`.

**Sin código cliente todavía:** confirmado por grep exhaustivo que
`lib/actions/`, `app/dashboard/` y `components/` no tienen ningún archivo
que referencie `PECUARIO_VENTAS`/`PECUARIO_INSUMOS` — la app móvil de
Granja Valencia (Expo/React Native) no está scaffoldeada en este repo
todavía. `lib/validations/pecuario.ts` es el único contrato de datos que
existe hoy para este módulo.
