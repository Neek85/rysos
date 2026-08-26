# Spec — Normalización de certificaciones en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** Auditoría completa — spec y diseño propuesto, **sin
  migración SQL ni cambios de código todavía**.
- **Fecha:** 2026-08-25
- **Contexto previo:** `specs/roadmap_padron_multiorganizacion.md`
  (sección 1, diseño original de alto nivel), `ADR-023`/`ADR-024`
  (protocolo "capturar exacto, no adivinar" reutilizado acá para las
  vistas dependientes), `ADR-026` (PK surrogate `id` UUID en
  `PADRON_SOCIOS`/`PADRON_PARCELAS` — habilita FKs reales desde las
  tablas nuevas, algo que antes de esa migración no era seguro de hacer).

## Metodología

Misma limitación de siempre: sin conexión Postgres directa desde este
entorno (confirmado en `AI_STATE.md`/varias tareas anteriores) — toda la
evidencia viene de introspección OpenAPI de PostgREST (Service Role Key)
y consultas REST reales de solo lectura, nunca de memoria ni de lo que
dice `docs/schema_live.md` sin re-verificar.

## 1. Estado real relevado — evidencia cruda

### 1.1 Las 8 columnas de "flags" en `PADRON_SOCIOS` — corrección de premisa: son `text`, no `boolean`

El prompt de esta tarea las describe como "columnas booleanas". **Esto no
es exacto** — confirmado por introspección OpenAPI (`format`/`type` de
cada columna, service role key, 2026-08-25):

```
cert_nop_usda:       {'format': 'text', 'type': 'string'}
ue_2018_848:         {'format': 'text', 'type': 'string'}
cor_canada:          {'format': 'text', 'type': 'string'}
cert_ds_0442006_ag:  {'format': 'text', 'type': 'string'}
cert_lpo_mx:         {'format': 'text', 'type': 'string'}
cert_rainforest:     {'format': 'text', 'type': 'string'}
cert_comercio_justo: {'format': 'text', 'type': 'string'}
cert_fair_trade_usa: {'format': 'text', 'type': 'string'}
```

Las 8 son `text` a nivel de Postgres. La semántica booleana la impone
**solo el código de aplicación** —
`lib/validations/socios.js:14`: `const siNo = z.enum(['Sí', 'No']).optional().nullable().or(z.literal(''))`,
aplicado a las 8 en el schema Zod (`socioSchema`, líneas 52-59). No hay
ningún `CHECK` a nivel de base que lo garantice — un `INSERT`/`UPDATE`
directo (Service Role Key, sin pasar por Zod) podría escribir cualquier
string.

Valores reales en las 7 filas de `PADRON_SOCIOS` (REST directo,
2026-08-25, sin columnas de PII):

| ID_Socio | cert_nop_usda | ue_2018_848 | cor_canada | cert_ds_0442006_ag | cert_lpo_mx | cert_rainforest | cert_comercio_justo | cert_fair_trade_usa |
|---|---|---|---|---|---|---|---|---|
| JS-00001 | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí |
| JS-00002 | No | No | No | No | No | Sí | Sí | Sí |
| JS-00003 | No | No | No | No | No | Sí | Sí | Sí |
| JS-0005 | Sí | *(null)* | *(null)* | *(null)* | *(null)* | *(null)* | *(null)* | *(null)* |
| ND-00001 | No | No | No | No | Sí | No | No | Sí |
| ND-00002 | No | No | No | No | No | Sí | Sí | Sí |

Confirmado: los 3 valores reales que existen hoy son exactamente `'Sí'`,
`'No'`, `NULL` (nunca cadena vacía en los datos reales, aunque el schema
Zod la permite).

### 1.2 `certificaciones` y `cert_org_estatus` — texto libre, sin `CHECK`

Ambas `text`, sin restricción de valores a nivel de base ni de Zod
(`lib/validations/socios.js:50-51`: ambas mapean a `str` = `z.string().optional().nullable()`,
sin `.enum()`).

