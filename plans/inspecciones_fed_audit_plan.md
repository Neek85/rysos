# Plan de Ejecución — Auditoría Inspecciones FED

Ver spec: `specs/inspecciones_fed_audit.md`.

## Pasos

1. **Auditoría (hecha antes de escribir código):**
   - Confirmar que `lib/validations/inspecciones.ts` no existe; localizar
     el schema real (`lib/inspeccionesSchema.js`).
   - Leer `lib/inspeccionesActions.js`, `lib/padronSearch.js` completos.
   - Grep exhaustivo de `console.*` en todo el módulo de Inspecciones
     (lib + components/features/inspecciones + tabs).
   - Leer `useInspeccionForm.js` y `TabGeneral.jsx` para entender el flujo
     de guardado y localizar los `<select>` con enumeraciones reales.
   - Escanear las 8 pestañas (`grep -n "register(\|<option value="`) para
     mapear todos los campos con `<select>` restringido.

2. **Migración SQL** (`supabase/migrations/20260818_inspecciones_atomic_save.sql`):
   `public.fn_guardar_inspeccion_completa` — ver spec para el diseño
   detallado (DELETE+INSERT para hijas, jsonb_populate_record solo para
   tipado, columnas explícitas en todo INSERT/UPDATE).

3. **`lib/inspeccionesActions.js`**: reescribir `saveInspeccion()` para
   llamar `supabase.rpc('fn_guardar_inspeccion_completa', {...})` en vez de
   7 llamadas REST. Eliminar `CHILD_TABLES` (queda sin uso tras el cambio).

4. **`lib/inspeccionesSchema.js`**: agregar `z.enum(...)` a `Estado`
   (requerido, 4 valores), `Tipo_Inspeccion` y `Resultado_Global`
   (opcionales, aceptan `''` + sus valores reales), extraídos de
   `TabGeneral.jsx`/`TabCierre.jsx`.

5. **Test** (`tests/test_inspecciones_schema.mjs`, `node --test`):
   casos válidos/inválidos para los 3 campos con enum nuevo, coerción
   numérica, y confirmación de que PII no está restringida por el schema
   (solo se valida forma, la protección real es la ausencia de
   `console.log`, ya auditada).

6. **Verificación**: `node --test tests/test_inspecciones_schema.mjs`
   (100% passing), `python -m pytest tests/ -q` (sin regresión — el cambio
   no toca nada del lado Python), `npm run build` (compila sin errores;
   `next lint` no está configurado en este proyecto — pide setup
   interactivo, se usa `build` como verificación equivalente).

7. **Actualizar `docs/schema_live.md`**: documentar la función RPC nueva y
   el hardening de enums.

8. **Commit a `main`** (sin push).
