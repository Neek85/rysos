# ADR-010 — Vínculo real entre EUDR_USO_SUELO y su EUDR_MONITOREO padre (Fase B0)

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Migración:** `supabase/migrations/20260823_145038_qfield_relation_id_monitoreo.sql`
  (aplicada por el usuario en Supabase Studio)
- **Código:** `scripts/etl_drive_to_supabase.py::build_monitoreo_payload`
- **Tests:** `tests/test_vinculo_uso_suelo_monitoreo.mjs`,
  `tests/test_etl_drive.py` (2 tests nuevos)

## El problema

ADR-005 (Fase A) resolvió el falso positivo de "solapamiento" entre una
subdivisión de `EUDR_USO_SUELO` y el perímetro de `EUDR_MONITOREO` de su
propia parcela usando un **heurístico espacial temporal**: "misma
parcela" = el único perímetro aprobado que contiene ≥98% del área de la
subdivisión. Ese ADR documentó explícitamente que era una solución
provisoria, porque no existía ningún campo real que vinculara ambas
tablas — y que antes de avanzar a una Fase B que sí pudiera bloquear
aprobaciones automáticamente, hacía falta resolver el vínculo de verdad.

**La causa raíz, confirmada en el código real antes de tocar nada**
(`scripts/etl_drive_to_supabase.py::build_monitoreo_payload`, tal como
documentaba ADR-005): el GeoPackage que sube cada técnico trae su propia
capa `EUDR_MONITOREO` con una columna `id_monitoreo` — el GUID interno
que QField genera para relacionar ese perímetro con sus subdivisiones
hijas (`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` preservan ese mismo GUID tal
cual en su columna `id_parcela`). Pero `build_monitoreo_payload` nunca
leía ese campo:

```python
# INVARIANTE: id_monitoreo se deriva de forma deterministica de la clave natural
# (organizacion + parcela + fecha) para que un upsert repetido actualice SIEMPRE
# el mismo registro. Si no hay parcela resuelta, se usa el fid del GeoPackage
# como respaldo; solo si tampoco hay fid se genera un uuid4 aleatorio.
if id_parcela_fija is not None:
    id_monitoreo = self.compute_deterministic_id(
        MONITOREO_TABLE, org_id, id_parcela_fija, fecha_monitoreo
    )
elif fid is not None:
    id_monitoreo = self.compute_deterministic_id(MONITOREO_TABLE, org_id, "fid", fid)
else:
    id_monitoreo = record_id or str(uuid.uuid4())
```

`id_monitoreo` (la PK real de la tabla) se recalcula de forma
determinística para poder hacer upsert idempotente — nunca es el mismo
valor que el GUID original. El GUID crudo estaba disponible en `row`
(la fila del GeoPackage, con todas sus columnas originales) pero
`build_monitoreo_payload` jamás lo leía ni lo guardaba en ningún lado —
se perdía en cada ingesta.

## La solución

### 1. Columna nueva, sin FK

`qfield_relation_id text` en `EUDR_MONITOREO`, con índice para el join
pero **deliberadamente sin FK** — es un identificador externo generado
por QField, no una PK de ninguna tabla local; el ETL no debe poder
fallar por una referencia que no le corresponde validar.

### 2. El ETL preserva el GUID desde ahora en adelante

`build_monitoreo_payload` ahora agrega al payload:

```python
"qfield_relation_id": row.get("id_monitoreo"),
```

Sin tocar el cálculo existente del `id_monitoreo` real (la PK sigue
siendo el mismo valor determinístico de siempre — este cambio es
puramente aditivo). A partir de la próxima ingesta,
`EUDR_MONITOREO.qfield_relation_id = EUDR_USO_SUELO.id_parcela` es un
**join real y exacto**, sin heurísticos de por medio.

### 3. Backfill de lo ya ingerido

