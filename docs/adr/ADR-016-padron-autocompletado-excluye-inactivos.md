# ADR-016 — El autocompletado de Inspecciones excluye socios/parcelas dados de baja

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Código:** `lib/padronSearch.js` (`searchSocios`, `searchParcelas`),
  `lib/actions/sociosActions.js` (comentarios de decisión de negocio, sin
  cambio de comportamiento)
- **Tests:** `tests/test_padron_search.mjs` (nuevo, 5 tests — sin
  cobertura previa)

## El gap real (encontrado en una investigación previa a esta tarea)

La baja lógica de `PADRON_SOCIOS`/`PADRON_PARCELAS` (`activo boolean`,
`supabase/migrations/20260818_padron_baja_logica.sql`, ya aplicada y en
uso con datos reales) ya estaba respetada por el listado principal
(`lib/sociosSearch.js`) y por la exportación/import CSV
(`lib/padronCsv.js`) — ambos filtran `.eq('activo', true)`. Pero
`lib/padronSearch.js`, que alimenta el autocompletado de
`PadronAutocomplete.jsx` en el formulario de Inspecciones (Fase 6, FED,
`TabGeneral.jsx`), no lo hacía: un socio o una parcela ya dados de baja
seguían apareciendo como opción válida al crear una **inspección nueva**.

## La corrección

Un `.eq('activo', true)` agregado a cada una de las 2 consultas
(`searchSocios`/`searchParcelas`), en el mismo lugar donde ya se filtra por
`ID_Organizacion` — nunca se toca el multi-tenant existente:

```js
export async function searchSocios(supabase, organizationId, query) {
  ...
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select(SOCIO_COLUMNS)
    .eq('ID_Organizacion', organizationId)
    .eq('activo', true)
    .or(`socio_nombre_completo.ilike.%${term}%,socio_dni.ilike.%${term}%,codigo_finca.ilike.%${term}%`)
    .limit(8)
  ...
}
```

Mismo cambio en `searchParcelas`.

**Por qué esto no afecta el historial ya guardado:** `INSPECCIONES`/
`CAP_*` capturan `ID_Socio`/`ID_Parcela` como texto libre al momento de
guardar la inspección (sin FK, sin re-consulta en vivo — confirmado en la
investigación previa) — dar de baja un socio después nunca modifica ni
oculta una inspección ya guardada que lo referencia. El filtro solo aplica
al **autocompletado de una inspección nueva**.

## Decisión de negocio confirmada: un DNI/código de baja nunca se reutiliza

`assertDniNotDuplicated`, `assertCodigoFincaNotDuplicated`,
`assertParcelaCodigoNotDuplicated` (anti-duplicados por organización) y
`assertSocioExists` (requiere que el socio dueño de una parcela nueva
exista) — las 4 funciones de `lib/actions/sociosActions.js` que también
tocan `PADRON_SOCIOS`/`PADRON_PARCELAS` — **no cambian en esta tarea**. Su
comportamiento actual, que no distingue `activo`/`inactivo`, es el deseado:

- Un DNI, un Código de Finca, o un Código Interno de Parcela que ya
  perteneció a un socio/parcela dado de baja **sigue bloqueado** para un
  registro nuevo en la misma organización — nunca se libera ni se
  reutiliza.
- `assertSocioExists` sigue permitiendo crear una parcela nueva para un
  socio que existe en la organización, esté `activo` o no — no se agregó
  ninguna restricción nueva acá; queda documentado como confirmado, no
  como un gap pendiente.

Cada una de las 4 funciones tiene ahora un comentario explícito citando
esta decisión, para que una futura revisión no lo confunda con un
descuido.

## Verificación en vivo

**Parcela — a través del formulario real (`/dashboard/inspecciones/nueva`),
sin mocks:** la organización que este formulario resuelve por defecto
(`resolveOrganizationId` sobre las filas existentes de `INSPECCIONES`) es
`COOP-JS`, que además tiene parcelas reales inactivas (`COOP-JS-002`/
`COOP-JS-003`, código interno `P-00002`/`P-00003`) — coincidencia útil que
permitió probar el fix con clicks reales, no solo contra la función
directamente. Control positivo primero, para descartar un falso negativo
por otra causa (ej. organización todavía sin resolver):

| Búsqueda en "Buscar Parcela" | `activo` | Resultado real en el dropdown |
|---|---|---|
| `P-00001` (control positivo) | `true` | `"P-00001 — El Lache · 2 ha"` — aparece |
| `P-00003` | `false` | **Sin dropdown, 0 resultados** |

**Socio — invocando `searchSocios` directamente contra datos reales:** los
2 socios reales inactivos identificados en la investigación previa viven
bajo `COOP-ND`, una organización sin ninguna fila en `INSPECCIONES` — el
formulario en pantalla nunca resuelve su organización activa a `COOP-ND`,
así que probarlo con clicks ahí no habría demostrado nada (el socio no
aparecería de todos modos, por organización distinta, no por el filtro
`activo` que se está verificando). Se invocó la función real
(`searchSocios`, mismo código, mismo cliente Supabase real) directamente
contra `COOP-ND`:

```
searchSocios(supabase, 'COOP-ND', 'ABEL')    -> [{ ID_Socio: 'ND-00002', socio_nombre_completo: 'ABEL LINARES BUSTAMANTEEEE', ... }]
searchSocios(supabase, 'COOP-ND', 'AGUILAR') -> []   (matchea SOLO a 'ABEL AGUILAR GUEVARA', ND-00001, activo=false)
```

Confirmado además, con una consulta cruda a la tabla, que `ND-00001` sí
existe (`activo: false`) — la ausencia en la búsqueda es el filtro nuevo,
no un registro inexistente.

## Fuera de alcance de esta tarea (a propósito)

- **Revertir la baja de un socio/parcela** — no existe un botón
  "reactivar" en la UI hoy; no se pidió acá.
- **Excluir inactivos en `lib/eudrQcActions.js::enrichWithParcelaInfo`** —
  deliberadamente NO se toca: ese JOIN es para mostrar `parcela_codigo`/
  `parcela_nombre` en registros `EUDR_MONITOREO` ya existentes (posiblemente
  históricos), y debe seguir resolviendo el nombre aunque la parcela se
  haya dado de baja después — excluir inactivos ahí rompería esa
  visualización histórica, no es el mismo caso que el autocompletado de
  una inspección nueva.
