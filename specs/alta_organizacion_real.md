# Spec — Runbook: alta de una organización real en `ORGANIZACIONES`

## Contexto

Con la limpieza de datos de prueba (`ORGANIZACIONES` y las tablas
operativas relacionadas vaciadas, catálogos `PRODUCTOS`/
`CERTIFICACIONES_CATALOGO` preservados) y el alta de la primera
organización real del sistema en producción, `COOP-AROMAS-VALLE`, este
documento fija el procedimiento como un runbook repetible — para que la
2da, 3ra, etc. organización real no dependan de reconstruir los pasos de
memoria.

**No es una tarea de ejecución autónoma.** Cada alta real crea filas de
producción reales (razón social, RUC, representante legal) — se aplica
manualmente en Supabase Studio SQL Editor, nunca corrido sin supervisión
directa de quien opera el proyecto.

Ver `docs/adr/ADR-030-convencion-codigo-organizaciones.md` para la
convención de código `TIPO-SLUG` usada en el paso 1 de prerrequisitos.

## Objetivo

Dado los datos de una organización real ya recolectados, dejar 2 filas
reales insertadas de forma consistente: una en `ORGANIZACIONES`, una (o
más, si maneja más de un producto) en `ORGANIZACION_PRODUCTOS` — sin
duplicar códigos existentes, sin inventar `uuid` de `PRODUCTOS` de una
sesión anterior sin re-confirmarlos, y verificable después de aplicar.

## Prerrequisitos — recolectar antes de empezar

- Nombre completo / razón social (`Nombre_Organizacion`).
- RUC (`RUC`).
- Dirección fiscal completa (`Direccion_Fiscal`).
- Representante legal: tipo y número de documento, nombre completo,
  cargo, fecha desde la que ejerce ese cargo (`Representante_Legal` es
  un solo campo de texto libre — no hay columnas separadas para cada
  dato; se compone todo en una sola cadena legible, ver el ejemplo real
  abajo).
- Producto(s) que maneja la organización, por su código real de
  `PRODUCTOS` (`CAFE`/`CACAO` hoy — ver ADR-028; ninguna organización
  está limitada a uno solo, `ORGANIZACION_PRODUCTOS` es N-a-N).
- Código `TIPO-SLUG` propuesto, según `ADR-030`.

## Paso 1 — Verificar que el código propuesto no exista ya

```sql
SELECT * FROM "ORGANIZACIONES" WHERE "ID" = '<codigo-propuesto>';
```

Si devuelve una fila, el código ya está en uso — elegir otro slug (o, si
es la misma organización que ya se dio de alta, no continuar con este
runbook). `"ID"` es la Primary Key de texto — no hay `default` que la
genere sola, así que este chequeo es responsabilidad de quien aplica la
migración, no de la base.

## Paso 2 — Confirmar el/los `id` (uuid) reales de `PRODUCTOS`

```sql
SELECT id, codigo FROM "PRODUCTOS" WHERE codigo IN ('CAFE', 'CACAO');
```

**Nunca hardcodear un `uuid` de una sesión anterior sin re-confirmarlo
acá** — aunque `PRODUCTOS` es un catálogo estable (no debería
regenerarse), confirmar en el momento evita un error silencioso si
alguna vez se resiembra la tabla con `gen_random_uuid()` nuevos.

## Paso 3 — El INSERT completo

Envuelto en una sola transacción — si el `INSERT` en
`ORGANIZACION_PRODUCTOS` falla (por ejemplo, un `codigo` de producto que
no existe), el de `ORGANIZACIONES` tampoco debe quedar aplicado a medias.

