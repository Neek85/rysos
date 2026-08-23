# ADR-012 — El ETL de Drive protege registros ya revisados (Aprobado/Rechazado) en resincronizaciones

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Código:** `scripts/etl_drive_to_supabase.py` (`fetch_existing_estado_revision`,
  `process_layer_rows`, `process_package`, `run`)
- **Tests:** `tests/test_etl_drive.py::TestProtectsAlreadyReviewedRecords` (8 tests
  nuevos), `tests/test_e2e_etl_drive.py` (mock actualizado)

## El problema

**Confirmado con evidencia real, no solo inferido del código:** 3 registros de
`EUDR_MONITOREO` (`b2f305a0-...` COOP-JS-001/2026-07-06, `b12677bd-...`
COOP-JS-004/2026-08-16, `10425cbd-...` COOP-JS-003/2026-08-19), previamente
`APROBADO` por un humano en la Consola QC, volvieron a `PENDIENTE` sin que nadie
los tocara desde la UI.

La causa raíz, encontrada comparando el paquete real que lo produjo
(`PROCESADO_20260823_131250_Prueba1.zip`, 11,525,931 bytes) contra el estado
previo de la base: el proyecto QField de origen (`ORG-TEST-E2E`) sigue activo, y
cada exportación nueva re-incluye **todas** las filas del proyecto, no solo las
agregadas desde la última sincronización. `Prueba1.zip` traía 6 filas de
`EUDR_MONITOREO` — las 3 ya revisadas (mismo `id_monitoreo`, derivado
deterministicamente de organización+parcela+fecha vía
`compute_deterministic_id`, así que el upsert conflictúa contra la fila
existente) más 3 genuinamente nuevas.

`build_monitoreo_payload`/`build_uso_suelo_payload`/`build_instalaciones_payload`
incluían `"estado_revision": "PENDIENTE"` de forma incondicional en las 3 tablas
EUDR_*, y `process_layer_rows` hacía upsert del payload completo sin mirar el
estado existente:

```python
payload = self.build_payload_for_table(
    table_name, row, org_id, fid=fid, record_id=record_id, evidencia_foto=storage_path
)
on_conflict = self.resolve_upsert_conflict_target(table_name, payload)
self.supabase.table(table_name).upsert(payload, on_conflict=on_conflict).execute()
```

Resultado: cualquier resincronización de un proyecto QField activo revertía
silenciosamente la decisión de revisión humana — sin aviso, sin registro (la
tabla `audit_logs` diseñada en `20260820_audit_logs.sql` nunca se aplicó
realmente, ver sección final), y sobrescribiendo también geometría/atributos si
el técnico hubiera editado el registro en QField después de la aprobación.

Se descartaron, con evidencia específica, otras explicaciones antes de llegar a
esta: los Server Actions de la Consola QC (`lib/eudrQcActions.js`) solo pueden
actuar sobre filas ya `PENDIENTE` (`.match({ estado_revision: PENDING_STATE })`),
nunca escriben `'PENDIENTE'` como valor destino — estructuralmente no pueden ser
la causa. `scripts/qgis_qc_actions.py::get_revert_action_sql` sí escribe
`'PENDIENTE'`, pero referencia una columna (`actualizado_en`) que no existe en
ninguna tabla EUDR_*, y no fue tocado desde el primer commit del repo — se
descartó como causa directa, aunque queda como una vía de escritura real y
parcialmente rota, fuera de alcance de esta tarea.

## La decisión

Cuando un registro **ya existe** con `estado_revision` distinto de `PENDIENTE`
(ya fue `APROBADO` o `RECHAZADO`), el upsert del ETL protege el registro
**completo** — no solo `estado_revision`. Ningún campo se sobrescribe: ni la
geometría, ni los atributos, ni la evidencia fotográfica. Solo un registro que
sigue `PENDIENTE` (o que todavía no existe) se actualiza con normalidad en cada
sincronización.

Se protege el registro entero, no solo el campo de estado, porque proteger solo
`estado_revision` dejaría abierta la misma clase de bug para geometría/atributos:
un técnico que corrige el GeoPackage en QField después de que un revisor ya
aprobó el registro podría alterar silenciosamente los datos de un registro cuya
decisión humana ya se tomó sobre la versión anterior.

### Implementación

`fetch_existing_estado_revision(table_client, payload, on_conflict)` — antes de
cada upsert, consulta la fila existente por los mismos campos que el conflict
target real (`id_monitoreo` para `EUDR_MONITOREO`; `ID_Organizacion,fid` para
`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`), para que "existe" signifique exactamente
lo mismo que le importa a Postgres al resolver el `ON CONFLICT`:

