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

## Módulo Pecuario Cuyes — v5 (etapa automática 8 semanas + Compras/gastos), APLICADA (2026-09-22/23)

### `vw_pecuario_lotes_etapa` — APLICADA y confirmada en vivo (10/10 tests)

`supabase/migrations/20260922100000_pecuario_vista_etapa_automatica.sql`
— ver `specs/pecuario_etapa_automatica_8_semanas.md`. Vista de solo
lectura sobre `PECUARIO_LOTES` (`SELECT l.*`), agrega dos columnas
calculadas:

- `etapa_calculada` (enum `etapa_productiva`) — `'engorde'` cuando
  `etapa='recria' AND estado='activo' AND (CURRENT_DATE - fecha_destete) >= 56`;
  en cualquier otro caso, igual a `etapa` (no pisa `'reproductor'` fijado
  a mano, ni recalcula un lote no activo).
- `dias_para_engorde` (integer) — cuenta regresiva cuando el lote está en
  recría activa antes del corte; `NULL` en cualquier otro caso.

No muta `PECUARIO_LOTES.etapa` — esa columna sigue existiendo tal cual,
editable a mano. RLS: filtro de organización escrito a mano en el `WHERE`
(`auth_org_id()` — la vista no hereda RLS de la tabla base, ADR-001),
`GRANT SELECT TO authenticated`.

**Verificado en vivo** (`tests/test_pecuario_etapa_automatica.py`, 10/10):
los 4 casos de la spec §7 (recría a 40 días → `dias_para_engorde=16`;
exactamente a 56 días → `'engorde'`; reproductor fijado a mano a 90 días
→ no se pisa; lote no activo a 90 días → no se recalcula) y aislamiento
RLS cruzado (una sesión de `ORG-TEST-DEMO` no ve, vía la vista, ningún
lote sembrado en `COOP-AROMAS-VALLE`).

### `PECUARIO_COMPRAS` — APLICADA y confirmada en vivo (14/14 tests, incluido el fix de `flete`)

`supabase/migrations/20260922110000_pecuario_compras_gastos.sql` — ver
`specs/pecuario_compras_gastos.md`. Tabla nueva con dos ramas mutuamente
excluyentes según `concepto` (enum `concepto_compra`:
`insumo`/`servicio_otro`), reforzadas por
`CHECK chk_compras_rama_por_concepto`:

- `id`, `ID_Organizacion` (NOT NULL, FK a `ORGANIZACIONES."ID"`), `fecha`
  (date, default `CURRENT_DATE`), `proveedor` (opcional).
- Rama `servicio_otro`: `categoria_gasto` (enum
  `categoria_gasto_compra`: `combustible`/`mantenimiento_reparaciones`/
  `servicio_veterinario_tecnico`/`mano_obra`/`otro`), `descripcion`,
  `monto_servicio`.
- Rama `insumo`: `insumo_id` (FK a `PECUARIO_INSUMOS.id`), `cantidad`,
  `galpon_id` (FK a `PECUARIO_GALPONES.id`), `costo_insumo`, `flete`
  (opcional).
- `monto_total` — `NUMERIC(10,2) GENERATED ALWAYS AS (...) STORED`:
  `costo_insumo + flete` para `insumo`, `monto_servicio` para
  `servicio_otro`. Nunca se escribe a mano.
- Trigger `fn_compra_genera_entrada_insumo` (`AFTER INSERT`, `SECURITY
  DEFINER`): cuando `concepto='insumo'`, inserta el movimiento `entrada`
  correspondiente en `PECUARIO_INSUMOS_MOVIMIENTOS` (mismo patrón que
  `fn_descontar_insumo_tratamiento`, v3). **Gap de granularidad
  documentado a propósito:** el movimiento generado queda con
  `poza_id`/`lote_id` en `NULL` — `PECUARIO_INSUMOS_MOVIMIENTOS` no tiene
  columna de galpón.
- RLS: mismo patrón `FOR ALL TO authenticated`, scoped por
  `ID_Organizacion` (`auth_org_id()`).

