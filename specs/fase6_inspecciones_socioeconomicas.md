# SPEC: Módulo de Inspección Socioeconómica Interna (Fase 6)

## ⚠️ Hallazgo crítico verificado en vivo (post-implementación)
**`INSERT` anónimo sobre `INSPECCIONES` está bloqueado por RLS** —
confirmado en vivo: `{"code":"42501","message":"new row violates
row-level security policy for table \"INSPECCIONES\""}`, disparado desde
el flujo real "Nueva Inspección" con la anon key (la misma que usa
`admin-fed/src/lib/supabase.ts` en el repo origen — no hay sesión de
usuario en ninguno de los dos proyectos). Esto **no es un bug de esta
implementación**: cualquier cliente anon-key, incluida la app original
`backend-inspecciones`, chocaría con la misma política al intentar crear
una inspección nueva. Es probable que exista una política de `SELECT`
para `anon` pero ninguna de `INSERT` sobre `INSPECCIONES` (y
presumiblemente las 6 tablas `CAP_*`, no verificado individualmente).
**`UPDATE` sobre una inspección existente no se probó en vivo** — hacerlo
habría requerido escribir sobre el registro real de un socio real (Victor
Abel Linares Bustamante, cargado durante la verificación de lectura), lo
cual se evitó deliberadamente. **Consecuencia:** el módulo está verificado
por lectura (`SELECT` sobre las 7 tablas funciona con datos reales) y por
revisión de código (mismo patrón UPDATE-si-existe/INSERT-si-no ya
probado en `backend-inspecciones`), pero el camino de escritura completo
— crear o editar una inspección de verdad — requiere que se agregue una
política RLS de `INSERT`/`UPDATE` para el rol `anon` sobre `INSPECCIONES`
y las 6 `CAP_*` (mismo criterio que ya tienen las políticas `rls_write_*`
existentes de RYZOS, ver `supabase/migrations/20260816_fase3_seguridad_rls.sql`)
antes de poder usarse en producción. No se intentó agregar esa política
desde aquí — es un cambio de RLS sobre una base compartida con otro
repositorio y debe decidirse explícitamente, no como efecto colateral de
esta tarea.

