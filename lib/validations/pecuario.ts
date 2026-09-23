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

// v5 (2026-09-23, venta de pelado/beneficiado — ver
// specs/pecuario_venta_pelado_beneficiado.md y las migraciones
// 20260923090000a_pecuario_venta_pelado_enum.sql +
// 20260923090000b_pecuario_venta_pelado_beneficiado.sql -- partida en 2
// archivos/2 Runs de Studio, ver el encabezado de la parte A):
// - tipo_salida gana 'pelado_beneficiado'.
// - base_precio ('por_animal' default | 'por_kg') — solo 'por_kg' cuando
//   tipo_salida='pelado_beneficiado'; en ese caso peso_total_kg y
//   precio_kg pasan a ser obligatorios (antes peso_total_kg era
//   puramente referencial). Mismo criterio XOR que el resto del archivo,
//   replicando chk_ventas_base_precio_coherente.
// - peso_vivo_pre_beneficio_kg (Ronda 46, 2026-09-22): opcional, base de
//   Rendimiento de carcasa — no se valida como obligatorio ni en la base
//   ni acá, mismo criterio de no bloquear captura offline por un dato
//   faltante (ver comentario de la columna en la migración).
export const VentaRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(), // v3: venta de un reproductor identificado
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  // 'guano' retirado (2026-09-23, ver 20260923110000_pecuario_venta_subproductos_guano.sql):
  // el guano ya no es un tipo_salida de PECUARIO_VENTAS -- pasa por
  // VentaSubproductoSchema/PECUARIO_VENTAS_SUBPRODUCTOS. El valor
  // 'guano' del enum tipo_venta_cuy en la base queda como vestigio
  // inerte (Postgres no permite eliminar valores de enum) -- 0 filas
  // históricas reales con ese valor (confirmado en vivo antes de este
  // cambio), así que retirarlo acá no rompe ningún dato existente.
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado']),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative().optional().nullable(), // v4: precio por animal
  peso_total_kg: z.number().positive().optional().nullable(), // v4: referencial salvo cuando base_precio='por_kg' (v5, ver abajo)
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  base_precio: z.enum(['por_animal', 'por_kg']).default('por_animal'),
  precio_kg: z.number().nonnegative().optional().nullable(),
  peso_vivo_pre_beneficio_kg: z.number().positive().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine(
  (data) => !!data.animal_id !== !!data.lote_id,
  { message: 'Debe indicar un animal identificado O un lote, no ambos ni ninguno.', path: ['animal_id'] }
).refine(
  (data) => !data.animal_id || data.cantidad === 1,
  { message: 'La venta de un animal identificado es siempre de cantidad 1.', path: ['cantidad'] }
).refine(
  (data) => data.base_precio === 'por_animal' || data.tipo_salida === 'pelado_beneficiado',
  { message: 'La base de precio "por kilogramo" solo aplica a ventas de tipo Pelado (beneficiado).', path: ['base_precio'] }
).refine(
  (data) => data.base_precio !== 'por_kg' || (data.peso_total_kg != null && data.precio_kg != null),
  { message: 'Con base de precio "por kilogramo", el peso total pelado y el precio por kg son obligatorios.', path: ['precio_kg'] }
).refine(
  // Falta en la redacción original: chk_ventas_base_precio_coherente exige
  // precio_kg IS NULL cuando base_precio='por_animal' -- sin este refine,
  // el formulario podía prometer un guardado que la base rechazaría.
  (data) => data.base_precio !== 'por_animal' || data.precio_kg == null,
  { message: 'Con base de precio "por animal", no debe enviarse precio_kg.', path: ['precio_kg'] }
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

// ---------------------------------------------------------------------
// Compras/gastos de la granja (2026-09-22) — ver
// specs/pecuario_compras_gastos.md y
// supabase/migrations/20260922110000_pecuario_compras_gastos.sql.
// Dos ramas mutuamente excluyentes según `concepto`:
//   - 'insumo': genera además el movimiento de 'entrada' automático en
//     PECUARIO_INSUMOS_MOVIMIENTOS (trigger fn_compra_genera_entrada_insumo).
//   - 'servicio_otro': gasto de la granja sin insumo de stock asociado
//     (combustible, mantenimiento, servicio veterinario/técnico, mano de
//     obra).
// `monto_total` es una columna GENERATED en la base (costo_insumo + flete,
// o monto_servicio) — nunca se envía desde el cliente, por eso no aparece
// en este schema (mismo criterio que peso_promedio_g, ausente de
// PesajeLoteSchema). El refine replica exactamente
// chk_compras_rama_por_concepto de la migración, para dar feedback
// inmediato en el formulario antes de que el INSERT llegue a la base.
export const CompraSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  proveedor: z.string().max(150).optional().nullable(),
  concepto: z.enum(['insumo', 'servicio_otro']),
  // Rama "insumo"
  insumo_id: z.string().uuid().optional().nullable(),
  cantidad: z.number().positive().optional().nullable(),
  galpon_id: z.string().uuid().optional().nullable(),
  costo_insumo: z.number().nonnegative().optional().nullable(),
  flete: z.number().nonnegative().optional().nullable(), // opcional -- sin default acá ni en la base (fix 20260922120000: la base tenía DEFAULT 0 sin condicionar a la rama, violaba chk_compras_rama_por_concepto en servicio_otro; monto_total ya hace COALESCE(flete,0) al calcular)
  // Rama "servicio_otro"
  categoria_gasto: z.enum(['combustible', 'mantenimiento_reparaciones', 'servicio_veterinario_tecnico', 'mano_obra', 'otro']).optional().nullable(),
  descripcion: z.string().max(500).optional().nullable(),
  monto_servicio: z.number().nonnegative().optional().nullable(),
  // Comunes
  comprobante: z.string().max(100).optional().nullable(),
  device_id: z.string().min(1).optional().nullable(), // offline aún sin confirmar para esta pantalla, ver spec §5
  created_offline_at: z.string().datetime().optional().nullable(),
}).refine((data) => {
  if (data.concepto === 'insumo') {
    return (
      !!data.insumo_id &&
      data.cantidad != null && data.cantidad > 0 &&
      !!data.galpon_id &&
      data.costo_insumo != null && data.costo_insumo >= 0 &&
      data.categoria_gasto == null && data.descripcion == null && data.monto_servicio == null
    );
  }
  // 'servicio_otro'
  return (
    !!data.categoria_gasto && !!data.descripcion &&
    data.monto_servicio != null && data.monto_servicio >= 0 &&
    data.insumo_id == null && data.cantidad == null && data.galpon_id == null &&
    data.costo_insumo == null && data.flete == null
  );
}, {
  message: 'Los campos deben coincidir exactamente con el concepto seleccionado (insumo o servicio_otro), sin mezclar campos de ambas ramas — mismo criterio que chk_compras_rama_por_concepto en la base.',
  path: ['concepto'],
});


// ---------------------------------------------------------------------
// v6 (2026-09-23): venta de subproductos (Guano), tabla propia
// PECUARIO_VENTAS_SUBPRODUCTOS — migración
// 20260923110000_pecuario_venta_subproductos_guano.sql. Deliberadamente
// SIN los campos de VentaRegistroSchema que no aplican a un subproducto
// (animal_id/lote_id/precio_unitario/base_precio/etc.) — spec §2.2: "sin
// lote, sin reproductor, sin cantidad de animales, sin precio por
// unidad-animal".
// ---------------------------------------------------------------------

export const VentaSubproductoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto: z.enum(['guano']).default('guano'),
  cantidad: z.number().positive(),
  unidad: z.enum(['sacos', 'kg']),
  precio_total: z.number().nonnegative().optional().nullable(), // opcional pero recomendado (spec §2.2)
  galpon_id: z.string().uuid().optional().nullable(), // solo informativo, nunca poza/lote
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

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
export type CompraInput = z.infer<typeof CompraSchema>;
export type VentaSubproductoInput = z.infer<typeof VentaSubproductoSchema>;