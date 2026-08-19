// Schemas Zod para el Padrón Web de Socios y Fincas (/dashboard/socios).
// Columnas verificadas contra PADRON_SOCIOS/PADRON_PARCELAS en vivo antes
// de escribir esto (ver specs/padron_web_socios.md) — no hay columna
// `sector`; existen 8 flags de certificación individuales + `cert_org_estatus`.

import { z } from 'zod'

const str = z.string().optional().nullable()
const num = z.coerce.number().optional().nullable()
const siNo = z.enum(['Sí', 'No']).optional().nullable().or(z.literal(''))

// DNI peruano observado en los datos reales: 8 dígitos.
const dni = z
  .string()
  .regex(/^\d{8}$/, 'DNI debe tener 8 dígitos')
  .optional()
  .nullable()
  .or(z.literal(''))

export const socioSchema = z.object({
  // ID_Socio: código manual (ej. "JS-00001"), no autogenerado — mismo
  // esquema de numeración que ya usa el padrón real. Requerido siempre;
  // en edición el campo queda deshabilitado en la UI (no se permite
  // cambiar la PK de un registro existente).
  ID_Socio: z.string().min(1, 'Requerido'),
  codigo_finca: str,
  socio_nombre_completo: z.string().min(1, 'Requerido'),
  socio_dni: dni,
  socio_genero: str,
  socio_fecha_nacimiento: str,
  celular_socio: str,
  conyuge_nombre: str,
  conyuge_dni: dni,
  socio_departamento: str,
  socio_provincia: str,
  socio_distrito: str,
  localidad: str,
  certificaciones: str,
  cert_org_estatus: str,
  cert_nop_usda: siNo,
  ue_2018_848: siNo,
  cor_canada: siNo,
  cert_ds_0442006_ag: siNo,
  cert_lpo_mx: siNo,
  cert_rainforest: siNo,
  cert_comercio_justo: siNo,
  cert_fair_trade_usa: siNo,
  socio_fecha_ingreso: str,
})

export const SOCIO_DEFAULT_VALUES = {
  ID_Socio: '',
  codigo_finca: '',
  socio_nombre_completo: '',
  socio_dni: '',
  socio_genero: '',
  socio_fecha_nacimiento: '',
  celular_socio: '',
  conyuge_nombre: '',
  conyuge_dni: '',
  socio_departamento: '',
  socio_provincia: '',
  socio_distrito: '',
  localidad: '',
  certificaciones: '',
  cert_org_estatus: '',
  cert_nop_usda: '',
  ue_2018_848: '',
  cor_canada: '',
  cert_ds_0442006_ag: '',
  cert_lpo_mx: '',
  cert_rainforest: '',
  cert_comercio_justo: '',
  cert_fair_trade_usa: '',
  socio_fecha_ingreso: '',
}

// Las 8 columnas de certificación booleana — usado tanto por el form
// (para renderizar los 8 <select> Sí/No) como por el filtro de la tabla.
export const CERT_FLAG_FIELDS = [
  { field: 'cert_nop_usda', label: 'NOP USDA' },
  { field: 'ue_2018_848', label: 'UE 2018/848' },
  { field: 'cor_canada', label: 'COR Canadá' },
  { field: 'cert_ds_0442006_ag', label: 'DS 044-2006-AG' },
  { field: 'cert_lpo_mx', label: 'LPO México' },
  { field: 'cert_rainforest', label: 'Rainforest Alliance' },
  { field: 'cert_comercio_justo', label: 'Comercio Justo' },
  { field: 'cert_fair_trade_usa', label: 'Fair Trade USA' },
]

// ── Parcela ──────────────────────────────────────────────────────────
// hcp/hcc/ho/hip/hrp/hbp/otros_cultivo: hectáreas por categoría de uso
// (nomenclatura heredada del schema real, ver spec). totalh se calcula
// automáticamente como la suma (ver lib/actions/sociosActions.js) — no es
// un campo editable del formulario.
export const parcelaSchema = z.object({
  ID_Parcela_Fija: z.string().min(1, 'Requerido'),
  ID_Socio: z.string().min(1, 'Selecciona un socio'),
  parcela_codigo: str,
  parcela_nombre: str,
  hcp: num,
  hcc: num,
  ho: num,
  hip: num,
  hrp: num,
  hbp: num,
  otros_cultivo: num,
})

export const PARCELA_DEFAULT_VALUES = {
  ID_Parcela_Fija: '',
  ID_Socio: '',
  parcela_codigo: '',
  parcela_nombre: '',
  hcp: null,
  hcc: null,
  ho: null,
  hip: null,
  hrp: null,
  hbp: null,
  otros_cultivo: null,
}