```python
def fetch_existing_estado_revision(self, table_client, payload: dict, on_conflict: str) -> str | None:
    query = table_client.select("estado_revision")
    for field in on_conflict.split(","):
        query = query.eq(field, payload.get(field))
    rows = query.execute().data or []
    return rows[0]["estado_revision"] if rows else None
```

`process_layer_rows` construye primero un payload "de sondeo" (sin subir la
foto real todavía — `evidencia_foto` no influye en el identificador, así que se
evita gastar una subida de Storage en un registro que puede terminar omitido),
resuelve el `table_client` una sola vez (`self.supabase.table(table_name)`,
reutilizado luego para el upsert real) y decide:

```python
existing_estado = self.fetch_existing_estado_revision(table_client, probe_payload, on_conflict)
if existing_estado is not None and existing_estado != "PENDIENTE":
    print(f"  [PROTEGIDO] {table_name} {identifier}: estado_revision='{existing_estado}' "
          f"(ya revisado) — se omite el upsert, registro existente queda intacto.")
    skipped_records.append({"table": table_name, "id": identifier, "estado_revision": existing_estado})
    continue
# ... solo aquí se sube la foto real y se hace upsert ...
```

`process_package`/`run()` agregan y loguean por stdout cuántos registros se
omitieron y sus identificadores (`id_monitoreo`, o `ID_Organizacion/fid` para
las otras dos tablas) — visibilidad mínima mientras `audit_logs` siga sin
aplicarse en producción.

## Verificación en vivo (no solo tests unitarios)

1. Se aprobó de nuevo, a través del botón real "✓ Aprobar" de la Consola QC en
   `http://localhost:3000/dashboard/qc`, el registro `b2f305a0-f549-5d08-9ab1-c00596df9987`
   (COOP-JS-001, 2026-07-06) — confirmado `estado_revision = 'APROBADO'` vía
   REST tras el clic.
2. Se copió el paquete ya archivado `PROCESADO_20260823_131250_Prueba1.zip` a un
   directorio `RYZOS_INBOX` local (fuera de Drive) y se invocó
   `DriveZipETLPipeline.run()` directamente contra ese directorio, sin pasar por
   la UI de sincronización ni por Drive.
3. Salida real del ETL:
   ```
   [PROTEGIDO] EUDR_MONITOREO b2f305a0-f549-5d08-9ab1-c00596df9987: estado_revision='APROBADO' (ya revisado) — se omite el upsert, registro existente queda intacto.
   -> Org: ORG-TEST-E2E | Registros: 15 (EUDR_INSTALACIONES=5, EUDR_MONITOREO=5, EUDR_USO_SUELO=5) | Fotos: 9 | ...
   -> Omitidos por ya revisados (ADR-012): 1 (EUDR_MONITOREO:b2f305a0-f549-5d08-9ab1-c00596df9987=APROBADO)
   ```
4. Confirmado vía REST tras la corrida: `b2f305a0-...` sigue `APROBADO`, con
   `geom_inspeccion` intacto (no nulo, no modificado). Los otros 5 registros de
   `EUDR_MONITOREO` (`b12677bd`, `10425cbd`, y los 3 nuevos del paquete:
   `2947810c`, `6b1c9ec5`, `6367110b`) siguen/quedan en `PENDIENTE` — se
   actualizaron con normalidad, confirmando que la protección no rompe el
   flujo normal de sincronización.

## Recordatorio no bloqueante: `audit_logs` nunca se aplicó

`docs/schema_live.md` documenta `public.audit_logs` como creada por
`supabase/migrations/20260820_audit_logs.sql`, pero una consulta REST directa
confirma que la tabla **no existe en la base real** (`PGRST205: Could not find
the table 'public.audit_logs'`) — la migración se escribió pero nunca se
aplicó manualmente en Supabase Studio SQL Editor. Contenido completo pegado en
el chat de esta tarea para que el usuario la revise y la aplique; una vez
aplicada, `docs/schema_live.md` ya la documenta correctamente y no hace falta
tocarlo de nuevo.

## Fuera de alcance de esta tarea (a propósito)

- **`scripts/qgis_qc_actions.py`** — su `get_revert_action_sql` referencia
  `actualizado_en`, columna inexistente en las 3 tablas EUDR_*; sigue roto tal
  cual estaba, no se tocó (la tarea pedía corregir el ETL de Drive, no este
  script de QGIS Desktop).
- **Aplicar `audit_logs`** — la migración se pegó en el chat pero no se aplicó
  desde acá (no hay conexión Postgres directa disponible en esta sesión); queda
  a cargo del usuario en Supabase Studio.
- **Registrar en `audit_logs` los registros omitidos por ADR-012** — con la
  tabla aplicada, sería la extensión natural (cada `[PROTEGIDO]` podría además
  insertar una fila de auditoría), pero no se implementó en esta tarea porque
  la tabla todavía no existe en producción.
