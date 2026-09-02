# ADR-020 — Un registro EUDR puede referenciar un socio/parcela real de OTRA organización: aviso en el ETL, bloqueo real al Aprobar

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-24
- **Código:** `scripts/etl_drive_to_supabase.py` (`warn_socio_org_mismatch`, CAPA 1 —
  informativa), `lib/eudrQcActions.js` (`checkSocioParcelaOrganizacion`,
  `assertSocioParcelaMismaOrganizacion`, CAPA 2 — bloqueo real),
  `app/api/qc/validar-organizacion-socio-parcela/route.js` (nuevo),
  `app/dashboard/qc/components/QcDetailEditor.jsx` (wiring del cliente)
- **Tests:** `tests/test_etl_drive.py::TestSocioOrgMismatchWarning` (7 tests,
  nuevo), `tests/test_eudr_qc_actions.mjs` (7 tests nuevos + `.maybeSingle()`
  agregado al mock), `tests/test_qc_organizacion_socio_parcela.mjs` (9 tests,
  nuevo), 2 tests preexistentes ajustados (`test_qc_codigo_parcela_unico.mjs`,
  `test_qc_cobertura_uso_suelo.mjs` — el regex de un botón dejó de fijar el
  string completo del atributo `disabled`)

## El hallazgo (investigación previa a esta tarea, sin código)

El usuario, usando "Cargar Capa Espacial" y "Sincronizar Google Drive" en
`/dashboard/qc`, generó 9 registros `EUDR_MONITOREO` reales bajo
`ORG-TEST-E2E`. Una investigación previa (solo lectura) confirmó: **7 de
esos 9 referencian un `ID_Socio`/`ID_Parcela_Fija` que existe y está
activo, pero pertenece a una organización real distinta** (`COOP-JS`/
`COOP-ND`) — el registro queda guardado bajo `ORG-TEST-E2E` mientras
"pertenece" (en el sentido de a quién describe) a otra organización.

La causa: los 7 vinieron por `scripts/etl_drive_to_supabase.py`
("Sincronizar Google Drive") — confirmado por `tecnico_responsable` (nombres
reales tipo "Jaun Perez"/"Victor campos", que solo puede venir de una fila
real de QField; `lib/actions/gisActions.js::insertEudrCoreRecord` hardcodea
`'Carga Web (Ingestor Espacial)'`, nunca un nombre libre). Ese script:

```python
# scripts/etl_drive_to_supabase.py — build_monitoreo_payload, antes de esta tarea
payload = {
    "id_monitoreo": id_monitoreo,
    "ID_Organizacion": org_id,  # de la carpeta de Drive
    "ID_Parcela_Fija": id_parcela_fija,  # de la fila de QField, SIN validar
    "ID_Socio": self.resolve_field_with_fallback(row, SOCIO_ID_CANDIDATES),  # ídem
    ...
```

nunca consulta `PADRON_SOCIOS`/`PADRON_PARCELAS` (confirmado con `grep`,
cero resultados en todo el archivo). ADR-019 (misma sesión, tarea anterior)
ya cerró este mismo tipo de gap para el Editor Vectorial/"Cargar Capa
Espacial" (ambos pasan por `lib/actions/gisActions.js`), pero
`etl_drive_to_supabase.py` es Python, un proceso completamente separado
(`child_process.spawn`) — nunca pasó por esa corrección. Tampoco lo
detecta **Aprobar**: `assertSameOrganization` (en `lib/eudrQcActions.js`)
solo compara `record.ID_Organizacion` contra la organización activa de la
sesión de la Consola QC (aislamiento de UI), nunca la organización real
del socio/parcela referenciado.

## La corrección — dos capas, mismo patrón que ADR-014

### Capa 1 — aviso informativo en el ETL, nunca bloquea la ingesta

`warn_socio_org_mismatch` (nueva, `scripts/etl_drive_to_supabase.py`),
llamada desde `process_layer_rows` justo después de
`warn_parcela_code_conflicts` (ADR-014) — mismo punto del flujo, mismo
criterio best-effort (try/except propio, un fallo acá nunca frena la
ingesta real, ver ADR-013):

```python
def warn_socio_org_mismatch(self, org_id: str, socio_id, parcela_id, identifier: str) -> None:
    try:
        if socio_id:
            result = self.supabase.table("PADRON_SOCIOS").select("ID_Organizacion").eq("ID_Socio", socio_id).execute()
            for socio in result.data or []:
                socio_org = socio.get("ID_Organizacion")
                if socio_org and socio_org != org_id:
                    print(f"  [ADVERTENCIA] {identifier}: ID_Socio '{socio_id}' pertenece a "
                          f"la organizacion '{socio_org}', no a '{org_id}' -- "
                          f"solo informativo, no bloquea la ingesta.")
        if parcela_id:
            # mismo patrón contra PADRON_PARCELAS/ID_Parcela_Fija
            ...
    except Exception as exc:
        print(f"  [AVISO] No se pudo verificar organizacion de socio/parcela para {identifier}: {exc}")
```

