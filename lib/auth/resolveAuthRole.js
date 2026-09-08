// Resuelve el rol de la sesión real vía la RPC `auth_role()` (Fase A,
// specs/login_real_organizacion_rol.md) -- lógica compartida por los
// asserts de rol de cada dominio (lib/actions/sociosActions.js::assertAdminRole,
// lib/inspeccionesActions.js::assertInspeccionWriteRole). Cada dominio
// sigue dueño de su propio mensaje/tipo de error (SocioActionError,
// InspeccionError) -- esto solo evita duplicar la llamada RPC + manejo
// de error, no fuerza una firma común entre dominios con errores
// distintos.
export async function resolveAuthRole(supabase) {
  const { data: rol, error } = await supabase.rpc('auth_role')
  if (error) throw error
  return rol
}
