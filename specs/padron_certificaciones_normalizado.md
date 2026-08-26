# Spec — Normalización de certificaciones en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** **Implementado (paso 3, 2026-08-25) — ver sección 8 para
  el detalle y el ítem pendiente de UI/display.** Migración SQL, alta/
  edición de socio y CSV ya reescritos contra las 5 tablas nuevas;
  `sociosSearch.js`/`page.jsx`/`SocioFormModal.jsx` siguen leyendo las 8
  columnas viejas para mostrarlas al usuario final (deliberadamente
  diferido, sección 8.1). Ronda 2
  agregó la evidencia real de `certificaciones`/`cert_org_estatus`.
  Ronda 3 auditó el importador masivo (sección 6) y corrigió la premisa
  de "Excel" a CSV. Ronda 4 formalizó el contrato final de las 5 tablas
  (sección 2). Ronda 5 releva el texto exacto de las 6 políticas RLS
  activas hoy en `PADRON_SOCIOS`/`PADRON_PARCELAS` y su historial
  completo de reemplazos (sección 7.1), confirma que no existe ningún
  `GRANT` explícito versionado (7.2, con script de diagnóstico
  preparado por si hace falta el texto exacto), cita el mapeo
  `CERT_FLAG_FIELDS` completo por primera vez como tabla real (7.3 —
  corrige una referencia rota a "sección 1.8" que nunca tuvo esa tabla),
  y describe cómo se traduciría el patrón a las 5 tablas nuevas (7.4,
  descriptivo, sin SQL). Quedan abiertas: el diagnóstico de
  `vw_monitoreo_eudr_aprobado` (no bloquea esta migración, sección 3) y
  la sub-pregunta de qué certificaciones cuentan como "Orgánica" para el
  campo `estado` (sección 3.4).
- **Fecha:** 2026-08-25 (rondas 1 a 5, mismo día)
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
sin `.enum()`). Confirmado por introspección OpenAPI: **ninguna de las
dos es JSON** (`format: 'text'`, `type: 'string'` en ambas) — son
strings escalares simples, no estructuras a desempaquetar.

`PADRON_SOCIOS` tiene solo **7 filas en total** — por debajo del umbral
de 15-20 pedido para tomar una muestra representativa, así que esta es
la **población completa**, no una muestra, extraída en vivo el
2026-08-25 (REST directo, Service Role Key, sin columnas de PII):

| ID_Socio | `certificaciones` | `cert_org_estatus` | Flags orgánicos en `"Sí"` (de 5: nop_usda/ue_2018_848/cor_canada/ds_0442006_ag/lpo_mx) | `cert_rainforest` |
|---|---|---|---|---|
| JS-00001 | `"Orgánica"` | `"Organico"` | 5 de 5 | No |
| JS-00002 | `"Rainforest"` | `"Sin Estatus"` | 0 de 5 | Sí |
| JS-00003 | `NULL` | `"Sin Estatus"` | 0 de 5 | Sí |
| JS-0005 | `NULL` | `NULL` | 1 de 5 (`cert_nop_usda`, resto `NULL`) | `NULL` |
| ND-00001 | `"Orgánica"` | `"Organico"` | 1 de 5 (`cert_lpo_mx`) | No |
| ND-00002 | `"Rainforest"` | `"Sin Estatus"` | 0 de 5 | Sí |
| TEST-DELETE-ME-001... | `"Orgánica"` | `"Organico"` | 2 de 5 (`cert_nop_usda`, `cert_lpo_mx`) | **Sí** |

Valores únicos observados (población completa, no muestra):

| Columna | Valores reales |
|---|---|
| `certificaciones` | `"Orgánica"`, `"Rainforest"`, `NULL` |
| `cert_org_estatus` | `"Organico"`, `"Sin Estatus"`, `NULL` |

**Correlación real, con un contraejemplo confirmado — la hipótesis de
"derivable de los flags" de la ronda anterior NO se sostiene del todo:**

- `cert_org_estatus = "Organico"` correlaciona perfectamente con "al
  menos un flag orgánico en `Sí`" en las 7 filas (JS-00001, ND-00001,
  TEST-DELETE-ME) — sin excepciones.
- `certificaciones = "Orgánica"` correlaciona con `cert_org_estatus =
  "Organico"` en las 3 filas donde aparece — también sin excepciones.
- Pero `certificaciones = "Rainforest"` **no** correlaciona
  consistentemente con `cert_rainforest = "Sí"`: **JS-00003 tiene
  `cert_rainforest = "Sí"` (mismo perfil exacto que JS-00002/ND-00002:
  `cert_org_estatus = "Sin Estatus"`, 0 flags orgánicos) pero
  `certificaciones = NULL`, no `"Rainforest"`.** Es un contraejemplo real
  y directo a la hipótesis de "siempre derivable", no una ambigüedad de
  interpretación.
- El caso `TEST-DELETE-ME-001...` tiene **`cert_rainforest = "Sí"` Y
  `certificaciones = "Orgánica"` a la vez** — confirma que
  `certificaciones` no es "el único flag verdadero", sino algo más
  parecido a una etiqueta de certificación *primaria/destacada* elegida
  a mano, independiente de cuántos flags estén en `Sí`.