Valores reales observados:

| Columna | Valores reales (2026-08-25) |
|---|---|
| `certificaciones` | `"Orgánica"`, `"Rainforest"`, `NULL` |
| `cert_org_estatus` | `"Organico"`, `"Sin Estatus"`, `NULL` |

**Observación no solicitada, relevante para el diseño:** en los datos
reales, `certificaciones` parece un resumen derivado de los flags, no
información independiente — `JS-00001` tiene `certificaciones =
"Orgánica"` y 5 de los 8 flags de tipo orgánico en `"Sí"`; `JS-00002`
tiene `certificaciones = "Rainforest"` y `cert_rainforest = "Sí"`. No se
confirma con evidencia que sea *siempre* así (7 filas es poca muestra),
pero es una hipótesis a resolver antes de decidir si `certificaciones`
necesita migrarse a una tabla nueva o si puede derivarse en la UI a
partir de `SOCIO_CERTIFICACIONES` — ver "Preguntas abiertas".

### 1.3 `normas_internas_17` — confirmado huérfano en código de aplicación, separado de `CERT_FLAG_FIELDS`

Ya documentado como huérfano en `ADR-023`. Confirmado de nuevo acá: **no
forma parte de `CERT_FLAG_FIELDS`** (`lib/validations/socios.js:92-101`,
8 elementos, `normas_internas_17` no está en la lista) y el único archivo
de todo el repo que lo menciona es
`tests/test_padron_baseline_adopcion.py` (verifica que la migración base
lo capturó, no que algún código lo use). Es `text`, mismos valores `'Sí'`/`'No'`/`NULL`
que los 8 flags por los datos observados, pero **fuera del alcance del
retiro de columnas de esta spec** salvo decisión explícita — no está en
la lista de 8 que el prompt pide retirar.

### 1.4 `PADRON_PARCELAS` — cero columnas de certificación

