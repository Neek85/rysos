# Plan de ejecución — Multi-producto (Café/Cacao)

Ver `specs/multi_producto_cafe_cacao.md` (auditoría de estado real +
primer diseño, sin cerrar) para la evidencia completa y las 5 preguntas
abiertas. Este documento es la secuencia de pasos propuesta para la(s)
tarea(s) de implementación futuras — **ninguno de estos pasos se
ejecuta en esta tarea**, que fue solo de relevamiento.

A diferencia de los planes anteriores de esta serie (certificaciones,
PK surrogate), acá el "paso 0" no es opcional — el diseño de la spec
todavía tiene preguntas de producto sin responder, no solo detalles de
implementación.

## Orden recomendado

### 0. Prerrequisito real — cerrar las preguntas abiertas de la spec (sección 4) con el usuario

A diferencia del caso de certificaciones (que llegó a la etapa de
implementación con un contrato de datos ya cerrado tras 5 rondas de
auditoría), esta spec es la ronda 1: quedan preguntas de producto
genuinas, no solo de detalle técnico. En particular, antes de escribir
cualquier migración:

1. Qué pasa con `PADRON_PARCELAS.hcp`/`hcc` (hardcodeadas a "Café
   Podado"/"Café en Crecimiento", spec sección 1.4/3.1) frente a una
   organización que solo trabaja cacao — necesita una decisión de
   producto explícita antes de escribir cualquier migración que toque
   el padrón, no solo `EUDR_USO_SUELO`.
2. Si `ORGANIZACION_PRODUCTOS` es realmente N-a-N (una organización con
   café Y cacao a la vez) o si el caso de uso real es más simple.
3. Si `id_producto_predominante` alcanza solo en `EUDR_USO_SUELO` o
   también hace falta en `PADRON_PARCELAS`.

Sin estas respuestas, escribir la migración de la sección 2 de la spec
sería adivinar sobre un diseño de producto, no solo sobre un detalle de
esquema — mismo criterio que motivó pausar y pedir confirmación en
rondas anteriores de esta serie (ej. la interpretación de "certificación
Orgánica" en ADR-027, confirmada explícitamente antes de escribir el
backfill).

### 1. Ronda(s) adicionales de auditoría, si hace falta — RLS/GRANTs de `PRODUCTOS`/`ORGANIZACION_PRODUCTOS`

Mismo protocolo que la ronda 5 de `specs/padron_certificaciones_normalizado.md`
(sección 7): relevar el texto exacto de las políticas RLS/GRANTs ya
activas en tablas comparables (`CERTIFICACIONES_CATALOGO`/
`ORGANIZACION_CERTIFICACIONES`, ver la migración de ADR-027) para
replicar el mismo patrón, no inventar uno nuevo. No bloqueante para
cerrar el diseño de columnas/tipos, pero sí para escribir la migración
completa.

### 2. Migración SQL — `PRODUCTOS` + `ORGANIZACION_PRODUCTOS` + `EUDR_USO_SUELO.id_producto_predominante`

`supabase/migrations/<timestamp>_multi_producto_cafe_cacao.sql`,
idempotente (mismo estilo que ADR-023/024/026/027: `BEGIN;`/`COMMIT;`,
`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), puramente
aditiva:

1. `CREATE TABLE IF NOT EXISTS PRODUCTOS` — contrato de la sección 2.1
   de la spec, con el seed de 2 filas reales (`CAFE`/`CACAO`) usando
   los mismos `codigo`/`nombre` que se confirmen en el paso 0.
2. `CREATE TABLE IF NOT EXISTS ORGANIZACION_PRODUCTOS` — contrato de
   la sección 2.2, FK real a `ORGANIZACIONES("ID")` (mismo patrón que
   `ORGANIZACION_CERTIFICACIONES`, no `Config` — sección 1.2 de la
   spec ya descarta `Config` con evidencia).
3. `ALTER TABLE EUDR_USO_SUELO ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES PRODUCTOS(id)` —
   nullable, sin backfill (spec sección 1.8: no hay ningún dato real
   de producto que migrar, arranca en blanco — a diferencia de
   `SOCIO_CERTIFICACIONES`, que sí tuvo backfill real de 7 socios).
4. RLS/GRANTs según lo que releve el paso 1.
5. **Sin tocar** `PADRON_PARCELAS.hcp`/`hcc` en esta migración, salvo
   que el paso 0 concluya lo contrario explícitamente.

### 3. Código de aplicación — alcance a determinar según lo que decida el paso 0

Sin UI hoy que consuma esto (spec sección 2.4) — el alcance real
(selector de producto en altas de organización/parcela, filtros,
badges) depende de las respuestas del paso 0, no está definido acá.
Punto de partida sugerido, no cerrado: un selector de producto(s) por
organización en algún panel de administración (no existe hoy ningún
`/dashboard/organizaciones` ni equivalente — a confirmar si hace falta
crear uno o si esto se resuelve de otra forma).

### 4. Tests

Mismo patrón que `tests/test_certificaciones_normalizadas.py`: una
clase estática (estructura de la migración: tablas, FK, RLS, seed,
idempotencia) siempre corre; una clase Live (contra Supabase real,
auto-skip hasta aplicar la migración) que verifique al menos: el seed
de 2 productos, aislamiento multi-tenant en `ORGANIZACION_PRODUCTOS`, y
que `EUDR_USO_SUELO` existente sigue con `id_producto_predominante`
`NULL` (sin backfill inventado).

### 5. Exportador DDS (spec sección 1.7 / 2.4) — fuera de alcance de esta ronda, señalado para una tarea futura separada

`lib/eudrDdsExporter.js`/`scripts/generate_eudr_dds.py` eventualmente
necesitarían incorporar el producto/commodity al payload oficial
(`buildOfficialEuGeoJson`) — no se toca en esta ronda de
implementación; requiere su propia investigación de qué campo exacto
espera TRACES NT (mismo protocolo que ADR-017 usó para el formato real
de exportación), no asumido acá.

### 6. Verificación + commit

`node --test tests/*.mjs`, `python -m pytest tests/ -v` (con
credenciales para correr la clase Live tras aplicar la migración
manualmente en Supabase Studio, mismo flujo de siempre), `npm run
build` + reinicio limpio del dev server. ADR nuevo (próximo número
disponible tras ADR-027) documentando el diseño final y las respuestas
del paso 0. Commit con Conventional Commits, sin push hasta
confirmación explícita del usuario — mismo criterio que toda esta
serie.