**Conclusión de esta ronda:** `certificaciones` no es de fiar como
puramente derivable de los flags — con al menos un contraejemplo real en
7 filas, migrarla automáticamente por fórmula arriesgaría perder o
inventar datos. Esta pregunta (sección "Preguntas abiertas" #3) queda
**sin resolver a propósito** — la evidencia ahora es más completa, pero
la decisión de qué hacer con `certificaciones` sigue siendo tuya.

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
programas separados). **Resuelto (2026-08-25, ver "Preguntas
abiertas" #5): `CERTIFICACIONES_CATALOGO` no alinea su naming con
`CAT_NORMAS` — taxonomías independientes a propósito.**

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
actual"). **Resuelto (2026-08-25, ver "Preguntas abiertas" #1):**
`NORMAS` queda intacta y fuera de alcance — es parte del flujo de la
futura app de Campo (inspecciones internas), no del padrón normalizado
de certificaciones; dominios distintos a propósito, no un gap a cerrar
en esta migración.

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

## 2. Contrato de datos final — las 5 tablas nuevas

**Ronda 4 (2026-08-25): contrato cerrado**, dado literalmente por Neyser
en el prompt de esta tarea — reemplaza el diseño preliminar de la ronda
1. Dos cambios reales respecto de esa primera versión, no solo
formato:

1. **`id_agencia_certificadora` se movió de `SOCIO_CERTIFICACIONES` a
   `ORGANIZACION_CERTIFICACIONES`** — la agencia certificadora se
   registra a nivel de organización (una organización contrata una
   agencia para un programa), no a nivel de socio individual. Esto
   también **resuelve por diseño** la pregunta abierta #4 de la ronda 1
   ("`id_agencia_certificadora` sin fuente de datos para el backfill")
   — ya no es una columna de `SOCIO_CERTIFICACIONES` que necesite
   backfill: `ORGANIZACION_CERTIFICACIONES` nace vacía completa (sin
   backfill de ningún campo), a completar manualmente por las
   organizaciones — ver sección 3.
2. **`PARCELA_CERTIFICACIONES` ya no tiene columna `estado`** — pasa de
   "estado granular" (`Certificado`/`En Transición`/`No Certificado`,
   diseño de la ronda 1) a **presencia pura**: que exista la fila
   `(id_parcela, id_certificacion)` significa que esa parcela tiene esa
   certificación, sin matiz de grado. `SOCIO_CERTIFICACIONES` sí
   conserva un campo `estado`, pero ahora `text NULL` sin `CHECK` (antes
   era exclusivo de parcela con `CHECK` fijo) — ver el uso concreto que
   se le da en la sección 3.
3. **`CERTIFICACIONES_CATALOGO` pierde `es_certificacion_externa`** —
   ya no hace falta distinguir programas externos de internos en el
   catálogo, porque el seed de esta ronda es de **8 filas, no 9**:
   `normas_internas_17` queda fuera del catálogo por completo (coherente
   con que nunca estuvo en `CERT_FLAG_FIELDS`, sección 1.3, y sigue sin
   estar en el alcance de esta normalización).

### Tipo de `id_organizacion` — confirmado en vivo, no asumido

`ORGANIZACIONES."ID"` (nombre de columna real, con mayúsculas — no
`id` en minúscula) es `text`, `PRIMARY KEY` — confirmado por
introspección OpenAPI de PostgREST (Service Role Key, 2026-08-25):
`{'description': 'Note:\nThis is a Primary Key.<pk/>', 'format': 'text', 'type': 'string'}`.
Todas las columnas `id_organizacion` de las tablas nuevas son `text`,
consistentes con este tipo real.

```sql
-- Catálogo de programas de certificación (8, mapeados 1:1 desde CERT_FLAG_FIELDS)
CERTIFICACIONES_CATALOGO
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
  codigo      text NOT NULL UNIQUE        -- ej. 'NOP_USDA', 'RAINFOREST'
  nombre      text NOT NULL               -- ej. 'NOP USDA' (label actual de CERT_FLAG_FIELDS -- ver sección 6.1, es el mismo texto que usa el header del CSV)
  activo      boolean NOT NULL DEFAULT true
  creado_en   timestamptz NOT NULL DEFAULT now()

-- Catálogo de agencias certificadoras (nuevo -- no existe hoy ninguna fuente de esto)
AGENCIAS_CERTIFICADORAS
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
  nombre      text NOT NULL
  activo      boolean NOT NULL DEFAULT true
  creado_en   timestamptz NOT NULL DEFAULT now()

-- Una organización tiene el programa habilitado, con la agencia y las fechas reales
ORGANIZACION_CERTIFICACIONES
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_organizacion           text NOT NULL REFERENCES "ORGANIZACIONES"("ID")
  id_certificacion          uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  id_agencia_certificadora  uuid REFERENCES "AGENCIAS_CERTIFICADORAS"(id)  -- nullable
  fecha_obtencion           date
  fecha_vencimiento         date
  activo                    boolean NOT NULL DEFAULT true
  creado_en                 timestamptz NOT NULL DEFAULT now()
  actualizado_en            timestamptz NOT NULL DEFAULT now()
  UNIQUE (id_organizacion, id_certificacion)
  -- Nace vacía -- sin fuente de datos para backfill, ver sección 3.

-- Un socio tiene la certificación -- id_organizacion denormalizado (NOT NULL, sin FK propia:
-- se confía en que siempre coincide con PADRON_SOCIOS.ID_Organizacion vía id_socio, mismo
-- patrón de columnas denormalizadas ya usado en PADRON_PARCELAS.socio_dni/socio_nombre_completo)
SOCIO_CERTIFICACIONES
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_socio          uuid NOT NULL REFERENCES "PADRON_SOCIOS"(id)
  id_organizacion   text NOT NULL
  id_certificacion  uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  estado            text          -- nullable, sin CHECK -- ver sección 3 para el único uso real hoy (cert_org_estatus)
  creado_en         timestamptz NOT NULL DEFAULT now()
  actualizado_en    timestamptz NOT NULL DEFAULT now()
  UNIQUE (id_socio, id_certificacion)

-- Presencia pura: la fila existe = la parcela tiene esa certificación. Nace vacía (ver 1.4).
PARCELA_CERTIFICACIONES
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  id_parcela        uuid NOT NULL REFERENCES "PADRON_PARCELAS"(id)
  id_organizacion   text NOT NULL
  id_certificacion  uuid NOT NULL REFERENCES "CERTIFICACIONES_CATALOGO"(id)
  creado_en         timestamptz NOT NULL DEFAULT now()
  actualizado_en    timestamptz NOT NULL DEFAULT now()
  UNIQUE (id_parcela, id_certificacion)
```

Habilitado por `ADR-026` (PK surrogate `id` UUID en `PADRON_SOCIOS`/
`PADRON_PARCELAS`, ya aplicada): las FKs de `SOCIO_CERTIFICACIONES`/
`PARCELA_CERTIFICACIONES` pueden apuntar a `id` (UUID) en vez de al
código legible — algo que antes de esa migración no era seguro (ver
`specs/multi_organizacion_codigos_unicos.md`: "sin FK real apuntando a
estas PK", exactamente por el riesgo de que el código dejara de ser
único). A diferencia de esa auditoría (que evitó deliberadamente agregar
FK hacia `ORGANIZACIONES` por el mismo criterio de `ADR-007`), esta
ronda **sí** agrega `REFERENCES "ORGANIZACIONES"("ID")` en
`ORGANIZACION_CERTIFICACIONES.id_organizacion` — instrucción explícita
de Neyser en el contrato de esta tarea, no una decisión tomada
unilateralmente acá.

## 3. Plan de migración de datos desde las columnas planas actuales

**Solo para la tarea de implementación futura — no se ejecuta acá.**

**Decisión cerrada (2026-08-25, instrucción explícita de Neyser): las
columnas planas actuales de `PADRON_SOCIOS`
(`cert_nop_usda`/`ue_2018_848`/`cor_canada`/`cert_ds_0442006_ag`/`cert_lpo_mx`/`cert_rainforest`/`cert_comercio_justo`/`cert_fair_trade_usa`/`cert_org_estatus`/`certificaciones`)
NO se eliminan en esta migración.** Quedan físicamente presentes, sin
uso por el código de aplicación (que pasa a leer/escribir exclusivamente
las tablas nuevas), como respaldo — un `DROP COLUMN` es irreversible sin
backup y esta migración no lo ejecuta. La limpieza física de esas
columnas queda para una tarea de limpieza aparte, más adelante,
explícitamente fuera de esta migración. **Esto simplifica un riesgo real
de la ronda 1**: como ninguna columna se elimina ni cambia de tipo,
`view_eudr_dashboard_aprobados`/`vw_monitoreo_eudr_aprobado`/`vw_socios_web`
**no necesitan recrearse en esta migración** — siguen leyendo
`PADRON_SOCIOS.certificaciones` exactamente como hoy, sin ningún cambio.
El diagnóstico en vivo de `vw_monitoreo_eudr_aprobado` (sección 1.5)
sigue siendo un paso a hacer, pero como preparación para la futura
limpieza, no como requisito de esta migración — ver
`plans/padron_certificaciones_normalizado_ejecucion.md`.

1. `CERTIFICACIONES_CATALOGO`: **8 filas seed** (no 9 — `normas_internas_17`
   queda fuera del catálogo, sección 2) — una por cada entrada de
   `CERT_FLAG_FIELDS` (`lib/validations/socios.js:92-101`). `codigo`/`nombre`
   según la tabla de la sección 7.3, `nombre` = el mismo texto que hoy
   usan los labels de `CERT_FLAG_FIELDS` (`'NOP USDA'`, `'UE 2018/848'`, etc.).
2. `AGENCIAS_CERTIFICADORAS`: sin seed — nace vacía, ninguna fuente de
   datos existente.
3. `ORGANIZACION_CERTIFICACIONES`: sin backfill — nace completamente
   vacía. No hay ninguna columna hoy en `ORGANIZACIONES` ni en
   `PADRON_SOCIOS` que indique "esta organización tiene el programa X
   habilitado con la agencia Y" a nivel de organización — es información
   nueva que el diseño introduce, a completar manualmente por cada
   organización. Con `id_agencia_certificadora` viviendo acá (sección 2,
   cambio de diseño de esta ronda), esto también reemplaza la antigua
   pregunta abierta #4 ("sin fuente de datos para el backfill de
   agencia") — ya no es un vacío en el backfill de `SOCIO_CERTIFICACIONES`,
   es simplemente una tabla que arranca vacía por diseño.
4. `SOCIO_CERTIFICACIONES` — el backfill real, instrucción literal de
   Neyser: **por cada uno de los 7 socios reales de `PADRON_SOCIOS`, por
   cada una de las 8 columnas de `CERT_FLAG_FIELDS` con valor `'Sí'` en
   ese socio, una fila nueva** — `id_socio` = el `id` UUID del socio
   (`ADR-026`), `id_organizacion` = `PADRON_SOCIOS.ID_Organizacion` del
   mismo socio (denormalizado), `id_certificacion` = la fila de
   `CERTIFICACIONES_CATALOGO` correspondiente a esa columna.

   **Regla del campo `estado` — instrucción literal, con una ambigüedad
   real que queda marcada, no resuelta a ciegas:** *"en la fila de la
   certificación Orgánica, el campo estado toma el valor de
   cert_org_estatus de ese socio"*. Ninguna de las 8 entradas de
   `CERT_FLAG_FIELDS`/`CERTIFICACIONES_CATALOGO` se llama literalmente
   `"Orgánica"` — los 8 nombres reales son `NOP USDA`, `UE 2018/848`,
   `COR Canadá`, `DS 044-2006-AG`, `LPO México`, `Rainforest Alliance`,
   `Comercio Justo`, `Fair Trade USA` (sección 7.3). La evidencia de la
   ronda 2 (sección 1.2) mostró que `cert_org_estatus = "Organico"`
   correlaciona, sin excepción en las 7 filas reales, con "al menos uno
   de los 5 flags de tipo orgánico (`cert_nop_usda`/`ue_2018_848`/`cor_canada`/`cert_ds_0442006_ag`/`cert_lpo_mx`)
   en `'Sí'`" — son 5 estándares de certificación orgánica de distintos
   mercados (EE.UU., UE, Canadá, México x2), no un único programa.
   **Interpretación aplicada en este plan, a confirmar:** el valor de
   `cert_org_estatus` del socio se copia al campo `estado` de **cada una**
   de las filas de `SOCIO_CERTIFICACIONES` que se originen en esos 5
   flags orgánicos (nunca en `Rainforest Alliance`/`Comercio Justo`/`Fair
   Trade USA`, que no tienen relación con `cert_org_estatus` en la
   evidencia real). **Esto es una interpretación, no una instrucción
   inequívoca — confirmar antes de implementar.** El resto de las filas
   de `SOCIO_CERTIFICACIONES` (los 3 flags no-orgánicos) quedan con
   `estado = NULL`.
5. `PARCELA_CERTIFICACIONES`: sin backfill — nace vacía (sección 1.4,
   sin ninguna columna origen en `PADRON_PARCELAS`).
6. `certificaciones`/`normas_internas_17`: **no se migran como dato
   autoritativo a ninguna tabla nueva.** `certificaciones` no es de fiar
   como derivable por fórmula de los flags (contraejemplo real
   confirmado en la ronda 2, sección 1.2) y no forma parte del flujo CSV
   (sección 6) — queda como columna de respaldo sin usar, junto con el
   resto (punto explícito de esta ronda, arriba). `normas_internas_17`
   sigue fuera de alcance por completo, como ya establecía la sección 1.3
   — ni se retira, ni se migra, ni entra al catálogo.

## 4. Archivos de código a actualizar — alcance real

| Archivo | Alcance del cambio |
|---|---|
| `lib/validations/socios.js` | Deja de usar `CERT_FLAG_FIELDS`, el `siNo` enum, y los campos `certificaciones`/`cert_org_estatus`/8 flags en `socioSchema`/`SOCIO_DEFAULT_VALUES` (las columnas siguen existiendo en la base — sección 3 — solo el código deja de leerlas/escribirlas). Necesita un esquema nuevo para las selecciones de certificación (probablemente un array de `id_certificacion` seleccionados, no 8 campos planos). |
| `lib/padronCsv.js` | `SOCIO_EXPORT_COLUMNS`/`SOCIO_FIELD_LABELS` dejan de incluir las 8+1 columnas planas — el export/import CSV de certificaciones pasa a columnas dinámicas contra `CERTIFICACIONES_CATALOGO`, ver sección 6.1 (nuevo diseño de esta ronda). |
| `lib/sociosSearch.js` | `SOCIO_COLUMNS`/`fetchSocios` dejan de traer las columnas planas — `filters.certFlags`/`filters.certOrgEstatus` necesitan repensarse contra las tablas nuevas (probablemente un `JOIN`/subquery contra `SOCIO_CERTIFICACIONES`). |
| `components/features/socios/SocioFormModal.jsx` | Los 8 `<select>` Sí/No se reemplazan por una UI real contra `CERTIFICACIONES_CATALOGO` (multi-select o checklist) — cambio de UI, no solo de datos. |
| `app/dashboard/socios/page.jsx` | Columna de tabla y filtros de certificación pasan a leer de las tablas nuevas. |
| `tests/test_socios_schema.mjs` | Se actualiza o se retira el test que verifica la forma de `CERT_FLAG_FIELDS` (ya no existiría). |
| `lib/gisTargetTables.js` | **Sin cambios** — solo tiene una mención en comentario, sin dependencia real (sección 1.8). |

## 5. Preguntas abiertas (sin evidencia clara — no asumidas, no resueltas en esta spec)

1. ~~**`NORMAS` (sección 1.7)**~~ — **RESUELTO (2026-08-25, decisión de
   Neyser):** `NORMAS` queda **intacta y fuera de alcance** de este paso
   de normalización. Es parte del flujo de datos de la futura app de
   Campo (inspecciones internas), no del padrón normalizado de
   certificaciones a nivel organización/socio/parcela — dominios
   distintos a propósito, no un gap a cerrar acá. No se migra, no se
   consume como fuente, no se toca su schema. El riesgo de drift entre
   `NORMAS` y `PADRON_SOCIOS`/las tablas nuevas (señalado en la sección
   1.7) queda documentado pero explícitamente aceptado, no resuelto por
   esta normalización.
2. ~~**`cert_org_estatus` no mapea 1:1** a ningún programa específico~~ —
   **RESUELTO (2026-08-25, ronda 4, instrucción de Neyser, ver sección
   3.4):** su valor se copia al campo `estado` de las filas de
   `SOCIO_CERTIFICACIONES` que se originan en la certificación
   "Orgánica". **Queda una sub-pregunta real, no resuelta**: ninguna de
   las 8 certificaciones del catálogo se llama literalmente "Orgánica"
   — la sección 3.4 documenta la interpretación aplicada (los 5 flags de
   tipo orgánico: NOP USDA/UE 2018/848/COR Canadá/DS 044-2006-AG/LPO
   México) con evidencia real de respaldo, pero sigue siendo una
   interpretación a confirmar antes de implementar, no una lectura
   inequívoca de la instrucción.
3. ~~**`certificaciones` parece derivable de los flags**~~ — **RESUELTO
   (2026-08-25, ronda 4, instrucción de Neyser):** no se migra como dato
   autoritativo — decisión explícita, no una derivación calculada en la
   UI. Coherente con el contraejemplo real encontrado en la ronda 2
   (sección 1.2: `certificaciones` no es de fiar como puramente
   derivable) y con que no forma parte del flujo CSV (sección 6). Queda
   como columna de respaldo sin usar (sección 3).
4. ~~**`id_agencia_certificadora` sin fuente de datos para el
   backfill**~~ — **RESUELTO (2026-08-25, ronda 4):** ya no es una
   pregunta de backfill — el contrato de esta ronda movió
   `id_agencia_certificadora` de `SOCIO_CERTIFICACIONES` a
   `ORGANIZACION_CERTIFICACIONES` (sección 2), que nace **completamente
   vacía** por diseño (sección 3.3), no parcialmente poblada con un
   campo en `NULL`. Sigue sin haber una fuente de datos de qué agencia
   certificó a quién — pero eso ahora es "una tabla vacía a completar
   manualmente", no un hueco en un backfill.
5. ~~**Naming de `CERTIFICACIONES_CATALOGO` vs `CAT_NORMAS.certificacion`**~~
   (sección 1.6) — **RESUELTO (2026-08-25, decisión de Neyser):**
   `CERTIFICACIONES_CATALOGO` es un catálogo **independiente**, sin
   alinear su naming con `CAT_NORMAS` — mismo criterio que la resolución
   de `NORMAS` arriba: son taxonomías de dominios distintos (padrón
   comercial vs. checklist de auditoría de Campo) y se mantienen
   deliberadamente separadas, no un caso a reconciliar.
6. **`vw_monitoreo_eudr_aprobado`** (hallazgo nuevo, sección 1.5) — no
   versionada en este repo (confirmado, cero resultados en
   `supabase/migrations/`) — antes de escribir la migración real hace
   falta el protocolo completo de diagnóstico en vivo de `ADR-024`
   (`pg_get_viewdef`/`GRANT`s exactos vía Supabase Studio SQL Editor), no
   solo leer un archivo de migración como alcanza para
   `view_eudr_dashboard_aprobados`.

## 6. Carga masiva por Excel — impacto en la normalización

### Corrección de premisa: es CSV, no Excel

El prompt de esta tarea pide auditar "la carga masiva por Excel". **No
existe ningún flujo de importación `.xlsx`/Excel real en este repo** —
confirmado con evidencia negativa explícita, no solo "no until now": sin
`SheetJS`/`ExcelJS`/`xlsx` en `package.json` (grep, cero resultados), y
el único componente de importación masiva
(`components/features/socios/ImportPadronModal.jsx:154-156`) tiene
`<input type="file" accept=".csv" .../>` — el selector de archivos del
navegador literalmente no ofrece `.xlsx` como opción. Las únicas
menciones de "Excel" en todo el código (`lib/padronCsv.js:219`,
`lib/padronCsv.js:533`) son sobre **compatibilidad de lectura**: el
parser CSV casero soporta el mismo formato que Excel produce/abre, y se
antepone un BOM UTF-8 al exportar para que Excel muestre tildes/ñ
correctamente al abrir el `.csv`. El flujo real es **CSV**, con un
parser propio sin librería externa. El resto de esta sección audita el
flujo real (CSV) — la sustancia de lo pedido (entender el importador
antes de tocar certificaciones) sigue aplicando igual.

### Archivos del flujo

- **`lib/padronCsv.js`** — toda la lógica pura: construcción de CSV
  (`arrayToCsv`/`buildSociosCsv`), plantilla (`buildSocioTemplateCsv`),
  parser (`parseCsv`), normalización de encabezados
  (`normalizeRowKeys`/`SOCIO_REVERSE_LABELS`), y validación de vista
  previa (`validateSocioRows`/`applySocioDbChecks`) — sin escribir nada,
  ver más abajo.
- **`components/features/socios/ImportPadronModal.jsx`** — el modal
  `'use client'`: lee el archivo, llama a `validateSocioRows`, muestra la
  tabla de válidas/inválidas, y en `handleConfirmImport` (línea 79-109)
  ejecuta la escritura real fila por fila.
- **`app/dashboard/socios/page.jsx`** — renderiza el modal (botón "⬆
  Cargar Padrón Masivo (CSV)", línea 180; `<ImportPadronModal
  organizationId={organizationId} .../>`, línea 397-406) — el mismo
  `organizationId` derivado por `resolveActiveOrganizationId(rows)` que
  ya se corrigió en el hotfix de `fetchSocios` (commit `9779717`): desde
  ese fix, `rows` viene siempre de una sola organización real, así que
  este valor ya no es una heurística sobre datos mezclados.

### Formato de columnas esperado — confirma exactamente lo que la migración de certificaciones necesita saber

`SOCIO_TEMPLATE_COLUMNS`/`SOCIO_EXPORT_COLUMNS` (`lib/padronCsv.js:10-26,108`)
incluyen `cert_org_estatus` + **las 8 columnas de `CERT_FLAG_FIELDS`
como columnas separadas, una por certificación** — exactamente la forma
que el prompt sospechaba. Ejemplo real de la plantilla
(`SOCIO_TEMPLATE_EXAMPLE`, líneas 111-133):

```js
cert_org_estatus: 'Organico',
cert_nop_usda: 'Sí',
ue_2018_848: 'No',
cor_canada: 'No',
cert_ds_0442006_ag: 'No',
cert_lpo_mx: 'No',
cert_rainforest: 'No',
cert_comercio_justo: 'No',
cert_fair_trade_usa: 'No',
```

**Hallazgo no solicitado, relevante:** `certificaciones` (el campo de
texto libre, sección 1.2) **no forma parte del flujo CSV en absoluto** —
no está en `SOCIO_EXPORT_COLUMNS`, no se exporta, no se importa, no tiene
columna en la plantilla. Es exclusivo del formulario manual
(`SocioFormModal.jsx`). Esto simplifica una parte del diseño: lo que se
decida sobre `certificaciones` (pregunta abierta #3) no tiene ningún
impacto en el importador CSV, sea cual sea la decisión.

### Validación — mismo Zod que el formulario manual, no una ruta paralela más laxa

`validateSocioRows` (`lib/padronCsv.js:482-503`) corre `socioSchema.safeParse(row)`
— **el mismo schema Zod que usa el alta manual** (`SocioFormModal.jsx`),
no una validación distinta o más permisiva para la carga masiva. Esto
significa que las 8 columnas de certificación en el CSV están sujetas
hoy al mismo `siNo = z.enum(['Sí', 'No']).optional().nullable().or(z.literal(''))`
(sección 1.1) — un CSV con `"Yes"`/`"true"`/`"1"` en esas columnas
falla la validación de la misma forma que fallaría el formulario.
Después de Zod corren 2 capas más, todas de solo lectura (vista previa,
sin escribir): duplicados internos del archivo
(`applyDuplicateChecks`) y duplicados contra la base real, ya scopeados
por organización (`applySocioDbChecks`, línea 358-405).

### Escritura real — fila por fila, vía la misma Server Action que el alta manual, nunca un bulk insert

Confirmado en `ImportPadronModal.jsx:79-109` (`handleConfirmImport`):
recorre `validRows` con un `for` y llama `await createSocio(row.data, organizationId)`
**una vez por fila** — la misma función exportada de
`lib/actions/sociosActions.js` que usa el formulario individual "+ Nuevo
Socio". No hay ningún `.insert([...])` en lote ni ningún `.upsert()`
(coherente con lo ya confirmado en `specs/multi_organizacion_codigos_unicos.md`:
cero `.upsert()` en todo el repo). Cada llamada a `createSocio` vuelve a
correr sus propias validaciones internas (`assertDniNotDuplicated`,
`assertCodigoFincaNotDuplicated`) como defensa en profundidad —
redundante con la vista previa, pero real — y hace el `INSERT` real con
`socioPayload(parsed)`, que hoy escribe los 8 flags + `cert_org_estatus`
como columnas planas directas.

### Sin plantilla de Excel/CSV documentada como archivo estático

No existe ningún archivo de ejemplo (`.csv`/`.xlsx`) versionado en
`specs/`/`docs/` ni en ningún otro lugar del repo — la "plantilla" que
las organizaciones usan es **generada dinámicamente** por
`downloadSocioTemplate`/`buildSocioTemplateCsv` en el momento de hacer
clic en "⬇ Descargar Plantilla de Socios (.csv)" dentro del propio modal,
con un `ID_Socio` de ejemplo libre calculado contra la organización
activa (no hay un `Plantilla_Socios.csv` fijo commiteado que revisar).

### Quién ejecuta la carga hoy

Cualquier usuario con acceso a `/dashboard/socios` — **sin ningún gate
de rol visible en el código**, coherente con el resto de la aplicación
(`CLAUDE.md`: sin sesión de Supabase Auth, solo `anon` key). No es un
script manual ni un proceso aparte — es un flujo 100% desde la UI del
dashboard, botón "⬆ Cargar Padrón Masivo (CSV)".

### Impacto directo en la normalización de certificaciones — qué rompe si se retiran las columnas tal cual

1. **La plantilla/export/import CSV pierde las 8 columnas planas fijas
   de `CERT_FLAG_FIELDS`** (`cert_org_estatus` queda como columna de
   respaldo sin uso, sección 3 — no forma parte de este cambio). Diseño
   cerrado en la sección 6.1, no una pregunta abierta.
2. **`socioPayload(parsed)` (`lib/actions/sociosActions.js`) ya no puede
   escribir esas columnas directas** — `createSocio`, llamada tanto por
   el alta manual como por `handleConfirmImport` acá, necesita además
   crear las filas correspondientes de `SOCIO_CERTIFICACIONES` por cada
   certificación seleccionada, en la misma transacción lógica (hoy es un
   solo `INSERT`; pasa a ser 1 + N `INSERT`s). Como `createSocio` es
   **compartida** entre el formulario individual y el importador, este
   cambio beneficia a ambos flujos a la vez sin duplicar lógica — pero
   también significa que cualquier bug en esa función ahora afecta las 2
   superficies simultáneamente.
3. **`certificaciones` no afecta al importador** (confirmado arriba) —
   decidido que no se migra como dato autoritativo (sección 3), pero eso
   es irrelevante para este flujo de cualquier forma, porque nunca formó
   parte de él.
4. **La validación Zod compartida es una ventaja, no solo un riesgo** —
   al ser el mismo `socioSchema` para ambas superficies, el nuevo
   contrato de certificaciones solo se define una vez.

### 6.1 Diseño cerrado — columnas dinámicas contra `CERTIFICACIONES_CATALOGO`

**Decisión de esta ronda (2026-08-25), instrucción explícita de Neyser:**

- **Exportación/plantilla:** la plantilla deja de tener columnas fijas —
  al generarla (`downloadSocioTemplate`/`buildSocioTemplateCsv`) o al
  exportar (`exportSociosCsv`), se agrega **una columna por cada fila de
  `CERTIFICACIONES_CATALOGO` con `activo = true`**, en vez de las 8
  columnas hardcodeadas de hoy.
- **¿Encabezado = `codigo` o `nombre`?** Confirmado por evidencia real
  (sección 6, "Formato de columnas esperado"): `arrayToCsv`
  (`lib/padronCsv.js:88-92`) arma el encabezado con
  `labels?.[col] || col` — hoy los encabezados exportados son el
  **label humano** (`"NOP USDA"`, `"Rainforest Alliance"`, etc.), nunca
  el nombre técnico de columna (`cert_nop_usda`). El diseño nuevo
  mantiene esa misma convención: **el encabezado dinámico usa
  `CERTIFICACIONES_CATALOGO.nombre`** (no `codigo`), para no romper la
  expectativa visual ya establecida en las plantillas actuales.
- **Importación — columna no reconocida = error explícito, nunca
  ignorada:** al normalizar los encabezados del CSV subido
  (`normalizeRowKeys`, hoy vía `SOCIO_REVERSE_LABELS`), cualquier columna
  que no matchee (case-insensitive, mismo criterio que
  `buildReverseLabelMap` ya usa hoy) el `nombre` de una certificación con
  `activo = true` en `CERTIFICACIONES_CATALOGO`, ni ninguna de las
  columnas técnicas fijas restantes (`ID_Socio`, `socio_dni`, etc.), debe
  **rechazar el archivo entero con un mensaje explícito citando el
  nombre exacto de la columna no reconocida** — comportamiento nuevo:
  hoy (`normalizeRowKeys`, línea 298-305) una columna sin match se deja
  pasar tal cual sin error, confiando en que Zod la ignore por no ser un
  campo conocido del schema; con columnas dinámicas ese silencio ya no es
  aceptable (un nombre de certificación mal tipeado o una certificación
  desactivada no debe perderse en silencio — el usuario tiene que
  enterarse antes de confirmar la importación, mismo espíritu que ya
  aplican `applySocioDbChecks`/`applyDuplicateChecks` para otros errores).
- **Valor de celda:** no definido en esta ronda si se mantiene el mismo
  contrato `'Sí'`/`'No'`/vacío por celda (una columna por certificación,
  presencia/ausencia como hoy) o si cambia de forma — el contrato de
  datos de la sección 2 no impone un formato de celda particular, queda
  para la tarea de implementación decidirlo contra el diseño real de
  `SOCIO_CERTIFICACIONES`/`socioSchema` nuevo.

## 7. RLS y GRANTs a replicar en las tablas nuevas

### Metodología y una limitación real, confirmada de nuevo empíricamente

Mismo límite de siempre: sin conexión Postgres directa desde este
entorno. Antes de asumirlo, se probó en vivo si `information_schema.role_table_grants`
o `pg_policies` están expuestas por PostgREST (mismo mecanismo que
serviría si lo estuvieran, sin necesitar SQL crudo):

```
GET /rest/v1/role_table_grants?select=*&table_name=eq.PADRON_SOCIOS  -> HTTP 404, PGRST205
GET /rest/v1/pg_policies?select=*&tablename=eq.PADRON_SOCIOS         -> HTTP 404, PGRST205
```

Ninguna de las dos existe en el schema cache de PostgREST — como se
esperaba (PostgREST solo sirve objetos del schema configurado,
`public`, nunca `information_schema`/`pg_catalog`). El texto de las
políticas RLS de abajo viene de leer completo el historial de
migraciones de este repo (fuente primaria real — es el SQL que
efectivamente se aplicó, no una re-serialización); el texto exacto de
los `GRANT` **no se pudo obtener** por esta vía — ver el apartado
correspondiente más abajo.

### 7.1 Políticas RLS activas hoy — texto exacto, con el historial completo de qué reemplazó a qué

Confirmado con `grep` exhaustivo sobre las 21 migraciones que tocan
`PADRON_SOCIOS`/`PADRON_PARCELAS` (no solo las 3 ya citadas en secciones
anteriores) — **ninguna migración posterior a `20260818_fix_inspecciones_rls.sql`
vuelve a tocar sus políticas**, así que ese es el estado final vigente.
Historial completo, por si hace falta entender el porqué de un nombre:

| Migración | Qué hizo |
|---|---|
| `20260815_fase1_security_storage.sql` | Crea `ryzos_all_padron_socios`/`ryzos_all_padron_parcelas` (primera versión) |
| `20260815_fix_rls_policies.sql` | `DROP` + recrea las mismas 2 (mismo nombre, fix de la expresión) |
| `20260816_fase3_seguridad_rls.sql` | `DROP` de `ryzos_all_padron_socios`/`ryzos_all_padron_parcelas` — reemplazadas por `rls_select_padron_socios`/`rls_write_padron_socios`/`rls_select_padron_parcelas`/`rls_write_padron_parcelas` |
| `20260818_fix_inspecciones_rls.sql` | Agrega (sin tocar las 4 anteriores) `rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas` |

**Las 6 políticas activas hoy, texto exacto** (`ALTER TABLE ...
ENABLE ROW LEVEL SECURITY` ya está activo en ambas tablas desde la
primera migración, confirmado idempotente en las 3 posteriores):

```sql
-- supabase/migrations/20260816_fase3_seguridad_rls.sql
CREATE POLICY "rls_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_padron_socios" ON public."PADRON_SOCIOS"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_padron_parcelas" ON public."PADRON_PARCELAS"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- supabase/migrations/20260818_fix_inspecciones_rls.sql
CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);
```

**Resumen del patrón real** (el que la app usa hoy para leer/escribir
con solo la `anon` key, sin sesión — `CLAUDE.md`, "RLS gotcha"):

- `authenticated` tiene `SELECT`/`ALL` reales, scopeados por
  `auth_org_id()` (claim JWT) — **código muerto para el tráfico real**
  (la app nunca autentica, confirmado ya en `ADR-025`).
- `anon` tiene **solo `SELECT`**, scopeado únicamente por
  `"ID_Organizacion" IS NOT NULL` (no hay JWT que comparar) — esta es la
  política que **sí** gatea el tráfico real de lectura.
- **No existe ninguna política de escritura para `anon`** en ninguna de
  las dos tablas — coherente con `CLAUDE.md`/`specs/padron_web_socios.md`:
  las escrituras van exclusivamente por Server Actions con Service Role
  Key (`lib/actions/sociosActions.js`), que bypasea RLS por completo
  (`auth.role() = 'service_role'` en las policies de `authenticated`
  arriba es además redundante con el propio comportamiento de Supabase,
  que ya da `bypassrls` al rol `service_role` a nivel de Postgres —
  cinturón y tirantes, no el único mecanismo).

### 7.2 GRANTs — sin GRANT explícito versionado, script de diagnóstico preparado

**Grep exhaustivo sobre las 21 migraciones que mencionan
`PADRON_SOCIOS`/`PADRON_PARCELAS`: cero resultados de `GRANT`** para
ninguna de las dos tablas — a diferencia de las vistas (`vw_monitoreo_web`,
`view_eudr_dashboard_aprobados`, etc.), que sí tienen `GRANT SELECT ...
TO authenticated;` explícito en cada redefinición, **ninguna migración de
este repo le otorga privilegios explícitos a `anon`/`authenticated`/
`service_role`** sobre las tablas base del padrón.

Esto es coherente con un hallazgo ya confirmado en `ADR-024`: Supabase
otorga privilegios por defecto a nivel de esquema a `anon`/`authenticated`/
`service_role` cuando se provisiona un proyecto — privilegios que este
repo nunca declara ni necesita declarar explícitamente para que `anon`
pueda, por ejemplo, leer `PADRON_SOCIOS` (sujeto igual a las políticas
RLS de la sección 7.1, que sí son las que realmente acotan qué filas se
ven). **No se puede confirmar el texto exacto de esos GRANTs por defecto
desde este entorno** — no hay conexión Postgres directa, y
`information_schema.role_table_grants` no está expuesta por PostgREST
(sección 7, arriba).

**Script de solo lectura preparado, mismo protocolo que destrabó
`vw_parcelas_web` en `ADR-024`** — si hace falta el texto exacto antes de
escribir la migración de las tablas nuevas, correr en Supabase Studio SQL
Editor y devolver el resultado:

```sql
SELECT table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('PADRON_SOCIOS', 'PADRON_PARCELAS')
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;
```

### 7.3 Mapeo `CERT_FLAG_FIELDS` → certificación — citado tal cual del código, no transcrito de memoria

**Corrección de referencia:** el texto de la sección 1.8 (auditoría de
uso de `CERT_FLAG_FIELDS` en código) y el comentario de la sección 2
apuntaban a "la tabla de la sección 1.8" para este mapeo — **esa tabla
nunca existió como tal en ninguna sección anterior**, solo se citaban 2-3
ejemplos sueltos. Corregido acá con la cita completa, literal, de
`lib/validations/socios.js:92-101` (re-leído fresco para esta tarea, sin
cambios desde la última vez que se citó en esta spec):

| `field` (columna real en `PADRON_SOCIOS`, hoy) | `label` (texto exacto — usar como `CERTIFICACIONES_CATALOGO.nombre`) |
|---|---|
| `cert_nop_usda` | `NOP USDA` |
| `ue_2018_848` | `UE 2018/848` |
| `cor_canada` | `COR Canadá` |
| `cert_ds_0442006_ag` | `DS 044-2006-AG` |
| `cert_lpo_mx` | `LPO México` |
| `cert_rainforest` | `Rainforest Alliance` |
| `cert_comercio_justo` | `Comercio Justo` |
| `cert_fair_trade_usa` | `Fair Trade USA` |

`codigo` (`CERTIFICACIONES_CATALOGO.codigo`, sección 2) no tiene una
fuente literal en el código existente — es un identificador nuevo que
esta normalización introduce, no algo que copiar de `CERT_FLAG_FIELDS`.
Sugerencia consistente con el resto del catálogo (`snake_case`
mayúsculas, mismo estilo que otras constantes técnicas del repo, no
cerrado como decisión — a confirmar en la tarea de implementación):
`NOP_USDA`, `UE_2018_848`, `COR_CANADA`, `DS_0442006_AG`, `LPO_MX`,
`RAINFOREST`, `COMERCIO_JUSTO`, `FAIR_TRADE_USA`.

### 7.4 Cómo se traduciría este patrón a las 5 tablas nuevas — descriptivo, no la migración en sí

Sin escribir SQL (fuera de alcance de esta tarea), el patrón real de la
sección 7.1 sugiere una división natural entre las 5 tablas nuevas:

- **`CERTIFICACIONES_CATALOGO`** — catálogo puro, sin dato de
  organización/socio/parcela. Candidato natural a `SELECT` abierto para
  `anon`/`authenticated` (necesario para que el formulario/CSV puedan
  listar las certificaciones activas sin pasar por Server Action), sin
  el condicionamiento por `ID_Organizacion` que sí aplica al resto — sea
  cual sea la política final, no tiene un equivalente directo en el
  patrón de `PADRON_SOCIOS`/`PADRON_PARCELAS`.
- **`AGENCIAS_CERTIFICADORAS`** — mismo caso que el catálogo: sin
  organización propia, candidato a lectura abierta.
- **`ORGANIZACION_CERTIFICACIONES`/`SOCIO_CERTIFICACIONES`/`PARCELA_CERTIFICACIONES`**
  — estas sí tienen `id_organizacion` (sección 2) y son el equivalente
  directo de `PADRON_SOCIOS`/`PADRON_PARCELAS` para efectos de RLS: el
  patrón a replicar es exactamente el de la sección 7.1 — `SELECT` para
  `anon` scopeado por `"id_organizacion" IS NOT NULL` (o, si se prefiere
  cerrar el hueco que esa condición deja abierto — cualquier fila con
  organización no nula es visible para cualquier `anon`, sin importar
  cuál — usar una condición más estricta, decisión a tomar en la tarea
  de implementación, no heredada ciegamente del patrón viejo solo por
  precedente), sin política de escritura para `anon` (las escrituras
  siguen por Server Action con Service Role Key, igual que hoy).

## 8. Estado de implementación (paso 3, 2026-08-25)

Ver `docs/adr/ADR-027-certificaciones-normalizadas.md` para el detalle
completo y el rationale de cada decisión. Resumen de lo entregado:

- **Migración** —
  `supabase/migrations/20260825222933_certificaciones_normalizadas.sql`:
  las 5 tablas del contrato de la sección 2 tal cual, RLS replicando
  exactamente el patrón de la sección 7.1/7.4, GRANTs de la sección 7.2
  (con una excepción documentada en el propio archivo: `SOCIO_CERTIFICACIONES`
  recibe además `GRANT DELETE` para `service_role`, necesario para que
  `updateSocio` pueda quitar una certificación destildada — la tabla no
  tiene columna de baja lógica), seed de las 8 filas de la sección 7.3, y
  el backfill de los socios reales con el criterio de "Orgánica" de la
  sección 3.4, con guarda de idempotencia por socio.
- **`createSocio`/`updateSocio`** (`lib/actions/sociosActions.js`) — ya
  no escriben las 8 columnas planas ni `cert_org_estatus`/`certificaciones`
  (quedan congeladas en su valor actual, como respaldo, según la
  decisión de la ronda 4). El payload del formulario (sin cambios de
  forma — `socioSchema`/`SocioFormModal.jsx` no se tocaron) se traduce a
  filas de `SOCIO_CERTIFICACIONES` vía `syncSocioCertificaciones`
  (estrategia borrar-todo + reinsertar, por socio, en cada guardado).
- **CSV** (`lib/padronCsv.js`) — export/plantilla generan una columna
  dinámica por cada fila `activo = true` de `CERTIFICACIONES_CATALOGO`,
  con `nombre` como encabezado (diseño cerrado en la sección 6.1). La
  importación valida esas columnas contra el catálogo activo por
  `nombre` y **rechaza el archivo completo** (no fila por fila) si
  encuentra una columna no reconocida — nunca la ignora en silencio.
- **Tests** — `tests/test_certificaciones_normalizadas.py`
  (`TestMigrationFileStatic`: estructura de la migración, siempre corre;
  `TestCertificacionesNormalizadasLive`: efecto real de la migración
  sobre los 7 socios, aislamiento multi-tenant, columnas viejas
  intactas — auto-skip hasta que la migración se aplique en Supabase
  Studio), `tests/test_certificaciones_sociosactions_code_sites.mjs`
  (guardas estructurales sobre `sociosActions.js`, mismo patrón que
  `test_pk_surrogate_code_sites.mjs` — no es importable en Node plano
  fuera del pipeline de Next.js por el alias `@/lib/...`, así que no hay
  test de comportamiento real para esta parte), y los nuevos casos de
  columnas dinámicas/rechazo de columna no reconocida agregados a
  `tests/test_padron_csv.mjs`.

### 8.1 Pendiente, diferido a propósito — capa de display al usuario final

`lib/sociosSearch.js`, `app/dashboard/socios/page.jsx` y
`components/features/socios/SocioFormModal.jsx` siguen leyendo/
mostrando las 8 columnas planas de `PADRON_SOCIOS` (la tabla del padrón,
sus filtros, y los 8 `<select>` Sí/No del formulario). Como
`createSocio`/`updateSocio` ya NO escriben esas columnas, cualquier
socio creado o editado a partir de esta migración queda con esas
columnas **congeladas en su valor previo** — el dato que el usuario ve
en la tabla/formulario para las certificaciones de un socio editado
después de este cambio puede quedar desactualizado respecto de lo que
en verdad tiene en `SOCIO_CERTIFICACIONES`.

No se resolvió en esta tarea por decisión explícita (alcance grande/
ambiguo: implica decidir si el formulario pasa a leer/escribir contra
`SOCIO_CERTIFICACIONES` directamente, y qué hace la tabla/filtros de
`sociosSearch.js` con una relación en vez de columnas planas — más una
tarea de rediseño de UI que una extensión mecánica). No rompe la
aplicación mientras tanto: las columnas viejas siguen físicamente
presentes con su último valor válido. Queda como tarea de una iteración
futura.
