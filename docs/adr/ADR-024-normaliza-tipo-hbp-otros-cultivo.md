# ADR-024 — Normaliza el tipo de `PADRON_PARCELAS.hbp`/`otros_cultivo` a `numeric`

- **Estado:** Aceptado
- **Fecha:** 2026-08-25
- **Migraciones:** `supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql`
  (pendiente de aplicación manual en Supabase Studio, como toda migración
  de este repo)
- **Spec:** este ADR (hallazgo puntual, sin spec/plan independientes — ver
  contexto en `specs/padron_baseline_adopcion.md`)
- **Tests:** `tests/test_padron_baseline_adopcion.py` (actualizado),
  `python -m pytest tests/`

## Contexto

`ADR-023`/`specs/padron_baseline_adopcion.md` (commit `6ff1daf`) adoptó
`PADRON_SOCIOS`/`PADRON_PARCELAS` al historial de migraciones capturando
el schema real vía introspección OpenAPI de PostgREST, y documentó — sin
corregir, por contrato explícito de esa tarea ("cero cambios de
comportamiento") — que `PADRON_PARCELAS.hbp` y `PADRON_PARCELAS.otros_cultivo`
son `text` en la instancia real, mientras que el resto de las columnas de
hectáreas de la misma tabla (`hcp`, `hcc`, `ho`, `hip`, `hrp`) son
`numeric`. Confirmado visualmente en Supabase Studio y, de nuevo, en vivo
acá vía el mismo endpoint OpenAPI inmediatamente antes de escribir esta
migración.

`lib/validations/socios.js` ya trata `hbp`/`otros_cultivo` como numéricas
(`HECTARE_FIELDS`, coerción con `nonNegativeNum`) desde siempre — el
schema real nunca coincidió con lo que la aplicación asume. No es una
inconsistencia introducida hoy; es una que ya existía y recién se hizo
visible al introspeccionar el schema real por primera vez.

## Verificación de solo lectura antes de alterar el tipo

Antes de escribir la migración, se consultó `PADRON_PARCELAS` completa (11
filas — mismo conteo base que `ADR-023`, no solo las visibles en el Table
Editor) vía REST con Service Role Key, `select=ID_Parcela_Fija,hbp,otros_cultivo`:

| Valor encontrado | Filas |
|---|---|
| `NULL` | 3 |
| `'0'` | 6 |
| `'1'` | 2 |

Ningún string vacío, ningún separador decimal con coma, ningún texto no
numérico. Las 11 filas castean limpio a `numeric` sin pérdida de
información. No fue necesario detenerse a reportar valores problemáticos
— el camino feliz del prompt original.

## Decisión

`ALTER COLUMN ... TYPE numeric USING NULLIF(TRIM(x), '')::numeric` para
ambas columnas, cada uno envuelto en un chequeo idempotente contra
`information_schema.columns` (no-op si la columna ya es `numeric` — cubre
una segunda ejecución accidental del archivo). El `USING` con
`NULLIF(TRIM(x), '')` convierte un string vacío o solo-espacios en `NULL`
en vez de tumbar la migración con un error de cast — no se activó con los
datos actuales, pero deja la migración segura ante una fila futura, en
cualquier entorno donde se aplique, que sí tenga uno.

No se toca ninguna otra columna de la tabla, ni `PADRON_SOCIOS`.

## Qué NO cambia

- **Contrato del frontend:** ninguno. `lib/validations/socios.js` ya
  esperaba `numeric` — este cambio elimina la discrepancia entre lo que la
  app asume y lo que la base realmente tenía, no introduce una nueva
  asunción.
- **La migración base de `ADR-023`:** no se reescribe
  `20260825183000_baseline_padron_socios_parcelas.sql` para que declare
  `hbp`/`otros_cultivo` como `numeric` desde el principio — esa migración
  documenta fielmente lo que la tabla era en ese momento (`text`); esta
  migración nueva es la que efectivamente cambia el tipo, en orden, como
  un paso separado y explícito.
- **Aplicación real contra producción:** como toda migración de este
  repo, este archivo solo queda preparado y versionado — la aplicación
  manual en Supabase Studio la hace el usuario.

## Consecuencias

- Positivo: el schema real ahora coincide con lo que la aplicación
  siempre asumió — cierra la discrepancia documentada en `ADR-023` en vez
  de dejarla como deuda permanente.
- Positivo: la migración es segura de re-ejecutar (chequeo de tipo previo
  a cada `ALTER COLUMN`) y segura ante datos sucios futuros (`NULLIF(TRIM(...))`),
  aunque los datos actuales no lo requirieran.
- Pendiente (no verificable en este entorno): confirmar tras la
  aplicación manual que `hbp`/`otros_cultivo` reportan `numeric` en una
  nueva consulta OpenAPI, y que `/dashboard/socios` sigue funcionando
  igual (mismo patrón de verificación post-aplicación que `ADR-023`).
