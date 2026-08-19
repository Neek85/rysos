// Schemas Zod para el Padrón Web de Socios y Fincas (/dashboard/socios).
// Columnas verificadas contra PADRON_SOCIOS/PADRON_PARCELAS en vivo antes
// de escribir esto (ver specs/padron_web_socios.md) — no hay columna
// `sector`; existen 8 flags de certificación individuales + `cert_org_estatus`.

import { z } from 'zod'

const str = z.string().optional().nullable()
const num = z.coerce.number().optional().nullable()
// Hectáreas por categoría de uso (PADRON_PARCELAS) — no tiene sentido
// agronómico un área negativa; rechazado explícitamente en vez de solo
// restringirlo visualmente con min="0" en el input.
const nonNegativeNum = z.coerce.number().min(0, 'No puede ser negativo').optional().nullable()
const siNo = z.enum(['Sí', 'No']).optional().nullable().or(z.literal(''))

// DNI peruano observado en los datos reales: 8 dígitos.
const dni = z
  .string()
  .regex(/^\d{8}$/, 'DNI debe tener 8 dígitos')
  .optional()
  .nullable()
  .or(z.literal(''))

// Celular peruano: 9 dígitos (formato de línea móvil nacional, ej. 9XXXXXXXX).
const celular = z
  .string()
  .regex(/^\d{9}$/, 'Celular debe tener 9 dígitos')
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
  celular_socio: celular,
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
// Labels compartidos entre ParcelaFormModal (grilla de hectáreas) y
// lib/padronCsv.js (encabezados humanizados de export/import) — una sola
// fuente para no dejar que los dos textos diverjan con el tiempo.
export const HECTARE_FIELDS = [
  { field: 'hcp', label: 'Ha. Café Podado' },
  { field: 'hcc', label: 'Ha. Café en Crecimiento' },
  { field: 'ho', label: 'Ha. Otros' },
  { field: 'hip', label: 'Ha. Infraestructura Productiva' },
  { field: 'hrp', label: 'Ha. Reserva/Protección' },
  { field: 'hbp', label: 'Ha. Bosque Protector' },
  { field: 'otros_cultivo', label: 'Ha. Otros Cultivos' },
]

export const HECTARE_FIELD_KEYS = HECTARE_FIELDS.map((f) => f.field)

export const parcelaSchema = z
  .object({
    ID_Parcela_Fija: z.string().min(1, 'Requerido'),
    ID_Socio: z.string().min(1, 'Selecciona un socio'),
    parcela_codigo: str,
    parcela_nombre: str,
    hcp: nonNegativeNum,
    hcc: nonNegativeNum,
    ho: nonNegativeNum,
    hip: nonNegativeNum,
    hrp: nonNegativeNum,
    hbp: nonNegativeNum,
    otros_cultivo: nonNegativeNum,
  })
  // Una parcela sin ninguna hectárea registrada (total 0 o negativo, aunque
  // el min(0) por campo ya bloquea lo negativo individualmente) no tiene
  // sentido agronómico como registro — se rechaza acá, a nivel de objeto,
  // porque ningún campo individual por sí solo puede expresar "la suma de
  // todos debe ser > 0". El error se ancla a `hcp` (primer campo de
  // hectáreas) para que se muestre junto a la grilla de hectáreas en el UI.
  .refine(
    (data) => HECTARE_FIELD_KEYS.reduce((sum, key) => sum + (Number(data[key]) || 0), 0) > 0,
    { message: 'El total de hectáreas debe ser mayor a 0.00 ha.', path: ['hcp'] }
  )

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
