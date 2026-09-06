# Plan de ejecución: RBAC en Padrón de Socios

Ver `specs/rbac_webgis_padron.md` para el contexto completo y la
corrección de premisa sobre `/dashboard/mapa` (sin cambios — ya es
solo lectura para los 3 roles, tanto en código como en la matriz de
permisos ya confirmada).

1. `lib/auth/getCurrentProfile.js` — agregar `'use server'` (ya era
   una función async pura apta para Server Action, solo faltaba el
   directive).
2. `lib/actions/sociosActions.js` — helper privado
   `assertAdminRole(supabase)` (llama `supabase.rpc('auth_role')`,
   lanza `SocioActionError` si no es `'admin'`), aplicado en:
   `createSocio`, `updateSocio`, `updateParcela`, `deactivateSocio`,
   `deactivateParcela`. **`createParcela` deliberadamente sin
   chequeo** — también la llama `gisActions.js::uploadGeoSpatialFeature`
   (Editor Vectorial de `/dashboard/qc`, fuera de alcance), ver
   `specs/rbac_webgis_padron.md` para el detalle del gap.
3. `app/dashboard/socios/page.jsx` — estado `userRole` poblado desde
   `getCurrentProfile()` al montar. Ocultar "+ Nuevo Socio",
   "Exportar Padrón de Socios/Parcelas (CSV)", "Cargar Padrón Masivo
   (CSV)", y por fila "Editar"/"Dar de baja" cuando `userRole !==
   'admin'` (mantener "Parcelas", búsqueda y filtros visibles — son
   lecturas). Pasar `userRole` a `ParcelaFormModal`.
4. `components/features/socios/ParcelaFormModal.jsx` — recibir
   `userRole` como prop nueva, ocultar "Editar"/"Dar de
   baja"/"+ Agregar parcela" cuando no sea `'admin'`.
5. `app/dashboard/mapa/page.jsx` — sin cambios (ver corrección de
   premisa).
6. Verificación:
   - `npm run build` / `npm run lint`.
   - Sin test automatizado para esto (no hay Jest/Playwright en el
     repo, ver `CLAUDE.md`) — se documenta en el ADR/spec como
     verificación pendiente manual si hace falta.
7. `docs/ESTADO_PROYECTO.md` — nueva entrada documentando el RBAC y la
   corrección de premisa sobre `/dashboard/mapa`.
8. Commit (`feat(auth): agregar control de acceso por rol en WebGIS y
   Padron de Socios`) + push a `staging`. `git diff` real de
   `sociosActions.js` pegado en el reporte final (tarea de seguridad,
   no alcanza el resumen de 3-4 líneas — ver `CLAUDE.md`).