```sql
BEGIN;

INSERT INTO "ORGANIZACIONES" (
    "ID",
    "Nombre_Organizacion",
    "RUC",
    "Direccion_Fiscal",
    "Representante_Legal",
    "es_organizacion_prueba"
) VALUES (
    '<codigo-propuesto>',              -- ej. 'COOP-AROMAS-VALLE'
    '<razón social completa>',         -- ej. 'COOPERATIVA AGRARIA AROMAS DEL VALLE'
    '<RUC>',                           -- ej. '20607450677'
    '<dirección fiscal completa>',
    '<representante legal, texto libre: tipo+nro doc, nombre, cargo, desde>',
    false                               -- SIEMPRE false para una organización real
);

-- Uno por cada producto que maneje la organización (repetir el bloque
-- INSERT con distinto id_producto si maneja más de uno).
INSERT INTO "ORGANIZACION_PRODUCTOS" (
    id_organizacion,
    id_producto,
    activo
) VALUES (
    '<mismo codigo-propuesto de arriba>',
    '<uuid confirmado en el paso 2>',   -- ej. el id real de CAFE
    true
);

COMMIT;
```

**Referencia real** (el `INSERT` ya aplicado para `COOP-AROMAS-VALLE`,
confirmado consultando la instancia real, no reconstruido de memoria —
`Representante_Legal` muestra el formato de texto libre esperado para
ese campo):

```
ORGANIZACIONES."ID"                   = 'COOP-AROMAS-VALLE'
ORGANIZACIONES."Nombre_Organizacion"  = 'COOPERATIVA AGRARIA AROMAS DEL VALLE'
ORGANIZACIONES."RUC"                  = '20607450677'
ORGANIZACIONES."Direccion_Fiscal"     = 'Cal. Los Jardines Nro. 520 - U.V. Los Alcanfores, Jaén, Jaén, Cajamarca, Perú'
ORGANIZACIONES."Representante_Legal"  = 'CRUZ RIVERA IVAN (DNI 47811073) - Gerente General, desde 21/01/2021'
ORGANIZACIONES.es_organizacion_prueba = false

ORGANIZACION_PRODUCTOS.id_organizacion = 'COOP-AROMAS-VALLE'
ORGANIZACION_PRODUCTOS.id_producto     = '6ae00de1-e156-4090-921c-d1244575856b'  -- CAFE
ORGANIZACION_PRODUCTOS.activo          = true
```

## Paso 4 — Verificación post-insert

```sql
SELECT * FROM "ORGANIZACIONES" WHERE "ID" = '<codigo-propuesto>';

SELECT op.*, p.codigo, p.nombre
FROM "ORGANIZACION_PRODUCTOS" op
JOIN "PRODUCTOS" p ON p.id = op.id_producto
WHERE op.id_organizacion = '<codigo-propuesto>';
```

Confirmar: 1 fila en `ORGANIZACIONES` con los datos esperados, y al menos
1 fila en `ORGANIZACION_PRODUCTOS` por cada producto declarado en los
prerrequisitos, con `p.codigo`/`p.nombre` mostrando el producto correcto
(no solo el `uuid` crudo).

## Nota sobre `Config`

`Config` (jsonb, nullable) es **opcional** — se puede dejar `NULL` en el
`INSERT` del paso 3 (como se hizo para `COOP-AROMAS-VALLE`) sin ningún
efecto negativo. Hoy solo tiene un efecto real en el sistema:
`Config.gis.radio_contexto_vecinos_m` (número, metros — radio de la capa
de contexto de parcelas vecinas en la Consola QC, ver ADR-006), con
`DEFAULT_RADIO_CONTEXTO_M = 500` aplicado automáticamente en
`lib/actions/qcActions.js` cuando `Config` es `NULL` o no trae esa clave.
**`Config` nunca debe usarse para membresía de producto ni para
"módulos" activados por organización** — esa responsabilidad es
exclusiva de `ORGANIZACION_PRODUCTOS` (ver `specs/roadmap_padron_multiorganizacion.md`,
que documenta explícitamente que la intención original de usar `Config`
para esto fue descartada a favor de esta tabla).

## Nota operativa

Este runbook se aplica **manualmente en Supabase Studio SQL Editor**,
envuelto en la transacción del paso 3 — no hay conexión Postgres directa
ni RPC de SQL libre disponible desde una sesión de desarrollo normal de
este repo (ver `CLAUDE.md`). No es una tarea apta para ejecución
autónoma: cada alta real crea datos de producción (razón social, RUC,
representante legal de una organización real) que no deben insertarse
sin que quien opera el proyecto revise los valores exactos primero.