**Corrección de premisa, verificada antes de calcular nada:** la tarea
asumía que había que hacer backfill de "los paquetes del 16 y 20 de
agosto, y el de hoy bajo ORG-TEST-E2E", como si fueran 3 conjuntos de
datos independientes. Verificado en vivo: **hoy solo existen 3 filas en
`EUDR_MONITOREO` y 3 en `EUDR_USO_SUELO`, todas de un único origen** — la
reingesta de un único paquete (`data1.zip`) hecha en una tarea anterior
de esta misma sesión. Los paquetes del 16 y 20 de agosto casi con
certeza fueron los que produjeron los 14 registros huérfanos
(`"ORG-COOP-NORTE"`) que **ya se habían borrado** en ADR-007 (commit
`2391859`, con conteos verificados en 0 antes de ese push) — no quedaba
nada de esos dos paquetes en la base para hacer backfill. Se corrige acá
para que el registro quede exacto.

**Cálculo real** (mismo criterio que Fase A: ≥98% de contención,
ambigüedad = 0 o >1 candidatos), hecho con Python/`shapely` sobre las
geometrías reales traídas vía REST (sin necesidad de tocar la base para
calcularlo):

| `EUDR_USO_SUELO.id` | `id_parcela` (GUID crudo) | Candidato ≥98% | % contención |
|---|---|---|---|
| 18 | `{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}` | `b2f305a0-...` (COOP-JS-001) | 100.0% |
| 19 | `{29ba74a4-685f-405c-82e0-fb22777b7679}` | `10425cbd-...` (COOP-JS-003) | 100.0% |
| 20 | `{29ba74a4-685f-405c-82e0-fb22777b7679}` | `10425cbd-...` (COOP-JS-003) | 99.64% |

Agrupado por `EUDR_MONITOREO` (la tabla que recibe el backfill):

| Monitoreo | Resultado | Motivo |
|---|---|---|
| `b2f305a0-...` (COOP-JS-001) | **Vinculado** → `{4166dc2a-...}` | 1 subdivisión hija, sin ambigüedad |
| `10425cbd-...` (COOP-JS-003) | **Vinculado** → `{29ba74a4-...}` | 2 subdivisiones hijas, ambas coinciden en el mismo GUID |
| `b12677bd-...` (COOP-JS-004) | **Sin datos suficientes** | Ninguna subdivisión de Uso de Suelo lo contiene ≥98% — no es ambigüedad, es ausencia de datos de subdivisión para esa parcela |

**Resultado final del backfill: 2 de 3 registros de `EUDR_MONITOREO`
vinculados sin ambigüedad, 1 sin resolver por falta de datos (no por
conflicto), 0 casos ambiguos.** Reportado al usuario antes de escribir
nada (mismo criterio que cualquier escritura sobre datos ya existentes
en esta sesión); el usuario confirmó los 2 valores exactos antes de la
escritura.

### 4. Verificación en vivo del join real

Tras aplicar la migración y escribir los 2 valores, se confirmó el join
con una consulta REST directa — filtrando `EUDR_USO_SUELO` por el valor
exacto de `qfield_relation_id` de cada `EUDR_MONITOREO`, en vez de solo
comparar dos listas por separado:

```
GET .../EUDR_USO_SUELO?id_parcela=eq.{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}
  -> [{"id":18, "tipo_uso":"Produccion", ...}]                      (coincide con COOP-JS-001)

GET .../EUDR_USO_SUELO?id_parcela=eq.{29ba74a4-685f-405c-82e0-fb22777b7679}
  -> [{"id":19,...}, {"id":20,...}]                                  (coincide con COOP-JS-003, ambas)
```

Coincide exactamente con lo calculado antes del backfill — el join real
funciona.

## Fuera de alcance de esta tarea (a propósito)

- **El cálculo de cobertura de Fase B en sí** (que sumaría áreas y
  podría bloquear una aprobación automáticamente) — esta tarea es
  únicamente el vínculo de datos, no la lógica de negocio que lo
  consumirá.
- **`EUDR_INSTALACIONES`**, que tiene el mismo patrón de `id_parcela`
  (GUID de QField) pero nunca participó del heurístico de solapamiento
  de ADR-005 (es siempre puntual, sin topología de área) — no se tocó
  acá tampoco, por consistencia con ese alcance.
- **Migrar el heurístico espacial de ADR-005 al join real** — la función
  `fn_validar_topologia_eudr` sigue usando el heurístico de contención
  ≥98% sin cambios en esta tarea; reemplazarlo por el join real es una
  tarea de seguimiento explícita, no incluida acá.
