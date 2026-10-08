// Fecha operativa de la granja: la fecha de calendario en America/Lima (UTC-5 fijo,
// sin horario de verano), igual que fn_hoy_operativo() en la base (migración
// 20261008100000). Determinista: sin Intl, sin depender de la zona del teléfono y sin
// librerías. Reemplaza las copias locales de hoyISO() (que devolvían el día en UTC: entre
// las 19:00 y las 24:00 de Lima ya era "mañana"). Solo para FECHAS DE CALENDARIO del día
// (columnas `date`); los instantes (created_offline_at, timestamps) siguen siendo ISO
// completos con new Date().toISOString().
// specs/app_fecha_operativa_lima.md

const OFFSET_LIMA_MS = 5 * 3600 * 1000

/** YYYY-MM-DD de Lima para un instante (epoch ms). Por defecto, ahora. */
export function hoyOperativo(ahora: number = Date.now()): string {
  return new Date(ahora - OFFSET_LIMA_MS).toISOString().slice(0, 10)
}
