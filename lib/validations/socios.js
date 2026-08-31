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

// DNI peruano observado en los datos reales: 8 dígitos. Sigue OPCIONAL --
// usado hoy solo por conyuge_dni (socio_dni tiene su propia versión
// obligatoria, ver dniRequerido más abajo, mejoras_importador_padron_masivo.md
// ronda 3).
const dni = z
  .string()
  .regex(/^\d{8}$/, 'DNI debe tener 8 dígitos')
  .optional()
  .nullable()
  .or(z.literal(''))

// socio_dni: obligatorio (mejoras_importador_padron_masivo.md ronda 3,
// hallazgo de la primera carga real de producción, COOP-AROMAS-VALLE) --
// a diferencia de `dni` (arriba, sigue opcional para conyuge_dni), una
// fila sin DNI o con menos/más de 8 dígitos queda inválida (rechazo de
// FILA, no de archivo completo -- eso lo resuelve socioSchema.safeParse
// por fila en validateSocioRows, no un chequeo aparte).
const dniRequerido = z.string().min(1, 'Requerido').regex(/^\d{8}$/, 'DNI debe tener 8 dígitos')

// Celular peruano: 9 dígitos (formato de línea móvil nacional, ej. 9XXXXXXXX).
// Confirmado sin cambios en esta ronda (mejoras_importador_padron_masivo.md
// ronda 3, punto 1d) -- ya validaba esto desde antes.
const celular = z
  .string()
  .regex(/^\d{9}$/, 'Celular debe tener 9 dígitos')
  .optional()
  .nullable()
  .or(z.literal(''))

// Fecha de nacimiento: formato ÚNICO y determinístico M/D/AAAA (mes
// primero), SIN exigir ceros de relleno -- corregido en
// mejoras_importador_padron_masivo.md ronda 4 (2026-09-01), reemplaza el
// diseño "acepta D/M o M/D indistintamente" de la ronda 3.
//
// Por qué se corrigió: "aceptar ambos órdenes, el que sea válido" es
// AMBIGUO y silenciosamente incorrecto para cualquier fecha donde las dos
// partes son ≤12 (ej. "3/4/1990" -- ¿4 de marzo o 3 de abril? ambas son
// fechas válidas, no hay forma de saberlo sin más contexto) -- ese diseño
// nunca se equivocaba de forma RUIDOSA (rechazando), se equivocaba de
// forma SILENCIOSA (aceptando con una interpretación arbitraria que
// podía estar invertida). La evidencia real (ver sección 0 del spec, sin
// cambios en esta ronda) sigue siendo la misma: la primera carga real
// (COOP-AROMAS-VALLE, 618 socios) trae fechas en M/D/AAAA sin padding
// (ej. "4/29/1986" = 29 de abril -- inequívoco, 29 no puede ser mes) --
// nunca hubo evidencia real de D/M en este dataset, así que ya no hace
// falta tolerarlo. Un valor en orden D/M (ej. "29/4/1986", día primero)
// ahora se RECHAZA explícito como formato inválido -- si esto retira
// filas reales previamente aceptadas, es la señal correcta: esa fecha no
// se puede resolver sin ambigüedad, hay que corregirla en el Excel de
// origen sabiendo que el sistema espera mes primero.
const FECHA_NACIMIENTO_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const fechaNacimiento = z
  .string()
  .optional()
  .nullable()
  .or(z.literal(''))
  .refine(
    (val) => {
      if (!val) return true
      const match = val.match(FECHA_NACIMIENTO_REGEX)
      if (!match) return false
      const month = Number(match[1])
      const day = Number(match[2])
      return month >= 1 && month <= 12 && day >= 1 && day <= 31
    },
    { message: 'Formato de fecha inválido (usar M/D/AAAA, mes primero, ej. 4/29/1986)' }
  )

