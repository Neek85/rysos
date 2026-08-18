# PLAN DE EJECUCIÓN: Fase 6 - Inspecciones Socioeconómicas

## 1. Pasos de Desarrollo
1. **Dependencias nuevas:** `react-hook-form`, `zod`, `@hookform/resolvers`
   (mismo trío que `backend-inspecciones`; no existían en `rysos`).
2. **`lib/inspeccionesSchema.js`:** schema Zod + `DEFAULT_VALUES`, portado
   de `admin-fed/src/components/features/inspecciones/types.ts` (mismos
   nombres de campo, sintaxis JS en vez de TS).
3. **`lib/inspeccionesActions.js`:**
   - `fetchInspecciones(supabase)` — lista paginada/buscable de
     `INSPECCIONES`.
   - `fetchInspeccionDetalle(supabase, id)` — 7 queries en paralelo
     (`INSPECCIONES` + 6 `CAP_*`) + merge, sin loggear ningún valor.
   - `saveInspeccion(supabase, values, { id, organizationId })` —
     UPDATE-si-existe/INSERT-si-no por tabla hija, con verificación de
     `ID_Organizacion` antes de escribir.
   - `resolveOrganizationId` reutilizado de `lib/eudrDdsExporter.js`.
4. **`components/ui/FormField.jsx`:** helper mínimo (label + error),
   versión JSX de `FormHelpers.tsx`.
5. **`components/features/inspecciones/`:**
   - `useInspeccionForm.js` — hook con `useForm` + `zodResolver`, carga y
     guardado.
   - `InspeccionForm.jsx` — shell de 8 pestañas (mismo layout que el
     original: menú lateral + contenido).
   - `tabs/TabGeneral.jsx`, `TabSocio.jsx`, `TabMic.jsx`,
     `TabConservacion.jsx`, `TabBienestar.jsx`, `TabRiesgos.jsx`,
     `TabGestion.jsx`, `TabCierre.jsx` — todos los campos del schema
     original, clases Tailwind planas (no las utility classes custom del
     repo origen, que no existen en `rysos`).
6. **Rutas App Router:**
   - `app/dashboard/inspecciones/page.jsx` — lista.
   - `app/dashboard/inspecciones/nueva/page.jsx` — crear.
   - `app/dashboard/inspecciones/[id]/editar/page.jsx` — editar.
7. **Sidebar:** agregar "Inspecciones" real bajo el grupo "Padrón" en
   `components/layout/DashboardSidebar.jsx`.
8. **Verificación:** `Remove-Item -Recurse -Force .next` + `npm run
   build` (deteniendo cualquier `next dev` activo primero) + `grep` de
   `console\.` contra los archivos nuevos para confirmar cero PII
   loggeada.

## 2. Plan de Rollback
- Todo el módulo es aditivo — no modifica `vw_monitoreo_web` ni ninguna
  vista/tabla de la línea EUDR existente de `rysos`.
- Las escrituras son sobre `INSPECCIONES`/`CAP_*`, las mismas tablas que
  ya escribe `backend-inspecciones` — un registro creado desde aquí es
  indistinguible de uno creado desde el panel anterior y se puede
  editar/borrar desde cualquiera de los dos.
- Si una prueba en vivo crea una fila de más, se identifica fácilmente
  por `Inspector`/`creado_por` con un valor de prueba explícito (ver
  paso de verificación) y se elimina manualmente vía Supabase Studio —
  esta fase no incluye una acción de borrado en la UI.
