// Helpers de consulta sobre lib/data/ubigeo_peru.json — funciones puras
// (nombre -> lista de nombres), usadas por
// components/features/socios/UbigeoSelect.jsx para los desplegables en
// cascada Departamento -> Provincia -> Distrito. Ver la nota de fuente/
// confianza de los datos en el propio JSON (_meta).

import ubigeoData from './data/ubigeo_peru.json' with { type: 'json' }

export function getDepartamentos() {
  return ubigeoData.departamentos.map((d) => d.nombre).sort((a, b) => a.localeCompare(b))
}

export function getProvincias(departamentoNombre) {
  if (!departamentoNombre) return []
  const dep = ubigeoData.departamentos.find((d) => d.nombre === departamentoNombre)
  return dep ? [...dep.provincias.map((p) => p.nombre)].sort((a, b) => a.localeCompare(b)) : []
}

export function getDistritos(departamentoNombre, provinciaNombre) {
  if (!departamentoNombre || !provinciaNombre) return []
  const dep = ubigeoData.departamentos.find((d) => d.nombre === departamentoNombre)
  if (!dep) return []
  const prov = dep.provincias.find((p) => p.nombre === provinciaNombre)
  return prov ? [...prov.distritos].sort((a, b) => a.localeCompare(b)) : []
}
