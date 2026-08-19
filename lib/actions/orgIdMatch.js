// Comparación de ID_Organizacion tolerante a espacios/mayúsculas — usada
// por lib/actions/sociosActions.js para validar pertenencia multi-tenant
// sin falsos positivos por diferencias de formato entre el valor resuelto
// del lado del cliente y el guardado en la fila real. Nunca se usa para
// escribir/guardar — solo para comparar.
//
// En archivo separado (no dentro de sociosActions.js, que tiene
// 'use server') para poder testear esta lógica directo con node --test,
// mismo motivo que lib/actions/socioActionError.js.

export function normalizeOrgId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value
}

export function orgIdsMatch(a, b) {
  return normalizeOrgId(a) === normalizeOrgId(b)
}
