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
  madre_id: z.string().uuid().optional().nullable(), // reservado, futura genealogía individual
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export const MortalidadRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(), // reservado, futura genealogía individual
  fecha_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  cantidad: z.number().int().positive({ message: 'La cantidad de bajas debe ser al menos 1' }),
  etapa: z.enum(['lactancia', 'recria', 'engorde', 'reproductor']),
  causa: z.enum(['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']),
  descripcion_sintomas: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

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

export const VentaRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'guano']),
  cantidad: z.number().int().positive(),
  peso_total_kg: z.number().positive().optional().nullable(),
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export type PartoRegistroInput = z.infer<typeof PartoRegistroSchema>;
export type MortalidadRegistroInput = z.infer<typeof MortalidadRegistroSchema>;
export type PesajeLoteInput = z.infer<typeof PesajeLoteSchema>;
export type VentaRegistroInput = z.infer<typeof VentaRegistroSchema>;
