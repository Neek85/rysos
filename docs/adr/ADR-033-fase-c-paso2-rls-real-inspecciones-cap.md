# ADR-033 — Aislamiento real por organización en `INSPECCIONES` + las 6 `CAP_*`, cierre completo de `anon` (Fase C Paso 2)

- **Estado:** Implementado — aplicado y commiteado a `staging` (`27f0504`).
- **Migraciones:**
  `supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`
  (nueva, este ADR). **Supersede** (no complementa) a
  `20260901150000_lock_anon_write_inspecciones_cap.sql` y
  `20260901150100_lock_anon_all_inspecciones_cap.sql` — ver "Relación
  con las migraciones de contención" abajo.
- **Código:** ninguno tocado por esta migración — pero ver "Hallazgo
  colateral" abajo, que sí requiere un cambio de código para que el
  flujo real de creación funcione de nuevo.
- **Tests:** ninguno nuevo. Verificación hecha con consultas de solo
  lectura contra la instancia real (`pg_proc`, `information_schema`,
  lectura de código) a lo largo de varias tareas de esta misma sesión —
  ver "Verificación previa" abajo.
- **Contexto previo:** `ADR-031` (mismo patrón — política `anon`
  efectivamente sin restricción real — resuelto para
  `PADRON_SOCIOS`/`PADRON_PARCELAS`; su sección final, "Referencia para
  la fase 2 del incidente", es exactamente este ADR); `ADR-032`
  (limpieza de drift de políticas huérfanas en las mismas 7 tablas, ya
  aplicada); `specs/login_real_organizacion_rol.md` §6 (Fase C Paso 2).

## Contexto — el hallazgo (heredado de ADR-031, reconfirmado esta sesión)

`supabase/migrations/20260818_fix_inspecciones_rls.sql` dejó, en
`INSPECCIONES` y las 6 tablas `CAP_*`, políticas combinadas `FOR ALL TO
anon, authenticated` sin aislamiento real:

```sql
CREATE POLICY "rls_anon_all_inspecciones" ON public."INSPECCIONES"
FOR ALL TO anon, authenticated
USING ("ID_Organizacion" IS NOT NULL OR auth.role() = 'service_role' OR CURRENT_USER = 'postgres')
WITH CHECK (...misma condición...);

CREATE POLICY "rls_anon_all_cap_mic" ON public."CAP_MIC"
FOR ALL TO anon, authenticated
USING (true) WITH CHECK (true);  -- y análogo en las otras 5 CAP_*
```

`"ID_Organizacion" IS NOT NULL` es cierto para cualquier fila con ese
campo cargado, de cualquier organización — sin restricción real. Las 6
`CAP_*` no tienen ni siquiera esa condición: `USING (true)` sin nada que
filtrar. Reconfirmado esta sesión (tarea de reconocimiento previa): las
6 `CAP_*` no tienen columna `"ID_Organizacion"` propia — su único
vínculo a organización es indirecto, vía `"ID_Inspeccion"` (FK a
`INSPECCIONES`).

## Verificación previa (esta sesión, antes de diseñar la política)

1. **¿`authenticated` corre hoy el guardado real, o sigue siendo
   `anon`?** Confirmado por lectura de código (no se pudo hacer login
   real — ver nota abajo): `useInspeccionForm.js` usa
   `getSupabaseBrowserClient()` (cliente de sesión, `@supabase/ssr`,
   cookies) tanto para cargar (`fetchInspecciones`/
   `fetchInspeccionDetalle`) como para guardar (`saveInspeccion`) — no
   el cliente `anon` (`getSupabaseClient()`). `/login` (`app/login/
   page.jsx`) llama `signInWithPassword` sobre ese mismo tipo de
   cliente. Una vez logueado, `@supabase/ssr` manda el JWT de sesión
   real (`role: authenticated`) en el header `Authorization` de cada
   request — comportamiento estándar de la librería, confirmado en el
   código fuente del proyecto, no inferido de documentación externa.
2. **¿Alcanza un `EXISTS` contra `INSPECCIONES` para las 6 `CAP_*`, o
   hace falta una columna propia?** Confirmado con
   `information_schema.columns` contra la instancia real: ninguna de
   las 6 tiene columna de organización propia; `"ID_Inspeccion"` es
   `text` en las 6, coincide con `INSPECCIONES."ID_Inspeccion"` (`text`,
   tras el fix de `20260903045407`). Un `EXISTS` vía `ID_Inspeccion` es
   la única vía posible — no hay atajo de columna.
3. **¿El orden de escritura de `fn_guardar_inspeccion_completa()`
   garantiza que el `EXISTS` encuentre la fila de `INSPECCIONES`?**
   Confirmado línea por línea contra el cuerpo completo de la función
   (`20260903045407_fix_tipo_id_inspeccion.sql`): en la rama de
   creación, `INSERT INTO INSPECCIONES` ocurre antes del bloque
   compartido de 6 `DELETE`+`INSERT` de `CAP_*`; en la rama de edición,
   `UPDATE INSPECCIONES` ocurre antes del mismo bloque. Ambas ramas
   convergen en el mismo código de `CAP_*`, sin `IF`/`ELSE` interno. La
   función es un único `BEGIN...END` `plpgsql`, sin subtransacciones,
   `SAVEPOINT` ni `COMMIT` intermedio — un `INSERT`/`UPDATE` es visible
   a las sentencias siguientes de la misma transacción por comportamiento
   estándar de Postgres. El `EXISTS` de las políticas de este ADR
   siempre encuentra la fila.
4. **¿`auth_org_id()` resuelve un valor real para las cuentas ya
   provisionadas?** Confirmado contra `pg_proc` (`pg_get_functiondef`):
   la función vive en la instancia real, definición idéntica a
   `20260902213506_login_fase_a_identidad.sql` (resuelve desde
   `PERFILES_USUARIO_INTERNOS` por `auth.uid()`+`activo=true`, con
   fallback a un claim JWT legacy que hoy siempre da `NULL`).
   `PERFILES_USUARIO_INTERNOS` tiene 5 filas activas (las cuentas de
   Fase D Paso 1) — cualquiera de esas 5 sesiones reales resolvería su
   organización correctamente.
5. **Grants de tabla:** `anon` y `authenticated` tienen hoy
   `SELECT`/`INSERT`/`UPDATE`/`DELETE` completos en las 7 tablas (sin
   diferencia entre roles) — esta migración no necesita tocar `GRANT`,
   solo `RLS`.

**Nota sobre el punto 1:** un login real de punta a punta con captura de
red (JWT visible) no se pudo completar en esta sesión — la contraseña
de la cuenta demo usada en el aprovisionamiento anterior no estaba
disponible en este contexto, y resetearla vía Admin API fue bloqueado
por el clasificador de auto-mode; el arquitecto eligió verificación
estática de código en su lugar. La conclusión del punto 1 tiene alta
confianza (se apoya en comportamiento documentado y estándar de
`@supabase/ssr`, no en lógica propia del repo que pudiera tener un bug),
pero no es una prueba capturada en vivo.

## Por qué esto no repite el error que ADR-031 advirtió evitar

ADR-031 cierra con una advertencia explícita para quien implementara
esta fase: cerrar la escritura `anon` sin un reemplazo real "rompe el
guardado de inspecciones por completo", porque
`fn_guardar_inspeccion_completa()` no es `SECURITY DEFINER` (a
diferencia de las 10 funciones de lectura de ADR-031) — corre con el rol
del llamador.

Este diseño no cae en esa trampa porque **el reemplazo ya existe y ya
está verificado**: no es una función `SECURITY DEFINER` nueva (patrón de
ADR-031), es la política de `authenticated` misma, que ya tiene acceso
de escritura completo a las 7 tablas (grants confirmados en el punto 5)
y ya es el rol real que ejecuta el guardado desde Fase C Paso 1 (punto
1). Cerrar `anon` no apaga el módulo — el módulo ya dejó de depender de
`anon` para escribir, esta migración solo lo hace explícito y lo hace
cumplir con una condición de organización real en vez de un `IS NOT
NULL`/`true` vacío.

## Decisión

Por cada una de las 7 tablas: `DROP` de la política combinada
`anon`+`authenticated` (y de cualquier nombre de las 2 generaciones de
migraciones de contención sin aplicar, ver abajo), reemplazada por 2
políticas separadas por rol:

- **`anon`:** `FOR ALL ... USING (false) WITH CHECK (false)` — deniega
  todo (lectura, escritura, borrado), sin excepción. Distinto de la
  mitigación parcial de `20260901150000` (que solo cerraba escritura,
  dejaba `SELECT` abierto).
- **`authenticated`:** `FOR ALL`, con la condición real:
  - `INSPECCIONES`: `"ID_Organizacion" = public.auth_org_id()`.
  - Las 6 `CAP_*`: `EXISTS (SELECT 1 FROM public."INSPECCIONES" i WHERE
    i."ID_Inspeccion" = "<tabla>"."ID_Inspeccion" AND
    i."ID_Organizacion" = public.auth_org_id())`.
  - Las 3 con `OR auth.role() = 'service_role' OR current_user =
    'postgres'` (mismo fallback que la política original, preserva el
    acceso de scripts/Server Actions con Service Role Key y de
    conexiones directas como `postgres`).

Nombres nuevos: `rls_anon_deny_inspecciones` /
`rls_write_inspecciones_authenticated`, y análogos
`rls_anon_deny_cap_<tabla>` / `rls_write_cap_<tabla>_authenticated` para
las 6 `CAP_*` — deliberadamente distintos de los nombres usados por las
migraciones de contención (ver abajo) salvo por los 7 `rls_anon_deny_*`,
que coinciden literalmente con los de `20260901150100` (mismo nombre,
`USING (false)` idéntico en ambos casos — no es un problema en sí, pero
sí crea el riesgo de colisión que se explica a continuación).

## Relación con las migraciones de contención de emergencia

`20260901150000` (cierra solo escritura `anon`, dispara el "apagón" que
ADR-031 advirtió) y `20260901150100` (cierra lectura+escritura `anon`,
mismo apagón) siguen preparadas en el repo, **sin aplicar**. Ninguna de
las dos da aislamiento real — ambas usan la misma condición vacía
(`IS NOT NULL` / `true`) para `authenticated`, solo restringida a un rol
distinto del de `anon`.

Esta migración **las reemplaza por completo**, no las complementa. Hace
`DROP POLICY IF EXISTS` defensivo de los nombres de las 3 generaciones
(original de `20260818`, parcial de `150000`, completa de `150100`) para
poder aplicarse sin importar cuál esté vigente al momento real — pero
**`150000`/`150100` no deberían aplicarse nunca junto con, ni después
de, esta migración**: sus políticas `rls_anon_deny_*` usan el mismo
nombre literal que las de esta migración (confirmado con `grep` — mismo
nombre en las 7 tablas), así que un `CREATE POLICY` duplicado fallaría
con `42710` si `150100` se aplicara después. **Recomendación: archivar o
eliminar `20260901150000_lock_anon_write_inspecciones_cap.sql` y
`20260901150100_lock_anon_all_inspecciones_cap.sql` del repo una vez
esta migración se apruebe** — quedaron obsoletas por este diseño.

## Hallazgo colateral — bug preexistente, no causado por esta migración, que esta migración por sí sola NO resuelve

Durante la verificación del punto 1 (qué cliente usa el guardado real)
apareció un problema aparte, más urgente que el propio diseño de RLS:
**`resolveOrganizationId()`** (`lib/eudrDdsExporter.js`, reexportado
desde `lib/inspeccionesActions.js`) — la función que
`useInspeccionForm.js` usa para poblar `organizationId` (el valor que
se manda como `p_organizacion` a la RPC) — **deriva la organización
mirando los registros que `fetchInspecciones()` ya trajo, no la sesión
real**:

```js
export function resolveOrganizationId(records) {
  const ids = new Set(records.map(r => r?.ID_Organizacion).filter(Boolean))
  if (ids.size === 0) return null
  if (ids.size > 1) throw new EUDRValidationError(...)
  return [...ids][0]
}
```

Diseñada para un momento en que el frontend "no tenía todavía un
contexto de organización/autenticación propio" (comentario original del
archivo) — hoy ese contexto sí existe (`auth_org_id()`, Fase B/C), pero
esta función no fue actualizada para usarlo.

