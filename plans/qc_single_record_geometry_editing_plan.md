# Plan de Ejecución — Edición de Geometría de un Registro en QC (refuerzo)

Ver spec: `specs/qc_single_record_geometry_editing.md`.

## Pasos

1. **Verificación previa:** confirmado que casi todo el mecanismo descrito
   ya existe (Consola QC 2.0) — `layer.pm.enable()`/`disable()` por
   `editingKey`, captura de `pm:edit`/`pm:markerdragend`, botón + toggle
   visual en `QcDetailEditor.jsx`, aislamiento multi-tenant en
   `updateRecordGeometry`, Mapa sin geoman, cero PII en logs. Confirmado
   que `pm:vertexfadd` no existe en geoman (grep sobre el paquete
   instalado) — no se agrega ese listener.
2. `app/dashboard/qc/page.jsx::handleSaveGeometry`: dispara
   `handleValidateTopology(selectedRecord)` tras un guardado exitoso
   (excepto `EUDR_INSTALACIONES`).
3. `app/dashboard/qc/components/QcDetailEditor.jsx`: renombra el botón a
   "Guardar Cambios de Geometría" + actualiza el texto explicativo.
4. `tests/test_qc_geometry_editing.mjs` (nuevo): 9 tests de inspección de
   código fuente (re-validación automática, guard de INSTALACIONES,
   ausencia de `pm:vertexfadd`, mecanismos ya existentes sin romper, cero
   PII).
5. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`.
6. Commit a `main` — **sin push**: el prompt esta vez pide explícitamente
   preguntar antes de hacerlo (primera vez que lo pide así, en vez de dar
   por hecho una aprobación) — se pregunta como siempre.