**Bug descubierto en vivo (2026-09-23), corregido y aplicado:** la
columna `flete` quedó con `DEFAULT 0` sin condicionarlo a la rama —
cualquier `INSERT` de `concepto='servicio_otro'` que omitiera la clave
`flete` (el comportamiento normal de un cliente que solo llena los campos
de su rama, incluido `CompraSchema` vía Zod) recibía `flete=0` por el
default de la columna, no `NULL`, violando
`chk_compras_rama_por_concepto` (que exige `flete IS NULL` en esa rama) —
confirmado en vivo con `23514` sobre un INSERT por lo demás válido.
`supabase/migrations/20260922120000_fix_pecuario_compras_flete_default.sql`
(`ALTER COLUMN flete DROP DEFAULT`) redactado por Claude Code CLI —
**a diferencia de la migración original, esta NO tenía el gate de
segunda revisión (§4.1.2) cubierto automáticamente** (no fue redactada
por Claude Cowork desde el principio) — revisada y aprobada por Cowork,
aplicada por Neyser en Studio el 2026-09-23. Confirmado en vivo contra el
esquema OpenAPI de PostgREST: la columna `flete` ya no tiene ningún
`default`.
**Ajuste relacionado encontrado por Cowork en la misma revisión:**
`CompraSchema.flete` en `lib/validations/pecuario.ts` ya estaba
`z.number().nonnegative().optional().nullable()` (sin `.default(0)`) —
lo que sí quedó desactualizado fue el comentario al lado del campo ("la
base lo defaultea a 0"), escrito antes del fix y ya falso después de
aplicarlo. Corregido para reflejar el estado real.

**Verificado en vivo** (`tests/test_pecuario_compras_gastos.py`, **14/14**):
compra de insumo calcula `monto_total = costo_insumo + flete` y genera el
movimiento de entrada correspondiente; `servicio_otro` no genera ningún
movimiento; `INSERT` mezclando campos de ambas ramas rechazado por el
`CHECK` (`23514`); aislamiento RLS cruzado de lectura y de escritura (una
sesión de `ORG-TEST-DEMO` no ve ni puede insertar una compra con
`ID_Organizacion` de `COOP-AROMAS-VALLE`, `WITH CHECK` rechaza); escritura
autenticada en la propia organización.

## Módulo Pecuario Cuyes — v6 (venta de cuy pelado/beneficiado), APLICADA (2026-09-23)

`supabase/migrations/20260923090000a_pecuario_venta_pelado_enum.sql` +
`20260923090000b_pecuario_venta_pelado_beneficiado.sql` — ver
`specs/pecuario_venta_pelado_beneficiado.md` §6.5. **Partida en 2
archivos/2 Runs de Studio** (corrección de la propia Cowork sobre su
redacción original de un solo archivo): Postgres no permite usar/comparar
un valor de enum recién agregado con `ADD VALUE` dentro de la misma
transacción en que se agregó — la redacción original agregaba
`'pelado_beneficiado'` a `tipo_venta_cuy` Y lo comparaba en el mismo
archivo (dentro de `chk_ventas_base_precio_coherente`), lo que Studio
ejecuta como una transacción implícita al pegar todo el texto en un
Run, así que fallaba con `unsafe use of new value of enum type`.

- **Parte A** (solo, aplicada primero, confirmada antes de la parte B):
  `ALTER TYPE tipo_venta_cuy ADD VALUE IF NOT EXISTS 'pelado_beneficiado'`.
  Confirmado en vivo: `tipo_venta_cuy` tiene 5 valores —
  `carne`/`pie_cria`/`reproductor_saca`/`guano`/`pelado_beneficiado`.
- **Parte B** (exige en su propio preflight que la parte A ya corrió):
  agrega a `PECUARIO_VENTAS` — `base_precio` (enum nuevo
  `base_precio_venta`: `por_animal` default | `por_kg`), `precio_kg`
  (numeric, nullable), `peso_vivo_pre_beneficio_kg` (numeric, nullable,
  Ronda 46 2026-09-22 — captura puntual para Rendimiento de carcasa, no
  bloqueante), `rendimiento_carcasa_pct` (numeric, `GENERATED ALWAYS AS
  (peso_total_kg / peso_vivo_pre_beneficio_kg * 100) STORED`, `NULL`
  cuando falta cualquiera de los dos datos). `CHECK
  chk_ventas_base_precio_coherente`: `por_animal` exige `precio_kg IS
  NULL`; `por_kg` exige `tipo_salida='pelado_beneficiado'` y
  `peso_total_kg`/`precio_kg` presentes. `fn_calcular_precio_total_venta`
  (v4) extendida (no reemplazada): rama nueva
  `peso_total_kg * precio_kg` evaluada primero cuando `base_precio='por_kg'`,
  cae al comportamiento existente (`cantidad * precio_unitario`) en
  cualquier otro caso — ninguna venta por animal ya cargada cambia de
  resultado. No toca `fn_dar_baja_animal_por_venta` (v3).

**`VentaRegistroSchema` en `lib/validations/pecuario.ts`** (ruta real —
`lib/validators/` sigue sin existir en este repo) extendido con
`tipo_salida='pelado_beneficiado'` + los 3 campos nuevos y 3 `.refine()`
que replican `chk_ventas_base_precio_coherente` exactamente — el tercero
(`por_animal` exige `precio_kg` `null`) no estaba en la redacción
original de Cowork, se agregó al verificar contra el `CHECK` real.

**Verificado en vivo** (`tests/test_pecuario_venta_pelado_beneficiado.py`,
**19/19**): venta pelado por kg (peso 9, peso vivo 15, precio_kg 22) →
`precio_total=198.00`, `rendimiento_carcasa_pct=60.0`; venta carne por
animal (cantidad 12, precio_unitario 18) → `precio_total=216.00`, sin
regresión respecto a v4; `base_precio='por_kg'` con
`tipo_salida≠'pelado_beneficiado'` rechazado por el `CHECK`; `por_kg` sin
`precio_kg` o sin `peso_total_kg` rechazado por el mismo `CHECK`;
aislamiento RLS cruzado revalidado con las columnas nuevas (una sesión de
`ORG-TEST-DEMO` no ve, con `base_precio`/`precio_kg` de por medio, ninguna
venta sembrada en `COOP-AROMAS-VALLE`).

## Módulo Pecuario Cuyes — v7 (venta de subproductos/Guano, tabla propia), APLICADA (2026-09-23)

`supabase/migrations/20260923110000_pecuario_venta_subproductos_guano.sql`
(`specs/pecuario_venta_subproductos_guano.md` referenciada por 3
archivos de esta sesión, pero **nunca existió en este repo** —
confirmado por `git log --all`; la migración trae suficiente contexto en
su propia cabecera). **Decisión de arquitectura:** tabla nueva
`PECUARIO_VENTAS_SUBPRODUCTOS`, no una columna sobre `PECUARIO_VENTAS` —
mismo criterio ya validado en `PECUARIO_COMPRAS` (el guano no es venta de
animal).

- `PECUARIO_VENTAS_SUBPRODUCTOS` — `id`, `ID_Organizacion` (NOT NULL, FK
  a `ORGANIZACIONES."ID"`), `fecha` (date, default `CURRENT_DATE`),
  `producto` (enum nuevo `tipo_subproducto_pecuario`: solo `'guano'` por
  ahora, deja espacio a futuros subproductos sin tocar el flujo de
  animales), `cantidad` (numeric, `CHECK > 0`), `unidad` (enum nuevo
  `unidad_venta_subproducto`: `sacos`/`kg`), `precio_total` (numeric,
  nullable — opcional pero recomendado, a diferencia del `NOT NULL` de
  `PECUARIO_VENTAS`, `CHECK >= 0` cuando no es `NULL`), `galpon_id` (FK a
  `PECUARIO_GALPONES.id`, solo informativo — el guano acumulado no es
  atribuible a una poza/lote específico), `comprador_nombre` (PII, nunca
  a consola/log). **Sin `animal_id`/`lote_id`** — no es una venta de
  animal, no dispara `fn_dar_baja_animal_por_venta()`. **Sin trigger** —
  `precio_total` no se recalcula (se acuerda como un solo número por el
  lote de venta completo). RLS: mismo patrón `FOR ALL TO authenticated`
  scoped por `ID_Organizacion`.
- **`tipo_venta_cuy` conserva `'guano'` como valor vestigial** — Postgres
  no permite eliminar valores de enum. Esta migración no lo reintroduce
  en ningún lado (`PECUARIO_VENTAS_SUBPRODUCTOS` usa su propio enum). No
  se agregó un `CHECK` que bloquee `tipo_salida='guano'` en
  `PECUARIO_VENTAS` — decisión deliberada (spec §2.2 del 2026-09-13 ya lo
  había retirado del formulario; agregar un `CHECK` nuevo sin verificar
  primero datos históricos podría romper filas reales). **Verificado
  antes de retirar `'guano'` de `VentaRegistroSchema` (contrato Zod):**
  `SELECT count(*) FROM PECUARIO_VENTAS WHERE tipo_salida='guano'` → **0
  filas** — confirma que no hay datos históricos reales bajo ese valor,
  seguro retirarlo del contrato Zod hacia adelante.
  `VentaRegistroSchema.tipo_salida` en `lib/validations/pecuario.ts`
  (ruta real) corregido: pasa de
  `['carne', 'pie_cria', 'reproductor_saca', 'guano', 'pelado_beneficiado']`
  a `['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado']`.

**Contrato Zod:** `VentaSubproductoSchema` nuevo en
`lib/validations/pecuario.ts`, deliberadamente sin ningún campo de
`VentaRegistroSchema` que no aplique a un subproducto
(`animal_id`/`lote_id`/`precio_unitario`/`base_precio`/etc.).

**Verificado en vivo** (`tests/test_pecuario_venta_subproductos_guano.py`,
**17/17**): inserción válida con defaults (`producto='guano'`);
`cantidad=0` y `precio_total` negativo rechazados por sus `CHECK`
respectivos; aislamiento RLS cruzado de lectura y de escritura (una
sesión de `ORG-TEST-DEMO` no ve ni puede insertar una venta de
subproducto con `ID_Organizacion` de `COOP-AROMAS-VALLE`); 0 filas
históricas con `tipo_salida='guano'` en `PECUARIO_VENTAS` confirmado
también como test automatizado.

## Módulo Pecuario Cuyes — v8 (evidencia fotográfica en Mortalidad), APLICADA (2026-09-23)

`supabase/migrations/20260923120000_pecuario_mortalidad_evidencia_fotografica.sql`
(`specs/pecuario_mortalidad_evidencia_fotografica.md` referenciada, pero
nunca existió en este repo — mismo hallazgo que en Guano). **Decisión de
arquitectura:** tabla `PECUARIO_MORTALIDAD_FOTOS` (una fila por foto), no
un array de URLs sobre `PECUARIO_MORTALIDAD` — sin tope de cantidad por
registro todavía (spec §5, pendiente de confirmar con Neyser/técnicos).

- `PECUARIO_MORTALIDAD_FOTOS` — columnas reales confirmadas en vivo
  (`information_schema.columns` vía `supabase db query --linked`, no
  solo el esquema OpenAPI de PostgREST):

  | columna | tipo | nullable | default |
  |---|---|---|---|
  | `id` | uuid | NO | `gen_random_uuid()` |
  | `ID_Organizacion` | text | NO | — (FK → `ORGANIZACIONES."ID"`) |
  | `mortalidad_id` | uuid | NO | — (FK → `PECUARIO_MORTALIDAD.id`, `ON DELETE CASCADE`) |
  | `storage_path` | text | NO | — (`UNIQUE`, `{ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}`) |
  | `device_id` | character varying | YES | — |
  | `created_offline_at` | timestamptz | YES | — |
  | `synced_at` | timestamptz | YES | `now()` |
  | `created_at` | timestamptz | YES | `now()` |

  RLS: mismo patrón `FOR ALL TO authenticated` scoped por
  `ID_Organizacion` (`auth_org_id()`).

- **Bucket Storage `evidencias_pecuario`** (nuevo, no reutiliza
  `evidencias_eudr` — otro vertical): `public=false`,
  `file_size_limit=10485760` (10MB, mismo tope que `evidencias_eudr`),
  `allowed_mime_types=['image/jpeg','image/png','image/webp']`.
  Convención de ruta: `{ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}`
  — un nivel más granular que `evidencias_eudr`, deja lugar para
  extender la misma capacidad a otras pantallas (Sanidad, Parto) sin otra
  migración.

  **Las 4 políticas RLS de `storage.objects`** — confirmadas en vivo
  contra `pg_policies` (vía `supabase db query --linked`, ver nota sobre
  esta capacidad más abajo):

  | policyname | cmd | roles | expresión (`USING`/`WITH CHECK`) |
  |---|---|---|---|
  | `rls_storage_select_evidencias_pecuario` | SELECT | `{authenticated}` | `USING`: `bucket_id = 'evidencias_pecuario' AND ((storage.foldername(name))[1] = auth_org_id() OR auth.role() = 'service_role' OR CURRENT_USER = 'postgres')` |
  | `rls_storage_insert_evidencias_pecuario` | INSERT | `{authenticated}` | `WITH CHECK`: misma condición que arriba |
  | `rls_storage_update_evidencias_pecuario` | UPDATE | `{authenticated}` | `USING` + `WITH CHECK`: misma condición, ambas cláusulas |
  | `rls_storage_delete_evidencias_pecuario` | DELETE | `{authenticated}` | `USING`: misma condición |

**Nota sobre `supabase db query --linked`:** esta sesión descubrió y usó
por primera vez esta capacidad de la CLI (Management API, sin
`DATABASE_URL`/contraseña de Postgres directa) para traer evidencia
literal de `pg_policies`/`information_schema` — **usada exclusivamente
para lecturas** (`SELECT`). Aplicar migraciones (DDL) sigue siendo,
sin excepción, un paso manual del usuario en Studio (§4.1.4) —
esta capacidad no cambia eso, solo la forma en que Claude Code CLI puede
verificar el estado real de la base sin depender únicamente de lo que
PostgREST expone. Ver `AI_STATE.md` para el detalle completo.

**Verificado en vivo** (`tests/test_pecuario_mortalidad_fotos.py`,
**19/19**): `INSERT` de prueba real —

```json
{
  "id": "68349e71-5c14-4af0-934e-a0e1d3e4e481",
  "ID_Organizacion": "ORG-TEST-DEMO",
  "mortalidad_id": "992bf948-7d2b-4fa3-bbb5-2286bd6a63ff",
  "storage_path": "ORG-TEST-DEMO/mortalidad/992bf948-7d2b-4fa3-bbb5-2286bd6a63ff/foto1.jpg",
  "device_id": null,
  "created_offline_at": null,
  "synced_at": "2026-09-23T04:20:00.735813+00:00",
  "created_at": "2026-09-23T04:20:00.735813+00:00"
}
```

— duplicado del mismo `storage_path` rechazado (`409`,
`23505 duplicate key value violates unique constraint "uq_mortalidad_fotos_storage_path"`);
aislamiento RLS de la tabla (sesión de `ORG-TEST-DEMO` leyendo una fila
sembrada en `COOP-AROMAS-VALLE` → `200` con `[]`); aislamiento RLS del
bucket en ambas direcciones — subida cruzada (`ORG-TEST-DEMO` intentando
escribir en la carpeta de `COOP-AROMAS-VALLE`) → `400`
`{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy","code":"AccessDenied"}`;
lectura cruzada de un objeto sembrado en `COOP-AROMAS-VALLE` → `400`
`{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}`
(RLS hace el objeto indistinguible de "no existe" para quien no tiene
acceso); subida y lectura de la propia organización, ambas exitosas
(`200`, bytes idénticos a los subidos).

## Módulo Pecuario Cuyes — v9 (catálogo de actividades de Sanidad configurable), APLICADA (2026-09-23)

`supabase/migrations/20260923130000_pecuario_sanidad_actividades_configurables.sql`
(`specs/pecuario_sanidad_actividades_configurables.md` referenciada, pero
nunca existió en este repo — mismo hallazgo que Guano/Mortalidad-fotos).
**Decisión de arquitectura:** dos tablas, catálogo + transaccional, mismo
patrón ya usado en Compras/Insumos.

- `PECUARIO_ACTIVIDADES_SANIDAD` (catálogo por organización) —
  columnas reales confirmadas en vivo: `id` (uuid pk), `ID_Organizacion`
  (text NOT NULL, FK), `nombre` (varchar NOT NULL), `alcance` (enum nuevo
  `alcance_actividad_sanidad`: `granja`/`galpon`, NOT NULL),
  `frecuencia_dias` (integer NOT NULL, `CHECK > 0`), `activo` (boolean
  NOT NULL default `true` — desactivar sin perder historial, nunca
  borrado físico), `created_at`.
- `PECUARIO_SANIDAD_REGISTROS` (transaccional, un registro por ejecución
  de actividad) — `id`, `ID_Organizacion` (NOT NULL, FK), `actividad_id`
  (uuid NOT NULL, FK a `PECUARIO_ACTIVIDADES_SANIDAD.id`, `ON DELETE
  RESTRICT`), `galpon_id` (uuid, FK a `PECUARIO_GALPONES.id`, `ON DELETE
  SET NULL` — obligatorio o prohibido según el `alcance` de la actividad,
  ver trigger abajo), `fecha` (date NOT NULL, default `CURRENT_DATE`),
  `producto_usado`/`responsable` (varchar), `observaciones` (text —
  `responsable` es PII interna, nunca expuesta en `/trace/[lot_hash]`),
  campos offline, `created_at`.
- **Trigger `trg_validar_sanidad_registro_galpon`** (`BEFORE INSERT OR
  UPDATE`): corrige en la base un bug real ya visto en el mockup
  (`guardarActividadSanidad()` dejaba pasar `galpon_id` ausente/sobrante
  según el alcance, produciendo registros corruptos) — rechaza
  `alcance='galpon'` sin `galpon_id`, y rechaza `alcance='granja'` con
  `galpon_id` presente. Probado en ambos sentidos en vivo.
- RLS: mismo patrón `FOR ALL TO authenticated` en las 2 tablas, scoped
  por `ID_Organizacion` (`auth_org_id()`). **Nota explícita de la
  migración:** la restricción real "solo admin puede crear/editar
  actividades del catálogo" (spec §4) no está en esta política — la web
  no tiene sesión de Supabase Auth real hoy (llave `anon`), así que esa
  restricción debe vivir en la Server Action correspondiente hasta que
  exista login real en la web; se aplicará de lleno vía RLS por rol en
  las apps móviles nuevas.

**Reemplaza conceptualmente, sin `DROP`, a la v2 (2026-09-11):**
`PECUARIO_CONTROL_SANITARIO` (desinfección, alcance `granja`) y
`PECUARIO_LIMPIEZA_GALPON` (limpieza por galpón, alcance `galpon`)
quedan marcadas `SUPERADA` vía `COMMENT ON TABLE` — no usar para
escritura nueva, no eliminadas (`DROP TABLE` exige confirmación
explícita fuera del flujo autónomo, §5). Verificado antes de migrar
(CLI, 2026-09-23): **0 filas reales para `GRANJA-VALENCIA`** en ambas
tablas (`Content-Range: */0`, `ID` de organización confirmado contra
`ORGANIZACIONES`, sin otro candidato con "VALENCIA"/"GRANJA" en el
nombre) — no requirió backfill hacia las tablas nuevas. Las vistas
`vw_pecuario_desinfeccion_estado`/`vw_pecuario_limpieza_galpon_estado`
(v2) también quedan marcadas `SUPERADA` vía `COMMENT ON VIEW` — grep
exhaustivo en `app/`/`components/`/`lib/` confirmó **cero referencias**
a ninguna de las dos, el frontend web no las consume.

**Contrato Zod:** `SanidadActividadSchema`/`SanidadRegistroSchema`
nuevos en `lib/validations/pecuario.ts` (ruta real). La guarda cruzada
`galpon_id` según `alcance` **no se replica en Zod** — requiere
consultar el catálogo (`actividad_id → alcance`), algo que Zod no
resuelve sin una llamada async; esa regla vive solo en el trigger de la
base como fuente de verdad única (el formulario debe repetirla en JS
para feedback inmediato, pero eso es lógica de UI, no del contrato).

**Verificado en vivo** (`tests/test_pecuario_sanidad_actividades.py`,
**22/22**, incluido el test de aislamiento RLS cruzado dedicado que
exige el system prompt para toda tarea que toque RLS — mismo patrón que
`tests/test_pecuario_mortalidad_fotos.py`): `frecuencia_dias=0` rechazado
por el `CHECK`; registro `alcance='granja'` con `galpon_id` rechazado por
el trigger; registro `alcance='galpon'` sin `galpon_id` rechazado por el
mismo trigger; ambos casos válidos (granja sin galpón, galpón con
galpón) insertan correctamente; aislamiento RLS cruzado de lectura y de
escritura en **ambas** tablas (una sesión de `ORG-TEST-DEMO` no ve ni
puede insertar actividades/registros con `ID_Organizacion` de
`COOP-AROMAS-VALLE`); escritura autenticada en la propia organización,
en ambas tablas.

## Módulo Pecuario Cuyes — v10 (traslado interno entre pozas/jaulas), APLICADA (2026-09-24)

`supabase/migrations/20260924100000_pecuario_traslado_interno.sql`
(`specs/pecuario_traslado_interno.md` referenciada, pero nunca existió
en este repo). `PECUARIO_TRASLADOS` (registro/auditoría) + trigger
`trg_procesar_traslado` (`BEFORE INSERT`) que aplica el efecto real en
la misma transacción: traslado completo de un lote (actualiza
`poza_actual_id`, sin crear filas), traslado parcial con split (crea un
lote nuevo en la poza destino con la cantidad trasladada, descuenta
`cantidad_actual` del lote origen, fija `lote_nuevo_id`), o traslado de
un reproductor identificado (actualiza `jaula_actual_id`). Un solo par
`origen_jaula_id`/`destino_jaula_id` para ambos casos — "poza" y "jaula"
son la misma tabla (`PECUARIO_JAULAS`). `origen_jaula_id` lo calcula
siempre el trigger a partir del estado real, nunca confía en lo que
mande el cliente. `CHECK chk_traslados_lote_nuevo_solo_parcial`
(`lote_nuevo_id IS NULL OR alcance = 'parcial'`) agregado en una tarea
de seguimiento, cerrando un gap señalado en la primera versión. RLS:
mismo patrón `FOR ALL TO authenticated` scoped por `ID_Organizacion`.

**Verificado en vivo** (`tests/test_pecuario_traslado_interno.py`,
**20/20**): traslado completo mueve el lote sin crear fila nueva;
traslado parcial crea el lote nuevo con la cantidad exacta y descuenta
el origen; cantidad mayor a la disponible rechazada; `lote_nuevo_id`
enviado junto con `alcance='completo'` rechazado por el `CHECK` nuevo;
`destino_jaula_id` de otra organización rechazado; origen=destino
rechazado (`CHECK`); `origen_jaula_id` calculado por el trigger,
ignorando lo que manda el cliente; traslado de reproductor actualiza
`jaula_actual_id`; aislamiento RLS cruzado (`ORG-TEST-DEMO` no ve
traslados de `GRANJA-VALENCIA`).

## Módulo Pecuario Cuyes — v11 (población real por poza/organización), APLICADA (2026-09-24)

`supabase/migrations/20260924110000_pecuario_poblacion_vistas.sql`
(`specs/pecuario_ficha_poza_y_calculo_poblacion.md` referenciada, pero
nunca existió en este repo). 3 vistas de solo lectura — sin tablas,
triggers ni RLS de escritura nuevos:

- `vw_pecuario_lactancia_restante` — reemplaza el `CAMADAS_LACTANCIA`
  cargado a mano del simulador; calculado en vivo desde
  `PECUARIO_PARTOS`/`PECUARIO_LOTES.parto_origen_id`
  (`cantidad_restante = n_vivos - SUM(cantidad_inicial de los lotes de
  ese parto)`). No descuenta mortalidad de lactancia (`PECUARIO_MORTALIDAD`
  no referencia `parto_id`, solo `poza_id` — no atribuible con certeza
  entre partos concurrentes de la misma poza). Un parto totalmente
  destetado desaparece de la vista.
- `vw_pecuario_ocupacion_poza` — ficha de poza: lotes, reproductores
  activos/enfermos por sexo, lactancia en curso, total, y
  `sobre_capacidad` (total > `capacidad_max`).
- `vw_pecuario_poblacion_resumen` — una fila por organización con los 4
  números del Dashboard (Lactancia/Recría/Engorde/Reproductores) + el
  total general. Recría/Engorde vienen de
  `vw_pecuario_lotes_etapa.etapa_calculada`, no de la columna cruda. Acá
  sí se descuenta mortalidad de lactancia (a nivel organización, sin
  atribuir a poza/parto puntual).

Reproductores con `estado='enfermo'` cuentan como presentes; solo
`vendido`/`muerto` se excluyen.

**Verificado en vivo** (`tests/test_pecuario_poblacion_vistas.py`,
**20/20**): parto nuevo aparece con `cantidad_restante = n_vivos`;
destete parcial baja `cantidad_restante` sin sacar el parto de la
vista; destete completo sí lo saca; `total_poblacion` en el resumen
queda **exactamente igual** antes y después de un destete completo
(solo cambia lactancia→recría); un lote con `etapa='recria'` cruda pero
`fecha_destete` de hace más de 56 días cuenta en `total_engorde`, no en
`total_recria` (confirma que se usa `etapa_calculada`); reproductor
enfermo cuenta, vendido no; `sobre_capacidad` correcto en ambos
sentidos; mortalidad de lactancia se descuenta en el resumen (org) pero
NO en la ocupación de esa poza (asimetría documentada a propósito);
aislamiento RLS cruzado en las 3 vistas.

## Módulo Pecuario Cuyes — v12 (Destete: recolección semanal + conformación de lotes por sexo), CÓDIGO LISTO — pendiente de aplicación manual en Studio (2026-09-25)

`supabase/migrations/20260925090000_pecuario_destete_recoleccion.sql`
(`specs/pecuario_destete_recoleccion_semanal.md` §10 — el resto del
documento, §1–§9, no existía en el repo y no fue reconstruido, ver nota
de transparencia al inicio de ese archivo). Reemplaza el estado en
memoria del navegador del simulador (`poolDestete`/
`lotesDesteteFormados`) con dos fases persistentes:

- `PECUARIO_RECOLECCIONES_DESTETE` — fila ancla por ronda de
  recolección (fecha, organización), inmutable tras crearse.
- `PECUARIO_RECOLECCION_PARTOS` — qué partos entraron en cada
  recolección y cuánto de cada uno; `cantidad_incluida` siempre
  calculada por `trg_recoleccion_partos_validar` desde
  `vw_pecuario_lactancia_restante` en el momento del insert (nunca
  confía en lo que manda el cliente); `UNIQUE(parto_id)` **global**, no
  por recolección — un parto se recolecta completo o nada.
- `PECUARIO_LOTES.recoleccion_origen_id` (columna nueva, nullable) — el
  lote real que arma el Paso 2. `trg_conformar_lote_destete`
  (`BEFORE INSERT` en `PECUARIO_LOTES`, no-op cuando
  `recoleccion_origen_id IS NULL`, así que no interfiere con Traslado ni
  con altas manuales) valida organización de la recolección y de la
  poza destino, y que `cantidad_inicial` no supere el remanente real
  (`recolectado - ya asignado en otros lotes de esa recolección`).
  `CHECK chk_lotes_destete_sexo_definido` exige `sexo IN ('macho',
  'hembra')` cuando `recoleccion_origen_id IS NOT NULL` (sin 'mixto').
- `vw_pecuario_lactancia_restante` — **reemplazada** (`CREATE OR
  REPLACE`, mismo nombre de vista y de columna `cantidad_destetada` por
  compatibilidad con `vw_pecuario_ocupacion_poza`/
  `vw_pecuario_poblacion_resumen`, que ya dependían de ella desde v11):
  ahora suma desde `PECUARIO_RECOLECCION_PARTOS` en vez de
  `PECUARIO_LOTES.parto_origen_id` — el corte real de "ya no está en
  lactancia" es la **recolección** (Paso 1), no la conformación del
  lote (Paso 2, que puede pasar días después y agrupa varios partos sin
  atribución individual). `parto_origen_id` sigue existiendo en el
  esquema; el flujo de Destete simplemente no lo usa.
- `vw_pecuario_recolecciones_destete` (nueva) — recolectada, asignada,
  pendiente y `estado` (`'abierta'`/`'cerrada'`, 100% calculado, nunca
  un `UPDATE`) por recolección.

Zod: `RecoleccionDestemteSchema`/`ConformarLoteDestemteSchema`
(`lib/validations/pecuario.ts`). `cantidad_inicial ≤ remanente` no se
valida en Zod a propósito — vive solo en `trg_conformar_lote_destete`
(fuente de verdad única).

**Escrito y verificado en estático** (`tests/test_pecuario_destete_recoleccion.py`,
**15/15** estático+contrato Zod, **11 SKIPPED** en vivo — migración
todavía no aplicada). Cubre: recolección calcula `cantidad_incluida`
por trigger ignorando lo que manda el cliente; recolectar el mismo
parto dos veces falla (el trigger bloquea antes de llegar a violar el
`UNIQUE` — ver nota en el propio test); conformar lote baja
`cantidad_pendiente`/sube `cantidad_asignada`; `cantidad_inicial` mayor
al remanente rechazada; `sexo='mixto'` con `recoleccion_origen_id`
rechazado por el `CHECK`; dos lotes consecutivos agotan el remanente y
cierran la recolección sin `UPDATE` manual; un parto recolectado (sin
lote conformado todavía) ya no aparece en `vw_pecuario_lactancia_restante`;
aislamiento RLS cruzado de lectura/escritura; `PECUARIO_LOTES` con
`recoleccion_origen_id`/`poza_actual_id` de otra organización
rechazado.

**Pendiente:** aplicación manual en Supabase Studio (Neyser). Una vez
aplicada, re-correr `pytest tests/test_pecuario_destete_recoleccion.py -v`
contra la base real y pegar la salida literal antes de marcar este
módulo `APLICADA`.