**Consecuencia real, verificada esta sesión:** `INSPECCIONES` está
vacía (0 filas — confirmado dos veces, `AI_STATE.md` `2026-09-03f`/`g`,
causa aún sin determinar). Con la tabla vacía, `fetchInspecciones`
siempre devuelve `rows: []`, `resolveOrganizationId([])` siempre
devuelve `null`, y `onSubmit` en `useInspeccionForm.js` nunca llega a
llamar la RPC — tira `'No se pudo determinar la organización activa.'`
antes de cualquier round-trip de red. **Esto es cierto HOY, antes de
esta migración, y seguirá siendo cierto después de aplicarla** — no es
un efecto de este cambio de RLS, es independiente de qué política esté
activa. La verificación funcional de `2026-09-03f` (que sí confirmó que
el fix uuid/text funciona) usó una llamada RPC directa con
`p_organizacion` explícito, sin pasar por `useInspeccionForm.js` — por
eso no lo destapó antes.

**No resuelto por este ADR, a propósito** (mismo criterio que los 2
pendientes de ADR-032): requiere decidir cómo debería resolverse
`organizationId` en el cliente ahora que existe sesión real (¿una nueva
consulta a `PERFILES_USUARIO_INTERNOS`/`auth_org_id()` equivalente
client-side? ¿pasar la organización activa por contexto de React desde
el login?) — cambio de código de app, no de RLS, y su propio diseño.
**Aplicar esta migración sin resolver esto deja el flujo de creación
real desde el navegador roto** (aunque ya lo estaba, por esta misma
razón, incluso con la RLS vieja) — se recomienda resolverlo antes o
junto con aplicar esta migración, no después, para no dar una falsa
sensación de "ya quedó todo cerrado".

## Fuera de alcance (heredado de ADR-032, sigue pendiente)

El drift más amplio en las 5 tablas EUDR/PADRON (políticas
`ryzos_all_*`/`rls_all_*` huérfanas) sigue sin resolver, sin relación
con este ADR.
