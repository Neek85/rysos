# Plan — Adopción de `PADRON_SOCIOS`/`PADRON_PARCELAS` al historial de migraciones

Ver `specs/padron_baseline_adopcion.md` para el contrato completo.

## Secuencia de ejecución

1. **Verificar el schema real en vivo** — introspección OpenAPI de
   PostgREST (Service Role Key), no `docs/schema_live.md` como fuente de
   verdad. Confirmar columnas, tipos, nulabilidad (`required` de
   PostgREST = `NOT NULL` real), defaults, y la PK real de cada tabla.
   Capturar conteos de filas actuales (`PADRON_SOCIOS`/`PADRON_PARCELAS`)
   para la verificación de no-op posterior. — **Hecho, ver hallazgos en la
   spec.**
2. **Escribir `supabase/migrations/20260825183000_baseline_padron_socios_parcelas.sql`**
   — `CREATE TABLE IF NOT EXISTS` para ambas tablas, columna por columna
   según lo confirmado en el paso 1, envuelta en `BEGIN;`/`COMMIT;` (mismo
   patrón que el resto de `supabase/migrations/`). Sin RLS, sin índices
   adicionales, sin FKs — solo la forma de la tabla.
3. **Escribir el ADR de corrección de premisa**
   (`docs/adr/ADR-023-backend-inspecciones-ya-no-comparte-base.md`) —
   documenta que `backend-inspecciones` ya no comparte Postgres en vivo
   con este proyecto, qué implica (retira el argumento de coordinación
   cross-repo de ADR-007, deja intacta la razón interna de la baja
   lógica), y dejar explícito que esto no es un juicio sobre el valor del
   código de `backend-inspecciones` (hay componentes ahí, como el PDF
   dirigido por metadatos, que podrían rescatarse aparte más adelante).
4. **Agregar notas de "premisa corregida" en `ADR-002` y `ADR-007`** —
   sin reescribir su contenido histórico (mismo criterio ya usado en esta
   sesión para `specs/ui_reorganization_geoman.md` al escribir ADR-022):
   un párrafo corto en cada uno señalando que la restricción de
   "compartido en vivo con `backend-inspecciones`" fue retirada por
   ADR-023, con un link.
5. **Actualizar `CLAUDE.md`** — la sección "Padrón module", que hoy dice
   "the padrón is shared live with another repo and IDs may be referenced
   from `INSPECCIONES`/`EUDR_MONITOREO` without a real FK" como razón
   conjunta para nunca hacer `DELETE` físico. Separar las dos razones:
   retirar la mención a "shared live with another repo" (ya no es cierto),
   dejar intacta la razón real que sigue vigente (`INSPECCIONES`/
   `EUDR_MONITOREO` de este mismo repo referencian estos IDs sin FK).
6. **Pedirle al usuario que aplique la migración manualmente** en Supabase
   Studio (flujo ya establecido, sin conexión Postgres directa desde este
   entorno de desarrollo).
7. **Verificar el no-op tras la aplicación:** releer conteos de
   `PADRON_SOCIOS`/`PADRON_PARCELAS` (deben coincidir exactamente con el
   baseline del paso 1) y confirmar que `/dashboard/socios` sigue
   funcionando igual (`npm run dev`, carga real de la pantalla).
8. **Correr la suite de tests** (`node --test tests/*.mjs`,
   `python -m pytest tests/ -v`) y el linter (`npm run lint`). Agregar un
   test liviano, gateado por `NEEDS_SUPABASE`, que confirme que las
   columnas esperadas de ambas tablas existen en vivo.
9. **Commit** (`chore(padron): ...`, Conventional Commits) y esperar
   confirmación del usuario antes de push a `staging`.

## Riesgos y mitigaciones

- **Riesgo:** que la migración, aunque nombrada `IF NOT EXISTS`, tenga un
  typo de tipo/nulabilidad que la vuelva incorrecta si alguna vez se
  corre contra una base *nueva* (por ejemplo, un ambiente de pruebas
  recreado desde cero). Mitigación: la introspección del paso 1 usa la
  fuente más autoritativa disponible sin acceso Postgres directo (el
  propio schema cache de PostgREST, generado por Postgres), no una
  inferencia desde valores de ejemplo.
- **Riesgo:** confundir "columna no documentada" (`normas_internas_17`)
  con "columna a eliminar". Mitigación: la migración la incluye tal cual
  existe — no se propone ningún `DROP COLUMN`, eso sería un cambio de
  comportamiento fuera del contrato de esta tarea.