Confirmado por introspección: las columnas reales de `PADRON_PARCELAS`
hoy son `ID_Organizacion, ID_Parcela_Fija, ID_Socio, activo,
actualizado_en, creado_en, creado_por, geom, hbp, hcc, hcp, hip, ho, hr,
hrp, id, otros_cultivo, parcela_codigo, parcela_nombre, socio_dni,
socio_nombre_completo, totalh` — ninguna de certificación. Esto confirma
que `PARCELA_CERTIFICACIONES` no tiene ninguna columna origen de la que
migrar datos — nace vacía, coherente con el diseño original del roadmap
("estado granular por parcela, sin agencia propia — se hereda del socio
dueño").

### 1.5 Vistas dependientes — 2 vistas activas dependen de `certificaciones`, 1 vista expone todo el bloque

Mismo tipo de chequeo que reveló la dependencia de `vw_parcelas_web` en
el paso 1 (`ADR-024`) — vía introspección OpenAPI (qué objetos exponen
cada columna, proxy de "esta vista la selecciona"), no `pg_depend` crudo
(sigue sin haber acceso a SQL crudo desde este entorno):

| Vista | Columnas de certificación que expone | Riesgo si se retira/renombra `certificaciones`/`cert_org_estatus`/los 8 flags |
|---|---|---|
| **`view_eudr_dashboard_aprobados`** | `certificaciones` (vía `s.certificaciones`, `JOIN PADRON_SOCIOS s`) | **Real** — es una de las 2 vistas ya corregidas en `ADR-026` (fix de `JOIN` por organización). Un `DROP COLUMN certificaciones` rompería su `SELECT` — necesita `CREATE OR REPLACE VIEW` como parte de la migración futura, mismo protocolo que `ADR-024`/`ADR-026`. |
| **`vw_monitoreo_eudr_aprobado`** | `certificaciones` | Mismo riesgo — vista no auditada en detalle en esta tarea (fuera del listado original de vistas del Dashboard), **hallazgo nuevo, no documentado en `ADR-026`**. Verificado (`grep` sobre `supabase/migrations/`): **tampoco tiene ningún `CREATE VIEW` versionado en este repo** — mismo caso exacto que `vw_parcelas_web` antes de `ADR-024` (creada fuera de este repo, invisible al historial de migraciones). La migración de certificaciones real no puede "leer el archivo y copiar la definición" para esta vista como sí puede para `view_eudr_dashboard_aprobados` — necesita el mismo protocolo de diagnóstico en vivo (`pg_get_viewdef`) que destrabó `vw_parcelas_web`. |
| **`vw_socios_web`** | Los 10 (8 flags + `certificaciones` + `cert_org_estatus`) — no expone `normas_internas_17` | Sin consumidor conocido en este repo (mismo hallazgo que `ADR-024`: cero referencias vía grep) — pero es un `SELECT` plano, ya documentado como creada fuera de este repo, sin versionar. |

**`vw_monitoreo_eudr_aprobado` es un hallazgo nuevo de esta tarea** — no
apareció en la auditoría del paso 2 (`specs/multi_organizacion_codigos_unicos.md`)
porque esa auditoría buscaba dependencias de `ID_Socio`/`ID_Parcela_Fija`/la
PK, no de `certificaciones`. Queda señalado acá para que la migración de
certificaciones (no esta tarea) capture su definición exacta con el mismo
protocolo, en vez de asumir que solo hay que tocar 2 vistas.

### 1.6 Catálogos de certificación/agencias ya existentes — ninguno duplicable, pero un hallazgo relacionado importante

Búsqueda de tablas con "certif"/"agencia" en el nombre: **ninguna
coincidencia** en los 44+ objetos expuestos por PostgREST — no hay
ningún `CERTIFICACIONES_CATALOGO`/`AGENCIAS_CERTIFICADORAS` (ni con otro
nombre parecido) ya existente. No hay riesgo de duplicar algo.

**Sí existe `CAT_NORMAS`** (catálogo del módulo Fase 6/Inspecciones, 66
filas, columnas `id_norma, seccion, nombre_dax, pregunta_texto,
criticidad, certificacion`) — es un banco de preguntas de checklist de
auditoría, cada una etiquetada con a qué programa(s) de certificación
aplica, vía una columna `certificacion` de texto libre con valores
combinables por coma. Confirmado por consulta real (66 filas): los
valores distintos que aparecen son `"Todas"`, `"Fairtrade"`,
`"Rainforest"`, `"Orgánica"`, y combinaciones (`"Fairtrade,Rainforest"`,
`"Orgánica,Rainforest"`). **No es un duplicado de lo que se va a
construir** (es un catálogo de preguntas de auditoría, no de "qué socio
tiene qué certificación"), pero su taxonomía de nombres (`"Fairtrade"`,
no `"Fair Trade USA"` ni `"Comercio Justo"`) es una fuente real y viva de
nombres de certificación que **no coincide exactamente** con los labels
de `CERT_FLAG_FIELDS` (`'Fair Trade USA'`, `'Comercio Justo'` como dos
programas separados) — al diseñar `CERTIFICACIONES_CATALOGO.codigo`/`nombre`,
alguien tiene que decidir si buscan alinear esta nomenclatura con
`CAT_NORMAS` o si son taxonomías deliberadamente independientes. Ver
"Preguntas abiertas".

### 1.7 Hallazgo inesperado, el más importante de esta auditoría: `NORMAS` — una tabla base independiente con el mismo bloque de 10 columnas

**No mencionado en ningún documento previo de esta secuencia.** Existe
una tabla base real (no vista) llamada `NORMAS` — con PK propia
(`ID_Cap_normas`), FK real a `INSPECCIONES.ID_Inspeccion`
(`<fk table='INSPECCIONES' column='ID_Inspeccion'/>`, confirmado por
anotación PostgREST), y **exactamente el mismo bloque de 10 columnas de
certificación** que `PADRON_SOCIOS`
(`cert_org_estatus, cert_nop_usda, ue_2018_848, cor_canada,
cert_ds_0442006_ag, cert_lpo_mx, cert_rainforest, cert_comercio_justo,
cert_fair_trade_usa, normas_internas_17`), más `normas_internas` (sin el
`_17`, columna adicional que `PADRON_SOCIOS` no tiene) y `id_socio_vinculo`
(vínculo de texto libre a un socio, sin FK).

Confirmado:
- **1 sola fila** en la instancia real (`Content-Range: 0-0/1`).
- **Cero referencias en código de este repo** (grep literal en
  `.js`/`.jsx`/`.py`, cero resultados) — mismo patrón que
  `vw_parcelas_web`/`vw_socios_web`/`PARCELAS` antes de auditarlas: existe
  en la base real, invisible al grep.
- **No es parte del port de Fase 6 de este repo** —
  `lib/inspeccionesActions.js` solo lee/escribe 6 tablas `CAP_*`
  (`CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`, `CAP_BIENESTAR`,
  `CAP_RIESGOS`, `CAP_GESTION`) — `NORMAS` no está en esa lista pese a
  seguir la misma convención de nombre-de-módulo-FED que esas 6.
- **Nunca aparece en ningún `supabase/migrations/*.sql`** de este repo —
  igual que `PADRON_SOCIOS`/`PADRON_PARCELAS` antes de `ADR-023` y
  `vw_parcelas_web`/`vw_socios_web` antes de `ADR-024`: creada fuera de
  este repo, sin `CREATE TABLE` versionado.
- `anon` devuelve `[]` (vacío, no error) al consultarla — no confirmado
  si es porque RLS la filtra o por otro motivo; no investigado a fondo,
  fuera del alcance de esta auditoría de certificaciones.

**Por qué importa:** `NORMAS` parece ser una **captura por-inspección**
del mismo bloque de certificación que `PADRON_SOCIOS` captura a nivel de
socio (probablemente el origen histórico real de esos datos — un
técnico llenaba este bloque durante una inspección de campo (AppSheet),
y en algún momento se copió/sincronizó a `PADRON_SOCIOS` como "estado
actual"). Esta spec **no** propone consumir `NORMAS` como fuente de
datos para la normalización (el prompt de esta tarea pidió
específicamente `PADRON_SOCIOS`/`PADRON_PARCELAS`, no este módulo) — pero
dejarla sin mencionar sería ocultar una pieza real del rompecabezas. Ver
"Preguntas abiertas" — **este hallazgo, por su tamaño, amerita revisión
tuya antes de decidir el alcance final de la migración de datos.**

### 1.8 Uso de `CERT_FLAG_FIELDS` en código — 7 archivos confirmados, con matices reales

El prompt pedía confirmar si son "exactamente 7 archivos o un número
distinto". **Confirmado: 7 archivos `.js`/`.jsx` mencionan el nombre
`CERT_FLAG_FIELDS`** (grep literal en todo el repo, sin contar
`.md`) — coincide con la cifra citada. Pero no los 7 dependen de la misma
forma:

| Archivo | Tipo de dependencia |
|---|---|
| `lib/validations/socios.js:92` | **Definición** — `export const CERT_FLAG_FIELDS = [...]` |
| `lib/padronCsv.js:7,24,61` | **Consumidor real** — arma `SOCIO_EXPORT_COLUMNS` y `SOCIO_FIELD_LABELS` para el CSV |
| `lib/sociosSearch.js:7,16` | **Consumidor real** — arma `SOCIO_COLUMNS` (columnas que trae `fetchSocios`) |
| `components/features/socios/SocioFormModal.jsx:7,158` | **Consumidor real** — renderiza los 8 `<select>` Sí/No del formulario |
| `app/dashboard/socios/page.jsx:8,236` | **Consumidor real** — renderiza los filtros `certFlags` de la tabla |
| `tests/test_socios_schema.mjs:13,71,83` | **Test** — verifica que tiene "exactamente las 8 columnas reales confirmadas contra el schema en vivo" (línea 83, comentario propio del test) — necesita actualizarse si la forma de `CERT_FLAG_FIELDS` cambia, pero no es código de aplicación desplegado |
| `lib/gisTargetTables.js:8` | **Solo un comentario** — `// (mismo criterio que HECTARE_FIELDS/CERT_FLAG_FIELDS en...)`, **no hay ningún `import`** — confirmado con grep específico de `import.*CERT_FLAG_FIELDS`, cero resultados en este archivo. No requiere ningún cambio de código. |

Resumen: **4 consumidores reales de aplicación + 1 definición + 1 test +
1 mención en comentario = 7**, no todos con el mismo peso. La migración
de código futura toca 5 archivos con código real
(`validations/socios.js`, `padronCsv.js`, `sociosSearch.js`,
`SocioFormModal.jsx`, `page.jsx`) + 1 test a actualizar
(`test_socios_schema.mjs`) — `gisTargetTables.js` no necesita ningún
cambio.

## 2. Diseño propuesto — las 5 tablas nuevas

Habilitado por `ADR-026` (PK surrogate `id` UUID en `PADRON_SOCIOS`/
`PADRON_PARCELAS`, ya aplicada): las FKs de `SOCIO_CERTIFICACIONES`/
`PARCELA_CERTIFICACIONES` pueden apuntar a `id` (UUID) en vez de al
código legible — algo que antes de esa migración no era seguro (ver
`specs/multi_organizacion_codigos_unicos.md`: "sin FK real apuntando a
estas PK", exactamente por el riesgo de que el código dejara de ser
único). Este diseño es una consecuencia directa y positiva de esa
migración anterior, no una coincidencia.

```sql
-- Catálogo de programas de certificación (8 externos + normas_internas_17 interno)
CERTIFICACIONES_CATALOGO
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
  codigo                  text NOT NULL UNIQUE        -- ej. 'NOP_USDA', 'RAINFOREST'
  nombre                  text NOT NULL               -- ej. 'NOP USDA' (label actual de CERT_FLAG_FIELDS)
  es_certificacion_externa boolean NOT NULL DEFAULT true  -- false para normas_internas_17
  activo                  boolean NOT NULL DEFAULT true
  creado_en               timestamptz NOT NULL DEFAULT now()

-- Catálogo de agencias certificadoras (nuevo -- no existe hoy ninguna fuente de esto)
AGENCIAS_CERTIFICADORAS
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
  nombre       text NOT NULL
  activo       boolean NOT NULL DEFAULT true
  creado_en    timestamptz NOT NULL DEFAULT now()

-- Una organización tiene el programa habilitado, con una fecha de obtención
ORGANIZACION_CERTIFICACIONES
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_organizacion   text NOT NULL             -- FK NO agregada (mismo criterio que ADR-007: sin FK real hoy hacia ORGANIZACIONES desde ninguna tabla de este bloque)
  id_certificacion  uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  fecha_obtencion   date
  UNIQUE (id_organizacion, id_certificacion)

-- Un socio tiene la certificación, con la agencia real que lo certificó
SOCIO_CERTIFICACIONES
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_socio                  uuid NOT NULL REFERENCES "PADRON_SOCIOS"(id)
  id_certificacion          uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  id_agencia_certificadora  uuid REFERENCES "AGENCIAS_CERTIFICADORAS"(id)  -- nullable: normas_internas_17 no tiene agencia
  creado_en                 timestamptz NOT NULL DEFAULT now()
  actualizado_en            timestamptz NOT NULL DEFAULT now()
  UNIQUE (id_socio, id_certificacion)   -- garantiza estructuralmente una sola agencia por socio+programa

-- Estado granular por parcela -- nace vacía, sin dato origen (ver 1.4)
PARCELA_CERTIFICACIONES
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_parcela        uuid NOT NULL REFERENCES "PADRON_PARCELAS"(id)
  id_certificacion  uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  estado            text NOT NULL DEFAULT 'No Certificado' CHECK (estado IN ('Certificado', 'En Transición', 'No Certificado'))
  UNIQUE (id_parcela, id_certificacion)
```

## 3. Plan de migración de datos desde las columnas planas actuales

**Solo para la tarea de implementación futura — no se ejecuta acá.**

1. `CERTIFICACIONES_CATALOGO`: 9 filas seed — las 8 de
   `CERT_FLAG_FIELDS` (`es_certificacion_externa = true`) + `normas_internas_17`
   (`es_certificacion_externa = false`). `codigo`/`nombre` según la tabla
   de la sección 1.8.
2. `SOCIO_CERTIFICACIONES`: por cada fila de `PADRON_SOCIOS` × cada una de
   las 8 columnas de `CERT_FLAG_FIELDS` con valor `'Sí'`, un `INSERT`.
   `id_agencia_certificadora` queda `NULL` — **no hay ninguna fuente de
   datos existente que indique qué agencia certificó a cada socio** (dato
   nuevo que el diseño introduce, no uno que se pueda derivar del backfill,
   ver "Preguntas abiertas").
3. `normas_internas_17 = 'Sí'` migra igual, como una fila más de
   `SOCIO_CERTIFICACIONES` contra el registro `es_certificacion_externa = false`.
4. `PARCELA_CERTIFICACIONES`: sin backfill — nace vacía (sección 1.4).
5. `ORGANIZACION_CERTIFICACIONES`: sin fuente de datos clara — `cert_org_estatus`
   es un campo de socio, no de organización, y no mapea 1:1 a un programa
   específico (ver "Preguntas abiertas"). Probablemente arranca vacía
   también, a completar manualmente.
6. `certificaciones`/`cert_org_estatus`: **no tienen un mapeo 1:1 claro**
   a las tablas nuevas — ver "Preguntas abiertas", sección siguiente.
7. Retiro de columnas (`DROP COLUMN`, después de confirmar el backfill):
   los 8 flags + `certificaciones` + `cert_org_estatus` de `PADRON_SOCIOS`
   — **`normas_internas_17` NO está en esta lista** (el prompt de esta
   tarea solo pidió retirar las 8 + esas 2, no esa columna aparte).
8. Vistas a recrear: `view_eudr_dashboard_aprobados` con
   `CREATE OR REPLACE VIEW` (definición vigente ya conocida, en
   `supabase/migrations/20260825201351_pk_surrogate_multiorganizacion.sql`
   tras `ADR-026`); `vw_monitoreo_eudr_aprobado` con el protocolo completo
   de `ADR-024` (`DROP VIEW`/`CREATE VIEW`/`GRANT` exactos, capturados en
   vivo — no versionada en este repo, ver sección 1.5); `vw_socios_web`
   (si se decide mantenerla, dado que no tiene consumidor conocido, mismo
   protocolo de `ADR-024` por no estar versionada tampoco).

## 4. Archivos de código a actualizar — alcance real

| Archivo | Alcance del cambio |
|---|---|
| `lib/validations/socios.js` | Retira `CERT_FLAG_FIELDS`, el `siNo` enum, y los campos `certificaciones`/`cert_org_estatus`/8 flags de `socioSchema`/`SOCIO_DEFAULT_VALUES`. Necesita un esquema nuevo para las selecciones de certificación (probablemente un array de `id_certificacion` seleccionados, no 8 campos planos). |
| `lib/padronCsv.js` | `SOCIO_EXPORT_COLUMNS`/`SOCIO_FIELD_LABELS` dejan de incluir las columnas retiradas — el export/import CSV de certificaciones pasa a ser una relación, no columnas planas (cambio de forma real, no solo de nombres). |
| `lib/sociosSearch.js` | `SOCIO_COLUMNS`/`fetchSocios` dejan de traer las columnas retiradas — `filters.certFlags`/`filters.certOrgEstatus` necesitan repensarse contra las tablas nuevas (probablemente un `JOIN`/subquery contra `SOCIO_CERTIFICACIONES`). |
| `components/features/socios/SocioFormModal.jsx` | Los 8 `<select>` Sí/No se reemplazan por una UI real contra `CERTIFICACIONES_CATALOGO` (multi-select o checklist) — cambio de UI, no solo de datos. |
| `app/dashboard/socios/page.jsx` | Columna de tabla y filtros de certificación pasan a leer de las tablas nuevas. |
| `tests/test_socios_schema.mjs` | Se actualiza o se retira el test que verifica la forma de `CERT_FLAG_FIELDS` (ya no existiría). |
| `lib/gisTargetTables.js` | **Sin cambios** — solo tiene una mención en comentario, sin dependencia real (sección 1.8). |

## 5. Preguntas abiertas (sin evidencia clara — no asumidas, no resueltas en esta spec)

1. **`NORMAS` (sección 1.7)** — el hallazgo más grande de esta auditoría.
   ¿Se debe considerar como fuente/destino relacionado de esta
   normalización, o es un módulo completamente aparte (Fase 6/FED, fuera
   de alcance)? Con solo 1 fila real hoy, el impacto inmediato es bajo,
   pero la existencia de un bloque de columnas duplicado sin relación
   documentada entre ambos es una señal de posible drift de datos futuro
   si alguna vez se llena de verdad.
2. **`cert_org_estatus` no mapea 1:1** a ningún programa específico de
   `CERT_FLAG_FIELDS` — es un resumen textual libre ("Organico"/"Sin
   Estatus"). ¿Se retira sin migrar (se pierde esa etiqueta), se migra
   como una `SOCIO_CERTIFICACIONES` "genérica" contra un pseudo-programa
   "Orgánico (resumen)", o se deriva en la UI a partir de qué
   certificaciones orgánicas reales tiene el socio?
3. **`certificaciones` parece derivable de los flags** (hipótesis de la
   sección 1.2, muestra de 7 filas) — ¿confirmás que es así, o hay casos
   reales donde diverge? Si es derivable, no necesita tabla ni columna
   nueva — se calcula en la UI a partir de `SOCIO_CERTIFICACIONES`.
4. **`id_agencia_certificadora` no tiene ninguna fuente de datos para el
   backfill** — las 16 filas `'Sí'` reales de hoy (contando las 6 filas ×
   hasta 8 flags) quedarían con agencia `NULL` tras la migración. ¿Es
   aceptable que arranque así, a completar manualmente, o hace falta
   pedir esos datos a las organizaciones antes de cortar a producción?
5. **Naming de `CERTIFICACIONES_CATALOGO` vs `CAT_NORMAS.certificacion`**
   (sección 1.6) — ¿se busca alinear la nomenclatura con la que ya usa el
   módulo de Inspecciones (`"Fairtrade"`, `"Orgánica"`, `"Rainforest"`),
   o son taxonomías independientes a propósito (una para el padrón
   comercial, otra para el checklist de auditoría)?
6. **`vw_monitoreo_eudr_aprobado`** (hallazgo nuevo, sección 1.5) — no
   versionada en este repo (confirmado, cero resultados en
   `supabase/migrations/`) — antes de escribir la migración real hace
   falta el protocolo completo de diagnóstico en vivo de `ADR-024`
   (`pg_get_viewdef`/`GRANT`s exactos vía Supabase Studio SQL Editor), no
   solo leer un archivo de migración como alcanza para
   `view_eudr_dashboard_aprobados`.
