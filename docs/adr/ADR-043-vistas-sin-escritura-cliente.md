# ADR-043 — Vistas de `public` sin escritura para clientes; `USUARIOS_LOGIN` sin acceso de cliente

**Fecha:** 2026-10-07
**Estado:** Propuesto — migraciones redactadas y probadas en texto, **NO aplicadas**
(las aplica Neyser en Supabase Studio)
**Redactado por:** Claude (Cowork), Arquitecto Senior RYZOS; copiado y verificado
por Claude Code CLI (huellas sha256 coincidentes). Revisión de seguridad
pendiente de la aplicación y del test de catálogo.

## Contexto

Una auditoría de solo lectura de catálogos (2026-10-07, `supabase db query
--linked` según ADR-042; sin sondas de escritura) encontró:

1. `public."USUARIOS_LOGIN"` es una vista sin filtro ni `security_invoker`,
   dueña `postgres`, sobre `USUARIOS` (RLS activada pero no forzada). `anon` y
   `authenticated` tienen `arwdDxtm` sobre ella: pueden leer, insertar,
   actualizar y borrar DNI, teléfono, email, rol, activo y firma digital de
   todos los usuarios. La llave `anon` es pública. El repo no la usa.
2. Los `GRANT` por defecto de Supabase (`pg_default_acl`) dan `arwdDxtm` a
   `anon`, `authenticated` y `service_role` en toda tabla o vista nueva de
   `public`. Las 28 vistas de `postgres` los tienen. Las vistas de una sola
   tabla son auto-actualizables y corren con los privilegios de su dueño: la
   escritura a través de la vista se salta la RLS de la tabla base. Caso
   confirmado: `vw_pecuario_lotes_etapa` (sin `WITH CHECK OPTION`): `anon`
   puede insertar; `authenticated` puede insertar en cualquier organización y
   reasignar el `ID_Organizacion` de filas propias.
3. El repo no escribe a ninguna vista (JS/TS, Python/`rest/v1`, SQL, tests);
   solo las lee.

## Decisión

1. **`REVOKE` de escritura, no `security_invoker`.**
   - `20261008091000_seguridad_vistas_sin_escritura_cliente.sql`: para toda
     vista de `public`, dueña `postgres` y no de extensión, `REVOKE INSERT,
     UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` a `PUBLIC`, `anon` y
     `authenticated`. No toca `SELECT`, `postgres` ni `service_role`. Verifica
     y aborta si queda alguna escritura.
   - `20261008090000_seguridad_usuarios_login_sin_acceso_cliente.sql`:
     `REVOKE ALL` sobre `USUARIOS_LOGIN` a `PUBLIC`, `anon` y `authenticated`
     (cierra también la lectura).
2. **No se usa `security_invoker`** en las vistas que lee la web: el dashboard
   (`vw_monitoreo_*`, `view_eudr_dashboard_aprobados`) usa solo la llave
   `anon` sin sesión y depende de que las vistas corran como `postgres`
   (gotcha de RLS de `CLAUDE.md`). Con `security_invoker` esas lecturas
   devolverían 0 filas.
3. **Test de catálogo permanente** `tests/test_seguridad_vistas_sin_escritura.py`:
   falla si una vista (no de extensión) concede escritura a `anon`,
   `authenticated` o `PUBLIC`, si `USUARIOS_LOGIN` concede algo a clientes, o
   si "se arregla de más" (las 4 vistas que la web lee con `anon` deben
   conservar `SELECT`; las `vw_pecuario_*` también para `authenticated`). Se
   omite si el CLI no está enlazado (p. ej. CI).
4. **Reversa** fuera de `migrations/`: `supabase/rollbacks/20261008090000_seguridad_rollback.sql`
   (reabre la fuga; solo emergencia), con el ACL exacto previo tomado del
   snapshot de solo lectura.

## Consecuencias

- Tras aplicar: `anon` y `authenticated` conservan solo `SELECT` (en las vistas
  que ya lo tenían); `USUARIOS_LOGIN` queda sin acceso de cliente; `postgres` y
  `service_role` sin cambios; ninguna columna ni definición de vista cambia.
- Las lecturas de la web (anon) y de la app Expo (authenticated) no cambian.
- Cualquier herramienta externa que escribiera en `USUARIOS_LOGIN` con la llave
  `anon` o una sesión `authenticated` (p. ej. AppSheet) dejaría de funcionar;
  la cabecera de la migración registra que Neyser debe confirmar, antes de aplicar, que no hay ninguna (no verificable desde el repo).

## Riesgo residual

- `pg_default_acl` **no se cambia**: toda vista o tabla nueva (y las recreadas
  con `DROP VIEW` + `CREATE VIEW`) vuelve a nacer con todos los permisos. Lo
  vigila el test de catálogo; hay que agregar un `REVOKE` en la migración de
  cada vista nueva.
- Fuera de alcance, tareas aparte: las 4 tablas de `public` sin RLS
  (`CONFIGURACION_REPORTES_ORG`, `MENU_APP`, `METADATOS_CAMPOS`,
  `spatial_ref_sys`) con permisos totales para `anon`, y las políticas de
  `SELECT` permisivas de `anon` (`id_organizacion IS NOT NULL`) en
  `ORGANIZACION_CERTIFICACIONES`, `ORGANIZACION_PRODUCTOS`,
  `PARCELA_CERTIFICACIONES` y `SOCIO_CERTIFICACIONES`.
- Las vistas siguen corriendo como `postgres` y saltándose la RLS al leer; solo
  las filtra a mano `auth_org_id()` (19 de 26). `vw_monitoreo_*` es abierta por
  diseño.