export const socioSchema = z.object({
  // ID_Socio: código manual (ej. "JS-00001"), no autogenerado — mismo
  // esquema de numeración que ya usa el padrón real. Requerido siempre;
  // en edición el campo queda deshabilitado en la UI (no se permite
  // cambiar la PK de un registro existente).
  ID_Socio: z.string().min(1, 'Requerido'),
  codigo_finca: str,
  socio_nombre_completo: z.string().min(1, 'Requerido'),
  socio_dni: dniRequerido,
  socio_genero: str,
  socio_fecha_nacimiento: fechaNacimiento,
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
// `codigo` (ADR-027): agregado sin romper a los 2 consumidores que ya
// desestructuraban { field, label } (SocioFormModal.jsx, page.jsx) —
// mapea 1:1 a CERTIFICACIONES_CATALOGO.codigo, mismo valor sembrado en
// supabase/migrations/20260825222933_certificaciones_normalizadas.sql,
// citado literal en specs/padron_certificaciones_normalizado.md sección
// 7.3. Los flags/formulario NO cambiaron de forma -- createSocio/
// updateSocio (lib/actions/sociosActions.js) siguen leyendo estos mismos
// 8 campos del payload, pero ya no los escriben como columnas planas:
// los traducen a filas de SOCIO_CERTIFICACIONES vía este `codigo`.
export const CERT_FLAG_FIELDS = [
  { field: 'cert_nop_usda', label: 'NOP USDA', codigo: 'NOP_USDA' },
  { field: 'ue_2018_848', label: 'UE 2018/848', codigo: 'UE_2018_848' },
  { field: 'cor_canada', label: 'COR Canadá', codigo: 'COR_CANADA' },
  { field: 'cert_ds_0442006_ag', label: 'DS 044-2006-AG', codigo: 'DS_0442006_AG' },
  { field: 'cert_lpo_mx', label: 'LPO México', codigo: 'LPO_MX' },
  { field: 'cert_rainforest', label: 'Rainforest Alliance', codigo: 'RAINFOREST' },
  { field: 'cert_comercio_justo', label: 'Comercio Justo', codigo: 'COMERCIO_JUSTO' },
  { field: 'cert_fair_trade_usa', label: 'Fair Trade USA', codigo: 'FAIR_TRADE_USA' },
]

// Las 5 certificaciones de tipo "equivalencia orgánica" (distintos
// mercados: EE.UU./UE/Canadá/México x2) — usadas por createSocio/
// updateSocio para decidir a qué filas de SOCIO_CERTIFICACIONES copiarles
// `cert_org_estatus` como `estado` (mismo criterio que el backfill de la
// migración, ver specs/padron_certificaciones_normalizado.md sección
// 3.4 -- interpretación de "certificación Orgánica" documentada ahí, con
// su evidencia real de respaldo, no una lectura literal de ningún nombre
// de catálogo).
export const ORGANIC_CERT_CODES = ['NOP_USDA', 'UE_2018_848', 'COR_CANADA', 'DS_0442006_AG', 'LPO_MX']

// ── Parcela ──────────────────────────────────────────────────────────
// hcp/hcc/ho/hip/hrp/hbp/otros_cultivo: hectáreas por categoría de uso
// (nomenclatura heredada del schema real, ver spec). totalh se calcula
// automáticamente como la suma (ver lib/actions/sociosActions.js) — no es
// un campo editable del formulario.
// Labels compartidos entre ParcelaFormModal (grilla de hectáreas) y
// lib/padronCsv.js (encabezados humanizados de export/import) — una sola
// fuente para no dejar que los dos textos diverjan con el tiempo.
//
// ADR-028 (specs/multi_producto_cafe_cacao.md sección 5.1/8.6): hcp/hcc
// ya NO se rotulan "Café Podado"/"Café en Crecimiento" -- representan un
// concepto universal (en producción/en crecimiento), no exclusivo de
// café (decisión cerrada en la ronda 2, la columna física no cambia,
// solo el texto). ParcelaFormModal.jsx:80 y lib/padronCsv.js:75 heredan
// el label nuevo sin necesitar su propio cambio -- son la única fuente
// de verdad, no duplicada en ningún otro lado (confirmado por grep antes
// de este cambio).
// mejoras_importador_padron_masivo.md ronda 3 (2026-08-31, pedido
// explícito del usuario tras la primera carga real): hip/hrp NO
// representaban lo que su label decía -- el dato real que la cooperativa
// carga en esas 2 columnas es "Invernadero/Pasto" y "Rastrojo/Purma", no
// "Infraestructura Productiva"/"Reserva/Protección". Solo cambia el
// LABEL (texto de display en CSV/formulario) -- las columnas físicas
// siguen siendo `hip`/`hrp`, sin migración de esquema ni renombre de
// campo técnico.
export const HECTARE_FIELDS = [
  { field: 'hcp', label: 'Ha. En Producción' },
  { field: 'hcc', label: 'Ha. En Crecimiento' },
  { field: 'ho', label: 'Ha. Otros' },
  { field: 'hip', label: 'Ha. Invernadero/Pasto' },
  { field: 'hrp', label: 'Ha. Rastrojo/Purma' },
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
    // ADR-028: dato maestro editable, uuid FK -> PRODUCTOS. '' del <select>
    // sin selección se normaliza a null en parcelaPayload (sociosActions.js),
    // nunca se guarda como string vacío.
    id_producto_predominante: z.string().uuid().optional().nullable().or(z.literal('')),
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
  id_producto_predominante: '',
}