## 0. Origen
Portabilidad controlada desde `Neek85/backend-inspecciones` (ver
`docs/audits/auditoria_backend_inspecciones.md`, ítem de Alta Prioridad
#1) hacia `/dashboard/inspecciones` en Next.js. El repositorio anterior
opera sobre la **misma instancia Supabase en vivo** (`jhtocgxlozfuzullrtol`)
que RYZOS — no se trata de portar un schema similar a una BD nueva, sino
de construir una UI nueva sobre tablas ya existentes y ya pobladas.

## 1. Objetivo
Permitir a un inspector interno crear y editar, desde `/dashboard`,
inspecciones socioeconómicas y de cumplimiento (bienestar laboral, manejo
de cultivo, conservación, riesgos, gestión) sobre las tablas
`INSPECCIONES` + 6 tablas hijas `CAP_*`, reemplazando la necesidad de usar
el panel Vite/React separado de `backend-inspecciones`.

## 2. Verificación de Compatibilidad de Esquema (previa a la implementación)
Verificado en vivo vía REST directo contra `jhtocgxlozfuzullrtol` (no
contra el CSV de la auditoría, que es un export manual potencialmente
desactualizado — mismo patrón de precaución ya aplicado en Fase 3/QC):

- **`INSPECCIONES`, `CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`,
  `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION`:** columnas en vivo
  coinciden **exactamente** con `esquema_bd.csv` de la auditoría, con un
  único agregado uniforme en las 7 tablas: `respuestas_dinamicas`
  (columna JSONB, agregada después del export de la auditoría — no se usa
  en esta fase; queda como extensión futura, no se adivina su forma).
- **`INSPECCIONES.ID_Organizacion` existe y trae datos reales** — a
  diferencia de las tablas `CAP_*`, que NO tienen `ID_Organizacion` propio
  (dependen de `ID_Inspeccion` → `INSPECCIONES.ID_Organizacion`).
- **Hallazgo bloqueante para búsqueda de padrón:** `PADRON_SOCIOS`,
  `PADRON_PARCELAS` y `ORGANIZACIONES` devuelven `content-range: */0`
  (cero filas) ante una consulta anónima directa (`select=*`), pese a
  tener filas reales — confirmado porque `vw_monitoreo_web` (que hace
  `LEFT JOIN` sobre `PADRON_PARCELAS`) sí devuelve esas mismas filas con
  la misma anon key. RLS bloquea el acceso directo a las 3 tablas madre
  para el rol `anon`; las vistas que las consumen funcionan porque
  corren con el privilegio del dueño de la vista, no del rol que
  consulta (comportamiento estándar de vistas Postgres sin
  `security_invoker`). **Consecuencia de diseño:** esta fase NO
  implementa autocompletado/búsqueda en vivo contra `PADRON_SOCIOS`/
  `PADRON_PARCELAS` — `ID_Socio`/`ID_Parcela` se capturan como texto
  libre (igual que ya son columnas `text` sin FK declarada en
  `INSPECCIONES`). Un futuro `vw_padron_busqueda` (vista de solo
  columnas no-PII, otorgada a `anon` igual que `vw_monitoreo_web`)
  resolvería esto sin tocar RLS de las tablas madre — queda fuera de
  alcance aquí para no modificar políticas de una base compartida con
  otro repositorio sin coordinarlo explícitamente.
- **`INSPECCIONES`/`CAP_DATOS_SOCIO` sí son legibles vía anon key** (se
  confirmó una fila real en cada una) — el mismo patrón que ya usa
  `admin-fed/src/lib/supabase.ts` en el repo original.

## 3. Invariantes
- **Cero PII en consola.** El repo origen (`useInspeccionForm.ts`) deja
  `console.group`/`console.log(JSON.stringify(...))` con `socio_dni` y
  `socio_nombre_completo` en cada carga de formulario — un hallazgo de
  la propia auditoría (§5, ítem 8, "NO portar"). Esta implementación no
  debe registrar en consola ningún valor de `CAP_DATOS_SOCIO`,
  `FAMILIA`, ni ningún campo `*_dni`/`*_nombre*`; solo booleanos de
  éxito/error y códigos de error de Supabase (`error.code`/`error.message`,
  nunca `error.details` si pudiera ecoar el payload).
- **Validación con Zod + React Hook Form.** Mismo par que el repo origen
  (`react-hook-form` + `@hookform/resolvers/zod` + `zod`), agregado como
  dependencia nueva — no existía en `rysos` (proyecto JS puro sin
  librería de formularios). Es la validación explícitamente pedida por
  esta tarea, no una alternativa "equivalente" hecha a mano.
- **Filtrado Multi-Tenant.** La organización activa se resuelve de los
  registros de `INSPECCIONES` ya cargados (mismo patrón que
  `resolveOrganizationId` en `lib/eudrDdsExporter.js` — no hay sesión de
  usuario real en esta app, ver memoria de proyecto). Antes de cualquier
  `UPDATE`/`INSERT` sobre una inspección existente, se valida que su
  `ID_Organizacion` coincida con la organización resuelta — igual
  patrón de defensa en profundidad que `lib/eudrQcActions.js`.
- **Nunca se escribe sobre las tablas madre del padrón.** Esta fase es
  estrictamente de solo lectura sobre `PADRON_SOCIOS`/`PADRON_PARCELAS`/
  `ORGANIZACIONES` (de hecho, ni siquiera lectura directa es posible, ver
  §2) — todo el `INSERT`/`UPDATE` ocurre sobre `INSPECCIONES` y sus 6
  tablas `CAP_*`, exactamente el mismo set de tablas que ya escribe
  `backend-inspecciones`, sin tocar el padrón compartido.
- **Patrón UPDATE-si-existe/INSERT-si-no por tabla hija**, portado de
  `useInspeccionForm.ts` (Alta Prioridad #2 de la auditoría): necesario
  porque inspecciones antiguas (creadas desde AppSheet/la app anterior)
  pueden no tener fila en alguna tabla `CAP_*` todavía.

## 4. Criterios de Aceptación
- [x] `/dashboard/inspecciones` lista inspecciones (paginado, búsqueda)
      — verificado en vivo con datos reales.
- [x] `/dashboard/inspecciones/[id]/editar` carga las 7 tablas en
      paralelo y muestra las 8 pestañas — verificado en vivo con una
      inspección real existente.
- [ ] `/dashboard/inspecciones/nueva` crea una fila en `INSPECCIONES` +
      las 6 tablas `CAP_*` en un solo submit — **código completo, pero
      bloqueado en vivo por falta de política RLS de `INSERT` para
      `anon`** (ver hallazgo crítico arriba). No marcable como cumplido
      hasta que exista esa política.
- [ ] Guardar cambios sobre una inspección existente (UPDATE) —
      **no verificado en vivo** (se evitó deliberadamente escribir sobre
      un registro real de un socio real); el código replica el patrón ya
      usado por `backend-inspecciones`, pero queda pendiente de una
      prueba real una vez exista una política RLS de `UPDATE`.
- [x] Ningún `console.log`/`console.group` en todo el módulo expone
      `socio_dni`, `socio_nombre_completo`, `conyuge_dni`,
      `conyuge_nombre`, ni ningún campo de `FAMILIA` — verificado por
      grep (cero coincidencias) tras remover los logs de diagnóstico
      usados para encontrar el hallazgo RLS de arriba.
- [x] Intentar guardar una inspección cuyo `ID_Organizacion` no coincide
      con la organización resuelta lanza `InspeccionError` antes de
      llamar a Supabase (revisión de código: `saveInspeccion` en
      `lib/inspeccionesActions.js`).
- [x] `npm run build` compila sin errores.
