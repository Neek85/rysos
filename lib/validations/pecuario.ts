import { z } from 'zod';

// CORRECCIÓN clave respecto al diseño original (Gemini): ID_Organizacion es
// un código de negocio en texto (ej. "COOP-AROMAS-VALLE"), NO un uuid —
// confirmado contra ORGANIZACIONES."ID" en docs/schema_live.md. Usar
// z.string().uuid() aquí habría rechazado silenciosamente cada registro
// real que la app intentara guardar offline.
const IdOrganizacionSchema = z.string().min(1, 'ID_Organizacion es requerido');

export const PartoRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid(),
  fecha_parto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  n_vivos: z.number().int().nonnegative({ message: 'Nacidos vivos no puede ser negativo' }),
  n_muertos: z.number().int().nonnegative().default(0),
  peso_total_camada_g: z.number().int().positive().optional().nullable(),
  macho_activo_codigo: z.string().max(50).optional().nullable(),
  madre_id: z.string().uuid().optional().nullable(), // v3: FK real cuando el modo individual está activo
  macho_id: z.string().uuid().optional().nullable(), // v3: FK real al padre identificado (complementa macho_activo_codigo)
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v3: exactamente uno de animal_id (modo individual) o lote_id/poza_id (modo
// poblacional) — mismo CHECK que la migración de base de datos, replicado
// acá para dar feedback inmediato en el formulario, antes de intentar
// guardar (útil sobre todo offline, donde el error de la base tarda en
// llegar hasta que haya señal para sincronizar).
export const MortalidadRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  cantidad: z.number().int().positive({ message: 'La cantidad de bajas debe ser al menos 1' }),
  etapa: z.enum(['lactancia', 'recria', 'engorde', 'reproductor']),
  causa: z.enum(['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']),
  descripcion_sintomas: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine(
  (data) => {
    const individual = !!data.animal_id;
    const poblacional = !!data.lote_id || !!data.poza_id;
    return individual !== poblacional; // XOR: uno de los dos, nunca ambos ni ninguno
  },
  { message: 'Debe indicar un animal identificado O un lote/poza (poblacional), no ambos ni ninguno.', path: ['animal_id'] }
);

export const PesajeLoteSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  fecha_pesaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  animales_muestreados: z.number().int().positive(),
  peso_total_muestra_g: z.number().positive(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v3: animal_id nueva (v1 solo contemplaba venta por lote). Exactamente uno
// de animal_id/lote_id, mismo criterio que mortalidad — poza_id queda como
// dato de contexto opcional, no participa del XOR.
//
// v4 (2026-09-11, corrección de campo): la comercialización es por animal,
// no por peso. precio_unitario es nuevo — cuando se informa, el trigger
// fn_calcular_precio_total_venta recalcula precio_total en la base
// (cantidad * precio_unitario), así que enviar ambos "descoordinados" no
// genera inconsistencia real, pero replicamos el cálculo acá para dar
// feedback inmediato en el formulario. Si no se informa precio_unitario
// (ej. un lote con un total pactado directo), precio_total se toma tal
// cual. peso_total_kg pasa a ser referencial/opcional, no la base del
// precio. La venta de un animal identificado es siempre cantidad = 1.
export const VentaRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(), // v3: venta de un reproductor identificado
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'guano']),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative().optional().nullable(), // v4: precio por animal
  peso_total_kg: z.number().positive().optional().nullable(), // v4: referencial, ya no define el precio
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine(
  (data) => !!data.animal_id !== !!data.lote_id,
  { message: 'Debe indicar un animal identificado O un lote, no ambos ni ninguno.', path: ['animal_id'] }
).refine(
  (data) => !data.animal_id || data.cantidad === 1,
  { message: 'La venta de un animal identificado es siempre de cantidad 1.', path: ['cantidad'] }
);

// ---------------------------------------------------------------------
// v2 (2026-09-11): sanidad recurrente + insumos.
// ---------------------------------------------------------------------

export const ControlSanitarioSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto_usado: z.string().max(150).optional().nullable(),
  responsable: z.string().max(150).optional().nullable(),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export const LimpiezaGalponSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  galpon_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v4 (2026-09-11, reconciliación con el diseño original de AppSheet):