A diferencia de `warn_parcela_code_conflicts` (solo `EUDR_MONITOREO`, la
RPC-equivalente toma un `id_monitoreo`), esta corre para las **3 tablas
EUDR_\*** — `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` también tienen
`id_parcela` (aunque no `ID_Socio`) y son igual de vulnerables al mismo
gap. `warn_parcela_code_conflicts`/`existing_estado_revision` (ADR-012)
quedan sin tocar, tal como pedía la tarea.

### Capa 2 — bloqueo real al Aprobar, nunca al Rechazar

`checkSocioParcelaOrganizacion(supabase, record)` (nueva,
`lib/eudrQcActions.js`) consulta `PADRON_PARCELAS` por
`record.ID_Parcela_Fija` (ya viene en `POLIGONOS_COLUMNS`/`PUNTOS_COLUMNS`,
aplica a las 3 tablas) y, solo para `EUDR_MONITOREO`, resuelve
`ID_Socio` **fresco** desde la tabla base (`vw_monitoreo_poligonos`/
`puntos` no lo expone — solo el `COALESCE` en `productor`, que puede traer
el nombre libre en vez del código real, ver ADR-017) usando Service Role
(la tabla base niega `SELECT` anon). Devuelve `{ tieneConflicto, mensaje }`
en vez de lanzar directo, para que tanto `assertSocioParcelaMismaOrganizacion`
(bloqueo real) como el Route Handler (chequeo proactivo del cliente)
reutilicen la misma lógica:

```js
export async function checkSocioParcelaOrganizacion(supabase, record) {
  const fechaTexto = record.fecha_monitoreo ? ` (registro del ${record.fecha_monitoreo})` : ''
  if (record.ID_Parcela_Fija) {
    const { data, error } = await supabase.from('PADRON_PARCELAS').select('ID_Organizacion')
      .eq('ID_Parcela_Fija', record.ID_Parcela_Fija).maybeSingle()
    if (error) throw error
    if (data?.ID_Organizacion && data.ID_Organizacion !== record.ID_Organizacion) {
      return { tieneConflicto: true, mensaje: `No se puede aprobar${fechaTexto}: el Código de Parcela "${record.ID_Parcela_Fija}" pertenece a la organización "${data.ID_Organizacion}", no a "${record.ID_Organizacion}" — probablemente un dato de prueba o un error de carga. Rechazá el registro o corregí el código antes de continuar.` }
    }
  }
  if (record.tabla_origen === 'EUDR_MONITOREO' && record.id_monitoreo) {
    // resuelve ID_Socio fresco desde EUDR_MONITOREO (Service Role), luego compara igual contra PADRON_SOCIOS
    ...
  }
  return { tieneConflicto: false, mensaje: null }
}

async function assertSocioParcelaMismaOrganizacion(supabase, record) {
  const resultado = await checkSocioParcelaOrganizacion(supabase, record)
  if (resultado.tieneConflicto) throw new EUDRQcError(resultado.mensaje)
}
```

`approveRecord` gana `await assertSocioParcelaMismaOrganizacion(supabase, record)`
— **`rejectRecord` NO** (a diferencia de `assertSinConflictoDeParcela`,
ADR-014, que sí bloquea ambos): decisión explícita de esta tarea, nunca
cerrar la salida de descartar un registro problemático.

**Cliente** (`QcDetailEditor.jsx`): mismo mecanismo visual que ya existe
para el conflicto de código de parcela — `useEffect` que busca
automáticamente al seleccionar un registro (nuevo Route Handler
`/api/qc/validar-organizacion-socio-parcela`, Service Role, reutiliza
`checkSocioParcelaOrganizacion` — una sola fuente de verdad), estado
`orgMismatch`, mensaje bloqueante en rojo (mismo estilo que
`conflictoParcela`). La única diferencia deliberada: `orgMismatch?.tieneConflicto`
se agregó SOLO al `disabled` de "Aprobar":

```jsx
<button onClick={onApprove}
  disabled={busy || conflictoParcela?.tiene_conflicto || orgMismatch?.tieneConflicto} ...>
  Aprobar
</button>
<button onClick={onReject}
  disabled={busy || !motivo.trim() || conflictoParcela?.tiene_conflicto} ...>
  {/* orgMismatch NO aparece acá — a propósito */}
  Rechazar
</button>
```

## Verificación en vivo — sin crear/borrar los 9 registros reales

**Capa 2 (Aprobar bloqueado, Rechazar disponible), contra `7271b8bc-3a80-…`
(uno de los 7 reales, `JS-00001`/`COOP-JS-001` bajo `ORG-TEST-E2E`):**
seleccionado en la Consola QC real (`npm run dev` limpio), el panel mostró
el mensaje real:

> ⛔ No se puede aprobar (registro del 2026-04-26): el Código de Parcela
> "COOP-JS-001" pertenece a la organización "COOP-JS", no a "ORG-TEST-E2E"
> — probablemente un dato de prueba o un error de carga. Rechazá el
> registro o corregí el código antes de continuar.

`approveBtn.disabled === true` confirmado en el DOM real. Ese registro en
particular ADEMÁS tiene un conflicto de código de parcela real (ADR-014,
mensaje también visible, coincidencia — ambos checks son independientes),
así que para aislar la afirmación "Rechazar nunca se bloquea por esto" se
repitió con `2801d8e7-0e5a-…` (`JS-00001`/`COOP-JS-002`, sin conflicto de
código de parcela): mismo mensaje de `orgMismatch` real, `motivo` completado
→ `approveBtn.disabled === true`, **`rejectBtn.disabled === false`** — con
el mensaje de mismatch visible en pantalla. Ningún clic en Aprobar/Rechazar
— los 9 registros reales quedaron exactamente como estaban.

**Capa 1 (aviso del ETL, ingesta no bloqueada):** se corrió el script real
(`python scripts/etl_drive_to_supabase.py <carpeta> --dry-run`, credenciales
reales de `.env.local`) contra un paquete de prueba 100% desechable —
carpeta temporal fuera del repo, org `ORG-TEST-E2E` (ya existe, evita el
`FK fk_eudr_monitoreo_organizacion` que sí rechazó un primer intento contra
un org inventado que no existe en `ORGANIZACIONES`), referenciando
`ID_Socio: 'JS-00001'`/`ID_Parcela_Fija: 'COOP-JS-001'` (reales, de
`COOP-JS`). Log real:

```
[ADVERTENCIA] 16b779a6-…: ID_Socio 'JS-00001' pertenece a la organizacion 'COOP-JS', no a 'ORG-TEST-E2E' -- solo informativo, no bloquea la ingesta.
[ADVERTENCIA] 16b779a6-…: ID_Parcela_Fija 'COOP-JS-001' pertenece a la organizacion 'COOP-JS', no a 'ORG-TEST-E2E' -- solo informativo, no bloquea la ingesta.
-> Org: ORG-TEST-E2E | Registros: 1 (EUDR_MONITOREO=1) | ...
```

`Registros: 1` confirma que el registro se insertó pese a la advertencia
— la ingesta no se bloqueó. Verificado con una consulta real que la fila
existía (`id_monitoreo: '16b779a6-…'`, `tecnico_responsable: 'ADR-020
verificacion en vivo ETL'`), y luego **borrada** (era 100% de prueba, creada
por este mismo comando) — `ORG-TEST-E2E` volvió a sus 12 PENDIENTE
originales (los 3 de siempre + los 9 del hallazgo, ninguno tocado).
`--dry-run` confirmado real (no se movió/archivó el zip de prueba).

## Verificación no visual

- `npm run build`: compiló sin errores; nueva ruta
  `/api/qc/validar-organizacion-socio-parcela` registrada.
- `node --test tests/*.mjs`: 525/525 (16 tests nuevos: 7 en
  `test_eudr_qc_actions.mjs`, 9 en `test_qc_organizacion_socio_parcela.mjs`;
  2 tests preexistentes ajustados porque fijaban el string completo del
  atributo `disabled` del botón Aprobar, que ahora incluye la razón nueva).
- `python -m pytest tests/ -v --tb=short`: 370 passed, 5 skipped (7 tests
  nuevos en `TestSocioOrgMismatchWarning`; 4 tests preexistentes en
  `TestMultiLayerIngestion` ajustados porque asumían que
  `mock_supabase.table.call_args_list` solo contenía las 3 tablas EUDR_\* en
  el mismo orden que los upserts reales — ya no es cierto con las llamadas
  extra a `PADRON_SOCIOS`/`PADRON_PARCELAS`, se filtran por `EUDR_TABLES`).

## Fuera de alcance de esta tarea (a propósito)

- **Los 9 registros reales del hallazgo** — ninguno se tocó, tal como pidió
  la tarea; siguen `PENDIENTE`, ahora con el bloqueo de Aprobar activo si
  alguien intenta aprobarlos desde la Consola QC.
- **Backfill/limpieza masiva** de datos ya cargados con este gap en otras
  organizaciones reales — no se investigó fuera de los 9 ya conocidos.
- **Constraint a nivel de base de datos** (ej. un trigger que rechace el
  insert directamente) — la corrección vive en aplicación (ETL + Aprobar),
  igual que el resto de las reglas de este módulo (ADR-014, ADR-019).