// - categoria: se agregan 'medicamento' y 'vitamina' (antes mezclados bajo
//   'sanitario'), y 'cama' se renombra a 'material' (ver migración v4).
//   'sanitario' se conserva para desinfectantes/limpieza de instalaciones
//   — no administrados al animal, por eso no se fusiona con 'medicamento'.
// - unidad_medida: pasa de texto libre a un enum fijo (evita "kg"/"Kg"/
//   "kilogramos" como valores distintos entre técnicos/dispositivos).
// - stock_inicial: NO es una columna de la tabla. Es un campo de solo-UI:
//   si el técnico lo completa al dar de alta el insumo, la Server Action
//   crea el insumo y ADEMÁS un primer movimiento (tipo 'entrada', esa
//   cantidad) en PECUARIO_INSUMOS_MOVIMIENTOS. El stock se sigue
//   calculando siempre por vista (vw_pecuario_insumos_stock) a partir de
//   los movimientos — nunca se vuelve a permitir editarlo a mano, a
//   diferencia del "Stock Actual" manual del AppSheet original.
export const InsumoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  nombre: z.string().min(1).max(150),
  categoria: z.enum(['alimento', 'medicamento', 'vitamina', 'sanitario', 'material', 'equipo', 'otro']).default('otro'),
  unidad_medida: z.enum(['kg', 'g', 'litro', 'ml', 'unidad', 'saco_50kg', 'saco_40kg']).default('unidad'),
  stock_minimo: z.number().nonnegative().optional().nullable(),
  stock_inicial: z.number().nonnegative().optional().nullable(), // solo-UI, ver nota arriba — no se persiste tal cual
  activo: z.boolean().default(true),
});

export const MovimientoInsumoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  insumo_id: z.string().uuid(),
  tipo_movimiento: z.enum(['entrada', 'salida']),
  cantidad: z.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// ---------------------------------------------------------------------
// v3 (2026-09-11): identificación individual de reproductoras/reproductores.
// Overlay opcional — ver specs/pecuario_identificacion_individual.md.
// ---------------------------------------------------------------------

export const ReproductorSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  codigo_arete: z.string().min(1, 'El código de arete es requerido').max(50),
  sexo: z.enum(['macho', 'hembra']),
  raza: z.string().max(50).optional().nullable(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  madre_id: z.string().uuid().optional().nullable(),
  padre_id: z.string().uuid().optional().nullable(),
  jaula_actual_id: z.string().uuid().optional().nullable(),
  proposito: z.enum(['reproductor', 'engorde', 'reemplazo', 'descarte']).default('reproductor'),
  estado: z.enum(['activo', 'vendido', 'muerto', 'enfermo']).default('activo'),
  fecha_salida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  foto_url: z.string().url().optional().nullable(),
  notas: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export const HistorialMachoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  macho_id: z.string().uuid(),
  jaula_id: z.string().uuid(),
  fecha_entrada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  fecha_salida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), // NULL = todavía activo en esa jaula
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// Exactamente un target (galpon_id/lote_id/animal_id) según el alcance
// declarado — mismo CHECK que la migración, replicado en el formulario.
export const TratamientoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  alcance: z.enum(['galpon', 'lote', 'individual']),
  galpon_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_tratamiento: z.enum(['preventivo', 'curativo', 'vitaminas']).default('preventivo'),
  diagnostico: z.string().max(500).optional().nullable(),
  insumo_id: z.string().uuid().optional().nullable(),
  cantidad_dosis: z.number().positive().optional().nullable(),
  costo_estimado: z.number().nonnegative().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine((data) => {
  if (data.alcance === 'galpon') return !!data.galpon_id && !data.lote_id && !data.animal_id;
  if (data.alcance === 'lote') return !!data.lote_id && !data.galpon_id && !data.animal_id;
  return !!data.animal_id && !data.galpon_id && !data.lote_id; // 'individual'
}, { message: 'El campo de destino debe coincidir exactamente con el alcance seleccionado (galpón, lote o animal).', path: ['alcance'] });

export type PartoRegistroInput = z.infer<typeof PartoRegistroSchema>;
export type MortalidadRegistroInput = z.infer<typeof MortalidadRegistroSchema>;
export type PesajeLoteInput = z.infer<typeof PesajeLoteSchema>;
export type VentaRegistroInput = z.infer<typeof VentaRegistroSchema>;
export type ControlSanitarioInput = z.infer<typeof ControlSanitarioSchema>;
export type LimpiezaGalponInput = z.infer<typeof LimpiezaGalponSchema>;
export type InsumoInput = z.infer<typeof InsumoSchema>;
export type MovimientoInsumoInput = z.infer<typeof MovimientoInsumoSchema>;
export type ReproductorInput = z.infer<typeof ReproductorSchema>;
export type HistorialMachoInput = z.infer<typeof HistorialMachoSchema>;
export type TratamientoInput = z.infer<typeof TratamientoSchema>;
